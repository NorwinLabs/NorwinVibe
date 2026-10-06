// Builds mobile/www from the SAME UI files the Windows app uses (../src), plus the phone-only pieces in mobile/src.
// Run by `npm run build:web`, and by CI before every Android build.
const fs = require('fs'), path = require('path');

const mobile = path.join(__dirname, '..');
const repo = path.join(mobile, '..');
const shared = path.join(repo, 'src');
const www = path.join(mobile, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'vendor'), { recursive: true });

// 1. shared UI code: copied verbatim, so the desktop and phone apps stay in step
for (const f of ['styles.css', 'features.css', 'titles.js', 'renderer.js', 'features.js', 'pro.js', 'extras.js', 'scratchfx.js', 'dancers.js', 'lrc.js']) fs.copyFileSync(path.join(shared, f), path.join(www, f));
// 2. phone-only code
for (const f of ['mobile.js', 'mobile.css']) fs.copyFileSync(path.join(mobile, 'src', f), path.join(www, f));
// 3. vendored libraries (no CDN at runtime, so the app works offline)
fs.copyFileSync(require.resolve('jsmediatags/dist/jsmediatags.min.js'), path.join(www, 'vendor', 'jsmediatags.min.js'));
fs.copyFileSync(require.resolve('tweetnacl/nacl-fast.min.js'), path.join(www, 'vendor', 'nacl-fast.min.js'));

// 4. theme-store config + the PUBLIC license key (raw Ed25519 key = last 32 bytes of the SPKI DER)
const pem = fs.readFileSync(path.join(repo, 'licensing', 'public.pem'), 'utf8').replace(/-----[^-]+-----|\s/g, '');
const keyHex = Buffer.from(pem, 'base64').subarray(-32).toString('hex');
const storeCfg = JSON.parse(fs.readFileSync(path.join(repo, 'store.config.json'), 'utf8'));
const verProps = fs.readFileSync(path.join(mobile, 'version.properties'), 'utf8');
const verProp = (k) => ((verProps.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '').trim();
const appVersion = `${verProp('VERSION_NAME')}.${verProp('VERSION_CODE')}`; // <major.minor>.<build>, the same as the APK's versionName
fs.writeFileSync(path.join(www, 'config.js'), `window.APP_VERSION=${JSON.stringify(appVersion)};\nwindow.LICENSE_PUBKEY_HEX=${JSON.stringify(keyHex)};\nwindow.STORE_CONFIG=${JSON.stringify(storeCfg)};\n`);

// 5. index.html: the desktop page with the phone's extras injected. Every replace is asserted, so if the
//    desktop markup changes shape the build fails loudly instead of shipping a broken phone UI.
let html = fs.readFileSync(path.join(shared, 'index.html'), 'utf8');
const sub = (from, to) => { if (!html.includes(from)) throw new Error(`sync-web: desktop index.html no longer contains: ${from.slice(0, 60)}`); html = html.replace(from, to); };

html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '<meta http-equiv="Content-Security-Policy" content="default-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:">'); // local content only
sub('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n<meta name="theme-color" content="#0c0c12">');
sub('<link rel="stylesheet" href="features.css">', '<link rel="stylesheet" href="features.css">\n<link rel="stylesheet" href="mobile.css">');
sub('<body>', '<body class="mobile">');
sub('Play something in Spotify, your browser, or any media app', 'Add music from your phone to get started');
sub('    <div class="lyric" id="lyric"></div>', '    <div class="lyric" id="lyric"></div>\n    <button class="act" id="btn-add-cta">Find my music</button>\n    <div class="upnext" id="upnext"></div>');
sub('      <button class="wbtn" id="btn-fav"', '      <button class="wbtn" id="btn-library" title="Music library" aria-label="Music library"><svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13M9 18a3 3 0 11-3-3 3 3 0 013 3zm11-2a3 3 0 11-3-3 3 3 0 013 3z"/></svg></button>\n      <button class="wbtn" id="btn-fav"');
sub('  <!-- theme store -->', `  <!-- music library (phone only) -->
  <div class="pop" id="pop-library">
    <div class="lib-head"><b id="lib-count">Library</b><span class="lib-btns"><button class="act" id="lib-add">Find my music</button><button class="act" id="lib-pick" title="Add individual files">Add files</button></span></div>
    <input id="lib-search" type="search" placeholder="Search songs" spellcheck="false" autocomplete="off">
    <div class="chips tabs" id="lib-tabs"><button data-v="songs" class="on">Songs</button><button data-v="lists">Playlists</button><button data-v="queue">Queue</button></div>
    <div class="act-row" id="lib-actions"><button class="act" id="lib-play-all">Play all</button><button class="act" id="lib-shuffle-all">Shuffle</button></div>
    <div id="lib-list" class="hist"></div>
    <input type="file" id="lib-file" accept="audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav,.aac" multiple hidden>
  </div>

  <!-- equalizer + crossfade (phone, Pro) -->
  <div class="pop" id="pop-eq">
    <h4>Equalizer</h4>
    <button class="sw" id="eq-on"><span>Equalizer</span><i></i></button>
    <div class="chips" id="eq-presets"></div>
    <div id="eq-bands"></div>
    <h4>Crossfade</h4>
    <div class="vol-row"><input type="range" id="xf" min="0" max="12" step="1" value="0"><span id="xf-n">Off</span></div>
    <p class="hint">Blends the end of a song into the next one. Songs shorter than about 2.5 times the fade are left alone.</p>
  </div>

  <!-- theme store -->`);
sub('  <!-- theme store -->', `  <!-- mini player: sits at the bottom while a panel (library, history, settings) is open -->
  <div id="mini-player" aria-label="Now playing">
    <div class="mp-info" role="button" aria-label="Open the player"><div class="mp-art"></div><div class="mp-tx"><b class="mp-title"></b><span class="mp-artist"></span></div></div>
    <button class="mp-btn mp-prev" aria-label="Previous"><svg viewBox="0 0 24 24"><path d="M6 6v12M19 6l-9 6 9 6z"/></svg></button>
    <button class="mp-btn mp-play" aria-label="Play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
    <button class="mp-btn mp-next" aria-label="Next"><svg viewBox="0 0 24 24"><path d="M18 6v12M5 6l9 6-9 6z"/></svg></button>
    <div class="mp-bar"><i></i></div>
  </div>

  <!-- theme store -->`);
sub('<script src="titles.js"></script>', '<script src="vendor/nacl-fast.min.js"></script>\n<script src="vendor/jsmediatags.min.js"></script>\n<script src="config.js"></script>\n<script src="mobile.js"></script>\n<script src="titles.js"></script>');
fs.writeFileSync(path.join(www, 'index.html'), html);

console.log('mobile/www ready');
