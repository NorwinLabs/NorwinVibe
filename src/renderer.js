const $ = (id) => document.getElementById(id);
const el = {
  card: $('card'), bg: $('bg'), wall: $('wall'), vinyl: $('vinyl'), label: $('label'), meta: $('meta'),
  title: $('title'), artist: $('artist'), source: $('source'),
  bar: $('bar'), fill: $('fill'), knob: $('knob'), cur: $('t-cur'), dur: $('t-dur'),
  prev: $('btn-prev'), next: $('btn-next'), play: $('btn-play'),
  mini: $('btn-mini'), shuffle: $('btn-shuffle'), repeat: $('btn-repeat'),
  srcBtn: $('source-btn'), menu: $('menu'), viz: $('viz'),
};

// Outside Electron (e.g. opened in a browser) fall back to a demo feed so the UI can be previewed.
const bridge = window.api || demoApi();

let st = { active: false, playing: false, pos: 0, dur: 0, canSeek: false };
let recvAt = performance.now();
let art = { key: '', data: '' };
let dragging = false, dragFrac = 0;

/* ---------- helpers ---------- */
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const prettyApp = (id) => {
  if (!id) return 'No source';
  let n = id.includes('!') ? id.split('!').pop() : id;
  n = n.replace(/\.exe$/i, '').replace(/^.*_/, '');
  if (/SpotifyAB|Spotify/i.test(id)) return 'Spotify';
  return n.charAt(0).toUpperCase() + n.slice(1);
};
const BROWSERS = /chrome|edge|msedge|firefox|brave|opera|vivaldi|arc/i;
let artWide = false;
const sourceLabel = (m) => {
  const n = prettyApp(m.app);
  return BROWSERS.test(m.app || '') && artWide ? `${n} · Video` : n;
};
// Browser sources (YouTube etc.) carry messy titles; tidy them into artist + song.
function display(m) {
  if (BROWSERS.test(m.app || '') && window.Titles) {
    const c = Titles.cleanMeta(m.title, m.artist, m.dur);
    const via = c.cleaned && c.channel && c.channel.toLowerCase() !== c.artist.toLowerCase() ? `via ${c.channel}` : '';
    return { title: c.title, artist: c.artist, cleaned: c.cleaned, sub: [c.artist, m.album, via].filter(Boolean).join(' · ') };
  }
  return { title: m.title, artist: m.artist, cleaned: false, sub: [m.artist, m.album].filter(Boolean).join(' · ') };
}
const livePos = () => {
  const p = st.pos + (st.playing ? (performance.now() - recvAt) / 1000 : 0);
  return st.dur > 0 ? Math.min(p, st.dur) : p;
};

/* ---------- accent colour from album art ---------- */
const PALETTE_VARS = ['--accent', '--accent-2', '--veil-a', '--veil-b', '--vinyl'];
const clearPalette = () => PALETTE_VARS.forEach((v) => document.documentElement.style.removeProperty(v));

/* When a song has no real picture, the background is not left empty or purple: it gets a colour of its own, picked from the
   song's name, so the same song always gets the same colour and different songs look different. */
function randomPalette(key) {
  if (document.documentElement.dataset.theme && document.documentElement.dataset.theme !== 'art') { clearPalette(); return; }
  let h = 2166136261; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } // FNV-1a
  const hue = h % 360, sat = 62 + ((h >>> 9) % 18), lig = 52 + ((h >>> 14) % 8), shift = 40 + ((h >>> 5) % 40);
  const st2 = document.documentElement.style;
  st2.setProperty('--accent', `hsl(${hue} ${sat}% ${lig + 4}%)`);
  st2.setProperty('--accent-2', `hsl(${(hue + shift) % 360} ${sat - 4}% ${lig}%)`);
  st2.setProperty('--veil-a', '0.5'); st2.setProperty('--veil-b', '0.84');
}

/* Some sources hand over their own logo (a browser's icon, a favicon) instead of cover art. It is not a picture of the song, so
   it is not shown. Logos have transparent corners and gaps, which photos and thumbnails do not; favicons are also tiny. */
const artRejected = new Set(); let artCheckToken = 0, artPending = '', shownKey = null, swapTimer = 0; // shownKey: the song whose cover is on the record
function isAppIcon(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve({ icon: false });
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      try {
        const S = 48, c = document.createElement('canvas'); c.width = S; c.height = S;
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, S, S);
        const d = x.getImageData(0, 0, S, S).data; let clear = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] < 128) clear++;
        if (clear / (S * S) >= 0.06) return resolve({ icon: true, reason: 'transparent', w, h });
      } catch {}
      resolve({ icon: Math.max(w, h) <= 64, reason: 'tiny', w, h });
    };
    img.src = dataUrl;
  });
}

/* Adapts the whole look (accent colours + how dark the veil over the blurred art is) to the current thumbnail.
   Handles what video thumbnails throw at it: letterbox/pillarbox bars, grey or very dark frames, bright frames. */
function applyPalette(dataUrl) {
  if (document.documentElement.dataset.theme && document.documentElement.dataset.theme !== 'art') { clearPalette(); return; }
  if (!dataUrl) { if (st.active) randomPalette(lastKey || ''); else clearPalette(); return; }
  const img = new Image();
  img.onload = () => {
    const W = 48, H = Math.max(12, Math.min(48, Math.round(W * img.naturalHeight / img.naturalWidth)));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    const px = (i, j) => { const o = (j * W + i) * 4; return [d[o], d[o + 1], d[o + 2]]; };
    const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const lineDark = (pts) => pts.reduce((n, p) => n + lum(p), 0) / pts.length < 0.06; // an (almost) black bar
    // trim black bars so they don't skew the colours
    let top = 0, bot = H - 1, left = 0, right = W - 1;
    while (top < H / 3 && lineDark(Array.from({ length: W }, (_, i) => px(i, top)))) top++;
    while (bot > H * 2 / 3 && lineDark(Array.from({ length: W }, (_, i) => px(i, bot)))) bot--;
    while (left < W / 4 && lineDark(Array.from({ length: H }, (_, j) => px(left, j)))) left++;
    while (right > W * 3 / 4 && lineDark(Array.from({ length: H }, (_, j) => px(right, j)))) right--;

    const buckets = new Map(); let sum = [0, 0, 0], n = 0;
    for (let j = top; j <= bot; j++) for (let i = left; i <= right; i++) {
      const [r, g, b] = px(i, j);
      sum[0] += r; sum[1] += g; sum[2] += b; n++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      if (mx < 50 || sat < .22) continue; // skip near-black and grey pixels when looking for a hue
      const k = `${r >> 5},${g >> 5},${b >> 5}`;
      const e = buckets.get(k) || { w: 0, r: 0, g: 0, b: 0 }, w = sat * (mx / 255) + .05;
      e.w += w; e.r += r * w; e.g += g * w; e.b += b * w; buckets.set(k, e);
    }
    const avg = n ? sum.map((v) => v / n) : [40, 40, 50], L = lum(avg);
    const hue = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn; if (!dd) return 0; const h = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; return (h * 60 + 360) % 360; };
    // best colour, then the best colour that is clearly a different hue
    const ranked = [...buckets.values()].sort((p, q) => q.w - p.w).map((e) => [e.r / e.w, e.g / e.w, e.b / e.w]);
    const first = ranked[0];
    const second = first && ranked.find((c2) => { const dh = Math.abs(hue(c2) - hue(first)); return Math.min(dh, 360 - dh) > 35; });
    const lift = ([r, g, b]) => { const m = Math.max(r, g, b) || 1, f = m < 150 ? 150 / m : 1; return `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`; };
    let a1, a2;
    if (first) { a1 = lift(first); a2 = lift(second || [first[2], first[0], first[1]]); }
    else { // a grey / black-and-white / very dark frame: a cool neutral tinted by the frame's own average, not the default purple
      const t = (k) => Math.min(255, 150 + (avg[k] - 128) * 0.6) | 0;
      a1 = `rgb(${t(0)},${t(1) + 8},${t(2) + 22})`; a2 = `rgb(${t(0) - 40},${t(1) - 30},${t(2) - 10})`;
    }
    const st2 = document.documentElement.style;
    st2.setProperty('--accent', a1); st2.setProperty('--accent-2', a2);
    // the "Album" record takes the cover's own dominant colour (not the lifted accent), kept mid-tone so it still reads as vinyl
    const vc = first || avg, vm = Math.max(...vc) || 1, vf = vm > 175 ? 175 / vm : vm < 80 ? 80 / vm : 1;
    st2.setProperty('--vinyl', `rgb(${Math.min(255, vc[0] * vf) | 0},${Math.min(255, vc[1] * vf) | 0},${Math.min(255, vc[2] * vf) | 0})`);
    // brighter frames get a darker veil so the text stays readable; dark frames can show more of the art
    const va = L > 0.6 ? 0.62 : L > 0.4 ? 0.54 : L < 0.15 ? 0.38 : 0.46;
    st2.setProperty('--veil-a', String(va)); st2.setProperty('--veil-b', String(Math.min(0.9, va + 0.37)));
  };
  img.src = dataUrl;
}

function showNoArt() { // blank background + a colour of its own for this song
  artWide = false; shownKey = null; clearTimeout(swapTimer); el.label.classList.remove('changing');
  el.label.classList.remove('art'); el.label.style.backgroundImage = '';
  el.bg.style.backgroundImage = ''; el.bg.classList.remove('on'); el.wall.classList.add('on');
  applyPalette('');
}
/* a new song arrived but its cover has not: keep the old cover (dimmed) for a moment instead of flashing an empty record,
   and give up on it if the new one never comes */
function keepArtWhileLoading(key) {
  if (!el.label.classList.contains('art')) { showArt(''); return; }
  ++artCheckToken; artPending = ''; shownKey = null;
  el.label.classList.add('changing');
  clearTimeout(swapTimer);
  swapTimer = setTimeout(() => { if (lastKey === key && shownKey !== key) showNoArt(); }, 900);
}
function showArt(data) {
  const token = ++artCheckToken;
  if (!data) { artPending = ''; showNoArt(); return; }
  const key = lastKey; artPending = key;
  isAppIcon(data).then((r) => {
    if (token !== artCheckToken) return; // another song arrived while checking
    artPending = '';
    if (r.icon) { artRejected.add(key); if (artRejected.size > 300) artRejected.clear(); if (bridge.artRejected) bridge.artRejected(key); showNoArt(); return; }
    artRejected.delete(key); artWide = false; shownKey = key; clearTimeout(swapTimer); el.label.classList.remove('changing'); el.wall.classList.remove('on');
    const i = new Image(); i.onload = () => { artWide = i.naturalWidth / i.naturalHeight > 1.5; if (st.active) el.source.textContent = sourceLabel(st); }; i.src = data;
    el.label.classList.add('art'); el.label.style.backgroundImage = `url("${data}")`;
    el.bg.style.backgroundImage = `url("${data}")`; el.bg.classList.add('on');
    applyPalette(data);
  });
}

/* ---------- title marquee ---------- */
function fitTitle() {
  const s = el.title; s.classList.remove('scroll');
  const over = s.scrollWidth - s.parentElement.clientWidth;
  if (over > 4) {
    s.style.setProperty('--shift', `-${over + 8}px`);
    s.style.setProperty('--dur', `${Math.max(8, over / 18 + 4)}s`);
    s.classList.add('scroll');
  }
}

/* ---------- state ---------- */
let lastKey = null;
// After a play/pause click, ignore updates that still report the old state until the app confirms (or ~1.5s passes).
let pendingPlay = null;
function onState(m) {
  if (pendingPlay) {
    if (!m.active || m.playing === pendingPlay.value || performance.now() > pendingPlay.until) pendingPlay = null;
    else m = { ...m, playing: pendingPlay.value, pos: livePos() };
  }
  const wasPlaying = st.playing;
  st = { ...st, ...m };
  recvAt = performance.now();
  if (dragging) st.pos = st.pos; // keep scrubbing UI stable

  if (m.active) {
    el.card.classList.remove('idle');
    el.source.textContent = sourceLabel(m);
  } else {
    el.card.classList.add('idle');
    el.source.textContent = 'No source';
  }
  el.card.classList.toggle('playing', !!(m.active && m.playing));

  const key = m.active ? m.key : '';
  if (key !== lastKey) {
    lastKey = key;
    const d = m.active ? display(m) : null;
    el.title.textContent = m.active ? (d.title || 'Unknown title') : 'Nothing playing';
    el.artist.textContent = m.active ? d.sub || prettyApp(m.app) : (bridge.idleText || 'Play something in Spotify, your browser, or any media app');
    el.card.title = m.active && d.cleaned ? `Original: ${m.title} — ${m.artist}` : '';
    el.meta.classList.remove('enter'); void el.meta.offsetWidth; el.meta.classList.add('enter');
    fitTitle();
    if (typeof onTrackChange === 'function') onTrackChange(m, d);
    if (m.active && art.key !== key) keepArtWhileLoading(key);
    if (!m.active) showArt('');
    el.card.classList.add('swap'); setTimeout(() => el.card.classList.remove('swap'), 450);
  }
  if (m.active && art.key === key && art.data && shownKey !== key && !artRejected.has(key) && artPending !== key) showArt(art.data);

  el.prev.disabled = !m.active || m.canPrev === false;
  el.next.disabled = !m.active || m.canNext === false;
  const seekable = m.active && m.canSeek && st.dur > 0;
  el.bar.classList.toggle('off', !seekable);
  el.shuffle.classList.toggle('on', !!m.shuffle);
  el.shuffle.disabled = !m.active || !m.canShuffle;
  el.repeat.classList.toggle('on', m.repeat === 'List' || m.repeat === 'Track');
  el.repeat.classList.toggle('track', m.repeat === 'Track');
  el.repeat.disabled = !m.active || !m.canRepeat;
  renderMenu(m);
  if (typeof onStateExtra === 'function') onStateExtra(m);
  el.play.title = wasPlaying || m.playing ? 'Pause (Space)' : 'Play (Space)';
}
function onArt(m) {
  art = m;
  if (typeof onArtFeat === 'function') onArtFeat(m);
  if (m.key === lastKey) showArt(m.data);
}
bridge.onState(onState);
bridge.onArt(onArt);

/* ---------- controls ---------- */
const send = (c) => bridge.cmd(c);
el.play.onclick = () => {
  if (!st.active) { if (bridge.idlePlay) bridge.idlePlay(); return; } // nothing loaded yet: the phone starts a song from the library / playlist
  st.pos = livePos(); recvAt = performance.now();
  st.playing = !st.playing; el.card.classList.toggle('playing', st.playing); // optimistic
  pendingPlay = { value: st.playing, until: performance.now() + 1500 };
  send('toggle');
};
el.prev.onclick = () => send('prev');
el.next.onclick = () => send('next');
el.shuffle.onclick = () => send(`shuffle:${st.shuffle ? 0 : 1}`);
el.repeat.onclick = () => send(`repeat:${{ None: 'List', List: 'Track', Track: 'None' }[st.repeat] || 'List'}`);
const seekTo = (s) => { s = Math.max(0, Math.min(st.dur || s, s)); st.pos = s; recvAt = performance.now(); send(`seek:${s.toFixed(2)}`); };

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); el.play.click(); }
  else if (e.code === 'ArrowLeft' && st.canSeek) seekTo(livePos() - 10); // keyboard still jumps 10 seconds
  else if (e.code === 'ArrowRight' && st.canSeek) seekTo(livePos() + 10);
  else if (e.code === 'ArrowUp') el.next.click();
  else if (e.code === 'ArrowDown') el.prev.click();
});

/* scrubbing */
const fracFromEvent = (e) => { const r = el.bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
el.bar.addEventListener('pointerdown', (e) => { dragging = true; el.bar.classList.add('drag'); el.bar.setPointerCapture(e.pointerId); dragFrac = fracFromEvent(e); });
el.bar.addEventListener('pointermove', (e) => { if (dragging) dragFrac = fracFromEvent(e); });
el.bar.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; el.bar.classList.remove('drag'); seekTo(fracFromEvent(e) * st.dur); });

/* ---------- source switcher ---------- */
let menuSig = '';
function renderMenu(m) {
  const list = (m.sessions || []);
  el.card.classList.toggle('multi', list.length > 1);
  const sig = JSON.stringify([list, m.appId, m.selected]);
  if (sig === menuSig) return; menuSig = sig;
  el.menu.textContent = '';
  const add = (id, name, sub, on, sel) => {
    const b = document.createElement('button'); b.className = sel ? 'sel' : '';
    b.innerHTML = '<i class="dot"></i><div class="txt"><b></b><span></span></div>';
    b.querySelector('.dot').classList.toggle('on', on);
    b.querySelector('b').textContent = name; b.querySelector('span').textContent = sub;
    b.onclick = () => { send(`select:${id}`); closeMenu(); };
    el.menu.appendChild(b);
  };
  add('auto', 'Auto', 'Follow whatever is playing', false, !m.selected);
  list.forEach((x) => add(x.id, prettyApp(x.id), [x.title, x.artist].filter(Boolean).join(' — ') || 'Idle', x.playing, m.selected && x.id === m.appId));
}
const closeMenu = () => el.menu.classList.remove('open');
el.srcBtn.onclick = (e) => { e.stopPropagation(); if (el.card.classList.contains('multi')) el.menu.classList.toggle('open'); };
document.addEventListener('click', closeMenu);

/* window buttons */
let mini = false;
const setMini = (on, push = true) => { mini = on; document.body.classList.toggle('mini', on); if (push) bridge.mini(on); requestAnimationFrame(fitTitle); setTimeout(fitTitle, 400); };
el.mini.onclick = () => setMini(!mini);
$('btn-close').onclick = () => bridge.close();
$('btn-minimize').onclick = () => bridge.minimizeWindow && bridge.minimizeWindow();
el.card.addEventListener('dblclick', (e) => { if (e.target.closest('button, .bar, .pop, .vinyl, .lyrics')) return; setMini(!mini); });
const prefsReady = bridge.prefs();
prefsReady.then((p) => setMini(p.mini, false));

/* ---------- audio-reactive ring (system loopback; falls back to a soft synthetic pulse) ---------- */
const BARS = 72;
let analyser = null, freq = null;
const levels = new Float32Array(BARS);
async function initAudio() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!stream.getAudioTracks().length) return;
    const ctx = new AudioContext();
    analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .78;
    ctx.createMediaStreamSource(stream).connect(analyser); // analysis only, never routed to speakers
    freq = new Uint8Array(analyser.frequencyBinCount);
  } catch { analyser = null; }
}
if (window.api && !window.api.noLoopback) initAudio();

let calmMode = false; // Calm mode: no spin, no moving ring (set from extras.js)
const vctx = el.viz.getContext('2d');
let accentCache = ['#8b5cf6', '#ec4899'], accentAt = -1e9;
function drawViz(t, playing) {
  const mode = document.documentElement.dataset.viz || 'bars';
  const W = el.viz.width, c = W / 2;
  vctx.clearRect(0, 0, W, W);
  if (mode === 'off' || calmMode) return;
  if (analyser && playing) analyser.getByteFrequencyData(freq);
  for (let i = 0; i < BARS; i++) {
    const m = i < BARS / 2 ? i : BARS - 1 - i; // mirror so the ring is symmetric
    let v = 0;
    if (playing) {
      if (analyser) v = freq[2 + Math.floor((m / (BARS / 2)) ** 1.6 * 90)] / 255;
      else v = .35 + .3 * Math.sin(t / 260 + m * .55) * Math.sin(t / 700 + m * .2);
    }
    levels[i] += (v - levels[i]) * (v > levels[i] ? .5 : .12);
  }
  const base = W * (118 / 272);
  const maxLen = c - base - (mode === 'cyber' ? 14 : mode === 'nightcity' ? 6 : 3); // keep everything inside the canvas
  const at = (i, r) => { const a = (i / BARS) * Math.PI * 2 - Math.PI / 2; return [c + Math.cos(a) * r, c + Math.sin(a) * r]; };
  if (t - accentAt > 400) { const cs = getComputedStyle(document.documentElement); accentCache = [cs.getPropertyValue('--accent').trim() || '#8b5cf6', cs.getPropertyValue('--accent-2').trim() || '#ec4899']; accentAt = t; } // reading styles every frame forces a style recalculation
  const [a1, a2] = accentCache;
  const g = vctx.createLinearGradient(0, 0, W, W); g.addColorStop(0, a1); g.addColorStop(1, a2);
  vctx.lineCap = 'round'; vctx.lineJoin = 'round';

  if (mode === 'bars') {
    vctx.strokeStyle = g; vctx.lineWidth = 5;
    for (let i = 0; i < BARS; i++) {
      const [x1, y1] = at(i, base), [x2, y2] = at(i, base + 2 + levels[i] * (maxLen - 2));
      vctx.beginPath(); vctx.moveTo(x1, y1); vctx.lineTo(x2, y2);
      vctx.globalAlpha = .35 + levels[i] * .65; vctx.stroke();
    }
  } else if (mode === 'dots') {
    vctx.fillStyle = g;
    for (let i = 0; i < BARS; i++) {
      const [x, y] = at(i, base + 6 + levels[i] * (maxLen - 8));
      vctx.beginPath(); vctx.arc(x, y, 2.5 + levels[i] * 4, 0, Math.PI * 2);
      vctx.globalAlpha = .45 + levels[i] * .55; vctx.fill();
    }
  } else if (mode === 'wave') {
    const pts = Array.from({ length: BARS }, (_, i) => at(i, base + 5 + levels[i] * (maxLen - 6)));
    vctx.beginPath();
    pts.forEach((p, i) => { const n = pts[(i + 1) % BARS], mx = (p[0] + n[0]) / 2, my = (p[1] + n[1]) / 2; if (!i) vctx.moveTo(mx, my); else vctx.quadraticCurveTo(p[0], p[1], mx, my); });
    const f = pts[0], n = pts[1]; vctx.quadraticCurveTo(f[0], f[1], (f[0] + n[0]) / 2, (f[1] + n[1]) / 2);
    vctx.strokeStyle = g; vctx.lineWidth = 4; vctx.globalAlpha = .95; vctx.stroke();
    vctx.fillStyle = g; vctx.globalAlpha = .12; vctx.fill();
  } else if (mode === 'cyber') { // twin offset neon bars (chromatic split) + a slowly turning dashed outer ring
    for (const [col, dx] of [['#05d9e8', 2.5], ['#ff2a6d', -2.5]]) {
      vctx.strokeStyle = col; vctx.lineWidth = 3; vctx.shadowColor = col; vctx.shadowBlur = 10;
      for (let i = 0; i < BARS; i += 2) {
        const [x1, y1] = at(i, base + 2), [x2, y2] = at(i, base + 4 + levels[i] * (maxLen - 4));
        vctx.beginPath(); vctx.moveTo(x1 + dx, y1); vctx.lineTo(x2 + dx, y2);
        vctx.globalAlpha = .55 + levels[i] * .45; vctx.stroke();
      }
    }
    vctx.shadowBlur = 0; vctx.globalAlpha = .8; vctx.strokeStyle = '#fcee0a'; vctx.lineWidth = 2;
    vctx.setLineDash([3, 10]); vctx.lineDashOffset = -t / 30;
    vctx.beginPath(); vctx.arc(c, c, c - 4, 0, Math.PI * 2); vctx.stroke(); vctx.setLineDash([]);
  }
  else if (mode === 'nightcity') { // HUD-style segmented level meters: red blocks with a cyan peak, plus cyan base arcs and a glitch flicker
    const segs = 5, gap = (maxLen - 4) / segs;
    vctx.lineWidth = 4; vctx.lineCap = 'butt'; vctx.shadowColor = '#ff2b4e'; vctx.shadowBlur = 8;
    for (let i = 0; i < BARS; i += 2) {
      const lit = Math.max(1, Math.round(levels[i] * segs));
      for (let k = 0; k < lit; k++) {
        const [x1, y1] = at(i, base + 4 + k * gap), [x2, y2] = at(i, base + 4 + k * gap + gap * .62);
        vctx.strokeStyle = k === segs - 1 ? '#46f0e4' : '#ff2b4e';
        vctx.beginPath(); vctx.moveTo(x1, y1); vctx.lineTo(x2, y2); vctx.globalAlpha = .55 + (k / segs) * .45; vctx.stroke();
      }
    }
    vctx.shadowColor = '#46f0e4'; vctx.globalAlpha = .9; vctx.strokeStyle = '#46f0e4'; vctx.lineWidth = 2;
    const spin = t / 4000;
    for (let q = 0; q < 4; q++) { vctx.beginPath(); vctx.arc(c, c, base + 1, spin + q * Math.PI / 2, spin + q * Math.PI / 2 + 0.9); vctx.stroke(); }
    if (Math.sin(t / 700) > 0.985) { vctx.globalAlpha = .6; vctx.strokeStyle = '#46f0e4'; vctx.lineWidth = 6; vctx.beginPath(); vctx.arc(c, c, base + 9, 0.3, 1.2); vctx.stroke(); }
  }
  vctx.globalAlpha = 1; vctx.shadowBlur = 0;
}

/* ---------- animation loop: record spin + progress ---------- */
let angle = 0, vel = 0, last = performance.now();
let recordDeg = 96; // degrees per second at full speed; set from the Record speed setting
let scratch = null; // set while the record is being dragged: { pos, startPos, lastAng, total }

/* Drag the record to scrub: one full turn = 30 seconds of audio. */
const SCRATCH_SECS_PER_TURN = 30;
const pointerAngle = (e) => { const r = el.vinyl.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
el.vinyl.addEventListener('pointerdown', (e) => {
  if (!st.active || !(st.dur > 0) || !st.canSeek) return;
  el.vinyl.setPointerCapture(e.pointerId);
  scratch = { pos: livePos(), startPos: livePos(), lastAng: pointerAngle(e) };
  document.body.classList.add('scratching');
});
el.vinyl.addEventListener('pointermove', (e) => {
  if (!scratch) return;
  const a = pointerAngle(e); let d = a - scratch.lastAng;
  if (d > 180) d -= 360; if (d < -180) d += 360;
  scratch.lastAng = a; angle = (angle + d + 360) % 360; el.vinyl.style.transform = `rotate(${angle}deg)`;
  scratch.pos = Math.min(st.dur, Math.max(0, scratch.pos + d / 360 * SCRATCH_SECS_PER_TURN));
});
const endScratch = () => { if (!scratch) return; const p = scratch.pos; scratch = null; document.body.classList.remove('scratching'); seekTo(p); };
el.vinyl.addEventListener('pointerup', endScratch);
el.vinyl.addEventListener('pointercancel', endScratch);
let lastDraw = 0, lastPlayingAt = 0, lastPct = '', lastCur = '', lastDurTxt = '';
function frame(t) {
  requestAnimationFrame(frame);
  const playing = el.card.classList.contains('playing');
  if (playing) lastPlayingAt = t;
  // Phones draw at ~30 fps (window.FRAME_MS), and anything sitting still (paused for a while, nothing playing) at 10 fps:
  // the record and ring look the same but the CPU/GPU and battery do far less.
  const resting = !playing && vel < .05 && !scratch && !dragging && !needleDrag && t - lastPlayingAt > 2500;
  const gap = resting ? 100 : (window.FRAME_MS || 0);
  if (gap && t - lastDraw < gap - 3) return;
  lastDraw = t;
  const dt = Math.min(.1, (t - last) / 1000); last = t;
  const target = playing && !calmMode ? recordDeg : 0; // eases in and out like a real platter
  vel += (target - vel) * (1 - Math.exp(-dt * (target ? 1.8 : 1.1)));
  if (!scratch || scratch.needle) { if (vel > .05) { angle = (angle + vel * dt) % 360; el.vinyl.style.transform = `rotate(${angle}deg)`; } }

  if (!resting || el.viz.dataset.clean !== '1') { drawViz(t, playing); el.viz.dataset.clean = resting && !levels.some((v) => v > .01) ? '1' : ''; }
  const scrubbing = dragging || scratch;
  const frac = dragging ? dragFrac : scratch ? scratch.pos / (st.dur || 1) : (st.dur > 0 ? livePos() / st.dur : 0);
  const pct = `${(Math.min(1, Math.max(0, frac)) * 100).toFixed(2)}%`;
  if (pct !== lastPct) { lastPct = pct; el.fill.style.width = pct; el.knob.style.left = pct; }
  const shown = dragging ? frac * st.dur : scratch ? scratch.pos : livePos();
  const curTxt = st.active ? fmt(shown) : '0:00'; if (curTxt !== lastCur) { lastCur = curTxt; el.cur.textContent = curTxt; }
  const durTxt = st.active && st.dur > 0 ? fmt(st.dur) : '--:--'; if (durTxt !== lastDurTxt) { lastDurTxt = durTxt; el.dur.textContent = durTxt; }
  if (typeof featFrame === 'function') featFrame(t, scrubbing ? shown : livePos());
}
requestAnimationFrame(frame);

/* ---------- demo feed (browser preview only) ---------- */
function demoApi() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6a3d"/><stop offset="1" stop-color="#7a1fa2"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="150" cy="150" r="70" fill="#ffd166"/></svg>`;
  const data = 'data:image/svg+xml;base64,' + btoa(svg);
  let s = { type: 'state', active: true, key: 'demo', app: 'Spotify', playing: true, title: 'Midnight City (Extended Mix)', artist: 'M83', album: "Hurry Up, We're Dreaming", pos: 62, dur: 244, canPrev: true, canNext: true, canSeek: true, shuffle: false, repeat: 'None', canShuffle: true, canRepeat: true, selected: false, appId: 'Spotify', sessions: [{ id: 'Spotify', title: 'Midnight City', artist: 'M83', playing: true }, { id: 'Chrome', title: 'lofi hip hop radio', artist: 'Lofi Girl', playing: false }] };
  let cbS = () => {}, cbA = () => {};
  const q = new URLSearchParams(location.search);
  setTimeout(() => { if (q.get('idle') === null) { cbS(s); cbA({ type: 'art', key: 'demo', data }); } else cbS({ type: 'state', active: false }); if (q.has('paused')) cbS({ ...s, playing: false }); }, 150);
  setInterval(() => { if (s.playing) s.pos = Math.min(s.dur, s.pos + .4); }, 400);
  return {
    onState: (f) => (cbS = f), onArt: (f) => (cbA = f),
    cmd: (c) => { if (c === 'toggle') s.playing = !s.playing; if (c.startsWith('shuffle:')) s.shuffle = c.endsWith('1'); if (c.startsWith('repeat:')) s.repeat = c.slice(7); if (c.startsWith('seek:')) s.pos = parseFloat(c.slice(5)); cbS({ ...s }); },
    prefs: async () => ({ mini: q.has('mini'), pin: true, speed: 'slow', theme: q.get('theme') || 'art', record: q.get('record') || 'vinyl', needle: q.get('needle') || 'classic', viz: q.get('viz') || 'bars', owned: JSON.parse(localStorage.getItem('demo.owned') || '[]'), lyrics: true, toasts: true, fade: false, snap: true, autostart: false, sleepEnds: 0 }),
    setPrefs() {}, onOwned() {},
    storeInfo: async () => ({ testMode: true, owned: JSON.parse(localStorage.getItem('demo.owned') || '[]'), items: { cyberpunk: { name: 'Cyberpunk', price: '$0.99', hasCheckout: false }, nightcity: { name: 'Night City', price: '$0.99', hasCheckout: false } } }),
    storeBuy: async () => ({ ok: false, error: 'Checkout is not set up yet. Add a checkoutUrl in store.config.json.' }),
    storeRedeem: async () => ({ ok: false, error: 'That license key is not valid.' }),
    storeTestUnlock: async (id) => { const o = JSON.parse(localStorage.getItem('demo.owned') || '[]'); localStorage.setItem('demo.owned', JSON.stringify([...new Set([...o, id])])); return { ok: true }; },
    toast() {}, sleep() {}, onSleep() {}, onPin() {}, fullscreen() {},
    lyrics: async () => ({ synced: ['[00:00.00] Waiting in a car', '[00:04.50] Waiting for a ride in the dark', '[00:09.00] The night city grows', '[00:13.50] Look and see the casting shadows', '[00:18.00] Neon lights a way for me', '[00:22.50] Down the road we go', '[00:27.00] Midnight city never sleeps', '[00:31.50] Hold me through the dark', '[00:36.00] Sing along and let it start', '[00:40.50] We are the city lights'].join('\n'), plain: '' }),
    close() {}, minimize() {}, minimizeWindow() {}, pin() {}, mini() {},
  };
}
