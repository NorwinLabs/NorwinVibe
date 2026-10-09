// node stats/test.mjs : the stats service against a real SQLite database (node:sqlite), with GitHub faked
import assert from 'node:assert/strict';
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { console.log('skipped: this Node has no node:sqlite'); process.exit(0); }
import worker, { ping, collect } from './src/index.js';
import { readFileSync } from 'node:fs';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => sqlite.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
  run: async () => sqlite.prepare(sql).run(...args),
});
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (list) => { sqlite.exec('BEGIN'); try { for (const s of list) await s.run(); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } }, STATS_KEY: 'k'.repeat(24), GITHUB_REPO: 'o/r' };

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0), MIN = 60000, DAY = 86400000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const send = (body, at, country = 'US') => { const r = new Request('https://s.test/ping', { method: 'POST', body: JSON.stringify(body) }); Object.defineProperty(r, 'cf', { value: { country } }); return ping(r, env, at); };

// bad requests are refused
assert.equal((await send({ id: 'nope', v: '1', p: 'win' }, NOW)).status, 400);
assert.equal((await send({ id: uuid(1), v: '1', p: 'toaster' }, NOW)).status, 400);
assert.equal((await send({ id: uuid(1), v: '<script>', p: 'win' }, NOW)).status, 400);
// installs: 1 windows (first seen 40 days ago, seen 3 min ago), 2 android (one new today, one 3 days ago), 3 windows seen 20 days ago
await send({ id: uuid(1), v: '1.0.9', p: 'win', e: 'open' }, NOW - 40 * DAY, 'DE');
await send({ id: uuid(1), v: '1.0.9', p: 'win', e: 'beat' }, NOW - 3 * MIN, 'DE');
await send({ id: uuid(2), v: '1.0.25', p: 'android', e: 'open' }, NOW - 5 * MIN, 'US');
await send({ id: uuid(3), v: '1.0.25', p: 'android', e: 'open' }, NOW - 3 * DAY, 'US');
await send({ id: uuid(4), v: '1.0.8', p: 'win', e: 'open' }, NOW - 20 * DAY, 'GB');
// a beat 5 s after the last one is ignored; a fresh "open" is not
const before = sqlite.prepare('SELECT last_seen FROM installs WHERE id = ?').get(uuid(2)).last_seen;
await send({ id: uuid(2), v: '1.0.25', p: 'android', e: 'beat' }, NOW - 5 * MIN + 5000);
assert.equal(sqlite.prepare('SELECT last_seen FROM installs WHERE id = ?').get(uuid(2)).last_seen, before, 'too-soon beats are ignored');
await send({ id: uuid(2), v: '1.0.25', p: 'android', e: 'open' }, NOW - 4 * MIN);
assert.equal(sqlite.prepare('SELECT opens FROM installs WHERE id = ?').get(uuid(2)).opens, 2);

const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify([
  { tag_name: 'v1.0.9', assets: [{ name: 'NorwinVibe-Setup-1.0.9.exe', download_count: 12 }, { name: 'NorwinVibe-Android-1.0.9.apk', download_count: 7 }] },
  { tag_name: 'v1.0.8', assets: [{ name: 'NorwinVibe-Setup-1.0.8.exe', download_count: 5 }] },
  { tag_name: 'desktop-latest', assets: [{ name: 'NorwinVibe-Setup.exe', download_count: 99 }, { name: 'latest.yml', download_count: 99 }] },
]), { status: 200 });

const d = await collect(env, NOW);
assert.deepEqual(d.installs, { total: 4, newToday: 1, newWeek: 2 }, 'installs: four apps; one is new today, two this week');
assert.deepEqual(d.active, { online: 2, day: 2, week: 3, month: 4 }, 'online (10 min) / day / week / month');
assert.deepEqual(d.downloads, { windows: 17 + 99 * 0 + 0, android: 7, updates: 198, releases: 3 }, 'downloads: installers vs the auto-update feed');
assert.equal(d.byPlatform[0].k, 'win'); assert.equal(d.byCountry.find((c) => c.k === 'US').n, 2);
assert.ok(d.history.length >= 1);

// the dashboard needs the key and shows the numbers
assert.equal((await worker.fetch(new Request('https://s.test/dashboard'), env)).status, 404);
assert.equal((await worker.fetch(new Request('https://s.test/dashboard?key=wrong'), env)).status, 404);
const html = await (await worker.fetch(new Request(`https://s.test/dashboard?key=${env.STATS_KEY}`), env)).text();
assert.ok(html.includes('Online now') && html.includes('Installs, all time') && html.includes('Windows downloads'));
const json = await (await worker.fetch(new Request('https://s.test/stats', { headers: { Authorization: `Bearer ${env.STATS_KEY}` } }), env)).json();
assert.equal(json.installs.total, 4);
globalThis.fetch = realFetch;
console.log('stats ok');
