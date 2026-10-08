// npm run check : everything that can be verified without a device. Run it before pushing (CI runs it too).
//   1. every JavaScript file parses
//   2. every element the UI code looks up by id ($('x')) exists in src/index.html (a missing one crashes the page on load)
//   3. the unit tests: media-key emulation, lyric parsing, and the license Worker end to end
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
let failed = 0;
const fail = (m) => { failed++; console.error('FAIL ' + m); };

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'www', 'android', '.git', '.licensing'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};
const files = walk(root).filter((f) => !f.includes(`${path.sep}vendor${path.sep}`));
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(`syntax: ${path.relative(root, f)}\n${r.stderr}`);
}
console.log(`syntax ok: ${files.length} files`);

const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const phoneHtml = fs.readFileSync(path.join(root, 'mobile', 'scripts', 'sync-web.js'), 'utf8'); // the phone build injects more markup (library, equalizer...)
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g), ...phoneHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const dynamic = new Set(['pl-menu', 'upnext']); // created by script, or only on the phone (mobile/scripts/sync-web.js adds them)
for (const f of fs.readdirSync(path.join(root, 'src')).filter((n) => n.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  for (const m of text.matchAll(/(?<![\w.])\$\('([\w-]+)'\)/g)) {
    if (!ids.has(m[1]) && !dynamic.has(m[1]) && !new RegExp(`\\.id\\s*=\\s*['"]${m[1]}['"]`).test(text)) fail(`src/${f}: $('${m[1]}') has no element with that id in index.html`);
  }
}
console.log('element ids ok');

for (const t of [['lib/emulate.test.js'], ['src/lrc.test.js'], ['worker/test.mjs']]) {
  const r = spawnSync(process.execPath, t, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) fail(`${t[0]}\n${r.stdout}${r.stderr}`); else console.log(`${t[0]}: ${r.stdout.trim().split('\n').pop()}`);
}
if (failed) { console.error(`\n${failed} problem(s)`); process.exit(1); }
console.log('\nall checks passed');
