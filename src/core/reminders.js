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

// A repeat rule is four shapes and no more. Anything expressible here is also
// expressible in one sentence out loud, which is the point - this is a pet, not
// a calendar, and cron syntax has no business in it.
const KINDS = new Set(['daily', 'weekdays', 'weekly', 'interval']);

const DAY_MS = 24 * 60 * 60 * 1000;

/** A repeat rule, or null. Same deny-by-shape rule as the rest of this file. */
function validRepeat(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS.has(raw.kind)) return null;

  if (raw.kind === 'interval') {
    const ms = Number(raw.ms);
    // A minute is the floor: anything faster is a pet that never stops talking.
    return ms >= 60000 && ms <= 7 * DAY_MS ? { kind: 'interval', ms } : null;
  }

  const hour = Number(raw.hour);
  const minute = Number(raw.minute || 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  if (raw.kind === 'weekly') {
    const day = Number(raw.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    return { kind: 'weekly', day, hour, minute };
  }
  return { kind: raw.kind, hour, minute };
}

/**
 * When a repeating reminder next comes due, strictly after `from`.
 *
 * The clock is re-asserted on every step rather than adding 24 hours, because
 * across a daylight saving boundary a day is not 24 hours and a 7am alarm that
 * drifts to 6am is a bug you only notice twice a year.
 *
 * @returns {number|null} epoch ms, or null if the rule can never match
 */
function nextAt(repeat, from) {
  const rule = validRepeat(repeat);
  if (!rule) return null;
  if (rule.kind === 'interval') return from + rule.ms;

  const d = new Date(from);
  d.setHours(rule.hour, rule.minute, 0, 0);

  // Eight steps covers a week plus the day already gone past.
  for (let i = 0; i <= 8; i++) {
    const day = d.getDay();
    const matches = rule.kind === 'daily'
      || (rule.kind === 'weekdays' && day >= 1 && day <= 5)
      || (rule.kind === 'weekly' && day === rule.day);
    if (d.getTime() > from && matches) return d.getTime();
    d.setDate(d.getDate() + 1);
    d.setHours(rule.hour, rule.minute, 0, 0);
  }
  return null;
}

/**
 * Split a saved list into the ones that went off while the app was gone and the
 * ones still to come. Anything malformed is dropped rather than repaired.
 *
 * A repeating reminder is never dropped for being late - a daily alarm you
 * missed on holiday is still a daily alarm - it is mentioned once if it is
 * recent and then rescheduled either way.
 *
 * @param {unknown} raw  whatever was in timers.json
 * @param {number} now  epoch ms
 * @returns {{late: Array<object>, pending: Array<object>}}
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

    const repeat = validRepeat(item.repeat);
    if (at > now) {
      pending.push(repeat ? { at, say, repeat } : { at, say });
      continue;
    }

    if (now - at <= MAX_LATE_MS) late.push(repeat ? { at, say, repeat } : { at, say });
    if (repeat) {
      const next = nextAt(repeat, now);
      if (next) pending.push({ at: next, say, repeat });
    }
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

module.exports = {
  load, clean, lateLine, nextAt, validRepeat,
  MAX_PENDING, MAX_TEXT, MAX_LATE_MS, KINDS,
};
