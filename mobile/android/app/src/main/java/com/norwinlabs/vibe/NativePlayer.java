package com.norwinlabs.vibe;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.MediaMetadataRetriever;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The music engine. It lives in the app process (kept alive by MediaPlaybackService), not in the web view, so songs keep
 * playing, and the queue keeps advancing, after the app is swiped away from the recent apps.
 *
 * The web UI sends it a queue (the songs in play order) and then drives it; it reports what is playing back through
 * {@link MediaServicePlugin#dispatchNative}. Everything here runs on the main thread (callers go through {@link #post}).
 */
final class NativePlayer {
    static final class Item { String id = "", path = "", title = "", artist = "", album = ""; long dur = 0; }

    /** One MediaPlayer plus its equalizer. */
    private static final class Deck {
        MediaPlayer mp; Equalizer eq; LoudnessEnhancer le; boolean ready = false; Runnable onReady;
        Float rgDb = null; float rg = 1f; // ReplayGain from the song's tags: rgDb is the raw value, rg the volume factor it becomes
        void release() {
            ready = false; onReady = null;
            if (le != null) { try { le.release(); } catch (Exception ignored) { } le = null; }
            if (eq != null) { try { eq.release(); } catch (Exception ignored) { } eq = null; }
            if (mp != null) { try { mp.setOnCompletionListener(null); mp.setOnErrorListener(null); mp.setOnPreparedListener(null); mp.release(); } catch (Exception ignored) { } mp = null; }
        }
    }

    private static final Handler H = new Handler(Looper.getMainLooper());
    private static final List<Item> queue = new ArrayList<>();
    private static int index = -1;
    private static String repeat = "None";
    private static boolean engaged = false, playing = false, wantPlay = false, pro = false, muted = false, ducked = false;
    private static boolean eqOn = false, fadePending = false;
    private static float volume = 1f;
    private static float[] gains = new float[5];
    private static int xfade = 0;
    private static long startPos = 0, fadeStart = 0, fadeMs = 0, lastSync = 0;
    private static int fadeFailedFor = -2, errorsInRow = 0;
    private static Deck main, outgoing, gap;     // gap: the next song, prepared early so it follows without a pause
    private static Item gapItem;
    private static boolean gapSet = false, rgOn = true, slowOn = true;
    private static int gapFailedFor = -2;
    private static long loopA = 0, loopB = 0;       // A-B repeat of part of the song (ms); loopB 0 = off
    private static float speed = 1f;                 // playback speed, below 1 while the record slows to a stop / spins up
    private static float rampFrom = 1f, rampTo = 1f; private static long rampAt = 0, rampMs = 0; private static Runnable rampDone; private static boolean ramping = false;
    private static Context ctx;
    private static final int[] EQ_FREQS = { 60, 230, 910, 3600, 14000 };

    private NativePlayer() { }

    static void post(Runnable r) { H.post(r); }
    static boolean engaged() { return engaged; }
    static boolean isPlaying() { return playing; }

    private static final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!engaged) return;
            onTick();
            H.postDelayed(this, outgoing != null ? 80 : (loopB > 0 ? 60 : 250));
        }
    };

    /* ---------------- queue + transport ---------------- */

    private static void fill(JSArray items) {
        queue.clear();
        for (int i = 0; i < items.length(); i++) {
            try {
                org.json.JSONObject o = items.getJSONObject(i);
                Item it = new Item();
                it.id = o.optString("id"); it.path = o.optString("path"); it.title = o.optString("title");
                it.artist = o.optString("artist"); it.album = o.optString("album"); it.dur = o.optLong("dur");
                queue.add(it);
            } catch (Exception ignored) { }
        }
    }

    static void setQueue(Context c, JSArray items, int start, boolean autoplay, long pos) {
        ctx = c.getApplicationContext();
        fill(items);
        engaged = true;
        H.removeCallbacks(tick); H.post(tick);
        playIndex(start, autoplay, pos);
    }

    /** A new play order (shuffle, library change): swap it in without touching the song that is playing. */
    static void replaceQueue(JSArray items, int current) {
        if (!engaged) return;
        fill(items); dropGap(); gapFailedFor = -2;
        if (current >= 0 && current < queue.size()) index = current;
    }

    static void playIndex(int i, boolean autoplay, long pos) {
        if (i < 0 || i >= queue.size()) return;
        engaged = true; errorsInRow = 0;
        H.removeCallbacks(tick); H.post(tick);
        start(i, autoplay, pos);
    }

    private static void start(int i, boolean autoplay, long pos) {
        Item it = queue.get(i);
        releaseAll();
        index = i; wantPlay = autoplay; startPos = pos; fadePending = false; fadeFailedFor = -2; gapFailedFor = -2; speed = 1f;
        if (it.path.isEmpty()) { playing = false; trackChanged(it); return; }
        main = newDeck(it, null);
        if (main == null) { playing = false; onError(); return; }
        trackChanged(it);
    }

    /** Builds a MediaPlayer for `it`; `ready` runs once it is prepared. Null when the file cannot be opened. */
    private static Deck newDeck(Item it, Runnable ready) {
        final Deck d = new Deck();
        d.onReady = ready;
        try {
            d.mp = new MediaPlayer();
            d.mp.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            d.mp.setWakeMode(ctx, PowerManager.PARTIAL_WAKE_LOCK);
            d.mp.setDataSource(it.path);
            d.mp.setOnPreparedListener((m) -> onPrepared(d));
            d.mp.setOnCompletionListener((m) -> { if (d == main) onCompleted(); });
            d.mp.setOnErrorListener((m, what, extra) -> { onDeckError(d); return true; });
            d.mp.prepareAsync();
            readGain(it, d);
            return d;
        } catch (Exception e) {
            d.release();
            return null;
        }
    }

    private static void onPrepared(Deck d) {
        if (d.mp == null) return;
        d.ready = true;
        try { d.eq = new Equalizer(0, d.mp.getAudioSessionId()); d.eq.setEnabled(true); applyEq(d); } catch (Exception ignored) { d.eq = null; }
        applyRg(d);
        if (d.onReady != null) { Runnable r = d.onReady; d.onReady = null; r.run(); return; }
        if (d != main) return;
        errorsInRow = 0;
        applyVolume();
        try {
            if (startPos > 0) d.mp.seekTo((int) startPos);
            if (wantPlay) { d.mp.start(); playing = true; MediaPlaybackService.focus(); }
        } catch (Exception ignored) { }
        startPos = 0;
        push(true);
    }

    private static void onDeckError(Deck d) {
        if (d == main) onError();
        else if (d != null && d == outgoing) { outgoing.release(); outgoing = null; }
        else if (d != null && d == gap) { gap = null; gapSet = false; gapFailedFor = index; d.release(); }
        else { fadePending = false; fadeFailedFor = index; d.release(); }
    }

    /** The current file could not be played: tell the UI and move on to the next song (but not forever). */
    private static void onError() {
        Item it = index >= 0 && index < queue.size() ? queue.get(index) : null;
        JSObject o = new JSObject(); o.put("type", "error"); if (it != null) o.put("id", it.id);
        MediaServicePlugin.dispatchNative(o);
        if (++errorsInRow > 5 || queue.size() < 2) { playing = false; push(true); return; }
        wantPlay = playing || wantPlay;
        advance();
    }

    private static int nextIndex() {
        if (queue.isEmpty()) return -1;
        int i = index + 1;
        if (i >= queue.size()) { if ("List".equals(repeat)) i = 0; else return -1; }
        return i;
    }

    private static void onCompleted() {
        if (gap != null && gapSet && gapItem != null && !"Track".equals(repeat)) { promoteGap(); return; } // the framework has already started it: no gap
        if ("Track".equals(repeat) && main != null && main.mp != null) {
            try { main.mp.seekTo(0); main.mp.start(); } catch (Exception ignored) { }
            push(true); return;
        }
        advance();
    }

    /** The song ended (or failed): go to the next one, or stop at the end of the list. */
    private static void advance() {
        int i = nextIndex();
        if (i < 0) { stopAtEnd(); return; }
        wantPlay = true;
        if (queue.get(i).path.isEmpty()) {
            if (MediaServicePlugin.alive()) { // a song only the web player can play: hand over
                index = i; releaseAll(); playing = false;
                JSObject o = new JSObject(); o.put("type", "needjs"); o.put("id", queue.get(i).id); o.put("index", i);
                MediaServicePlugin.dispatchNative(o);
                return;
            }
            int j = i, tries = 0; // nobody to hand over to: skip to the next song the engine can play
            while (queue.get(j).path.isEmpty() && tries++ < queue.size()) { j++; if (j >= queue.size()) { if ("List".equals(repeat)) j = 0; else { stopAtEnd(); return; } } }
            if (queue.get(j).path.isEmpty()) { stopAtEnd(); return; }
            i = j;
        }
        start(i, true, 0);
    }

    private static void stopAtEnd() {
        playing = false; wantPlay = false;
        if (main != null && main.mp != null) { try { main.mp.pause(); main.mp.seekTo(0); } catch (Exception ignored) { } }
        push(true);
    }

    static void play() {
        if (!engaged) return;
        wantPlay = true;
        if (main == null && index >= 0 && index < queue.size() && !queue.get(index).path.isEmpty()) { start(index, true, 0); return; }
        if (main == null || !main.ready) return;
        try { main.mp.start(); if (outgoing != null && outgoing.ready) outgoing.mp.start(); playing = true; } catch (Exception ignored) { }
        MediaPlaybackService.focus();
        stopRamp();
        if (speed < 0.99f) { if (slowOn && Build.VERSION.SDK_INT >= 23) startRamp(speed, 1f, 380, null); else setSpeed(1f); } // the record spins back up
        push(true);
    }

    static void pause() {
        wantPlay = false;
        if (outgoing != null) finishFade();
        if (slowOn && playing && main != null && main.ready && Build.VERSION.SDK_INT >= 23) { // the record winds down like a platter being switched off
            playing = false; push(true);
            startRamp(speed, 0.12f, 420, () -> { if (!playing && main != null && main.ready) { try { main.mp.pause(); } catch (Exception ignored) { } } });
            return;
        }
        if (main != null && main.ready) { try { main.mp.pause(); } catch (Exception ignored) { } }
        playing = false;
        push(true);
    }

    static void seek(long ms) {
        if (main != null && main.ready) { try { main.mp.seekTo((int) Math.max(0, ms)); } catch (Exception ignored) { } }
        push(true);
    }

    static void next() {
        if (queue.isEmpty()) return;
        int i = index + 1;
        if (i >= queue.size()) { if ("List".equals(repeat)) i = 0; else { pause(); seek(0); return; } }
        wantPlay = true;
        jumpTo(i);
    }

    static void prev() {
        if (queue.isEmpty()) return;
        if (main != null && main.ready) { try { if (main.mp.getCurrentPosition() > 3000) { main.mp.seekTo(0); push(true); return; } } catch (Exception ignored) { } }
        int i = index - 1;
        if (i < 0) i = "List".equals(repeat) ? queue.size() - 1 : 0;
        wantPlay = true;
        jumpTo(i);
    }

    private static void jumpTo(int i) {
        if (queue.get(i).path.isEmpty()) {
            if (MediaServicePlugin.alive()) {
                index = i; releaseAll(); playing = false;
                JSObject o = new JSObject(); o.put("type", "needjs"); o.put("id", queue.get(i).id); o.put("index", i);
                MediaServicePlugin.dispatchNative(o);
                return;
            }
            return;
        }
        start(i, true, 0);
    }

    /** Hands playback back to the web player: stop making sound and let the buttons go to the web UI again. */
    static void release() {
        engaged = false; playing = false; wantPlay = false; loopA = loopB = 0;
        stopRamp(); releaseAll(); H.removeCallbacks(tick);
    }

    static void shutdown() { release(); queue.clear(); index = -1; }

    private static void releaseAll() {
        stopRamp(); dropGap();
        if (main != null) { main.release(); main = null; }
        if (outgoing != null) { outgoing.release(); outgoing = null; }
        fadePending = false;
    }

    /* ---------------- settings ---------------- */

    static void setRepeat(String r) { repeat = r == null ? "None" : r; }

    static void setVolume(float v, boolean m) { volume = Math.max(0f, Math.min(1f, v)); muted = m; applyVolume(); }

    static void setDucked(boolean d) { ducked = d; applyVolume(); }

    static void setFx(boolean pro_, boolean eq_, float[] g, int xf, boolean rg_, boolean slow_) {
        pro = pro_; eqOn = pro_ && eq_; xfade = pro_ ? Math.max(0, xf) : 0; rgOn = rg_; slowOn = slow_;
        for (int i = 0; i < 5 && g != null && i < g.length; i++) gains[i] = g[i];
        if (main != null) applyEq(main);
        if (outgoing != null) applyEq(outgoing);
        applyRg(main); applyRg(outgoing); applyRg(gap);
    }

    static void setLoop(long a, long b) { loopA = Math.max(0, a); loopB = b > loopA ? b : 0; H.removeCallbacks(tick); if (engaged) H.post(tick); }

    private static float level() { return muted ? 0f : volume * (ducked ? 0.3f : 1f); }
    private static float level(Deck d) { return level() * (d != null ? d.rg : 1f); }

    private static void applyVolume() {
        float v = level(main);
        if (outgoing == null && main != null && main.mp != null) { try { main.mp.setVolume(v, v); } catch (Exception ignored) { } }
    }

    private static void applyEq(Deck d) {
        if (d == null || d.eq == null) return;
        try {
            short bands = d.eq.getNumberOfBands();
            short[] range = d.eq.getBandLevelRange();
            for (short b = 0; b < bands; b++) {
                double centre = d.eq.getCenterFreq(b) / 1000.0, best = Double.MAX_VALUE; int pick = 0; // nearest of our five bands, in octaves
                for (int k = 0; k < 5; k++) { double dist = Math.abs(Math.log(centre / EQ_FREQS[k])); if (dist < best) { best = dist; pick = k; } }
                int mb = eqOn ? Math.round(gains[pick] * 100f) : 0;
                d.eq.setBandLevel(b, (short) Math.max(range[0], Math.min(range[1], mb)));
            }
        } catch (Exception ignored) { }
    }

    /* ---------------- crossfade + ticking ---------------- */

    private static void onTick() {
        Deck d = main;
        if (d == null || !d.ready || d.mp == null) return;
        if (outgoing != null) {
            float f = fadeMs <= 0 ? 1f : Math.min(1f, (SystemClock.elapsedRealtime() - fadeStart) / (float) fadeMs), v = level(main), vo = level(outgoing);
            try { main.mp.setVolume(v * f, v * f); if (outgoing.mp != null) outgoing.mp.setVolume(vo * (1 - f), vo * (1 - f)); } catch (Exception ignored) { }
            if (f >= 1f) finishFade();
            return;
        }
        try {
            if (playing && loopB > loopA) { // A-B repeat
                if (d.mp.getCurrentPosition() >= loopB) d.mp.seekTo((int) loopA);
            } else if (playing && xfade == 0 && gap == null && !fadePending && gapFailedFor != index && !"Track".equals(repeat) && Build.VERSION.SDK_INT >= 16) {
                int dur0 = d.mp.getDuration(), pos0 = d.mp.getCurrentPosition(), n0 = nextIndex();
                if (dur0 > 0 && dur0 - pos0 < 12000 && n0 >= 0 && !queue.get(n0).path.isEmpty()) prepareGap(n0); // get the next song ready early so it follows without a pause
            }
            if (playing && xfade > 0 && !fadePending && fadeFailedFor != index && !"Track".equals(repeat)) {
                int dur = d.mp.getDuration(), pos = d.mp.getCurrentPosition();
                if (dur > xfade * 2500L && dur - pos <= xfade * 1000L + 250) beginFade();
            }
            if (playing && SystemClock.elapsedRealtime() - lastSync > 2000) push(false); // keeps the seek bar honest
        } catch (Exception ignored) { }
    }

    private static void beginFade() {
        final int n = nextIndex();
        if (n < 0 || queue.get(n).path.isEmpty()) { fadeFailedFor = index; return; }
        dropGap(); fadePending = true;
        final Deck[] box = new Deck[1];
        box[0] = newDeck(queue.get(n), () -> {
            Deck inc = box[0];
            if (!fadePending || inc == null || inc.mp == null || main == null) { if (inc != null) inc.release(); return; }
            fadePending = false;
            try { inc.mp.setVolume(0f, 0f); inc.mp.start(); } catch (Exception e) { inc.release(); fadeFailedFor = index; return; }
            outgoing = main; main = inc; index = n;
            outgoing.mp.setOnCompletionListener(null);
            fadeMs = xfade * 1000L; fadeStart = SystemClock.elapsedRealtime();
            trackChanged(queue.get(n));
        });
        if (box[0] == null) { fadePending = false; fadeFailedFor = index; }
    }

    private static void finishFade() {
        if (outgoing != null) { outgoing.release(); outgoing = null; }
        applyVolume();
    }

    /* ---------------- gapless, ReplayGain, record-stop ---------------- */

    private static void dropGap() {
        if (main != null && main.mp != null && gapSet) { try { main.mp.setNextMediaPlayer(null); } catch (Exception ignored) { } }
        if (gap != null) { gap.release(); gap = null; }
        gapSet = false; gapItem = null;
    }

    private static void prepareGap(final int n) {
        gapItem = queue.get(n);
        final Deck[] box = new Deck[1];
        box[0] = newDeck(gapItem, () -> {
            Deck d = box[0];
            if (d == null || d.mp == null || main == null || main.mp == null || d != gap) { if (d != null) d.release(); return; }
            try { float v = level(d); d.mp.setVolume(v, v); main.mp.setNextMediaPlayer(d.mp); gapSet = true; }
            catch (Exception e) { gap = null; gapSet = false; gapFailedFor = index; d.release(); }
        });
        gap = box[0];
        if (gap == null) { gapFailedFor = index; gapItem = null; }
    }

    /** The current song ended and the prepared one has already started: make it the current song. */
    private static void promoteGap() {
        final Deck old = main;
        Item it = gapItem;
        main = gap; gap = null; gapSet = false; gapItem = null;
        int ni = -1;
        for (int i = 0; i < queue.size(); i++) if (queue.get(i).id.equals(it.id)) { ni = i; break; }
        if (ni >= 0) index = ni;
        if (old != null) H.post(old::release);
        errorsInRow = 0; speed = 1f;
        applyVolume();
        trackChanged(it);
    }

    private static void readGain(final Item it, final Deck d) { // off the main thread: it reads the start of the file
        new Thread(() -> {
            final Float g = ReplayGain.read(it.path);
            H.post(() -> { d.rgDb = g; applyRg(d); });
        }).start();
    }

    private static void applyRg(Deck d) {
        if (d == null || d.mp == null) return;
        float db = rgOn && d.rgDb != null ? Math.max(-15f, Math.min(6f, d.rgDb)) : 0f;
        d.rg = db < 0 ? (float) Math.pow(10, db / 20.0) : 1f; // quieter songs are turned down...
        if (d.ready) {
            try { // ...and a song that is quieter than average is lifted a little by the loudness enhancer
                if (db > 0 && d.le == null) { d.le = new LoudnessEnhancer(d.mp.getAudioSessionId()); }
                if (d.le != null) { d.le.setTargetGain(Math.round(Math.max(0f, db) * 100f)); d.le.setEnabled(db > 0); }
            } catch (Exception ignored) { }
        }
        if (d == main) applyVolume();
        else if (d == gap && d.mp != null) { try { float v = level(d); d.mp.setVolume(v, v); } catch (Exception ignored) { } }
    }

    private static final Runnable rampStep = new Runnable() {
        @Override public void run() {
            if (!ramping) return;
            float f = rampMs <= 0 ? 1f : Math.min(1f, (SystemClock.elapsedRealtime() - rampAt) / (float) rampMs);
            if (!setSpeed(rampFrom + (rampTo - rampFrom) * f) || f >= 1f) { ramping = false; Runnable done = rampDone; rampDone = null; if (done != null) done.run(); return; }
            H.postDelayed(this, 30);
        }
    };

    private static void startRamp(float from, float to, long ms, Runnable done) {
        stopRamp();
        rampFrom = from; rampTo = to; rampAt = SystemClock.elapsedRealtime(); rampMs = ms; rampDone = done; ramping = true;
        H.post(rampStep);
    }

    private static void stopRamp() { ramping = false; rampDone = null; H.removeCallbacks(rampStep); }

    /** Speed and pitch together, like a platter slowing down. Only valid while the player is playing (a non-zero speed starts it). */
    private static boolean setSpeed(float s) {
        speed = s;
        if (Build.VERSION.SDK_INT < 23 || main == null || main.mp == null || !main.ready) return false;
        try { main.mp.setPlaybackParams(new PlaybackParams().setSpeed(s).setPitch(s)); return true; } catch (Exception e) { return false; }
    }

    /* ---------------- reporting ---------------- */

    private static void trackChanged(Item it) {
        loopA = loopB = 0;
        JSObject o = new JSObject(); o.put("type", "track"); o.put("id", it.id); o.put("index", index);
        MediaServicePlugin.dispatchNative(o);
        push(true);
        loadArt(it);
    }

    private static MediaPlaybackService.Params params() {
        MediaPlaybackService.Params p = new MediaPlaybackService.Params();
        Item it = index >= 0 && index < queue.size() ? queue.get(index) : null;
        if (it != null) { p.title = it.title; p.text = it.artist; p.album = it.album; p.duration = it.dur * 1000L; }
        p.playing = playing; p.pro = pro;
        p.position = position();
        if (main != null && main.ready && main.mp != null) { try { int d = main.mp.getDuration(); if (d > 0) p.duration = d; } catch (Exception ignored) { } }
        return p;
    }

    static long position() {
        if (main != null && main.ready && main.mp != null) { try { return main.mp.getCurrentPosition(); } catch (Exception ignored) { } }
        return 0;
    }

    /** Updates the notification / lock screen / widget, and (when `full`) tells the web UI the play state. */
    private static void push(boolean full) {
        lastSync = SystemClock.elapsedRealtime();
        MediaPlaybackService.Params p = params();
        if (ctx != null) MediaPlaybackService.update(ctx, p);
        JSObject o = new JSObject();
        o.put("type", "state"); o.put("playing", playing); o.put("pos", p.position); o.put("dur", p.duration);
        if (index >= 0 && index < queue.size()) o.put("id", queue.get(index).id);
        MediaServicePlugin.dispatchNative(o);
    }

    /** Cover for the notification, read from the file's own tags off the main thread. */
    private static void loadArt(final Item it) {
        if (it.path.isEmpty()) return;
        new Thread(() -> {
            Bitmap bmp = null;
            MediaMetadataRetriever r = new MediaMetadataRetriever();
            try {
                r.setDataSource(it.path);
                byte[] raw = r.getEmbeddedPicture();
                if (raw != null) {
                    BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
                    BitmapFactory.Options o = new BitmapFactory.Options();
                    o.inSampleSize = Math.max(1, Math.max(bounds.outWidth, bounds.outHeight) / 512);
                    bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length, o);
                }
            } catch (Exception ignored) { } finally { try { r.release(); } catch (Exception ignored) { } }
            final Bitmap art = bmp;
            H.post(() -> {
                if (!engaged || index < 0 || index >= queue.size() || !queue.get(index).id.equals(it.id) || art == null || ctx == null) return; // moved on
                MediaPlaybackService.setArt(ctx, art, params());
            });
        }).start();
    }

    static void state(com.getcapacitor.PluginCall call) {
        JSObject o = new JSObject();
        o.put("active", engaged && index >= 0 && index < queue.size());
        JSArray ids = new JSArray();
        for (Item it : queue) ids.put(it.id);
        o.put("ids", ids); o.put("index", index); o.put("playing", playing); o.put("pos", position());
        o.put("dur", params().duration); o.put("repeat", repeat);
        call.resolve(o);
    }
}
