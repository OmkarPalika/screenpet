'use strict';

// Pure reminder handling. No disk, no Electron - main.js owns both.
//
// This is the one thing the app writes down that you wrote: "remind me to call
// the bank in an hour" ends up in timers.json as the words "call the bank". It
// stays on your machine like everything else here, but it is a file with your
// notes in it, so it is capped, cleaned, and dropped the moment it fires.

// A hand-edited or corrupted file must not be able to fill the screen, hold the
// pet hostage, or push anything at a text to speech engine that is not a line of
// text. Both limits are ceilings rather than expectations: the timer skill
// writes reminders far under them.
const MAX_PENDING = 20;
const MAX_TEXT = 200;

// Two days. A reminder that fired while the app was closed is worth mentioning
// when you come back from lunch and not worth mentioning next week.
const MAX_LATE_MS = 48 * 60 * 60 * 1000;

// Everything below space, plus DEL. Flattened rather than kept: this string goes
// in a bubble and through a speech engine, and neither has any use for a newline
// or a terminal escape.
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** One line of plain text, or null if there is nothing usable left. */
function clean(text) {
  if (typeof text !== 'string') return null;
  const flat = text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return flat.slice(0, MAX_TEXT).trim() || null;
}

/**
 * Split a saved list into the ones that went off while the app was gone and the
 * ones still to come. Anything malformed is dropped rather than repaired.
 *
 * @param {unknown} raw  whatever was in timers.json
 * @param {number} now  epoch ms
 * @returns {{late: Array<{at:number, say:string}>, pending: Array<{at:number, say:string}>}}
 */
function load(raw, now) {
  const list = Array.isArray(raw) ? raw : [];
  const late = [];
  const pending = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const at = Number(item.at);
    const say = clean(item.say);
    if (!say || !Number.isFinite(at)) continue;
    if (at > now) pending.push({ at, say });
    else if (now - at <= MAX_LATE_MS) late.push({ at, say });
  }

  // Oldest first in both, so a queue of them replays in the order they were set.
  late.sort((a, b) => a.at - b.at);
  pending.sort((a, b) => a.at - b.at);
  return { late, pending: pending.slice(0, MAX_PENDING) };
}

/** What a reminder that fired while nobody was watching should say. */
function lateLine(say) {
  return `this went off while I was away: ${say}`;
}

module.exports = { load, clean, lateLine, MAX_PENDING, MAX_TEXT, MAX_LATE_MS };
