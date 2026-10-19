// node src/chapters.test.js
const assert = require('assert'), C = require('./chapters.js');
const desc = `Best chill mix 2024 🎧
Tracklist:
0:00 Daft Punk - Something About Us
3:51 M83 - Midnight City
1:02:15 Recorded at the studio

8:12 [Tame Impala] "The Less I Know"
12:40 4. Khruangbin – Time (You and I)
1:03:20 outro
Follow me on social media`;
const l = C.parseTracklist(desc, 4000);
assert.deepEqual(l.slice(0, 2).map((x) => [x.t, x.artist, x.title]), [[0, 'Daft Punk', 'Something About Us'], [231, 'M83', 'Midnight City']]);
assert.equal(l.length >= 4, true);
assert.equal(C.parseTracklist('just a description\n0:00 hello', 600).length, 0, 'fewer than three stamps: no list');
assert.equal(C.parseTracklist('5:00 a\n6:00 b\n7:00 c', 600).length, 0, 'a list that does not start near the beginning is not a track list');
assert.equal(C.parseTracklist('0:00 a\n3:00 b\n6:00 c', 120).length, 0, 'stamps past the end of the video');
assert.deepEqual(C.parseTracklist('Song One - 0:00\nSong Two - 3:10\nSong Three - 6:20', 900).map((x) => x.title), ['Song One', 'Song Two', 'Song Three'], 'time at the end of the line');
assert.deepEqual(C.splitSong('01. Artist – Title (Live)'), { artist: 'Artist', title: 'Title (Live)' });
const list = [{ t: 0 }, { t: 100 }, { t: 250 }];
assert.equal(C.songAt(list, 50), 0); assert.equal(C.songAt(list, 100), 1); assert.equal(C.songAt(list, 999), 2); assert.equal(C.songAt([{ t: 10 }], 5), -1);
assert.equal(C.songLen(list, 1, 400), 150); assert.equal(C.songLen(list, 2, 400), 150);
const res = [{ id: 'a', title: 'Chill mix 2024', channel: 'X', secs: 3601 }, { id: 'b', title: 'Chill mix 2024 (reupload)', channel: 'Y', secs: 1200 }, { id: 'c', title: 'Something else', channel: 'Z', secs: 3600 }];
assert.equal(C.pickVideo(res, { title: 'Best Chill Mix 2024', channel: 'X', dur: 3600 }).id, 'a');
assert.equal(C.pickVideo(res, { title: 'Totally different', channel: '', dur: 3600 }), null);
assert.deepEqual(C.extractJson('<script>var d = {"a":{"b":"}{"},"c":[1]};</script>', 'var d ='), { a: { b: '}{' }, c: [1] });
const data = { x: [{ videoRenderer: { videoId: 'v1', title: { runs: [{ text: 'Mix' }] }, ownerText: { runs: [{ text: 'Chan' }] }, lengthText: { simpleText: '1:00:01' } } }] };
assert.deepEqual(C.searchResults(data), [{ id: 'v1', title: 'Mix', channel: 'Chan', secs: 3601 }]);
console.log('chapters ok');
