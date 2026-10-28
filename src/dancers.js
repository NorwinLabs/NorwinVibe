/* One little pixel guy, drawn as a jointed skeleton and animated at the screen's full frame rate (60 fps).
   When music plays he climbs out from behind the record player and wanders around the screen: he walks to a spot, busts a run of
   dance moves locked to the beat (a library of ~35: grooves, disco, robot, dab, floss, jacks, kicks, spins, flips...), and walks on
   to the next spot. Every move is a function of the beat clock, and moves are cross-faded, so nothing ever snaps. The harder the
   music hits, the bigger the moves he picks. When the music stops he walks back and slips behind the record player.
   Settings > Look: "Dancing pixel guy" (on / off) and "Dancer" (Guy, Robot, Alien, and the Pro-only Penguin). */
(() => {
  const stage = document.getElementById('stage'), card = document.getElementById('card'), tilt = document.getElementById('tilt');
  if (!stage || !card) return;

  const PI = Math.PI, TAU = PI * 2, S = Math.sin, C = Math.cos;
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const fr = (x) => x - Math.floor(x);
  const hit = (p) => Math.pow(1 - fr(p), 3); // a snap that is 1 on the beat and fades out before the next
  const wrap = (x) => ((x + PI) % TAU + TAU) % TAU - PI;
  const lerp = (a, b, k) => a + (b - a) * k;

  /* ---- a pose: every joint angle is "outwardness" from straight down (0 = hanging, PI/2 = out sideways, PI = straight up); the
     same number for the left and right limb makes a mirrored pose. Legs and arms are each (upper, lower) segments ---- */
  const BASE = { hx: 0, jump: 0, lean: 0, tilt: 0, nod: 0, turn: 1, rot: 0, hd: 0, lt: .12, ls: .08, rt: .12, rs: .08, lu: .15, ll: .25, ru: .15, rl: .25 };
  const KEYS = Object.keys(BASE);
  const mk = (o) => Object.assign({}, BASE, o);
  const dip = (d) => ({ lt: .15 + .75 * d, ls: .1 - .45 * d, rt: .15 + .75 * d, rs: .1 - .45 * d }); // knees bend out, body drops
  const arms = (lu, ll, ru, rl) => ({ lu, ll, ru, rl });
  const mirror = (o) => { // the same pose the other way round
    const r = mk(o), s = (a, b) => { const t = r[a]; r[a] = r[b]; r[b] = t; };
    s('lt', 'rt'); s('ls', 'rs'); s('lu', 'ru'); s('ll', 'rl'); r.hx = -r.hx; r.lean = -r.lean; r.tilt = -r.tilt; return r;
  };
  const mix = (a, b, k) => { const r = {}; for (let i = 0; i < KEYS.length; i++) { const n = KEYS[i]; r[n] = lerp(a[n], b[n], k); } return r; };

  /* ---- the moves: f(p, e, w) -> pose. p = beats since the move began (continuous), e = music energy 0..1, w = walk cycle.
     lo / hi: the energy range the move suits; len: beats before the next move; air: leaves the ground (skipped for reduced motion) ---- */
  const MACA = [ // 8 beats of arm positions: lu, ll, ru, rl
    [.2, .2, 1.57, 1.57], [1.57, 1.57, 1.57, 1.57], [1.57, 1.57, 1.57, -1], [1.57, -1, 1.57, -1],
    [1.57, -1, 2.2, 4.2], [2.2, 4.2, 2.2, 4.2], [2.2, 4.2, .6, -.5], [.6, -.5, .6, -.5],
  ];
  const ROBO = [[1.57, 3.14, 1.57, 1.57], [1.57, 1.57, 1.57, 3.14], [3.14, 3.14, 1.57, 1.57], [1.57, 1.57, 3.14, 3.14], [.3, 1.57, 1.57, 1.57], [1.57, 1.57, .3, 1.57]];
  const MOVES = {
    groove: { lo: 0, hi: .5, len: 8, f: (p) => { const s = S(TAU * p / 2); return mk({ hx: 1.3 * s, lean: .07 * s, tilt: -.12 * s, nod: .5 * (.5 + .5 * C(TAU * p)), ...dip(.3 * (.5 + .5 * C(TAU * p))), ...arms(.4 + .1 * s, 1, .4 - .1 * s, 1) }); } },
    lighter: { lo: 0, hi: .4, len: 8, f: (p) => { const s = S(TAU * p / 2); return mk({ hx: 1.6 * s, tilt: .14 * s, lean: .05 * s, ...dip(.15 + .15 * S(TAU * p)), ...arms(.2, .3, 2.75 + .22 * s, 2.75 + .22 * s) }); } },
    nod: { lo: 0, hi: .45, len: 8, f: (p) => { const k = .5 + .5 * C(TAU * p); return mk({ nod: 1.1 * k, lean: .05 * k, ...dip(.28 * k), ...arms(.55, 1.5, .55, 1.5) }); } },
    snap: { lo: 0, hi: .5, len: 8, f: (p) => { const s = S(PI * p); return mk({ hx: 1.8 * s, lean: -.1 * s, tilt: .1 * s, ...dip(.2 + .2 * C(TAU * p)), lt: .35 + .3 * Math.max(0, s), rt: .35 + .3 * Math.max(0, -s), ...arms(.6, 1.6, .9 + .5 * hit(p), 2.4) }); } },
    bounce: { lo: .15, hi: .75, len: 4, f: (p, e) => { const d = .5 + .5 * C(TAU * p), j = .5 - .5 * C(TAU * p); return mk({ jump: 1.6 * e * j * j, nod: .5 * d, ...dip(.6 * d), ...arms(1 + .4 * d, 2.3, 1 + .4 * d, 2.3) }); } },
    disco: { lo: .2, hi: .85, len: 8, f: (p, e) => { const k = S(PI * p); return mk({ hx: 1.3 * k, lean: .1 * k, tilt: -.1 * k, jump: .9 * e * hit(p), lt: .3 + .25 * k, rt: .3 - .25 * k, ls: .1, rs: .1, ...arms(1.55 - 1.05 * k, .5 - 1.1 * k, 1.55 + 1.05 * k, .5 + 1.1 * k) }); } },
    wave: { lo: .25, hi: .85, len: 8, f: (p) => { const a = TAU * p / 2; return mk({ hx: 1.5 * S(a), tilt: .1 * S(a), ...dip(.3 + .2 * S(TAU * p)), ...arms(2.2 + .5 * S(a), 2.4 + .5 * S(a - 1), 2.2 + .5 * S(a + PI), 2.4 + .5 * S(a + PI - 1)) }); } },
    robot: { lo: .15, hi: .75, len: 8, f: (p) => { const i = Math.floor(p * 2), a = ROBO[((i % 6) + 6) % 6], b = ROBO[(((i - 1) % 6) + 6) % 6], k = smooth(fr(p * 2) * 5);
      return mk({ tilt: .0, hx: (i % 2 ? -1 : 1) * k * .8, ...dip(.15 + .25 * (i % 2)), lu: lerp(b[0], a[0], k), ll: lerp(b[1], a[1], k), ru: lerp(b[2], a[2], k), rl: lerp(b[3], a[3], k) }); } },
    jump: { lo: .5, hi: 1, len: 4, air: 1, f: (p, e) => { const f = fr(p), air = S(PI * f); return mk({ jump: (4 + 5 * e) * air, ...dip(.55 * Math.pow(1 - air, 2)), lt: .15 + .5 * air, rt: .15 + .5 * air, ls: .1 + .6 * air, rs: .1 + .6 * air, ...arms(1 + 1.7 * air, 1 + 1.9 * air, 1 + 1.7 * air, 1 + 1.9 * air) }); } },
    twist: { lo: .3, hi: .9, len: 8, f: (p) => { const s = S(TAU * p); return mk({ hx: 2.2 * s, lean: -.26 * s, ...dip(.35 + .2 * C(TAU * p * 2)), ...arms(.9 - .5 * s, 2 - .5 * s, .9 + .5 * s, 2 + .5 * s) }); } },
    macarena: { lo: .2, hi: .9, len: 8, f: (p) => { const q = Math.max(0, p), i = Math.floor(q) % 8, j = (i + 7) % 8, k = smooth(fr(q) * 5), a = MACA[i], b = MACA[j], h = S(TAU * q);
      return mk({ hx: 1.2 * h, lean: .05 * h, ...dip(.3 + .25 * (i > 5 ? C(TAU * q) : 0)), jump: i === 7 ? .8 * hit(q) : 0, lu: lerp(b[0], a[0], k), ll: lerp(b[1], a[1], k), ru: lerp(b[2], a[2], k), rl: lerp(b[3], a[3], k) }); } },
    run: { lo: .5, hi: 1, len: 8, air: 1, f: (p, e) => { const s = S(PI * p), up = Math.max(0, s), dn = Math.max(0, -s);
      return mk({ jump: 1.4 * e * Math.abs(S(PI * p)), lean: .1, lt: .15 + .55 * up, ls: .1 - .7 * up, rt: .15 + .55 * dn, rs: .1 - .7 * dn, ...arms(1 + .8 * dn, 2.5 * (.4 + .6 * dn), 1 + .8 * up, 2.5 * (.4 + .6 * up)) }); } },
    dab: { lo: .4, hi: .95, len: 4, f: (p) => { const q = Math.max(0, p), f = fr(q), a = smooth(f * 6) * (1 - smooth((f - .78) * 5)), side = Math.floor(q) % 2 ? -1 : 1;
      const o = { nod: 1.3 * a, tilt: .5 * a, lean: .08 * a, ...dip(.25 * a), lu: lerp(.15, 1.1, a), ll: lerp(.25, 3.5, a), ru: lerp(.15, 2.75, a), rl: lerp(.25, 2.75, a), jump: .6 * hit(q) };
      return side > 0 ? mk(o) : mirror(o); } },
    floss: { lo: .4, hi: .95, len: 8, f: (p) => { const s = S(TAU * p / 2); return mk({ hx: -1.7 * s, lean: .12 * s, ...dip(.35 + .3 * C(TAU * p)), ...arms(.5 + .85 * s, .6 + .85 * s, .5 - .85 * s, .6 - .85 * s) }); } },
    sprinkler: { lo: .3, hi: .85, len: 8, f: (p) => { const i = Math.floor(p * 2), k = smooth(fr(p * 2) * 4), step = (n) => 1.2 + .22 * (n % 5);
      return mk({ lean: .06, tilt: -.1, hx: .8 * S(PI * p), ...dip(.25 + .15 * C(TAU * p)), lu: 2.2, ll: 4, ru: lerp(step(i - 1), step(i), k), rl: lerp(step(i - 1), step(i), k) + .08 * S(TAU * p * 2) }); } },
    cheer: { lo: .5, hi: 1, len: 4, air: 1, f: (p, e) => { const k = S(PI * p), u = Math.max(0, k), v = Math.max(0, -k);
      return mk({ jump: 1.5 * e * hit(p), tilt: .08 * k, ...dip(.2 + .2 * (1 - hit(p))), lu: 1.1 + 1.5 * u, ll: 2.2 + .5 * u, ru: 1.1 + 1.5 * v, rl: 2.2 + .5 * v }); } },
    clap: { lo: .35, hi: .9, len: 8, f: (p, e) => mk({ jump: 1.2 * e * hit(p), ...dip(.3 * (1 - hit(p))), ...arms(3 - .25 * hit(p), 3.5 + .45 * hit(p), 3 - .25 * hit(p), 3.5 + .45 * hit(p)) }) },
    headbang: { lo: .7, hi: 1, len: 8, f: (p) => { const k = hit(p); return mk({ nod: 2.1 * k, lean: .14 * k, ...dip(.55 + .15 * k), ...arms(.9, 2.5, .9, 2.5) }); } },
    moonwalk: { lo: .1, hi: .6, len: 8, f: (p) => { const a = S(TAU * p / 2), u = Math.max(0, a), v = Math.max(0, -a);
      return mk({ hx: .5 * S(TAU * p / 4), lean: -.1, nod: .3, lt: .1 + .4 * u, ls: .1 - .5 * u, rt: .1 + .4 * v, rs: .1 - .5 * v, ...arms(.9, 2.7, .3 + .4 * a, .5 + .3 * a) }); } },
    shuffle: { lo: .55, hi: 1, len: 8, f: (p, e) => { const a = S(PI * p * 2), u = Math.max(0, a), v = Math.max(0, -a);
      return mk({ hx: 2 * S(TAU * p), jump: .9 * e * Math.abs(a), lt: .2 + .5 * u, rt: .2 + .5 * v, ls: .1 + .1 * u, rs: .1 + .1 * v, ...arms(1.1 + .9 * u, 2.2, 1.1 + .9 * v, 2.2) }); } },
    spin: { lo: .45, hi: 1, len: 2, air: 1, f: (p, e) => { const u = clamp(p / 2); return mk({ turn: p >= 2 ? 1 : C(TAU * smooth(u)), jump: (2 + 3 * e) * S(PI * u), ...arms(1.45, 1.45, 1.45, 1.45), lt: .2 + .2 * S(PI * u), rt: .2 + .2 * S(PI * u) }); } },
    flip: { lo: .7, hi: 1, len: 2, air: 1, f: (p, e) => { const u = clamp(p / 2), air = S(PI * u), tuck = smooth(air * 1.6);
      return mk({ rot: p >= 2 ? 0 : -TAU * smooth(u), jump: (7 + 5 * e) * air, ...dip(.7 * Math.max(0, 1 - u * 7) + .6 * Math.max(0, (u - .86) * 7)), lt: lerp(.15, 1.15, tuck), rt: lerp(.15, 1.15, tuck), ls: lerp(.1, 2.2, tuck), rs: lerp(.1, 2.2, tuck), ...arms(lerp(.15, .8, tuck), lerp(.25, 2.4, tuck), lerp(.15, .8, tuck), lerp(.25, 2.4, tuck)) }); } },
    swim: { lo: .3, hi: .85, len: 8, f: (p) => { const a = TAU * p / 2; return mk({ hx: 1.2 * S(a), lean: .06 * S(a), ...dip(.3 + .25 * S(TAU * p)), lu: wrap(a), ll: wrap(a - .35), ru: wrap(a + PI), rl: wrap(a + PI - .35) }); } },
    hula: { lo: 0, hi: .65, len: 8, f: (p) => { const s = S(TAU * p / 2); return mk({ hx: 2.3 * s, lean: -.22 * s, tilt: .12 * s, ...dip(.25 + .1 * S(TAU * p)), ...arms(2.3 + .4 * S(TAU * p / 2 + 1), 2.5 + .3 * S(TAU * p / 2 + 1.4), 2.3 + .4 * S(TAU * p / 2 + 1 + PI), 2.5 + .3 * S(TAU * p / 2 + 1.4 + PI)) }); } },
    stomp: { lo: .4, hi: .95, len: 4, f: (p) => { const q = Math.max(0, p), f = fr(q), lift = Math.max(0, S(PI * f)), side = Math.floor(q) % 2 ? -1 : 1;
      const o = { hx: 1.2 * lift, ...arms(.4 + .5 * hit(q), .9, .4 + .5 * hit(q), .9), lt: .2 + .7 * lift, ls: .1 - .7 * lift, rt: .15, rs: .1 };
      return side > 0 ? mk(o) : mirror(o); } },
    kick: { lo: .55, hi: 1, len: 4, air: 1, f: (p, e) => { const q = Math.max(0, p), f = fr(q), k = Math.pow(S(PI * f), 2), side = Math.floor(q) % 2 ? -1 : 1;
      const o = { lt: .15 + 1.25 * k, ls: .1 + 1.3 * k, rt: .2, rs: .1, jump: .9 * e * k, lean: -.1 * k, ...arms(1.3, 1.3, 1.3, 1.3) }; return side > 0 ? mk(o) : mirror(o); } },
    jacks: { lo: .45, hi: 1, len: 8, air: 1, f: (p, e) => { const o = .5 - .5 * C(PI * p), s = smooth(o);
      return mk({ jump: 2.6 * e * Math.abs(S(PI * p)), lt: .1 + .5 * s, rt: .1 + .5 * s, ls: .08 + .5 * s, rs: .08 + .5 * s, ...arms(.2 + 2.75 * s, .2 + 2.75 * s, .2 + 2.75 * s, .2 + 2.75 * s) }); } },
    flex: { lo: .3, hi: .85, len: 8, f: (p) => { const k = hit(p * 2); return mk({ lean: .03, nod: .4 * k, tilt: .08 * S(PI * p), ...dip(.6 + .1 * k), ...arms(1.57, 2.8 + .5 * k, 1.57, 2.8 + .5 * k) }); } },
    guitar: { lo: .5, hi: 1, len: 8, f: (p, e) => { const q = p % 4, w = q > 3, a = TAU * fr(q);
      return mk({ lean: -.2, tilt: .15 * S(TAU * p / 2), jump: .8 * e * hit(p), ...dip(.6 + .1 * hit(p)), lu: 1.35, ll: 1.45, ru: w ? wrap(a) : .45, rl: w ? wrap(a - .2) : .55 + .9 * S(TAU * p * 2) }); } },
    roll: { lo: .2, hi: .7, len: 8, f: (p) => mk({ ...dip(.3 + .25 * S(TAU * p)), hx: S(TAU * p / 2), ...arms(.7, wrap(TAU * p), .7, wrap(TAU * p)) }) },
    chicken: { lo: .25, hi: .8, len: 8, f: (p) => { const s = S(TAU * p * 2); return mk({ nod: .6 * (.5 + .5 * s), hx: .8 * S(TAU * p / 2), ...dip(.3 + .3 * s), ...arms(1.5, 2.3 + .7 * s, 1.5, 2.3 - .7 * s) }); } },
    steptouch: { lo: .2, hi: .65, len: 8, f: (p) => { const s = S(PI * p), u = Math.max(0, s), v = Math.max(0, -s);
      return mk({ hx: 2.6 * s, lean: -.1 * s, lt: .15 + .6 * u, rt: .15 + .6 * v, ls: .1, rs: .1, ...dip(.15 + .15 * (1 - Math.abs(s))), ...arms(.5, 1.3, 1 + .4 * C(TAU * p), 1.6) }); } },
    freeze: { lo: .5, hi: 1, len: 4, f: (p) => { const k = hit(Math.max(0, p) * 4) * .5;
      return mk({ tilt: .3, lean: .15, hx: .6, nod: .3, jump: 0, lt: 1.0, ls: 1.0, rt: .3, rs: .1, ...arms(.7, -.4, 2.75 + .05 * k, 2.75) }); } },
    cancan: { lo: .55, hi: 1, len: 8, air: 1, f: (p, e) => { const f = fr(p * 2), k = S(PI * f), side = Math.floor(p * 2) % 2 ? -1 : 1;
      const o = { lt: .1 + .9 * k, ls: .1 + 1.1 * k, rt: .12, rs: .1, hx: .5 * k, jump: 1.2 * e * k, ...arms(.4, 1.9, 1.4, .5) }; return side > 0 ? mk(o) : mirror(o); } },
    boxing: { lo: .5, hi: .95, len: 8, f: (p) => { const s = S(PI * p * 2), u = Math.max(0, s), v = Math.max(0, -s);
      return mk({ hx: 1.2 * S(TAU * p), lean: .1 * (u - v), ...dip(.5 + .15 * Math.abs(s)), lu: 1.0 + .6 * u, ll: 2.1 - 1.2 * u, ru: 1.0 + .6 * v, rl: 2.1 - 1.2 * v }); } },
    shimmy: { lo: .15, hi: .6, len: 8, f: (p) => { const s = S(TAU * p * 2); return mk({ hx: 1.4 * s, tilt: .1 * s, lean: -.1 * s, ...dip(.3), ...arms(.8, 2.2 + .3 * s, .8, 2.2 - .3 * s) }); } },
  };
  // walking (in profile, facing the way he's going): w = walk cycle
  MOVES.walk = { lo: 9, hi: 9, len: 99, f: (p, e, w) => { const s = S(TAU * w), c = C(TAU * w);
    return mk({ turn: guy.dir, hd: .8, lean: .1, nod: -.1, lt: -.55 * s, ls: -.55 * s + .7 * Math.max(0, c), rt: -.55 * s, rs: -.55 * s - .7 * Math.max(0, -c), lu: .45 * s, ll: .45 * s - .5, ru: .45 * s, rl: .45 * s + .5 }); } };
  const NAMES = Object.keys(MOVES).filter((k) => k !== 'walk');

  /* ---- the figure: forward kinematics from the pelvis, drawn with round strokes on a small canvas ---- */
  const LEN = { th: 3.3, sh: 3.3, to: 4.6, ua: 2.7, fa: 2.7 };
  const W = 44, H = 44, GX = 22, GY = 36; // canvas size and where his feet are (art pixels)
  const HEADS = {
    people: (g, x, y, a, c) => { g.fillStyle = c.head; g.beginPath(); g.arc(x, y, 2.4, 0, TAU); g.fill(); },
    robots: (g, x, y, a, c) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = c.head; g.fillRect(-2.3, -2.3, 4.6, 4.6); g.strokeStyle = c.head; g.lineWidth = .8; g.beginPath(); g.moveTo(0, -2.3); g.lineTo(0, -3.9); g.stroke(); g.fillStyle = c.body; g.beginPath(); g.arc(0, -4.1, .8, 0, TAU); g.fill(); g.restore(); },
    aliens: (g, x, y, a, c) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = c.head; g.beginPath(); g.ellipse(0, .2, 3, 2.5, 0, 0, TAU); g.fill(); g.strokeStyle = c.head; g.lineWidth = .7;
      g.beginPath(); g.moveTo(-1.6, -2); g.lineTo(-2.7, -3.9); g.moveTo(1.6, -2); g.lineTo(2.7, -3.9); g.stroke(); g.fillStyle = c.body; g.beginPath(); g.arc(-2.7, -4, .8, 0, TAU); g.arc(2.7, -4, .8, 0, TAU); g.fill(); g.restore(); },
  };
  /* ---- the Pro penguin: the Club Penguin dance GIF, played frame by frame (a sprite sheet of 104 small frames) while he dances;
     when he walks to another spot he waddles (the standing frame rocks side to side with a hop on each step) ---- */
  const PENG = new Image(); PENG.src = 'data:image/png;base64,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';
  const PW = 29, PH = 28, PFEET = 20; // one frame, in art pixels, and the row his feet are on
  const PDUR = [200, 160, 120, 160, 120, 40, 40, 40, 120, 160, 120, 160, 120, 40, 40, 40, 160, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 120, 160, 120, 160, 160, 40, 40, 40, 40, 80, 40, 40, 80, 120, 160, 120, 160, 120, 40, 40, 40, 40, 40, 80, 40, 40, 80, 120, 160, 120, 160, 120, 40, 40, 40, 160, 40, 40, 80, 120, 160, 120, 160, 120, 40, 40, 40, 160, 40, 40, 80]; // how long each frame shows, in ms
  const PTOTAL = PDUR.reduce((n, d) => n + d, 0);
  let pengT0 = -1; // when this round of dancing began (the animation starts from its first frame every time)
  function penguin(g, P, x) {
    if (!PENG.complete || !PENG.naturalWidth) return;
    const rm = reduced() ? .5 : 1; let fi = 0, hop = 0, rot = 0, hx = 0, sq = 1;
    if (x.walk) { // the waddle: one rock per 9 art pixels walked, a hop on each step
      pengT0 = -1; const c = x.w * TAU; rot = S(c) * .2 * rm; hx = S(c) * .7 * rm; hop = Math.abs(S(c)) * 1.3 * rm; sq = 1 - (1 - Math.abs(S(c))) * .05;
    } else { // the dance: the GIF, looping
      if (pengT0 < 0) pengT0 = x.t;
      let t = ((x.t - pengT0) * rm) % PTOTAL; while (fi < PDUR.length - 1 && t >= PDUR[fi]) { t -= PDUR[fi]; fi++; }
    }
    const air = clamp(hop / 8), bx = GX + hx, fy = GY - hop;
    g.fillStyle = 'rgba(0,0,0,' + (.32 * (1 - air * .6)) + ')'; g.beginPath(); g.ellipse(GX + hx, GY + .8, 5 * (1 - air * .35), 1.2, 0, 0, TAU); g.fill();
    g.save(); g.translate(bx, fy); g.rotate(rot); g.scale(1 + (1 - sq) * .6, sq);
    g.drawImage(PENG, fi * PW, 0, PW, PH, -14, -PFEET, PW, PH); g.restore();
  }
  function figure(g, P, c, pack, x) {
    if (pack === 'penguin') return penguin(g, P, x);
    const th = LEN.th, sh = LEN.sh, to = LEN.to, ua = LEN.ua, fa = LEN.fa;
    // local joints (x right, y down, pelvis at 0,0)
    const kL = [-.9 - S(P.lt) * th, C(P.lt) * th], fL = [kL[0] - S(P.ls) * sh, kL[1] + C(P.ls) * sh];
    const kR = [.9 + S(P.rt) * th, C(P.rt) * th], fR = [kR[0] + S(P.rs) * sh, kR[1] + C(P.rs) * sh];
    const reach = Math.max(fL[1], fR[1]);
    const ls = S(P.lean), lc = C(P.lean), neck = [ls * to, -lc * to];
    const shL = [neck[0] - lc * 1.7, neck[1] - ls * 1.7], shR = [neck[0] + lc * 1.7, neck[1] + ls * 1.7];
    const eL = [shL[0] - S(P.lu) * ua, shL[1] + C(P.lu) * ua], hL = [eL[0] - S(P.ll) * fa, eL[1] + C(P.ll) * fa];
    const eR = [shR[0] + S(P.ru) * ua, shR[1] + C(P.ru) * ua], hR = [eR[0] + S(P.rl) * fa, eR[1] + C(P.rl) * fa];
    const ha = P.lean + P.tilt, hd = 3 - P.nod, head = [neck[0] + S(ha) * hd + P.hd, neck[1] - C(ha) * hd];
    const ex = (dx) => [head[0] + C(ha) * dx + P.hd * .8, head[1] - S(ha) * dx - .2];
    // to the canvas: squash by the turn (so he can spin / face the way he walks), rotate for flips, then place
    const bx = GX + P.hx, by = GY - reach - P.jump, ca = C(P.rot), sa = S(P.rot), pv = -3;
    const T = (p) => { const x = p[0] * P.turn, y = p[1] - pv; return [bx + x * ca - y * sa, by + pv + x * sa + y * ca]; };
    // shadow
    const air = clamp(P.jump / 12);
    g.fillStyle = 'rgba(0,0,0,' + (.32 * (1 - air * .6)) + ')'; g.beginPath(); g.ellipse(bx, GY + .8, 5.2 * (1 - air * .35) * Math.max(.45, Math.abs(P.turn)), 1.3, 0, 0, TAU); g.fill();
    g.lineCap = 'round'; g.lineJoin = 'round';
    const line = (pts, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach((p, i) => { const q = T(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); };
    line([[-.9, 0], kL, fL], 1.9, c.det); line([[.9, 0], kR, fR], 1.9, c.det);          // legs
    const q1 = T(fL), q2 = T(fR); g.fillStyle = c.head; g.beginPath(); g.arc(q1[0], q1[1], 1.05, 0, TAU); g.arc(q2[0], q2[1], 1.05, 0, TAU); g.fill(); // shoes
    line([[0, .3], neck], 3.4, c.body); line([shL, shR], 2.2, c.body);                  // torso and shoulders
    line([shL, eL, hL], 1.7, c.body); line([shR, eR, hR], 1.7, c.body);                 // arms
    const h1 = T(hL), h2 = T(hR); g.fillStyle = c.head; g.beginPath(); g.arc(h1[0], h1[1], .95, 0, TAU); g.arc(h2[0], h2[1], .95, 0, TAU); g.fill(); // hands
    const hp = T(head); (HEADS[pack] || HEADS.people)(g, hp[0], hp[1], (P.rot + (P.turn < 0 ? -ha : ha)), c);
    const e1 = T(ex(-.95)), e2 = T(ex(.95)); g.fillStyle = c.eye; g.beginPath(); g.arc(e1[0], e1[1], .5, 0, TAU); g.arc(e2[0], e2[1], .5, 0, TAU); g.fill(); // eyes
  }

  const cvBack = document.createElement('canvas'), cvFront = document.createElement('canvas');
  for (const cv of [cvBack, cvFront]) { cv.width = W; cv.height = H; cv.style.display = 'none'; }
  cvBack.className = 'guy back'; cvFront.className = 'guy front';
  stage.insertBefore(cvBack, tilt || stage.firstChild); // behind the record player, so he can slip behind it
  card.insertBefore(cvFront, card.querySelector('.meta') || null); // over the record, but under the title, bar and buttons

  const state = { raf: 0, lastT: 0, colors: ['#8b5cf6', '#ec4899', '#ffffff'], colorAt: -1e9, ph: 0, period: 480, lastBeat: 0, beats: [], avg: .2, e: .3, geo: null, geoAt: -1e9, sc: 0 };
  const guy = { st: 'hidden', x: 0, y: 0, tx: 0, ty: 0, dir: 1, until: 0, hue: 0, w: 0, back: true, tv: 1, mvEnd: 0, recent: [] };
  const mover = { a: 'walk', aStart: 0, b: 'walk', bStart: 0, k: 1 };

  const prefOn = () => !(typeof P !== 'undefined' && P && P.dancers === false);
  const pack = () => (typeof P !== 'undefined' && P && P.dancerpack) || 'people';
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches; // he still dances, but calmly
  const isMini = () => document.body.classList.contains('mini'), isFull = () => document.body.classList.contains('fullscreen');
  const playing = () => card.classList.contains('playing');
  const scale = () => (isFull() ? 6 : 4); // screen pixels per art pixel

  /* ---- the beat clock: a continuous count of beats that keeps going between detected beats and is gently nudged onto them ---- */
  function bassNow() { return typeof levels !== 'undefined' ? (levels[1] + levels[2] + levels[3] + levels[4]) / 4 : 0.4; }
  function clock(t, dt) {
    const b = bassNow(), rm = reduced(); state.avg += (b - state.avg) * 0.03;
    if (b > state.avg * 1.3 && b > 0.28 && t - state.lastBeat > 230) {
      if (state.lastBeat && t - state.lastBeat < 1000) { state.beats.push(t - state.lastBeat); if (state.beats.length > 10) state.beats.shift(); }
      state.lastBeat = t;
      if (state.beats.length >= 4) { // fold the gaps into a sensible tempo (about 80 to 180 bpm) and ease toward it
        const fold = state.beats.map((v) => { while (v < 330) v *= 2; while (v > 750) v /= 2; return v; }).sort((x, y) => x - y), med = fold[fold.length >> 1];
        state.period += (med - state.period) * 0.15;
      }
      const err = Math.round(state.ph) - state.ph; if (Math.abs(err) < 0.38) state.ph += err * 0.14; // lock the feet onto the beat
    }
    state.ph += dt / (state.period * (rm ? 1.4 : 1));
    const target = clamp((state.avg - 0.1) * 2.2 + (b > state.avg * 1.3 ? .08 : 0)) * (rm ? .55 : 1);
    state.e += (target - state.e) * (1 - Math.exp(-dt / 900));
    return b;
  }

  // where things are on the screen (viewport pixels): the record player he hides behind, and the card he walks around
  function geometry(t) {
    if (state.geo && t - state.geoAt < 300) return state.geo;
    const w = document.querySelector('.vinyl-wrap').getBoundingClientRect(), c = card.getBoundingClientRect(), s = stage.getBoundingClientRect();
    let l = w.left, r = w.right, tp = w.top, bt = w.bottom; const pl = document.querySelector('.plinth .pf-t');
    if (pl && document.documentElement.dataset.deck === '3d') { const pr = pl.getBoundingClientRect(); if (pr.width) { l = Math.min(l, pr.left); r = Math.max(r, pr.right); tp = Math.min(tp, pr.top); bt = Math.max(bt, pr.bottom); } }
    state.geo = { card: c, stage: s, cx: w.left + w.width / 2, cy: w.top + w.height / 2, box: [l - 6, tp - 6, r + 6, bt + 6], below: bt };
    state.geoAt = t; return state.geo;
  }
  const inside = (g, x, y) => x > g.box[0] && x < g.box[2] && y > g.box[1] && y < g.box[3];

  function pickSpot(g) { // somewhere on the card, mostly the lower part, away from the very edge
    const c = g.card, mx = 34, top = c.top + Math.min(110, c.height * 0.2), pr = document.querySelector('.progress'), bot = Math.min(c.bottom - 38, (pr ? pr.getBoundingClientRect().top : c.bottom) - 6); // never onto the buttons
    const f = 0.25 + 0.75 * Math.random();
    return [c.left + mx + Math.random() * Math.max(10, c.width - 2 * mx), top + (bot - top) * f];
  }

  /* ---- choosing moves ---- */
  function setMove(name, instant) {
    mover.a = mover.b; mover.aStart = mover.bStart; mover.b = name; mover.bStart = Math.round(state.ph); mover.k = instant ? 1 : 0;
    if (instant) { mover.a = name; mover.aStart = mover.bStart; }
  }
  function nextMove() {
    const e = state.e, rm = reduced();
    let pool = NAMES.filter((n) => { const m = MOVES[n]; return e >= m.lo && e <= m.hi && !(rm && m.air) && guy.recent.indexOf(n) < 0; });
    if (!pool.length) pool = NAMES.filter((n) => !(rm && MOVES[n].air) && guy.recent.indexOf(n) < 0);
    const n = pool[Math.floor(Math.random() * pool.length)]; guy.recent.push(n); if (guy.recent.length > 6) guy.recent.shift();
    setMove(n); guy.mvEnd = mover.bStart + MOVES[n].len;
  }
  function go(x, y) { guy.tx = x; guy.ty = y; guy.st = 'walk'; if (mover.b !== 'walk') setMove('walk'); }

  function update(t, dt, want) {
    const g = geometry(t), sc = scale(), sp = (isFull() ? 88 : 58) * (reduced() ? 0.6 : 1); // walking speed, pixels per second
    if (guy.st === 'hidden') {
      if (!want) return false;
      guy.x = g.cx; guy.y = g.cy + 10; guy.hue = (guy.hue + 1) % 2; guy.w = 0; setMove('walk', true); guy.tv = guy.dir;
      go(g.cx + (Math.random() - 0.5) * 160, g.below + 30);
    }
    if (!want && guy.st !== 'retreat') { guy.st = 'retreat'; guy.tx = g.cx; guy.ty = g.cy + 10; if (mover.b !== 'walk') setMove('walk'); }
    if (want && guy.st === 'retreat') { const p = pickSpot(g); go(p[0], p[1]); }
    if (guy.st === 'walk' || guy.st === 'retreat') {
      const dx = guy.tx - guy.x, dy = guy.ty - guy.y, d = Math.hypot(dx, dy), stepLen = sp * dt / 1000;
      if (d <= stepLen + 1) {
        guy.x = guy.tx; guy.y = guy.ty;
        if (guy.st === 'retreat') { guy.st = 'hidden'; return false; }
        guy.st = 'dance'; guy.until = state.ph + 16 + Math.floor(Math.random() * 17); nextMove();
      } else { guy.x += dx / d * stepLen; guy.y += dy / d * stepLen; if (Math.abs(dx) > 2) guy.dir = dx > 0 ? 1 : -1; guy.w += stepLen / (9 * sc); }
    } else if (guy.st === 'dance') {
      if (state.ph >= guy.until) { const p = pickSpot(g); go(p[0], p[1]); }
      else if (state.ph >= guy.mvEnd) nextMove();
    }
    guy.back = inside(g, guy.x, guy.y - 20);
    return true;
  }

  function pose(dt) {
    const e = state.e, ph = state.ph, m = mover;
    m.k = Math.min(1, m.k + dt / (MOVES[m.b].len <= 2 ? 160 : 320));
    const run = (n, s) => MOVES[n].f(ph - s, e, guy.w);
    let P = run(m.b, m.bStart);
    if (m.k < 1) P = mix(run(m.a, m.aStart), P, smooth(m.k));
    guy.tv += (P.turn - guy.tv) * (1 - Math.exp(-dt / 50)); P.turn = guy.tv; // turning round takes a moment
    if (reduced()) { P.jump = 0; P.rot = 0; }
    return P;
  }

  function place(cv, parentRect, sc) {
    if (cv._sc !== sc) { cv._sc = sc; cv.style.width = W * sc + 'px'; cv.style.height = H * sc + 'px'; }
    cv.style.transform = 'translate3d(' + (guy.x - parentRect.left - GX * sc).toFixed(2) + 'px,' + (guy.y - parentRect.top - GY * sc).toFixed(2) + 'px,0)';
  }
  function frame(t) {
    state.raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.max(0, Math.min(100, t - state.lastT)); state.lastT = t; // (rAF can report a time just before the one kick() took)
    const mini = isMini(), want = prefOn() && playing() && !mini;
    if (t - state.colorAt > 500) { const cs = getComputedStyle(document.documentElement); state.colors = [cs.getPropertyValue('--accent').trim() || '#8b5cf6', cs.getPropertyValue('--accent-2').trim() || '#ec4899', '#ffffff']; state.colorAt = t; }
    clock(t, dt);
    if (mini && guy.st !== 'hidden') guy.st = 'hidden';
    const alive = update(t, dt, want);
    if (!alive) { cvBack.style.display = cvFront.style.display = 'none'; if (!want) { cancelAnimationFrame(state.raf); state.raf = 0; } return; }
    const P = pose(dt), sc = scale(), g = state.geo, cv = guy.back ? cvBack : cvFront, other = guy.back ? cvFront : cvBack;
    other.style.display = 'none'; cv.style.display = '';
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, W, H);
    figure(ctx, P, { body: state.colors[guy.hue], det: state.colors[(guy.hue + 1) % 2], head: state.colors[2], eye: 'rgba(20,20,30,.85)' }, pack(), { walk: guy.st !== 'dance', w: guy.w, t: state.lastT });
    place(cv, guy.back ? g.stage : g.card, sc);
  }
  const kick = () => { if (!state.raf && prefOn() && playing()) { state.lastT = performance.now(); state.raf = requestAnimationFrame(frame); } };
  new MutationObserver(kick).observe(card, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('vibe:dancers', kick);
  window.addEventListener('resize', () => { state.geoAt = -1e9; });
  kick();
})();
