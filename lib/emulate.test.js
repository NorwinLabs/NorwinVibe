// node lib/emulate.test.js
const assert = require('assert');
const { createEmulator } = require('./emulate.js');
const sent = []; let t = 0, pending = [];
const e = createEmulator((c) => sent.push(c), { rand: () => 0.99, now: () => (t += 5000), later: (f) => pending.push(f) });
const yt = { active: true, playing: true, canRepeat: false, canShuffle: false, dur: 200, pos: 50 };
assert.deepStrictEqual([e.state(yt).canRepeat, e.state(yt).canShuffle], [true, true]);
assert(e.cmd('repeat:Track')); assert.equal(e.state(yt).repeat, 'Track');
e.state({ ...yt, pos: 199.5 }); assert.deepStrictEqual(sent, ['seek:0'], 'repeat one seeks to the start');
assert(e.cmd('repeat:None')); assert(e.cmd('shuffle:1')); assert.equal(e.state(yt).shuffle, true);
sent.length = 0; assert(e.cmd('next')); pending.forEach((f) => f()); assert.deepStrictEqual(sent, ['next', 'next', 'next'], 'shuffled next skips 1-3');
sent.length = 0; pending = []; e.state({ ...yt, pos: 199.5 }); assert.equal(sent[0], 'next', 'shuffle also acts when a video ends');
const sp = { ...yt, canRepeat: true, canShuffle: true, repeat: 'List', shuffle: false };
const out = e.state(sp); assert.equal(out.repeatEmulated, undefined); assert(!e.cmd('repeat:Track'), 'real support is left alone');
console.log('ok');
