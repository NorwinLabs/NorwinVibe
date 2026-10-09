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
console.log('release notes ok');
