'use strict';

// When the pet thinks about stopping, and what it thinks about.
//
// Pure - main.js owns the clock and the window, and the renderer owns the walk
// into the middle of the screen. Everything here is a decision about when it is
// acceptable to put a thought in front of somebody, which is the only
// interesting question this feature has.

// Alternating, because the two things worth stopping for are different: water is
// somewhere to go, and sitting still is something to do where you sit. One kind
// on its own becomes wallpaper inside a day.
//
// The face is what the thought bubble holds. There are no words in it on
// purpose - a thought with a sentence in it is a notification wearing a costume,
// and this one has to be small enough to ignore.
const BREAKS = [
  { kind: 'water', face: '💧' },
  { kind: 'rest', face: '🧘' },
];

// Bounds on the two numbers, exported so settings.js validates against the same
// ones this file assumes. A thought every thirty seconds is nagging with extra
// steps, and a break that lasts an hour is a screensaver.
const EVERY_MIN = { min: 5, max: 240, def: 50 };
const FOR_S = { min: 5, max: 600, def: 20 };

// Anything that is not actually a number falls back to the default rather than
// being coerced into one. Number(null) is 0 and Number('') is 0, and a cleared
// box in the settings window becoming "every five minutes" is the opposite of
// what emptying it meant.
const clamp = (v, { min, max, def }) => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : def;
};

const clampEvery = (v) => clamp(v, EVERY_MIN);
const clampFor = (v) => clamp(v, FOR_S);

/** Which one this is. Alternates, and survives a counter that only goes up. */
const nth = (count) => BREAKS[Math.abs(Math.trunc(count) || 0) % BREAKS.length];

/**
 * Whether it is time to think about one.
 *
 * Every argument after the first three is a reason not to, and they are all the
 * same reason: a thought appearing over a game, a call or a presentation is an
 * interruption however small it is, and this is only worth having while it is
 * never that.
 *
 * Being away is handled by the caller rather than here: idle time is already
 * rest, so the clock is pushed along while nobody is there rather than leaving a
 * thought sitting on screen for somebody who has gone home.
 */
function due(last, now, everyMs, { quiet = false, busy = false } = {}) {
  if (!Number.isFinite(everyMs) || everyMs <= 0) return false;
  if (quiet || busy) return false;
  return now - last >= everyMs;
}

module.exports = { BREAKS, EVERY_MIN, FOR_S, clampEvery, clampFor, nth, due };
