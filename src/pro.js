/* NorwinVibe Pro features that live in the shared UI (Windows + Android).
   Loaded after features.js. Everything here is gated on owns('pro'); the host (main.js / mobile.js) enforces it again. */
const isPro = () => owns('pro');
const openPro = () => openStore('pro');

/* ---------- Pro section in Settings: locked / unlocked state ---------- */
const THEME_CHOICES = [['art', 'Album'], ['midnight', 'Midnight'], ['retro', 'Retro'], ['neon', 'Neon'], ['cyberpunk', 'Cyberpunk'], ['nightcity', 'Night City']];
const AUTO_DEFAULTS = { autoDay: 'art', autoEve: 'retro', autoNight: 'midnight' };
const proBlock = $('pro-block');

document.querySelectorAll('#pro-block select[data-pref]').forEach((sel) => {
  THEME_CHOICES.forEach(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); });
  sel.onchange = () => { if (!isPro()) { openPro(); refreshPro(); return; } setPref(sel.dataset.pref, sel.value); };
});
$('btn-stats').onclick = () => { if (!isPro()) { openPro(); return; } closePops(); pops.stats.classList.add('open'); renderStats(); };

function refreshPro() {
  const pro = isPro();
  proBlock.classList.toggle('locked', !pro);
  $('pro-state').textContent = pro ? 'active' : 'unlock in the store';
  $('pro-state').classList.toggle('on', pro);
  document.querySelectorAll('#pro-block select[data-pref]').forEach((sel) => { sel.value = P[sel.dataset.pref] || AUTO_DEFAULTS[sel.dataset.pref]; sel.disabled = false; });
  $('auto-row').classList.toggle('off', !P.autotheme);
  if (typeof refreshProStatus === 'function') refreshProStatus();
}

/* ---------- time-of-day themes ---------- */
// Day 06-17, Evening 17-22, Night 22-06. The saved theme choice is never changed; this only overrides what is shown.
const dayPart = (d = new Date()) => { const h = d.getHours(); return h >= 6 && h < 17 ? 'autoDay' : h >= 17 && h < 22 ? 'autoEve' : 'autoNight'; };
function effectiveTheme() { return P.autotheme && isPro() ? (P[dayPart()] || AUTO_DEFAULTS[dayPart()]) : null; }
setInterval(() => { if (P.autotheme && isPro() && root.dataset.theme !== effectiveTheme()) showPrefs(); }, 60 * 1000);

/* ---------- listening stats ----------
   Recorded for everyone (so a new Pro owner already has history); viewing and exporting are Pro. Stays on this device. */
const STATS_KEY = 'nv.stats';
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const loadStats = () => { try { const s = JSON.parse(localStorage.getItem(STATS_KEY)); if (s && s.tracks && s.days) return s; } catch {} return { v: 1, since: Date.now(), total: 0, plays: 0, tracks: {}, days: {} }; };
let stats = loadStats(), statsDirty = false, lastTick = 0, tickPlaying = false, sessionKey = '', sessionSecs = 0, sessionCounted = false;
const saveStats = () => { if (!statsDirty) return; statsDirty = false; try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch {} };

function statsTick() { // called from the host's state updates and a 1s timer; counts the time since the previous call while playing
  const now = Date.now(), dt = lastTick ? Math.min(90, (now - lastTick) / 1000) : 0; // cap: a throttled background timer still counts, a long sleep does not
  const was = tickPlaying; lastTick = now; tickPlaying = !!(st.active && st.playing);
  if (!was || !tickPlaying || !curId || dt <= 0 || !curEntry) return;
  if (sessionKey !== curId) { sessionKey = curId; sessionSecs = 0; sessionCounted = false; }
  const t = stats.tracks[curId] || (stats.tracks[curId] = { t: curEntry.title, a: curEntry.artist, s: 0, p: 0, l: 0 });
  t.s += dt; t.l = now; stats.total += dt; stats.days[dayKey(now)] = (stats.days[dayKey(now)] || 0) + dt;
  sessionSecs += dt;
  if (!sessionCounted && sessionSecs >= 30) { sessionCounted = true; t.p++; stats.plays++; } // a "play" is 30 seconds of listening
  statsDirty = true;
}
setInterval(statsTick, 1000); setInterval(saveStats, 15000);
window.addEventListener('beforeunload', saveStats); document.addEventListener('visibilitychange', () => { if (document.hidden) saveStats(); });
const _onStateExtra = onStateExtra;
onStateExtra = function (m) { _onStateExtra(m); statsTick(); }; // eslint-disable-line no-func-assign

const fmtHours = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)}` : `${Math.round(s / 60)}`);
function dayStreak() {
  let n = 0, t = Date.now();
  if (!(stats.days[dayKey(t)] >= 60)) t -= 86400000; // today may not have started yet; streak counts back from yesterday
  while (stats.days[dayKey(t)] >= 60) { n++; t -= 86400000; }
  return n;
}
function statRow(title, sub, thumbText) {
  const row = document.createElement('div'); row.className = 'hrow';
  const th = document.createElement('div'); th.className = 'th rank'; th.textContent = thumbText;
  const tx = document.createElement('div'); tx.className = 'tx'; const b = document.createElement('b'); b.textContent = title; const sp = document.createElement('span'); sp.textContent = sub; tx.append(b, sp);
  row.append(th, tx); return row;
}
function renderStats() {
  saveStats();
  const tracks = Object.values(stats.tracks), hoursBig = stats.total >= 3600;
  $('st-hours').textContent = fmtHours(stats.total); $('st-hours-label').textContent = hoursBig ? 'hours listened' : 'minutes listened';
  $('st-plays').textContent = stats.plays; $('st-songs').textContent = tracks.length; $('st-days').textContent = dayStreak();
  const bars = $('st-bars'); bars.textContent = '';
  const days = Array.from({ length: 7 }, (_, i) => { const t = Date.now() - (6 - i) * 86400000; return { k: dayKey(t), d: new Date(t) }; });
  const max = Math.max(60, ...days.map((x) => stats.days[x.k] || 0));
  for (const x of days) {
    const col = document.createElement('div'); col.className = 'bar-col'; col.title = `${x.k}: ${fmtHours(stats.days[x.k] || 0)} ${(stats.days[x.k] || 0) >= 3600 ? 'h' : 'min'}`;
    const fill = document.createElement('i'); fill.style.height = `${Math.max(3, Math.round((stats.days[x.k] || 0) / max * 100))}%`;
    const lab = document.createElement('span'); lab.textContent = x.d.toLocaleDateString([], { weekday: 'narrow' });
    col.append(fill, lab); bars.appendChild(col);
  }
  const top = $('st-top'); top.textContent = '';
  const bySecs = tracks.slice().sort((a, b) => b.s - a.s).slice(0, 10);
  if (!bySecs.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Play some music and come back'; top.appendChild(e); }
  bySecs.forEach((t, i) => top.appendChild(statRow(t.t, `${t.a || 'Unknown artist'} · ${t.p} play${t.p === 1 ? '' : 's'} · ${fmtHours(t.s)} ${t.s >= 3600 ? 'h' : 'min'}`, String(i + 1))));
  const art2 = {}; for (const t of tracks) { const k = t.a || 'Unknown artist'; (art2[k] = art2[k] || { s: 0, p: 0 }); art2[k].s += t.s; art2[k].p += t.p; }
  const ar = $('st-artists'); ar.textContent = '';
  Object.entries(art2).sort((a, b) => b[1].s - a[1].s).slice(0, 5).forEach(([name, v], i) => ar.appendChild(statRow(name, `${v.p} play${v.p === 1 ? '' : 's'} · ${fmtHours(v.s)} ${v.s >= 3600 ? 'h' : 'min'}`, String(i + 1))));
}
const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
function statsCsv() {
  const rows = Object.values(stats.tracks).sort((a, b) => b.s - a.s);
  return ['rank,title,artist,plays,minutes_listened,last_played',
    ...rows.map((t, i) => [i + 1, csvCell(t.t), csvCell(t.a), t.p, (t.s / 60).toFixed(1), t.l ? new Date(t.l).toISOString() : ''].join(','))].join('\r\n') + '\r\n';
}
async function exportStats(kind) {
  if (!isPro()) { openPro(); return; }
  saveStats();
  const content = kind === 'csv' ? statsCsv() : JSON.stringify({ exported: new Date().toISOString(), since: new Date(stats.since).toISOString(), totalSeconds: Math.round(stats.total), plays: stats.plays, tracks: stats.tracks, days: stats.days }, null, 2);
  const r = bridge.exportFile ? await bridge.exportFile({ name: `norwinvibe-stats.${kind}`, mime: kind === 'csv' ? 'text/csv' : 'application/json', content }) : { ok: false };
  hud(r && r.ok ? (r.copied ? 'Copied to the clipboard' : 'Saved') : r && r.canceled ? 'Export canceled' : 'Could not export');
}
$('st-csv').onclick = () => exportStats('csv');
$('st-json').onclick = () => exportStats('json');
$('st-reset').onclick = () => { if (confirm('Delete all listening stats on this device?')) { stats = { v: 1, since: Date.now(), total: 0, plays: 0, tracks: {}, days: {} }; statsDirty = true; saveStats(); renderStats(); } };

/* ---------- screensaver: Ambient mode when the computer has been idle (Windows) ---------- */
let ssActive = false, ssStart = 0, ssX = 0, ssY = 0;
if (bridge.onScreensaver) {
  bridge.onScreensaver(() => {
    if (!isPro() || !P.screensaver || ssActive || !st.active || !st.playing || artWide) return; // never over a video (artWide = wide thumbnail)
    ssActive = true; ssStart = performance.now(); ssX = ssY = 0;
    bridge.screensaverState(true); setMode('ambient');
  });
  const leave = () => { if (!ssActive) return; ssActive = false; setMode('none'); bridge.screensaverState(false); };
  ['mousedown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { if (ssActive && performance.now() - ssStart > 1500) leave(); }, { passive: true }));
  window.addEventListener('mousemove', (e) => {
    if (!ssActive || performance.now() - ssStart < 1500) return;
    if (!ssX && !ssY) { ssX = e.screenX; ssY = e.screenY; return; }
    if (Math.hypot(e.screenX - ssX, e.screenY - ssY) > 8) leave();
  }, { passive: true });
  setInterval(() => { if (ssActive && mode === 'none') { ssActive = false; bridge.screensaverState(false); } }, 1000); // left some other way (Esc)
}

/* ---------- OBS overlay / Discord status (Windows): status lines under their switches ---------- */
function refreshProStatus() {
  if (!bridge.proStatus) return;
  bridge.proStatus().then(showProStatus);
}
function showProStatus(s) {
  if (!s) return;
  const obs = $('obs-url'), dc = $('discord-msg');
  if (obs) obs.textContent = !P.obs ? 'A browser source for OBS Studio / Streamlabs showing the song playing.' : s.obs && s.obs.url ? `Add a Browser source with this URL:\n${s.obs.url}` : s.obs && s.obs.error ? `Could not start: ${s.obs.error}` : 'Starting…';
  if (dc) dc.textContent = !P.discord ? 'Shows the song as your Discord activity.' : ({ 'no-id': 'Add your Discord application ID to pro.config.json (see the notes).', connecting: 'Connecting to Discord…', connected: 'Connected. Your Discord activity shows the song.', 'no-discord': 'Discord is not running. Will connect when it starts.', off: '' })[(s.discord && s.discord.state)] || '';
}
if (bridge.onProStatus) bridge.onProStatus(showProStatus);

// The saved preferences can arrive before this file has loaded, so apply everything (locked state, time-of-day theme) once more now.
prefsReady.then(() => showPrefs());


/* ---------- equalizer & crossfade (Android) ---------- */
if (window.vibeFx && $('pop-eq')) {
  const fxe = window.vibeFx, bandsEl = $('eq-bands'), presetsEl = $('eq-presets'), xf = $('xf');
  const hz = (f) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`);
  const PRESET_LABELS = { flat: 'Flat', bass: 'Bass', vocal: 'Vocal', treble: 'Treble', rock: 'Rock', soft: 'Soft' };
  Object.keys(fxe.presets).forEach((k) => { const b = document.createElement('button'); b.dataset.v = k; b.textContent = PRESET_LABELS[k] || k; b.onclick = () => { if (fxe.set({ eq: true, gains: fxe.presets[k], preset: k })) renderEq(); }; presetsEl.appendChild(b); });
  fxe.get().freqs.forEach((f, i) => {
    const row = document.createElement('label'); row.className = 'eq-band';
    const name = document.createElement('span'); name.className = 'hz'; name.textContent = hz(f);
    const r = document.createElement('input'); r.type = 'range'; r.min = -12; r.max = 12; r.step = 1; r.value = 0; r.dataset.i = i;
    const val = document.createElement('b'); val.textContent = '0';
    r.oninput = () => { const g = fxe.get().gains; g[i] = +r.value; fxe.set({ eq: true, gains: g, preset: 'custom' }); val.textContent = `${r.value > 0 ? '+' : ''}${r.value}`; r.style.setProperty('--p', `${(+r.value + 12) / 24 * 100}%`); presetsEl.querySelectorAll('button').forEach((b) => b.classList.remove('on')); $('eq-on').classList.add('on'); };
    row.append(name, r, val); bandsEl.appendChild(row);
  });
  function renderEq() {
    const f = fxe.get();
    $('eq-on').classList.toggle('on', f.eq);
    bandsEl.querySelectorAll('input').forEach((r, i) => { r.value = f.gains[i]; r.style.setProperty('--p', `${(f.gains[i] + 12) / 24 * 100}%`); r.nextSibling.textContent = `${f.gains[i] > 0 ? '+' : ''}${f.gains[i]}`; });
    presetsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.preset));
    xf.value = f.xfade; xf.style.setProperty('--p', `${f.xfade / 12 * 100}%`); $('xf-n').textContent = f.xfade ? `${f.xfade}s` : 'Off';
  }
  $('eq-on').onclick = () => { if (!isPro()) { openPro(); return; } fxe.set({ eq: !fxe.get().eq }); renderEq(); };
  xf.oninput = () => { if (!isPro()) { openPro(); return; } fxe.set({ xfade: +xf.value }); renderEq(); };
  $('btn-eq').onclick = () => { if (!isPro()) { openPro(); return; } closePops(); pops.eq.classList.add('open'); renderEq(); };
}
