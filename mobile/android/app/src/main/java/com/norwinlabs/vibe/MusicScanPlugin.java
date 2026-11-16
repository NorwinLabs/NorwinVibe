package com.norwinlabs.vibe;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.util.Base64;
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

    /* ---- delete songs from the phone itself ----
       Android 11+: one system "Allow NorwinVibe to delete these songs?" prompt for the whole batch. Android 10: the system asks per song.
       Android 9 and older: deleted straight away when the system lets the app. Songs that are already gone count as deleted. */
    static final int REQ_DELETE = 4242;
    private static PluginCall pendingDelete;
    private static java.util.List<Uri> pendingUris;
    private static java.util.List<String> pendingPaths;

    private Uri audioBase() { return Build.VERSION.SDK_INT >= 29 ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI; }

    @PluginMethod
    public void deleteSongs(PluginCall call) {
        if (pendingDelete != null) { call.reject("Another delete is waiting for an answer"); return; }
        java.util.List<String> paths = new java.util.ArrayList<>(), gone = new java.util.ArrayList<>(), todo = new java.util.ArrayList<>();
        java.util.List<Uri> uris = new java.util.ArrayList<>();
        try { JSArray a = call.getArray("paths"); for (int i = 0; a != null && i < a.length(); i++) paths.add(a.getString(i)); } catch (Exception ignored) { }
        ContentResolver cr = getContext().getContentResolver();
        for (String p : paths) {
            if (p == null || p.isEmpty()) continue;
            Uri u = null;
            try (Cursor c = cr.query(audioBase(), new String[] { MediaStore.Audio.Media._ID }, MediaStore.Audio.Media.DATA + " = ?", new String[] { p }, null)) {
                if (c != null && c.moveToFirst()) u = android.content.ContentUris.withAppendedId(audioBase(), c.getLong(0));
            } catch (Exception ignored) { }
            if (u == null) { if (!new java.io.File(p).exists()) gone.add(p); continue; } // not in the media index: if the file is not there either, it is already gone
            uris.add(u); todo.add(p);
        }
        if (uris.isEmpty()) { finishDelete(call, gone, false); return; }
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                android.app.PendingIntent pi = MediaStore.createDeleteRequest(cr, uris);
                pendingDelete = call; pendingUris = uris; pendingPaths = todo; pendingDone = gone;
                getActivity().startIntentSenderForResult(pi.getIntentSender(), REQ_DELETE, null, 0, 0, 0);
            } else {
                // Android 10 and older: try straight away; on 10 the system may want a yes for each song
                for (int i = 0; i < uris.size(); i++) {
                    try { if (cr.delete(uris.get(i), null, null) > 0) gone.add(todo.get(i)); else if (new java.io.File(todo.get(i)).delete()) gone.add(todo.get(i)); }
                    catch (SecurityException e) {
                        if (Build.VERSION.SDK_INT == 29 && e instanceof android.app.RecoverableSecurityException) {
                            pendingDelete = call; pendingUris = new java.util.ArrayList<>(uris.subList(i, uris.size())); pendingPaths = new java.util.ArrayList<>(todo.subList(i, todo.size())); pendingDone = gone;
                            getActivity().startIntentSenderForResult(((android.app.RecoverableSecurityException) e).getUserAction().getActionIntent().getIntentSender(), REQ_DELETE, null, 0, 0, 0);
                            return;
                        }
                    }
                }
                finishDelete(call, gone, false);
            }
        } catch (Exception e) { pendingDelete = null; finishDelete(call, gone, false); }
    }
    private static java.util.List<String> pendingDone;

    private void finishDelete(PluginCall call, java.util.List<String> deleted, boolean denied) {
        JSObject o = new JSObject(); JSArray a = new JSArray();
        for (String p : deleted) a.put(p);
        o.put("deleted", a); o.put("denied", denied); call.resolve(o);
    }

    /** MainActivity hands the answer to the system's delete prompt here. Returns true when it was ours. */
    static boolean onDeleteResult(Context ctx, int requestCode, int resultCode) {
        if (requestCode != REQ_DELETE || pendingDelete == null) return false;
        PluginCall call = pendingDelete; java.util.List<Uri> uris = pendingUris; java.util.List<String> paths = pendingPaths, done = pendingDone;
        pendingDelete = null; pendingUris = null; pendingPaths = null; pendingDone = null;
        JSObject o = new JSObject(); JSArray a = new JSArray();
        boolean ok = resultCode == android.app.Activity.RESULT_OK;
        if (ok && Build.VERSION.SDK_INT < 30) { // Android 10: the user allowed that song; delete it (the rest, if any, are asked about again by the next tap)
            try { if (ctx.getContentResolver().delete(uris.get(0), null, null) > 0) done.add(paths.get(0)); } catch (Exception ignored) { }
        } else if (ok) done.addAll(paths);
        for (String p : done) a.put(p);
        o.put("deleted", a); o.put("denied", !ok); call.resolve(o);
        return true;
    }

    private String alias() { return Build.VERSION.SDK_INT >= 33 ? "audio" : "storage"; }

    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState(alias()) == PermissionState.GRANTED) { query(call); return; }
        if (!Boolean.TRUE.equals(call.getBoolean("prompt", true))) {
            JSObject o = new JSObject(); o.put("granted", false); call.resolve(o); return;
        }
        requestPermissionForAlias(alias(), call, "afterPermission");
    }

    /** MusicScan.cover({ path }) -> { data: "data:image/jpeg;base64,..." } : the song's embedded cover, read natively (fast, never loads the whole file into the web view). */
    @PluginMethod
    public void cover(PluginCall call) {
        String path = call.getString("path", "");
        JSObject o = new JSObject();
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(path);
            byte[] raw = r.getEmbeddedPicture();
            if (raw != null && raw.length > 0) {
                BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inSampleSize = Math.max(1, Math.max(bounds.outWidth, bounds.outHeight) / 400);
                Bitmap bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
                if (bmp != null) {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                    bmp.compress(Bitmap.CompressFormat.JPEG, 82, out);
                    o.put("data", "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                    bmp.recycle();
                }
            }
        } catch (Exception ignored) {
        } finally { try { r.release(); } catch (Exception ignored) { } }
        call.resolve(o);
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
            MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DATE_ADDED
        };
        JSArray out = new JSArray();
        try (Cursor c = cr.query(src, cols, MediaStore.Audio.Media.IS_MUSIC + " != 0 AND " + MediaStore.Audio.Media.DURATION + " >= ?", new String[] { String.valueOf(MIN_MS) }, MediaStore.Audio.Media.TITLE + " COLLATE NOCASE")) {
            if (c != null) while (c.moveToNext()) {
                String path = c.getString(1);
                if (path == null || path.isEmpty()) continue;
                JSObject t = new JSObject();
                t.put("mid", c.getLong(0)); t.put("path", path); t.put("name", c.getString(2)); t.put("title", c.getString(3));
                t.put("artist", c.getString(4)); t.put("album", c.getString(5)); t.put("dur", c.getLong(6) / 1000.0); t.put("size", c.getLong(7)); t.put("added", c.getLong(8) * 1000L);
                out.put(t);
            }
        } catch (Exception e) {
            call.reject("Could not read the music on this phone: " + e.getMessage()); return;
        }
        JSObject o = new JSObject(); o.put("granted", true); o.put("tracks", out); call.resolve(o);
    }
}
