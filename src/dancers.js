/* Little pixel dancers. When music plays they pop up from behind the record and dance on the beat of the visualizer; when it
   stops they sink back down. In full screen / ambient mode a whole crowd lines the bottom of the screen.
   Settings > Look: "Dancing pixel people" (on / off) and "Dancers" (People, Robots, Aliens). */
(() => {
  const stage = document.getElementById('stage'), card = document.getElementById('card');
  if (!stage || !card) return;
  // 7 wide, 8 tall. h = head, b = body, e = eye / detail (drawn in the accent colour)
  const PACKS = {
    people: [
      ['b.hhh.b', 'b.hhh.b', 'bbbbbbb', '.bbbbb.', '..bbb..', '..b.b..', '.bb.bb.', '.b...b.'],   // both arms up
      ['b.hhh..', 'b.hhh..', 'bbbbb.b', '.bbbbbb', '..bbb..', '.b...b.', 'b.....b', 'b.....b'],   // left arm up, feet wide
      ['..hhh.b', '..hhh.b', 'b.bbbbb', 'bbbbbb.', '..bbb..', '.b...b.', 'b.....b', 'b.....b'],   // right arm up, feet wide
      ['..hhh..', '..hhh..', '.bbbbb.', 'b.bbb.b', 'b.bbb.b', '..b.b..', '..b.b..', '.bb.bb.'],   // arms down, shuffling
    ],
    robots: [
      ['...b...', '.hhhhh.', '.hehhe.', '.hhhhh.', 'bbbbbbb', 'b.bbb.b', '..b.b..', '.bb.bb.'],
      ['...b...', '.hhhhh.', '.hehhe.', '.hhhhh.', 'bbbbbb.', 'b.bbb.b', '.b...b.', 'bb...bb'],
      ['...b...', '.hhhhh.', '.hehhe.', '.hhhhh.', '.bbbbbb', 'b.bbb.b', '.b...b.', 'bb...bb'],
      ['...b...', '.hhhhh.', '.hehhe.', '.hhhhh.', '.bbbbb.', '.bbbbb.', '..b.b..', '..b.b..'],
    ],
    aliens: [
      ['b.....b', 'b.hhh.b', '.hehhe.', '.hhhhh.', '.bbbbb.', '..bbb..', '.b.b.b.', 'b.....b'],
      ['b..hhh.', 'b.hehh.', '..hhhh.', '..bbbb.', '.bbbbb.', '..bbb..', '.b...b.', 'b.....b'],
      ['.hhh..b', '.hhhe.b', '.hhhh..', '.bbbb..', '.bbbbb.', '..bbb..', '.b...b.', 'b.....b'],
      ['..hhh..', '.hehhe.', '.hhhhh.', 'b.bbb.b', '.bbbbb.', '..bbb..', '..b.b..', '.bb.bb.'],
    ],
  };
  const SEQ = [0, 1, 0, 2, 3, 1, 2, 0];
  const mk = (cls) => { const c = document.createElement('canvas'); c.className = cls; return c; };
  const cvStage = mk('dancers'), cvCrowd = mk('dancers crowd');
  stage.appendChild(cvStage); card.appendChild(cvCrowd);

  const state = { raf: 0, lastT: 0, colors: ['#8b5cf6', '#ec4899', '#ffffff'], colorAt: -1e9, step: 0, lastBeat: 0, beats: [], avg: 0.2, tick: 0 };
  const crowds = new Map(); // canvas -> its dancers
  const crowd = (cv, n) => { let a = crowds.get(cv); if (!a || a.length !== n) { a = Array.from({ length: n }, (_, i) => ({ x: (i + 0.5) / n, delay: i * 120 + Math.random() * 80, rise: 0, ph: (i * 3) % 8, hue: i, on: false, t0: 0 })); crowds.set(cv, a); } return a; };

  const prefOn = () => !(typeof P !== 'undefined' && P && P.dancers === false);
  const pack = () => PACKS[(typeof P !== 'undefined' && P && P.dancerpack) || 'people'] || PACKS.people;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches; // they still dance, but calmly
  const isFull = () => document.body.classList.contains('fullscreen'), isMini = () => document.body.classList.contains('mini');
  const playing = () => card.classList.contains('playing');
  const ease = (x) => 1 - Math.pow(1 - x, 3);

  function bassNow() { return typeof levels !== 'undefined' ? (levels[1] + levels[2] + levels[3] + levels[4]) / 4 : 0.4; }
  // follow the beat: a jump in low-end energy moves everyone to the next pose; with no beat they keep a gentle tempo
  function beat(t) {
    const b = bassNow(); state.avg += (b - state.avg) * 0.03;
    if (b > state.avg * 1.3 && b > 0.28 && t - state.lastBeat > 230) {
      if (state.lastBeat) { state.beats.push(t - state.lastBeat); if (state.beats.length > 8) state.beats.shift(); }
      state.lastBeat = t; state.step++; state.tick = t;
    } else if (t - Math.max(state.lastBeat, state.tick) > (reduced() ? 520 : 340)) { state.step++; state.tick = t; }
    return b;
  }
  const bpm = () => { const a = state.beats; if (a.length < 3) return 0; return Math.round(60000 / (a.reduce((x, y) => x + y, 0) / a.length)); };

  function layout(cv, full) {
    const sc = full ? 5 : 3, w = Math.max(60, Math.round((full ? window.innerWidth : stage.clientWidth) / sc)), h = 12;
    if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h;
    cv.style.height = `${h * sc}px`;
    return w;
  }
  function paint(cv, want, t, dt, n, energy, reducedMotion) {
    const g = cv.getContext('2d'), w = layout(cv, cv === cvCrowd), list = crowd(cv, n), poses = pack();
    g.clearRect(0, 0, w, cv.height);
    const fast = bpm() > 125 || energy > 0.55; // a quick or loud song: bigger jumps, wilder arms
    let up = false;
    for (const d of list) {
      if (want && !d.on) { d.on = true; d.t0 = t + d.delay; } else if (!want) d.on = false;
      const goal = want && t >= d.t0 ? 1 : 0;
      d.rise += (goal - d.rise) * Math.min(1, dt / (goal ? 220 : 160));
      if (d.rise < 0.01) continue;
      up = true;
      const idx = fast ? (state.step + d.ph) % SEQ.length : (Math.floor((state.step + d.ph) / 2)) % SEQ.length;
      const pose = poses[SEQ[idx]];
      const hop = reducedMotion ? 0 : ((state.step + d.ph) % 2 ? 0 : Math.round(1 + energy * (fast ? 4 : 2.5)));
      const rise = ease(Math.min(1, d.rise));
      const x0 = Math.round(d.x * w - 3.5), y0 = Math.round(cv.height - 8 + (1 - rise) * 14 - hop);
      const body = state.colors[d.hue % 2], head = state.colors[2];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) {
        const ch = pose[r][c]; if (ch === '.') continue;
        g.fillStyle = ch === 'h' ? head : ch === 'e' ? state.colors[(d.hue + 1) % 2] : body; g.fillRect(x0 + c, y0 + r, 1, 1);
      }
    }
    cv.style.visibility = up ? 'visible' : 'hidden';
    return up;
  }
  function draw(t) {
    state.raf = requestAnimationFrame(draw);
    if (document.hidden) return;
    const dt = Math.min(100, t - state.lastT); state.lastT = t;
    if (t - state.lastPaint < 30) return; // ~30 fps is plenty for chunky pixels
    state.lastPaint = t;
    const full = isFull(), mini = isMini(), want = prefOn() && playing() && !mini;
    if (t - state.colorAt > 500) { const cs = getComputedStyle(document.documentElement); state.colors = [cs.getPropertyValue('--accent').trim() || '#8b5cf6', cs.getPropertyValue('--accent-2').trim() || '#ec4899', '#ffffff']; state.colorAt = t; }
    const energy = beat(t), rm = reduced();
    const a = paint(cvStage, want && !full, t, dt, 5, energy, rm);
    const b = paint(cvCrowd, want && full, t, dt, Math.max(7, Math.min(21, Math.round(window.innerWidth / 110))), energy, rm);
    if (!a && !b && !want) { cancelAnimationFrame(state.raf); state.raf = 0; }
  }
  const kick = () => { if (!state.raf && prefOn() && playing()) { state.lastT = performance.now(); state.lastPaint = 0; state.raf = requestAnimationFrame(draw); } };
  new MutationObserver(kick).observe(card, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('vibe:dancers', kick);
  kick();
})();
