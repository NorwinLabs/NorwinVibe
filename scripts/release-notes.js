// Writes the "what's new" text for a release from the commits since the previous release.
//   node scripts/release-notes.js [outFile]          (default RELEASE_NOTES.md; also prints it)
// The text is used for the GitHub release page, the Windows auto-update feed (latest.yml), the phone's update message, and the
// "What's new" panel the app shows after an update.
//
// Each commit becomes one bullet, using its subject line. To word it for users instead, put a line "Notes: ..." in the commit message.
// Commits that are bookkeeping (merges, "chore", version bumps) are left out.
const { execSync } = require('child_process');
const fs = require('fs');

const SKIP = /^(merge\b|chore\b|revert\b|ci\b|build\b|docs?\b|test\b|wip\b)/i;

function bullets(commits) { // [{ subject, body }] -> markdown bullets (newest first, no duplicates)
  const seen = new Set(), out = [];
  for (const c of commits) {
    const note = /^Notes?:\s*(.+)$/im.exec(c.body || '');
    let t = (note ? note[1] : c.subject || '').trim();
    if (!t || (!note && SKIP.test(t))) continue;
    t = t.replace(/\s*\[skip ci\]\s*/gi, '').replace(/[.\s]+$/, '');
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (!seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(`- ${t}`); }
  }
  return out.length ? out.join('\n') + '\n' : '- Small fixes and improvements\n';
}

function commitsSince() {
  const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let prev = ''; try { prev = sh("git describe --tags --match 'v*' --abbrev=0"); } catch { /* no release yet */ }
  const range = prev ? `${prev}..HEAD` : 'HEAD';
  let raw = ''; try { raw = sh(`git log --no-merges --pretty=format:%s%x1f%b%x1e ${range}`); } catch { /* shallow clone etc. */ }
  return raw.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => { const [subject, body] = r.split('\x1f'); return { subject, body }; });
}

if (require.main === module) {
  const out = process.argv[2] || 'RELEASE_NOTES.md';
  const text = bullets(commitsSince());
  fs.writeFileSync(out, text);
  process.stdout.write(text);
}
module.exports = { bullets };
