package com.norwinlabs.vibe;

import android.Manifest;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** JS bridge for MediaPlaybackService: MediaService.start / update / stop. */
@CapacitorPlugin(
    name = "MediaService",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class MediaServicePlugin extends Plugin {

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
        Intent i = new Intent(getContext(), MediaPlaybackService.class);
        i.putExtra("title", call.getString("title", "NorwinVibe"));
        i.putExtra("text", call.getString("text", "Playing"));
        ContextCompat.startForegroundService(getContext(), i);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        MediaPlaybackService.update(getContext(), call.getString("title", "NorwinVibe"), call.getString("text", "Playing"));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), MediaPlaybackService.class));
        call.resolve();
    }
}
