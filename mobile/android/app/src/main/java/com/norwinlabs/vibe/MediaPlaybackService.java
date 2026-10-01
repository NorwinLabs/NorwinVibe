package com.norwinlabs.vibe;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Foreground service (type: mediaPlayback) that keeps the app process, and the music playing in the WebView,
 * alive while the screen is off or the app is in the background. It shows the "now playing" notification.
 */
public class MediaPlaybackService extends Service {
    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 7;
    private static volatile boolean running = false;
    private PowerManager.WakeLock wakeLock;

    private static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows what is playing and keeps music going in the background");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private static Notification build(Context ctx, String title, String text) {
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(ctx, CHANNEL_ID) : new Notification.Builder(ctx);
        return b.setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .build();
    }

    /** Refreshes the notification text (e.g. on a track change) without needing to start the service again. */
    static void update(Context ctx, String title, String text) {
        if (!running) return;
        ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID, build(ctx, title, text));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null && intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "NorwinVibe";
        String text = intent != null && intent.getStringExtra("text") != null ? intent.getStringExtra("text") : "Playing";
        ensureChannel(this);
        Notification n = build(this, title, text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIFICATION_ID, n);
        running = true;
        if (wakeLock == null) { // keeps the CPU awake so audio does not stutter with the screen off
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NorwinVibe:playback");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
        return START_NOT_STICKY; // if the system kills it there is nothing worth restarting
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
