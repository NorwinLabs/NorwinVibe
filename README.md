# NorwinVibe

A floating media player with a spinning record, a needle that tracks the song, lyrics, themes and a theme store.

- **Windows** (this folder): picks up whatever is playing (Spotify, YouTube in a browser, etc.) through the Windows media session.
- **Android** (`mobile/`): plays the music files on your phone. It reuses the same UI code, so themes, the record and needle, lyrics and the store behave the same. See [Phone app](#phone-app-android).

```
npm install
npm start
```

### Install on Windows 10/11

```
npm run dist
```

builds `dist/NorwinVibe-Setup-<version>.exe`, a normal installer: per-user (no admin prompt), lets you pick the folder, adds Start Menu and desktop shortcuts, and shows up under *Settings > Apps* so it can be uninstalled. *Settings > Start with Windows* then works from the installed copy.

- The installer is **unsigned**, so Windows SmartScreen shows "Windows protected your PC" the first time: click *More info > Run anyway*. To remove the warning for everyone, sign the installer with a code-signing certificate (set `CSC_LINK` and `CSC_KEY_PASSWORD` when running `npm run dist`).
- Installed builds ignore `testMode` in `store.config.json`, so the free "Unlock (test)" button never ships. Set `NORWINVIBE_TESTMODE=1` to turn it back on for testing an installed copy.
- `npm run dist:dir` builds just the unpacked app folder (`dist/win-unpacked`) for quick checks.

### Auto-update

Installed copies check for a newer version shortly after launch and every six hours. When one is found it downloads in the background; the version text at the bottom right changes to **Restart to update to vX.Y.Z**. Click it to install and relaunch (silent, no prompts). If you don't, it installs the next time you quit. *Settings > Check for updates* does it on demand. Development runs (`npm start`) never check.

How it works: `.github/workflows/desktop-release.yml` builds the installer on every push to `main` that touches the Windows app, publishes a versioned release (`v<major>.<minor>.<run number>`) and refreshes a rolling release tagged **`desktop-latest`**, which holds `latest.yml` and the installer. The app reads that fixed tag (`build.publish` in `package.json`), so the Android APK releases in the same repo never confuse it.

- The repo must be **public** (or the feed served from somewhere public), because installed copies fetch the files without credentials.
- Updates only happen when the version goes **up**. CI sets the patch number from the run number automatically; edit `major.minor` in `package.json` for bigger releases.
- Test locally by serving a folder with a copy of `dist/latest.yml` (with a higher `version`) and the installer, and starting the packaged app with `NORWINVIBE_UPDATE_URL=http://127.0.0.1:<port>`. **Careful:** clicking *Restart to update* really runs the installer.

### Pin to the taskbar

Install it with the installer first (pinning the dev copy from `npm start` would pin Electron, not NorwinVibe).

1. Start NorwinVibe from the Start menu.
2. Right-click its taskbar button and choose **Pin to taskbar** (on Windows 11 you can also right-click the Start menu entry > *Pin to taskbar*).

Once it is pinned:

- **Click the icon** to bring the player back, including when it is hidden in the tray.
- **Hover the icon** to get Previous / Play-Pause / Next buttons on the preview.
- The icon shows a **progress bar** for the current song (it turns yellow when paused).
- **Right-click the icon** for Play / Pause, Next song and Previous song.
- Pinned icon and running window are the same taskbar entry (they share the app ID in `main.js`, which must match `build.appId` in `package.json`).

## Theme store

Paid packs are defined in `main.js` (`PAID`) and priced in `store.config.json`. Right now there are two packs, **Cyberpunk** and **Night City**, both $0.99.

Licensing is offline and signed: `licensing/public.pem` ships with the app and verifies keys; `.licensing/private.pem` signs them. **Keep the private key secret** (it is git-ignored). To use a different keypair, delete both and run `node scripts/gen-keys.js`.

### Taking real payments
The app never handles card details. It sends the buyer to your checkout page, then unlocks when they paste a license key.

1. Create a payment page with a provider you have an account with (for example a Stripe Payment Link for $0.99).
2. Put its `https://` URL in `store.config.json` as `items.cyberpunk.checkoutUrl`.
3. After each payment, issue a key and send it to the buyer (Stripe can show it on the confirmation page or email it):
   `node scripts/make-license.js cyberpunk "<order id or email>"`
   Automating step 3 needs a small server-side webhook that holds the private key.
4. The buyer opens **Settings > Theme Store**, pastes the key and hits **Redeem**.

### Test mode
The free **Unlock (test)** button is **off** in the committed `store.config.json` (`"testMode": false`), because the release workflows refuse to publish with it on. To use it yourself, set an environment variable: `NORWINVIBE_TESTMODE=1 npm start` on Windows, or `VIBE_TESTMODE=1 npm run sync` when building the phone app locally. Release builds always ship with it off.

### Adding another pack
Add an entry to `PAID` in `main.js` and `store.config.json`, the option values in `ENUMS`, the card in `STORE_UI` in `src/features.js`, plus CSS for the new `data-theme` / `data-record` / `data-needle` / `data-viz` values.

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

### GitHub Actions
Same pattern as NorwinLabsTools:

- `.github/workflows/mobile-ci.yml` runs on `feature/**` pushes and PRs to `main`: installs, builds the web assets, and compiles debug and release APKs. The debug APK is uploaded as a build artifact.
- `.github/workflows/mobile-release.yml` runs on pushes to `main` that touch the phone app or the shared UI (or manually): bumps the build number in `mobile/version.properties`, builds the **signed** release APK, commits the bump back and publishes a GitHub Release tagged `mobile-v<version>-b<build>`.

Before the first release, create the signing key and add the four `VIBE_*` secrets: see [mobile/SIGNING.md](mobile/SIGNING.md).
