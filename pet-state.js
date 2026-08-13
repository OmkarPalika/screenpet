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
};

function fresh(now = 0) {
  return {
    fullness: 80,
    happiness: 80,
    energy: 90,
    bond: 0,
    updatedAt: now,
    lastNagAt: 0,
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

const NAGS = {
  hungry: ['getting a bit hungry', 'is it snack time?', 'tummy rumbling'],
  sad: ['could use some company', 'a bit bored over here', 'play with me?'],
};

/** Index is passed in rather than random so the caller stays deterministic. */
function nagLine(m, index = 0) {
  const lines = NAGS[m] || [];
  return lines.length ? lines[index % lines.length] : '';
}

module.exports = {
  fresh, load, tick, act, mood, shouldNag, nagLine,
  ACTIONS, DECAY, SLEEP_ENERGY_GAIN, MAX_DECAY_HOURS, NAG_INTERVAL_MS,
};
