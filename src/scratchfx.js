/* Sounds for dragging the record: a scratch whose pitch and loudness follow how fast you turn it, a tick when the direction
   flips, and a soft thump when you grab and let go. All synthesized here (nothing is recorded or downloaded), and they sit on
   top of whatever is playing; the song itself is only seeked, as before. Switch off in Settings > Player > Record scratch sounds. */
const ScratchFX = (() => {
  let ctx = null, gain = null, band = null, src = null, lastSign = 0, lastTick = 0, live = false;
  const enabled = () => !(typeof P !== 'undefined' && P && P.scratchfx === false);
  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let b0 = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.82 * b0 + 0.18 * w; d[i] = b0 * 3.2 + w * 0.35; } // gritty, slightly brown noise
      src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 900; band.Q.value = 1.4;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220;
      gain = ctx.createGain(); gain.gain.value = 0;
      const out = ctx.createGain(); out.gain.value = 0.6;
      src.connect(band); band.connect(hp); hp.connect(gain); gain.connect(out); out.connect(ctx.destination);
      src.start();
      return true;
    } catch { ctx = null; return false; }
  }
  function burst(freq, dur, vol, type = 'sine') { // a short blip: the grab / release thump and the direction-change tick
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.4), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    start() { if (!enabled() || !ensure()) return; if (ctx.state === 'suspended') ctx.resume(); live = true; lastSign = 0; burst(95, 0.12, 0.5); },
    // deg/s, signed: how fast and which way the record is being turned right now
    update(v) {
      if (!live || !ctx) return;
      const a = Math.min(1, Math.abs(v) / 700), t = ctx.currentTime;
      gain.gain.setTargetAtTime(a * 0.7, t, 0.025);
      band.frequency.setTargetAtTime(380 + a * 2800, t, 0.03);
      src.playbackRate.setTargetAtTime(0.55 + a * 1.5, t, 0.03);
      const sign = Math.sign(v);
      if (sign && lastSign && sign !== lastSign && a > 0.12 && performance.now() - lastTick > 70) { burst(1700, 0.05, 0.22, 'square'); lastTick = performance.now(); } // the "wicka" reversal
      if (sign) lastSign = sign;
    },
    stop() { if (!live || !ctx) return; live = false; gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04); burst(70, 0.16, 0.4); },
  };
})();
