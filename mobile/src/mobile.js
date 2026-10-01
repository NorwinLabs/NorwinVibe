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
  const DEFAULTS = { pin: true, mini: false, theme: 'art', record: 'vinyl', speed: 'slow', needle: 'classic', viz: 'bars', bgart: 'cover', lyrics: true, toasts: false, fade: false, snap: false, autostart: false };
  const ENUMS = {
    bgart: ['cover', 'soft', 'off'],
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
  let prefs = LS.get('vibe.prefs', {});
  let owned = LS.get('vibe.owned', []);
  const allowed = (k, v) => { for (const [id, u] of Object.entries(PAID)) if (u[k] && u[k].includes(v)) return owned.includes(id); return true; };
  for (const k of Object.keys(ENUMS)) if (k in prefs && !allowed(k, prefs[k])) delete prefs[k];
  const savePrefs = () => LS.set('vibe.prefs', prefs);

  const b64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  const hex = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
  function verifyLicense(key) { // key = base64url(payload) + '.' + base64url(ed25519 signature)
    try {
      const [p, sig] = String(key).trim().split('.');
      const payload = b64u(p);
      if (!window.nacl || !window.nacl.sign.detached.verify(payload, b64u(sig), hex(window.LICENSE_PUBKEY_HEX))) return null;
      const o = JSON.parse(new TextDecoder().decode(payload));
      return PAID[o.item] ? o.item : null;
    } catch { return null; }
  }
  const grant = (id) => { owned = [...new Set([...owned, id])]; LS.set('vibe.owned', owned); cb.owned && cb.owned(owned); };

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
  async function removeTrack(id) {
    await dbMulti(['meta', 'blobs'], (m, b) => { m.delete(id); b.delete(id); });
    lib = lib.filter((t) => t.id !== id);
    if (cur && cur.id === id) { audio.pause(); audio.removeAttribute('src'); cur = null; emitArt(); }
    buildOrder(cur && cur.id); renderLibrary(); emit();
  }

  /* ================= playback ================= */
  const audio = new Audio(); audio.preload = 'auto';
  let cur = null, curUrl = '', order = [], idx = -1, shuffle = false, repeat = 'None', muted = false;
  const cb = {}; // bridge callbacks registered by the shared UI
  const shuffled = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function buildOrder(startId) {
    let ids = lib.map((t) => t.id);
    if (shuffle) { shuffled(ids); if (startId) { const i = ids.indexOf(startId); if (i > 0) { ids.splice(i, 1); ids.unshift(startId); } } }
    order = ids; idx = startId ? order.indexOf(startId) : -1;
  }
  const keyOf = (t) => `${t.title}|${t.artist}|${t.album}|Library`;

  async function loadTrack(id, autoplay) {
    const t = lib.find((x) => x.id === id); if (!t) return;
    const rec = await dbDo('blobs', 'readonly', (s) => s.get(id)); if (!rec) { toast('That file is missing'); return; }
    if (curUrl) URL.revokeObjectURL(curUrl);
    curUrl = URL.createObjectURL(rec.blob); audio.src = curUrl; cur = t; idx = order.indexOf(id);
    emitArt(); setSession();
    if (autoplay) { try { await audio.play(); startBackground(); } catch { toast('Tap play to start'); } }
    emit();
  }
  function playId(id, keepOrder) { if (!keepOrder || !order.includes(id)) buildOrder(id); return loadTrack(id, true); }
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
  audio.addEventListener('ended', () => { if (repeat === 'Track') { audio.currentTime = 0; audio.play(); } else next(); });
  ['play', 'pause', 'loadedmetadata', 'seeked', 'durationchange'].forEach((e) => audio.addEventListener(e, () => { emit(); if (e === 'pause') stopBackgroundSoon(); else if (e === 'play') startBackground(); }));
  audio.addEventListener('error', () => { toast('Could not play that file'); });

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

  /* lock-screen / headset buttons (MediaSession) */
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
    updateNotification();
  }
  setInterval(() => {
    if (!('mediaSession' in navigator) || !cur || !Number.isFinite(audio.duration)) return;
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch {}
  }, 1000);

  /* keep playing with the screen off: a foreground "now playing" service (see MediaPlaybackService.java) */
  const bg = plugin('MediaService'); let bgOn = false, bgTimer = 0;
  const bgText = () => ({ title: cur ? cur.title : 'NorwinVibe', text: cur ? (cur.artist || 'Playing') : 'Playing' });
  async function startBackground() {
    clearTimeout(bgTimer);
    if (!bg) return;
    if (bgOn) return updateNotification();
    try { await bg.start(bgText()); bgOn = true; } catch { bgOn = false; }
  }
  const updateNotification = () => { if (bg && bgOn) bg.update(bgText()).catch(() => {}); };
  function stopBackgroundSoon() { clearTimeout(bgTimer); bgTimer = setTimeout(() => { if (audio.paused && bg && bgOn) { bg.stop().catch(() => {}); bgOn = false; } }, 60000); }

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

  /* ================= sleep timer ================= */
  let sleepTimer = 0, sleepEnds = 0;
  function setSleep(mins) {
    clearTimeout(sleepTimer); sleepEnds = 0;
    if (mins > 0) { sleepEnds = Date.now() + mins * 60000; sleepTimer = setTimeout(() => { audio.pause(); sleepEnds = 0; cb.sleep && cb.sleep(0); }, mins * 60000); }
    cb.sleep && cb.sleep(sleepEnds);
  }

  /* ================= the bridge the shared UI talks to ================= */
  const storeCfg = () => window.STORE_CONFIG || { testMode: false, items: {} };
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
      else if (k === 'volume') { audio.volume = Math.min(1, Math.max(0, parseFloat(v))); emit(); }
      else if (k === 'volstep') { audio.volume = Math.min(1, Math.max(0, audio.volume + parseFloat(v))); emit(); }
      else if (k === 'mute') { muted = v === '1'; audio.muted = muted; emit(); }
    },
    prefs: async () => ({ ...DEFAULTS, ...prefs, owned, sleepEnds }),
    setPrefs: (patch) => {
      for (const [k, v] of Object.entries(patch || {})) {
        if (ENUMS[k] && ENUMS[k].includes(v) && allowed(k, v)) prefs[k] = v; else if (typeof DEFAULTS[k] === 'boolean' && typeof v === 'boolean') prefs[k] = v;
      } savePrefs();
    },
    lyrics: (m) => fetchLyrics(m || {}),
    toast: () => {}, sleep: (m) => setSleep([0, 15, 30, 60].includes(m) ? m : 0),
    close: () => {}, minimize: () => {}, pin: () => {}, mini: () => {}, fullscreen: () => {},
    storeInfo: async () => {
      const c = storeCfg();
      return { testMode: !!c.testMode, owned, items: Object.fromEntries(Object.keys(PAID).map((id) => [id, { name: c.items?.[id]?.name || id, price: c.items?.[id]?.price || '', hasCheckout: /^https:\/\//.test(c.items?.[id]?.checkoutUrl || '') }])) };
    },
    storeBuy: async (id) => {
      const url = storeCfg().items?.[id]?.checkoutUrl;
      if (!PAID[id] || !/^https:\/\//.test(url || '')) return { ok: false, error: 'Checkout is not set up yet.' };
      window.open(url, '_blank'); return { ok: true };
    },
    storeRedeem: async (key) => { const id = verifyLicense(key); if (id) { grant(id); return { ok: true, item: id }; } return { ok: false, error: 'That license key is not valid.' }; },
    storeTestUnlock: async (id) => { if (storeCfg().testMode && PAID[id]) { grant(id); return { ok: true }; } return { ok: false, error: 'Test mode is off.' }; },
  };

  /* ================= library panel ================= */
  const fileIn = $('lib-file'), listEl = $('lib-list'), searchEl = $('lib-search');
  function openLibrary() { if (typeof togglePop === 'function') { if (!$('pop-library').classList.contains('open')) togglePop('library'); } renderLibrary(); }
  const fmt = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  async function renderLibrary() {
    await libReady;
    $('lib-count').textContent = lib.length ? `${lib.length} song${lib.length === 1 ? '' : 's'}` : 'Your library';
    const q = (searchEl.value || '').trim().toLowerCase();
    const rows = q ? lib.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) : lib;
    listEl.textContent = '';
    if (!rows.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = lib.length ? 'No matches' : 'Tap "Add music" and pick songs from your phone'; listEl.appendChild(e); return; }
    for (const t of rows) {
      const row = document.createElement('div'); row.className = 'hrow' + (cur && cur.id === t.id ? ' now' : '');
      const th = document.createElement('div'); th.className = 'th'; if (t.art) th.style.backgroundImage = `url("${t.art}")`;
      const tx = document.createElement('div'); tx.className = 'tx';
      const b = document.createElement('b'); b.textContent = t.title; const sp = document.createElement('span'); sp.textContent = [t.artist, t.dur ? fmt(t.dur) : ''].filter(Boolean).join(' · ');
      tx.append(b, sp);
      const del = document.createElement('button'); del.className = 'star'; del.title = 'Remove from library'; del.setAttribute('aria-label', 'Remove');
      del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      del.onclick = (e) => { e.stopPropagation(); if (confirm(`Remove "${t.title}" from your library?`)) removeTrack(t.id); };
      row.onclick = () => { playId(t.id); document.getElementById('pop-library').classList.remove('open'); };
      row.append(th, tx, del); listEl.appendChild(row);
    }
  }
  $('btn-library').onclick = (e) => { e.stopPropagation(); togglePop('library'); renderLibrary(); };
  $('btn-add-cta').onclick = () => fileIn.click();
  $('lib-add').onclick = () => fileIn.click();
  fileIn.onchange = () => { const picked = [...fileIn.files]; fileIn.value = ''; if (picked.length) addFiles(picked); }; // copy first: the FileList is live and clearing the input empties it
  searchEl.oninput = renderLibrary;
  $('lib-play-all').onclick = () => { if (!lib.length) return; shuffle = false; playId(lib[0].id); closeLib(); };
  $('lib-shuffle-all').onclick = () => { if (!lib.length) return; shuffle = true; playId(lib[Math.floor(Math.random() * lib.length)].id); closeLib(); };
  const closeLib = () => $('pop-library').classList.remove('open');
  libReady.then(() => { buildOrder(); renderLibrary(); });

  /* ================= phone integration ================= */
  document.addEventListener('DOMContentLoaded', () => {}); // (scripts load at the end of <body>, so the DOM is already there)
  const card = $('card');
  card.addEventListener('dblclick', (e) => e.stopImmediatePropagation(), true); // no mini mode on a phone
  const status = plugin('StatusBar'); if (status) { status.setBackgroundColor?.({ color: '#0c0c12' }).catch(() => {}); status.setStyle?.({ style: 'DARK' }).catch(() => {}); }
  const app = plugin('App');
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
