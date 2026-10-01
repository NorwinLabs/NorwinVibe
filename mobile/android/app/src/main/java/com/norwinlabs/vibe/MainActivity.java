package com.norwinlabs.vibe;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaServicePlugin.class); // must happen before super.onCreate
        super.onCreate(savedInstanceState);
    }
}
