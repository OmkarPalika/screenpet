'use strict';

// Reading the screen without being asked, while the setting is on.
//
// Pure - main.js owns the clock, the OCR and the model. Everything here is a
// decision about when it is worth reading again, and whether what came back is
// different enough from last time to be worth another answer.
//
// The whole feature is one trade: the hotkey costs a keypress and reads
// exactly when you meant it to, and this reads whether or not you meant it. So
// the interesting question is not "how often" but "how rarely" - a pet that
// answers the same screen twice is a pet you switch off.

// How long between reads, in seconds. The floor is the tick interval in main.js
// rather than a preference: the check runs on that tick, so anything under it
// is a number that quietly does not mean what it says. The ceiling is ten
// minutes, past which nothing about this is "realtime" any more.
const EVERY_S = { min: 20, max: 600, def: 60 };

// How much of what OCR read has to be new before it is worth another answer.
// Measured against the obvious failure: scrolling a page a little, or a clock in
// the corner ticking over, changes a handful of words out of hundreds and must
// not buy a fresh answer. Switching windows changes nearly all of them.
const CHANGE = 0.35;

// Same shape and same reasoning as breaks.js: anything that is not actually a
// number falls back to the default rather than being coerced into one, because
// Number('') is 0 and a cleared box meaning "read four times a minute" is the
// opposite of what emptying it meant.
function clampEvery(v) {
  const { min, max, def } = EVERY_S;
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : def;
}

/**
 * Whether it is time to read again.
 *
 * The reasons not to are the same three the rest of the app already respects: a
 * game, a call or a presentation is not a moment to pipe up in; an answer
 * already being written is not a moment to start another; and being away from
 * the machine means there is nobody to answer, which the caller checks because
 * it owns the idle clock.
 */
function due(last, now, everyMs, { quiet = false, busy = false } = {}) {
  if (!Number.isFinite(everyMs) || everyMs <= 0) return false;
  if (quiet || busy) return false;
  return now - last >= everyMs;
}

// Words rather than characters, and a set rather than a list. OCR is noisy at
// the character level - the same screen read twice differs by a few glyphs -
// and comparing sets makes re-ordering, re-flowing and re-wrapping all count as
// the same screen, which is what they are.
const words = (text) =>
  new Set(String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []);

/**
 * Is this a different screen from the last one it answered?
 *
 * Asymmetric on purpose: what matters is how much of what is there NOW is new,
 * not how much of the old screen has gone. Closing a window leaves the screen
 * you were already answering about; opening one puts something new in front of
 * you, and only the second is worth speaking about.
 */
function changed(before, after, ratio = CHANGE) {
  const now = words(after);
  if (!now.size) return false; // nothing readable is not a new screen
  const then = words(before);
  if (!then.size) return true;
  let fresh = 0;
  for (const w of now) if (!then.has(w)) fresh++;
  return fresh / now.size >= ratio;
}

module.exports = { EVERY_S, CHANGE, clampEvery, due, changed };
