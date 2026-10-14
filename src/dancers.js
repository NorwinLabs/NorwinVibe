/* One little pixel guy, drawn as a jointed skeleton and animated at the screen's full frame rate (60 fps).
   When music plays he climbs out from behind the record player and wanders around the screen: he walks to a spot, busts a run of
   dance moves locked to the beat (a library of ~35: grooves, disco, robot, dab, floss, jacks, kicks, spins, flips...), and walks on
   to the next spot. Every move is a function of the beat clock, and moves are cross-faded, so nothing ever snaps. The harder the
   music hits, the bigger the moves he picks. When the music stops he walks back and slips behind the record player.
   Settings > Look: "Dancing pixel guy" (on / off) and "Dancer" (Guy, Robot, Alien). */
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
  function figure(g, P, c, pack) {
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
    figure(ctx, P, { body: state.colors[guy.hue], det: state.colors[(guy.hue + 1) % 2], head: state.colors[2], eye: 'rgba(20,20,30,.85)' }, pack());
    place(cv, guy.back ? g.stage : g.card, sc);
  }
  const kick = () => { if (!state.raf && prefOn() && playing()) { state.lastT = performance.now(); state.raf = requestAnimationFrame(frame); } };
  new MutationObserver(kick).observe(card, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('vibe:dancers', kick);
  window.addEventListener('resize', () => { state.geoAt = -1e9; });
  kick();
})();
