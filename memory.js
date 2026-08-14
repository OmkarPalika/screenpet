'use strict';

// What the pet remembers between sessions, and everything it does with it. Pure:
// no disk, no Electron, no clock of its own. main.js owns all three, the same
// arrangement as pet-state.js and reminders.js.
//
// This is the second file that ends up holding your words, and unlike timers.json
// it is the one that accumulates - so the rules are narrow on purpose:
//
//   * Your words are written here only when you said "remember ...". Nothing
//     typed at the pet, read off the screen, heard through the microphone or seen
//     through the camera ever lands in this file.
//   * Everything else it learns is a counter. "you ask me things around 9pm" is
//     six numbers in a bucket, not a sentence you said.
//   * It is redacted on the way in, using the same patterns that guard the model
//     prompt - a remembered password is still a password in a file.
//   * "forget everything" empties it, and switching the setting off deletes it.
//
// Nothing here leaves the machine. The one place a memory is read out to anything
// is the chat prompt, which goes to Ollama on loopback.

// Reused rather than re-written: this is exactly the cleaning a line of text
// needs before it goes in a bubble and through a speech engine, and there is no
// second definition of it.
const { clean } = require('./reminders');
const { redact } = require('./brain');

// A pet, not a notebook. Past this the oldest goes, because a memory you have to
// scroll is a file, and a file wants an editor and a search box and a backup.
const MAX_FACTS = 40;

// What gets counted. Three, and adding a fourth means deciding it is worth a
// column in a file that lives on someone's machine forever.
//   ask  - you asked it to read the screen
//   chat - you said something to it
//   care - you fed, patted or played with it
const EVENTS = ['ask', 'chat', 'care'];

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

// Ceilings, so a hand-edited or corrupted file cannot produce a sentence with a
// nine digit number in it.
const MAX_COUNT = 1e6;
const MAX_DAYS = 1e5;

// Before this many observations a "pattern" is a coincidence with a bar chart.
const PATTERN_MIN = 6;
// ...and it has to actually be concentrated. A three hour window holding under
// this share of everything is just "you use your computer".
const PATTERN_SHARE = 0.4;

// The pet may bring up something it remembers this often and no more. Deliberately
// rarer than small talk: a remark about last Tuesday is charming once an evening
// and unbearable four times an hour.
const REMARK_GAP_MS = 90 * 60000;

// The same routine is mentioned at most once a day, whatever else happens.
const ROUTINE_GAP_MS = 20 * HOUR_MS;

// Gone longer than this and coming back is worth a word. Under a full day on
// purpose - overnight does not count as an absence.
const AWAY_MS = 30 * HOUR_MS;

// How long you have to have known each other before the pet is allowed to be
// cheeky about it. It needs a yesterday to compare today against, and teasing
// from something you installed an hour ago is not teasing, it is rude.
const CHEEK_MIN_DAYS = 2;

const DAY_TIERS = [7, 30, 100, 365];

const two = (n) => String(n).padStart(2, '0');

/** Local calendar day, which is the one the person actually lives in. */
function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

const zeros = () => new Array(24).fill(0);

// Words too common to mean anything when two sentences share them. Short and
// hand-picked rather than a real stoplist: the matching below also requires
// three characters, which removes most of the rest for free.
const STOP = new Set([
  'the', 'and', 'but', 'for', 'you', 'your', 'yours', 'are', 'was', 'were',
  'that', 'this', 'with', 'have', 'has', 'had', 'not', 'can', 'will', 'would',
  'about', 'what', 'when', 'why', 'how', 'who', 'they', 'them', 'their', 'there',
  'from', 'into', 'out', 'get', 'got', 'its', 'my', 'me', 'i', 'a', 'an', 'is',
  'do', 'does', 'did', 'be', 'been', 'it', 'at', 'on', 'in', 'of', 'to', 'so',
]);

/** A message reduced to the words worth matching on. */
function terms(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
  )];
}

const norm = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function fresh(now = 0) {
  return {
    since: now,
    lastSeen: now,
    days: 1,
    day: dayKey(now),
    // Things you asked it to remember.
    facts: [],
    // Counters. No words in here, ever.
    hours: { ask: zeros(), chat: zeros(), care: zeros() },
    care: { n: 0, best: 0, bestDay: '' },
    // How many times a poking bout went past cross and made it cry. The only
    // thing the pet holds against you, and it is a number.
    cross: 0,
    // Bookkeeping for the unprompted lines, so none of them repeats.
    lastRemarkAt: 0,
    toldDays: 0,
    toldPattern: '',
    // Set when the app comes back after a long absence, cleared once mentioned.
    away: 0,
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function loadFacts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const text = clean(item.text);
    if (!text) continue;
    const hour = Number(item.hour);
    out.push({
      text,
      at: Number.isFinite(item.at) && item.at >= 0 ? item.at : 0,
      hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null,
      saidAt: Number.isFinite(item.saidAt) && item.saidAt >= 0 ? item.saidAt : 0,
    });
  }
  return out.slice(-MAX_FACTS);
}

/** Anything unrecognised is dropped rather than repaired. Same rule as everywhere. */
function load(raw, now) {
  const base = fresh(now);
  if (!raw || typeof raw !== 'object') return base;

  const num = (v, d, cap = MAX_COUNT) =>
    (Number.isFinite(v) && v >= 0 ? Math.min(v, cap) : d);

  const buckets = (v) => {
    if (!Array.isArray(v) || v.length !== 24) return zeros();
    return v.map((n) => Math.round(num(n, 0)));
  };

  const rawHours = raw.hours && typeof raw.hours === 'object' ? raw.hours : {};
  const hours = {};
  for (const event of EVENTS) hours[event] = buckets(rawHours[event]);

  const rawCare = raw.care && typeof raw.care === 'object' ? raw.care : {};
  return {
    since: num(raw.since, now, Infinity),
    lastSeen: num(raw.lastSeen, now, Infinity),
    days: Math.max(1, Math.round(num(raw.days, 1, MAX_DAYS))),
    day: typeof raw.day === 'string' && DAY_RE.test(raw.day) ? raw.day : base.day,
    facts: loadFacts(raw.facts),
    hours,
    care: {
      n: Math.round(num(rawCare.n, 0)),
      best: Math.round(num(rawCare.best, 0)),
      bestDay: typeof rawCare.bestDay === 'string' && DAY_RE.test(rawCare.bestDay)
        ? rawCare.bestDay : '',
    },
    cross: Math.round(num(raw.cross, 0)),
    lastRemarkAt: num(raw.lastRemarkAt, 0, Infinity),
    toldDays: Math.round(num(raw.toldDays, 0, MAX_DAYS)),
    toldPattern: typeof raw.toldPattern === 'string' ? raw.toldPattern.slice(0, 20) : '',
    away: num(raw.away, 0, Infinity),
  };
}

/**
 * Advance to now: roll the day over if it has, and notice a long absence.
 *
 * Called on every tick, so it has to be cheap and idempotent - two calls a second
 * apart must not count as two days or two absences.
 */
function seen(mem, now) {
  const today = dayKey(now);
  const gap = now - mem.lastSeen;
  const next = { ...mem, lastSeen: Math.max(mem.lastSeen, now) };

  // An absence is only worth one mention, so it is recorded rather than acted on
  // and cleared by whoever says something about it.
  if (gap >= AWAY_MS) next.away = gap;

  if (today !== mem.day) {
    next.day = today;
    next.days = Math.min(mem.days + 1, MAX_DAYS);
    // Yesterday's total is only interesting if it was the best one.
    next.care = mem.care.n > mem.care.best
      ? { n: 0, best: mem.care.n, bestDay: mem.day }
      : { ...mem.care, n: 0 };
  }
  return next;
}

/**
 * Record one observation. A number in a bucket - never what was said.
 * @param {string} event one of EVENTS
 */
function note(mem, event, now) {
  if (!EVENTS.includes(event)) return mem;
  const next = seen(mem, now);
  const hour = new Date(now).getHours();
  const buckets = next.hours[event].slice();
  buckets[hour] = Math.min(buckets[hour] + 1, MAX_COUNT);
  return {
    ...next,
    hours: { ...next.hours, [event]: buckets },
    care: event === 'care'
      ? { ...next.care, n: Math.min(next.care.n + 1, MAX_COUNT) }
      : next.care,
  };
}

/** A poking bout went all the way to tears. The one thing it holds against you. */
function upset(mem) {
  return { ...mem, cross: Math.min(mem.cross + 1, MAX_COUNT) };
}

/**
 * Store something you asked it to remember.
 *
 * @param {string} text  your words, redacted and flattened before they are kept
 * @param {number|null} hour  the clock time in it, if the phrasing had one
 * @returns {{mem: object, fact: object|null}}
 */
function remember(mem, text, now, hour = null) {
  const said = clean(redact(String(text || '')));
  if (!said) return { mem, fact: null };

  const key = norm(said);
  // Saying the same thing twice replaces rather than duplicates: the second
  // telling is the one you meant.
  const facts = mem.facts.filter((f) => norm(f.text) !== key);
  const fact = {
    text: said,
    at: now,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null,
    saidAt: 0,
  };
  facts.push(fact);
  return { mem: { ...mem, facts: facts.slice(-MAX_FACTS) }, fact };
}

/**
 * Drop facts. With no text this empties the lot, which is what "forget
 * everything" has to mean - a forget that keeps some of it is not one.
 *
 * @returns {{mem: object, gone: number}}
 */
function forget(mem, text = null) {
  if (text === null || text === undefined || !String(text).trim()) {
    return { mem: { ...mem, facts: [] }, gone: mem.facts.length };
  }
  const want = terms(text);
  if (!want.length) return { mem, gone: 0 };
  const keep = mem.facts.filter((f) => !terms(f.text).some((w) => want.includes(w)));
  return { mem: { ...mem, facts: keep }, gone: mem.facts.length - keep.length };
}

/**
 * Facts worth bringing up alongside this message, best first.
 *
 * Shared words, not embeddings. It misses paraphrases and it always will; the
 * alternative is a vector index inside a desktop pet, and the miss costs nothing
 * because the model still answers - it just answers without the reminder.
 */
function recall(mem, text, limit = 2) {
  const want = terms(text);
  if (!want.length) return [];
  return mem.facts
    .map((f) => ({ f, score: terms(f.text).filter((w) => want.includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.f.at - a.f.at)
    .slice(0, Math.max(0, limit))
    .map((x) => x.f);
}

/**
 * When you tend to do something, or null if there is no real pattern yet.
 *
 * A three hour window rather than one bucket, because somebody who works from
 * eight to ten splits across three hours and would otherwise never have a habit.
 *
 * @returns {{hour: number, share: number, n: number}|null}
 */
function pattern(mem, event) {
  const buckets = mem.hours[event];
  if (!buckets) return null;
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total < PATTERN_MIN) return null;

  let best = -1;
  let at = 0;
  for (let h = 0; h < 24; h++) {
    const sum = buckets[h] + buckets[(h + 1) % 24] + buckets[(h + 2) % 24];
    if (sum > best) {
      best = sum;
      at = h;
    }
  }
  const share = best / total;
  return share >= PATTERN_SHARE ? { hour: (at + 1) % 24, share, n: total } : null;
}

const clockOf = (hour) => `${two(hour)}:00`;

const PATTERN_LINE = {
  ask: (h) => `you always have something for me to read around ${clockOf(h)}`,
  chat: (h) => `${clockOf(h)} is when you talk to me. I noticed`,
  care: (h) => `you look after me around ${clockOf(h)}. I have started expecting it`,
};

/** How long you have been gone, said the way a pet would say it. */
function awayLine(ms) {
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return `you were gone ${days} day${days === 1 ? '' : 's'}. I waited`;
  return 'that was a long one. I held the desk';
}

/**
 * The cheeky ones. Every line here is built from something actually recorded -
 * the pet needling you about a number it made up would be the same feature with
 * the honesty taken out.
 *
 * @returns {string|null}
 */
function dig(mem, now, index = 0) {
  if (mem.days < CHEEK_MIN_DAYS) return null;
  const hour = new Date(now).getHours();
  const options = [];

  // The one the whole feature is for: it remembers being liked, and can tell
  // that today is not that.
  if (mem.care.best >= 3 && mem.care.n === 0 && hour >= 12) {
    options.push(
      `you gave me ${mem.care.best} of those on ${mem.care.bestDay}. today: nothing. no notes`
    );
  }
  if (mem.care.best >= 3 && mem.care.n > 0 && mem.care.n * 3 <= mem.care.best) {
    options.push(`${mem.care.n} today. your record is ${mem.care.best}. I am not upset, I am counting`);
  }
  if (mem.cross > 0) {
    options.push(
      `I still remember the ${mem.cross === 1 ? 'time' : `${mem.cross} times`} you poked me until I cried`
    );
  }
  const fact = mem.facts.length ? mem.facts[(index >>> 0) % mem.facts.length] : null;
  if (fact) options.push(`you told me: "${fact.text}". how is that going, out of interest`);

  const p = pattern(mem, 'ask');
  if (p) options.push(`${clockOf(p.hour)} again. ${p.n} times now. we are both very predictable`);

  if (mem.days >= 7) options.push(`${mem.days} days of this. I have seen things`);

  return options.length ? options[(index >>> 0) % options.length] : null;
}

/**
 * The one thing the pet brings up off its own bat, or null. One function rather
 * than five, so these can never talk over each other - the pet says the most
 * interesting thing it knows and then shuts up for an hour and a half.
 *
 * Everything it decides to say is written back into the returned memory, which is
 * what stops it saying the same thing twice.
 *
 * @returns {{mem: object, text: string, event: string}|null}
 */
function remark(mem, now, { cheek = true, index = 0 } = {}) {
  if (now - mem.lastRemarkAt < REMARK_GAP_MS) return null;

  const said = (text, event, extra = {}) => ({
    mem: { ...mem, ...extra, lastRemarkAt: now },
    text,
    event,
  });

  // 1. You were away. Said first because it is only true for a moment.
  if (mem.away >= AWAY_MS) return said(awayLine(mem.away), 'greet', { away: 0 });

  // 2. A round number of days together, announced once each.
  const tier = DAY_TIERS.filter((t) => mem.days >= t && t > mem.toldDays).pop();
  if (tier) {
    return said(
      tier >= 365 ? 'a whole year of you. I would do it again'
        : `${tier} days now. that is a real friendship, I think`,
      'milestone',
      { toldDays: tier }
    );
  }

  // 3. A routine you told it about, at the hour you told it about.
  const hour = new Date(now).getHours();
  const due = mem.facts.find(
    (f) => f.hour === hour && now - f.saidAt >= ROUTINE_GAP_MS
  );
  if (due) {
    return said(`is it not about time? you said: ${due.text}`, 'ring', {
      facts: mem.facts.map((f) => (f === due ? { ...f, saidAt: now } : f)),
    });
  }

  // 4. A habit, the first time it is confident about one.
  for (const event of EVENTS) {
    const p = pattern(mem, event);
    const key = `${event}:${p ? p.hour : ''}`;
    if (p && key !== mem.toldPattern) {
      return said(PATTERN_LINE[event](p.hour), 'curious', { toldPattern: key });
    }
  }

  // 5. Cheek, last, and only if you left it switched on.
  if (cheek) {
    const line = dig(mem, now, index);
    if (line) return said(line, 'annoy');
  }
  return null;
}

/**
 * What the model is told about you before it answers. Kept to a handful of short
 * lines: this is prepended to a chat prompt that a 8B model has to hold in its
 * head alongside the actual question, and a wall of context makes small models
 * worse, not better.
 *
 * Goes to Ollama on loopback and nowhere else.
 *
 * @returns {string[]} lines, or empty
 */
function brief(mem, text, now = 0) {
  const found = recall(mem, text, 2);
  const lines = [];
  if (found.length) {
    lines.push('Things they asked you to remember, which may or may not be relevant:');
    for (const f of found) lines.push(`- ${f.text}`);
  }
  // Elapsed days, not days seen: "we have known each other a month" is true even
  // if the machine was off for a fortnight of it.
  const days = Math.floor(Math.max(0, now - mem.since) / DAY_MS);
  if (days >= 7) lines.push(`You have lived on their computer for ${days} days.`);
  return lines;
}

/** Everything it is holding, for "what do you remember". */
function listing(mem, limit = 3) {
  if (!mem.facts.length) return 'nothing yet! tell me to remember something';
  const newest = mem.facts.slice(-limit).reverse().map((f) => f.text);
  const rest = mem.facts.length - newest.length;
  return `${newest.join('; ')}${rest > 0 ? ` (and ${rest} more)` : ''}`;
}

module.exports = {
  fresh, load, seen, note, upset, remember, forget, recall, pattern, remark,
  brief, listing, dig, terms, dayKey,
  EVENTS, MAX_FACTS, PATTERN_MIN, PATTERN_SHARE, REMARK_GAP_MS, AWAY_MS,
  ROUTINE_GAP_MS, CHEEK_MIN_DAYS, DAY_TIERS,
};
