package com.norwinlabs.vibe;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaServicePlugin.class); // must happen before super.onCreate
        registerPlugin(MusicScanPlugin.class);
        super.onCreate(savedInstanceState);

        // Android 15 draws apps edge-to-edge, which slid the status bar over the top buttons and made them hard to tap.
        // Keep the web view clear of the status bar, camera cut-out and gesture bar.
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
