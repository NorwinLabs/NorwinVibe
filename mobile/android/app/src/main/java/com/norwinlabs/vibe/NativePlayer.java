package com.norwinlabs.vibe;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.MediaMetadataRetriever;
import android.media.MediaPlayer;
import android.media.audiofx.Equalizer;
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
        MediaPlayer mp; Equalizer eq; boolean ready = false; Runnable onReady;
        void release() {
            ready = false; onReady = null;
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
    private static Deck main, outgoing;
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
            H.postDelayed(this, outgoing != null ? 80 : 250);
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
        fill(items);
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
        index = i; wantPlay = autoplay; startPos = pos; fadePending = false; fadeFailedFor = -2;
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
        push(true);
    }

    static void pause() {
        wantPlay = false;
        if (outgoing != null) finishFade();
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
        engaged = false; playing = false; wantPlay = false;
        releaseAll(); H.removeCallbacks(tick);
    }

    static void shutdown() { release(); queue.clear(); index = -1; }

    private static void releaseAll() {
        if (main != null) { main.release(); main = null; }
        if (outgoing != null) { outgoing.release(); outgoing = null; }
        fadePending = false;
    }

    /* ---------------- settings ---------------- */

    static void setRepeat(String r) { repeat = r == null ? "None" : r; }

    static void setVolume(float v, boolean m) { volume = Math.max(0f, Math.min(1f, v)); muted = m; applyVolume(); }

    static void setDucked(boolean d) { ducked = d; applyVolume(); }

    static void setFx(boolean pro_, boolean eq_, float[] g, int xf) {
        pro = pro_; eqOn = pro_ && eq_; xfade = pro_ ? Math.max(0, xf) : 0;
        for (int i = 0; i < 5 && g != null && i < g.length; i++) gains[i] = g[i];
        if (main != null) applyEq(main);
        if (outgoing != null) applyEq(outgoing);
    }

    private static float level() { return muted ? 0f : volume * (ducked ? 0.3f : 1f); }

    private static void applyVolume() {
        float v = level();
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
            float f = fadeMs <= 0 ? 1f : Math.min(1f, (SystemClock.elapsedRealtime() - fadeStart) / (float) fadeMs), v = level();
            try { main.mp.setVolume(v * f, v * f); if (outgoing.mp != null) outgoing.mp.setVolume(v * (1 - f), v * (1 - f)); } catch (Exception ignored) { }
            if (f >= 1f) finishFade();
            return;
        }
        try {
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
        fadePending = true;
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

    /* ---------------- reporting ---------------- */

    private static void trackChanged(Item it) {
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
