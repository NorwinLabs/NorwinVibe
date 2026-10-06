/* One little pixel guy. When music plays he climbs out from behind the record player and busts a move on every beat (disco, wave,
   robot, jump, twist, macarena: he switches style every few bars); when it stops he slips back behind it. In full screen /
   ambient mode he dances at the bottom of the screen.
   Settings > Look: "Dancing pixel guy" (on / off) and "Dancer" (Guy, Robot, Alien). */
(() => {
  const stage = document.getElementById('stage'), card = document.getElementById('card'), tilt = document.getElementById('tilt');
  if (!stage || !card) return;

  /* ---- a dancer is drawn from parts on a 9 x 9 grid: head (rows 1-3), body (4-6), legs (7-8); shoulders at (2,4) and (6,4) ---- */
  const ARM = { // pixels from the shoulder (dx, dy) for the left arm; the right arm is the mirror image
    up: [[-1, -1], [-1, -2]], upin: [[0, -1], [0, -2]], diag: [[-1, -1], [-2, -2]], out: [[-1, 0], [-2, 0]],
    down: [[0, 1], [0, 2]], flare: [[-1, 1], [-2, 2]], bent: [[-1, 0], [-1, -1]], across: [[1, 0], [2, 0]], hip: [[-1, 1], [-1, 2]],
  };
  const LEG = { // left leg pixels (absolute); right = mirrored around column 4
    stand: [[3, 7], [3, 8]], wide: [[2, 7], [1, 8]], kick: [[2, 7], [1, 7]], cross: [[4, 7], [5, 8]], squat: [[2, 7], [2, 8]], tip: [[3, 7]], step: [[3, 7], [2, 8]],
  };
  // each move is a loop of [left arm, right arm, left leg, right leg, hop]
  const MOVES = {
    disco:    [['down', 'diag', 'stand', 'stand', 0], ['flare', 'up', 'step', 'stand', 1], ['hip', 'diag', 'stand', 'stand', 0], ['flare', 'upin', 'stand', 'step', 1]],
    wave:     [['up', 'down', 'stand', 'stand', 0], ['upin', 'down', 'wide', 'wide', 1], ['down', 'up', 'stand', 'stand', 0], ['down', 'upin', 'wide', 'wide', 1]],
    robot:    [['out', 'bent', 'stand', 'stand', 0], ['bent', 'out', 'wide', 'wide', 0], ['out', 'out', 'stand', 'stand', 0], ['bent', 'bent', 'wide', 'wide', 0]],
    jump:     [['up', 'up', 'wide', 'wide', 2], ['up', 'up', 'stand', 'stand', 3], ['diag', 'diag', 'wide', 'wide', 2], ['up', 'up', 'tip', 'tip', 3]],
    twist:    [['bent', 'flare', 'kick', 'stand', 0], ['flare', 'bent', 'stand', 'kick', 1], ['out', 'hip', 'cross', 'stand', 0], ['hip', 'out', 'stand', 'cross', 1]],
    macarena: [['out', 'down', 'stand', 'stand', 0], ['out', 'out', 'stand', 'stand', 0], ['across', 'out', 'stand', 'stand', 1], ['across', 'across', 'wide', 'wide', 1], ['hip', 'hip', 'squat', 'squat', 0], ['up', 'up', 'wide', 'wide', 2]],
  };
  const STYLES = Object.keys(MOVES);
  const HEADS = {
    people: (put) => { for (let x = 3; x <= 5; x++) for (let y = 1; y <= 3; y++) put(x, y, 'h'); },
    robots: (put) => { put(4, 0, 'b'); for (let x = 3; x <= 5; x++) for (let y = 1; y <= 3; y++) put(x, y, 'h'); put(3, 2, 'e'); put(5, 2, 'e'); },
    aliens: (put) => { put(2, 0, 'b'); put(6, 0, 'b'); for (let x = 2; x <= 6; x++) for (let y = 1; y <= 3; y++) if (!(y === 3 && (x === 2 || x === 6))) put(x, y, 'h'); put(3, 2, 'e'); put(5, 2, 'e'); },
  };
  function sprite(put, pack, move, beat) {
    (HEADS[pack] || HEADS.people)(put);
    for (let y = 4; y <= 6; y++) for (let x = 3; x <= 5; x++) put(x, y, 'b');
    const m = MOVES[move][beat % MOVES[move].length];
    const arm = (name, sx, dir) => ARM[name].forEach(([dx, dy]) => put(sx + dx * dir, 4 + dy, 'b'));
    arm(m[0], 2, 1); arm(m[1], 6, -1);
    LEG[m[2]].forEach(([x, y]) => put(x, y, 'b'));
    LEG[m[3]].forEach(([x, y]) => put(8 - x, y, 'b'));
    return m[4];
  }

  const mk = (cls) => { const c = document.createElement('canvas'); c.className = cls; return c; };
  const cvStage = mk('dancers'), cvCrowd = mk('dancers crowd');
  stage.insertBefore(cvStage, tilt || stage.firstChild); // behind the record player, so they can duck behind it
  card.appendChild(cvCrowd);

  const state = { raf: 0, lastT: 0, lastPaint: 0, colors: ['#8b5cf6', '#ec4899', '#ffffff'], colorAt: -1e9, step: 0, lastBeat: 0, beats: [], avg: 0.2, tick: 0, geo: null, geoAt: -1e9 };
  const crowds = new Map();
  const crowd = (cv, n) => { let a = crowds.get(cv); if (!a || a.length !== n) { a = Array.from({ length: n }, (_, i) => ({ x: (i + 0.5) / n, delay: i * 120 + Math.random() * 80, rise: 0, ph: (i * 3) % 8, hue: i, on: false, t0: 0, style: i % STYLES.length })); crowds.set(cv, a); } return a; };

  const prefOn = () => !(typeof P !== 'undefined' && P && P.dancers === false);
  const pack = () => (typeof P !== 'undefined' && P && P.dancerpack) || 'people';
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches; // they still dance, but calmly
  const isFull = () => document.body.classList.contains('fullscreen'), isMini = () => document.body.classList.contains('mini');
  const playing = () => card.classList.contains('playing');
  const ease = (x) => 1 - Math.pow(1 - x, 3), lerp = (a, b, t) => a + (b - a) * t;

  function bassNow() { return typeof levels !== 'undefined' ? (levels[1] + levels[2] + levels[3] + levels[4]) / 4 : 0.4; }
  function beat(t) { // a jump in low-end energy moves everyone to the next step; with no beat they keep a gentle tempo
    const b = bassNow(); state.avg += (b - state.avg) * 0.03;
    if (b > state.avg * 1.3 && b > 0.28 && t - state.lastBeat > 230) {
      if (state.lastBeat) { state.beats.push(t - state.lastBeat); if (state.beats.length > 8) state.beats.shift(); }
      state.lastBeat = t; state.step++; state.tick = t;
    } else if (t - Math.max(state.lastBeat, state.tick) > (reduced() ? 520 : 340)) { state.step++; state.tick = t; }
    return b;
  }
  const bpm = () => { const a = state.beats; if (a.length < 3) return 0; return Math.round(60000 / (a.reduce((x, y) => x + y, 0) / a.length)); };

  function drawSprite(g, x0, y0, d, hopScale, reducedMotion, fast) {
    const body = state.colors[d.hue % 2], head = state.colors[2], det = state.colors[(d.hue + 1) % 2];
    const style = STYLES[(d.style + Math.floor(state.step / 24)) % STYLES.length]; // everyone changes their style every few bars
    const beatNo = state.step + d.ph; // one move per beat
    const hopBase = sprite((x, y, k) => { g.fillStyle = k === 'h' ? head : k === 'e' ? det : body; g.fillRect(x0 + x, y0 + y, 1, 1); }, pack(), style, beatNo);
    return reducedMotion ? 0 : Math.min(5, Math.round(hopBase * hopScale));
  }

  // where the record player is, in stage pixels, so dancers can slip in behind it
  function geometry(t) {
    if (state.geo && t - state.geoAt < 400) return state.geo;
    const sr = stage.getBoundingClientRect(), wrap = document.querySelector('.vinyl-wrap').getBoundingClientRect(), k = sr.width / (stage.offsetWidth || 1) || 1;
    let bottom = wrap.bottom; const pl = document.querySelector('.plinth .pf-f');
    if (pl && document.documentElement.dataset.deck === '3d') { const pr = pl.getBoundingClientRect(); if (pr.height) bottom = Math.max(bottom, pr.bottom + 4); } // the turntable's front edge, depth included
    state.geo = { w: stage.offsetWidth, h: stage.offsetHeight, cx: (wrap.left + wrap.width / 2 - sr.left) / k, cy: (wrap.top + wrap.height / 2 - sr.top) / k, floor: (bottom - sr.top) / k + 52 };
    state.geoAt = t; return state.geo;
  }

  const SC = 5, EXTRA = 70;
  function paintStage(want, t, dt, energy, rm) {
    const geo = geometry(t), w = Math.max(40, Math.round(geo.w / SC)), h = Math.round((geo.h + EXTRA) / SC);
    if (cvStage.width !== w) cvStage.width = w; if (cvStage.height !== h) cvStage.height = h;
    const g = cvStage.getContext('2d'); g.clearRect(0, 0, w, h);
    const list = crowd(cvStage, 1), fast = bpm() > 125 || energy > 0.55;
    const floor = Math.min(h - 3, geo.floor / SC), hideX = geo.cx / SC, hideY = geo.cy / SC - 4; // hidden = tucked behind the middle of the record player
    let up = false;
    for (const d of list) {
      if (want && !d.on) { d.on = true; d.t0 = t + d.delay; } else if (!want) d.on = false;
      const goal = want && t >= d.t0 ? 1 : 0;
      d.rise += (goal - d.rise) * Math.min(1, dt / (goal ? 520 : 380));
      if (d.rise < 0.012) continue;
      up = true;
      const e = ease(Math.min(1, d.rise)), target = d.x * w - 4.5;
      const dancing = e > 0.96;
      const ctx2 = g;
      // the hop is added only when they are standing on the floor
      const x0 = Math.round(lerp(hideX - 4.5, target, e)), y0b = lerp(hideY, floor - 8, e);
      let hop = 0;
      if (dancing) {
        const px = { n: 0 };
        hop = drawSprite(ctx2, x0, Math.round(y0b), d, fast ? 1.4 : 1, rm, fast);
        // redraw lifted when the move says "jump": clear and draw again higher
        if (hop && (state.step + d.ph) % 2 === 0) { g.clearRect(x0 - 1, Math.round(y0b) - 5, 11, 15); drawSprite(ctx2, x0, Math.round(y0b) - hop, d, fast ? 1.4 : 1, rm, fast); }
      } else drawSprite(ctx2, x0, Math.round(y0b), d, 1, true, false);
    }
    cvStage.style.visibility = up ? 'visible' : 'hidden';
    return up;
  }
  function paintCrowd(want, t, dt, energy, rm) {
    const sc = 8, w = Math.max(60, Math.round(window.innerWidth / sc)), h = 12;
    if (cvCrowd.width !== w) cvCrowd.width = w; if (cvCrowd.height !== h) cvCrowd.height = h;
    cvCrowd.style.height = `${h * sc}px`;
    const g = cvCrowd.getContext('2d'); g.clearRect(0, 0, w, h);
    const list = crowd(cvCrowd, 1), fast = bpm() > 125 || energy > 0.55;
    let up = false;
    for (const d of list) {
      if (want && !d.on) { d.on = true; d.t0 = t + d.delay; } else if (!want) d.on = false;
      const goal = want && t >= d.t0 ? 1 : 0;
      d.rise += (goal - d.rise) * Math.min(1, dt / (goal ? 220 : 160));
      if (d.rise < 0.01) continue;
      up = true;
      const e = ease(Math.min(1, d.rise)), x0 = Math.round(d.x * w - 4.5);
      const hop = drawSprite(g, x0, Math.round(h - 9 + (1 - e) * 14), d, fast ? 1.4 : 1, rm, fast);
      if (hop && (state.step + d.ph) % 2 === 0) { g.clearRect(x0 - 1, 0, 11, h); drawSprite(g, x0, Math.round(h - 9 + (1 - e) * 14) - Math.min(hop, 2), d, fast ? 1.4 : 1, rm, fast); }
    }
    cvCrowd.style.visibility = up ? 'visible' : 'hidden';
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
    const a = full || mini ? false : paintStage(want, t, dt, energy, rm);
    if (full || mini) cvStage.style.visibility = 'hidden';
    const b = paintCrowd(want && full, t, dt, energy, rm);
    if (!a && !b && !want) { cancelAnimationFrame(state.raf); state.raf = 0; }
  }
  const kick = () => { if (!state.raf && prefOn() && playing()) { state.lastT = performance.now(); state.lastPaint = 0; state.raf = requestAnimationFrame(draw); } };
  new MutationObserver(kick).observe(card, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('vibe:dancers', kick);
  window.addEventListener('resize', () => { state.geoAt = -1e9; });
  kick();
})();
