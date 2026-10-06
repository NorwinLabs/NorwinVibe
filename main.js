const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, session, desktopCapturer,
  globalShortcut, Notification, net, shell, dialog, powerMonitor,
} = require('electron');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const { createObsServer } = require('./lib/obs.js');
const { DiscordRpc } = require('./lib/discord.js');
const { createFader } = require('./lib/fade.js');
const { createEmulator } = require('./lib/emulate.js');
const { pickBest } = require('./src/lrc.js');
const { cleanMeta } = require('./src/titles.js');
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const APP_ID = 'com.norwinlabs.vibe.desktop'; // must equal build.appId in package.json
app.setAppUserModelId(APP_ID);

const SIZES = { full: { w: 360, h: 560 }, mini: { w: 450, h: 176 } };
const ICON = path.join(__dirname, 'assets', 'icon.png');
const DEFAULTS = { pin: true, mini: false, theme: 'art', record: 'vinyl', needle: 'classic', viz: 'bars', speed: 'slow', bgart: 'cover',
  autotheme: false, autoDay: 'art', autoEve: 'retro', autoNight: 'midnight', fadeout: false, screensaver: false, ssMin: '5', obs: false, discord: false, smartshuffle: false, deck3d: false, dancers: true, dancerpack: 'people', deckskin: 'dark', deckmove: true, scratchfx: true, lyrics: true, toasts: true, fade: false, snap: true, autostart: false };
const THEMES = ['art', 'midnight', 'retro', 'neon', 'cyberpunk', 'nightcity'];
const ENUMS = {
  bgart: ['cover', 'soft', 'off'],
  autoDay: THEMES, autoEve: THEMES, autoNight: THEMES, ssMin: ['1', '3', '5', '10'],
  speed: ['slow', 'relaxed', '33', '45'],
  theme: ['art', 'midnight', 'retro', 'neon', 'cyberpunk', 'nightcity'],
  record: ['vinyl', 'color', 'album', 'cd', 'cyber', 'nightcity'],
  dancerpack: ['people', 'robots', 'aliens'],
  deckskin: ['dark', 'wood', 'neon'],
  needle: ['classic', 'gold', 'minimal', 'cyber', 'nightcity'],
  viz: ['bars', 'dots', 'wave', 'off', 'cyber', 'nightcity'],
};
// Paid packs: which option values each one unlocks. Ownership is only ever granted here in the main process.
const PAID = {
  cyberpunk: { theme: ['cyberpunk'], record: ['cyber'], needle: ['cyber'], viz: ['cyber'] },
  nightcity: { theme: ['nightcity'], record: ['nightcity'], needle: ['nightcity'], viz: ['nightcity'] },
};
const PUBLIC_KEY = (() => { try { return fs.readFileSync(path.join(__dirname, 'licensing', 'public.pem')); } catch { return null; } })();
const storeCfg = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'store.config.json'), 'utf8')); } catch { return { items: {} }; } };
const BOOLS = ['lyrics', 'toasts', 'fade', 'snap', 'autostart', 'autotheme', 'fadeout', 'screensaver', 'obs', 'discord', 'smartshuffle', 'deck3d', 'dancers', 'scratchfx', 'deckmove'];
const PRO_KEYS = new Set(['autotheme', 'autoDay', 'autoEve', 'autoNight', 'fadeout', 'screensaver', 'ssMin', 'obs', 'discord', 'smartshuffle']); // only settable with a Pro license

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const loadPrefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch { return {}; } };
const savePrefs = () => { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch {} };

let win, helper, tray, quitting = false, full = false, normalBounds = null;
let prefs = {};
const pref = (k) => (k in prefs ? prefs[k] : DEFAULTS[k]);

/* ---------- entitlements ----------
   What you own is derived ONLY from signed license keys (prefs.licenses), re-verified against the public key every time.
   Editing prefs.json can't grant anything, and keys can't be forged without the private key (.licensing/private.pem).
   Items: a theme pack id, "pro" (Pro features + every pack) and "dev" (developer mode: everything + the Developer panel). */
const PACK_IDS = Object.keys(PAID);
const KNOWN_ITEMS = new Set([...PACK_IDS, 'pro', 'dev']);
const STORE_IDS = ['pro', ...PACK_IDS]; // what the Theme Store sells, in display order ('dev' is never sold)
let entitled = new Set(), devActive = false;
function verifyLicense(key) { // key = base64url(payload) + '.' + base64url(ed25519 signature); returns the payload or null
  try {
    if (!PUBLIC_KEY) return null;
    const [p, sig] = String(key).trim().split('.');
    const payload = Buffer.from(p, 'base64url');
    if (!crypto.verify(null, payload, PUBLIC_KEY, Buffer.from(sig, 'base64url'))) return null;
    const o = JSON.parse(payload.toString());
    if (!KNOWN_ITEMS.has(o.item)) return null;
    if (o.exp && Date.now() > o.exp) return null; // expired
    return o;
  } catch { return null; }
}
function recompute() {
  const real = new Set();
  for (const k of Array.isArray(prefs.licenses) ? prefs.licenses : []) { const o = verifyLicense(k); if (o) real.add(o.item); }
  devActive = real.has('dev');
  const set = new Set();
  if (devActive && prefs.devAsFree) set.add('dev'); // developer pretending to be a free user, to test the locked experience
  else {
    real.forEach((i) => set.add(i));
    if (devActive) set.add('pro');
    if (set.has('pro')) PACK_IDS.forEach((i) => set.add(i)); // Pro includes every theme pack
  }
  entitled = set;
  if (win) syncProServices(); // a license being added, removed or expiring starts or stops the Pro services
}
const entitlementList = () => [...entitled];
const allowed = (k, v) => { // is this option value free, or unlocked by something the user holds a valid license for?
  for (const [id, u] of Object.entries(PAID)) if (u[k] && u[k].includes(v)) return entitled.has(id);
  return true;
};
function dropLockedChoices() { for (const k of Object.keys(ENUMS)) if (k in prefs && !allowed(k, prefs[k])) delete prefs[k]; }
function addLicense(key) {
  const o = verifyLicense(key); if (!o) return null;
  const k = String(key).trim(), list = Array.isArray(prefs.licenses) ? prefs.licenses : [];
  if (!list.includes(k)) list.push(k);
  prefs.licenses = list; savePrefs(); recompute();
  toRenderer('store:owned', entitlementList());
  return o;
}

const rawSend = (c) => { if (helper?.stdin.writable) helper.stdin.write(c + '\n'); };
const emu = createEmulator(rawSend); // repeat + shuffle for players (YouTube...) that do not offer them
const sendCmd = (c) => { if (!emu.cmd(c)) rawSend(c); };
const toRenderer = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

function clampToScreen(x, y, w, h) {
  const wa = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
  return {
    x: Math.min(Math.max(x, wa.x), wa.x + wa.width - w),
    y: Math.min(Math.max(y, wa.y), wa.y + wa.height - h),
  };
}

/* ---------- window / tray ---------- */
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
const toggleVisible = () => (win.isVisible() ? win.hide() : showWindow());

function setPin(on) {
  win.setAlwaysOnTop(!!on, 'screen-saver');
  prefs.pin = !!on; savePrefs();
  toRenderer('win:pin-changed', !!on);
}

function applyAutostart() {
  try { app.setLoginItemSettings({ openAtLogin: !!pref('autostart'), path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] }); } catch {}
}

/* ---------- taskbar: thumbnail buttons, progress on the icon, jump list ---------- */
// Tiny white glyphs drawn from shapes, so there are no extra image files to ship.
function glyph(kind) {
  const N = 32, buf = Buffer.alloc(N * N * 4);
  const inTri = (x, y, a, b, c) => {
    const d = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
    const p = [x, y], d1 = d(p, a, b), d2 = d(p, b, c), d3 = d(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const on = (x, y) => {
    if (kind === 'play') return inTri(x, y, [9, 6], [9, 26], [25, 16]);
    if (kind === 'pause') return (x >= 8 && x <= 13 || x >= 19 && x <= 24) && y >= 7 && y <= 25;
    if (kind === 'prev') return (x >= 7 && x <= 10 && y >= 7 && y <= 25) || inTri(x, y, [25, 6], [25, 26], [11, 16]);
    return (x >= 22 && x <= 25 && y >= 7 && y <= 25) || inTri(x, y, [7, 6], [7, 26], [21, 16]); // next
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!on(x + .5, y + .5)) continue;
    const o = (y * N + x) * 4; buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 255; // BGRA, opaque white
  }
  return nativeImage.createFromBitmap(buf, { width: N, height: N });
}
let thumbIcons = null, thumbPlaying = null, lastProgress = null;
function updateThumbar(playing) {
  if (!win || win.isDestroyed()) return;
  thumbIcons = thumbIcons || { prev: glyph('prev'), play: glyph('play'), pause: glyph('pause'), next: glyph('next') };
  thumbPlaying = playing;
  win.setThumbarButtons([
    { tooltip: 'Previous', icon: thumbIcons.prev, click: () => sendCmd('prev') },
    { tooltip: playing ? 'Pause' : 'Play', icon: playing ? thumbIcons.pause : thumbIcons.play, click: () => sendCmd('toggle') },
    { tooltip: 'Next', icon: thumbIcons.next, click: () => sendCmd('next') },
  ]);
}
function onMedia(m) { // keeps the taskbar in step with what is playing
  if (m.type !== 'state' || !win || win.isDestroyed()) return;
  const playing = !!(m.active && m.playing);
  if (playing !== thumbPlaying) updateThumbar(playing);
  const frac = m.active && m.dur > 0 ? Math.min(1, Math.max(0, m.pos / m.dur)) : -1;
  const key = `${Math.round(frac * 200)}|${playing}`; // ~0.5% steps
  if (key === lastProgress) return;
  lastProgress = key;
  win.setProgressBar(frac, { mode: frac < 0 ? 'none' : playing ? 'normal' : 'paused' });
}
function setJumpList() { // right-click the taskbar icon: quick actions. They run the app again with --cmd=..., which the running copy handles.
  if (!app.isPackaged) return; // in development process.execPath is electron.exe, not this app
  const task = (title, cmd) => ({ program: process.execPath, arguments: `--cmd=${cmd}`, iconPath: process.execPath, iconIndex: 0, title, description: title });
  app.setUserTasks([task('Play / Pause', 'toggle'), task('Next song', 'next'), task('Previous song', 'prev')]);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }));
  tray.setToolTip('NorwinVibe');
  const build = () => Menu.buildFromTemplate([
    { label: win.isVisible() ? 'Hide player' : 'Show player', click: toggleVisible },
    { type: 'separator' },
    { label: 'Play / Pause', click: () => sendCmd('toggle') },
    { label: 'Next', click: () => sendCmd('next') },
    { label: 'Previous', click: () => sendCmd('prev') },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: pref('pin'), click: (i) => setPin(i.checked) },
    { label: 'Click-through', type: 'checkbox', checked: ghost, click: (i) => setGhost(i.checked) },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.on('click', toggleVisible);
  tray.on('right-click', () => tray.popUpContextMenu(build()));
}

function createWindow() {
  prefs = loadPrefs();
  delete prefs.owned; // older builds trusted a plain flag in this file; entitlements now come only from signed keys
  recompute(); dropLockedChoices();
  const size = pref('mini') ? SIZES.mini : SIZES.full;
  const wa = screen.getPrimaryDisplay().workArea;
  const pos = clampToScreen(prefs.x ?? wa.x + wa.width - size.w - 20, prefs.y ?? wa.y + wa.height - size.h - 20, size.w, size.h);

  win = new BrowserWindow({
    ...pos, width: size.w, height: size.h,
    frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, backgroundColor: '#00000000', alwaysOnTop: pref('pin'),
    title: 'NorwinVibe', icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  if (pref('pin')) win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.once('did-finish-load', () => { updateThumbar(false); setJumpList(); });
  win.on('show', () => { if (thumbPlaying !== null) updateThumbar(thumbPlaying); }); // Windows drops them when the window is hidden

  win.on('moved', () => {
    if (full) return;
    let [x, y] = win.getPosition();
    const [w, h] = win.getSize();
    if (pref('snap')) { // magnetic edges: snap flush (8px margin) when released within 28px
      const wa = screen.getDisplayMatching(win.getBounds()).workArea, m = 8, T = 28;
      if (Math.abs(x - wa.x) < T) x = wa.x + m;
      if (Math.abs(x + w - (wa.x + wa.width)) < T) x = wa.x + wa.width - w - m;
      if (Math.abs(y - wa.y) < T) y = wa.y + m;
      if (Math.abs(y + h - (wa.y + wa.height)) < T) y = wa.y + wa.height - h - m;
      win.setPosition(x, y);
    }
    prefs.x = x; prefs.y = y; savePrefs();
  });
}

/* ---------- media helper ---------- */
function startHelper() {
  helper = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', path.join(__dirname, 'native', 'smtc.ps1').replace('app.asar', 'app.asar.unpacked'),
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

  readline.createInterface({ input: helper.stdout }).on('line', (line) => {
    try {
      let msg = JSON.parse(line);
      if (msg.type === 'state') msg = emu.state(msg);
      toRenderer(msg.type === 'art' ? 'media:art' : 'media:state', msg);
      onMedia(msg);
      trackMedia(msg);
    } catch (e) { if (!(e instanceof SyntaxError)) console.error('[media]', e); } // bad JSON lines are ignored; real errors are not
  });
  helper.stderr.on('data', (d) => console.error('[smtc]', String(d).trim()));
  helper.stdin.on('error', () => {});
  helper.on('exit', () => { if (!quitting) setTimeout(startHelper, 2000); });
}

/* ---------- Pro services: OBS overlay, Discord status, screensaver, sleep fade-out ----------
   Everything here checks entitled.has('pro') live, so it stops as soon as a license lapses or is removed. */
const BROWSER_RE = /chrome|edge|msedge|firefox|brave|opera|vivaldi|arc/i;
let lastState = null, lastStateAt = 0, lastArt = null, lastVol = 1;
function displayOf(m) { // same title tidy-up the player shows for browser videos
  if (m && BROWSER_RE.test(m.app || '')) { const c = cleanMeta(m.title, m.artist, m.dur); return { title: c.title, artist: c.artist }; }
  return { title: (m && m.title) || '', artist: (m && m.artist) || '' };
}
function trackMedia(msg) {
  if (msg.type === 'art') {
    const m = /^data:([^;]+);base64,(.+)$/.exec(msg.data || '');
    if (m) lastArt = { key: msg.key, mime: m[1], bytes: Buffer.from(m[2], 'base64') };
    return;
  }
  if (msg.type !== 'state') return;
  lastState = msg; lastStateAt = Date.now();
  if (typeof msg.vol === 'number') lastVol = msg.vol;
  discordTick();
}
const proCfg = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'pro.config.json'), 'utf8')); } catch { return {}; } };

const obs = createObsServer(() => {
  const m = lastState, d = displayOf(m), active = !!(m && m.active);
  const pos = active ? Math.min(m.dur > 0 ? m.dur : Infinity, m.pos + (m.playing ? (Date.now() - lastStateAt) / 1000 : 0)) : 0;
  const hasArt = !!(lastArt && m && lastArt.key === m.key && !lastArt.rejected);
  return { state: { active, playing: !!(m && m.playing), title: d.title, artist: d.artist, album: (m && m.album) || '', pos, dur: (m && m.dur) || 0, artKey: (m && m.key) || '', hasArt }, art: hasArt ? lastArt : null };
});
let obsInfo = null, obsError = '';

let discord = null, discordState = 'off', discordSig = '', discordAt = 0, discordTimer = null;
function discordActivity(m) {
  if (!m || !m.active) return null;
  const d = displayOf(m), act = { type: 2, details: (d.title || 'Unknown title').slice(0, 128), instance: false };
  if (m.playing && m.dur > 0) {
    const start = Math.round(Date.now() / 1000 - m.pos);
    act.state = (d.artist || '').slice(0, 128) || undefined;
    act.timestamps = { start, end: start + Math.round(m.dur) };
  } else act.state = `Paused${d.artist ? ' \u00b7 ' + d.artist : ''}`.slice(0, 128);
  return act;
}
function discordTick() { // sends an update when the song / play state / position changes, at most once every 4 seconds
  if (!discord) return;
  const m = lastState, act = discordActivity(m);
  const sig = !act ? 'none' : act.timestamps ? `${m.key}|play|${Math.round(act.timestamps.start / 3)}` : `${m.key}|paused`;
  if (sig === discordSig) return;
  const wait = 4000 - (Date.now() - discordAt);
  if (wait > 0) { clearTimeout(discordTimer); discordTimer = setTimeout(discordTick, wait + 50); return; }
  discordSig = sig; discordAt = Date.now(); discord.setActivity(act);
}
const proStatus = () => ({ obs: obsInfo ? { url: obsInfo.url } : obsError ? { error: obsError } : null, discord: { state: discordState } });
const pushProStatus = () => toRenderer('pro:status', proStatus());
async function syncProServices() {
  const pro = entitled.has('pro');
  if (pro && pref('obs')) {
    if (!obs.running) { try { obsInfo = await obs.start(17773); obsError = ''; } catch (e) { obsInfo = null; obsError = e.code === 'EADDRINUSE' ? 'ports 17773 to 17778 are all in use' : String(e.message).slice(0, 80); } }
  } else if (obs.running) { await obs.stop(); obsInfo = null; obsError = ''; }

  const id = String(proCfg().discordClientId || '').trim();
  if (pro && pref('discord')) {
    if (!/^\d{17,20}$/.test(id)) { if (discord) { discord.stop(); discord = null; } discordState = 'no-id'; }
    else if (!discord) {
      discord = new DiscordRpc({ clientId: id, pipes: process.env.NORWINVIBE_DISCORD_PIPE ? [process.env.NORWINVIBE_DISCORD_PIPE] : null });
      discord.on('state', (st) => { discordState = st === 'idle' ? 'off' : st; pushProStatus(); });
      discordSig = ''; discordState = 'connecting'; discord.start(); discordTick();
    }
  } else { if (discord) { discord.stop(); discord = null; } discordState = 'off'; }
  pushProStatus();
}

/* screensaver: Ambient mode when the whole computer has been idle and music is playing */
let ssActive = false, ssHidden = false;
function startScreensaverWatch() {
  setInterval(() => {
    if (!entitled.has('pro') || !pref('screensaver') || ssActive || full || !(lastState && lastState.active && lastState.playing)) return;
    if (powerMonitor.getSystemIdleTime() >= Number(pref('ssMin')) * 60) toRenderer('screensaver:request'); // the player decides (it never covers a video)
  }, 5000);
}

/* sleep timer fade-out */
const FADE_MS = 15000;
const fader = createFader({ send: (c) => sendCmd(c), getVolume: () => lastVol });

/* ---------- lyrics (LRCLIB: free, no account; sends artist + title over HTTPS) ---------- */
const lyricCache = new Map();
// Lyrics you have already seen are kept on disk, so they still show with no connection (newest 300 songs).
const lyricFile = () => path.join(app.getPath('userData'), 'lyrics-cache.json');
let lyricDisk = null, lyricSaveTimer = 0;
const lyricDiskGet = (key) => {
  if (!lyricDisk) { try { lyricDisk = JSON.parse(fs.readFileSync(lyricFile(), 'utf8')); } catch { lyricDisk = {}; } }
  return lyricDisk[key] || null;
};
const lyricDiskPut = (key, out) => {
  lyricDiskGet(key); delete lyricDisk[key]; lyricDisk[key] = out;
  const keys = Object.keys(lyricDisk); if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete lyricDisk[k];
  clearTimeout(lyricSaveTimer); lyricSaveTimer = setTimeout(() => { try { fs.writeFileSync(lyricFile(), JSON.stringify(lyricDisk)); } catch {} }, 2000);
};
async function getJson(url) {
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'NorwinVibe/0.1 (local media player)' } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function fetchLyrics({ artist, title, album, dur }) {
  const key = `${artist}|${title}|${Math.round(dur)}`.toLowerCase();
  if (lyricCache.has(key)) return lyricCache.get(key);
  const saved = lyricDiskGet(key); if (saved) { lyricCache.set(key, saved); return saved; }
  const q = new URLSearchParams({ artist_name: artist, track_name: title });
  if (album) q.set('album_name', album);
  if (dur > 0) q.set('duration', String(Math.round(dur)));
  let hit = await getJson(`https://lrclib.net/api/get?${q}`), diff = hit && dur > 0 && hit.duration ? Math.abs(hit.duration - dur) : 0;
  if (!hit) { // no exact match: take the synced version whose length is closest to the song's (a different edit drifts)
    const list = await getJson(`https://lrclib.net/api/search?${new URLSearchParams({ artist_name: artist, track_name: title })}`);
    const best = pickBest(list, dur); if (best) { hit = best.hit; diff = best.diff; }
  }
  const out = hit && (hit.syncedLyrics || hit.plainLyrics) ? { synced: hit.syncedLyrics || '', plain: hit.plainLyrics || '', diff } : null;
  if (lyricCache.size > 200) lyricCache.clear();
  lyricCache.set(key, out);
  if (out) lyricDiskPut(key, out); // only real hits are kept; a miss may be a dropped connection, so it is tried again next time
  return out;
}

/* ---------- sleep timer ---------- */
let sleepTimer = null, sleepFadeTimer = null, sleepEnds = 0;
function setSleep(mins) {
  clearTimeout(sleepTimer); clearTimeout(sleepFadeTimer); fader.cancel(); sleepTimer = sleepFadeTimer = null; sleepEnds = 0;
  if (mins > 0) {
    const ms = mins * 60000; sleepEnds = Date.now() + ms;
    const fade = entitled.has('pro') && pref('fadeout'); // Pro: ease the volume down over the last 15 seconds, then pause
    const done = () => { sleepEnds = 0; toRenderer('sleep:state', 0); if (Notification.isSupported()) new Notification({ title: 'Sleep timer', body: 'Playback paused.', silent: true }).show(); };
    if (fade) { sleepFadeTimer = setTimeout(() => fader.start(FADE_MS, 20), ms - FADE_MS); sleepTimer = setTimeout(done, ms); }
    else sleepTimer = setTimeout(() => { sendCmd('pause'); done(); }, ms);
  }
  toRenderer('sleep:state', sleepEnds);
}

/* ---------- auto-update ----------
   Installed builds check the "desktop-latest" GitHub release (see package.json build.publish and
   .github/workflows/release.yml), download a newer installer in the background and offer a restart. */
let updateState = { state: 'idle' };
function setupUpdater() {
  const testFeed = process.env.NORWINVIBE_UPDATE_URL; // for testing against a local server
  const supported = app.isPackaged || !!testFeed;
  const push = (u) => { updateState = { ...u, current: app.getVersion() }; toRenderer('update:status', updateState); };
  ipcMain.handle('update:state', () => (supported ? updateState : { state: 'unsupported', current: app.getVersion() }));
  ipcMain.handle('update:check', () => { if (supported) checkNow(); return supported ? updateState : { state: 'unsupported', current: app.getVersion() }; });
  ipcMain.on('update:install', () => { if (updateState.state === 'ready' && !updateState.fake) { quitting = true; autoUpdater.quitAndInstall(true, true); } }); // silent install, then relaunch
  if (!supported) return;

  if (testFeed) { autoUpdater.setFeedURL({ provider: 'generic', url: testFeed }); autoUpdater.forceDevUpdateConfig = true; autoUpdater.autoInstallOnAppQuit = false; }
  else autoUpdater.autoInstallOnAppQuit = true; // not installed yet? it installs the next time you quit
  autoUpdater.autoDownload = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('checking-for-update', () => push({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => push({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => push({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => push({ state: 'downloading', version: updateState.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => push({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => { console.error('[update]', e && e.message); push({ state: 'error', message: String((e && e.message) || e).slice(0, 140) }); });
  function checkNow() { autoUpdater.checkForUpdates().catch((e) => console.error('[update]', e && e.message)); }
  setTimeout(checkNow, 15000);                 // shortly after launch,
  setInterval(checkNow, 6 * 60 * 60 * 1000);   // then every six hours
}

/* ---------- global hotkeys ---------- */
function registerHotkeys() {
  const keys = {
    'Control+Alt+Space': () => sendCmd('toggle'),
    'Control+Alt+Right': () => sendCmd('next'),
    'Control+Alt+Left': () => sendCmd('prev'),
    'Control+Alt+Up': () => sendCmd('volstep:0.05'),
    'Control+Alt+Down': () => sendCmd('volstep:-0.05'),
    'Control+Alt+H': toggleVisible,
    'Control+Alt+G': () => setGhost(!ghost),
  };
  for (const [k, fn] of Object.entries(keys)) { try { globalShortcut.register(k, fn); } catch {} }
}

/* ---------- IPC ---------- */
ipcMain.handle('prefs:get', () => { const { licenses, devAsFree, ...rest } = prefs; return { ...DEFAULTS, ...rest, owned: entitlementList(), sleepEnds, version: app.getVersion() }; });
ipcMain.on('prefs:set', (_e, patch) => {
  if (!patch || typeof patch !== 'object') return;
  for (const [k, v] of Object.entries(patch)) {
    if (PRO_KEYS.has(k) && !entitled.has('pro')) continue;
    if (ENUMS[k] && ENUMS[k].includes(v) && allowed(k, v)) prefs[k] = v;
    else if (BOOLS.includes(k) && typeof v === 'boolean') prefs[k] = v;
  }
  savePrefs();
  if ('autostart' in patch) applyAutostart();
  if ('obs' in patch || 'discord' in patch) syncProServices();
});
ipcMain.handle('lyrics:get', (_e, m) => {
  const s = (v) => String(v || '').slice(0, 200);
  if (!m || !s(m.title) || !s(m.artist)) return null;
  return fetchLyrics({ artist: s(m.artist), title: s(m.title), album: s(m.album), dur: Number(m.dur) || 0 });
});
ipcMain.on('cmd', (_e, cmd) => {
  const ok = /^(play|pause|toggle|next|prev|seek:[\d.]+|shuffle:[01]|repeat:(None|Track|List)|volume:(0|1|0?\.\d+)|volstep:-?0?\.\d+|mute:[01]|select:[^\r\n]{1,300})$/;
  if (typeof cmd === 'string' && ok.test(cmd)) sendCmd(cmd);
});
ipcMain.on('toast', (_e, t) => {
  if (!pref('toasts') || !t || win.isVisible() || !Notification.isSupported()) return;
  const n = new Notification({
    title: String(t.title || '').slice(0, 120), body: String(t.body || '').slice(0, 160), silent: true,
    icon: typeof t.art === 'string' && t.art.startsWith('data:image') ? nativeImage.createFromDataURL(t.art) : ICON,
  });
  n.on('click', showWindow); n.show();
});
ipcMain.handle('store:info', () => {
  const c = storeCfg();
  return {
    owned: entitlementList(),
    restore: /^https:\/\//.test(storeCfg().restoreUrl || ''),
    items: Object.fromEntries(STORE_IDS.map((id) => [id, { name: c.items?.[id]?.name || id, price: c.items?.[id]?.price || '', hasCheckout: /^https:\/\//.test(c.items?.[id]?.checkoutUrl || '') }])),
  };
});
ipcMain.handle('store:restore', async (_e, email) => { // asks YOUR license service to email the buyer's keys again
  const url = storeCfg().restoreUrl;
  if (!/^https:\/\//.test(url || '') || typeof email !== 'string' || !/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) return { ok: false, error: 'Restore is not set up yet.' };
  try { const r = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); return { ok: r.ok }; } catch { return { ok: false, error: 'No connection.' }; }
});
ipcMain.handle('store:buy', async (_e, id) => { // opens YOUR checkout page (e.g. a Stripe Payment Link) in the browser
  const url = storeCfg().items?.[id]?.checkoutUrl;
  if (!STORE_IDS.includes(id) || !/^https:\/\//.test(url || '')) return { ok: false, error: 'Checkout is not set up yet. Add a checkoutUrl in store.config.json.' };
  await shell.openExternal(url);
  return { ok: true };
});
ipcMain.handle('store:redeem', (_e, key) => {
  const o = addLicense(key);
  return o ? { ok: true, item: o.item } : { ok: false, error: 'That license key is not valid or has expired.' };
});

/* ---------- developer mode (only works while a valid, unexpired "dev" key is held) ---------- */
ipcMain.handle('dev:info', () => devActive ? {
  version: app.getVersion(), packaged: app.isPackaged, electron: process.versions.electron, node: process.versions.node,
  userData: app.getPath('userData'), asFree: !!prefs.devAsFree, licenses: (prefs.licenses || []).length,
} : null);
ipcMain.on('dev:devtools', () => { if (devActive && win) win.webContents.toggleDevTools(); });
ipcMain.on('dev:asfree', (_e, on) => {
  if (!devActive) return;
  prefs.devAsFree = !!on; recompute(); dropLockedChoices(); savePrefs();
  toRenderer('store:owned', entitlementList());
});
ipcMain.on('dev:fakeupdate', () => { // shows the "Restart to update" state without a real update
  if (!devActive) return;
  updateState = { state: 'ready', version: '9.9.9', fake: true, current: app.getVersion() };
  toRenderer('update:status', updateState);
});
ipcMain.on('dev:signout', () => {
  if (!devActive) return;
  prefs.licenses = (prefs.licenses || []).filter((k) => { const o = verifyLicense(k); return !(o && o.item === 'dev'); });
  delete prefs.devAsFree; recompute(); dropLockedChoices(); savePrefs();
  toRenderer('store:owned', entitlementList());
});
ipcMain.handle('file:export', async (_e, f) => { // save stats / pictures / backups through a native Save dialog (everything but a backup needs Pro)
  if (!f || typeof f.content !== 'string' || f.content.length > 8e6 || (!entitled.has('pro') && f.backup !== true)) return { ok: false };
  const name = String(f.name || 'export.txt').replace(/[^\w.\- ]/g, '_').slice(0, 80);
  const ext = path.extname(name).slice(1).toLowerCase();
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { if (f.base64) fs.writeFileSync(r.filePath, Buffer.from(f.content, 'base64')); else fs.writeFileSync(r.filePath, f.content, 'utf8'); return { ok: true }; } catch { return { ok: false }; }
});
ipcMain.handle('pro:status', () => proStatus());
ipcMain.on('art:rejected', (_e, key) => { if (lastArt && lastArt.key === key) lastArt.rejected = true; }); // the player decided it is a logo, not cover art
ipcMain.on('screensaver:state', (_e, on) => {
  if (!entitled.has('pro')) return;
  ssActive = !!on;
  if (ssActive && win && !win.isVisible()) { ssHidden = true; win.showInactive(); }  // woke from the tray just for the screensaver
  if (!ssActive && ssHidden) { ssHidden = false; if (win) win.hide(); }
});
ipcMain.on('dev:screensaver', () => { if (devActive) toRenderer('screensaver:request'); });
ipcMain.on('sleep:set', (_e, mins) => setSleep([0, 5, 10, 15, 30, 45, 60, 90, 120].includes(mins) ? mins : 0));
ipcMain.on('win:close', () => app.quit());
ipcMain.on('win:minimizeWindow', () => { if (win && !win.isDestroyed()) win.minimize(); }); // the top-bar button: a normal minimise to the taskbar
ipcMain.on('win:minimize', () => win.hide()); // lives in the tray; click the tray icon to bring it back
let ghost = false; // click-through: the player floats over other windows and mouse clicks go to whatever is underneath
function setGhost(on) {
  if (!win || win.isDestroyed()) return;
  ghost = !!on; win.setIgnoreMouseEvents(ghost, { forward: true });
  toRenderer('ghost:state', ghost);
}
ipcMain.on('win:ghost', (_e, on) => setGhost(!!on));
ipcMain.on('win:pin', (_e, on) => setPin(on));
ipcMain.on('win:mini', (_e, on) => {
  if (full) return;
  const s = on ? SIZES.mini : SIZES.full;
  const [x, y] = win.getPosition();
  const p = clampToScreen(x, y, s.w, s.h);
  win.setBounds({ ...p, width: s.w, height: s.h });
  prefs.mini = !!on; prefs.x = p.x; prefs.y = p.y; savePrefs();
});
ipcMain.on('win:fullscreen', (_e, on) => {
  if (!!on === full) return;
  full = !!on;
  if (full) {
    normalBounds = win.getBounds();
    win.setAlwaysOnTop(true, 'screen-saver'); // so it covers the taskbar even when "always on top" is off
    win.setBounds(screen.getDisplayMatching(normalBounds).bounds);
  } else {
    if (normalBounds) win.setBounds(normalBounds);
    win.setAlwaysOnTop(pref('pin'), 'screen-saver');
  }
});

/* ---------- lifecycle ---------- */
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    const c = (argv.find((a) => a.startsWith('--cmd=')) || '').slice(6);
    if (['toggle', 'next', 'prev'].includes(c)) sendCmd(c); // jump-list action: no need to pop the window up
    else showWindow(); // clicked the pinned taskbar icon / Start menu entry while hidden in the tray
  });
  app.whenReady().then(() => {
    // Lets the renderer tap system audio (WASAPI loopback) for the visualizer.
    session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
      desktopCapturer.getSources({ types: ['screen'] })
        .then((src) => cb({ video: src[0], audio: 'loopback' }))
        .catch(() => cb({}));
    });
    createWindow(); createTray(); registerHotkeys(); applyAutostart(); startHelper(); setupUpdater();
    syncProServices(); startScreensaverWatch();
    setInterval(() => { recompute(); toRenderer('store:owned', entitlementList()); }, 60 * 60 * 1000); // lets expired keys lapse while the app stays open
  });
  app.on('before-quit', () => { quitting = true; fader.cancel(); if (discord) discord.stop(); obs.stop(); helper?.kill(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
