package com.norwinlabs.vibe;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app updates from the project's GitHub releases:
 *   info()            -> { versionCode, versionName }
 *   download({ url }) -> saves the release APK to the cache folder, emitting "progress" { percent }
 *   install()         -> hands the downloaded APK to Android's installer (asks once to allow installs from this app)
 * Android only installs an update that is signed with the same key as the installed app, so a tampered file is rejected.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private static final String RELEASES = "https://github.com/NorwinLabs/NorwinVibe/releases/download/";

    private File apk() { return new File(new File(getContext().getCacheDir(), "update"), "NorwinVibe.apk"); }

    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject o = new JSObject();
            o.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
            o.put("versionName", pi.versionName);
            call.resolve(o);
        } catch (Exception e) { call.reject("Could not read the app version"); }
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "");
        if (url == null || !url.startsWith(RELEASES) || !url.endsWith(".apk")) { call.reject("Not a NorwinVibe release file"); return; }
        getBridge().execute(() -> {
            File out = apk(), tmp = new File(out.getParentFile(), "download.part");
            try {
                out.getParentFile().mkdirs(); out.delete();
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection(); // follows GitHub's redirect to its file host
                c.setConnectTimeout(15000); c.setReadTimeout(30000);
                if (c.getResponseCode() != 200) { call.reject("Download failed (" + c.getResponseCode() + ")"); return; }
                long total = c.getContentLengthLong(), got = 0; int last = -1;
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[32768]; int n;
                    while ((n = in.read(buf)) > 0) {
                        fo.write(buf, 0, n); got += n;
                        int pct = total > 0 ? (int) (got * 100 / total) : 0;
                        if (pct != last) { last = pct; JSObject p = new JSObject(); p.put("percent", pct); notifyListeners("progress", p); }
                    }
                }
                if (total > 0 && got != total) { tmp.delete(); call.reject("Download was cut off"); return; }
                if (!tmp.renameTo(out)) { call.reject("Could not save the update"); return; }
                JSObject o = new JSObject(); o.put("size", got); call.resolve(o);
            } catch (Exception e) { tmp.delete(); call.reject("Download failed: " + e.getMessage()); }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        File f = apk();
        if (!f.exists()) { call.reject("No update has been downloaded"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            // one-time switch in Android settings; the user comes back and taps install again
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            JSObject o = new JSObject(); o.put("needsPermission", true); call.resolve(o);
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
