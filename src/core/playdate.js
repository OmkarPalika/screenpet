'use strict';

// Two pets on the same network, meeting each other.
//
// This file is the whole of what may cross between two machines. It is a wire
// format and nothing else - no sockets, no timers, no Electron - so the one
// claim the feature has to keep can be tested without either machine existing.
//
// The claim: **the pets talk, the people do not.** Nothing you type, say, read
// or have on screen is representable here. A message is a species, a palette, a
// hat, a mood word, a bond number, a name you chose, and one verb from a list
// that is written out below in full. There is no free-text field and no
// pass-through, so there is no envelope to hide anything in.
//
// That is enforced by construction rather than by review. `build()` starts from
// an empty object and copies in only the keys in FIELDS, each through its own
// validator; a key that is not in FIELDS cannot survive a round trip, whether it
// came from a caller here or from a machine on the network. The test suite
// asserts exactly that with a message full of things that must not travel.
//
// See system/lan.js for the transport, which is multicast with a TTL of 1 -
// packets a router will not forward. Between the two files, "this cannot reach
// the internet" is a property of the code rather than a promise in a README.

const { PETS, SKINS, WEAR, cleanName } = require('./settings');

// Bumped when the shape below changes incompatibly. A peer running a different
// version is ignored rather than half-understood: this is a toy, and a toy that
// guesses at a message it does not know is a toy with a parser bug.
const PROTOCOL = 1;

// Every verb two pets can say to each other. Adding one is a deliberate edit to
// this array and to the table in the renderer that draws it - which is the
// point. A vocabulary that can be extended at runtime is a free-text field
// wearing a costume.
const ACTS = [
  'wave',    // hello, from across the desk
  'bounce',  // delighted you are there
  'dance',   // the main event
  'cheer',   // applauding yours
  'hug',     // the two of them meet in the middle
  'spin',    // showing off
  'nap',     // sitting together doing nothing, which is also an activity
  'snack',   // sharing food
  'sing',    // one starts, the other joins
  'party',   // confetti, for the first time two pets ever meet
];

// The five words mood() can return. Repeated rather than imported so that a
// mood added to pet-state.js does not silently widen what goes on the wire; the
// test suite fails if the two lists drift apart, which is the moment to decide
// whether the new one should travel.
const MOODS = ['sleepy', 'hungry', 'sad', 'happy', 'neutral'];

// What kinds of message exist. 'hi' is a pet card and doubles as the heartbeat,
// 'bye' is going away, 'do' is one verb.
const TYPES = ['hi', 'bye', 'do'];

// An install's own id. Random, local, and not derived from anything about the
// machine - not the hostname, not a MAC address, not the user's name. It exists
// to tell two pets apart on one network and to remember which ones you have met,
// and it is the only stable thing about you that a peer ever sees.
const ID = /^[0-9a-f]{8}$/;

const newId = (rand = Math.random) =>
  Array.from({ length: 8 }, () => Math.floor(rand() * 16).toString(16)).join('');

// Small on purpose. Everything legal here fits in about 130 bytes; the cap is
// what stops a peer handing us a megabyte of JSON to parse. Checked on the
// encoded string, because that is the thing that actually travels.
const MAX_BYTES = 400;

const oneOf = (list) => (v) => (typeof v === 'string' && list.includes(v) ? v : null);

const percent = (v) => {
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
};

// Every field that may cross, and the only way each one may look. There is
// deliberately no `text`, no `note`, no `extra` and no `data`.
const FIELDS = {
  v: (v) => (v === PROTOCOL ? v : null),
  id: (v) => (typeof v === 'string' && ID.test(v) ? v : null),
  t: oneOf(TYPES),
  pet: oneOf(PETS),
  skin: oneOf(SKINS),
  wear: oneOf(WEAR),
  // The one string a person chose. It goes through the same cleaner the pet's
  // own name does - letters, marks, digits, spaces, apostrophes, hyphens and
  // full stops, 24 of them at most, no line breaks - so a "name" cannot be a
  // paragraph, and cannot be a second line in a prompt at the far end either.
  // An empty result is a pet that has not been named, which is allowed.
  name: (v) => (typeof v === 'string' ? cleanName(v) : null),
  mood: oneOf(MOODS),
  act: oneOf(ACTS),
  bond: percent,
};

// What each type must carry beyond v/id/t. A 'hi' without a species is not a
// pet card, and a 'do' without a verb is not a request.
const REQUIRED = {
  hi: ['pet', 'skin', 'wear', 'mood', 'bond'],
  bye: [],
  do: ['act'],
};

/**
 * Rebuild a message from nothing but the allowlist.
 *
 * Used by both directions on purpose. Encoding through it means this process
 * cannot leak a field by accident; decoding through it means a peer cannot
 * introduce one. One function, so the two can never disagree about what is
 * legal.
 *
 * A field that is present but malformed rejects the whole message rather than
 * being dropped - a peer sending a bond of "all of it" has a bug or an agenda,
 * and neither is worth guessing about.
 *
 * @returns {object|null} a fresh object, or null if it is not a legal message
 */
function build(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, check] of Object.entries(FIELDS)) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    const clean = check(v);
    if (clean === null) return null;
    out[key] = clean;
  }
  if (out.v !== PROTOCOL || !out.id || !out.t) return null;
  const need = REQUIRED[out.t];
  if (!need || !need.every((k) => out[k] !== undefined)) return null;
  // A verb on a message that is not asking for one, or a pet card's fields on a
  // goodbye, are both signs of something assembling messages by hand. Refuse
  // rather than trim: the shapes above are the whole language.
  const allowed = new Set(['v', 'id', 't', ...need]);
  if (out.t === 'hi') allowed.add('name');
  return Object.keys(out).every((k) => allowed.has(k)) ? out : null;
}

/** A message to a string, or null if it is not one. Never throws. */
function encode(raw) {
  const msg = build(raw);
  if (!msg) return null;
  const text = JSON.stringify(msg);
  return Buffer.byteLength(text, 'utf8') <= MAX_BYTES ? text : null;
}

/** A string from the network to a message, or null. Never throws. */
function decode(buf) {
  if (buf == null) return null;
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return null;
  try {
    return build(JSON.parse(text));
  } catch {
    return null;
  }
}

/** This pet, as the far end will see it. The only place a card is assembled. */
function card(id, settings, state, mood) {
  return {
    v: PROTOCOL,
    id,
    t: 'hi',
    pet: settings.pet,
    skin: settings.skin,
    wear: settings.wear,
    name: settings.name,
    mood,
    bond: state.bond,
  };
}

/** One verb, addressed to nobody in particular - everyone on the wire hears it. */
const does = (id, act) => ({ v: PROTOCOL, id, t: 'do', act });

const leaves = (id) => ({ v: PROTOCOL, id, t: 'bye' });

// How far along the screen a pet that has never been put anywhere starts, as a
// fraction of the width.
//
// Zero for everyone was fine while there was one pet per screen. It stopped
// being fine the moment two could share one: two copies on one machine both
// start in the bottom-left corner, each draws the other's pet beside its own,
// and the result is four pets in two piles rather than two pets side by side.
//
// Derived from the install id, so it is stable across restarts - a pet that
// starts somewhere different every launch is a pet that has been moved. Kept to
// the left 60% so the pet and the friend beside it are both on screen, and it is
// not a saved position: the pet still roams the whole width until you put it
// somewhere by hand.
const START_MAX = 0.6;

function startX(id) {
  if (typeof id !== 'string' || !ID.test(id)) return 0;
  return (parseInt(id.slice(0, 4), 16) % (START_MAX * 1000 + 1)) / 1000;
}

// ---- who you have met -------------------------------------------------------
// Kept so the first time two pets ever meet can be a bigger deal than the
// hundredth. An id, when you first saw it, and how many times since. No log of
// when you were online together and nothing about the network it happened on.

const MAX_FRIENDS = 24;

/** Drop anything unexpected off disk, same rule as every other saved file. */
function friends(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!ID.test(id) || !v || typeof v !== 'object') continue;
    out[id] = {
      at: Number.isFinite(v.at) && v.at >= 0 ? v.at : 0,
      times: Number.isFinite(v.times) ? Math.max(1, Math.min(9999, Math.round(v.times))) : 1,
    };
    if (Object.keys(out).length >= MAX_FRIENDS) break;
  }
  return out;
}

/**
 * Record a meeting.
 *
 * @returns {{book: object, first: boolean}} the updated book, and whether this
 *   is the first time these two have ever met - which is the thing the confetti
 *   is for, and has to be answered once rather than every heartbeat.
 */
function meet(book, id, now) {
  const known = book[id];
  if (known) return { book: { ...book, [id]: { ...known, times: known.times + 1 } }, first: false };
  const next = { ...book, [id]: { at: now, times: 1 } };
  // Oldest out when the book is full. A cap rather than a growing file: this is
  // a nicety, not an address book, and 24 is already more pets than anyone has.
  const ids = Object.keys(next);
  if (ids.length > MAX_FRIENDS) {
    ids.sort((a, b) => next[a].at - next[b].at);
    delete next[ids[0]];
  }
  return { book: next, first: true };
}

module.exports = {
  PROTOCOL, ACTS, MOODS, TYPES, FIELDS, REQUIRED, MAX_BYTES, MAX_FRIENDS, ID,
  build, encode, decode, card, does, leaves, newId, friends, meet, startX, START_MAX,
};
