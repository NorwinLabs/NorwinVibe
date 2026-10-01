'use strict';
/* Fade the volume down, pause, then put the volume back (the sleep timer's "fade out" option).
   Timers and the command sender are injected so this can be tested without waiting or touching the real volume. */
const fmt = (v) => (v >= 1 ? '1' : v <= 0 ? '0' : v.toFixed(2));

function createFader({ send, getVolume, setTimer = setTimeout, clearTimer = clearTimeout, restoreDelayMs = 1500 }) {
  let timers = [], orig = 1, running = false;
  const later = (fn, ms) => { timers.push(setTimer(fn, ms)); };
  function clearAll() { timers.forEach((t) => clearTimer(t)); timers = []; }
  return {
    get running() { return running; },
    /** Fades over `totalMs`, pauses at the end, then restores the original volume. */
    start(totalMs, steps = 20, onDone) {
      if (running) return;
      running = true; orig = Math.min(1, Math.max(0.05, getVolume()));
      for (let i = 1; i <= steps; i++) later(() => send(`volume:${fmt(orig * (1 - i / steps))}`), Math.round(totalMs * i / steps));
      later(() => { send('pause'); }, totalMs + 150);
      later(() => { send(`volume:${fmt(orig)}`); running = false; if (onDone) onDone(); }, totalMs + 150 + restoreDelayMs);
    },
    /** Stops a fade in progress (timer cancelled, app quitting...) and puts the volume back. */
    cancel() { if (!running) return; clearAll(); send(`volume:${fmt(orig)}`); running = false; },
  };
}

module.exports = { createFader, fmt };
