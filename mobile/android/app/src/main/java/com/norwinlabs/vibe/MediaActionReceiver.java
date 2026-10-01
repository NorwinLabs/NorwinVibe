package com.norwinlabs.vibe;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Receives the notification and widget buttons and forwards them to the web UI, which owns the playback. */
public class MediaActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        switch (intent.getAction()) {
            case MediaPlaybackService.ACTION_PREV: MediaServicePlugin.dispatch("prev", 0); break;
            case MediaPlaybackService.ACTION_NEXT: MediaServicePlugin.dispatch("next", 0); break;
            case MediaPlaybackService.ACTION_TOGGLE: MediaServicePlugin.dispatch("toggle", 0); break;
            default: break;
        }
    }
}
