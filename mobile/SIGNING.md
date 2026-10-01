# Release signing (Android)

NorwinVibe Mobile is a **new app** (`com.norwinlabs.vibe`), so it gets its own **new** key. Don't reuse the
NorwinLabsTools key.

Android only installs an update if it is signed with the same key as the installed app. **If you lose this
key you can never ship an update to anyone who has installed the app**, so back it up somewhere durable.

## 1. Generate the key

Run this yourself. The password must never be pasted into a chat, an issue or a commit. Keep the file
**outside** the repository.

```bash
keytool -genkeypair -v -keystore ../norwinvibe-release.jks -alias norwinvibe-release -keyalg RSA -keysize 4096 -validity 10000
```

## 2. Sign locally (optional)

```bash
cp keystore.properties.example keystore.properties
```

Fill in the real values. `keystore.properties`, `*.jks` and `*.keystore` are git-ignored. Then:

```bash
npm run sync
cd android
./gradlew assembleRelease
```

## 3. Sign on CI

Base64-encode the keystore:

```bash
base64 -w0 ../norwinvibe-release.jks > keystore.b64
```

Add four repository secrets under **Settings > Secrets and variables > Actions**:

| Secret | Value |
| --- | --- |
| `VIBE_KEYSTORE_BASE64` | contents of `keystore.b64` |
| `VIBE_KEYSTORE_PASSWORD` | the store password |
| `VIBE_KEY_ALIAS` | `norwinvibe-release` |
| `VIBE_KEY_PASSWORD` | the key password |

Then delete `keystore.b64`.

The secrets are prefixed `VIBE_` so they can't clash with the NorwinLabsTools ones if you ever share an org-level
secret store. `mobile-release.yml` fails loudly if `VIBE_KEYSTORE_BASE64` is missing instead of publishing an unsigned
APK, so **add these secrets before merging to main**.
