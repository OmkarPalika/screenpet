'use strict';

// All pet rules live here and nothing in this file touches Electron, the disk
// or the clock. `now` is always passed in, so the tests can fast-forward days.
//
// Every stat is 0..100 and higher is always better. Resist adding one that runs
// the other way (a "hunger" that counts up) - mixed directions is how these
// systems grow bugs.

const MAX_STAT = 100;
const HOUR = 3600000;

// Per hour of wall clock. Tuned so the pet wants attention roughly twice a day,
// not so often that it becomes a chore.
const DECAY = { fullness: 7, happiness: 5, energy: 6 };
const SLEEP_ENERGY_GAIN = 14;

// Come back after a holiday and the pet should be hungry, not dead. Decay stops
// counting past a day however long the app was closed.
const MAX_DECAY_HOURS = 24;

const NAG_INTERVAL_MS = 3 * HOUR;

// Unprompted small talk, separate from nagging and much rarer than it feels
// like it should be. Roughly a dozen lines a day is the ceiling before a pet
// stops being company and starts being a notification.
const CHATTER_INTERVAL_MS = 45 * 60000;

const ACTIONS = {
  feed: {
    cooldownMs: 60000,
    blocked: (s) => (s.fullness >= 92 ? 'too full' : null),
    effect: { fullness: +35, happiness: +4, bond: +2 },
  },
  pet: {
    cooldownMs: 15000,
    blocked: () => null,
    effect: { happiness: +12, bond: +3 },
  },
  play: {
    cooldownMs: 20000,
    blocked: (s) => (s.energy < 20 ? 'too tired' : null),
    effect: { happiness: +20, energy: -15, bond: +4 },
  },
  tickle: {
    cooldownMs: 8000,
    blocked: () => null,
    effect: { happiness: +8, energy: -3, bond: +2 },
  },
};

function fresh(now = 0) {
  return {
    fullness: 80,
    happiness: 80,
    energy: 90,
    bond: 0,
    updatedAt: now,
    lastNagAt: 0,
    lastChatAt: 0,
    lastAction: {},
  };
}

const clamp = (n) => Math.max(0, Math.min(MAX_STAT, n));

/** Drop anything unexpected from disk rather than trusting the file's shape. */
function load(raw, now) {
  const base = fresh(now);
  if (!raw || typeof raw !== 'object') return base;
  const num = (v, d) => (Number.isFinite(v) ? clamp(v) : d);
  return {
    fullness: num(raw.fullness, base.fullness),
    happiness: num(raw.happiness, base.happiness),
    energy: num(raw.energy, base.energy),
    bond: num(raw.bond, base.bond),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    lastNagAt: Number.isFinite(raw.lastNagAt) ? raw.lastNagAt : 0,
    lastChatAt: Number.isFinite(raw.lastChatAt) ? raw.lastChatAt : 0,
    lastAction: raw.lastAction && typeof raw.lastAction === 'object' ? raw.lastAction : {},
  };
}

/**
 * Advance to `now`. Pure, and driven entirely by elapsed time, so the result is
 * identical whether the app ran the whole time or was closed and reopened.
 */
function tick(state, now, { asleep = false } = {}) {
  const elapsed = now - state.updatedAt;
  if (!(elapsed > 0)) return { ...state, updatedAt: now };

  const hours = Math.min(elapsed / HOUR, MAX_DECAY_HOURS);
  return {
    ...state,
    fullness: clamp(state.fullness - DECAY.fullness * hours),
    happiness: clamp(state.happiness - DECAY.happiness * hours),
    energy: clamp(
      state.energy + (asleep ? SLEEP_ENERGY_GAIN : -DECAY.energy) * hours
    ),
    // bond never decays - it is the relationship, not a need
    updatedAt: now,
  };
}

/** @returns {{state: object, ok: boolean, reason: string|null}} */
function act(state, name, now) {
  const action = ACTIONS[name];
  if (!action) return { state, ok: false, reason: 'unknown action' };

  const last = state.lastAction[name] || 0;
  if (now - last < action.cooldownMs) return { state, ok: false, reason: 'not yet' };

  const blocked = action.blocked(state);
  if (blocked) return { state, ok: false, reason: blocked };

  const next = { ...state, lastAction: { ...state.lastAction, [name]: now } };
  for (const [stat, delta] of Object.entries(action.effect)) {
    next[stat] = clamp(next[stat] + delta);
  }
  return { state: next, ok: true, reason: null };
}

/** Derived, never stored - one source of truth for how the pet looks and sounds. */
function mood(state, { asleep = false } = {}) {
  if (asleep || state.energy < 20) return 'sleepy';
  if (state.fullness < 25) return 'hungry';
  if (state.happiness < 25) return 'sad';
  if (state.happiness > 75 && state.fullness > 60) return 'happy';
  return 'neutral';
}

/** Throttled hard: an unprompted pet that talks too often gets uninstalled. */
function shouldNag(state, now, opts) {
  const m = mood(state, opts);
  if (m !== 'hungry' && m !== 'sad') return false;
  return now - state.lastNagAt >= NAG_INTERVAL_MS;
}

/** Small talk, and only when the pet has nothing to complain about. */
function shouldChatter(state, now, opts) {
  const m = mood(state, opts);
  if (m === 'hungry' || m === 'sad' || m === 'sleepy') return false;
  return now - (state.lastChatAt || 0) >= CHATTER_INTERVAL_MS;
}

// Everything the pet says on its own. Keeping it here rather than in the
// renderer means one bank, no duplication between the window and the tray, and
// it stays assertable from a unit test.
const LINES = {
  hungry: ['getting a bit hungry', 'is it snack time?', 'tummy rumbling'],
  sad: ['could use some company', 'a bit bored over here', 'play with me?'],

  morning: ['morning. what are we working on?', 'coffee first, questions after', 'up early, are we?'],
  afternoon: ['afternoon. still going strong?', 'halfway there', 'need a hand with anything?'],
  evening: ['evening. good day?', 'winding down, or just getting started?', 'nice to see you'],
  night: ['still up? me too', 'the screen is very bright at this hour', 'one more question, then bed'],

  fed: ['mmm, thank you', 'that hit the spot', 'more later?'],
  full: ['could not eat another bite', 'genuinely stuffed', 'saving room, thanks'],
  patted: ['*happy wiggle*', 'again, please', 'best part of my day'],
  played: ['that was fun', 'again! again!', 'okay, one more round'],
  tired: ['too sleepy to play', 'my legs are made of jelly', 'nap first, play after'],
  tickled: ['hehe, stop', 'that tickles', 'no fair'],
  dragged: ['wheee', 'put me down gently', 'I liked it over there'],

  woke: ['oh, you are back', 'I was resting my eyes', 'hello again'],
  idle: [
    'poke me if you need an answer',
    'I am watching the screen, not judging it',
    'we could take a break, you know',
    'nice weather in here',
  ],
};

// What each species says instead, where it has an opinion. Deliberately partial:
// only the kinds a pet says often enough for its voice to register. Everything
// else falls through to the shared bank above, so adding a seventh species means
// writing the lines you actually have, not filling in a 15-cell grid.
const SPECIES_LINES = {
  blob: {
    idle: ['just vibing', 'I am a shape with opinions', 'nothing to report', 'the desktop is calm today'],
    fed: ['absorbed, thank you', 'blorp'],
    patted: ['*wobbles happily*', 'squish'],
    played: ['bounced well, I thought', 'more bouncing'],
  },
  cat: {
    idle: ['mrrp', 'I have selected this spot', 'watching a pixel', 'I could nap. I might nap.'],
    fed: ['acceptable', 'you may serve me again'],
    patted: ['*purrs*', 'you may continue'],
    played: ['I allowed that', 'chase it again'],
  },
  pup: {
    idle: ['is it walk time? no? okay', 'best desktop ever', 'I sat. did you see me sit?', 'waiting. very good at waiting.'],
    fed: ['gone. it is gone.', 'best food. every time.'],
    patted: ['*tail goes wild*', 'again again again'],
    played: ['that was the best thing', 'again? again.'],
  },
  bun: {
    idle: ['*nose twitch*', 'ears up, all clear', 'I have checked the corners', 'nothing is chasing us'],
    fed: ['*chomp chomp chomp*', 'greens next time?'],
    patted: ['ears down, that is the good spot', '*thump*'],
    played: ['I got very far very fast', 'binky'],
  },
  bird: {
    idle: ['*preens*', 'I have surveyed the desk', 'chirp', 'the window looks nice from here'],
    fed: ['*peck peck*', 'seeds would also work'],
    patted: ['*fluffs up*', 'careful, feathers'],
    played: ['flap flap flap', 'again, but higher'],
  },
  dragon: {
    idle: ['guarding your files', 'my hoard is this folder', 'small smoke, nothing serious', 'the desk is secure'],
    fed: ['barely a snack', 'acceptable tribute'],
    patted: ['*rumbles*', 'you have earned that'],
    played: ['I used only a little fire', 'again, mortal'],
  },
};

/** Index is passed in rather than random so the caller stays deterministic. */
function line(kind, index = 0, species = null) {
  const own = species && SPECIES_LINES[species] && SPECIES_LINES[species][kind];
  const lines = own || LINES[kind] || [];
  return lines.length ? lines[index % lines.length] : '';
}

/** Local hour in, greeting bank out. Pure, so it is testable at 3am. */
function greetKind(hour) {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

// A transient face laid on top of the mood. Mood is the long-run state; this is
// the reaction to something that just happened, and it clears itself.
const EXPRESSIONS = {
  feed: 'yum',
  pet: 'love',
  play: 'grin',
  tickle: 'giggle',
  drag: 'dizzy',
  refuse: 'sulk',
  answer: 'smile',
  think: 'hmm',
  chat: 'smile',
  greet: 'grin',
  wake: 'oh',
};

const expressionFor = (event) => EXPRESSIONS[event] || null;

// Bond is the only stat that never falls, so it is the only one that can carry
// a milestone worth saying out loud.
const BOND_TIERS = [
  { at: 25, line: 'I think we are getting along' },
  { at: 50, line: 'you are my favourite person on this desktop' },
  { at: 75, line: 'we make a good team' },
  { at: 100, line: 'best friends. official. no takebacks' },
];

/** The line for a tier crossed between two bond values, or null. */
function milestone(before, after) {
  const tier = BOND_TIERS.find((t) => before < t.at && after >= t.at);
  return tier ? tier.line : null;
}

module.exports = {
  fresh, load, tick, act, mood, shouldNag, shouldChatter,
  line, greetKind, expressionFor, milestone,
  ACTIONS, DECAY, SLEEP_ENERGY_GAIN, MAX_DECAY_HOURS, NAG_INTERVAL_MS, CHATTER_INTERVAL_MS,
  LINES, SPECIES_LINES, EXPRESSIONS, BOND_TIERS,
};
