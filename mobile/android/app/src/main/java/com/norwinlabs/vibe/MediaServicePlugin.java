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
