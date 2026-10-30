package com.norwinlabs.vibe;

import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Set;

/**
 * "Start my music when I get in the car": fires when a Bluetooth device connects. If the device is the car (one the user picked in
 * Settings, or with nothing picked, any paired device that identifies itself as car audio / hands-free) the web UI is told to start
 * playing on shuffle. Settings are mirrored here by MediaServicePlugin.carSet so this works while the app is closed.
 */
public class CarReceiver extends BroadcastReceiver {
    static final String PREFS = "vibe_car";
    private static final long QUIET_MS = 90 * 1000; // a car that reconnects a few times in a row only starts the music once

    static boolean looksLikeCar(BluetoothDevice d) {
        try {
            BluetoothClass c = d.getBluetoothClass();
            if (c == null) return false;
            int k = c.getDeviceClass();
            return k == BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO || k == BluetoothClass.Device.AUDIO_VIDEO_HANDSFREE;
        } catch (SecurityException e) { return false; } // Bluetooth permission not granted yet
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !BluetoothDevice.ACTION_ACL_CONNECTED.equals(intent.getAction())) return;
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!sp.getBoolean("on", false)) return;
        BluetoothDevice d = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class) : intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
        if (d == null) return;
        Set<String> picked = sp.getStringSet("addrs", null);
        boolean match = picked != null && !picked.isEmpty() ? picked.contains(d.getAddress()) : looksLikeCar(d);
        if (!match) return;
        long now = System.currentTimeMillis();
        if (now - sp.getLong("last", 0) < QUIET_MS) return;
        sp.edit().putLong("last", now).apply();
        MediaServicePlugin.dispatchCar(ctx.getApplicationContext(), "bt");
    }
}
