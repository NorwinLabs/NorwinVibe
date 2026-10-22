// node scripts/release-notes.test.js
const assert = require('assert');
const { bullets } = require('./release-notes.js');
const out = bullets([
  { subject: 'chore(mobile): bump version to 1.0.25 (build 25) [skip ci]', body: '' },
  { subject: "Merge branch 'claude/x'", body: '' },
  { subject: 'Dancers: one pixel guy busting a move on every beat (replaces the group).', body: 'details...' },
  { subject: 'Fix the thing', body: 'Notes: The visualizer is smoother now' },
  { subject: 'dancers: one pixel guy busting a move on every beat (replaces the group)', body: '' },
  { subject: 'Revert "something"', body: '' },
]);
assert.equal(out, '- Dancers: one pixel guy busting a move on every beat (replaces the group)\n- The visualizer is smoother now\n');
assert.equal(bullets([{ subject: 'chore: x', body: '' }]), '- Small fixes and improvements\n');
// a very long history must stay short enough for a Windows command line, and be cut at a whole bullet
const long = bullets(Array.from({ length: 500 }, (_, i) => ({ subject: `Feature number ${i} with a reasonably long description of what changed`, body: '' })));
assert.ok(long.length <= 3600 && long.split('\n').filter(Boolean).every((l) => l.startsWith('- Feature number')), 'capped at whole bullets');
console.log('release notes ok');
