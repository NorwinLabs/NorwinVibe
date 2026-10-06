/* Little pixel dancers. When music plays they pop up from behind the record and dance on the beat of the visualizer;
   when it stops they sink back down. Settings > Look > Dancing pixel people. */
(() => {
  const stage = document.getElementById('stage');
  if (!stage) return;
  const cv = document.createElement('canvas'); cv.className = 'dancers'; stage.appendChild(cv);
  const g = cv.getContext('2d'), SC = 3;   // each sprite pixel is 3 screen pixels (the canvas is scaled up with pixelated rendering)
  const POSES = [ // 7 wide, 8 tall: h = head, b = body
    ['b.hhh.b', 'b.hhh.b', 'bbbbbbb', '.bbbbb.', '..bbb..', '..b.b..', '.bb.bb.', '.b...b.'],   // both arms up
    ['b.hhh..', 'b.hhh..', 'bbbbb.b', '.bbbbbb', '..bbb..', '.b...b.', 'b.....b', 'b.....b'],   // left arm up, feet wide
    ['..hhh.b', '..hhh.b', 'b.bbbbb', 'bbbbbb.', '..bbb..', '.b...b.', 'b.....b', 'b.....b'],   // right arm up, feet wide
    ['..hhh..', '..hhh..', '.bbbbb.', 'b.bbb.b', 'b.bbb.b', '..b.b..', '..b.b..', '.bb.bb.'],   // arms down, shuffling
  ];
  const SEQ = [0, 1, 0, 2, 3, 1, 2, 0];
  const N = 5;
  const dancers = Array.from({ length: N }, (_, i) => ({ x: (i + 0.5) / N, delay: i * 140, rise: 0, ph: i * 3, hue: i }));
  let raf = 0, on = false, lastT = 0, colors = ['#8b5cf6', '#ec4899', '#ffffff'], colorAt = -1e9;
  const enabled = () => !(typeof P !== 'undefined' && P && P.dancers === false) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !document.body.classList.contains('mini') && !document.body.classList.contains('fullscreen');
  const playing = () => document.getElementById('card').classList.contains('playing');
  const ease = (x) => 1 - Math.pow(1 - x, 3);

  function size() {
    const w = Math.max(60, Math.round(stage.clientWidth / SC)), h = 12;
    if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h;
  }
  function draw(t) {
    raf = requestAnimationFrame(draw);
    const dt = Math.min(100, t - lastT); lastT = t;
    const want = enabled() && playing();
    let anyUp = false;
    size(); g.clearRect(0, 0, cv.width, cv.height);
    if (t - colorAt > 500) { const cs = getComputedStyle(document.documentElement); colors = [cs.getPropertyValue('--accent').trim() || '#8b5cf6', cs.getPropertyValue('--accent-2').trim() || '#ec4899', '#ffffff']; colorAt = t; }
    const e = typeof levels !== 'undefined' ? (levels[2] + levels[5] + levels[9]) / 3 : 0.4;   // the visualizer's low-end energy drives the bounce
    const step = Math.floor(t / 230);
    for (const d of dancers) {
      if (want && !d.on) { d.on = true; d.t0 = t + d.delay; } else if (!want) d.on = false;
      const goal = want && t >= d.t0 ? 1 : 0;
      d.rise += (goal - d.rise) * Math.min(1, dt / (goal ? 220 : 160));
      if (d.rise < 0.01) continue;
      anyUp = true;
      const pose = POSES[SEQ[(step + d.ph) % SEQ.length]];
      const hop = (step + d.ph) % 2 ? 0 : Math.round(1 + e * 2.5);          // jumps on every other step, higher when it is loud
      const rise = ease(Math.min(1, d.rise));
      const x0 = Math.round(d.x * cv.width - 3.5), y0 = Math.round(cv.height - 8 + (1 - rise) * 14 - hop);
      const body = colors[d.hue % 2], head = colors[2];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) {
        const ch = pose[r][c]; if (ch === '.') continue;
        g.fillStyle = ch === 'h' ? head : body; g.fillRect(x0 + c, y0 + r, 1, 1);
      }
    }
    cv.style.visibility = anyUp ? 'visible' : 'hidden';
    if (!anyUp && !want) { cancelAnimationFrame(raf); raf = 0; on = false; }   // nothing to draw: stop the loop until music plays again
  }
  const kick = () => { if (!raf && enabled() && playing()) { on = true; lastT = performance.now(); raf = requestAnimationFrame(draw); } };
  new MutationObserver(kick).observe(document.getElementById('card'), { attributes: true, attributeFilter: ['class'] });
  kick();
})();
