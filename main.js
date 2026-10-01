const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, session, desktopCapturer,
  globalShortcut, Notification, net, shell,
} = require('electron');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const APP_ID = 'com.norwinlabs.vibe.desktop'; // must equal build.appId in package.json
app.setAppUserModelId(APP_ID);

const SIZES = { full: { w: 360, h: 560 }, mini: { w: 360, h: 124 } };
const ICON = path.join(__dirname, 'assets', 'icon.png');
const DEFAULTS = { pin: true, mini: false, theme: 'art', record: 'vinyl', needle: 'classic', viz: 'bars', speed: 'slow', bgart: 'cover', lyrics: true, toasts: true, fade: false, snap: true, autostart: false };
const ENUMS = {
  bgart: ['cover', 'soft', 'off'],
  speed: ['slow', 'relaxed', '33', '45'],
  theme: ['art', 'midnight', 'retro', 'neon', 'cyberpunk', 'nightcity'],
  record: ['vinyl', 'color', 'cd', 'cyber', 'nightcity'],
  needle: ['classic', 'gold', 'minimal', 'cyber', 'nightcity'],
  viz: ['bars', 'dots', 'wave', 'off', 'cyber', 'nightcity'],
};
// Paid packs: which option values each one unlocks. Ownership is only ever granted here in the main process.
const PAID = {
  cyberpunk: { theme: ['cyberpunk'], record: ['cyber'], needle: ['cyber'], viz: ['cyber'] },
  nightcity: { theme: ['nightcity'], record: ['nightcity'], needle: ['nightcity'], viz: ['nightcity'] },
};
const PUBLIC_KEY = (() => { try { return fs.readFileSync(path.join(__dirname, 'licensing', 'public.pem')); } catch { return null; } })();
const storeCfg = () => {
  let c;
  try { c = JSON.parse(fs.readFileSync(path.join(__dirname, 'store.config.json'), 'utf8')); } catch { c = { testMode: false, items: {} }; }
  // Test mode (the free "Unlock (test)" button) is off in the committed config. Turn it on for yourself with the
  // environment variable NORWINVIBE_TESTMODE=1; installed builds ignore testMode in the file.
  if (process.env.NORWINVIBE_TESTMODE === '1') c.testMode = true;
  else if (app.isPackaged) c.testMode = false;
  return c;
};
const BOOLS = ['lyrics', 'toasts', 'fade', 'snap', 'autostart'];

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const loadPrefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch { return {}; } };
const savePrefs = () => { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch {} };

let win, helper, tray, quitting = false, full = false, normalBounds = null;
let prefs = {};
const pref = (k) => (k in prefs ? prefs[k] : DEFAULTS[k]);
const owned = () => (Array.isArray(prefs.owned) ? prefs.owned : []);
const allowed = (k, v) => { // is this option value free, or unlocked by a pack the user owns?
  for (const [id, u] of Object.entries(PAID)) if (u[k] && u[k].includes(v)) return owned().includes(id);
  return true;
};
function grant(id) {
  if (!PAID[id]) return false;
  prefs.owned = [...new Set([...owned(), id])]; savePrefs();
  toRenderer('store:owned', prefs.owned);
  return true;
}
function verifyLicense(key) { // key = base64url(payload) + '.' + base64url(ed25519 signature)
  try {
    if (!PUBLIC_KEY) return null;
    const [p, sig] = String(key).trim().split('.');
    const payload = Buffer.from(p, 'base64url');
    if (!crypto.verify(null, payload, PUBLIC_KEY, Buffer.from(sig, 'base64url'))) return null;
    const o = JSON.parse(payload.toString());
    return PAID[o.item] ? o.item : null;
  } catch { return null; }
}

const sendCmd = (c) => { if (helper?.stdin.writable) helper.stdin.write(c + '\n'); };
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
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.on('click', toggleVisible);
  tray.on('right-click', () => tray.popUpContextMenu(build()));
}

function createWindow() {
  prefs = loadPrefs();
  for (const k of Object.keys(ENUMS)) if (k in prefs && !allowed(k, prefs[k])) delete prefs[k];
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
      const msg = JSON.parse(line);
      toRenderer(msg.type === 'art' ? 'media:art' : 'media:state', msg);
      onMedia(msg);
    } catch (e) { if (!(e instanceof SyntaxError)) console.error('[media]', e); } // bad JSON lines are ignored; real errors are not
  });
  helper.stderr.on('data', (d) => console.error('[smtc]', String(d).trim()));
  helper.stdin.on('error', () => {});
  helper.on('exit', () => { if (!quitting) setTimeout(startHelper, 2000); });
}

/* ---------- lyrics (LRCLIB: free, no account; sends artist + title over HTTPS) ---------- */
const lyricCache = new Map();
async function getJson(url) {
  try {
    const r = await net.fetch(url, { headers: { 'User-Agent': 'NorwinVibe/0.1 (local media player)' } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function fetchLyrics({ artist, title, album, dur }) {
  const key = `${artist}|${title}|${Math.round(dur)}`.toLowerCase();
  if (lyricCache.has(key)) return lyricCache.get(key);
  const q = new URLSearchParams({ artist_name: artist, track_name: title });
  if (album) q.set('album_name', album);
  if (dur > 0) q.set('duration', String(Math.round(dur)));
  let hit = await getJson(`https://lrclib.net/api/get?${q}`);
  if (!hit) {
    const list = await getJson(`https://lrclib.net/api/search?${new URLSearchParams({ artist_name: artist, track_name: title })}`);
    if (Array.isArray(list)) {
      const close = (x) => !(dur > 0) || Math.abs((x.duration || 0) - dur) <= 4;
      hit = list.find((x) => x.syncedLyrics && close(x)) || list.find((x) => x.plainLyrics && close(x)) || null;
    }
  }
  const out = hit && (hit.syncedLyrics || hit.plainLyrics) ? { synced: hit.syncedLyrics || '', plain: hit.plainLyrics || '' } : null;
  if (lyricCache.size > 200) lyricCache.clear();
  lyricCache.set(key, out);
  return out;
}

/* ---------- sleep timer ---------- */
let sleepTimer = null, sleepEnds = 0;
function setSleep(mins) {
  clearTimeout(sleepTimer); sleepTimer = null; sleepEnds = 0;
  if (mins > 0) {
    sleepEnds = Date.now() + mins * 60000;
    sleepTimer = setTimeout(() => {
      sendCmd('pause'); sleepEnds = 0; toRenderer('sleep:state', 0);
      if (Notification.isSupported()) new Notification({ title: 'Sleep timer', body: 'Playback paused.', silent: true }).show();
    }, mins * 60000);
  }
  toRenderer('sleep:state', sleepEnds);
}

/* ---------- auto-update ----------
   Installed builds check the "desktop-latest" GitHub release (see package.json build.publish and
   .github/workflows/desktop-release.yml), download a newer installer in the background and offer a restart. */
let updateState = { state: 'idle' };
function setupUpdater() {
  const testFeed = process.env.NORWINVIBE_UPDATE_URL; // for testing against a local server
  const supported = app.isPackaged || !!testFeed;
  const push = (u) => { updateState = { ...u, current: app.getVersion() }; toRenderer('update:status', updateState); };
  ipcMain.handle('update:state', () => (supported ? updateState : { state: 'unsupported', current: app.getVersion() }));
  ipcMain.handle('update:check', () => { if (supported) checkNow(); return supported ? updateState : { state: 'unsupported', current: app.getVersion() }; });
  ipcMain.on('update:install', () => { if (updateState.state === 'ready') { quitting = true; autoUpdater.quitAndInstall(true, true); } }); // silent install, then relaunch
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
  };
  for (const [k, fn] of Object.entries(keys)) { try { globalShortcut.register(k, fn); } catch {} }
}

/* ---------- IPC ---------- */
ipcMain.handle('prefs:get', () => ({ ...DEFAULTS, ...prefs, owned: owned(), sleepEnds, version: app.getVersion() }));
ipcMain.on('prefs:set', (_e, patch) => {
  if (!patch || typeof patch !== 'object') return;
  for (const [k, v] of Object.entries(patch)) {
    if (ENUMS[k] && ENUMS[k].includes(v) && allowed(k, v)) prefs[k] = v;
    else if (BOOLS.includes(k) && typeof v === 'boolean') prefs[k] = v;
  }
  savePrefs();
  if ('autostart' in patch) applyAutostart();
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
    testMode: !!c.testMode, owned: owned(),
    items: Object.fromEntries(Object.keys(PAID).map((id) => [id, { name: c.items?.[id]?.name || id, price: c.items?.[id]?.price || '', hasCheckout: /^https:\/\//.test(c.items?.[id]?.checkoutUrl || '') }])),
  };
});
ipcMain.handle('store:buy', async (_e, id) => { // opens YOUR checkout page (e.g. a Stripe Payment Link) in the browser
  const url = storeCfg().items?.[id]?.checkoutUrl;
  if (!PAID[id] || !/^https:\/\//.test(url || '')) return { ok: false, error: 'Checkout is not set up yet. Add a checkoutUrl in store.config.json.' };
  await shell.openExternal(url);
  return { ok: true };
});
ipcMain.handle('store:redeem', (_e, key) => {
  const id = verifyLicense(key);
  return id && grant(id) ? { ok: true, item: id } : { ok: false, error: 'That license key is not valid.' };
});
ipcMain.handle('store:testunlock', (_e, id) => (storeCfg().testMode && grant(id) ? { ok: true } : { ok: false, error: 'Test mode is off.' }));
ipcMain.on('sleep:set', (_e, mins) => setSleep([0, 15, 30, 60].includes(mins) ? mins : 0));
ipcMain.on('win:close', () => app.quit());
ipcMain.on('win:minimize', () => win.hide()); // lives in the tray; click the tray icon to bring it back
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
  });
  app.on('before-quit', () => { quitting = true; helper?.kill(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
