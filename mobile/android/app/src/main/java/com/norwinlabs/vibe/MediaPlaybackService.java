package com.norwinlabs.vibe;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Base64;

/**
 * Foreground service (type: mediaPlayback) that keeps the app process, and the music playing in the WebView,
 * alive while the screen is off or the app is in the background.
 *
 * Everyone gets the "now playing" notification. With Pro it is a real media notification (artwork, previous /
 * play-pause / next, a seek bar on the lock screen) backed by a MediaSession, and the home-screen widget is enabled.
 * Button presses are sent back to the web UI through {@link MediaServicePlugin#dispatch}.
 */
public class MediaPlaybackService extends Service {
    private static Context appCtx;
    static final String PREFS = "vibe_media";
    static final String ACTION_PREV = "com.norwinlabs.vibe.PREV";
    static final String ACTION_TOGGLE = "com.norwinlabs.vibe.TOGGLE";
    static final String ACTION_NEXT = "com.norwinlabs.vibe.NEXT";

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 7;
    private static volatile boolean running = false;
    private static MediaSession session;
    private static Bitmap lastArt;
    private static String lastSong = "";
    private static PowerManager.WakeLock wakeLock;

    /** Keeps the CPU awake so audio does not stutter with the screen off, but only while something is actually playing. */
    private static synchronized void setWake(Context ctx, boolean on) {
        if (on) {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NorwinVibe:playback");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);
        } else if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    /** What the web UI tells us about the current song. */
    static final class Params {
        String title = "NorwinVibe", text = "", album = "", art = "";
        boolean playing = false, pro = false;
        long position = 0, duration = 0;
    }

    private static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows what is playing and keeps music going in the background");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private static PendingIntent action(Context ctx, String action, int code) {
        Intent i = new Intent(ctx, MediaActionReceiver.class).setAction(action).setPackage(ctx.getPackageName());
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static Notification.Action act(Context ctx, int icon, String title, String action, int code) {
        return new Notification.Action.Builder(Icon.createWithResource(ctx, icon), title, action(ctx, action, code)).build();
    }

    static Context appContext() { return appCtx; }

    /** One MediaSession shared by the notification, lock screen, headsets and Android Auto. */
    static synchronized MediaSession ensureSession(Context ctx) {
        appCtx = ctx.getApplicationContext();
        if (session == null) {
            session = new MediaSession(appCtx, "NorwinVibe");
            session.setCallback(new MediaSession.Callback() {
                @Override public void onPlay() { MediaServicePlugin.dispatch("play", 0); }
                @Override public void onPause() { MediaServicePlugin.dispatch("pause", 0); }
                @Override public void onSkipToNext() { MediaServicePlugin.dispatch("next", 0); }
                @Override public void onSkipToPrevious() { MediaServicePlugin.dispatch("prev", 0); }
                @Override public void onSeekTo(long pos) { MediaServicePlugin.dispatch("seekTo", pos); }
                @Override public void onPlayFromMediaId(String mediaId, android.os.Bundle extras) { AutoBrowserService.handlePlay(mediaId); }
                @Override public void onPlayFromSearch(String query, android.os.Bundle extras) { MediaServicePlugin.dispatchPlay(null, null, query == null ? "" : query); }
            });
            session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
            session.setActive(true);
        }
        return session;
    }

    /** Pro: keeps the session's song and play state up to date. */
    private static void updateSession(Context ctx, Params p) {
        ensureSession(ctx);
        MediaMetadata.Builder md = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, p.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, p.text)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, p.album)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, p.duration);
        if (lastArt != null) md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, lastArt);
        session.setMetadata(md.build());
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO
                | PlaybackState.ACTION_PLAY_FROM_MEDIA_ID | PlaybackState.ACTION_PLAY_FROM_SEARCH;
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(p.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, p.position, p.playing ? 1f : 0f)
                .build());
    }

    private static void releaseSession() {
        if (AutoBrowserService.alive) return; // Android Auto is still using it
        if (session != null) { try { session.setActive(false); session.release(); } catch (Exception ignored) { } session = null; }
    }

    private static Notification build(Context ctx, Params p) {
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(ctx, CHANNEL_ID) : new Notification.Builder(ctx);
        b.setContentTitle(p.title)
                .setContentText(p.text)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(pi)
                .setOngoing(p.playing)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        // Bluetooth / headset buttons, the notification shade and the lock screen: for everyone
        updateSession(ctx, p);
        if (lastArt != null) b.setLargeIcon(lastArt);
        b.addAction(act(ctx, android.R.drawable.ic_media_previous, "Previous", ACTION_PREV, 1));
        b.addAction(act(ctx, p.playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, p.playing ? "Pause" : "Play", ACTION_TOGGLE, 2));
        b.addAction(act(ctx, android.R.drawable.ic_media_next, "Next", ACTION_NEXT, 3));
        b.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    /** Stores the song for the widget and applies any new artwork. Returns the notification to show. */
    private static Notification apply(Context ctx, Params p) {
        String song = p.title + "\n" + p.text + "\n" + p.album;
        boolean newSong = !song.equals(lastSong);
        lastSong = song;
        if (newSong && (p.art == null || p.art.isEmpty())) lastArt = null; // a song without a cover must not keep the previous song's
        if (p.art != null && !p.art.isEmpty()) {
            try { byte[] raw = Base64.decode(p.art, Base64.DEFAULT); lastArt = BitmapFactory.decodeByteArray(raw, 0, raw.length); } catch (Exception ignored) { }
        }
        SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.putString("title", p.title).putString("artist", p.text).putBoolean("playing", p.playing).putBoolean("pro", p.pro).apply();
        NowPlayingWidget.refreshAll(ctx);
        return build(ctx, p);
    }

    /** Refreshes the notification, session and widget (track change, play / pause, seek) without restarting the service. */
    static void update(Context ctx, Params p) {
        Notification n = apply(ctx, p);
        if (running) setWake(ctx, p.playing);
        if (running) ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID, n);
    }

    static Intent startIntent(Context ctx, Params p) {
        return new Intent(ctx, MediaPlaybackService.class)
                .putExtra("title", p.title).putExtra("text", p.text).putExtra("album", p.album).putExtra("art", p.art)
                .putExtra("playing", p.playing).putExtra("pro", p.pro).putExtra("position", p.position).putExtra("duration", p.duration);
    }

    /* Headphones unplugged / Bluetooth dropped: pause instead of blasting the speaker.
       Calls and other apps: pause (or lower the volume) while they speak, then carry on. */
    private boolean pausedByFocus = false, ducked = false, focusHeld = false;
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(i.getAction())) MediaServicePlugin.dispatch("pause", 0);
        }
    };
    private final AudioManager.OnAudioFocusChangeListener focusListener = (change) -> {
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                pausedByFocus = true; MediaServicePlugin.dispatch("pause", 0); break;
            case AudioManager.AUDIOFOCUS_LOSS:
                pausedByFocus = false; MediaServicePlugin.dispatch("pause", 0); break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                ducked = true; MediaServicePlugin.dispatch("duck", 0); break;
            case AudioManager.AUDIOFOCUS_GAIN:
                if (pausedByFocus) { pausedByFocus = false; MediaServicePlugin.dispatch("play", 0); }
                if (ducked) { ducked = false; MediaServicePlugin.dispatch("unduck", 0); }
                break;
            default: break;
        }
    };

    @SuppressWarnings("deprecation")
    private void takeFocus() {
        if (focusHeld) return;
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (am != null) focusHeld = am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        try { registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)); } catch (Exception ignored) { }
    }

    @SuppressWarnings("deprecation")
    private void dropFocus() {
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (am != null && focusHeld) am.abandonAudioFocus(focusListener);
        focusHeld = false;
        try { unregisterReceiver(noisy); } catch (Exception ignored) { }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Params p = new Params();
        if (intent != null) {
            if (intent.getStringExtra("title") != null) p.title = intent.getStringExtra("title");
            if (intent.getStringExtra("text") != null) p.text = intent.getStringExtra("text");
            if (intent.getStringExtra("album") != null) p.album = intent.getStringExtra("album");
            if (intent.getStringExtra("art") != null) p.art = intent.getStringExtra("art");
            p.playing = intent.getBooleanExtra("playing", true);
            p.pro = intent.getBooleanExtra("pro", false);
            p.position = intent.getLongExtra("position", 0);
            p.duration = intent.getLongExtra("duration", 0);
        }
        ensureChannel(this);
        Notification n = apply(this, p);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIFICATION_ID, n);
        running = true;
        if (p.playing) takeFocus();
        setWake(this, p.playing);
        return START_NOT_STICKY; // if the system kills it there is nothing worth restarting
    }

    @Override
    public void onDestroy() {
        running = false;
        dropFocus();
        releaseSession();
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("playing", false).apply();
        NowPlayingWidget.refreshAll(this);
        setWake(this, false);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
