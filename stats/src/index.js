// NorwinVibe usage numbers: installs, who is online now, daily / weekly / monthly active users, and release downloads.
//   POST /ping        the apps call this on start and every few minutes ({ id, v, p, e })
//   GET  /dashboard?key=STATS_KEY   the page you look at
//   GET  /stats?key=STATS_KEY       the same numbers as JSON
// Stored per install: a random id, the first / last time it was seen, the platform, the app version and a two-letter country.
// Never stored: names, emails, IP addresses, songs, anything about what is played.

const MIN = 60000, DAY = 86400000;
const PLATFORMS = new Set(['win', 'android']);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

function sameKey(a, b) { // constant-time compare, so the key cannot be guessed from response times
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const authorized = (request, env) => {
  const url = new URL(request.url), bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return sameKey(url.searchParams.get('key') || bearer, env.STATS_KEY || '');
};

export async function ping(request, env, now = Date.now()) {
  let b; try { b = await request.json(); } catch { return new Response(null, { status: 400, headers: CORS }); }
  const id = String(b.id || ''), v = String(b.v || '').slice(0, 20), p = String(b.p || ''), e = b.e === 'open' ? 1 : 0;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !PLATFORMS.has(p) || !/^[\w.+-]*$/.test(v)) return new Response(null, { status: 400, headers: CORS });
  const prev = await env.DB.prepare('SELECT last_seen FROM installs WHERE id = ?').bind(id).first();
  if (prev && now - prev.last_seen < 20000 && !e) return new Response(null, { status: 204, headers: CORS }); // too soon after the last one: ignore
  const country = (request.cf && request.cf.country) || null;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO installs (id, first_seen, last_seen, platform, version, country, opens) VALUES (?1, ?2, ?2, ?3, ?4, ?5, 1) ON CONFLICT(id) DO UPDATE SET last_seen = ?2, platform = ?3, version = ?4, country = COALESCE(?5, country), opens = opens + ?6')
      .bind(id, now, p, v, country, e),
    env.DB.prepare('INSERT OR IGNORE INTO active_days (day, id) VALUES (?, ?)').bind(dayOf(now), id),
  ]);
  if (Math.random() < 0.01) await env.DB.prepare('DELETE FROM active_days WHERE day < ?').bind(dayOf(now - 120 * DAY)).run(); // keep ~4 months of daily history
  return new Response(null, { status: 204, headers: CORS });
}

const count = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).first()).c;
const rows = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];

async function downloads(env) { // release downloads straight from GitHub (nothing the apps send): people downloading the installer / APK
  try {
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/releases?per_page=100`, { headers: { 'User-Agent': 'norwinvibe-stats', Accept: 'application/vnd.github+json' }, cf: { cacheTtl: 900, cacheEverything: true } });
    if (!r.ok) return null;
    const out = { windows: 0, android: 0, updates: 0, releases: 0 };
    for (const rel of await r.json()) {
      out.releases++;
      for (const a of rel.assets || []) {
        const n = a.download_count || 0;
        if (rel.tag_name === 'desktop-latest') out.updates += n;          // the rolling feed installed copies check: auto-updates, not new people
        else if (/\.exe$/i.test(a.name)) out.windows += n;
        else if (/\.apk$/i.test(a.name)) out.android += n;
      }
    }
    return out;
  } catch { return null; }
}

export async function collect(env, now = Date.now()) {
  const [total, online, dau, wau, mau, newToday, newWeek] = await Promise.all([
    count(env, 'SELECT COUNT(*) c FROM installs'),
    count(env, 'SELECT COUNT(*) c FROM installs WHERE last_seen > ?', now - 10 * MIN),
    count(env, 'SELECT COUNT(*) c FROM installs WHERE last_seen > ?', now - DAY),
    count(env, 'SELECT COUNT(*) c FROM installs WHERE last_seen > ?', now - 7 * DAY),
    count(env, 'SELECT COUNT(*) c FROM installs WHERE last_seen > ?', now - 30 * DAY),
    count(env, 'SELECT COUNT(*) c FROM installs WHERE first_seen > ?', now - DAY),
    count(env, 'SELECT COUNT(*) c FROM installs WHERE first_seen > ?', now - 7 * DAY),
  ]);
  const [byPlatform, byVersion, byCountry, history, dl] = await Promise.all([
    rows(env, 'SELECT platform k, COUNT(*) n FROM installs WHERE last_seen > ? GROUP BY platform ORDER BY n DESC', now - 30 * DAY),
    rows(env, 'SELECT platform || \' \' || version k, COUNT(*) n FROM installs WHERE last_seen > ? GROUP BY platform, version ORDER BY n DESC LIMIT 8', now - 30 * DAY),
    rows(env, 'SELECT COALESCE(country, \'?\') k, COUNT(*) n FROM installs WHERE last_seen > ? GROUP BY country ORDER BY n DESC LIMIT 8', now - 30 * DAY),
    rows(env, 'SELECT day, COUNT(*) n FROM active_days WHERE day >= ? GROUP BY day ORDER BY day', dayOf(now - 29 * DAY)),
    downloads(env),
  ]);
  return { at: now, installs: { total, newToday, newWeek }, active: { online, day: dau, week: wau, month: mau }, byPlatform, byVersion, byCountry, history, downloads: dl };
}

function page(d) {
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const tile = (label, n, hint = '') => `<div class="t"><b>${num(n)}</b><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
  const list = (title, items) => `<section><h3>${esc(title)}</h3>${items.length ? items.map((r) => `<p><span>${esc(r.k)}</span><b>${num(r.n)}</b></p>`).join('') : '<p class="mut">no data yet</p>'}</section>`;
  const days = []; for (let i = 29; i >= 0; i--) days.push(dayOf(d.at - i * DAY));
  const byDay = Object.fromEntries(d.history.map((r) => [r.day, r.n])), max = Math.max(1, ...days.map((x) => byDay[x] || 0));
  const bars = days.map((x, i) => { const h = Math.round(((byDay[x] || 0) / max) * 100); return `<rect x="${i * 14}" y="${104 - h}" width="10" height="${h}" rx="2"><title>${x}: ${byDay[x] || 0} active</title></rect>`; }).join('');
  const dl = d.downloads;
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>NorwinVibe stats</title>
<style>:root{--bg:#0c0c12;--card:#171722;--fg:#f4f4f8;--mut:#9a9aae;--ac:#8b5cf6}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,sans-serif;padding:20px}main{max-width:880px;margin:auto}h1{font-size:20px;margin:0 0 4px}.mut,small{color:var(--mut)}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}.t{background:var(--card);border-radius:14px;padding:14px}.t b{display:block;font-size:28px;letter-spacing:-.02em}.t span{color:var(--mut);font-size:13px}.t small{display:block;margin-top:2px;font-size:11px}
.live b{color:#3ddc84}section{background:var(--card);border-radius:14px;padding:14px;margin:10px 0}section h3{margin:0 0 8px;font-size:13px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em}section p{display:flex;justify-content:space-between;margin:4px 0}svg{width:100%;height:auto}rect{fill:var(--ac)}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}</style>
<main><h1>NorwinVibe</h1><div class="mut">Updated ${esc(new Date(d.at).toUTCString())} &middot; people are counted by a random id the app made up</div>
<div class="g"><div class="t live"><b>${num(d.active.online)}</b><span>Online now</span><small>seen in the last 10 minutes</small></div>${tile('Active today', d.active.day, 'last 24 hours')}${tile('Active this week', d.active.week)}${tile('Active this month', d.active.month)}</div>
<div class="g">${tile('Installs, all time', d.installs.total, 'every app that has opened once')}${tile('New today', d.installs.newToday)}${tile('New this week', d.installs.newWeek)}</div>
<div class="g">${dl ? tile('Windows downloads', dl.windows, 'installer, from the releases page') + tile('Android downloads', dl.android, 'APK, from the releases page') + tile('Auto-updates', dl.updates, 'the Windows update feed') : tile('Downloads', 0, 'GitHub did not answer; refresh in a minute')}</div>
<section><h3>Active people per day, last 30 days</h3><svg viewBox="0 0 418 108" role="img" aria-label="active people per day">${bars}</svg></section>
<div class="cols">${list('Platform (30 days)', d.byPlatform)}${list('Version (30 days)', d.byVersion)}${list('Country (30 days)', d.byCountry)}</div></main>`;
}

async function emailDigest(env, d) {
  const dl = d.downloads || {};
  const text = `NorwinVibe, ${new Date(d.at).toUTCString()}\n\nOnline now: ${d.active.online}\nActive today: ${d.active.day}   this week: ${d.active.week}   this month: ${d.active.month}\nInstalls: ${d.installs.total} (new today ${d.installs.newToday}, this week ${d.installs.newWeek})\nDownloads: Windows ${dl.windows ?? '?'}, Android ${dl.android ?? '?'}, auto-updates ${dl.updates ?? '?'}\n`;
  await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.FROM_EMAIL, to: [env.REPORT_EMAIL], subject: `NorwinVibe: ${d.active.day} active today, ${d.installs.total} installs`, text }) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'POST' && url.pathname === '/ping') return ping(request, env);
    if (request.method === 'GET' && (url.pathname === '/dashboard' || url.pathname === '/stats')) {
      if (!authorized(request, env)) return new Response('Not found', { status: 404 }); // looks like nothing is here
      const d = await collect(env);
      if (url.pathname === '/stats') return new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      return new Response(page(d), { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_event, env) { if (env.REPORT_EMAIL && env.RESEND_API_KEY) await emailDigest(env, await collect(env)); },
};
