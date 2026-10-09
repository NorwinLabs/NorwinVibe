/* NorwinVibe for Android.
   Implements the same `window.api` bridge the Electron preload gives the desktop UI, but backed by a local music
   library (IndexedDB) and an <audio> element, so renderer.js / features.js run here unchanged.
   Must load BEFORE renderer.js. */
(() => {
  'use strict';
  window.FRAME_MS = 33; // draw the record / ring at ~30 fps on phones (see renderer.js frame())
  const $ = (id) => document.getElementById(id);
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const cap = window.Capacitor || null;
  const plugin = (name) => { try { return (cap && (cap.Plugins?.[name] || cap.registerPlugin?.(name))) || null; } catch { return null; } };
  const toast = (t) => { if (typeof hud === 'function') hud(t); };

  /* ================= preferences & store (mirrors main.js) ================= */
  const DEFAULTS = { pin: true, mini: false, theme: 'art', record: 'vinyl', speed: 'slow', needle: 'classic', viz: 'bars', bgart: 'cover', stats: true, replaygain: true, recordstop: true, deck3d: false, dancers: true, dancerpack: 'people', deckskin: 'dark', deckmove: true, scratchfx: true, autotheme: false, autoDay: 'art', autoEve: 'retro', autoNight: 'midnight', fadeout: false, smartshuffle: false, screensaver: false, ssMin: '5', obs: false, discord: false, lyrics: true, toasts: false, fade: false, snap: false, autostart: false };
  const THEMES = ['art', 'midnight', 'retro', 'neon', 'cyberpunk', 'nightcity'];
  const PRO_KEYS = new Set(['autotheme', 'autoDay', 'autoEve', 'autoNight', 'fadeout', 'smartshuffle']); // only settable with a Pro license (desktop-only Pro switches are not offered here)
  const ENUMS = {
    bgart: ['cover', 'soft', 'off'],
    autoDay: THEMES, autoEve: THEMES, autoNight: THEMES, ssMin: ['1', '3', '5', '10'],
    speed: ['slow', 'relaxed', '33', '45'],
    theme: ['art', 'midnight', 'retro', 'neon', 'cyberpunk', 'nightcity'],
    record: ['vinyl', 'color', 'cd', 'cyber', 'nightcity'],
    dancerpack: ['people', 'robots', 'aliens'],
    deckskin: ['dark', 'wood', 'neon'],
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
    setTimeout(() => window.dispatchEvent(new Event('vibe:library')), 0); // Pro on / off changes what Android Auto may show
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
  async function storeNative(id, file) { // copy the song into the app's own storage in chunks
    const CH = 768 * 1024; let path = '';
    try {
      for (let off = 0; off === 0 || off < file.size; off += CH) {
        const buf = new Uint8Array(await file.slice(off, off + CH).arrayBuffer()); let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        path = (await bg.storeFile({ id, data: btoa(bin), append: off > 0 })).path;
      }
    } catch (e) { if (path) bg.deleteFile({ path }).catch(() => {}); throw e; }
    return path;
  }
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
      if (nativeOK()) { try { rec.path = await storeNative(rec.id, f); rec.own = true; } catch { rec.path = ''; delete rec.own; } } // a file the native player can open
      await dbMulti(['meta', 'blobs'], (m, b) => { m.put(rec); if (!rec.path) b.put({ id: rec.id, blob: f }); });
      lib.push(rec); added++;
    }
    sortLib(); toast(added ? `Added ${added} song${added === 1 ? '' : 's'}` : 'Those songs are already in your library');
    renderLibrary(); if (order.length === 0 || added) buildOrder(cur && cur.id);
  }
  /* Songs added before the native player existed live only inside the app's database, which the native player cannot open.
     Copy them into the app's own storage one at a time in the background (the database copy is dropped once the file is safe). */
  let migrating = false;
  async function migrateBlobs() {
    if (migrating || !nativeOK() || !bg.storeFile) return; migrating = true;
    try {
      await libReady;
      for (const t of lib.filter((x) => !x.path)) {
        const rec = await dbDo('blobs', 'readonly', (s) => s.get(t.id)).catch(() => null);
        if (!rec || !rec.blob) continue;
        try {
          const path = await storeNative(t.id, rec.blob);
          t.path = path; t.own = true;
          await dbMulti(['meta', 'blobs'], (m, b) => { m.put(t); b.delete(t.id); });
        } catch { /* leave it as it was; it still plays in the web player */ }
        await new Promise((r) => setTimeout(r, 400)); // never hog the phone
      }
      orderVer++;
    } finally { migrating = false; }
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
      const gone = lib.filter((t) => t.path && !t.own && !paths.has(t.path)); // deleted from the phone since the last scan
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
  async function lazyArt(t, blob) { // scanned songs have no cover yet: read it the first time the song plays
    if (t.art || t.artTried || !t.path) return; t.artTried = true;
    try {
      let url = '';
      if (scanner && scanner.cover) { const r = await scanner.cover({ path: t.path }); url = (r && r.data) || ''; } // natively: quick, and the song is never loaded into the page
      if (url) t.art = url;
      else { const tags = await readTags(blob || await getBlob(t)); if (tags.picture) t.art = (await thumb(tags.picture)) || ''; } // fall back to reading the tags in the page
    } catch {}
    dbDo('meta', 'readwrite', (s) => s.put(t)).catch(() => {}); // also remembers "no cover" so it is not read again
    if (t.art && cur && cur.id === t.id) { emitArt(); setSession(); pushNative(true); } // finished after the song started (slow file): show it now
  }
  // the cover is read BEFORE the song is announced, so the picture never pops in after the title (that was the flicker)
  const artFirst = (t, blob) => Promise.race([lazyArt(t, blob), new Promise((r) => setTimeout(r, 1500))]);
  async function removeTrack(id) {
    const gone = lib.find((t) => t.id === id); if (gone && gone.own && bg) bg.deleteFile({ path: gone.path }).catch(() => {});
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
  /* Phone songs play in the native player (NativePlayer.java), which lives in the background service, so music keeps going
     after the app is swiped away. `nd` stands in for an audio element and mirrors it. Songs it cannot open (copies that
     were added before this version) still play in the web decks above. */
  let orderVer = 0, nativeVer = -1, nativeLive = false;
  const nativeOK = () => !!(bg && cap && cap.isNativePlatform && cap.isNativePlatform());
  const nd = (() => {
    const L = {}; let pos = 0, at = 0, vol = 1, mu = false;
    const sendVol = () => { if (bg && nativeLive) bg.setVolume({ volume: vol, muted: mu }).catch(() => {}); };
    const o = {
      isNative: true, paused: true, ended: false, duration: NaN, preload: '',
      addEventListener(e, f) { (L[e] = L[e] || []).push(f); },
      fire(e) { (L[e] || []).forEach((f) => f()); },
      removeAttribute() {},
      get volume() { return vol; }, set volume(v) { vol = v; sendVol(); },
      get muted() { return mu; }, set muted(m) { mu = !!m; sendVol(); },
      get currentTime() { return pos + (o.paused ? 0 : (performance.now() - at) / 1000); },
      set currentTime(v) { pos = Math.max(0, Number(v) || 0); at = performance.now(); if (nativeLive) bg.seek({ ms: Math.round(pos * 1000) }).catch(() => {}); o.fire('seeked'); },
      play() {
        if (!nativeLive) { if (cur) loadNative(cur, true, Math.round(o.currentTime * 1000)); return Promise.resolve(); } // the service was stopped: start the song again from here
        bg.play().catch(() => {}); o.setPlaying(true); return Promise.resolve();
      },
      pause() { if (nativeLive) bg.pause().catch(() => {}); o.setPlaying(false); },
      setPlaying(p) { if (o.paused === !p) return; pos = o.currentTime; at = performance.now(); o.paused = !p; o.fire(p ? 'play' : 'pause'); },
      sync(st) {
        if (typeof st.pos === 'number') { // blend small corrections in so the lyrics do not twitch every time the phone reports a position
          const np = st.pos / 1000, cur2 = o.currentTime;
          pos = !o.paused && Math.abs(np - cur2) < 0.3 ? cur2 + (np - cur2) * 0.4 : np; at = performance.now();
        }
        if (st.dur > 0 && st.dur / 1000 !== o.duration) { o.duration = st.dur / 1000; o.fire('durationchange'); }
        if ('playing' in st) o.setPlaying(!!st.playing);
      },
    };
    return o;
  })();
  let cur = null, order = [], idx = -1, shuffle = false, repeat = 'None', muted = false, xfading = false;
  let source = { type: 'library', id: null }; // what the queue was built from: the whole library or one playlist
  const cb = {}; // bridge callbacks registered by the shared UI
  const setDeckSrc = (i, blob) => { if (deckUrl[i]) URL.revokeObjectURL(deckUrl[i]); deckUrl[i] = URL.createObjectURL(blob); decks[i].src = deckUrl[i]; };
  const setVol = (v) => [...decks, nd].forEach((d) => { d.volume = v; });
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
    order = ids; orderVer++; idx = startId ? order.indexOf(startId) : -1; syncQueue();
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
  function applyEq() { pushFx(); if (ctx) filters.forEach((f, i) => { f.gain.value = entitled.has('pro') && fx.eq ? fx.gains[i] : 0; }); }
  const resumeCtx = () => (ctx && ctx.state === 'suspended' ? ctx.resume().catch(() => {}) : Promise.resolve());

  const fxPayload = () => ({ pro: entitled.has('pro'), eq: !!fx.eq, gains: fx.gains, xfade: fx.xfade, rg: prefs.replaygain !== false, slow: prefs.recordstop !== false });
  const pushFx = () => { if (nativeLive) bg.setFx(fxPayload()).catch(() => {}); };
  async function sendQueue(i, autoplay, pos) { // hand the native player the play order (once per order) and start song `i`
    if (nativeLive && nativeVer === orderVer) { await bg.playIndex({ index: i, autoplay, position: pos, ...fxPayload() }); return; }
    await bg.setQueue({ items: queueItems(), index: i, autoplay, position: pos, repeat, volume: nd.volume, muted: nd.muted, ...fxPayload() });
    nativeVer = orderVer; nativeLive = true;
  }
  const queueItems = () => order.map((x) => { const q = lib.find((y) => y.id === x) || {}; return { id: x, path: q.path || '', title: q.title || '', artist: q.artist || '', album: q.album || '', dur: q.dur || 0 }; });
  function orderEdited() { orderVer++; syncQueue(); updateUpNext(); } // the queue was edited by hand: tell the native player too
  function syncQueue() { // the play order changed (shuffle, library edit) while the native player is playing: give it the new order without interrupting the song
    if (!(audio === nd && nativeLive) || !cur) return;
    const i = order.indexOf(cur.id); if (i < 0) return;
    const v = orderVer; bg.setQueue({ items: queueItems(), index: i, keep: true }).then(() => { nativeVer = v; }).catch(() => {});
  }
  async function loadNative(t, autoplay, pos) {
    xfading = false; decks.forEach((d) => d.pause());
    if (!t.art && !t.artTried) { try { await artFirst(t); } catch { toast('That file is missing'); return; } } // the cover shown in the app (the notification gets its own); read natively, so the song is not loaded into the page
    if (!order.includes(t.id)) buildOrder(t.id);
    cur = t; idx = order.indexOf(t.id); useNative(); rememberLast(); emitArt();
    try { if (!bgOn) await startBackground(); await sendQueue(idx, autoplay, pos || 0); } catch { toast('Could not start the music player'); return; }
    emit();
  }
  const useNative = () => { audio = nd; };
  function nativeTrack(id) { // the native player moved on by itself (next song, notification button, ...)
    const t = lib.find((x) => x.id === id); if (!t || (cur && cur.id === id && audio === nd)) return;
    cur = t; idx = order.indexOf(id); useNative(); rememberLast(); emitArt(); emit();
    lazyArt(t).catch(() => {}); // the cover (read natively); a late one is emitted by lazyArt itself
  }
  async function loadTrack(id, autoplay) {
    const t = lib.find((x) => x.id === id); if (!t) return;
    if (nativeOK() && t.path) return loadNative(t, autoplay, 0);
    if (audio === nd) { if (nativeLive) bg.release().catch(() => {}); nativeLive = false; nd.setPlaying(false); useDeck(active); } // a song only the web player can open
    let blob; try { blob = await getBlob(t); } catch { toast('That file is missing'); return; }
    xfading = false;
    decks.forEach((d, i) => { if (i !== active) d.pause(); });
    if (ensureGraph()) { deckGain.forEach((g, i) => { g.gain.cancelScheduledValues(0); g.gain.value = i === active ? 1 : 0; }); await resumeCtx(); }
    await artFirst(t, blob);
    setDeckSrc(active, blob); cur = t; idx = order.indexOf(id); rememberLast();
    emitArt(); setSession();
    if (autoplay) { try { await audio.play(); startBackground(); } catch { toast('Tap play to start'); } }
    emit(); pushNative(true);
  }
  /* the play button with nothing loaded: carry on from what was playing last (its playlist if it came from one), else the library */
  const rememberLast = () => { if (cur) LS.set('vibe.last', { src: source, id: cur.id }); };
  function startPlayback() {
    if (!lib.length) { openLibrary(); return; }
    const last = LS.get('vibe.last', null);
    if (last && last.src && last.src.type === 'playlist' && sourceIds2(last.src.id).length) source = { type: 'playlist', id: last.src.id };
    else source = { type: 'library', id: null };
    buildOrder(); if (!order.length) { source = { type: 'library', id: null }; buildOrder(); }
    const id = last && order.includes(last.id) ? last.id : (shuffle ? order[Math.floor(Math.random() * order.length)] : order[0]);
    playId(id, true);
  }
  const sourceIds2 = (pid) => (playlists.find((p) => p.id === pid) || { ids: [] }).ids.filter((x) => lib.some((t) => t.id === x));
  function playId(id, keepOrder) { if (!keepOrder || !order.includes(id)) buildOrder(id); return loadTrack(id, true); }
  const peekNext = () => { if (!order.length || repeat === 'Track') return null; let i = idx + 1; if (i >= order.length) { if (repeat === 'List') i = 0; else return null; } return order[i]; };
  function next() {
    if (!order.length) return;
    if (audio === nd && nativeLive) { bg.next().catch(() => {}); return; }
    let i = idx + 1;
    if (i >= order.length) { if (repeat === 'List') i = 0; else { audio.pause(); audio.currentTime = 0; emit(); return; } }
    playId(order[i], true);
  }
  function prev() {
    if (!order.length) return;
    if (audio === nd && nativeLive) { bg.prev().catch(() => {}); return; }
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
      await artFirst(t, blob); await resumeCtx();
      const oldDeck = active, other = 1 - active, secs = fx.xfade, now = ctx.currentTime;
      setDeckSrc(other, blob); decks[other].currentTime = 0;
      deckGain[other].gain.cancelScheduledValues(now); deckGain[other].gain.setValueAtTime(0, now);
      await decks[other].play();
      const t0 = ctx.currentTime;
      deckGain[oldDeck].gain.cancelScheduledValues(t0); deckGain[oldDeck].gain.setValueAtTime(deckGain[oldDeck].gain.value, t0); deckGain[oldDeck].gain.linearRampToValueAtTime(0, t0 + secs);
      deckGain[other].gain.linearRampToValueAtTime(1, t0 + secs);
      idx = order.indexOf(nextId); cur = t; useDeck(other);       // the new song is "current" straight away
      emitArt(); setSession(); emit(); pushNative(true); rememberLast();
      setTimeout(() => { decks[oldDeck].pause(); xfading = false; }, secs * 1000 + 150);
    } catch { xfading = false; }
  }
  [...decks, nd].forEach((d) => {
    d.addEventListener('ended', () => { if (d !== audio) return; if (repeat === 'Track') { audio.currentTime = 0; audio.play(); } else next(); });
    ['play', 'pause', 'loadedmetadata', 'seeked', 'durationchange'].forEach((e) => d.addEventListener(e, () => { if (d !== audio) return; emit(); if (e === 'pause') { stopBackgroundSoon(); pushNative(); } else if (e === 'play') { startBackground(); pushNative(); } else if (e === 'seeked') pushNative(); }));
    d.addEventListener('timeupdate', () => { // time to start fading into the next song?
      if (d !== audio || xfading || !(fx.xfade > 0) || !Number.isFinite(d.duration)) return;
      if (d.duration > fx.xfade * 2.5 && d.duration - d.currentTime <= fx.xfade + 0.25 && !d.paused) startCrossfade();
    });
    d.addEventListener('error', () => { if (d === audio) toast('Could not play that file'); });
  });

  let lastUp = null;
  function updateUpNext() { // "Up next: ..." under the lyric line
    const e = $('upnext'); if (!e) return;
    const t = cur ? lib.find((x) => x.id === peekNext()) : null, txt = t ? `Up next · ${t.title}${t.artist ? ' – ' + t.artist : ''}` : '';
    if (txt !== lastUp) { lastUp = txt; e.textContent = txt; }
  }
  function emit() {
    updateUpNext();
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
  function pushNative(withArt) { if (bg && bgOn && audio !== nd) { const p = nativePayload(withArt); bg.update(p).then(() => { if (p.art && cur) artSentFor = keyOf(cur); }).catch(() => {}); } }
  function stopBackgroundSoon() { clearTimeout(bgTimer); bgTimer = setTimeout(() => { if (audio.paused && bg && bgOn) { bg.stop().catch(() => {}); bgOn = false; nativeLive = false; } }, 30 * 60 * 1000); } // stays in the notification shade (so a headset or the shade can resume) for half an hour paused
  let duckVol = 0;

  if (bg && bg.addListener) bg.addListener('native', (e) => { // what the native player is doing
    if (!e) return;
    if (e.type === 'state') { if (e.id && cur && e.id !== cur.id && audio === nd) nativeTrack(e.id); if (audio === nd) nd.sync(e); }
    else if (e.type === 'track') nativeTrack(e.id);
    else if (e.type === 'needjs') { if (e.id) { audio = nd; nd.setPlaying(false); const i = order.indexOf(e.id); if (i >= 0) { idx = i; playId(e.id, true); } } } // next song is one only the web player can open
    else if (e.type === 'error') toast('Could not play that file');
  });
  async function restoreNative() { // the app was swiped away while music played: pick the native player up where it is
    if (!nativeOK() || !bg.getState) return false;
    try {
      const st = await bg.getState(); if (!st || !st.active || !st.ids || !st.ids.length) return false;
      const curId = st.ids[st.index], now = lib.find((t) => t.id === curId);
      if (!now) { bg.release().catch(() => {}); return false; } // that song is gone from the library
      const ids = st.ids.filter((x) => lib.some((t) => t.id === x));
      const last = LS.get('vibe.last', null); if (last && last.src) source = last.src;
      order = ids; orderVer++; nativeVer = ids.length === st.ids.length ? orderVer : -1; nativeLive = true; bgOn = true; repeat = st.repeat || 'None';
      cur = now; idx = ids.indexOf(curId); useNative();
      nd.sync({ pos: st.pos, dur: st.dur, playing: st.playing });
      emitArt(); emit(); updateUpNext(); lazyArt(cur).catch(() => {});
      return true;
    } catch { return false; }
  }

  /* ---------- Android Auto / Assistant (Pro) ---------- */
  function autoPlay(id, listId) { // a song picked in the car's browse tree
    if (!entitled.has('pro') || !id || !lib.some((t) => t.id === id)) return;
    source = listId && playlists.some((p) => p.id === listId) ? { type: 'playlist', id: listId } : { type: 'library', id: null };
    buildOrder(id); loadTrack(id, true);
  }
  function autoSearch(q) { // "Hey Google, play <song / artist> on NorwinVibe"
    if (!entitled.has('pro')) return;
    q = String(q || '').trim().toLowerCase();
    if (!q) { if (!cur) startPlayback(); else audio.play(); return; }
    const words = q.split(/\s+/).filter(Boolean);
    const score = (t) => { const hay = `${t.title} ${t.artist} ${t.album}`.toLowerCase(); return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) + (t.title.toLowerCase() === q ? 3 : 0); };
    const best = lib.map((t) => [score(t), t]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]);
    if (!best.length) return;
    const top = best[0][1]; source = { type: 'library', id: null }; buildOrder(top.id); loadTrack(top.id, true);
  }
  let autoTimer = 0;
  function pushAuto() { // keep the car's browse tree in step with the library and playlists (debounced)
    if (!bg || !bg.setLibrary) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      const pro = entitled.has('pro');
      const songs = pro ? lib.slice(0, 300).map((t) => ({ id: t.id, t: t.title, a: t.artist || '' })) : [];
      const lists = pro ? playlists.map((p) => ({ id: p.id, name: p.name, ids: sourceIdsFor(p.id).slice(0, 200) })) : [];
      bg.setLibrary({ songs, lists }).catch(() => {});
    }, 1200);
  }
  window.addEventListener('vibe:library', pushAuto);
  if (bg && bg.addListener) bg.addListener('action', (e) => { // buttons on the notification / lock screen / widget
    const a = e && e.action;
    if ((a === 'play' || a === 'toggle') && !cur) startPlayback();
    else if (a === 'play') audio.play(); else if (a === 'pause') audio.pause(); else if (a === 'toggle') (audio.paused ? audio.play() : audio.pause());
    else if (a === 'playId') autoPlay(e.id, e.list);
    else if (a === 'playSearch') autoSearch(e.query);
    else if (a === 'duck') { if (!duckVol) { duckVol = audio.volume; setVol(duckVol * 0.3); } } // another app is speaking: lower the music
    else if (a === 'unduck') { if (duckVol) { setVol(duckVol); duckVol = 0; } }
    else if (a === 'next') next(); else if (a === 'prev') prev(); else if (a === 'seekTo') { audio.currentTime = (e.position || 0) / 1000; emit(); }
  });

  /* ================= anonymous usage numbers =================
     With a statsUrl in store.config.json and "Share anonymous usage numbers" on (Settings > About): a random id made up on this phone, the
     app version and "android", sent when the app opens and every few minutes while it is on screen. Nothing else. */
  function usageStats() {
    const url = String(storeCfg().statsUrl || ''); if (!/^https:\/\//.test(url)) return;
    let id = LS.get('nv.installId', ''); if (!id) { id = crypto.randomUUID ? crypto.randomUUID() : ''; if (id) LS.set('nv.installId', id); } if (!id) return;
    const send = (e) => { if (prefs.stats === false || document.hidden) return; fetch(url.replace(/\/$/, '') + '/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, v: window.APP_VERSION || '', p: 'android', e }) }).catch(() => {}); };
    setTimeout(() => send('open'), 6000);
    setInterval(() => send('beat'), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) send('beat'); });
  }
  setTimeout(usageStats, 0); // (after the rest of this file has set up what it reads)

  /* ================= lyrics (LRCLIB; CapacitorHttp makes fetch bypass CORS) ================= */
  const lyricCache = new Map();
  const lyricDisk = { get: (k) => (LS.get('vibe.lyrics', {}) || {})[k] || null, put(k, v) { const all = LS.get('vibe.lyrics', {}) || {}; delete all[k]; all[k] = v; const ks = Object.keys(all); if (ks.length > 150) ks.slice(0, ks.length - 150).forEach((x) => delete all[x]); LS.set('vibe.lyrics', all); } }; // seen lyrics also work offline
  async function getJson(url) { try { const r = await fetch(url, { headers: { 'User-Agent': 'NorwinVibe-Mobile/1.0' } }); return r.ok ? await r.json() : null; } catch { return null; } }
  async function fetchLyrics({ artist, title, album, dur }) {
    const s = (v) => String(v || '').slice(0, 200); artist = s(artist); title = s(title); album = s(album);
    if (!artist || !title) return null;
    const key = `${artist}|${title}|${Math.round(dur)}`.toLowerCase(); if (lyricCache.has(key)) return lyricCache.get(key);
    const saved = lyricDisk.get(key); if (saved) { lyricCache.set(key, saved); return saved; }
    const q = new URLSearchParams({ artist_name: artist, track_name: title }); if (album) q.set('album_name', album); if (dur > 0) q.set('duration', String(Math.round(dur)));
    let hit = await getJson(`https://lrclib.net/api/get?${q}`), diff = hit && dur > 0 && hit.duration ? Math.abs(hit.duration - dur) : 0;
    if (!hit) {
      const list = await getJson(`https://lrclib.net/api/search?${new URLSearchParams({ artist_name: artist, track_name: title })}`);
      const best = LRC.pickBest(list, dur); if (best) { hit = best.hit; diff = best.diff; } // closest in length (src/lrc.js)
    }
    const out = hit && (hit.syncedLyrics || hit.plainLyrics) ? { synced: hit.syncedLyrics || '', plain: hit.plainLyrics || '', diff } : null;
    if (lyricCache.size > 100) lyricCache.clear(); lyricCache.set(key, out); if (out) lyricDisk.put(key, out); return out;
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
      for (const a of rel.assets || []) { const m = /-b(\d+)\.apk$/.exec(a.name || ''); if (m && (!best || +m[1] > best.build)) best = { build: +m[1], url: a.browser_download_url, name: a.name }; }
      if (!best || best.build <= Number(updInfo.versionCode)) { setUpd({ state: 'none' }); return upd; }
      const version = ((/Android-([\d.]+)-b\d+\.apk$/.exec(best.name) || [])[1]) || `build ${best.build}`; // the phone's own version, not the Windows release tag
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
    setLoop: (a, b) => { if (nativeLive && audio === nd && bg.setLoop) bg.setLoop({ a: Math.round((a || 0) * 1000), b: Math.round((b || 0) * 1000) }).catch(() => {}); },
    idleResume: () => { const l = LS.get('vibe.last', null), t = l && lib.find((x) => x.id === l.id); return t ? { title: t.title, artist: t.artist || '' } : null; }, // the idle card's "Resume" button
    playRecent: (id) => { // a song tapped under "recently played" on the idle card (ids are "artist|title")
      const t = lib.find((x) => `${x.artist || ''}|${x.title}`.toLowerCase() === id) || lib.find((x) => id.endsWith(`|${x.title.toLowerCase()}`));
      if (t) { source = { type: 'library', id: null }; buildOrder(t.id); loadTrack(t.id, true); }
    },
    idlePlay: () => startPlayback(), noLoopback: true, idleText: 'Add music from your phone to get started',
    onState: (f) => { cb.state = f; }, onArt: (f) => { cb.art = f; }, onPin: () => {}, onSleep: (f) => { cb.sleep = f; }, onOwned: (f) => { cb.owned = f; },
    cmd: (c) => {
      const [k, v] = String(c).split(':');
      if (k === 'toggle') { if (!cur) startPlayback(); else if (audio.paused) audio.play(); else audio.pause(); }
      else if (k === 'play') { if (!cur) startPlayback(); else audio.play(); } else if (k === 'pause') audio.pause();
      else if (k === 'next') next(); else if (k === 'prev') prev();
      else if (k === 'seek') { audio.currentTime = parseFloat(v) || 0; emit(); }
      else if (k === 'shuffle') { shuffle = v === '1'; buildOrder(cur && cur.id); emit(); }
      else if (k === 'repeat') { repeat = v; if (nativeLive) bg.setRepeat({ mode: v }).catch(() => {}); emit(); }
      else if (k === 'volume') { setVol(Math.min(1, Math.max(0, parseFloat(v)))); emit(); }
      else if (k === 'volstep') { setVol(Math.min(1, Math.max(0, audio.volume + parseFloat(v)))); emit(); }
      else if (k === 'mute') { muted = v === '1'; [...decks, nd].forEach((d) => { d.muted = muted; }); emit(); }
    },
    onUpdate: (f) => { cb.update = f; }, updateState: async () => upd, updateCheck: () => updateCheck(true), updateInstall: () => updateInstall(),
    prefs: async () => { const { devAsFree, ...rest } = prefs; return { ...DEFAULTS, ...rest, owned: entitlementList(), sleepEnds, version: window.APP_VERSION || '' }; },
    setPrefs: (patch) => {
      for (const [k, v] of Object.entries(patch || {})) {
        if (PRO_KEYS.has(k) && !entitled.has('pro')) continue;
        if (ENUMS[k] && ENUMS[k].includes(v) && allowed(k, v)) prefs[k] = v; else if (typeof DEFAULTS[k] === 'boolean' && typeof v === 'boolean') prefs[k] = v;
      } savePrefs(); if ('replaygain' in (patch || {}) || 'recordstop' in (patch || {})) pushFx();
    },
    exportFile: async (f) => { // share sheet (save to Files / send to an app); falls back to the clipboard for text
      try {
        const bytes = f.base64 ? Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0)) : null;
        const file = new File([bytes || f.content], f.name || 'export.txt', { type: f.mime || 'text/plain' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: f.name }); return { ok: true }; }
      } catch (e) { if (e && e.name === 'AbortError') return { ok: false, canceled: true }; }
      if (!f.base64) { try { await navigator.clipboard.writeText(f.content); return { ok: true, copied: true }; } catch {} }
      return { ok: false };
    },
    lyrics: (m) => fetchLyrics(m || {}),
    toast: () => {}, sleep: (m) => setSleep([0, 5, 10, 15, 30, 45, 60, 90, 120].includes(m) ? m : 0),
    close: () => {}, minimize: () => {}, pin: () => {}, mini: () => {}, fullscreen: () => {},
    storeInfo: async () => {
      const c = storeCfg();
      return { owned: entitlementList(), restore: /^https:\/\//.test(c.restoreUrl || ''), items: Object.fromEntries(['pro', ...PACK_IDS].map((id) => [id, { name: c.items?.[id]?.name || id, price: c.items?.[id]?.price || '', hasCheckout: /^https:\/\//.test(c.items?.[id]?.checkoutUrl || '') }])) };
    },
    storeBuy: async (id) => {
      const url = storeCfg().items?.[id]?.checkoutUrl;
      if (!['pro', ...PACK_IDS].includes(id) || !/^https:\/\//.test(url || '')) return { ok: false, error: 'Checkout is not set up yet.' };
      window.open(url, '_blank'); return { ok: true };
    },
    storeRestore: async (email) => {
      const url = storeCfg().restoreUrl; if (!/^https:\/\//.test(url || '')) return { ok: false, error: 'Restore is not set up yet.' };
      try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); return { ok: r.ok }; } catch { return { ok: false, error: 'No connection.' }; }
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
  const ICON_X = 'M6 6l12 12M18 6L6 18', ICON_PLUS = 'M12 5v14M5 12h14', ICON_NEXT = 'M5 5l9 7-9 7zM17 5v14', ICON_UP = 'M12 19V6M6 11l6-6 6 6';
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
    window.dispatchEvent(new Event('vibe:library'));
    const tabs = $('lib-tabs'); if (tabs) tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === libTab));
    searchEl.style.display = libTab === 'songs' ? '' : 'none';
    $('lib-actions').style.display = libTab === 'songs' ? '' : 'none';
    if (libTab === 'queue') return renderQueue();
    if (libTab === 'lists') return renderPlaylists();
    $('lib-count').textContent = lib.length ? `${lib.length} song${lib.length === 1 ? '' : 's'}` : 'Your library';
    const q = (searchEl.value || '').trim().toLowerCase();
    const rows = q ? lib.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) : lib;
    listEl.textContent = '';
    if (!rows.length) return empty(lib.length ? 'No matches' : 'Tap "Find my music" to add the songs on your phone');
    // big libraries: draw 60 rows now and more as the list is scrolled (thousands of rows at once would make the phone crawl)
    pageRows = rows; pageShown = 0; listEl.scrollTop = 0; appendRows();
  }
  const PAGE = 60; let pageRows = [], pageShown = 0;
  function appendRows() {
    const end = Math.min(pageRows.length, pageShown + PAGE), frag = document.createDocumentFragment();
    for (let i = pageShown; i < end; i++) {
      const t = pageRows[i];
      const row = songRow(t, [
        iconBtn('Play next', ICON_NEXT, () => playNext(t.id)),
        iconBtn('Add to a playlist', ICON_PLUS, () => pickPlaylist(t.id)),
        iconBtn('Remove from library', ICON_X, () => { if (confirm(`Remove "${t.title}" from your library?`)) removeTrack(t.id); }),
      ]);
      row.onclick = () => { source = { type: 'library', id: null }; playId(t.id); closeLib(); };
      frag.appendChild(row);
    }
    listEl.appendChild(frag); pageShown = end;
  }
  listEl.addEventListener('scroll', () => { if (libTab === 'songs' && pageShown < pageRows.length && listEl.scrollTop + listEl.clientHeight > listEl.scrollHeight - 400) appendRows(); }, { passive: true });

  function playNext(id) {
    if (!cur) { source = { type: 'library', id: null }; playId(id); return; }
    const k = order.indexOf(id); if (k >= 0) { order.splice(k, 1); if (k <= idx) idx--; }
    order.splice(idx + 1, 0, id); toast('Playing next'); orderEdited();
  }
  /* drag a queue row by its handle to a new place; the list below it makes room as you go */
  function dragReorder(handle, row, pos) {
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault(); handle.setPointerCapture(e.pointerId);
      const rows = [...listEl.querySelectorAll('.hrow')], from = rows.indexOf(row), h = row.offsetHeight, y0 = e.clientY;
      let to = from; row.classList.add('dragging'); row.style.zIndex = 3; row.style.position = 'relative';
      const move = (ev) => {
        const dy = ev.clientY - y0; row.style.transform = `translateY(${dy}px)`;
        to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / h)));
        rows.forEach((r, i) => { if (r !== row) r.style.transform = i > from && i <= to ? `translateY(${-h}px)` : i < from && i >= to ? `translateY(${h}px)` : ''; });
      };
      const up = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
        if (to !== from) { const [x] = order.splice(pos, 1); order.splice(idx + 1 + to, 0, x); orderEdited(); }
        renderQueue();
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });
  }
  function renderQueue() { // what is coming up; tap to jump there, arrow = move to the top, x = take it out
    listEl.textContent = '';
    $('lib-count').textContent = 'Up next';
    const ids = order.slice(idx + 1, idx + 61);
    if (!cur || !ids.length) return empty(cur ? 'Nothing else is queued' : 'Play a song to see the queue');
    ids.forEach((id, n) => {
      const t = lib.find((x) => x.id === id); if (!t) return;
      const pos = idx + 1 + n;
      const handle = document.createElement('button'); handle.className = 'star drag-h'; handle.title = 'Drag to reorder'; handle.setAttribute('aria-label', 'Drag to reorder');
      handle.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 9h14M5 15h14"/></svg>';
      const row = songRow(t, [
        handle,
        iconBtn('Move to the top', ICON_UP, () => { order.splice(pos, 1); order.splice(idx + 1, 0, id); orderEdited(); renderQueue(); }),
        iconBtn('Remove from the queue', ICON_X, () => { order.splice(pos, 1); orderEdited(); renderQueue(); }),
      ]);
      row.onclick = () => { idx = pos - 1; next(); closeLib(); };
      dragReorder(handle, row, pos);
      listEl.appendChild(row);
    });
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
  let searchTimer = 0; searchEl.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderLibrary, 160); }; // wait for a pause in typing
  $('lib-play-all').onclick = () => { if (!lib.length) return; source = { type: 'library', id: null }; shuffle = false; buildOrder(); playId(order[0], true); closeLib(); };
  $('lib-shuffle-all').onclick = () => { if (!lib.length) return; source = { type: 'library', id: null }; shuffle = true; buildOrder(); playId(order[0], true); closeLib(); };
  libReady.then(async () => { if (!(await restoreNative())) buildOrder(); renderLibrary(); setTimeout(migrateBlobs, 8000); scanPhone(false); if (bg && bg.takePending) bg.takePending().then((p) => { if (p && p.id) autoPlay(p.id, p.list); else if (p && p.query != null) autoSearch(p.query); }).catch(() => {}); }); // quiet rescan on launch (never prompts)
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

  /* ================= mini player (shown under any open panel: library, history, settings) ================= */
  const mp = $('mini-player');
  if (mp) {
    const q = (s) => mp.querySelector(s), mpPlay = q('.mp-play'), mpBar = q('.mp-bar i');
    const syncMini = () => {
      if (!cur) return;
      q('.mp-title').textContent = cur.title; q('.mp-artist').textContent = cur.artist || 'Unknown artist';
      q('.mp-art').style.backgroundImage = cur.art ? `url("${cur.art}")` : '';
      mpPlay.innerHTML = `<svg viewBox="0 0 24 24"><path d="${audio.paused ? 'M8 5v14l11-7z' : 'M7 5h4v14H7zM13 5h4v14h-4z'}"/></svg>`;
      mpPlay.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    };
    const syncBar = () => { const d = audio.duration; mpBar.style.width = Number.isFinite(d) && d > 0 ? `${Math.min(100, (audio.currentTime / d) * 100).toFixed(1)}%` : '0%'; };
    const baseEmit = emit; // refresh whenever the song or play state changes
    emit = function () { baseEmit(); syncMini(); syncBar(); };
    setInterval(() => { if (!audio.paused) syncBar(); }, 500);
    q('.mp-info').onclick = () => document.querySelectorAll('.pop.open').forEach((p) => p.classList.remove('open')); // back to the full player
    q('.mp-prev').onclick = (e) => { e.stopPropagation(); prev(); };
    q('.mp-next').onclick = (e) => { e.stopPropagation(); next(); };
    mpPlay.onclick = (e) => { e.stopPropagation(); if (!cur) startPlayback(); else if (audio.paused) audio.play(); else audio.pause(); };
    syncMini();
  }

  /* ================= phone integration ================= */
  document.addEventListener('DOMContentLoaded', () => {}); // (scripts load at the end of <body>, so the DOM is already there)
  const card = $('card');
  card.addEventListener('dblclick', (e) => e.stopImmediatePropagation(), true); // no mini mode on a phone
  // (the status and navigation bars are transparent and drawn over the player by MainActivity; nothing to set here)
  const app = plugin('App');
  if (app && app.addListener) app.addListener('appStateChange', (st) => { if (st && st.isActive) scanPhone(false); }); // pick up songs added while the app was in the background
  if (app && app.addListener) app.addListener('backButton', () => { // close panels / leave ambient first, otherwise send the app to the background (music keeps playing)
    const open = document.querySelector('.pop.open');
    if (open) { open.classList.remove('open'); return; }
    if (document.body.classList.contains('fullscreen') && typeof setMode === 'function') { setMode('none'); return; }
    app.minimizeApp?.();
  });
  // size the record to the screen width
  const fit = () => { // size the record to the screen; in landscape it is the height that limits it
    const land = window.innerWidth > window.innerHeight;
    const ms = land ? Math.max(0.6, Math.min(1.3, (card.clientHeight - 64) / 250)) : Math.max(0.9, Math.min(1.5, (card.clientWidth - 40) / 300));
    document.documentElement.style.setProperty('--ms', ms.toFixed(2));
  };
  window.addEventListener('resize', fit); window.addEventListener('orientationchange', () => setTimeout(fit, 150)); fit(); setTimeout(fit, 300);
  // car mode: big buttons (remembered)
  const carSw = $('sw-car');
  if (carSw) { const setCar = (on) => { document.body.classList.toggle('car', on); carSw.classList.toggle('on', on); LS.set('nv.car', on); setTimeout(fit, 50); }; setCar(!!LS.get('nv.car', false)); carSw.onclick = () => setCar(!document.body.classList.contains('car')); }
})();
