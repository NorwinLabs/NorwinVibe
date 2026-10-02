package com.norwinlabs.vibe;

import android.Manifest;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * JS bridge for MediaPlaybackService:  MediaService.start / update / stop,
 * and an "action" event ({ action: play | pause | toggle | next | prev | seekTo, position }) for the notification,
 * lock screen and widget buttons.
 */
@CapacitorPlugin(
    name = "MediaService",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class MediaServicePlugin extends Plugin {
    private static MediaServicePlugin instance;

    @Override
    public void load() { instance = this; }

    @Override
    protected void handleOnDestroy() { if (instance == this) instance = null; }

    private static String pendingId, pendingList, pendingQuery;

    /** A song (or a voice search) chosen in Android Auto. If the web UI is not running, remember it and open the app. */
    static void dispatchPlay(String id, String list, String query) {
        MediaServicePlugin p = instance;
        if (p != null) {
            JSObject o = new JSObject();
            o.put("action", query != null ? "playSearch" : "playId");
            if (id != null) o.put("id", id);
            if (list != null) o.put("list", list);
            if (query != null) o.put("query", query);
            p.notifyListeners("action", o, true);
            return;
        }
        pendingId = id; pendingList = list; pendingQuery = query;
        android.content.Context c = MediaPlaybackService.appContext();
        if (c != null) {
            try { c.startActivity(new android.content.Intent(c, MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP)); } catch (Exception ignored) { }
        }
    }

    /** The web UI asks, once it has started, whether the car picked something while it was not running. */
    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject o = new JSObject();
        if (pendingId != null) o.put("id", pendingId);
        if (pendingList != null) o.put("list", pendingList);
        if (pendingQuery != null) o.put("query", pendingQuery);
        pendingId = null; pendingList = null; pendingQuery = null;
        call.resolve(o);
    }

    /** The library / playlists for the Android Auto browse tree (empty for free users). */
    @PluginMethod
    public void setLibrary(PluginCall call) {
        AutoBrowserService.setSnapshot(getContext(), call.getData().toString());
        call.resolve();
    }

    static boolean alive() { return instance != null; }

    /** Native player -> web UI ({ type: track | state | needjs | error, ... }). */
    static void dispatchNative(JSObject o) {
        MediaServicePlugin p = instance;
        if (p != null) p.notifyListeners("native", o);
    }

    /* ---- the native player (NativePlayer): queue, transport, volume, equalizer + crossfade ---- */

    private static volatile long startedAt = 0;

    private void ensureRunning(boolean playing) {
        if (MediaPlaybackService.isRunning() || System.currentTimeMillis() - startedAt < 4000) return; // already up, or just asked for
        MediaPlaybackService.Params p = new MediaPlaybackService.Params();
        p.playing = playing;
        startedAt = System.currentTimeMillis();
        ContextCompat.startForegroundService(getContext(), MediaPlaybackService.startIntent(getContext(), p));
    }

    private static void applyFx(PluginCall call) {
        boolean pro = Boolean.TRUE.equals(call.getBoolean("pro", false)), eq = Boolean.TRUE.equals(call.getBoolean("eq", false));
        float[] g = new float[5];
        try { com.getcapacitor.JSArray a = call.getArray("gains"); for (int i = 0; i < 5 && a != null && i < a.length(); i++) g[i] = (float) a.getDouble(i); } catch (Exception ignored) { }
        Integer xf = call.getInt("xfade", 0);
        NativePlayer.setFx(pro, eq, g, xf == null ? 0 : xf);
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        final com.getcapacitor.JSArray items = call.getArray("items");
        if (items == null) { call.reject("no items"); return; }
        final int index = call.getInt("index", 0) == null ? 0 : call.getInt("index", 0);
        final boolean autoplay = Boolean.TRUE.equals(call.getBoolean("autoplay", true));
        final long pos = call.getLong("position", 0L) == null ? 0 : call.getLong("position", 0L);
        final String repeat = call.getString("repeat", "None");
        final float vol = call.getFloat("volume", 1f) == null ? 1f : call.getFloat("volume", 1f);
        final boolean muted = Boolean.TRUE.equals(call.getBoolean("muted", false));
        final boolean keep = Boolean.TRUE.equals(call.getBoolean("keep", false));
        if (!keep) ensureRunning(autoplay);
        NativePlayer.post(() -> {
            if (keep) { NativePlayer.replaceQueue(items, index); call.resolve(); return; }
            applyFx(call);
            NativePlayer.setRepeat(repeat); NativePlayer.setVolume(vol, muted);
            NativePlayer.setQueue(getContext(), items, index, autoplay, pos);
            call.resolve();
        });
    }

    @PluginMethod
    public void playIndex(PluginCall call) {
        final int index = call.getInt("index", 0) == null ? 0 : call.getInt("index", 0);
        final boolean autoplay = Boolean.TRUE.equals(call.getBoolean("autoplay", true));
        final long pos = call.getLong("position", 0L) == null ? 0 : call.getLong("position", 0L);
        ensureRunning(autoplay);
        NativePlayer.post(() -> { applyFx(call); NativePlayer.playIndex(index, autoplay, pos); call.resolve(); });
    }

    @PluginMethod public void play(PluginCall call) { NativePlayer.post(() -> { NativePlayer.play(); call.resolve(); }); }
    @PluginMethod public void pause(PluginCall call) { NativePlayer.post(() -> { NativePlayer.pause(); call.resolve(); }); }
    @PluginMethod public void next(PluginCall call) { NativePlayer.post(() -> { NativePlayer.next(); call.resolve(); }); }
    @PluginMethod public void prev(PluginCall call) { NativePlayer.post(() -> { NativePlayer.prev(); call.resolve(); }); }
    @PluginMethod public void release(PluginCall call) { NativePlayer.post(() -> { NativePlayer.release(); call.resolve(); }); }

    @PluginMethod
    public void seek(PluginCall call) {
        final long ms = call.getLong("ms", 0L) == null ? 0 : call.getLong("ms", 0L);
        NativePlayer.post(() -> { NativePlayer.seek(ms); call.resolve(); });
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        final String r = call.getString("mode", "None");
        NativePlayer.post(() -> { NativePlayer.setRepeat(r); call.resolve(); });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        final float v = call.getFloat("volume", 1f) == null ? 1f : call.getFloat("volume", 1f);
        final boolean m = Boolean.TRUE.equals(call.getBoolean("muted", false));
        NativePlayer.post(() -> { NativePlayer.setVolume(v, m); call.resolve(); });
    }

    @PluginMethod
    public void setFx(PluginCall call) { NativePlayer.post(() -> { applyFx(call); call.resolve(); }); }

    @PluginMethod
    public void getState(PluginCall call) { NativePlayer.post(() -> NativePlayer.state(call)); }

    /* ---- copies of songs added with "Add files": written next to the app so the native player can open them ---- */

    private java.io.File musicDir() {
        java.io.File d = new java.io.File(getContext().getFilesDir(), "music");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    @PluginMethod
    public void storeFile(PluginCall call) {
        String id = call.getString("id", ""), data = call.getString("data", "");
        if (id == null || id.isEmpty()) { call.reject("no id"); return; }
        java.io.File f = new java.io.File(musicDir(), id.replaceAll("[^A-Za-z0-9._-]", "_"));
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(f, Boolean.TRUE.equals(call.getBoolean("append", false)))) {
            out.write(android.util.Base64.decode(data == null ? "" : data, android.util.Base64.DEFAULT));
        } catch (Exception e) { call.reject("Could not save the song: " + e.getMessage()); return; }
        JSObject o = new JSObject(); o.put("path", f.getAbsolutePath()); call.resolve(o);
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String path = call.getString("path", "");
        try {
            java.io.File f = new java.io.File(path == null ? "" : path).getCanonicalFile();
            if (f.getParentFile() != null && f.getParentFile().equals(musicDir().getCanonicalFile())) f.delete(); // only our own copies
        } catch (Exception ignored) { }
        call.resolve();
    }

    /** Called from the service / receiver; delivered to the web UI if it is alive. */
    static void dispatch(String action, long positionMs) {
        MediaServicePlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("action", action);
        o.put("position", positionMs);
        p.notifyListeners("action", o, true);
    }

    private static MediaPlaybackService.Params read(PluginCall call) {
        MediaPlaybackService.Params p = new MediaPlaybackService.Params();
        p.title = call.getString("title", "NorwinVibe");
        p.text = call.getString("text", "");
        p.album = call.getString("album", "");
        p.art = call.getString("art", "");
        p.playing = Boolean.TRUE.equals(call.getBoolean("playing", true));
        p.pro = Boolean.TRUE.equals(call.getBoolean("pro", false));
        Long pos = call.getLong("position", 0L);
        Long dur = call.getLong("duration", 0L);
        p.position = pos == null ? 0 : pos;
        p.duration = dur == null ? 0 : dur;
        return p;
    }

    @PluginMethod
    public void start(PluginCall call) {
        // Android 13+ asks before showing notifications. The service runs either way, so carry on whatever the answer.
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        begin(call);
    }

    private void begin(PluginCall call) {
        startedAt = System.currentTimeMillis();
        ContextCompat.startForegroundService(getContext(), MediaPlaybackService.startIntent(getContext(), read(call)));
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        MediaPlaybackService.update(getContext(), read(call));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new android.content.Intent(getContext(), MediaPlaybackService.class));
        call.resolve();
    }
}
