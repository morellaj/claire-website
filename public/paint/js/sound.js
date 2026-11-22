// Little synthesised sounds (no audio files) and haptics.
//
// Every note is in C major, and fill pops climb a pentatonic ladder, so
// sweeping across cells plays a rising tune instead of a pile of clicks.
//
// Haptics: iPads have no vibration motor, so on her iPad the sounds are the
// "feel". Phones that support it buzz too: navigator.vibrate on Android, and
// on iPhone (iOS 18+) the tick a switch toggle makes.

import { pref } from './store.js';

let ctx = null;
let muted = pref('muted') === true;
const LADDER = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0]; // C5 pentatonic up
let step = 0, lastPop = 0;

/** Call from inside a tap: browsers only allow sound after a touch. */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function isMuted() { return muted; }
export function setMuted(m) { muted = m; pref('muted', m); }

function tone(freq, { at = 0, dur = 0.09, type = 'triangle', vol = 0.18, slide = 1.0 } = {}) {
  if (muted || !ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

/** One cell filled. Quick fills climb the ladder; a pause starts it again. */
export function pop() {
  const now = performance.now();
  if (now - lastPop < 30) return; // a fast sweep: don't machine-gun
  if (now - lastPop > 700) step = 0;
  lastPop = now;
  tone(LADDER[step % LADDER.length] * (step >= LADDER.length ? 2 : 1), { dur: 0.08, slide: 1.06 });
  tone(LADDER[step % LADDER.length] * 2, { dur: 0.05, vol: 0.05, type: 'sine' });
  step = Math.min(step + 1, LADDER.length * 2 - 1);
  buzz(8);
}

/** A whole patch filled at once: a quick sparkly run up. */
export function swoosh(size) {
  const n = Math.min(6, 2 + Math.floor(Math.log2(Math.max(2, size))));
  for (let i = 0; i < n; i++) tone(LADDER[(i * 2) % LADDER.length], { at: i * 0.045, dur: 0.12, vol: 0.14 });
  tone(LADDER[(n * 2) % LADDER.length] * 2, { at: n * 0.045, dur: 0.25, vol: 0.06, type: 'sine' });
  buzz(18);
}

/** A colour is finished. */
export function chime() {
  [783.99, 1046.5, 1567.98].forEach((f, i) => tone(f, { at: i * 0.08, dur: 0.35, vol: 0.12, type: 'sine' }));
  buzz([20, 40, 20]);
}

/** The picture is finished: a little tune ending G up to C. */
export function fanfare() {
  const notes = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [783.99, 0.6], [1046.5, 0.72]];
  for (const [f, at] of notes) { tone(f, { at, dur: 0.22, vol: 0.16 }); tone(f / 2, { at, dur: 0.22, vol: 0.06, type: 'sine' }); }
  tone(2093, { at: 0.9, dur: 0.6, vol: 0.05, type: 'sine' });
  buzz([30, 60, 30, 60, 80]);
}

/** A wrong colour: a soft low "boop". */
export function boop() { tone(220, { dur: 0.12, vol: 0.08, type: 'sine', slide: 0.8 }); }

// ---- haptics
let switchLabel = null;
export function buzz(pattern) {
  if (muted) return;
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } return; }
  // iOS 18+ iPhones tick when a switch toggles; on iPads this does nothing
  if (!switchLabel) {
    switchLabel = document.createElement('label');
    switchLabel.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.setAttribute('switch', '');
    switchLabel.append(input);
    document.body.append(switchLabel);
  }
  switchLabel.click();
}
