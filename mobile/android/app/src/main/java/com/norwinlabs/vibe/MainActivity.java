package com.norwinlabs.vibe;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private String insetsJs = "";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaServicePlugin.class); // must happen before super.onCreate
        registerPlugin(MusicScanPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);

        // Edge to edge: the app draws behind the status bar, the camera cut-out and the navigation bar, so the player fills the
        // whole screen. The page keeps its buttons clear of them using the --sat / --sab / --sal / --sar variables set below.
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) { window.setNavigationBarContrastEnforced(false); window.setStatusBarContrastEnforced(false); } // no grey scrim behind the bars
        if (Build.VERSION.SDK_INT >= 28) window.getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(false); bars.setAppearanceLightNavigationBars(false); // the app is dark: light icons

        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, windowInsets) -> {
            Insets sys = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            boolean keyboard = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
            v.setPadding(0, 0, 0, keyboard ? ime.bottom : 0); // with the keyboard up the page shrinks to fit above it
            float d = getResources().getDisplayMetrics().density;
            insetsJs = String.format(Locale.US,
                "(function(s){s.setProperty('--sat','%.1fpx');s.setProperty('--sab','%.1fpx');s.setProperty('--sal','%.1fpx');s.setProperty('--sar','%.1fpx');})(document.documentElement.style)",
                sys.top / d, keyboard ? 0f : sys.bottom / d, sys.left / d, sys.right / d);
            applyInsets();
            return WindowInsetsCompat.CONSUMED;
        });
        getBridge().addWebViewListener(new WebViewListener() {
            @Override public void onPageLoaded(WebView webView) { applyInsets(); } // the page (re)loaded: give it the numbers again
        });
    }

    private void applyInsets() {
        if (insetsJs.isEmpty() || getBridge() == null || getBridge().getWebView() == null) return;
        final WebView wv = getBridge().getWebView();
        wv.post(() -> wv.evaluateJavascript(insetsJs, null));
    }
}
