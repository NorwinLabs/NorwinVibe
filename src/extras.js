/* Extras shared by Windows + Android: accessibility (calm mode, larger text), Pro custom colours, lyrics timing,
   per-song looks, click-through, share / recap cards, backup & restore and the first-run tour.
   Loaded after pro.js. Visual choices that are not part of the host's saved settings live in localStorage ("nv.ui"). */

const uiGet = () => { try { return JSON.parse(localStorage.getItem('nv.ui')) || {}; } catch { return {}; } };
const uiSet = (patch) => { try { localStorage.setItem('nv.ui', JSON.stringify({ ...uiGet(), ...patch })); } catch {} };
const mapGet = (k) => { try { const o = JSON.parse(localStorage.getItem(k)); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
const mapSet = (k, o) => { try { localStorage.setItem(k, JSON.stringify(o)); } catch {} };
const HEX = /^#[0-9a-f]{6}$/i;

/* ---------- accessibility + custom colours ---------- */
function applyUi() {
  const u = uiGet();
  calmMode = !!u.calm;
  document.body.classList.toggle('calm', calmMode);
  document.body.classList.toggle('big', !!u.big);
  $('sw-calm').classList.toggle('on', calmMode);
  $('sw-big').classList.toggle('on', !!u.big);
  const custom = !!u.custom && isPro();
  $('sw-custom').classList.toggle('on', custom);
  $('custom-row').classList.toggle('off', !custom);
  if (HEX.test(u.ca || '')) $('cc-a').value = u.ca;
  if (HEX.test(u.cb || '')) $('cc-b').value = u.cb;
  if (custom) {
    root.style.setProperty('--c-a', HEX.test(u.ca || '') ? u.ca : '#8b5cf6');
    root.style.setProperty('--c-b', HEX.test(u.cb || '') ? u.cb : '#ec4899');
    root.dataset.custom = '1';
  } else root.removeAttribute('data-custom');
}
$('sw-calm').onclick = () => { uiSet({ calm: !uiGet().calm }); applyUi(); };
$('sw-big').onclick = () => { uiSet({ big: !uiGet().big }); applyUi(); setTimeout(fitTitle, 50); };
$('sw-custom').onclick = () => { if (!isPro()) { openPro(); return; } uiSet({ custom: !uiGet().custom }); applyUi(); };
['cc-a', 'cc-b'].forEach((id) => {
  $(id).oninput = () => { if (!isPro()) { openPro(); applyUi(); return; } uiSet({ [id === 'cc-a' ? 'ca' : 'cb']: $(id).value, custom: true }); applyUi(); };
});

/* ---------- lyrics timing (saved per song) ---------- */
const OFF_KEY = 'nv.lyroff';
function showLyrOff() { $('lyr-off-n').textContent = lyrOff ? `${lyrOff > 0 ? '+' : ''}${lyrOff.toFixed(1)} s` : ''; }
function setLyrOff(v) {
  lyrOff = Math.max(-10, Math.min(10, Math.round(v * 10) / 10));
  if (curId) { const m = mapGet(OFF_KEY); if (lyrOff) m[curId] = lyrOff; else delete m[curId]; mapSet(OFF_KEY, m); }
  lyr.idx = -2; showLyrOff(); // forces the current line to be picked again
  hud(lyrOff ? `Lyrics ${lyrOff > 0 ? 'later' : 'earlier'} by ${Math.abs(lyrOff).toFixed(1)} s` : 'Lyrics timing reset');
}
document.querySelectorAll('#lyr-chips button').forEach((b) => { b.onclick = () => setLyrOff(+b.dataset.v === 0 ? 0 : lyrOff + +b.dataset.v); });
document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (e.key === '[') setLyrOff(lyrOff - 0.5); else if (e.key === ']') setLyrOff(lyrOff + 0.5);
});

/* ---------- a look remembered for one song ---------- */
const LOOK_KEY = 'nv.looks';
let lookApplied = false;
function songLook() {
  if (!curId) return null;
  const l = mapGet(LOOK_KEY)[curId]; if (!l) return null;
  const ok = (pref, v) => { const b = document.querySelector(`.chips[data-pref="${pref}"] button[data-v="${v}"]`); return !!b && (!b.dataset.paid || owns(b.dataset.paid)); };
  const out = {}; for (const k of ['record', 'needle', 'viz']) if (typeof l[k] === 'string' && ok(k, l[k])) out[k] = l[k];
  return Object.keys(out).length ? out : null;
}
function showLookMsg() { $('look-msg').textContent = songLook() ? 'This song has its own record, needle and visualizer.' : curId ? '' : 'Play a song first.'; $('btn-look-clear').disabled = !songLook(); }
$('btn-look-save').onclick = () => {
  if (!curId) { hud('Play a song first'); return; }
  const m = mapGet(LOOK_KEY); m[curId] = { record: P.record || 'vinyl', needle: P.needle || 'classic', viz: P.viz || 'bars' };
  const ids = Object.keys(m); if (ids.length > 300) delete m[ids[0]];
  mapSet(LOOK_KEY, m); hud('Look saved for this song'); showPrefs();
};
$('btn-look-clear').onclick = () => { const m = mapGet(LOOK_KEY); delete m[curId]; mapSet(LOOK_KEY, m); hud('Look forgotten'); showPrefs(); };

/* choosing a record / needle / visualizer on a song that has its own look changes that song's look, so the choice is not ignored */
function onLookPref(k, v) {
  if (!curId || !['record', 'needle', 'viz'].includes(k)) return;
  const m = mapGet(LOOK_KEY); if (m[curId]) { m[curId][k] = v; mapSet(LOOK_KEY, m); }
}

/* called by features.js */
function onSongChanged() {
  lyrOff = +mapGet(OFF_KEY)[curId] || 0; showLyrOff();
  const has = !!songLook();
  if (has || lookApplied) showPrefs();
  lookApplied = has; showLookMsg();
}
function extrasRefresh() { applyUi(); showLyrOff(); showLookMsg(); lookApplied = !!songLook(); }

/* ---------- click-through ("ghost") mode, Windows only ---------- */
if (bridge.ghost) {
  bridge.onGhost((on) => {
    document.body.classList.toggle('ghost', on); $('sw-ghost').classList.toggle('on', on);
    hud(on ? 'Click-through on · Ctrl+Alt+G turns it off' : 'Click-through off');
  });
  $('sw-ghost').onclick = () => bridge.ghost(!document.body.classList.contains('ghost'));
}

/* ---------- saving files (Windows save dialog / phone share sheet) ---------- */
const saveOut = (name, mime, content, extra) => (bridge.exportFile ? bridge.exportFile({ name, mime, content, ...extra }) : Promise.resolve({ ok: false }));
const toastResult = (r, what) => hud(r && r.ok ? (r.copied ? 'Copied to the clipboard' : `${what} saved`) : r && r.canceled ? 'Canceled' : 'Could not save');

/* ---------- backup & restore ---------- */
const BACKUP_PREFS = ['theme', 'bgart', 'record', 'speed', 'needle', 'viz', 'lyrics', 'toasts', 'fade', 'snap', 'autostart', 'autotheme', 'autoDay', 'autoEve', 'autoNight', 'fadeout', 'smartshuffle'];
const backupKey = (k) => /^nv\./.test(k) || k === 'vibe.playlists' || k === 'vibe.fx'; // never licenses
$('btn-backup').onclick = async () => {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (backupKey(k)) data[k] = localStorage.getItem(k); }
  if (typeof saveStats === 'function') saveStats();
  const prefs = {}; BACKUP_PREFS.forEach((k) => { if (P[k] !== undefined) prefs[k] = P[k]; });
  const content = JSON.stringify({ app: 'NorwinVibe', v: 1, saved: new Date().toISOString(), prefs, data });
  toastResult(await saveOut(`norwinvibe-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', content, { backup: true }), 'Backup');
};
$('btn-restore').onclick = () => $('restore-file').click();
$('restore-file').onchange = async () => {
  const f = $('restore-file').files[0]; $('restore-file').value = ''; if (!f) return;
  try {
    if (f.size > 8e6) throw new Error('too big');
    const o = JSON.parse(await f.text());
    if (!o || o.app !== 'NorwinVibe' || !o.data || typeof o.data !== 'object') throw new Error('not a backup');
    if (!confirm('Restore this backup? It replaces your history, favourites, stats and look settings on this device.')) return;
    for (const [k, v] of Object.entries(o.data)) if (backupKey(k) && typeof v === 'string' && v.length < 4e6) localStorage.setItem(k, v);
    if (o.prefs && typeof o.prefs === 'object') { const p = {}; BACKUP_PREFS.forEach((k) => { if (o.prefs[k] !== undefined) p[k] = o.prefs[k]; }); bridge.setPrefs(p); }
    hud('Backup restored'); setTimeout(() => location.reload(), 600);
  } catch { hud('That is not a NorwinVibe backup'); }
};

/* ---------- share / recap cards (Pro): a picture to post ---------- */
const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
function drawCover(x, img, dx, dy, dw, dh) { // like background-size: cover
  const s = Math.max(dw / img.naturalWidth, dh / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
  x.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
}
function wrapText(x, text, cx, y, maxW, lineH, maxLines) {
  const words = String(text || '').split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…'); }
  lines.forEach((l, i) => x.fillText(l, cx, y + i * lineH)); return lines.length;
}
async function cardBase(kind) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), cs = getComputedStyle(root);
  const a1 = cs.getPropertyValue('--accent').trim() || '#8b5cf6', a2 = cs.getPropertyValue('--accent-2').trim() || '#ec4899';
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, a1); g.addColorStop(1, a2); x.fillStyle = g; x.fillRect(0, 0, W, H);
  const cover = kind === 'song' && art && art.key === lastKey && art.data && !artRejected.has(lastKey) ? await loadImg(art.data) : null;
  if (cover) { x.filter = 'blur(46px) saturate(1.3)'; drawCover(x, cover, -90, -90, W + 180, H + 180); x.filter = 'none'; }
  x.fillStyle = 'rgba(8,8,14,.58)'; x.fillRect(0, 0, W, H);
  x.textAlign = 'center'; x.fillStyle = 'rgba(255,255,255,.55)'; x.font = '600 30px "Segoe UI", system-ui, sans-serif';
  x.fillText('NORWINVIBE', W / 2, H - 56);
  return { c, x, W, H, cover, a1, a2 };
}
async function songCard() {
  const { c, x, W, cover, a1, a2 } = await cardBase('song'), cx = W / 2, cy = 520, R = 340;
  x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 60; x.shadowOffsetY = 24;
  x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fillStyle = '#0b0b0d'; x.fill(); x.restore();
  x.lineWidth = 2; for (let r = 150; r < R - 6; r += 9) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.strokeStyle = r % 18 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.09)'; x.stroke(); }
  const sheen = x.createConicGradient(0, cx, cy); sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(.12, 'rgba(255,255,255,.14)'); sheen.addColorStop(.25, 'rgba(255,255,255,0)'); sheen.addColorStop(.62, 'rgba(255,255,255,.1)'); sheen.addColorStop(.75, 'rgba(255,255,255,0)');
  x.beginPath(); x.arc(cx, cy, R - 4, 0, Math.PI * 2); x.fillStyle = sheen; x.fill();
  const L = 128; x.save(); x.beginPath(); x.arc(cx, cy, L, 0, Math.PI * 2); x.clip();
  if (cover) drawCover(x, cover, cx - L, cy - L, L * 2, L * 2); else { const lg = x.createLinearGradient(cx - L, cy - L, cx + L, cy + L); lg.addColorStop(0, a1); lg.addColorStop(1, a2); x.fillStyle = lg; x.fillRect(cx - L, cy - L, L * 2, L * 2); }
  x.restore(); x.beginPath(); x.arc(cx, cy, 14, 0, Math.PI * 2); x.fillStyle = '#0b0b0d'; x.fill();
  const d = curDisplay || { title: 'Nothing playing', artist: '' };
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = '800 68px "Segoe UI", system-ui, sans-serif';
  const n = wrapText(x, d.title, cx, 990, 900, 78, 2);
  x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '500 42px "Segoe UI", system-ui, sans-serif';
  wrapText(x, d.artist || '', cx, 990 + n * 78 + 14, 900, 52, 1);
  return c;
}
async function recapCard() {
  const { c, x, W, H } = await cardBase('recap'), cx = W / 2, tracks = Object.values(stats.tracks);
  x.textAlign = 'center'; x.fillStyle = '#fff'; x.font = '800 58px "Segoe UI", system-ui, sans-serif'; x.fillText('My listening', cx, 150);
  const big = stats.total >= 3600; x.font = '800 220px "Segoe UI", system-ui, sans-serif'; x.fillText(fmtHours(stats.total), cx, 400);
  x.font = '600 40px "Segoe UI", system-ui, sans-serif'; x.fillStyle = 'rgba(255,255,255,.75)'; x.fillText(big ? 'hours listened' : 'minutes listened', cx, 460);
  x.font = '700 64px "Segoe UI", system-ui, sans-serif'; x.fillStyle = '#fff';
  [[stats.plays, 'plays'], [tracks.length, 'songs'], [dayStreak(), 'day streak']].forEach(([v, l], i) => { const px = W * (0.2 + i * 0.3); x.font = '800 70px "Segoe UI", system-ui, sans-serif'; x.fillStyle = '#fff'; x.fillText(String(v), px, 590); x.font = '500 30px "Segoe UI", system-ui, sans-serif'; x.fillStyle = 'rgba(255,255,255,.7)'; x.fillText(l, px, 635); });
  // last 7 days
  const days = Array.from({ length: 7 }, (_, i) => { const t = Date.now() - (6 - i) * 86400000; return { k: dayKey(t), d: new Date(t) }; });
  const mx = Math.max(60, ...days.map((d) => stats.days[d.k] || 0)), bx = 150, bw = 90, gap = 20, base = 880;
  days.forEach((d, i) => { const h = Math.max(8, (stats.days[d.k] || 0) / mx * 170), px = bx + i * (bw + gap); x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.roundRect(px, base - h, bw, h, 12); x.fill(); x.fillStyle = 'rgba(255,255,255,.6)'; x.font = '500 28px "Segoe UI", system-ui, sans-serif'; x.fillText(d.d.toLocaleDateString([], { weekday: 'short' }), px + bw / 2, base + 42); });
  // top songs
  x.textAlign = 'left'; x.fillStyle = 'rgba(255,255,255,.6)'; x.font = '700 28px "Segoe UI", system-ui, sans-serif'; x.fillText('TOP SONGS', 110, 1000);
  tracks.slice().sort((a, b) => b.s - a.s).slice(0, 3).forEach((t, i) => { x.fillStyle = '#fff'; x.font = '700 40px "Segoe UI", system-ui, sans-serif'; const w = 860; let s = `${i + 1}  ${t.t}`; while (x.measureText(s).width > w && s.length > 4) s = s.slice(0, -2); x.fillText(s === `${i + 1}  ${t.t}` ? s : s + '…', 110, 1060 + i * 62); });
  x.fillStyle = 'rgba(255,255,255,.55)'; x.font = '600 30px "Segoe UI", system-ui, sans-serif'; x.textAlign = 'center';
  return c;
}
async function shareCard(kind) {
  if (!isPro()) { openPro(); return; }
  if (kind === 'song' && !st.active) { hud('Play a song first'); return; }
  hud('Making the picture…');
  const c = await (kind === 'song' ? songCard() : recapCard());
  const url = c.toDataURL('image/png'), b64 = url.slice(url.indexOf(',') + 1);
  toastResult(await saveOut(kind === 'song' ? 'norwinvibe-song.png' : 'norwinvibe-recap.png', 'image/png', b64, { base64: true }), 'Picture');
}
$('btn-share').onclick = () => shareCard('song');
$('btn-recap').onclick = () => shareCard('recap');
$('st-share').onclick = () => shareCard('recap');

/* ---------- first-run tour ---------- */
const TOUR = document.body.classList.contains('mobile') ? [
  ['Your music', 'Tap the music note at the top to find the songs on your phone and build playlists.'],
  ['Turn it sideways', 'Rotate your phone for a landscape player. Car mode in Settings makes the buttons bigger.'],
  ['Scrub like a record', 'Drag the needle or the record itself to jump around in the song.'],
  ['Make it yours', 'Settings has Look, Player, Pro and About. Pro adds the equalizer, playlists and more.'],
] : [
  ['Move it anywhere', 'Drag the strip at the top of the player to move it. Double-click for the mini player.'],
  ['Scrub like a record', 'Drag the needle or the record itself to jump around in the song.'],
  ['Everything is in Settings', 'Look, Player, Pro and About. Click the version at the bottom to check for updates.'],
  ['Hotkeys', 'Ctrl+Alt+Space plays or pauses from anywhere, and Ctrl+Alt+G makes the player click-through.'],
];
/* what's new: shown once to people who already took the first-run tour (and after it for new people) */
const TOUR_NEW = [
  ['3D record player', 'Settings > Look > 3D record player flips the record onto a turntable. Works in full screen and ambient mode too.'],
  ['Scratch it', 'Drag the record back and forth to scrub, and it scratches like a real one. Pixel dancers pop up when the music plays (Settings > Look).'],
  ['Bigger visualizer', 'The ring reacts harder now. Tap any synced lyric line to jump to it.'],
];
const TOUR_VER = '2';
let tourList = TOUR, tourStep = 0;
function showTour(i, list) {
  if (list) tourList = list;
  tourStep = i; const t = $('tour');
  if (i >= tourList.length) { t.hidden = true; try { localStorage.setItem('nv.tour', '1'); localStorage.setItem('nv.tourNew', TOUR_VER); } catch {} return; }
  t.hidden = false; $('tour-t').textContent = tourList[i][0]; $('tour-p').textContent = tourList[i][1];
  $('tour-dots').textContent = tourList.map((_, k) => (k === i ? '\u25CF' : '\u25CB')).join(' ');
  $('tour-next').textContent = i === tourList.length - 1 ? 'Done' : 'Next';
}
$('tour-next').onclick = () => showTour(tourStep + 1);
$('tour-skip').onclick = () => showTour(tourList.length);
$('btn-tour').onclick = () => { closePops(); showTour(0, TOUR); };
{
  let seen = false, newSeen = false; try { seen = !!localStorage.getItem('nv.tour'); newSeen = localStorage.getItem('nv.tourNew') === TOUR_VER; } catch {}
  if (!seen) setTimeout(() => showTour(0, TOUR.concat(TOUR_NEW)), 2500); // first run: the basics, then what is new
  else if (!newSeen) setTimeout(() => showTour(0, TOUR_NEW), 2500); // an update with new things to show off
}

prefsReady.then(extrasRefresh);
