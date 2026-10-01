package com.norwinlabs.vibe;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * MusicScan.scan({ prompt }) lists every song on the phone from Android's media index (MediaStore), so the web UI can
 * build the library without the user picking files one by one. With prompt:false it never asks for permission and just
 * reports { granted:false }, which is how the app rescans quietly on launch.
 */
@CapacitorPlugin(
    name = "MusicScan",
    permissions = {
        @Permission(alias = "audio", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class MusicScanPlugin extends Plugin {
    private static final long MIN_MS = 15000; // skips ringtones, notification sounds and voice clips

    private String alias() { return Build.VERSION.SDK_INT >= 33 ? "audio" : "storage"; }

    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) { query(call); return; }
        if (!Boolean.TRUE.equals(call.getBoolean("prompt", true))) {
            JSObject o = new JSObject(); o.put("granted", false); call.resolve(o); return;
        }
        requestPermissionForAlias(alias(), call, "afterPermission");
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) { query(call); return; }
        JSObject o = new JSObject(); o.put("granted", false); o.put("denied", true); call.resolve(o);
    }

    private void query(PluginCall call) {
        ContentResolver cr = getContext().getContentResolver();
        Uri src = Build.VERSION.SDK_INT >= 29 ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String[] cols = {
            MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.DISPLAY_NAME, MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.SIZE
        };
        JSArray out = new JSArray();
        try (Cursor c = cr.query(src, cols, MediaStore.Audio.Media.IS_MUSIC + " != 0 AND " + MediaStore.Audio.Media.DURATION + " >= ?", new String[] { String.valueOf(MIN_MS) }, MediaStore.Audio.Media.TITLE + " COLLATE NOCASE")) {
            if (c != null) while (c.moveToNext()) {
                String path = c.getString(1);
                if (path == null || path.isEmpty()) continue;
                JSObject t = new JSObject();
                t.put("mid", c.getLong(0)); t.put("path", path); t.put("name", c.getString(2)); t.put("title", c.getString(3));
                t.put("artist", c.getString(4)); t.put("album", c.getString(5)); t.put("dur", c.getLong(6) / 1000.0); t.put("size", c.getLong(7));
                out.put(t);
            }
        } catch (Exception e) {
            call.reject("Could not read the music on this phone: " + e.getMessage()); return;
        }
        JSObject o = new JSObject(); o.put("granted", true); o.put("tracks", out); call.resolve(o);
    }
}
