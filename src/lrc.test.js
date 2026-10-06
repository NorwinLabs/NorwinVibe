// node src/lrc.test.js
const assert = require('assert');
const { parseLRC, lineAt, pickBest } = require('./lrc.js');
let l = parseLRC('[ar:Someone]\n[00:12.50]Hello\n[00:05.00][01:00.25]Chorus\n[00:20:50]Colon style\n[00:30.000]<00:30.00>Word <00:30.40>stamps\nnot a lyric line');
assert.deepStrictEqual(l.map((x) => x.t), [5, 12.5, 20.5, 30, 60.25]);
assert.deepStrictEqual(l.map((x) => x.text), ['Chorus', 'Hello', 'Colon style', 'Word stamps', 'Chorus']);
assert.deepStrictEqual(parseLRC('[offset:+500]\n[00:10.00]x').map((x) => x.t), [9.5], 'offset: positive = sooner');
assert.equal(lineAt(l, 4.9), -1); assert.equal(lineAt(l, 5), 0); assert.equal(lineAt(l, 12.49), 0); assert.equal(lineAt(l, 12.5), 1); assert.equal(lineAt(l, 999), 4);
const list = [{ duration: 250, plainLyrics: 'p' }, { duration: 243.4, syncedLyrics: '[00:01.00]a' }, { duration: 244, syncedLyrics: '[00:01.00]b', id: 'best' }, { duration: 300, syncedLyrics: '[00:01.00]far' }];
assert.equal(pickBest(list, 244).hit.id, 'best'); assert.equal(pickBest(list, 244).diff, 0);
assert.equal(pickBest(list, 100), null, 'nothing close enough');
assert.equal(pickBest([{ plainLyrics: 'p', duration: 240 }, { syncedLyrics: 's', duration: 245 }], 241).hit.syncedLyrics, 's', 'synced beats plain unless far off');
console.log('lrc ok');
