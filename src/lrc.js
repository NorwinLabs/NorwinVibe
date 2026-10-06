/* Synced-lyrics helpers shared by the desktop app, the phone app and the tests (node src/lrc.test.js). */
(function (root) {
  // LRC text -> [{ t: seconds, text }] sorted by time. Understands [mm:ss.xx], [mm:ss:xx], several stamps on one line,
  // <word> stamps (dropped) and the [offset:+ms] header (positive = the lyrics should show sooner, as the LRC format defines it).
  function parseLRC(text) {
    let offset = 0; const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const o = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw); if (o) { offset = parseInt(o[1], 10) / 1000; continue; }
      const tags = [...raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
      if (!tags.length) continue;
      const txt = raw.replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').trim();
      for (const t of tags) out.push({ t: (+t[1]) * 60 + (+t[2]) + (t[3] ? parseFloat('0.' + t[3]) : 0), text: txt });
    }
    if (offset) out.forEach((l) => { l.t = Math.max(0, l.t - offset); });
    return out.sort((a, b) => a.t - b.t);
  }
  // index of the last line whose time <= pos (-1 before the first line)
  function lineAt(lines, pos) {
    let lo = 0, hi = lines.length - 1, r = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].t <= pos) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  // Out of LRCLIB's candidates, the synced version whose length is closest to the song's. `diff` is how far off it is
  // (seconds): a big gap means a different edit of the song, so the timing may drift. Null when nothing is close enough.
  function pickBest(list, dur, maxDiff = 6) {
    let best = null;
    for (const x of Array.isArray(list) ? list : []) {
      if (!(x && (x.syncedLyrics || x.plainLyrics))) continue;
      const diff = dur > 0 && x.duration ? Math.abs(x.duration - dur) : 0;
      if (dur > 0 && x.duration && diff > maxDiff) continue;
      const score = (x.syncedLyrics ? 0 : 100) + diff;
      if (!best || score < best.score) best = { hit: x, diff, score };
    }
    return best;
  }
  const api = { parseLRC, lineAt, pickBest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LRC = api;
})(typeof window !== 'undefined' ? window : globalThis);
