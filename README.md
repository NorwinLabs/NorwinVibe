# NorwinVibe

A floating media player with a spinning record, a needle that tracks the song, synced lyrics and themes.

- **Windows** (this folder): picks up whatever is playing (Spotify, YouTube in a browser, etc.) through the Windows media session.
- **Android** (`mobile/`): plays the music files on your phone. It reuses the same UI code, so themes, the record and needle and lyrics look and behave the same. See [Phone app](#phone-app-android).

```
npm install
npm start
```

### Install on Windows 10/11

```
npm run dist
```

builds `dist/NorwinVibe-Setup.exe`, a normal installer: per-user (no admin prompt), lets you pick the folder, adds Start Menu and desktop shortcuts, and shows up under *Settings > Apps* so it can be uninstalled. *Settings > Start with Windows* then works from the installed copy.

- Windows SmartScreen may show "Windows protected your PC" the first time you run the installer: click *More info > Run anyway*.
- `npm run dist:dir` builds just the unpacked app folder (`dist/win-unpacked`) for quick checks.

### Updates

Installed copies check for a newer version shortly after launch and every six hours. When one is found it downloads in the background; the version text at the bottom right changes to **Restart to update to vX.Y.Z**. Click it to install and relaunch. If you don't, it installs the next time you quit. *Settings > Check for updates* does it on demand. Development runs (`npm start`) never check.

### Pin to the taskbar

Install it with the installer first (pinning the dev copy from `npm start` would pin Electron, not NorwinVibe).

1. Start NorwinVibe from the Start menu.
2. Right-click its taskbar button and choose **Pin to taskbar** (on Windows 11 you can also right-click the Start menu entry > *Pin to taskbar*).

Once it is pinned:

- **Click the icon** to bring the player back, including when it is hidden in the tray.
- **Hover the icon** to get Previous / Play-Pause / Next buttons on the preview.
- The icon shows a **progress bar** for the current song (it turns yellow when paused).
- **Right-click the icon** for Play / Pause, Next song and Previous song.

## Phone app (Android)

Lives in `mobile/` and is built with [Capacitor](https://capacitorjs.com). The Windows app is unchanged.

- **Plays your own files:** tap *Add music* and pick songs (MP3, M4A, FLAC, OGG, WAV...). Tags and cover art are read from the files and the library is kept on the phone.
- **Same UI:** `mobile/scripts/sync-web.js` copies the desktop UI files from `src/` into the phone build, so the two stay in step. A change to the desktop UI is picked up by the phone app automatically.
- **Plays with the screen off** using a foreground "now playing" service.
- **Not on the phone:** the Windows-only bits (reading other apps' playback, tray, hotkeys, edge snapping).

```
cd mobile
npm install
npm run android:debug     # builds mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Needs Node 20+, JDK 21 and the Android SDK (platform 35). Copy the APK to a phone, or open `mobile/android` in Android Studio and press Run.
