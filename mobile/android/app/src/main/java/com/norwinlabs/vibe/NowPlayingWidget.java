package com.norwinlabs.vibe;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

/** Home-screen widget: what is playing, with previous / play-pause / next. A Pro feature; without Pro it invites you to upgrade. */
public class NowPlayingWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, NowPlayingWidget.class));
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    private static PendingIntent broadcast(Context ctx, String action, int code) {
        Intent i = new Intent(ctx, MediaActionReceiver.class).setAction(action).setPackage(ctx.getPackageName());
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static RemoteViews build(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(MediaPlaybackService.PREFS, Context.MODE_PRIVATE);
        boolean pro = p.getBoolean("pro", false);
        boolean playing = p.getBoolean("playing", false);
        String title = p.getString("title", "");
        String artist = p.getString("artist", "");

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_now_playing);
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.widget_info, PendingIntent.getActivity(ctx, 100, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        if (!pro) {
            v.setTextViewText(R.id.widget_title, "NorwinVibe Pro");
            v.setTextViewText(R.id.widget_artist, "Tap to unlock the widget");
            v.setViewVisibility(R.id.widget_controls, View.GONE);
            return v;
        }
        v.setTextViewText(R.id.widget_title, title.isEmpty() ? "Nothing playing" : title);
        v.setTextViewText(R.id.widget_artist, artist.isEmpty() ? "Open NorwinVibe to start" : artist);
        v.setViewVisibility(R.id.widget_controls, View.VISIBLE);
        v.setImageViewResource(R.id.widget_toggle, playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
        v.setOnClickPendingIntent(R.id.widget_prev, broadcast(ctx, MediaPlaybackService.ACTION_PREV, 11));
        v.setOnClickPendingIntent(R.id.widget_toggle, broadcast(ctx, MediaPlaybackService.ACTION_TOGGLE, 12));
        v.setOnClickPendingIntent(R.id.widget_next, broadcast(ctx, MediaPlaybackService.ACTION_NEXT, 13));
        return v;
    }
}
