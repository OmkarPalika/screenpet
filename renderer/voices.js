'use strict';

// The noise a pet makes, synthesised on the spot.
//
// No audio files: nothing to license, nothing to unpack out of the asar, nothing
// on disk that can be swapped for a sound that is not a woof. Six recipes of
// oscillators and filtered noise, a fifth of a second each.
//
// Takes its AudioContext as an argument and never reaches for one of its own,
// which is what lets the check render a bark into an OfflineAudioContext and
// assert the thing is actually audible, rather than assert that the code ran.

// A small creature at the edge of the screen, not a sound board.
const MASTER = 0.16;

// How one voice bends with the feeling behind it. This is here so that six
// species need six recipes rather than thirty: the cat has one meow and five
// ways of meaning it.
const FEELINGS = {
  neutral: { pitch: 1, speed: 1, gain: 1 },
  happy: { pitch: 1.14, speed: 1.12, gain: 1 },
  sad: { pitch: 0.82, speed: 0.78, gain: 0.75 },
  cross: { pitch: 1.06, speed: 1.3, gain: 1.15 },
  sleepy: { pitch: 0.7, speed: 0.6, gain: 0.55 },
};

// Which faces sound like what. Only the faces with an opinion are listed;
// everything else - hmm, oh, curious, listen, shock - is neutral, which is both
// correct and the reason this table is two dozen names rather than forty.
const FEELING_OF = {};
for (const [feeling, faces] of Object.entries({
  happy: ['smile', 'grin', 'love', 'yum', 'giggle', 'proud', 'joy', 'wink', 'shy',
    'flushed', 'melt', 'starstruck', 'hug', 'innocent', 'cool', 'smug', 'mischief', 'wry'],
  sad: ['cry', 'sulk', 'wistful', 'pleading', 'queasy', 'dizzy', 'oops', 'grimace'],
  cross: ['annoyed', 'rage', 'huff', 'eyeroll', 'deadpan'],
  sleepy: ['doze'],
})) {
  for (const face of faces) FEELING_OF[face] = feeling;
}

/** A face out of the pet's forty, or nothing, to one of the five above. */
const feelingOf = (expr) => FEELING_OF[expr] || 'neutral';

// White noise, once per context. Two seconds is longer than any recipe needs and
// short enough that regenerating it is never worth thinking about again.
const noiseFor = new WeakMap();

function noiseBuffer(ctx) {
  let buf = noiseFor.get(ctx);
  if (buf) return buf;
  buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseFor.set(ctx, buf);
  return buf;
}

/**
 * The two things a recipe can ask for, with the feeling already folded in, so a
 * recipe below reads as what it sounds like and nothing else.
 */
function parts(ctx, out, when, f) {
  const self = { end: when };

  // Exponential both ways: an audio taper, and a linear ramp to zero would click.
  const envelope = (peak, t0, dur) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * f.gain), t0 + Math.min(0.012, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(out);
    self.end = Math.max(self.end, t0 + dur);
    return g;
  };

  const filtered = (node, type, freq) => {
    if (!freq) return node;
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = freq;
    node.connect(b);
    return b;
  };

  self.tone = ({ type = 'sine', from, to = from, at = 0, dur, peak = 0.5, low = 0 }) => {
    const t0 = when + at / f.speed;
    const len = dur / f.speed;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from * f.pitch, t0);
    osc.frequency.exponentialRampToValueAtTime(to * f.pitch, t0 + len);
    filtered(osc, 'lowpass', low && low * f.pitch).connect(envelope(peak, t0, len));
    osc.start(t0);
    osc.stop(t0 + len + 0.02);
    return self;
  };

  self.noise = ({ at = 0, dur, peak = 0.4, low = 1200 }) => {
    const t0 = when + at / f.speed;
    const len = dur / f.speed;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    filtered(src, 'lowpass', low * f.pitch).connect(envelope(peak, t0, len));
    src.start(t0);
    src.stop(t0 + len + 0.02);
    return self;
  };

  return self;
}

// One per species, and they have to be tellable apart with a speech bubble in
// the way: a bark is a thump with noise on it, a meow is a pitch that goes up
// before it comes down, a chirp is over before you can place it.
const VOICES = {
  blob: (a) => a.tone({ type: 'sine', from: 380, to: 140, dur: 0.24, peak: 0.8 }),

  cat: (a) => a
    .tone({ type: 'sawtooth', from: 480, to: 720, dur: 0.11, peak: 0.34, low: 1600 })
    .tone({ type: 'sawtooth', from: 720, to: 360, at: 0.1, dur: 0.3, peak: 0.4, low: 1300 }),

  pup: (a) => a
    .tone({ type: 'triangle', from: 300, to: 90, dur: 0.18, peak: 0.7 })
    .noise({ dur: 0.1, peak: 0.45, low: 1400 }),

  // These two are the quietest and the shortest, and both had to be lengthened
  // and lifted before they were audible at all next to a bark - a squeak at the
  // top of the range is most of the way to a sound you cannot hear.
  bun: (a) => a
    .tone({ from: 1100, to: 1500, dur: 0.1, peak: 0.5 })
    .tone({ from: 900, to: 1300, at: 0.13, dur: 0.09, peak: 0.4 }),

  bird: (a) => a
    .tone({ from: 2300, to: 3300, dur: 0.09, peak: 0.45 })
    .tone({ from: 2600, to: 2000, at: 0.12, dur: 0.1, peak: 0.38 }),

  dragon: (a) => a
    .tone({ type: 'sawtooth', from: 90, to: 55, dur: 0.5, peak: 0.5, low: 400 })
    .noise({ dur: 0.45, peak: 0.22, low: 300 }),
};

/**
 * Make the noise. Everything is scheduled and nothing is held, so this returns
 * rather than resolves.
 *
 * @param {BaseAudioContext} ctx
 * @param {string} species  anything unrecognised makes no sound at all - a
 *   fallback bark would mean a typo in settings is inaudible instead of obvious
 * @param {string} expr  the face it is wearing; see feelingOf
 * @param {number} when  context time to start at, default now
 * @returns {number} the time it finishes, for a caller that wants to know
 */
function sound(ctx, species, expr, when = ctx.currentTime) {
  const recipe = VOICES[species];
  if (!recipe) return when;
  const out = ctx.createGain();
  out.gain.value = MASTER;
  out.connect(ctx.destination);
  const a = parts(ctx, out, when, FEELINGS[feelingOf(expr)] || FEELINGS.neutral);
  recipe(a);
  return a.end;
}

// Loaded by a script tag in the pet window and required by the tests. The window
// gets globals - `const` at the top level of a classic script is already one.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VOICES, FEELINGS, FEELING_OF, feelingOf, sound, MASTER };
}
