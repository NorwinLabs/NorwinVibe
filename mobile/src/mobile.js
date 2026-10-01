/* NorwinVibe for Android.
   Implements the same `window.api` bridge the Electron preload gives the desktop UI, but backed by a local music
   library (IndexedDB) and an <audio> element, so renderer.js / features.js run here unchanged.
   Must load BEFORE renderer.js. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const cap = window.Capacitor || null;
  const plugin = (name) => { try { return (cap && (cap.Plugins?.[name] || cap.registerPlugin?.(name))) || null; } catch { return null; } };
  const toast = (t) => { if (typeof hud === 'function') hud(t); };

  /* ================= preferences & store (mirrors main.js) ================= */
  const DEFAULTS = { pin: true, mini: false, theme: 'art', record: 'vinyl', speed: 'slow', needle: 'classic', viz: 'bars', bgart: 'cover', autotheme: false, autoDay: 'art', autoEve: 'retro', autoNight: 'midnight', fadeout: false, smartshuffle: false, screensaver: false, ssMin: '5', obs: false, discord: false, lyrics: true, toasts: false, fade: false, snap: false, autostart: false };
  const THEMES = ['art', 'midnight', 'retro', 'neon', 'cyberpunk', 'nightcity'];
  const PRO_KEYS = new Set(['autotheme', 'autoDay', 'autoEve', 'autoNight', 'fadeout', 'smartshuffle']); // only settable with a Pro license (desktop-only Pro switches are not offered here)
  const ENUMS = {
    bgart: ['cover', 'soft', 'off'],
    autoDay: THEMES, autoEve: THEMES, autoNight: THEMES, ssMin: ['1', '3', '5', '10'],
    speed: ['slow', 'relaxed', '33', '45'],
    theme: ['art', 'midnight', 'retro', 'neon', 'cyberpunk', 'nightcity'],
    record: ['vinyl', 'color', 'cd', 'cyber', 'nightcity'],
    needle: ['classic', 'gold', 'minimal', 'cyber', 'nightcity'],
    viz: ['bars', 'dots', 'wave', 'off', 'cyber', 'nightcity'],
  };
  const PAID = {
    cyberpunk: { theme: ['cyberpunk'], record: ['cyber'], needle: ['cyber'], viz: ['cyber'] },
    nightcity: { theme: ['nightcity'], record: ['nightcity'], needle: ['nightcity'], viz: ['nightcity'] },
  };
  /* ---- entitlements: derived ONLY from signed license keys, re-verified every time (see main.js on the desktop) ---- */
  const b64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  const hex = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
  const PACK_IDS = Object.keys(PAID), KNOWN_ITEMS = new Set([...PACK_IDS, 'pro', 'dev']);
  function verifyLicense(key) { // key = base64url(payload) + '.' + base64url(ed25519 signature); returns the payload or null
    try {
      const [p, sig] = String(key).trim().split('.');
      const payload = b64u(p);
      if (!window.nacl || !window.nacl.sign.detached.verify(payload, b64u(sig), hex(window.LICENSE_PUBKEY_HEX))) return null;
      const o = JSON.parse(new TextDecoder().decode(payload));
      if (!KNOWN_ITEMS.has(o.item)) return null;
      if (o.exp && Date.now() > o.exp) return null;
      return o;
    } catch { return null; }
  }
  let prefs = LS.get('vibe.prefs', {});
  let licenses = LS.get('vibe.licenses', []);
  let entitled = new Set(), devActive = false;
  try { localStorage.removeItem('vibe.owned'); } catch {} // older builds trusted a plain flag; entitlements now come only from keys
  function recompute() {
    const real = new Set();
    for (const k of licenses) { const o = verifyLicense(k); if (o) real.add(o.item); }
    devActive = real.has('dev');
    const set = new Set();
    if (devActive && prefs.devAsFree) set.add('dev');
    else { real.forEach((i) => set.add(i)); if (devActive) set.add('pro'); if (set.has('pro')) PACK_IDS.forEach((i) => set.add(i)); }
    entitled = set;
  }
  const entitlementList = () => [...entitled];
  const allowed = (k, v) => { for (const [id, u] of Object.entries(PAID)) if (u[k] && u[k].includes(v)) return entitled.has(id); return true; };
  const savePrefs = () => LS.set('vibe.prefs', prefs);
  const dropLockedChoices = () => { for (const k of Object.keys(ENUMS)) if (k in prefs && !allowed(k, prefs[k])) delete prefs[k]; };
  recompute(); dropLockedChoices();

  /* ================= music library (IndexedDB) ================= */
  const dbp = new Promise((res, rej) => {
    const r = indexedDB.open('vibe-lib', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('meta', { keyPath: 'id' }); r.result.createObjectStore('blobs', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const dbDo = (store, mode, fn) => dbp.then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
  }));
  const dbMulti = (stores, fn) => dbp.then((db) => new Promise((res, rej) => {
    const t = db.transaction(stores, 'readwrite'); fn(...stores.map((s) => t.objectStore(s)));
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  }));

  let lib = []; // track metadata, sorted by artist then title
  const sortLib = () => lib.sort((a, b) => (a.artist || '').localeCompare(b.artist || '') || a.title.localeCompare(b.title));
  const libReady = dbDo('meta', 'readonly', (s) => s.getAll()).then((all) => { lib = all || []; sortLib(); }).catch(() => {});

  const readTags = (file) => new Promise((res) => {
    if (!window.jsmediatags) return res({});
    try { window.jsmediatags.read(file, { onSuccess: (t) => res(t.tags || {}), onError: () => res({}) }); } catch { res({}); }
  });
  async function thumb(pic) { // embedded cover art -> small JPEG data URL
    try {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(pic.data)], { type: pic.format || 'image/jpeg' }));
      const s = Math.min(1, 400 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    } catch { return ''; }
  }
  const readDuration = (file) => new Promise((res) => {
    const a = new Audio(), url = URL.createObjectURL(file);
    const done = (d) => { URL.revokeObjectURL(url); res(Number.isFinite(d) ? d : 0); };
    a.preload = 'metadata'; a.onloadedmetadata = () => done(a.duration); a.onerror = () => done(0); setTimeout(() => done(0), 6000); a.src = url;
  });
  async function addFiles(files) {
    await libReady;
    let added = 0; const list = [...files];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (lib.some((t) => t.name === f.name && t.size === f.size)) continue; // already in the library
      toast(`Adding ${i + 1} of ${list.length}…`);
      const tags = await readTags(f);
      let title = (tags.title || '').trim(), artist = (tags.artist || '').trim();
      if (!title) { // fall back to the file name, understanding "Artist - Title"
        const base = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim(), m = base.split(/\s+-\s+/);
        if (m.length >= 2 && !artist) { artist = m[0]; title = m.slice(1).join(' - '); } else title = base;
      }
      const rec = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()), name: f.name, size: f.size, type: f.type,
        title, artist, album: (tags.album || '').trim(), dur: await readDuration(f), art: tags.picture ? await thumb(tags.picture) : '', added: Date.now(),
      };
      await dbMulti(['meta', 'blobs'], (m, b) => { m.put(rec); b.put({ id: rec.id, blob: f }); });
      lib.push(rec); added++;
    }
    sortLib(); toast(added ? `Added ${added} song${added === 1 ? '' : 's'}` : 'Those songs are already in your library');
    renderLibrary(); if (order.length === 0 || added) buildOrder(cur && cur.id);
  }
  /* ---- scan the phone: songs found this way are only indexed here (no copy); the file is read when played ---- */
  const scanner = plugin('MusicScan');
  const fileUrl = (path) => (cap && cap.convertFileSrc ? cap.convertFileSrc('file://' + path) : path);
  async function getBlob(t) { // the audio bytes for a track
    if (t.path) { const r = await fetch(fileUrl(t.path)); if (!r.ok) throw new Error('missing'); return r.blob(); }
    const rec = await dbDo('blobs', 'readonly', (s) => s.get(t.id)); if (!rec) throw new Error('missing'); return rec.blob;
  }
  const splitName = (base) => { const m = base.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim().split(/\s+-\s+/); return m.length >= 2 ? { artist: m[0], title: m.slice(1).join(' - ') } : { artist: '', title: m[0] }; };
  const known = (v) => (v && v !== '<unknown>' ? String(v).trim() : '');
  let scanning = false;
  async function scanPhone(prompt) {
    if (!scanner || scanning) { if (!scanner && prompt) toast('Scanning only works in the phone app'); return; }
    scanning = true; if (prompt) toast('Looking for music on your phone\u2026');
    try {
      await libReady;
      const res = await scanner.scan({ prompt: !!prompt });
      if (!res.granted) { if (prompt) toast(res.denied ? 'Allow music access to find your songs' : 'Music access needed'); return; }
      const found = res.tracks || [], paths = new Set(found.map((x) => x.path)), have = new Map(lib.filter((t) => t.path).map((t) => [t.path, t]));
      const fresh = found.filter((x) => !have.has(x.path)).map((x) => {
        const fb = splitName(x.name || x.path.split('/').pop());
        return { id: 'p:' + x.path, path: x.path, name: x.name, size: x.size, type: '', title: known(x.title) || fb.title, artist: known(x.artist) || fb.artist, album: known(x.album), dur: x.dur || 0, art: '', added: Date.now() };
      });
      const gone = lib.filter((t) => t.path && !paths.has(t.path)); // deleted from the phone since the last scan
      if (fresh.length || gone.length) {
        await dbMulti(['meta', 'blobs'], (m, b) => { fresh.forEach((r) => m.put(r)); gone.forEach((r) => { m.delete(r.id); b.delete(r.id); }); });
        const goneIds = new Set(gone.map((t) => t.id));
        lib = lib.filter((t) => !goneIds.has(t.id)).concat(fresh); sortLib();
        playlists.forEach((p) => { p.ids = p.ids.filter((x) => !goneIds.has(x)); }); if (gone.length) savePlaylists();
        buildOrder(cur && cur.id); renderLibrary();
      }
      if (prompt) toast(found.length ? `Found ${found.length} song${found.length === 1 ? '' : 's'} on your phone${fresh.length ? ` (${fresh.length} new)` : ''}` : 'No music found on this phone');
    } catch { if (prompt) toast('Could not scan for music'); }
    finally { scanning = false; }
  }
  async function lazyArt(t, blob) { // scanned songs have no cover yet: read it from the file the first time it plays
    if (t.art || t.artTried || !t.path) return; t.artTried = true;
    const tags = await readTags(blob); if (!tags.picture) return;
    const art = await thumb(tags.picture); if (!art) return;
    t.art = art; dbDo('meta', 'readwrite', (s) => s.put(Object.assign({}, t, { artTried: undefined }))).catch(() => {});
    if (cur && cur.id === t.id) emitArt();
  }
  async function removeTrack(id) {
    await dbMulti(['meta', 'blobs'], (m, b) => { m.delete(id); b.delete(id); });
    lib = lib.filter((t) => t.id !== id);
    playlists.forEach((p) => { p.ids = p.ids.filter((x) => x !== id); }); savePlaylists();
    if (cur && cur.id === id) { audio.pause(); audio.removeAttribute('src'); cur = null; emitArt(); }
    buildOrder(cur && cur.id); renderLibrary(); emit();
  }

  /* ================= playlists (Pro) ================= */
  let playlists = LS.get('vibe.playlists', []); // [{ id, name, ids: [trackId...] }]
  const savePlaylists = () => LS.set('vibe.playlists', playlists);
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

  /* ================= playback: two decks so songs can crossfade ================= */
  const decks = [new Audio(), new Audio()]; decks.forEach((d) => { d.preload = 'auto'; });
  let active = 0, audio = decks[0]; // `audio` is always the deck you are hearing / controlling
  const deckUrl = ['', ''];
  const useDeck = (i) => { active = i; audio = decks[i]; };
  let cur = null, order = [], idx = -1, shuffle = false, repeat = 'None', muted = false, xfading = false;
  let source = { type: 'library', id: null }; // what the queue was built from: the whole library or one playlist
  const cb = {}; // bridge callbacks registered by the shared UI
  const setDeckSrc = (i, blob) => { if (deckUrl[i]) URL.revokeObjectURL(deckUrl[i]); deckUrl[i] = URL.createObjectURL(blob); decks[i].src = deckUrl[i]; };
  const setVol = (v) => decks.forEach((d) => { d.volume = v; });
  const shuffled = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* smart shuffle (Pro): weighted random that favours songs you have not heard (or have starred) and avoids ones you just
     played, and never plays the same artist twice in a row when it can help it. Uses the listening stats kept on this phone. */
  const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  function smartOrder(ids, startId) {
    const st = readJson('nv.stats', { tracks: {} }), favs = new Set((readJson('nv.favs', [])).map((f) => f.id)), now = Date.now();
    const pool = ids.map((id) => {
      const t = lib.find((x) => x.id === id), sid = `${t.artist}|${t.title}`.toLowerCase(), s = st.tracks && st.tracks[sid];
      let w = 1; if (!s || !s.p) w += 1.2; if (favs.has(sid)) w += 1;
      if (s && s.l && now - s.l < 3600e3) w *= 0.25; else if (s && s.l && now - s.l < 86400e3) w *= 0.6;
      return { id, artist: (t.artist || '').toLowerCase(), w: Math.max(0.05, w) };
    });
    const out = []; let last = '';
    const take = (x) => { out.push(x.id); last = x.artist; pool.splice(pool.indexOf(x), 1); };
    if (startId) { const f = pool.find((x) => x.id === startId); if (f) take(f); }
    while (pool.length) {
      let cand = pool.filter((x) => !x.artist || x.artist !== last); if (!cand.length) cand = pool;
      let r = Math.random() * cand.reduce((n, x) => n + x.w, 0), pick = cand[cand.length - 1];
      for (const x of cand) { r -= x.w; if (r <= 0) { pick = x; break; } }
      take(pick);
    }
    return out;
  }
  const sourceIds = () => (source.type === 'playlist' ? ((playlists.find((p) => p.id === source.id) || { ids: [] }).ids.filter((id) => lib.some((t) => t.id === id))) : lib.map((t) => t.id));
  function buildOrder(startId) {
    let ids = sourceIds();
    if (shuffle) {
      if (entitled.has('pro') && prefs.smartshuffle && ids.length > 1) ids = smartOrder(ids, startId);
      else { shuffled(ids); if (startId) { const i = ids.indexOf(startId); if (i > 0) { ids.splice(i, 1); ids.unshift(startId); } } }
    }
    order = ids; idx = startId ? order.indexOf(startId) : -1;
  }
  const keyOf = (t) => `${t.title}|${t.artist}|${t.album}|Library`;

  /* ---- equalizer + crossfade (Pro). The Web Audio graph is only built once one of them is switched on. ---- */
  const EQ_FREQS = [60, 230, 910, 3600, 14000];
  const PRESETS = { flat: [0, 0, 0, 0, 0], bass: [7, 4, 0, -1, -2], vocal: [-2, -1, 3, 3, 0], treble: [-2, 0, 0, 3, 6], rock: [5, 3, -2, 2, 4], soft: [-3, -1, 1, 2, -2] };
  let fx = Object.assign({ eq: false, gains: [0, 0, 0, 0, 0], xfade: 0, preset: 'flat' }, LS.get('vibe.fx', {}));
  const fxActive = () => entitled.has('pro') && (fx.eq || fx.xfade > 0);
  let ctx = null, deckGain = [], filters = [], master = null;
  function ensureGraph() {
    if (ctx) return true;
    if (!fxActive()) return false;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      filters = EQ_FREQS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1; b.gain.value = 0; return b; });
      master.connect(filters[0]); filters.forEach((f, i) => { if (i < 4) f.connect(filters[i + 1]); }); filters[4].connect(ctx.destination);
      deckGain = decks.map((d) => { const src = ctx.createMediaElementSource(d), g = ctx.createGain(); src.connect(g); g.connect(master); return g; });
      applyEq(); return true;
    } catch { ctx = null; return false; }
  }
  function applyEq() { if (ctx) filters.forEach((f, i) => { f.gain.value = entitled.has('pro') && fx.eq ? fx.gains[i] : 0; }); }
  const resumeCtx = () => (ctx && ctx.state === 'suspended' ? ctx.resume().catch(() => {}) : Promise.resolve());

  async function loadTrack(id, autoplay) {
    const t = lib.find((x) => x.id === id); if (!t) return;
    let blob; try { blob = await getBlob(t); } catch { toast('That file is missing'); return; }
    xfading = false;
    decks.forEach((d, i) => { if (i !== active) d.pause(); });
    if (ensureGraph()) { deckGain.forEach((g, i) => { g.gain.cancelScheduledValues(0); g.gain.value = i === active ? 1 : 0; }); await resumeCtx(); }
    setDeckSrc(active, blob); cur = t; idx = order.indexOf(id);
    emitArt(); setSession(); lazyArt(t, blob);
    if (autoplay) { try { await audio.play(); startBackground(); } catch { toast('Tap play to start'); } }
    emit(); pushNative(true);
  }
  function playId(id, keepOrder) { if (!keepOrder || !order.includes(id)) buildOrder(id); return loadTrack(id, true); }
  const peekNext = () => { if (!order.length || repeat === 'Track') return null; let i = idx + 1; if (i >= order.length) { if (repeat === 'List') i = 0; else return null; } return order[i]; };
  function next() {
    if (!order.length) return;
    let i = idx + 1;
    if (i >= order.length) { if (repeat === 'List') i = 0; else { audio.pause(); audio.currentTime = 0; emit(); return; } }
    playId(order[i], true);
  }
  function prev() {
    if (!order.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    let i = idx - 1; if (i < 0) i = repeat === 'List' ? order.length - 1 : 0;
    playId(order[i], true);
  }
  /* crossfade: start the next song on the idle deck and ramp the two gains over `fx.xfade` seconds */
  async function startCrossfade() {
    if (xfading || !cur || !fxActive() || !(fx.xfade > 0)) return;
    const nextId = peekNext(); if (!nextId) return;
    const t = lib.find((x) => x.id === nextId); if (!t) return;
    xfading = true;
    try {
      const blob = await getBlob(t).catch(() => null); if (!blob || !ensureGraph()) { xfading = false; return; }
      await resumeCtx();
      const oldDeck = active, other = 1 - active, secs = fx.xfade, now = ctx.currentTime;
      setDeckSrc(other, blob); decks[other].currentTime = 0;
      deckGain[other].gain.cancelScheduledValues(now); deckGain[other].gain.setValueAtTime(0, now);
      await decks[other].play();
      const t0 = ctx.currentTime;
      deckGain[oldDeck].gain.cancelScheduledValues(t0); deckGain[oldDeck].gain.setValueAtTime(deckGain[oldDeck].gain.value, t0); deckGain[oldDeck].gain.linearRampToValueAtTime(0, t0 + secs);
      deckGain[other].gain.linearRampToValueAtTime(1, t0 + secs);
      idx = order.indexOf(nextId); cur = t; useDeck(other);       // the new song is "current" straight away
      emitArt(); setSession(); emit(); pushNative(true); lazyArt(t, blob);
      setTimeout(() => { decks[oldDeck].pause(); xfading = false; }, secs * 1000 + 150);
    } catch { xfading = false; }
  }
  decks.forEach((d) => {
    d.addEventListener('ended', () => { if (d !== audio) return; if (repeat === 'Track') { audio.currentTime = 0; audio.play(); } else next(); });
    ['play', 'pause', 'loadedmetadata', 'seeked', 'durationchange'].forEach((e) => d.addEventListener(e, () => { if (d !== audio) return; emit(); if (e === 'pause') { stopBackgroundSoon(); pushNative(); } else if (e === 'play') { startBackground(); pushNative(); } else if (e === 'seeked') pushNative(); }));
    d.addEventListener('timeupdate', () => { // time to start fading into the next song?
      if (d !== audio || xfading || !(fx.xfade > 0) || !Number.isFinite(d.duration)) return;
      if (d.duration > fx.xfade * 2.5 && d.duration - d.currentTime <= fx.xfade + 0.25 && !d.paused) startCrossfade();
    });
    d.addEventListener('error', () => { if (d === audio) toast('Could not play that file'); });
  });

  function emit() {
    if (!cb.state) return;
    if (!cur) { cb.state({ type: 'state', active: false, vol: audio.volume, muted }); return; }
    cb.state({
      type: 'state', active: true, key: keyOf(cur), app: 'Library', appId: 'Library', sessions: [], selected: false,
      playing: !audio.paused && !audio.ended, title: cur.title, artist: cur.artist, album: cur.album,
      pos: audio.currentTime || 0, dur: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : cur.dur || 0,
      canPrev: true, canNext: true, canSeek: true, shuffle, repeat, canShuffle: true, canRepeat: true, vol: audio.volume, muted,
    });
  }
  function emitArt() { if (cb.art && cur && cur.art) cb.art({ type: 'art', key: keyOf(cur), data: cur.art }); }
  setInterval(emit, 400);

  /* lock-screen / headset buttons: the browser MediaSession (works while the app is open) ... */
  function setSession() {
    if (!('mediaSession' in navigator) || !cur) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: cur.title, artist: cur.artist, album: cur.album, artwork: cur.art ? [{ src: cur.art, sizes: '400x400', type: 'image/jpeg' }] : [] });
      const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
      set('play', () => audio.play()); set('pause', () => audio.pause()); set('previoustrack', prev); set('nexttrack', next);
      set('seekto', (d) => { audio.currentTime = d.seekTime; });
      set('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
      set('seekforward', () => { audio.currentTime = audio.currentTime + 10; });
    } catch {}
  }
  setInterval(() => {
    if (!('mediaSession' in navigator) || !cur || !Number.isFinite(audio.duration)) return;
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch {}
  }, 1000);

  /* ... and the native side (MediaPlaybackService.java): keeps playing with the screen off. With Pro it also shows real
     lock-screen / notification controls and feeds the home-screen widget. */
  const bg = plugin('MediaService'); let bgOn = false, bgTimer = 0, artSentFor = '';
  const nativePayload = (withArt) => ({
    title: cur ? cur.title : 'NorwinVibe', text: cur ? (cur.artist || 'Playing') : '', album: cur ? cur.album : '',
    playing: !audio.paused, pro: entitled.has('pro'),
    position: Math.round((audio.currentTime || 0) * 1000), duration: Math.round((Number.isFinite(audio.duration) ? audio.duration : (cur && cur.dur) || 0) * 1000),
    art: withArt && cur && cur.art && artSentFor !== keyOf(cur) ? cur.art.split(',')[1] || '' : '',
  });
  async function startBackground() {
    clearTimeout(bgTimer);
    if (!bg) return;
    if (bgOn) return pushNative();
    try { const p = nativePayload(true); await bg.start(p); bgOn = true; if (p.art) artSentFor = keyOf(cur); } catch { bgOn = false; }
  }
  function pushNative(withArt) { if (bg && bgOn) { const p = nativePayload(withArt); bg.update(p).then(() => { if (p.art && cur) artSentFor = keyOf(cur); }).catch(() => {}); } }
  function stopBackgroundSoon() { clearTimeout(bgTimer); bgTimer = setTimeout(() => { if (audio.paused && bg && bgOn) { bg.stop().catch(() => {}); bgOn = false; } }, 60000); }
  if (bg && bg.addListener) bg.addListener('action', (e) => { // buttons on the notification / lock screen / widget
    const a = e && e.action;
    if (a === 'play') audio.play(); else if (a === 'pause') audio.pause(); else if (a === 'toggle') (audio.paused ? audio.play() : audio.pause());
    else if (a === 'next') next(); else if (a === 'prev') prev(); else if (a === 'seekTo') { audio.currentTime = (e.position || 0) / 1000; emit(); }
  });

  /* ================= lyrics (LRCLIB; CapacitorHttp makes fetch bypass CORS) ================= */
  const lyricCache = new Map();
  async function getJson(url) { try { const r = await fetch(url, { headers: { 'User-Agent': 'NorwinVibe-Mobile/1.0' } }); return r.ok ? await r.json() : null; } catch { return null; } }
  async function fetchLyrics({ artist, title, album, dur }) {
    const s = (v) => String(v || '').slice(0, 200); artist = s(artist); title = s(title); album = s(album);
    if (!artist || !title) return null;
    const key = `${artist}|${title}|${Math.round(dur)}`.toLowerCase(); if (lyricCache.has(key)) return lyricCache.get(key);
    const q = new URLSearchParams({ artist_name: artist, track_name: title }); if (album) q.set('album_name', album); if (dur > 0) q.set('duration', String(Math.round(dur)));
    let hit = await getJson(`https://lrclib.net/api/get?${q}`);
    if (!hit) {
      const list = await getJson(`https://lrclib.net/api/search?${new URLSearchParams({ artist_name: artist, track_name: title })}`);
      if (Array.isArray(list)) { const close = (x) => !(dur > 0) || Math.abs((x.duration || 0) - dur) <= 4; hit = list.find((x) => x.syncedLyrics && close(x)) || list.find((x) => x.plainLyrics && close(x)) || null; }
    }
    const out = hit && (hit.syncedLyrics || hit.plainLyrics) ? { synced: hit.syncedLyrics || '', plain: hit.plainLyrics || '' } : null;
    if (lyricCache.size > 100) lyricCache.clear(); lyricCache.set(key, out); return out;
  }

  /* ================= sleep timer (Pro: fade out over the last 15 seconds) ================= */
  let sleepTimer = 0, sleepFadeTimer = 0, sleepEnds = 0, fadeTimers = [], fadeOrig = 1, fading = false;
  function cancelFade() { fadeTimers.forEach(clearTimeout); fadeTimers = []; if (fading) { setVol(fadeOrig); fading = false; } }
  function startFade(totalMs = 15000, steps = 20) {
    fadeOrig = Math.max(0.05, audio.volume); fading = true;
    for (let i = 1; i <= steps; i++) fadeTimers.push(setTimeout(() => setVol(fadeOrig * (1 - i / steps)), Math.round(totalMs * i / steps)));
    fadeTimers.push(setTimeout(() => audio.pause(), totalMs + 150));
    fadeTimers.push(setTimeout(() => { setVol(fadeOrig); fading = false; }, totalMs + 1650)); // put the volume back for next time
  }
  function setSleep(mins) {
    clearTimeout(sleepTimer); clearTimeout(sleepFadeTimer); cancelFade(); sleepEnds = 0;
    if (mins > 0) {
      const ms = mins * 60000; sleepEnds = Date.now() + ms;
      const fade = entitled.has('pro') && prefs.fadeout;
      if (fade) sleepFadeTimer = setTimeout(() => startFade(), ms - 15000);
      sleepTimer = setTimeout(() => { if (!fade) audio.pause(); sleepEnds = 0; cb.sleep && cb.sleep(0); }, ms);
    }
    cb.sleep && cb.sleep(sleepEnds);
  }

  /* ================= in-app updates (GitHub releases) ================= */
  const updater = plugin('AppUpdate'), RELEASE_API = 'https://api.github.com/repos/NorwinLabs/NorwinVibe/releases/latest';
  window.UPDATE_VERB = 'Tap to install'; window.UPDATE_TITLE = 'Install the downloaded update'; window.UPDATE_HOWTO = 'Tap the version at the bottom to install it.';
  let upd = { state: updater ? 'idle' : 'unsupported' }, updBusy = false, updInfo = null;
  const setUpd = (u) => { upd = { ...u, current: window.APP_VERSION || '' }; if (cb.update) cb.update(upd); };
  if (updater && updater.addListener) updater.addListener('progress', (p) => { if (upd.state === 'downloading') setUpd({ ...upd, percent: p.percent }); });
  async function updateCheck(manual) {
    if (!updater) return upd;
    if (upd.state === 'ready' && manual) { updateInstall(); return upd; } // "Update ready": tapping the button installs it
    if (updBusy) return upd; updBusy = true;
    try {
      if (!updInfo) updInfo = await updater.info();
      setUpd({ state: 'checking' });
      const r = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } }); if (!r.ok) throw new Error('feed');
      const rel = await r.json();
      let best = null; // the newest release file is the one with the highest build number in its name
      for (const a of rel.assets || []) { const m = /-b(\d+)\.apk$/.exec(a.name || ''); if (m && (!best || +m[1] > best.build)) best = { build: +m[1], url: a.browser_download_url }; }
      if (!best || best.build <= Number(updInfo.versionCode)) { setUpd({ state: 'none' }); return upd; }
      const version = String(rel.tag_name || '').replace(/^v/, '') || `build ${best.build}`;
      setUpd({ state: 'downloading', version, percent: 0 });
      await updater.download({ url: best.url });
      setUpd({ state: 'ready', version });
    } catch { setUpd({ state: 'error' }); }
    finally { updBusy = false; }
    return upd;
  }
  async function updateInstall() {
    if (!updater || upd.state !== 'ready') return;
    try { const r = await updater.install(); if (r && r.needsPermission) toast('Allow installs from NorwinVibe, then tap install again'); } catch { toast('Could not start the install'); }
  }
  if (updater) setTimeout(() => { // quiet check shortly after launch, at most every 6 hours
    const last = LS.get('vibe.updChecked', 0); if (Date.now() - last < 6 * 3600e3) return;
    LS.set('vibe.updChecked', Date.now()); updateCheck(false);
  }, 4000);

  /* ================= the bridge the shared UI talks to ================= */
  const storeCfg = () => window.STORE_CONFIG || { items: {} };
  window.api = {
    noLoopback: true, idleText: 'Add music from your phone to get started',
    onState: (f) => { cb.state = f; }, onArt: (f) => { cb.art = f; }, onPin: () => {}, onSleep: (f) => { cb.sleep = f; }, onOwned: (f) => { cb.owned = f; },
    cmd: (c) => {
      const [k, v] = String(c).split(':');
      if (k === 'toggle') { if (!cur) { if (lib.length) playId(lib[0].id); else openLibrary(); } else if (audio.paused) audio.play(); else audio.pause(); }
      else if (k === 'play') audio.play(); else if (k === 'pause') audio.pause();
      else if (k === 'next') next(); else if (k === 'prev') prev();
      else if (k === 'seek') { audio.currentTime = parseFloat(v) || 0; emit(); }
      else if (k === 'shuffle') { shuffle = v === '1'; buildOrder(cur && cur.id); emit(); }
      else if (k === 'repeat') { repeat = v; emit(); }
      else if (k === 'volume') { setVol(Math.min(1, Math.max(0, parseFloat(v)))); emit(); }
      else if (k === 'volstep') { setVol(Math.min(1, Math.max(0, audio.volume + parseFloat(v)))); emit(); }
      else if (k === 'mute') { muted = v === '1'; decks.forEach((d) => { d.muted = muted; }); emit(); }
    },
    onUpdate: (f) => { cb.update = f; }, updateState: async () => upd, updateCheck: () => updateCheck(true), updateInstall: () => updateInstall(),
    prefs: async () => { const { devAsFree, ...rest } = prefs; return { ...DEFAULTS, ...rest, owned: entitlementList(), sleepEnds, version: window.APP_VERSION || '' }; },
    setPrefs: (patch) => {
      for (const [k, v] of Object.entries(patch || {})) {
        if (PRO_KEYS.has(k) && !entitled.has('pro')) continue;
        if (ENUMS[k] && ENUMS[k].includes(v) && allowed(k, v)) prefs[k] = v; else if (typeof DEFAULTS[k] === 'boolean' && typeof v === 'boolean') prefs[k] = v;
      } savePrefs();
    },
    lyrics: (m) => fetchLyrics(m || {}),
    toast: () => {}, sleep: (m) => setSleep([0, 15, 30, 60].includes(m) ? m : 0),
    close: () => {}, minimize: () => {}, pin: () => {}, mini: () => {}, fullscreen: () => {},
    storeInfo: async () => {
      const c = storeCfg();
      return { owned: entitlementList(), items: Object.fromEntries(['pro', ...PACK_IDS].map((id) => [id, { name: c.items?.[id]?.name || id, price: c.items?.[id]?.price || '', hasCheckout: /^https:\/\//.test(c.items?.[id]?.checkoutUrl || '') }])) };
    },
    storeBuy: async (id) => {
      const url = storeCfg().items?.[id]?.checkoutUrl;
      if (!['pro', ...PACK_IDS].includes(id) || !/^https:\/\//.test(url || '')) return { ok: false, error: 'Checkout is not set up yet.' };
      window.open(url, '_blank'); return { ok: true };
    },
    storeRedeem: async (key) => {
      const o = verifyLicense(key); if (!o) return { ok: false, error: 'That license key is not valid or has expired.' };
      const k = String(key).trim(); if (!licenses.includes(k)) licenses.push(k);
      LS.set('vibe.licenses', licenses); recompute(); applyEq(); cb.owned && cb.owned(entitlementList());
      return { ok: true, item: o.item };
    },
    dev: {
      info: async () => (devActive ? { version: window.APP_VERSION || '', packaged: true, electron: '', userData: '', asFree: !!prefs.devAsFree, licenses: licenses.length } : null),
      devtools() {}, fakeUpdate() {},
      asFree: (on) => { if (!devActive) return; prefs.devAsFree = !!on; recompute(); dropLockedChoices(); savePrefs(); cb.owned && cb.owned(entitlementList()); },
      signOut: () => {
        if (!devActive) return;
        licenses = licenses.filter((k) => { const o = verifyLicense(k); return !(o && o.item === 'dev'); });
        delete prefs.devAsFree; LS.set('vibe.licenses', licenses); recompute(); dropLockedChoices(); savePrefs(); cb.owned && cb.owned(entitlementList());
      },
    },
  };

  /* ================= library panel (Songs | Playlists) ================= */
  const fileIn = $('lib-file'), listEl = $('lib-list'), searchEl = $('lib-search');
  let libTab = 'songs', openList = null; // openList = id of the playlist being viewed
  const closeLib = () => $('pop-library').classList.remove('open');
  function openLibrary() { if (typeof togglePop === 'function') { if (!$('pop-library').classList.contains('open')) togglePop('library'); } renderLibrary(); }
  const fmt = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const iconBtn = (title, path, onclick, cls = 'star') => {
    const b = document.createElement('button'); b.className = cls; b.title = title; b.setAttribute('aria-label', title);
    b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${path}"/></svg>`; b.onclick = (e) => { e.stopPropagation(); onclick(); }; return b;
  };
  const ICON_X = 'M6 6l12 12M18 6L6 18', ICON_PLUS = 'M12 5v14M5 12h14';
  function songRow(t, extra) {
    const row = document.createElement('div'); row.className = 'hrow' + (cur && cur.id === t.id ? ' now' : '');
    const th = document.createElement('div'); th.className = 'th'; if (t.art) th.style.backgroundImage = `url("${t.art}")`;
    const tx = document.createElement('div'); tx.className = 'tx';
    const b = document.createElement('b'); b.textContent = t.title; const sp = document.createElement('span'); sp.textContent = [t.artist, t.dur ? fmt(t.dur) : ''].filter(Boolean).join(' \u00b7 ');
    tx.append(b, sp); row.append(th, tx); (extra || []).forEach((x) => row.appendChild(x));
    return row;
  }
  const empty = (text) => { const e = document.createElement('div'); e.className = 'empty'; e.textContent = text; listEl.appendChild(e); };

  async function renderLibrary() {
    await libReady;
    const tabs = $('lib-tabs'); if (tabs) tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === libTab));
    searchEl.style.display = libTab === 'songs' ? '' : 'none';
    $('lib-actions').style.display = libTab === 'songs' ? '' : 'none';
    if (libTab === 'lists') return renderPlaylists();
    $('lib-count').textContent = lib.length ? `${lib.length} song${lib.length === 1 ? '' : 's'}` : 'Your library';
    const q = (searchEl.value || '').trim().toLowerCase();
    const rows = q ? lib.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) : lib;
    listEl.textContent = '';
    if (!rows.length) return empty(lib.length ? 'No matches' : 'Tap "Find my music" to add the songs on your phone');
    for (const t of rows) {
      const row = songRow(t, [
        iconBtn('Add to a playlist', ICON_PLUS, () => pickPlaylist(t.id)),
        iconBtn('Remove from library', ICON_X, () => { if (confirm(`Remove "${t.title}" from your library?`)) removeTrack(t.id); }),
      ]);
      row.onclick = () => { source = { type: 'library', id: null }; playId(t.id); closeLib(); };
      listEl.appendChild(row);
    }
  }

  function lockedNotice(text) {
    const box = document.createElement('div'); box.className = 'empty';
    const p = document.createElement('p'); p.textContent = text; p.style.marginBottom = '10px';
    const b = document.createElement('button'); b.className = 'act buy'; b.textContent = 'Get Pro'; b.onclick = () => { closeLib(); if (typeof openStore === 'function') openStore('pro'); };
    box.append(p, b); listEl.appendChild(box);
  }
  function playPlaylist(id, shuf) {
    const p = playlists.find((x) => x.id === id); if (!p || !sourceIdsFor(id).length) { toast('That playlist is empty'); return; }
    source = { type: 'playlist', id }; shuffle = !!shuf; buildOrder(); playId(order[0], true); closeLib();
  }
  const sourceIdsFor = (id) => (playlists.find((p) => p.id === id) || { ids: [] }).ids.filter((x) => lib.some((t) => t.id === x));
  function renderPlaylists() {
    listEl.textContent = '';
    if (!entitled.has('pro')) { $('lib-count').textContent = 'Playlists'; return lockedNotice('Playlists are part of NorwinVibe Pro.'); }
    const pl = openList && playlists.find((p) => p.id === openList);
    if (pl) { // one playlist
      $('lib-count').textContent = pl.name;
      const bar = document.createElement('div'); bar.className = 'act-row';
      const back = document.createElement('button'); back.className = 'act'; back.textContent = '\u2190 All';
      back.onclick = () => { openList = null; renderLibrary(); };
      const play = document.createElement('button'); play.className = 'act'; play.textContent = 'Play'; play.onclick = () => playPlaylist(pl.id, false);
      const shuf = document.createElement('button'); shuf.className = 'act'; shuf.textContent = 'Shuffle'; shuf.onclick = () => playPlaylist(pl.id, true);
      bar.append(back, play, shuf); listEl.appendChild(bar);
      const bar2 = document.createElement('div'); bar2.className = 'act-row';
      const ren = document.createElement('button'); ren.className = 'act'; ren.textContent = 'Rename';
      ren.onclick = () => { const n = (prompt('Playlist name', pl.name) || '').trim(); if (n) { pl.name = n.slice(0, 60); savePlaylists(); renderLibrary(); } };
      const del = document.createElement('button'); del.className = 'act'; del.textContent = 'Delete playlist';
      del.onclick = () => { if (confirm(`Delete the playlist "${pl.name}"? Your songs stay in the library.`)) { playlists = playlists.filter((x) => x.id !== pl.id); savePlaylists(); openList = null; renderLibrary(); } };
      bar2.append(ren, del); listEl.appendChild(bar2);
      const ids = sourceIdsFor(pl.id); if (!ids.length) return empty('Empty. Add songs with the + button on the Songs tab.');
      ids.forEach((id) => {
        const t = lib.find((x) => x.id === id);
        const row = songRow(t, [iconBtn('Remove from playlist', ICON_X, () => { pl.ids = pl.ids.filter((x) => x !== id); savePlaylists(); renderLibrary(); })]);
        row.onclick = () => { source = { type: 'playlist', id: pl.id }; buildOrder(id); loadTrack(id, true); closeLib(); };
        listEl.appendChild(row);
      });
      return;
    }
    $('lib-count').textContent = `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`;
    const nw = document.createElement('button'); nw.className = 'act'; nw.textContent = 'New playlist'; nw.style.width = '100%'; nw.style.marginBottom = '8px';
    nw.onclick = () => { const n = (prompt('Playlist name') || '').trim(); if (n) { playlists.push({ id: newId(), name: n.slice(0, 60), ids: [] }); savePlaylists(); renderLibrary(); } };
    listEl.appendChild(nw);
    if (!playlists.length) return empty('No playlists yet');
    playlists.forEach((p) => {
      const row = document.createElement('div'); row.className = 'hrow';
      const th = document.createElement('div'); th.className = 'th rank'; th.textContent = '\u266a';
      const tx = document.createElement('div'); tx.className = 'tx'; const b = document.createElement('b'); b.textContent = p.name; const sp = document.createElement('span'); sp.textContent = `${sourceIdsFor(p.id).length} songs`; tx.append(b, sp);
      row.append(th, tx); row.onclick = () => { openList = p.id; renderLibrary(); }; listEl.appendChild(row);
    });
  }
  function pickPlaylist(trackId) { // "Add to playlist" chooser
    if (!entitled.has('pro')) { closeLib(); if (typeof openStore === 'function') openStore('pro'); return; }
    const old = document.getElementById('pl-menu'); if (old) old.remove();
    const m = document.createElement('div'); m.id = 'pl-menu'; m.className = 'pl-menu';
    const h = document.createElement('h4'); h.textContent = 'Add to playlist'; m.appendChild(h);
    const add = (p) => { if (!p.ids.includes(trackId)) p.ids.push(trackId); savePlaylists(); toast(`Added to ${p.name}`); m.remove(); if (libTab === 'lists') renderLibrary(); };
    playlists.forEach((p) => { const b = document.createElement('button'); b.textContent = p.name; b.onclick = () => add(p); m.appendChild(b); });
    const nw = document.createElement('button'); nw.textContent = 'New playlist\u2026'; nw.className = 'new';
    nw.onclick = () => { const n = (prompt('Playlist name') || '').trim(); if (n) { const p = { id: newId(), name: n.slice(0, 60), ids: [] }; playlists.push(p); add(p); } else m.remove(); };
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.onclick = () => m.remove();
    m.append(nw, cancel); document.getElementById('card').appendChild(m);
  }

  const tabsEl = $('lib-tabs');
  if (tabsEl) tabsEl.querySelectorAll('button').forEach((b) => { b.onclick = () => { libTab = b.dataset.v; openList = null; renderLibrary(); }; });
  $('btn-library').onclick = (e) => { e.stopPropagation(); togglePop('library'); renderLibrary(); };
  $('btn-add-cta').onclick = () => (scanner ? scanPhone(true) : fileIn.click());
  $('lib-add').onclick = () => (scanner ? scanPhone(true) : fileIn.click());
  $('lib-pick').onclick = () => fileIn.click(); // still possible to add single files, e.g. from a folder the scan does not cover
  fileIn.onchange = () => { const picked = [...fileIn.files]; fileIn.value = ''; if (picked.length) addFiles(picked); }; // copy first: the FileList is live and clearing the input empties it
  searchEl.oninput = renderLibrary;
  $('lib-play-all').onclick = () => { if (!lib.length) return; source = { type: 'library', id: null }; shuffle = false; buildOrder(); playId(order[0], true); closeLib(); };
  $('lib-shuffle-all').onclick = () => { if (!lib.length) return; source = { type: 'library', id: null }; shuffle = true; buildOrder(); playId(order[0], true); closeLib(); };
  libReady.then(() => { buildOrder(); renderLibrary(); scanPhone(false); }); // quiet rescan on launch (never prompts)
  document.addEventListener('click', (e) => { const m = document.getElementById('pl-menu'); if (m && !e.target.closest('#pl-menu') && !e.target.closest('.star')) m.remove(); });

  /* ================= what the shared UI (pro.js) needs from the audio engine ================= */
  const clampGain = (v) => Math.max(-12, Math.min(12, Number(v) || 0));
  window.vibeFx = {
    supported: true, presets: PRESETS,
    get: () => ({ eq: !!fx.eq, gains: fx.gains.slice(), xfade: fx.xfade, preset: fx.preset, pro: entitled.has('pro'), freqs: EQ_FREQS }),
    set(patch) {
      if (!entitled.has('pro')) return false;
      if ('eq' in patch) fx.eq = !!patch.eq;
      if ('gains' in patch && Array.isArray(patch.gains) && patch.gains.length === 5) fx.gains = patch.gains.map(clampGain);
      if ('preset' in patch) fx.preset = String(patch.preset);
      if ('xfade' in patch) fx.xfade = Math.max(0, Math.min(12, Math.round(Number(patch.xfade) || 0)));
      LS.set('vibe.fx', fx);
      if (fxActive()) { ensureGraph(); resumeCtx(); }
      applyEq(); return true;
    },
    queue: () => order.map((id) => (lib.find((t) => t.id === id) || {}).title), // the order songs will play in (also used by tests)
    debug: () => ({ ctx: ctx ? ctx.state : null, eqGains: filters.map((f) => Math.round(f.gain.value * 10) / 10), deckGains: deckGain.map((g) => Math.round(g.gain.value * 100) / 100), active, playing: decks.map((d) => !d.paused), xfading, title: cur && cur.title }),
  };

  /* ================= phone integration ================= */
  document.addEventListener('DOMContentLoaded', () => {}); // (scripts load at the end of <body>, so the DOM is already there)
  const card = $('card');
  card.addEventListener('dblclick', (e) => e.stopImmediatePropagation(), true); // no mini mode on a phone
  const status = plugin('StatusBar'); if (status) { status.setBackgroundColor?.({ color: '#0c0c12' }).catch(() => {}); status.setStyle?.({ style: 'DARK' }).catch(() => {}); }
  const app = plugin('App');
  if (app && app.addListener) app.addListener('appStateChange', (st) => { if (st && st.isActive) scanPhone(false); }); // pick up songs added while the app was in the background
  if (app && app.addListener) app.addListener('backButton', () => { // close panels / leave ambient first, otherwise send the app to the background (music keeps playing)
    const open = document.querySelector('.pop.open');
    if (open) { open.classList.remove('open'); return; }
    if (document.body.classList.contains('fullscreen') && typeof setMode === 'function') { setMode('none'); return; }
    app.minimizeApp?.();
  });
  // size the record to the screen width
  const fit = () => document.documentElement.style.setProperty('--ms', Math.max(0.9, Math.min(1.5, (card.clientWidth - 40) / 300)).toFixed(2));
  window.addEventListener('resize', fit); fit(); setTimeout(fit, 300);
})();
