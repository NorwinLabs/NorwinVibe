// Turns messy web-video metadata ("Artist - Song (Official Video) [HD]" on a channel) into a clean artist + title.
(function (root) {
  const NOISE = /^(official|music|lyric|lyrics|video|audio|visuali[sz]er|hd|hq|4k|8k|mv|m\/v|explicit|clean|remaster(ed)?( \d{4})?|full (song|album|video)|with lyrics|lyrics? video|official (music )?video|official audio|official lyric video|audio only|new|free download|out now|premiere|live (performance|session)?)$/i;
  const SEP = /\s+[-–—|:]\s+/;

  const stripBrackets = (s) => s.replace(/[\(\[\{]([^\)\]\}]*)[\)\]\}]/g, (m, inner) => {
    const parts = inner.split(/[,&+\/|]|\s-\s/).map((x) => x.trim()).filter(Boolean);
    return parts.length && parts.every((p) => NOISE.test(p) || /^(official|lyrics?|video|audio|hd|hq|4k)\b/i.test(p)) ? '' : m;
  });

  const cleanChannel = (c) => (c || '').replace(/\s*-\s*topic$/i, '').replace(/\s*VEVO$/i, '').replace(/\s*official$/i, '').replace(/\s*(music|records|recordings)$/i, '').trim();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  function cleanMeta(title, channel, durSec) {
    const out = { title: (title || '').trim(), artist: (channel || '').trim(), channel: (channel || '').trim(), cleaned: false };
    if (!out.title) return out;
    let t = stripBrackets(out.title).replace(/\s*[|•]\s*(official|lyrics?|audio|video).*$/i, '').replace(/\s{2,}/g, ' ').trim();
    t = t.replace(/\s*[-–—]\s*$/, '').trim() || out.title;
    const ch = cleanChannel(channel);
    let artist = ch, song = t;

    // Long videos are mixes / streams: tidy the title, don't try to split it.
    if (!(durSec > 1200)) {
      const parts = t.split(SEP);
      if (parts.length >= 2) {
        const [a, ...rest] = parts, b = rest.join(' - ');
        if (ch && norm(b) === norm(ch)) { artist = b; song = a; }
        else { artist = a; song = b; }
      }
    }
    song = song.replace(/^["'“‘](.+)["'”’]$/, '$1').trim();
    if (song !== out.title || artist !== out.artist) out.cleaned = true;
    return { title: song || out.title, artist: artist || out.artist, channel: out.channel, cleaned: out.cleaned };
  }

  const api = { cleanMeta };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Titles = api;
})(typeof window !== 'undefined' ? window : globalThis);
