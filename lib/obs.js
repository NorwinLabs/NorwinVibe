'use strict';
/* "Now playing" overlay for OBS Studio / Streamlabs (a Browser source), served from this computer only.
     http://127.0.0.1:<port>/            the overlay page (transparent background)
     http://127.0.0.1:<port>/state.json  current song as JSON
     http://127.0.0.1:<port>/art         current cover art image
     http://127.0.0.1:<port>/nowplaying.txt   "Artist - Title" for text sources
   Overlay options (add to the URL):  ?scale=1.25  ?accent=%23ff3366  ?light=1  ?noart=1  ?align=right */
const http = require('http');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>NorwinVibe overlay</title><style>
:root { --accent: #8b5cf6; --scale: 1; }
* { box-sizing: border-box; margin: 0; }
html, body { background: transparent; overflow: hidden; font-family: "Segoe UI", system-ui, sans-serif; }
#wrap { position: fixed; left: 16px; top: 16px; transform-origin: top left; transform: scale(var(--scale)); }
body.right #wrap { left: auto; right: 16px; transform-origin: top right; }
#card { display: flex; gap: 14px; align-items: center; width: 440px; padding: 12px; border-radius: 18px; color: #fff;
  background: rgba(14,14,22,.78); box-shadow: 0 0 0 1px rgba(255,255,255,.1) inset, 0 12px 30px rgba(0,0,0,.35);
  backdrop-filter: blur(14px); transition: opacity .6s, transform .6s; }
body.light #card { background: rgba(255,255,255,.82); color: #14141c; box-shadow: 0 0 0 1px rgba(0,0,0,.1) inset, 0 12px 30px rgba(0,0,0,.2); }
#card.hide { opacity: 0; transform: translateY(-8px); }
#art { flex: none; width: 88px; height: 88px; border-radius: 12px; object-fit: cover; background: linear-gradient(135deg, var(--accent), #ec4899); }
body.noart #art { display: none; }
#txt { flex: 1; min-width: 0; }
#title { font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#artist { margin-top: 2px; font-size: 14px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar { margin-top: 12px; height: 5px; border-radius: 3px; background: rgba(128,128,128,.3); overflow: hidden; }
#fill { display: block; height: 100%; width: 0; border-radius: 3px; background: var(--accent); transition: width .5s linear; }
</style></head><body><div id="wrap"><div id="card" class="hide"><img id="art" alt=""><div id="txt"><div id="title"></div><div id="artist"></div><div class="bar"><i id="fill"></i></div></div></div></div>
<script>
const q = new URLSearchParams(location.search), r = document.documentElement.style;
if (q.get('scale')) r.setProperty('--scale', Math.min(4, Math.max(.3, parseFloat(q.get('scale')) || 1)));
if (q.get('accent')) r.setProperty('--accent', q.get('accent'));
if (q.get('light')) document.body.classList.add('light');
if (q.get('noart')) document.body.classList.add('noart');
if (q.get('align') === 'right') document.body.classList.add('right');
const $ = (i) => document.getElementById(i); let artKey = '';
async function tick() {
  try {
    const s = await (await fetch('state.json', { cache: 'no-store' })).json();
    $('card').classList.toggle('hide', !s.active);
    if (s.active) {
      $('title').textContent = s.title || 'Unknown title'; $('artist').textContent = s.artist || '';
      $('fill').style.width = s.dur > 0 ? Math.min(100, s.pos / s.dur * 100) + '%' : '0%';
      $('card').style.opacity = s.playing ? 1 : .75;
      if (s.artKey !== artKey) { artKey = s.artKey; if (s.hasArt) $('art').src = 'art?k=' + encodeURIComponent(artKey); else $('art').removeAttribute('src'); }
    }
  } catch (e) { $('card').classList.add('hide'); }
}
tick(); setInterval(tick, 500);
</script></body></html>`;

/** getSnapshot() -> { state: {...}, art: { mime, bytes } | null } supplied by the app. */
function createObsServer(getSnapshot) {
  let server = null, port = 0;
  const handler = (req, res) => {
    let url; try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
    res.setHeader('Cache-Control', 'no-store');
    const snap = getSnapshot();
    if (url.pathname === '/' || url.pathname === '/overlay') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    if (url.pathname === '/state.json') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(snap.state)); }
    if (url.pathname === '/art') {
      if (!snap.art) { res.writeHead(204); return res.end(); }
      res.writeHead(200, { 'Content-Type': snap.art.mime }); return res.end(snap.art.bytes);
    }
    if (url.pathname === '/nowplaying.txt') {
      const s = snap.state; res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(s.active ? [s.artist, s.title].filter(Boolean).join(' - ') : '');
    }
    res.writeHead(404); res.end();
  };
  /** Tries `preferred`, then the next few ports. Only ever listens on 127.0.0.1. */
  function start(preferred = 17773) {
    return new Promise((resolve, reject) => {
      let p = preferred;
      const attempt = () => {
        const s = http.createServer(handler);
        s.once('error', (e) => { if (e.code === 'EADDRINUSE' && p < preferred + 5) { p++; attempt(); } else reject(e); });
        s.listen(p, '127.0.0.1', () => { server = s; port = p; resolve({ port: p, url: `http://127.0.0.1:${p}/` }); });
      };
      attempt();
    });
  }
  function stop() { return new Promise((resolve) => { if (!server) return resolve(); const s = server; server = null; port = 0; s.close(() => resolve()); }); }
  return { start, stop, get running() { return !!server; }, get port() { return port; } };
}

module.exports = { createObsServer };
