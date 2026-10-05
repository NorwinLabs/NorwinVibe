// Repeat and shuffle for sources that do not offer them through the Windows media session (YouTube and other browser
// players expose only play / pause / next / previous / seek). The buttons stay usable and we imitate the behaviour:
//   repeat one: just before the video ends, seek back to the start
//   shuffle:    "next" jumps ahead by a random number of videos (also when a video ends on its own)
// Sources that do support repeat / shuffle (Spotify, ...) are left alone.
function createEmulator(send, { rand = Math.random, now = Date.now, later = setTimeout } = {}) {
  let repeat = 'None', shuffle = false, last = null, lastAct = 0;
  const END_WINDOW = 1.0;                       // seconds before the end that count as "ended"
  const extraSkips = () => Math.floor(rand() * 3); // 0-2 more videos on top of the one "next" always skips
  const skip = (extra) => { send('next'); for (let i = 1; i <= extra; i++) later(() => send('next'), i * 900); };

  return {
    state(m) {
      if (!m || !m.active) { last = m; return m; }
      last = m;
      const out = { ...m };
      if (!m.canRepeat) { out.canRepeat = true; out.repeat = repeat; out.repeatEmulated = true; }
      if (!m.canShuffle) { out.canShuffle = true; out.shuffle = shuffle; out.shuffleEmulated = true; }
      const ending = m.playing && m.dur > 5 && m.pos >= m.dur - END_WINDOW && now() - lastAct > 4000;
      if (ending) {
        if (!m.canRepeat && repeat === 'Track') { lastAct = now(); send('seek:0'); }
        else if (!m.canShuffle && shuffle) { lastAct = now(); skip(extraSkips()); }
      }
      return out;
    },
    // Returns true when the command was handled here (and so must not go to the media session as is).
    cmd(c) {
      if (!last || !last.active) return false;
      let m = /^repeat:(None|Track|List)$/.exec(c);
      if (m && !last.canRepeat) { repeat = m[1] === 'None' ? 'None' : 'Track'; return true; }
      m = /^shuffle:([01])$/.exec(c);
      if (m && !last.canShuffle) { shuffle = m[1] === '1'; return true; }
      if (c === 'next' && !last.canShuffle && shuffle) { lastAct = now(); skip(extraSkips()); return true; }
      return false;
    },
    get: () => ({ repeat, shuffle }),
  };
}
module.exports = { createEmulator };
