/* Settings, themes, lyrics, history/favourites, volume, sleep timer, ambient mode and toasts.
   Loaded after renderer.js and uses its globals (el, st, bridge, art, livePos, setMini, ...). */
const root = document.documentElement;
let P = {};
let pinned = true;

/* ---------- panels ---------- */
const pops = { settings: $('pop-settings'), history: $('pop-history'), store: $('pop-store'), library: $('pop-library'), stats: $('pop-stats'), eq: $('pop-eq') };
const closePops = () => Object.values(pops).forEach((p) => p && p.classList.remove('open'));
function togglePop(name) {
  const open = !pops[name].classList.contains('open');
  closePops(); el.menu.classList.remove('open');
  pops[name].classList.toggle('open', open);
  if (open && name === 'history') renderHistory();
}
$('btn-settings').onclick = (e) => { e.stopPropagation(); togglePop('settings'); };
$('btn-history').onclick = (e) => { e.stopPropagation(); togglePop('history'); };
document.addEventListener('click', (e) => { if (!e.target.closest('.pop')) closePops(); });

/* settings tabs (Look / Player / Pro / About); the last one used is remembered */
(function settingsTabs() {
  const tabs = document.querySelectorAll('#sp-tabs button'), panes = document.querySelectorAll('#pop-settings .sp');
  let cur = 'look'; try { cur = localStorage.getItem('nv.settingsTab') || 'look'; } catch {}
  const show = (name) => {
    if (![...panes].some((p) => p.dataset.tab === name)) name = 'look';
    tabs.forEach((b) => b.classList.toggle('on', b.dataset.v === name));
    panes.forEach((p) => p.classList.toggle('show', p.dataset.tab === name));
    pops.settings.scrollTop = 0;
    try { localStorage.setItem('nv.settingsTab', name); } catch {}
  };
  tabs.forEach((b) => { b.onclick = () => show(b.dataset.v); });
  window.openSettingsTab = (name) => { show(name); };
  show(cur);
})();

/* ---------- preferences ---------- */
const SPEEDS = { slow: 96, relaxed: 126, '33': 200, '45': 270 }; // deg/s: ~16, 21, 33.3 and 45 rpm
function showPrefs() {
  recordDeg = SPEEDS[P.speed] || SPEEDS.slow;
  const prevTheme = root.dataset.theme;
  root.dataset.theme = (typeof effectiveTheme === 'function' && effectiveTheme()) || P.theme || 'art'; // Pro: time-of-day themes override what is shown, not what is saved
  if (prevTheme && prevTheme !== root.dataset.theme) applyPalette(el.label.classList.contains('art') ? art.data : '');
  const L = (typeof songLook === 'function' && songLook()) || {}; // a look remembered for this song wins over the global one
  root.dataset.record = L.record || P.record || 'vinyl';
  root.dataset.bgart = P.bgart || 'cover';
  root.dataset.needle = L.needle || P.needle || 'classic';
  root.dataset.viz = L.viz || P.viz || 'bars';
  root.dataset.fade = P.fade ? 'on' : 'off';
  root.dataset.deckskin = P.deckskin || 'dark';
  document.body.classList.toggle('no-lyrics', !P.lyrics);
  document.querySelectorAll('.chips[data-pref]').forEach((c) => c.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === P[c.dataset.pref])));
  document.querySelectorAll('.chips button[data-paid]').forEach((b) => b.classList.toggle('locked', !owns(b.dataset.paid)));
  document.querySelectorAll('.sw[data-pref]').forEach((b) => b.classList.toggle('on', !!P[b.dataset.pref]));
  $('sw-pin').classList.toggle('on', pinned);
  refreshDev();
  if (typeof refreshPro === 'function') refreshPro();
  if (typeof extrasRefresh === 'function') extrasRefresh();
  applyDeck(!!P.deck3d);
}
function setPref(k, v) {
  if (typeof onLookPref === 'function') onLookPref(k, v);
  P[k] = v; bridge.setPrefs({ [k]: v }); showPrefs();
  if (k === 'theme') applyPalette(el.label.classList.contains('art') ? art.data : '');
  if (k === 'lyrics') { if (v) loadLyrics(st, curDisplay); else clearLyrics(); }
  if (k === 'dancers' || k === 'dancerpack') window.dispatchEvent(new Event('vibe:dancers'));
}
const owns = (id) => (P.owned || []).includes(id);
document.querySelectorAll('.chips[data-pref] button').forEach((b) => {
  b.onclick = () => {
    if (b.dataset.paid && !owns(b.dataset.paid)) { openStore(b.dataset.paid); return; }
    if (b.parentElement.classList.contains('pro') && !owns('pro')) { openStore('pro'); return; }
    setPref(b.parentElement.dataset.pref, b.dataset.v);
  };
});
document.querySelectorAll('.sw[data-pref]').forEach((b) => {
  b.onclick = () => { if (b.classList.contains('pro') && !owns('pro')) { openStore('pro'); return; } setPref(b.dataset.pref, !P[b.dataset.pref]); };
});
const setPinned = (on, push = true) => { pinned = on; $('sw-pin').classList.toggle('on', on); if (push) bridge.pin(on); };
$('sw-pin').onclick = () => setPinned(!pinned);
$('btn-tray').onclick = () => bridge.minimize();
bridge.onPin((on) => setPinned(on, false));
prefsReady.then((p) => { P = p; pinned = p.pin; sleepEnds = p.sleepEnds || 0; showPrefs(); });

/* ---------- theme store ---------- */
const STORE_UI = {
  pro: { blurb: 'Every theme pack, now and in the future, plus the Pro features. One purchase, on both Windows and Android.', parts: ['All theme packs', 'Listening stats', 'Time-of-day themes', 'Sleep fade-out', 'Screensaver', 'OBS overlay', 'Discord status', 'Equalizer & crossfade', 'Playlists', 'Smart shuffle', 'Lock screen & widget'], apply: {} },
  cyberpunk: { blurb: 'Neon-soaked card theme, circuit-etched record, plasma needle and a glitch-wave visualizer.', parts: ['Card theme', 'Record', 'Needle', 'Visualizer'],
    apply: { theme: 'cyberpunk', record: 'cyber', needle: 'cyber', viz: 'cyber' } },
  nightcity: { blurb: 'Dystopian terminal look: black glass, hot red neon lines, glowing cyan light bars, data-grid overlays, scratches and a glitching HUD.', parts: ['Card theme', 'Record', 'Needle', 'Visualizer'],
    apply: { theme: 'nightcity', record: 'nightcity', needle: 'nightcity', viz: 'nightcity' } },
};
let storeInfo = { owned: [], items: {} };
const storeMsg = (t) => { $('store-msg').textContent = t || ''; };
async function renderStore(focus) {
  try { storeInfo = await bridge.storeInfo(); } catch {}
  P.owned = storeInfo.owned; showPrefs();
  $('restore-box').style.display = storeInfo.restore ? '' : 'none'; // only when a restore service is set up (store.config.json restoreUrl)
  const box = $('store-items'); box.textContent = '';
  for (const [id, it] of Object.entries(storeInfo.items)) {
    const ui = STORE_UI[id] || { blurb: '', parts: [], apply: {} };
    const card = document.createElement('div'); card.className = `store-card pack-${id}` + (focus === id ? ' focus' : '');
    const prev = document.createElement('div'); prev.className = 'pack-preview';
    prev.innerHTML = '<i class="pv-rec"></i><i class="pv-arm"></i><span class="pv-bars"><b></b><b></b><b></b><b></b><b></b></span>';
    const name = document.createElement('div'); name.className = 'pack-name'; name.textContent = it.name;
    const blurb = document.createElement('p'); blurb.textContent = ui.blurb;
    const parts = document.createElement('div'); parts.className = 'pack-parts'; ui.parts.forEach((x) => { const s = document.createElement('span'); s.textContent = x; parts.appendChild(s); });
    const row = document.createElement('div'); row.className = 'pack-row';
    if (owns(id)) {
      const ok = document.createElement('span'); ok.className = 'owned'; ok.textContent = 'Owned';
      const ap = document.createElement('button'); ap.className = 'act'; ap.textContent = 'Apply all';
      ap.onclick = () => { for (const [k, v] of Object.entries(ui.apply)) setPref(k, v); hud(`${it.name} applied`); };
      row.append(ok, ap);
    } else {
      const buy = document.createElement('button'); buy.className = 'act buy'; buy.textContent = `Buy \u00b7 ${it.price}`;
      buy.onclick = async () => {
        const r = await bridge.storeBuy(id);
        storeMsg(r.ok ? 'Checkout opened in your browser. After paying, paste the license key you receive below.' : r.error);
      };
      row.appendChild(buy);
    }
    card.append(prev, name, blurb, parts, row); box.appendChild(card);
  }
}
function openStore(focus) {
  closePops(); el.menu.classList.remove('open');
  pops.store.classList.add('open'); storeMsg(''); renderStore(focus);
}
$('btn-store').onclick = (e) => { e.stopPropagation(); openStore(); };
$('key-redeem').onclick = async () => {
  const key = $('key-in').value.trim(); if (!key) return;
  const r = await bridge.storeRedeem(key);
  if (r.ok) { $('key-in').value = ''; storeMsg('Unlocked! Thank you.'); hud('Unlocked'); renderStore(r.item); } else storeMsg(r.error);
};
$('mail-send').onclick = async () => {
  const email = $('mail-in').value.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { storeMsg('Enter the email you bought with.'); return; }
  storeMsg('Sending…');
  const r = await bridge.storeRestore(email);
  storeMsg(r && r.ok ? 'If that email has a purchase, your keys are on their way.' : ((r && r.error) || 'Could not send right now. Try again later.'));
};
bridge.onOwned((list) => {
  P.owned = list;
  // a licence change can also reset choices that are now locked (e.g. leaving dev mode), so take the saved preferences again
  const before = P.theme;
  bridge.prefs().then((p) => { P = p; showPrefs(); if (P.theme !== before) applyPalette(el.label.classList.contains('art') ? art.data : ''); });
  showPrefs(); if (pops.store.classList.contains('open')) renderStore();
});

/* ---------- developer panel: only visible while a valid dev key is held ---------- */
function refreshDev() {
  const panel = $('dev-panel'), on = owns('dev') && !!bridge.dev;
  panel.hidden = !on;
  if (!on) return;
  bridge.dev.info().then((i) => {
    if (!i) { panel.hidden = true; return; }
    $('dev-asfree').classList.toggle('on', !!i.asFree);
    $('dev-info').textContent = `v${i.version} \u00b7 ${i.packaged ? 'installed' : 'dev run'} \u00b7 Electron ${i.electron || '-'} \u00b7 ${i.licenses} license(s)\n${i.userData || ''}`;
  });
}
if (bridge.dev) {
  $('dev-asfree').onclick = () => bridge.dev.asFree(!$('dev-asfree').classList.contains('on'));
  $('dev-tools').onclick = () => bridge.dev.devtools();
  $('dev-fakeupd').onclick = () => bridge.dev.fakeUpdate();
  $('dev-ss').onclick = () => bridge.dev.screensaver();
  $('dev-signout').onclick = () => bridge.dev.signOut();
}

/* ---------- HUD ---------- */
let hudTimer;
function hud(text) {
  const h = $('hud'); h.textContent = text; h.classList.add('show');
  clearTimeout(hudTimer); hudTimer = setTimeout(() => h.classList.remove('show'), 1200);
}

/* ---------- volume ---------- */
const volEl = $('vol'); let volSetAt = 0, curVol = 0.5, muted = false, volSend = 0;
const fmtVol = (v) => (v >= 1 ? '1' : v <= 0 ? '0' : v.toFixed(2));
function showVol(v) {
  volEl.value = Math.round(v * 100); volEl.style.setProperty('--p', `${volEl.value}%`);
  $('vol-n').textContent = volEl.value; $('btn-mute').classList.toggle('active', muted);
  $('btn-vol').classList.toggle('muted', muted || +volEl.value === 0); $('btn-vol').classList.toggle('lo', +volEl.value < 40);
}
const volPop = $('volpop'); let volHide = 0;
const bumpVol = () => { clearTimeout(volHide); volHide = setTimeout(() => volPop.classList.remove('open'), 3500); }; // closes itself a few seconds after the last touch
$('btn-vol').onclick = (e) => { e.stopPropagation(); const open = !volPop.classList.contains('open'); closePops(); volPop.classList.toggle('open', open); $('btn-vol').classList.toggle('on', open); if (open) bumpVol(); };
document.addEventListener('click', (e) => { if (!e.target.closest('#volwrap')) { volPop.classList.remove('open'); $('btn-vol').classList.remove('on'); } });
volPop.addEventListener('pointerdown', bumpVol); volPop.addEventListener('input', bumpVol);
volEl.oninput = () => {
  const v = volEl.value / 100; curVol = v; volSetAt = performance.now(); showVol(v);
  const now = performance.now();
  if (now - volSend > 60) { volSend = now; bridge.cmd(`volume:${fmtVol(v)}`); }
};
volEl.onchange = () => bridge.cmd(`volume:${fmtVol(volEl.value / 100)}`);
$('btn-mute').onclick = () => { muted = !muted; volSetAt = performance.now(); showVol(curVol); bridge.cmd(`mute:${muted ? 1 : 0}`); };
el.card.addEventListener('wheel', (e) => {
  if (e.target.closest('.pop, .lyrics')) return;
  const step = e.deltaY < 0 ? 0.03 : -0.03;
  curVol = Math.min(1, Math.max(0, curVol + step)); volSetAt = performance.now();
  bridge.cmd(`volstep:${step > 0 ? '0.03' : '-0.03'}`); showVol(curVol);
  hud(`Volume ${Math.round(curVol * 100)}%`);
}, { passive: true });

/* ---------- sleep timer ---------- */
let sleepEnds = 0, sleepSong = false; // sleepSong: pause when the current song finishes
document.querySelectorAll('#sleep-chips button').forEach((b) => {
  b.onclick = () => {
    if (b.dataset.v === 'song') { sleepSong = true; sleepEnds = 0; bridge.sleep(0); updateSleep('song'); hud('Pausing when this song ends'); return; }
    const m = +b.dataset.v; sleepSong = false; sleepEnds = m ? Date.now() + m * 60000 : 0; bridge.sleep(m); updateSleep(m); hud(m ? `Pausing in ${m} min` : 'Sleep timer off');
  };
});
bridge.onSleep((t) => { sleepEnds = t; updateSleep(); });
function updateSleep(chosen) {
  const left = sleepEnds - Date.now();
  $('sleep-left').textContent = left > 0 ? `${Math.ceil(left / 60000)} min left` : '';
  const sel = sleepSong ? 'song' : chosen !== undefined ? chosen : left > 0 ? [5, 10, 15, 30, 45, 60, 90, 120].find((m) => left <= m * 60000 + 1000) : 0;
  document.querySelectorAll('#sleep-chips button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(sel || 0)));
}
setInterval(updateSleep, 5000); updateSleep(0);

/* ---------- state hooks from renderer.js ---------- */
function onStateExtra(m) {
  if (typeof m.vol === 'number' && performance.now() - volSetAt > 900) { curVol = m.vol; muted = !!m.muted; showVol(curVol); }
  $('btn-fav').classList.toggle('on', isFav(curId));
}

/* ---------- lyrics ---------- */
let lyr = { token: 0, lines: [], synced: false, idx: -1 };
let lyrOff = 0; // seconds: this song's lyrics timing nudge (extras.js)
let lyrGlobal = 0; try { lyrGlobal = parseFloat(localStorage.getItem('nv.lyrGlobal')) || 0; } catch {} // seconds, all songs (Bluetooth lag)
let curDisplay = null;
const lyricEl = $('lyric'), lyricsBox = $('lyrics');

const parseLRC = LRC.parseLRC; // (src/lrc.js, shared with the phone app and the tests)
/* the dot beside Shuffle: green = lyrics were found and will show for this song, grey = none (or off / still searching) */
function setLyrDot(state, note = '') {
  const d = $('lyr-dot'); if (!d) return;
  d.className = 'lyr-dot ' + state;
  d.title = state === 'found' ? 'Lyrics found: they will show for this song' + note : state === 'busy' ? 'Looking for lyrics…' : (P.lyrics === false ? 'Lyrics are turned off' : 'No lyrics for this song');
}
function clearLyrics(msg = '') {
  setLyrDot('none');
  lyr = { token: lyr.token + 1, lines: [], synced: false, idx: -1 };
  lyricEl.textContent = ''; lyricsBox.textContent = '';
  if (msg) { const n = document.createElement('div'); n.className = 'none'; n.textContent = msg; lyricsBox.appendChild(n); }
}
async function loadLyrics(m, d) {
  clearLyrics();
  if (!P.lyrics || !m.active || !d || !d.title || !d.artist || m.dur > 900) { if (m.active && m.dur > 900) clearLyrics('Lyrics are skipped for long videos'); return; }
  const token = lyr.token;
  clearLyrics('Searching for lyrics…'); lyr.token = token + 1; setLyrDot('busy');
  const mine = lyr.token;
  const title = d.title.replace(/\s*[-–]\s*(remaster(ed)?|\d{4}\s+remaster|live|single version|radio edit).*$/i, '').trim();
  let res = null;
  try { res = await bridge.lyrics({ artist: d.artist, title, album: m.album, dur: m.dur }); } catch {}
  if (lyr.token !== mine) return; // track changed while searching
  lyricsBox.textContent = '';
  const synced = res && res.synced ? parseLRC(res.synced) : [];
  if (synced.length) {
    lyr.synced = true; lyr.lines = synced.map((l) => ({ ...l }));
  } else if (res && res.plain) {
    lyr.lines = res.plain.split(/\r?\n/).map((text) => ({ t: null, text }));
  } else { clearLyrics('No lyrics found'); lyr.token = mine; return; }
  for (const l of lyr.lines) {
    const n = document.createElement('div'); n.className = 'ln' + (l.t === null ? ' plain' : ''); n.textContent = l.text || '♪';
    if (l.t !== null) { n.title = 'Jump to this line'; n.onclick = () => { if (st.active && st.canSeek) seekTo(l.t); }; } // tap a line to jump there
    l.el = n; lyricsBox.appendChild(n);
  }
  setLyrDot('found', res.diff > 2 ? ` (a different edit of the song, so the timing may be off by about ${Math.round(res.diff)} s: nudge it in Settings > Player)` : '');
}

const lineAt = (pos) => LRC.lineAt(lyr.lines, pos);
/* ---------- 3D record player: the flat record flips over and lands on a turntable ---------- */
const tiltEl = $('tilt'), stageEl = $('stage'), deckWrap = document.querySelector('.vinyl-wrap');
const TILT_DEG = 58;
let deckOn = null, deckBusy = false, deckRaf = 0;
/* the 3D player follows the mouse (or the phone's tilt) a little, so it feels like an object you are looking at */
const deckLook = { tx: 0, ty: 0, x: 0, y: 0, applied: '' };
function deckLookStep() {
  if (deckBusy || root.dataset.deck !== '3d' || document.body.classList.contains('mini')) return;
  const on = P.deckmove !== false && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tx = on ? deckLook.tx : 0, ty = on ? deckLook.ty : 0;
  deckLook.x += (tx - deckLook.x) * 0.1; deckLook.y += (ty - deckLook.y) * 0.1;
  const v = `rotateX(${(TILT_DEG + deckLook.y * -6).toFixed(2)}deg) rotateZ(${(deckLook.x * 5).toFixed(2)}deg)`;
  if (v !== deckLook.applied) { deckLook.applied = v; tiltEl.style.transform = v; }
}
document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { deckLook.tx = e.clientX / innerWidth * 2 - 1; deckLook.ty = e.clientY / innerHeight * 2 - 1; } });
window.addEventListener('deviceorientation', (e) => { if (e.gamma == null) return; deckLook.tx = Math.max(-1, Math.min(1, e.gamma / 25)); deckLook.ty = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 25)); });
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
function deckStatic(on) {
  cancelAnimationFrame(deckRaf); deckBusy = false;
  root.classList.remove('deck-anim');
  root.dataset.deck = on ? '3d' : 'flat';
  tiltEl.style.transform = on ? `rotateX(${TILT_DEG}deg)` : '';
  stageEl.style.setProperty('--deck', on ? '1' : '0'); tiltEl.style.setProperty('--deck', on ? '1' : '0');
  deckWrap.style.transform = '';
}
/* q runs 0 (flat) to 1 (on the turntable): the card tilts back, the turntable rises, and the record lifts off, flips once
   (a full turn over) and settles onto the platter. Played backwards it flips back to a flat record. */
function deckFrame(q) {
  const u = clamp01((q - 0.08) / 0.84);
  tiltEl.style.transform = `rotateX(${(TILT_DEG * easeIO(clamp01(q / 0.95))).toFixed(2)}deg)`;
  const dk = clamp01((q - 0.12) / 0.6).toFixed(3); tiltEl.style.setProperty('--deck', dk); stageEl.style.setProperty('--deck', dk);
  const z = 16 * u + 95 * Math.sin(Math.PI * u) * (1 - 0.25 * u);
  deckWrap.style.transform = `translate3d(var(--sx, -14px), 0, ${z.toFixed(1)}px) rotateX(${(360 * easeOut(u)).toFixed(1)}deg)`;
}
function animateDeck(on) {
  cancelAnimationFrame(deckRaf);
  deckBusy = true; root.classList.add('deck-anim'); root.dataset.deck = '3d';
  const T = 1700, t0 = performance.now();
  const step = (now) => {
    const p = clamp01((now - t0) / T);
    deckFrame(on ? p : 1 - p);
    if (p < 1) deckRaf = requestAnimationFrame(step); else deckStatic(on);
  };
  deckRaf = requestAnimationFrame(step);
}
function applyDeck(on) {
  const still = deckOn === null || document.body.classList.contains('mini') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (on === deckOn) return;
  deckOn = on;
  if (still) deckStatic(on); else animateDeck(on);
}

/* ---------- needle: locked to song progress and eased every frame ---------- */
const armEl = $('arm'), armBase = armEl.querySelector('.arm-base'), tipEl = armEl.querySelector('.arm-tip'), wrapEl = document.querySelector('.vinyl-wrap');
const R_OUT = 110, R_IN = 50; // stylus distance from the record centre at the first / last groove (record radius is 118)
const REST_DEG = -4;          // parked position beside the record
let armTip = [4.2, 173.7];    // stylus position relative to the pivot, unrotated (px); re-measured from the live DOM
let armRange = null, armRangeAt = 0, armAngle = REST_DEG, armLast = 0;

function measureArm() { // the arm maths needs the flat layout, so look at it flat for a moment (nothing is painted in between)
  if (deckBusy) return;
  const flat = root.dataset.deck === '3d';
  if (!flat) return measureArmFlat();
  const keep = [tiltEl.style.transform, stageEl.style.perspective];
  tiltEl.style.transform = 'none'; stageEl.style.perspective = 'none';
  try { measureArmFlat(); } finally { tiltEl.style.transform = keep[0]; stageEl.style.perspective = keep[1]; }
}
function measureArmFlat() {
  const w = wrapEl.getBoundingClientRect(), b = armBase.getBoundingClientRect(), tp = tipEl.getBoundingClientRect();
  if (!w.width) return;
  const s = w.width / 236, cx = w.left + w.width / 2, cy = w.top + w.height / 2, px = b.left + b.width / 2, py = b.top + b.height / 2;
  // calibrate the stylus offset from the real element: undo the arm's current rotation
  const eff = armAngle + liftPos * 1.6, sc = 1 + liftPos * 0.035; // the lift adds a little rotation and scale; undo both too
  const vx = (tp.left - px) / s / sc, vy = (tp.top - py) / s / sc, ca = Math.cos(-eff * Math.PI / 180), sa = Math.sin(-eff * Math.PI / 180);
  armTip = [vx * ca - vy * sa, vx * sa + vy * ca];
  const radiusAt = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
    return Math.hypot(px + (armTip[0] * c - armTip[1] * n) * s - cx, py + (armTip[0] * n + armTip[1] * c) * s - cy) / s; };
  // The arm's arc runs from the outer edge in toward the centre and can pass THROUGH the centre to the far (top) side.
  // Always take the first (near-side) crossing, so the stylus stays on the lower/front half of the record.
  const tipY = (deg) => { const a = deg * Math.PI / 180; return py + (armTip[0] * Math.sin(a) + armTip[1] * Math.cos(a)) * s; };
  const solve = (r) => { let last = -10; for (let d = -10; d <= 80; d += 0.05) { if (radiusAt(d) <= r || tipY(d) < cy) return d; last = d; } return last; };
  armRange = { out: solve(R_OUT), inn: solve(R_IN) }; armRangeAt = performance.now();
}
/* Lifting and lowering the stylus: `liftPos` is 0 with the needle in the groove and 1 raised. A small spring moves it, so putting
   it down settles with a tiny bounce and picking it up eases away. Raised = a touch nearer the viewer (bigger, longer shadow). */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let liftPos = 1, liftVel = 0;
function stepLift(dt, playing) {
  const target = playing || needleDrag ? 0 : 1, lowering = target === 0;
  const k = lowering ? 90 : 38, c = lowering ? 8.5 : 9.5; // lowering is crisper and bounces slightly; raising is slower and smooth
  liftVel += ((target - liftPos) * k - liftVel * c) * dt; liftPos += liftVel * dt;
  if (Math.abs(target - liftPos) < 0.0005 && Math.abs(liftVel) < 0.005) { liftPos = target; liftVel = 0; }
}
const applyArm = () => {
  armEl.style.transform = `rotate(${(armAngle + liftPos * 1.6).toFixed(3)}deg) scale(${(1 + liftPos * 0.035).toFixed(4)})`;
  armEl.style.setProperty('--lift', liftPos.toFixed(3));
};
function updateArm(t, pos) {
  deckLookStep();
  const dt = Math.max(0, Math.min(0.1, (t - (armLast || t)) / 1000)); armLast = t; // never negative or huge (clock jumps, tab resume)
  if (!Number.isFinite(armAngle)) armAngle = REST_DEG;
  if (!armRange || performance.now() - armRangeAt > 400) measureArm();
  const playing = el.card.classList.contains('playing');
  stepLift(dt, playing);
  if (needleDrag) { applyArm(); return; } // the pointer sets the angle while dragging
  let target = REST_DEG + (st.active || reduceMotion.matches ? 0 : Math.sin(t / 1800) * 0.9); // parked, with a barely-there sway while idle
  if (armRange && st.active) {
    const p = st.dur > 0 ? Math.min(1, Math.max(0, pos / st.dur)) : 0;
    target = armRange.out + (armRange.inn - armRange.out) * p; // paused too: stays where the song is, just lifted
  }
  // tiny moves track the song time exactly; big jumps (seek, new song, lowering) glide
  const diff = target - armAngle, k = Math.abs(diff) > 3 ? 3.2 : 18;
  armAngle += diff * (1 - Math.exp(-dt * k));
  applyArm();
}

/* Drag the needle along its arc: outer groove = start, inner grooves = end. Seeks on release. */
let needleDrag = false;
armEl.title = 'Drag the needle to scrub';
armEl.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.arm-rod, .arm-head') || !st.active || !(st.dur > 0) || !st.canSeek) return;
  measureArm(); if (!armRange) return;
  e.target.setPointerCapture(e.pointerId);
  needleDrag = true; document.body.classList.add('needle-drag');
  scratch = { pos: livePos(), needle: true };
  moveNeedle(e);
});
function moveNeedle(e) {
  const b = armBase.getBoundingClientRect(), tipAngle = Math.atan2(-armTip[0], armTip[1]) * 180 / Math.PI; // stylus sits slightly off the arm's axis
  const deg = Math.atan2(-(e.clientX - (b.left + b.width / 2)), e.clientY - (b.top + b.height / 2)) * 180 / Math.PI - tipAngle;
  armAngle = Math.min(armRange.inn, Math.max(armRange.out, deg)); applyArm();
  scratch.pos = (armAngle - armRange.out) / (armRange.inn - armRange.out) * st.dur;
}
armEl.addEventListener('pointermove', (e) => { if (needleDrag) moveNeedle(e); });
const endNeedle = () => {
  if (!needleDrag) return;
  needleDrag = false; document.body.classList.remove('needle-drag');
  const p = scratch ? scratch.pos : 0; scratch = null; seekTo(p);
};
armEl.addEventListener('pointerup', endNeedle);
armEl.addEventListener('pointercancel', endNeedle);

/* ---------- A-B loop: repeat a section of the song ---------- */
const abLoop = { a: null, b: null, at: 0 };
function loopUi() {
  $('loop-n').textContent = abLoop.a === null ? '' : abLoop.b === null ? `A ${fmt(abLoop.a)}` : `${fmt(abLoop.a)} \u2192 ${fmt(abLoop.b)}`;
  if (bridge.setLoop) bridge.setLoop(abLoop.a, abLoop.b); // the phone's native player loops precisely on its own
}
$('loop-a').onclick = () => { if (!st.active) return; abLoop.a = livePos(); if (abLoop.b !== null && abLoop.b <= abLoop.a) abLoop.b = null; loopUi(); hud('Loop start set'); };
$('loop-b').onclick = () => { if (!st.active || abLoop.a === null) { hud('Set A first'); return; } const b = livePos(); if (b <= abLoop.a + 0.5) { hud('B must be after A'); return; } abLoop.b = b; loopUi(); hud('Looping A to B'); };
$('loop-clear').onclick = () => { abLoop.a = abLoop.b = null; loopUi(); hud('Loop cleared'); };
function featFrame(t, pos) {
  updateArm(t, pos);
  if (st.active && st.playing) {
    if (abLoop.b !== null && pos >= abLoop.b && t - abLoop.at > 700) { abLoop.at = t; seekTo(abLoop.a); }
    if (sleepSong && st.dur > 3 && pos >= st.dur - 0.7) { sleepSong = false; send('pause'); updateSleep(0); hud('Paused at the end of the song'); }
  }
  if (!lyr.synced) { // plain lyrics have no timing: in full screen, scroll them along with the song's progress
    if (mode === 'full' && lyr.lines.length && st.dur > 0 && t - (lyr.scrollAt || 0) > 250) { lyr.scrollAt = t; lyricsBox.scrollTo({ top: Math.max(0, lyricsBox.scrollHeight - lyricsBox.clientHeight) * Math.min(1, pos / st.dur), behavior: 'smooth' }); }
    return;
  }
  const i = lineAt(pos + 0.25 + lyrOff + lyrGlobal);
  if (i === lyr.idx) return;
  if (lyr.idx >= 0 && lyr.lines[lyr.idx].el) lyr.lines[lyr.idx].el.classList.remove('on');
  lyr.idx = i;
  const line = i >= 0 ? lyr.lines[i] : null;
  lyricEl.textContent = line ? line.text || '♪' : '';
  lyricEl.classList.remove('in'); void lyricEl.offsetWidth; lyricEl.classList.add('in');
  if (line && line.el) {
    line.el.classList.add('on');
    if (mode === 'full') lyricsBox.scrollTo({ top: line.el.offsetTop - lyricsBox.clientHeight / 2 + line.el.offsetHeight / 2, behavior: 'smooth' });
  }
}

/* ---------- the idle card: resume, recently played, and the last cover as a dim backdrop ---------- */
function renderIdle(active) {
  const box = $('idle-extra'); if (!box) return;
  box.textContent = '';
  if (active) return;
  const last = bridge.idleResume && bridge.idleResume();
  if (last) {
    const b = document.createElement('button'); b.className = 'act resume';
    b.textContent = `\u25B6  Resume \u00B7 ${last.title}`; b.title = last.artist || '';
    b.onclick = () => bridge.idlePlay && bridge.idlePlay();
    box.appendChild(b);
  }
  const recent = store.get('nv.history').slice(0, 3);
  if (recent.length) {
    const row = document.createElement('div'); row.className = 'idle-recent';
    for (const e of recent) {
      const c = document.createElement('button'); c.className = 'chip-recent'; c.title = `${e.artist ? e.artist + ' \u2013 ' : ''}${e.title}`;
      const th = document.createElement('i'); if (e.thumb) th.style.backgroundImage = `url("${e.thumb}")`;
      const tx = document.createElement('span'); tx.textContent = e.title;
      c.append(th, tx);
      c.onclick = () => { if (bridge.playRecent) bridge.playRecent(e.id); else togglePop('history'); };
      row.appendChild(c);
    }
    box.appendChild(row);
  }
}
window.addEventListener('vibe:library', () => { if (!st.active) renderIdle(false); });
function idleDecor() { // nothing is playing: borrow the colours and a faint blur of the last cover
  if (st.active) return;
  const e = store.get('nv.history').find((x) => x.thumb);
  if (!e) return;
  el.bg.style.backgroundImage = `url("${e.thumb}")`; el.bg.classList.add('on');
  if (typeof applyPalette === 'function') applyPalette(e.thumb);
}

/* ---------- history & favourites ---------- */
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let curId = '', curEntry = null, histTab = 'recent';
const idOf = (artist, title) => `${artist}|${title}`.toLowerCase();
const isFav = (id) => !!id && store.get('nv.favs').some((e) => e.id === id);

function makeThumb(dataUrl) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 96;
      const s = Math.min(i.naturalWidth, i.naturalHeight), x = c.getContext('2d');
      x.drawImage(i, (i.naturalWidth - s) / 2, (i.naturalHeight - s) / 2, s, s, 0, 0, 96, 96);
      res(c.toDataURL('image/jpeg', .78));
    };
    i.onerror = () => res(''); i.src = dataUrl;
  });
}
function saveEntry(entry) { // newest first, de-duplicated, capped
  const list = store.get('nv.history').filter((e) => e.id !== entry.id);
  list.unshift(entry); store.set('nv.history', list.slice(0, 60));
}
function onTrackChange(m, d) {
  if (abLoop.a !== null) { abLoop.a = abLoop.b = null; loopUi(); } // a new song: no loop
  renderIdle(m.active); if (!m.active) setTimeout(idleDecor, 0);
  curDisplay = m.active ? d : null;
  curEntry = null; curId = '';
  $('btn-fav').classList.remove('on');
  if (!m.active || !d) { clearLyrics(); return; }
  curId = idOf(d.artist || '', d.title || '');
  curEntry = { id: curId, title: d.title, artist: d.artist, app: prettyApp(m.app), ts: Date.now(), thumb: '' };
  const prev = store.get('nv.history').find((e) => e.id === curId);
  if (prev) curEntry.thumb = prev.thumb || '';
  saveEntry(curEntry);
  $('btn-fav').classList.toggle('on', isFav(curId));
  if (typeof onSongChanged === 'function') onSongChanged();
  loadLyrics(m, d);
  const key = m.key;
  setTimeout(() => { // give album art a moment to arrive before notifying
    if (lastKey !== key || !st.playing) return;
    bridge.toast({ title: d.title, body: d.sub, art: art.key === key && !artRejected.has(key) ? art.data : '' });
  }, 1200);
}
function onArtFeat(m) {
  if (m.key !== lastKey || !curEntry || !m.data) return;
  isAppIcon(m.data).then((r) => (r.icon ? '' : makeThumb(m.data))).then((t) => { if (!t || curEntry === null || m.key !== lastKey) return; curEntry.thumb = t; saveEntry(curEntry); const f = store.get('nv.favs'); const fe = f.find((e) => e.id === curId); if (fe) { fe.thumb = t; store.set('nv.favs', f); } if (pops.history.classList.contains('open')) renderHistory(); });
}
$('btn-fav').onclick = () => {
  if (!curEntry) return;
  let favs = store.get('nv.favs');
  if (favs.some((e) => e.id === curId)) { favs = favs.filter((e) => e.id !== curId); hud('Removed from favourites'); }
  else { favs.unshift({ ...curEntry }); hud('★ Added to favourites'); }
  store.set('nv.favs', favs);
  $('btn-fav').classList.toggle('on', isFav(curId));
  const b = $('btn-fav'); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
  if (pops.history.classList.contains('open')) renderHistory();
};

function renderHistory() {
  const box = $('hist-list'); box.textContent = '';
  const hq = (($('hist-q') || {}).value || '').trim().toLowerCase();
  const all = store.get(histTab === 'favs' ? 'nv.favs' : 'nv.history');
  const list = hq ? all.filter((e) => `${e.title} ${e.artist || ''} ${e.app || ''}`.toLowerCase().includes(hq)) : all;
  document.querySelectorAll('#hist-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === histTab));
  $('hist-clear').style.display = histTab === 'recent' && all.length ? '' : 'none';
  if (!list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = histTab === 'favs' ? 'Tap ★ on a song to keep it here' : 'Nothing played yet'; box.appendChild(e); return; }
  const favIds = new Set(store.get('nv.favs').map((e) => e.id));
  for (const e of list) {
    const row = document.createElement('div'); row.className = 'hrow'; row.title = 'Click to copy';
    const th = document.createElement('div'); th.className = 'th'; if (e.thumb) th.style.backgroundImage = `url("${e.thumb}")`;
    const tx = document.createElement('div'); tx.className = 'tx';
    const b = document.createElement('b'); b.textContent = e.title;
    const sp = document.createElement('span'); sp.textContent = `${e.artist || e.app} · ${new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    tx.append(b, sp);
    const star = document.createElement('button'); star.className = 'star' + (favIds.has(e.id) ? ' on' : ''); star.title = 'Favourite';
    star.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z"/></svg>';
    star.onclick = (ev) => {
      ev.stopPropagation(); let f = store.get('nv.favs');
      f = f.some((x) => x.id === e.id) ? f.filter((x) => x.id !== e.id) : [{ ...e }, ...f];
      store.set('nv.favs', f); renderHistory(); $('btn-fav').classList.toggle('on', isFav(curId));
    };
    row.onclick = () => { navigator.clipboard?.writeText(`${e.artist ? e.artist + ' – ' : ''}${e.title}`).then(() => hud('Copied to clipboard')).catch(() => {}); };
    row.append(th, tx, star); box.appendChild(row);
  }
}
$('hist-q').oninput = () => renderHistory();
document.querySelectorAll('#hist-tabs button').forEach((b) => { b.onclick = () => { histTab = b.dataset.v; renderHistory(); }; });
$('hist-clear').onclick = () => { store.set('nv.history', []); renderHistory(); };

/* ---------- full screen & ambient modes ---------- */
let mode = 'none'; // 'none' | 'full' | 'ambient'
let idleTimer = 0;
function fitStage() {
  if (mode === 'none') return;
  const c = el.card, used = ['.top', '.meta', '.progress', '.controls'].reduce((n, q) => n + c.querySelector(q).offsetHeight, 0);
  // Everything on screen grows with the display: ui is 1 on a small screen and up to 2.6 on a big or ultra-wide one.
  const W = c.clientWidth, H = c.clientHeight, wide = W / H > 2.1; // 21:9 / 32:9 monitors get a wider lyrics column
  const ui = Math.max(1, Math.min(2.6, Math.min(W / 1100, H / 680)));
  root.style.setProperty('--ui', ui.toFixed(2)); document.body.classList.toggle('ultrawide', wide);
  const h = H - used - (64 + 40) * ui;
  const w = mode === 'ambient' ? W - 112 * ui : (W - (112 + 40) * ui) / (wide ? 2.6 : 2.15);
  root.style.setProperty('--amb', Math.max(1, Math.min(mode === 'ambient' ? 4.2 : 3.6, h / 250, w / 310)).toFixed(2));
  fitTitle();
}
function bumpIdle() { // ambient hides its UI (and the cursor) after a few idle seconds
  if (mode !== 'ambient') return;
  document.body.classList.remove('idle-ui'); clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle-ui'), 3000);
}
function setMode(next) {
  if (next === mode) return;
  if (next !== 'none' && mini) { setMini(false); setTimeout(() => setMode(next), 250); return; }
  const wasNone = mode === 'none';
  mode = next; closePops(); el.menu.classList.remove('open');
  document.body.classList.toggle('fullscreen', next !== 'none');
  document.body.classList.toggle('ambient', next === 'ambient');
  $('hdr-full').classList.toggle('active', next === 'full');
  $('hdr-ambient').classList.toggle('active', next === 'ambient');
  document.body.classList.remove('idle-ui'); clearTimeout(idleTimer);
  if (next === 'none') { bridge.fullscreen(false); root.style.removeProperty('--amb'); root.style.removeProperty('--ui'); document.body.classList.remove('ultrawide'); }
  else { if (wasNone) bridge.fullscreen(true); setTimeout(fitStage, 150); setTimeout(fitStage, 500); bumpIdle(); }
  lyr.idx = -2; // force a refresh of the active lyric line
}
const toggleMode = (m) => setMode(mode === m ? 'none' : m);
$('btn-full').onclick = () => toggleMode('full');
$('btn-ambient').onclick = () => toggleMode('ambient');
$('hdr-full').onclick = () => toggleMode('full');
$('hdr-ambient').onclick = () => toggleMode('ambient');
window.addEventListener('resize', fitStage);
['mousemove', 'mousedown', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, bumpIdle, { passive: true }));
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Escape') { if (mode !== 'none') setMode('none'); else closePops(); }
  else if (e.code === 'KeyF' || e.code === 'F11') { e.preventDefault(); toggleMode('full'); }
  else if (e.code === 'KeyA') toggleMode('ambient');
});


/* ---------- version + auto-update (desktop only; the phone has no onUpdate) ---------- */
let appVersion = '';
const creditEl = $('credit'), verEl = $('credit-ver');
function showVersion(u) {
  const v = appVersion ? `v${appVersion}` : '';
  const av = $('about-ver'); if (av) av.textContent = v;
  creditEl.classList.remove('update'); verEl.disabled = false;
  let msg = '';
  if (u && u.state === 'downloading') { verEl.textContent = `${v} \u00b7 updating ${u.percent || 0}%`; msg = `Downloading ${u.version ? 'v' + u.version : 'an update'}\u2026 ${u.percent || 0}%`; }
  else if (u && u.state === 'ready') { creditEl.classList.add('update'); verEl.textContent = `${window.UPDATE_VERB || 'Restart to update'} to v${u.version}`; verEl.title = window.UPDATE_TITLE || 'Install the update and relaunch'; msg = `v${u.version} is ready. ${window.UPDATE_HOWTO || 'Click the version at the bottom to restart.'}`; }
  else { verEl.textContent = v; verEl.title = 'Click to check for updates'; msg = u && u.state === 'none' ? 'You are on the latest version.' : u && u.state === 'checking' ? 'Checking for updates\u2026' : u && u.state === 'error' ? 'Could not check for updates. Will try again later.' : u && u.state === 'unsupported' ? 'Updates are checked in the installed app.' : ''; }
  const m = $('update-msg'); if (m) m.textContent = msg;
}
prefsReady.then((p) => { appVersion = p.version || window.APP_VERSION || ''; showVersion(null); });
if (bridge.onUpdate) {
  bridge.onUpdate(showVersion);
  bridge.updateState().then((u) => { if (u && u.state !== 'idle') showVersion(u); });
  // click the version: install a downloaded update, otherwise check for one right now and say what happened
  let verTimer = 0;
  const verNote = (t) => { verEl.textContent = t; clearTimeout(verTimer); verTimer = setTimeout(() => showVersion(null), 4000); };
  verEl.onclick = () => {
    if (creditEl.classList.contains('update')) { bridge.updateInstall(); return; }
    verNote('Checking…');
    bridge.updateCheck().then((u) => {
      if (u && u.state === 'unsupported') verNote('Updates: installed app only');
      else if (u && (u.state === 'downloading' || u.state === 'ready')) showVersion(u);
    });
  };
  bridge.onUpdate((u) => {
    if (!u || creditEl.classList.contains('update') || u.state === 'downloading' || u.state === 'ready') return;
    if (u.state === 'none') verNote('Up to date ✓'); else if (u.state === 'error') verNote('Update check failed');
  });
  const updBtn = $('btn-update');
  const label = { checking: 'Checking…', none: 'Up to date ✓', downloading: 'Downloading…', ready: 'Update ready', error: 'Check failed', unsupported: 'Installed app only' };
  let labelTimer = 0;
  bridge.onUpdate((u) => {
    if (!u || !label[u.state]) return;
    updBtn.textContent = label[u.state];
    clearTimeout(labelTimer);
    if (u.state === 'none' || u.state === 'error') labelTimer = setTimeout(() => { updBtn.textContent = 'Check for updates'; }, 4000);
  });
  updBtn.onclick = () => {
    updBtn.textContent = 'Checking…';
    bridge.updateCheck().then((u) => {
      showVersion(u);
      if (u && u.state === 'unsupported') { updBtn.textContent = label.unsupported; clearTimeout(labelTimer); labelTimer = setTimeout(() => { updBtn.textContent = 'Check for updates'; }, 4000); }
    });
  };
} else { $('btn-update').style.display = 'none'; }
