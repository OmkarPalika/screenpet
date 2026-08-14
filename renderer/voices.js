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

  // `high` arrived with the hiss. A hiss is air and nothing else: no oscillator,
  // and all of it above about 2kHz, which a lowpass alone cannot describe.
  self.noise = ({ at = 0, dur, peak = 0.4, low = 1200, high = 0 }) => {
    const t0 = when + at / f.speed;
    const len = dur / f.speed;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const band = filtered(filtered(src, 'lowpass', low * f.pitch), 'highpass', high * f.pitch);
    band.connect(envelope(peak, t0, len));
    src.start(t0);
    src.stop(t0 + len + 0.02);
    return self;
  };

  /**
   * The same short sound, several times over. A purr, a growl and a gekker are
   * all one pulse repeated - writing them as a run of `at:` offsets by hand is
   * six near-identical lines where the interesting number is the interval.
   */
  self.pulses = (n, every, make) => {
    for (let i = 0; i < n; i++) make(i * every, i);
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

  // A yip is a bark that starts where a bark ends - up, and over before the
  // pup's has finished its thump.
  fox: (a) => a
    .tone({ type: 'triangle', from: 900, to: 1500, dur: 0.06, peak: 0.42 })
    .tone({ type: 'triangle', from: 1400, to: 480, at: 0.06, dur: 0.17, peak: 0.4, low: 2600 }),

  // Two bubbles rather than a voice. Both rise, which is the one thing nothing
  // else here does twice in a row.
  axolotl: (a) => a
    .tone({ from: 240, to: 540, dur: 0.11, peak: 0.5, low: 900 })
    .tone({ from: 200, to: 430, at: 0.14, dur: 0.11, peak: 0.4, low: 800 }),

  // Long, quiet and hollow, with just enough breath under it not to be a hum.
  ghost: (a) => a
    .tone({ from: 300, to: 190, dur: 0.5, peak: 0.34, low: 700 })
    .noise({ dur: 0.42, peak: 0.07, low: 500 }),

  // The only square waves in the file, and the only two notes that do not glide
  // into each other: a robot is the thing that does not bend its pitch.
  robot: (a) => a
    .tone({ type: 'square', from: 740, dur: 0.08, peak: 0.26, low: 2600 })
    .tone({ type: 'square', from: 430, at: 0.11, dur: 0.13, peak: 0.24, low: 2200 }),
};

// What a feeling actually sounds like, where bending the ordinary voice is a lie.
//
// The five FEELINGS above are a pitch, a speed and a volume, and for most of the
// forty faces that is enough - a slightly higher, slightly faster meow reads as a
// pleased one. It stops being enough where the animal has a *different sound* for
// the feeling: a cross cat does not meow faster, it hisses, and there is no
// setting of pitch and speed that turns a meow into a hiss. A sad dog whines. A
// cross rabbit thumps its foot and says nothing at all.
//
// So: a table of the calls worth writing, and nothing else. Anything not listed
// here falls back to the species' own voice with the feeling bent into it, which
// is the right answer for most of them - a pleased chirp really is a chirp, up a
// bit. Nothing is added here to fill in a grid; every entry is a sound the animal
// makes that its ordinary voice cannot be stretched into.
//
// A call is played with the feeling NOT bent into it. It already is the feeling -
// running a hiss through cross's 1.3x speed makes it a shorter hiss and nothing
// more, and running a moan through sleepy's 0.6x makes it outlast the window.
const CALLS = {
  blob: {
    // It has no throat, so its feelings are things happening to a blob: it
    // springs, it deflates, it squelches.
    happy: (a) => a.tone({ from: 220, to: 760, dur: 0.14, peak: 0.7 })
      .tone({ from: 700, to: 520, at: 0.15, dur: 0.12, peak: 0.45 }),
    sad: (a) => a.tone({ from: 300, to: 90, dur: 0.6, peak: 0.5, low: 700 }),
    cross: (a) => a.tone({ type: 'square', from: 420, to: 200, dur: 0.15, peak: 0.6, low: 1400 })
      .noise({ dur: 0.11, peak: 0.34, low: 1800 }),
  },

  cat: {
    // Air, and not one oscillator in it. The only voice here with no voice.
    cross: (a) => a.noise({ dur: 0.36, peak: 0.34, low: 9000, high: 2400 }),
    // A yowl is not a fast meow, it is a long one that sags in the middle.
    sad: (a) => a.tone({ type: 'sawtooth', from: 640, to: 300, dur: 0.5, peak: 0.34, low: 1200 }),
    // The "brrp" a cat says with its mouth shut - rolled, so pulses, rising.
    happy: (a) => a.pulses(5, 0.05, (at, i) =>
      a.tone({ type: 'sawtooth', from: 520 + i * 55, dur: 0.055, at, peak: 0.42, low: 1500 })),
    // A purr is 25Hz of amplitude, not a note. Pulses are the only way to say
    // that with an envelope.
    //
    // Measured rather than chosen: an exponential envelope spends over half its
    // length below the level anything can hear, so a pulse has to be roughly
    // twice as long and twice as loud as it looks on paper. A purr at peak 0.30
    // through a 420Hz lowpass rendered as silence.
    sleepy: (a) => a.pulses(8, 0.058, (at) =>
      a.noise({ at, dur: 0.055, peak: 0.62, low: 760 })),
  },

  pup: {
    // Low, continuous, and it does not resolve - a growl that ends in a note is
    // a bark. Two layers because a growl is voice and gravel at once.
    cross: (a) => a.tone({ type: 'sawtooth', from: 110, to: 95, dur: 0.5, peak: 0.42, low: 500 })
      .noise({ dur: 0.5, peak: 0.16, low: 700 }),
    // A whine goes up. That is the whole difference between a whine and a bark,
    // and it is why it reads as asking for something.
    sad: (a) => a.tone({ from: 520, to: 900, dur: 0.16, peak: 0.34, low: 2200 })
      .tone({ from: 480, to: 820, at: 0.2, dur: 0.22, peak: 0.30, low: 2000 }),
    // Two yips on top of each other, the second higher: a dog that cannot wait.
    happy: (a) => a.tone({ type: 'triangle', from: 420, to: 620, dur: 0.07, peak: 0.55 })
      .tone({ type: 'triangle', from: 500, to: 760, at: 0.1, dur: 0.07, peak: 0.5 })
      .noise({ dur: 0.05, peak: 0.3, low: 1600 }),
  },

  bun: {
    // A cross rabbit says nothing. It thumps, once, with a back foot - and that
    // is the only entry in this table with no voice in it at all.
    cross: (a) => a.tone({ from: 120, to: 42, dur: 0.11, peak: 0.85, low: 260 })
      .noise({ dur: 0.05, peak: 0.35, low: 300 }),
    // Rabbits honk when they are pleased. It is a real sound and it is ridiculous.
    happy: (a) => a.tone({ type: 'square', from: 330, to: 300, dur: 0.09, peak: 0.28, low: 900 })
      .tone({ type: 'square', from: 360, to: 320, at: 0.12, dur: 0.1, peak: 0.26, low: 900 }),
    sad: (a) => a.tone({ from: 900, to: 620, dur: 0.28, peak: 0.3, low: 2000 }),
  },

  bird: {
    // A rattle: beak, not throat. Clicks close enough together to be one texture.
    cross: (a) => a.pulses(6, 0.042, (at) => a.noise({ at, dur: 0.036, peak: 0.5, low: 8000, high: 1500 })),
    // Song rather than a call - three notes going up, which nothing else here does.
    happy: (a) => a.tone({ from: 2200, to: 2600, dur: 0.06, peak: 0.4 })
      .tone({ from: 2700, to: 3100, at: 0.07, dur: 0.06, peak: 0.42 })
      .tone({ from: 3200, to: 3800, at: 0.14, dur: 0.08, peak: 0.38 }),
    sad: (a) => a.tone({ from: 1900, to: 1100, dur: 0.34, peak: 0.3 }),
  },

  dragon: {
    // The rumble opens out instead of dying away, and the noise outlasts the
    // note - which is what makes it a roar and not a longer growl.
    cross: (a) => a.tone({ type: 'sawtooth', from: 80, to: 130, dur: 0.5, peak: 0.6, low: 600 })
      .noise({ dur: 0.62, peak: 0.34, low: 900 }),
    // Pleased is the same engine idling: pulses, low, going nowhere pleasantly.
    happy: (a) => a.pulses(7, 0.062, (at) => a.noise({ at, dur: 0.06, peak: 0.62, low: 620 })),
    // In, then out. A snore is two sounds and everybody knows which way round.
    sleepy: (a) => a.noise({ dur: 0.3, peak: 0.3, low: 700, high: 180 })
      .tone({ type: 'sawtooth', from: 70, to: 58, at: 0.36, dur: 0.3, peak: 0.28, low: 300 }),
  },

  fox: {
    // The gekker: the stuttering row foxes have at 3am. Nothing else stutters.
    cross: (a) => a.pulses(6, 0.055, (at, i) =>
      a.tone({ type: 'triangle', from: 900 + (i % 2) * 320, to: 700, at, dur: 0.036, peak: 0.4, low: 2600 })),
    sad: (a) => a.tone({ from: 800, to: 1250, dur: 0.13, peak: 0.3, low: 2600 })
      .tone({ from: 760, to: 1100, at: 0.17, dur: 0.15, peak: 0.26, low: 2400 }),
    happy: (a) => a.pulses(3, 0.09, (at, i) =>
      a.tone({ type: 'triangle', from: 950 + i * 130, to: 1500 + i * 130, at, dur: 0.05, peak: 0.4 })),
  },

  axolotl: {
    // It is an amphibian with no vocal cords, so every feeling is water moving.
    happy: (a) => a.pulses(3, 0.09, (at, i) =>
      a.tone({ from: 230 + i * 70, to: 560 + i * 90, at, dur: 0.08, peak: 0.45, low: 900 })),
    sad: (a) => a.tone({ from: 420, to: 150, dur: 0.42, peak: 0.4, low: 700 }),
    cross: (a) => a.noise({ dur: 0.19, peak: 0.5, low: 2600, high: 700 }),
  },

  ghost: {
    // Long, and it keeps sinking. The one sound here allowed to outstay itself.
    sad: (a) => a.tone({ from: 340, to: 120, dur: 0.66, peak: 0.36, low: 600 })
      .noise({ dur: 0.6, peak: 0.06, low: 450 }),
    // Up, and cut off - a shriek stops, it does not fade.
    cross: (a) => a.tone({ from: 400, to: 1400, dur: 0.22, peak: 0.4, low: 2400 }),
    happy: (a) => a.tone({ from: 380, to: 620, dur: 0.2, peak: 0.3, low: 900 })
      .tone({ from: 560, to: 700, at: 0.22, dur: 0.18, peak: 0.24, low: 900 }),
  },

  robot: {
    // Squares, and never a bent pitch: the robot is the one that cannot slur.
    happy: (a) => a.pulses(3, 0.075, (at, i) =>
      a.tone({ type: 'square', from: 520 + i * 220, at, dur: 0.06, peak: 0.24, low: 2600 })),
    // Power down. The one place a robot is allowed to glide, because that is the
    // sound of it not being in charge of itself any more.
    sad: (a) => a.tone({ type: 'square', from: 620, to: 130, dur: 0.44, peak: 0.24, low: 1800 }),
    cross: (a) => a.pulses(2, 0.13, (at) => a
      .tone({ type: 'square', from: 210, at, dur: 0.1, peak: 0.26, low: 1400 })
      .tone({ type: 'square', from: 233, at, dur: 0.1, peak: 0.22, low: 1400 })),
    sleepy: (a) => a.tone({ type: 'square', from: 300, at: 0, dur: 0.1, peak: 0.16, low: 900 })
      .tone({ type: 'square', from: 240, at: 0.28, dur: 0.14, peak: 0.13, low: 800 }),
  },
};

/** The purpose-written call for this species and feeling, if there is one. */
const callFor = (species, feeling) => (CALLS[species] || {})[feeling] || null;

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
  if (!VOICES[species]) return when;
  const feeling = feelingOf(expr);
  const call = callFor(species, feeling);
  const out = ctx.createGain();
  out.gain.value = MASTER;
  out.connect(ctx.destination);
  // A call is the feeling already, so it is played straight. Only the ordinary
  // voice gets bent - bending a hiss by cross's pitch and speed makes a shorter
  // hiss and nothing more.
  const a = parts(ctx, out, when, call ? FEELINGS.neutral : (FEELINGS[feeling] || FEELINGS.neutral));
  (call || VOICES[species])(a);
  return a.end;
}

// Loaded by a script tag in the pet window and required by the tests. The window
// gets globals - `const` at the top level of a classic script is already one.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VOICES, CALLS, FEELINGS, FEELING_OF, feelingOf, callFor, sound, MASTER };
}
