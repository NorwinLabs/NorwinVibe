/* Songs inside a long video (a mix, a compilation, a live set): finds the track list the uploader put in the description ("0:00 Artist - Song")
   so the app can show the right song name and lyrics as the video moves along. Shared by the app and the tests (node src/chapters.test.js). */
(function (root) {
  const STAMP = /(?:^|[^\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/;
  const toSec = (s) => s.split(':').reduce((n, p) => n * 60 + (+p), 0);
  const fmt = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

  function cleanText(t) {
    return String(t).replace(/^[\s\-–—|:•·▶►*#]+|[\s\-–—|:•·]+$/g, '').replace(/^\d{1,3}\s*[.)]\s+/, '').replace(/^[\[(]([^\[\]()]*)[\])]$/, '$1').replace(/\s{2,}/g, ' ').trim();
  }
  // "Artist - Song" -> { artist, title };  a line with no separator is just a title
  function splitSong(text) {
    const t = cleanText(text);
    const m = /^(.{1,80}?)\s+[-–—|]\s+(.{1,120})$/.exec(t);
    if (m) return { artist: m[1].trim(), title: m[2].trim() };
    const q = /^(.{1,80}?)\s*["“'‘](.{1,120})["”'’]$/.exec(t);
    if (q) return { artist: q[1].trim(), title: q[2].trim() };
    return { artist: '', title: t };
  }
  // description text -> [{ t: seconds, title, artist }]; needs three or more increasing time stamps, the first near the start
  function parseTracklist(description, dur) {
    const out = [];
    for (const raw of String(description || '').split(/\r?\n/)) {
      const m = STAMP.exec(raw); if (!m) continue;
      const t = toSec(m[1]);
      const text = raw.replace(m[1], ' ');
      if (!cleanText(text)) continue;
      const s = splitSong(text); if (!s.title) continue;
      out.push({ t, ...s });
    }
    // keep the longest increasing sequence of times (a description can have other times in it: "recorded at 9:30")
    const len = out.map(() => 1), prev = out.map(() => -1); let end = -1;
    for (let i = 0; i < out.length; i++) {
      for (let j = 0; j < i; j++) if (out[j].t < out[i].t && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
      if (end < 0 || len[i] > len[end]) end = i;
    }
    const best = []; for (let i = end; i >= 0; i = prev[i]) best.unshift(out[i]);
    if (best.length < 3 || best[0].t > 90) return [];
    if (dur > 0 && best[best.length - 1].t > dur + 5) return [];
    return best;
  }
  // index of the song playing at `pos` seconds (-1 before the first)
  function songAt(list, pos) { let i = -1; for (let k = 0; k < list.length && list[k].t <= pos + 0.3; k++) i = k; return i; }
  const songLen = (list, i, dur) => (i < 0 ? 0 : (i + 1 < list.length ? list[i + 1].t : dur > list[i].t ? dur : list[i].t + 240) - list[i].t);

  /* ---- finding the video on YouTube ---- */
  const lengthToSec = (s) => (/^\d{1,2}(:\d{2}){1,2}$/.test(s || '') ? toSec(s) : 0);
  const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 1);
  function pickVideo(results, q) { // results: [{ id, title, channel, secs }]; the one with the same length and the most similar title
    const want = new Set(words(q.title)); let best = null, bestScore = 0.4;
    for (const r of results || []) {
      if (!r.secs || !q.dur || Math.abs(r.secs - q.dur) > Math.max(3, q.dur * 0.01)) continue;
      const w = words(r.title); if (!w.length || !want.size) continue;
      let hit = 0; for (const x of w) if (want.has(x)) hit++;
      const score = hit / Math.max(w.length, want.size) + (q.channel && r.channel && r.channel.toLowerCase() === q.channel.toLowerCase() ? 0.3 : 0);
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }
  // the JSON object after `marker` in a web page ("var ytInitialData = {...};"), read by matching braces (strings respected)
  function extractJson(html, marker) {
    const at = html.indexOf(marker); if (at < 0) return null;
    let i = html.indexOf('{', at); if (i < 0) return null;
    const start = i; let depth = 0, inStr = false, esc = false;
    for (; i < html.length; i++) {
      const c = html[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } }
    }
    return null;
  }
  function searchResults(data) { // every videoRenderer in a search page's data
    const out = [];
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (o.videoRenderer && o.videoRenderer.videoId) {
        const v = o.videoRenderer, run = (x) => (x && ((x.runs && x.runs[0] && x.runs[0].text) || x.simpleText)) || '';
        out.push({ id: v.videoId, title: run(v.title), channel: run(v.ownerText), secs: lengthToSec(run(v.lengthText)) });
      }
      for (const k in o) walk(o[k]);
    })(data);
    return out;
  }
  const api = { parseTracklist, splitSong, songAt, songLen, pickVideo, extractJson, searchResults, lengthToSec, fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Chapters = api;
})(typeof window !== 'undefined' ? window : globalThis);
