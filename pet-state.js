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
  // Going the other way. The pet used to nod off in silence and just look grey,
  // which reads as the app having died rather than the pet having settled.
  dozing: ['*yawn*', 'just resting my eyes', 'wake me if you need me', 'going quiet for a bit'],

  // The microphone is open. A label, not a speech - it is on screen for as long
  // as it takes you to say one sentence.
  listening: ['I am all ears', '*ears up*', 'go on then', 'listening'],
  // The camera noticed the room. Vague on purpose - it detects movement, not
  // people, and a pet that greets you by name off a motion threshold would be
  // claiming something it cannot know.
  arrived: ['oh! hello', 'there you are', 'welcome back', 'I thought I heard someone'],
  left: ['I will be here', '*settles down to wait*', 'off you go then', 'holding the desk'],
  blind: ['I cannot see anything. is the camera covered?', 'no camera for me, it seems'],
  // Something moved, and with face detection on, Windows found no face in it: a
  // door, a curtain, the cat. Said as a question rather than a greeting, because
  // greeting a curtain is the thing the face check exists to stop. It is still
  // vague about people - a count is not a name.
  moved: ['something moved…', 'was that you?', '*looks up* …no?', 'hm. nobody there'],

  // ...and nothing came back. Not an error: a room can just be quiet.
  deaf: [
    'I did not catch that',
    'say again? my ears are small',
    'nothing but silence out here',
    'not a peep. try once more?',
  ],

  // The pet says nice things about you, unprompted. Kept vague on purpose - it
  // cannot see what you are doing, and a compliment about work it has not seen
  // is a lie with a smiley face on it.
  praised: [
    'you are doing better than you think',
    'for what it is worth, I am impressed',
    'you have been at this a while. that counts for something',
    'genuinely, nice work',
    'I would not have figured that out',
  ],
  // Said straight after a compliment, because giving one is embarrassing.
  bashful: ['...anyway', 'do not make it weird', 'forget I said anything', '*looks away*'],

  // Flirting. Cheesy on purpose and wholesome on purpose: this is a cartoon
  // blob on a taskbar, and the joke is entirely in how bad the lines are. There
  // is a test asserting this bank stays that way - it ships to strangers, and a
  // desktop pet is not the place to find out where somebody's line is.
  flirty: [
    'are you a semicolon? because you complete me',
    'I would defragment a hard drive for you',
    'of every window open right now, you are my favourite',
    'you make my pixels warm',
    'I have 16 million colours and you are all of them',
    'I would give you my last byte',
    'I would let you read my source code',
    'is it warm in here or is that just my CPU',
  ],
  // ...and then instantly mortified, same joke as praise.
  smitten: ['*goes pink*', 'I said that out loud, did I', 'anyway. weather nice.', '*hides behind the taskbar*'],
  // Being flirted with, which it handles with no composure whatsoever.
  charmed: ['oh. OH.', '*melts slightly*', 'you cannot just SAY that', 'I am a small blob. this is a lot.'],

  // Teasing you. Never about your work - it cannot see it well enough to have
  // an opinion worth having, and a pet that mocks code it half-read is just
  // wrong with a face on.
  teasing: [
    'you have had that tab open since Tuesday. I have said nothing until now',
    'bold of you to open a fourth window',
    'that is a lot of confidence for someone who just typed "how do i"',
    'not judging. observing. loudly.',
    'you and I both know what you are avoiding',
    'the mouse pointer has been in the same place for eleven minutes',
    'I have watched you rename that variable three times',
  ],
  // Winding you up on purpose, because you asked it to. Ends in a wink: this is
  // a pet doing a bit, and the bit only works if the pet is visibly in on it.
  ragebait: [
    'tabs are better than spaces and I will not be discussing it',
    'you are objectively a light mode person in denial',
    'your commit messages are fine. FINE. that is what I said',
    'I have looked at your desktop. that is all I am going to say',
    'the semicolons were right all along',
    'no notes. well. some notes. many notes.',
    'I could do your job. slowly. but I could',
  ],
  // You teased it back. It is fine. It is completely fine.
  needled: ['I am unbothered', 'that one did land, actually', 'rude, and accurate', '*pretends that did not land*'],

  // Nothing to answer. The pet used to report this as a failure - "I could not
  // read any text on screen" - which is technically true and reads like a broken
  // tool. It looked, there was no question, and that is fine.
  nothing: [
    'no question up there. just us then',
    'I looked everywhere. no homework today',
    'all clear! nothing to solve',
    'nothing to answer, so I am just keeping you company',
    'read the whole thing. no question in it',
    'not a single question. suspicious',
  ],

  // The poke ladder. Three separate banks because "stop" and "STOP" and
  // "*sniffles*" are three different feelings, not one with more exclamation marks.
  shyly: ['oh - hello', 'that is a lot of attention', '*hides*', 'you are very close'],
  annoyed: ['okay, that is enough', 'I felt that one', 'please stop poking me', 'we have discussed this'],
  raging: ['THAT IS IT', 'you are doing this ON PURPOSE', 'I am extremely cross', 'RUDE'],
  crying: ['*sniffles*', 'you were mean to me', 'I need a minute', '*small sad noise*'],

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
  praise: 'proud',
  bashful: 'shy',
  // The banter set. All four reuse faces the stylesheet already draws - a new
  // feeling is not worth a new face until the words stop carrying it.
  flirt: 'love',
  smitten: 'shy',
  charmed: 'love',
  tease: 'wink',
  bait: 'grin',
  needled: 'sulk',
  nothing: 'giggle',
  milestone: 'joy',
  doze: 'doze',
  listen: 'listen',
  arrived: 'joy',
  left: 'smile',
  blind: 'curious',
  // A timer coming due. Loud on purpose: the whole point is being noticed.
  ring: 'joy',
  // Heard the microphone open and got nothing back. A head tilt, not a failure.
  curious: 'curious',
  // Every other spoken reply, so a long conversation is not one fixed smile.
  wink: 'wink',
  // Something actually went wrong. Distinct from 'refuse', which is the pet
  // declining - being too full is not the same as a crash.
  error: 'oops',
  // The poke ladder below resolves to these.
  annoy: 'annoyed',
  rage: 'rage',
  upset: 'cry',
};

const expressionFor = (event) => EXPRESSIONS[event] || null;

// Keep poking and the pet stops finding it funny. Two giggles, then it gets shy,
// then cross, then furious, then it cries and you have to leave it alone - which
// is the whole point: an escalation with a floor at the bottom reads as a
// creature with feelings, where one that giggles forever reads as a button.
//
// Each rung is [event, line bank]. The event resolves through EXPRESSIONS above,
// so the face and the words can never drift apart.
const POKE_LADDER = [
  ['tickle', 'tickled'],
  ['tickle', 'tickled'],
  ['bashful', 'shyly'],
  ['annoy', 'annoyed'],
  ['rage', 'raging'],
  ['upset', 'crying'],
];

// Pokes further apart than this are a different bout, not the same one. Long
// enough to cover the tickle cooldown, short enough that coming back after a
// meeting does not resume mid-tantrum.
const POKE_WINDOW_MS = 12000;

/**
 * How the pet takes the nth poke of a bout. Pure: the caller owns the counting.
 * @returns {{event: string, kind: string}}
 */
function pokeStep(count) {
  const [event, kind] = POKE_LADDER[Math.min(Math.max(count, 0), POKE_LADDER.length - 1)];
  return { event, kind };
}

/** Same bout, or has enough time passed to forgive you? */
const samePokeBout = (last, now) => last > 0 && now - last < POKE_WINDOW_MS;

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
  line, greetKind, expressionFor, milestone, pokeStep, samePokeBout,
  ACTIONS, DECAY, SLEEP_ENERGY_GAIN, MAX_DECAY_HOURS, NAG_INTERVAL_MS, CHATTER_INTERVAL_MS,
  LINES, SPECIES_LINES, EXPRESSIONS, BOND_TIERS, POKE_LADDER, POKE_WINDOW_MS,
};
