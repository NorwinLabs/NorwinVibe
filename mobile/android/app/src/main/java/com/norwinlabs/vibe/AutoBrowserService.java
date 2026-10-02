package com.norwinlabs.vibe;

import android.content.Context;
import android.media.MediaDescription;
import android.media.browse.MediaBrowser;
import android.media.session.MediaSession;
import android.os.Bundle;
import android.os.Process;
import android.service.media.MediaBrowserService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Android Auto (and Google Assistant) media browsing. The web UI pushes a snapshot of the library and playlists
 * ({ songs: [{id, t, a}], lists: [{id, name, ids}] }) and this service turns it into a browse tree: Songs and Playlists.
 * Picking something in the car goes through the MediaSession callbacks (see MediaPlaybackService) to the web UI,
 * which is what actually plays the music. Pro only: for free users the web UI pushes an empty snapshot.
 */
public class AutoBrowserService extends MediaBrowserService {
    private static final String ROOT = "root", SONGS = "songs", LISTS = "lists";
    private static final String SEP = "\u0001";
    private static final String PREFS = "vibe_auto";
    private static volatile String snapshot = "";
    static volatile boolean alive = false;
    private static AutoBrowserService instance;

    /** Called by the plugin when the web UI has a new library snapshot. */
    static void setSnapshot(Context ctx, String json) {
        snapshot = json == null ? "" : json;
        ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("snap", snapshot).apply();
        AutoBrowserService s = instance;
        if (s != null) { s.notifyChildrenChanged(ROOT); s.notifyChildrenChanged(SONGS); s.notifyChildrenChanged(LISTS); }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        alive = true;
        if (snapshot.isEmpty()) snapshot = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("snap", "");
        MediaSession s = MediaPlaybackService.ensureSession(this);
        setSessionToken(s.getSessionToken());
    }

    @Override
    public void onDestroy() {
        alive = false;
        if (instance == this) instance = null;
        super.onDestroy();
    }

    private boolean trusted(String pkg, int uid) {
        if (uid == Process.myUid() || uid == Process.SYSTEM_UID) return true;
        return getPackageName().equals(pkg) || "com.google.android.projection.gearhead".equals(pkg) || "com.google.android.googlequicksearchbox".equals(pkg)
                || "com.google.android.carassistant".equals(pkg) || "com.google.android.apps.automotive.templates.host".equals(pkg) || "com.android.systemui".equals(pkg)
                || "com.google.android.autosimulator".equals(pkg);
    }

    @Override
    public BrowserRoot onGetRoot(String clientPackageName, int clientUid, Bundle rootHints) {
        return trusted(clientPackageName, clientUid) ? new BrowserRoot(ROOT, null) : null;
    }

    private static MediaBrowser.MediaItem item(String id, String title, String sub, boolean playable) {
        MediaDescription d = new MediaDescription.Builder().setMediaId(id).setTitle(title).setSubtitle(sub).build();
        return new MediaBrowser.MediaItem(d, playable ? MediaBrowser.MediaItem.FLAG_PLAYABLE : MediaBrowser.MediaItem.FLAG_BROWSABLE);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowser.MediaItem>> result) {
        List<MediaBrowser.MediaItem> out = new ArrayList<>();
        try {
            JSONObject o = snapshot.isEmpty() ? new JSONObject() : new JSONObject(snapshot);
            JSONArray songs = o.optJSONArray("songs"), lists = o.optJSONArray("lists");
            if (ROOT.equals(parentId)) {
                if (songs != null && songs.length() > 0) out.add(item(SONGS, "Songs", songs.length() + " songs", false));
                if (lists != null && lists.length() > 0) out.add(item(LISTS, "Playlists", lists.length() + " playlists", false));
            } else if (SONGS.equals(parentId) && songs != null) {
                for (int i = 0; i < songs.length() && i < 300; i++) {
                    JSONObject t = songs.getJSONObject(i);
                    out.add(item("S" + t.getString("id"), t.optString("t"), t.optString("a"), true));
                }
            } else if (LISTS.equals(parentId) && lists != null) {
                for (int i = 0; i < lists.length(); i++) {
                    JSONObject l = lists.getJSONObject(i);
                    JSONArray ids = l.optJSONArray("ids");
                    out.add(item("L" + l.getString("id"), l.optString("name"), ids == null ? "" : ids.length() + " songs", false));
                }
            } else if (parentId.startsWith("L") && lists != null) {
                String lid = parentId.substring(1);
                Map<String, JSONObject> byId = new HashMap<>();
                if (songs != null) for (int i = 0; i < songs.length(); i++) { JSONObject t = songs.getJSONObject(i); byId.put(t.getString("id"), t); }
                for (int i = 0; i < lists.length(); i++) {
                    JSONObject l = lists.getJSONObject(i);
                    if (!lid.equals(l.getString("id"))) continue;
                    JSONArray ids = l.optJSONArray("ids");
                    for (int k = 0; ids != null && k < ids.length() && k < 200; k++) {
                        JSONObject t = byId.get(ids.getString(k));
                        if (t == null) continue;
                        out.add(item("T" + lid + SEP + t.getString("id"), t.optString("t"), t.optString("a"), true));
                    }
                }
            }
        } catch (Exception ignored) { }
        result.sendResult(out);
    }

    /** A song picked in the car: "S" + songId from the Songs list, or "T" + listId + SEP + songId from inside a playlist. */
    static void handlePlay(String mediaId) {
        if (mediaId == null || mediaId.length() < 2) return;
        if (mediaId.charAt(0) == 'S') MediaServicePlugin.dispatchPlay(mediaId.substring(1), null, null);
        else if (mediaId.charAt(0) == 'T') {
            int k = mediaId.indexOf(SEP);
            if (k > 1) MediaServicePlugin.dispatchPlay(mediaId.substring(k + 1), mediaId.substring(1, k), null);
        }
    }
}
