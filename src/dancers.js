/* One little pixel guy. When music plays he climbs out from behind the record player, then wanders around the screen: he walks to
   a spot, busts moves on the beat for a few bars (disco, wave, robot, jump, twist, macarena), and walks on to the next spot. When
   the music stops he walks back and slips behind the record player.
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
    walk:     [['down', 'hip', 'step', 'stand', 0], ['hip', 'down', 'stand', 'step', 0]],
    macarena: [['out', 'down', 'stand', 'stand', 0], ['out', 'out', 'stand', 'stand', 0], ['across', 'out', 'stand', 'stand', 1], ['across', 'across', 'wide', 'wide', 1], ['hip', 'hip', 'squat', 'squat', 0], ['up', 'up', 'wide', 'wide', 2]],
  };
  const STYLES = Object.keys(MOVES).filter((k) => k !== 'walk'); // the dances (walking is separate)
  const HEADS = {
    people: (put) => { for (let x = 3; x <= 5; x++) for (let y = 1; y <= 3; y++) put(x, y, 'h'); },
    robots: (put) => { put(4, 0, 'b'); for (let x = 3; x <= 5; x++) for (let y = 1; y <= 3; y++) put(x, y, 'h'); put(3, 2, 'e'); put(5, 2, 'e'); },
    aliens: (put) => { put(2, 0, 'b'); put(6, 0, 'b'); for (let x = 2; x <= 6; x++) for (let y = 1; y <= 3; y++) if (!(y === 3 && (x === 2 || x === 6))) put(x, y, 'h'); put(3, 2, 'e'); put(5, 2, 'e'); },
  };
  function sprite(put, pack, move, beat) {
    (HEADS[pack] || HEADS.people)(put);
    for (let y = 4; y <= 6; y++) for (let x = 3; x <= 5; x++) put(x, y, 'b');
    const loop = MOVES[move], m = loop[((beat % loop.length) + loop.length) % loop.length];
    const arm = (name, sx, dir) => ARM[name].forEach(([dx, dy]) => put(sx + dx * dir, 4 + dy, 'b'));
    arm(m[0], 2, 1); arm(m[1], 6, -1);
    LEG[m[2]].forEach(([x, y]) => put(x, y, 'b'));
    LEG[m[3]].forEach(([x, y]) => put(8 - x, y, 'b'));
    return m[4];
  }

  const cvBack = document.createElement('canvas'), cvFront = document.createElement('canvas');
  cvBack.className = 'dancers back'; cvFront.className = 'dancers front';
  stage.insertBefore(cvBack, tilt || stage.firstChild); // behind the record player, so he can slip behind it
  card.insertBefore(cvFront, card.querySelector('.meta') || null); // over the record, but under the title, bar and buttons

  const state = { raf: 0, lastT: 0, lastPaint: 0, colors: ['#8b5cf6', '#ec4899', '#ffffff'], colorAt: -1e9, step: 0, lastBeat: 0, beats: [], avg: 0.2, tick: 0, geo: null, geoAt: -1e9 };
  const guy = { st: 'hidden', x: 0, y: 0, tx: 0, ty: 0, dir: 1, style: 0, until: 0, vis: 0, hue: 0, walkT: 0, back: true };

  const prefOn = () => !(typeof P !== 'undefined' && P && P.dancers === false);
  const pack = () => (typeof P !== 'undefined' && P && P.dancerpack) || 'people';
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches; // he still dances, but calmly
  const isMini = () => document.body.classList.contains('mini'), isFull = () => document.body.classList.contains('fullscreen');
  const playing = () => card.classList.contains('playing');

  function bassNow() { return typeof levels !== 'undefined' ? (levels[1] + levels[2] + levels[3] + levels[4]) / 4 : 0.4; }
  function beat(t) { // a jump in low-end energy is a beat: he moves to the next step on it; with no beat he keeps a gentle tempo
    const b = bassNow(); state.avg += (b - state.avg) * 0.03;
    if (b > state.avg * 1.3 && b > 0.28 && t - state.lastBeat > 230) {
      if (state.lastBeat) { state.beats.push(t - state.lastBeat); if (state.beats.length > 8) state.beats.shift(); }
      state.lastBeat = t; state.step++; state.tick = t;
    } else if (t - Math.max(state.lastBeat, state.tick) > (reduced() ? 520 : 340)) { state.step++; state.tick = t; }
    return b;
  }
  const bpm = () => { const a = state.beats; if (a.length < 3) return 0; return Math.round(60000 / (a.reduce((x, y) => x + y, 0) / a.length)); };

  // where things are on the screen (viewport pixels): the record player he hides behind, and the card he walks around
  function geometry(t) {
    if (state.geo && t - state.geoAt < 300) return state.geo;
    const w = document.querySelector('.vinyl-wrap').getBoundingClientRect(), c = card.getBoundingClientRect();
    let l = w.left, r = w.right, tp = w.top, bt = w.bottom; const pl = document.querySelector('.plinth .pf-t');
    if (pl && document.documentElement.dataset.deck === '3d') { const pr = pl.getBoundingClientRect(); if (pr.width) { l = Math.min(l, pr.left); r = Math.max(r, pr.right); tp = Math.min(tp, pr.top); bt = Math.max(bt, pr.bottom); } }
    state.geo = { card: c, cx: w.left + w.width / 2, cy: w.top + w.height / 2, box: [l - 6, tp - 6, r + 6, bt + 6], below: bt };
    state.geoAt = t; return state.geo;
  }
  const inside = (g, x, y) => x > g.box[0] && x < g.box[2] && y > g.box[1] && y < g.box[3];

  function pickSpot(g) { // somewhere on the card, mostly the lower part, away from the very edge
    const c = g.card, mx = 34, top = c.top + Math.min(110, c.height * 0.2), pr = document.querySelector('.progress'), bot = Math.min(c.bottom - 38, (pr ? pr.getBoundingClientRect().top : c.bottom) - 6); // never onto the buttons
    const f = 0.25 + 0.75 * Math.random();
    return [c.left + mx + Math.random() * Math.max(10, c.width - 2 * mx), top + (bot - top) * f];
  }
  function go(g, x, y) { guy.tx = x; guy.ty = y; guy.st = 'walk'; }

  function update(t, dt, want) {
    const g = geometry(t), sp = (isFull() ? 70 : 46) * (reduced() ? 0.6 : 1); // walking speed, pixels per second
    if (guy.st === 'hidden') {
      if (!want) return false;
      guy.x = g.cx; guy.y = g.cy + 10; guy.vis = 1; guy.hue = (guy.hue + 1) % 2; guy.style = Math.floor(Math.random() * STYLES.length);
      const first = [g.cx + (Math.random() - 0.5) * 160, g.below + 30]; go(g, first[0], first[1]);
    }
    if (!want && guy.st !== 'retreat') { guy.st = 'retreat'; guy.tx = g.cx; guy.ty = g.cy + 10; }
    if (want && guy.st === 'retreat') { const p = pickSpot(g); go(g, p[0], p[1]); }
    if (guy.st === 'walk' || guy.st === 'retreat') {
      const dx = guy.tx - guy.x, dy = guy.ty - guy.y, d = Math.hypot(dx, dy), stepLen = sp * dt / 1000;
      if (d <= stepLen + 1) {
        guy.x = guy.tx; guy.y = guy.ty;
        if (guy.st === 'retreat') { guy.st = 'hidden'; guy.vis = 0; return false; }
        guy.st = 'dance'; guy.until = state.step + 8 + Math.floor(Math.random() * 9); guy.style = (guy.style + 1 + Math.floor(Math.random() * 3)) % STYLES.length;
      } else { guy.x += dx / d * stepLen; guy.y += dy / d * stepLen; if (Math.abs(dx) > 2) guy.dir = dx > 0 ? 1 : -1; guy.walkT += dt; }
    } else if (guy.st === 'dance' && state.step >= guy.until) {
      const p = pickSpot(g); go(g, p[0], p[1]);
    }
    guy.back = inside(g, guy.x, guy.y - 20) || guy.st === 'retreat' && inside(g, guy.x, guy.y - 20); // behind the record player while he is in front of it on screen
    return true;
  }

  function put(cv, g2, SCs, drawFn) { // a canvas the size of (a part of) the screen, one canvas pixel = SCs screen pixels
    const r = cv.getBoundingClientRect(); if (!r.width) return;
    const w = Math.max(1, Math.round(r.width / SCs)), h = Math.max(1, Math.round(r.height / SCs));
    if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h;
    const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
    if (drawFn) drawFn(g, (x) => (x - r.left) / SCs, (y) => (y - r.top) / SCs);
  }
  function draw(t) {
    state.raf = requestAnimationFrame(draw);
    if (document.hidden) return;
    const dt = Math.max(0, Math.min(100, t - state.lastT)); state.lastT = t; // (rAF can report a time just before the one kick() took)
    if (t - state.lastPaint < 30) return; // ~30 fps is plenty for chunky pixels
    state.lastPaint = t;
    const mini = isMini(), want = prefOn() && playing() && !mini;
    if (t - state.colorAt > 500) { const cs = getComputedStyle(document.documentElement); state.colors = [cs.getPropertyValue('--accent').trim() || '#8b5cf6', cs.getPropertyValue('--accent-2').trim() || '#ec4899', '#ffffff']; state.colorAt = t; }
    const energy = beat(t), rm = reduced(), SCs = isFull() ? 8 : 5;
    if (mini && guy.st !== 'hidden') { guy.st = 'hidden'; guy.vis = 0; }
    const alive = update(t, dt, want);
    const dancing = guy.st === 'dance', fast = bpm() > 125 || energy > 0.55;
    const drawGuy = (g, cx, cy) => {
      const body = state.colors[guy.hue], head = state.colors[2], det = state.colors[(guy.hue + 1) % 2];
      const style = dancing ? STYLES[guy.style] : 'walk', beatNo = dancing ? state.step : Math.floor(guy.walkT / 190);
      const x0 = Math.round(cx(guy.x) - 4.5), mirror = guy.dir < 0;
      let y0 = Math.round(cy(guy.y) - 9);
      let hop = 0;
      const pix = (x, y, k) => { g.fillStyle = k === 'h' ? head : k === 'e' ? det : body; g.fillRect(mirror ? x0 + 8 - x : x0 + x, y0 - hop + y, 1, 1); };
      // the hop of a move (computed first so the whole sprite lifts together)
      const lp = MOVES[style], m = lp[((beatNo % lp.length) + lp.length) % lp.length];
      hop = rm || !dancing ? 0 : Math.min(5, Math.round(m[4] * (fast ? 1.4 : 1)));
      sprite(pix, pack(), style, beatNo);
    };
    const front = cvFront, back = cvBack;
    if (alive && !guy.back) put(front, null, SCs, drawGuy); else put(front, null, SCs, null);
    if (alive && guy.back) put(back, null, SCs, drawGuy); else put(back, null, SCs, null);
    if (!alive && !want) { cancelAnimationFrame(state.raf); state.raf = 0; }
  }
  const kick = () => { if (!state.raf && prefOn() && playing()) { state.lastT = performance.now(); state.lastPaint = 0; state.raf = requestAnimationFrame(draw); } };
  new MutationObserver(kick).observe(card, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('vibe:dancers', kick);
  window.addEventListener('resize', () => { state.geoAt = -1e9; });
  kick();
})();
