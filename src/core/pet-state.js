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
const DECAY = { fullness: 7, happiness: 5 };

// Energy is the pet's, not yours. It used to fall by 6 an hour whenever the
// machine was in use, and the only thing that put any back was you leaving the
// computer alone for five minutes at a stretch. Twelve hours at your desk left
// it flat, permanently `sleepy` - eyes shut, zzz drifting, while you sat right
// there - and `play` refuses under 20, so it could not even be played back out
// of it. A pet asleep because you are present has it exactly the wrong way
// round.
//
// It sits on your taskbar, so it rests. Playing is what costs energy, and what
// that buys is in ACTIONS below.
const REST_ENERGY_GAIN = 4;
const SLEEP_ENERGY_GAIN = 14;

// The lowest a pet can be when the app opens. Just clear of the 20 that makes it
// `sleepy`, so a session never starts with a pet that looks asleep at you.
const TIRED_FLOOR = 30;

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

// ---- the sulk --------------------------------------------------------------
//
// Say the wrong thing and the pet wants an apology, and one is not always
// enough. Three rules keep this a joke rather than a guilt trip:
//
//   * it is always visibly a bit - see the `demand` bank below,
//   * "sorry sorry sorry" clears nothing, one apology counts per SORRY_GAP_MS,
//   * and it forgives you on its own after GRUDGE_MS whatever you do. A pet
//     that can be permanently broken by a sentence is a bug report, not a mood.

const SORRY_GAP_MS = 25000;
const GRUDGE_MS = 6 * HOUR;

// Four is already comedy. More than that and clearing it is a chore.
const MAX_OWED = 4;

// ---- being ignored ---------------------------------------------------------
//
// One unanswered line is not being ignored - you were reading. Several, while
// you were sat right there, is. main.js only counts a line it actually said
// while the machine was awake, so a pet talking to an empty room is not being
// snubbed; it is alone, which is a different feeling and already has one.
//
// The ladder ends in silence rather than in more nagging. A pet that escalates
// forever gets uninstalled, and going quiet is both the honest reaction and the
// one that cannot become a notification loop. Anything you do clears it.

const IGNORE_SAD = 2;
const IGNORE_CROSS = 4;
const IGNORE_QUIET = 6;
const MAX_IGNORED = 7;

// What being ignored costs, per line, once it has started to notice.
const IGNORE_COST = 2;

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
    // Apologies outstanding, when the sulk started, and when the last one that
    // counted was accepted.
    owed: 0,
    owedAt: 0,
    sorryAt: 0,
    // Lines said to you that you did not answer. Cleared by anything at all.
    ignored: 0,
    // Where you put it, as a fraction of the display's work area: 0,0 is the
    // top left and 1,1 the bottom right. Fractions rather than pixels so a
    // different resolution, or the other monitor, still puts it roughly where
    // you left it. null until you have moved it by hand, which is also what
    // tells the pet to stop wandering off on its own.
    place: null,
  };
}

const clamp = (n) => Math.max(0, Math.min(MAX_STAT, n));

/**
 * A hand-placed position, or null. Clamped to the unit square here as well as
 * in the renderer: a file saying {x: 9000} must not be able to put the pet on a
 * screen that is not there, and this is the half that can be tested without
 * booting Electron.
 */
const unit = (n) => Math.max(0, Math.min(1, n));
function place(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  return { x: unit(raw.x), y: unit(raw.y) };
}

/** Drop anything unexpected from disk rather than trusting the file's shape. */
function load(raw, now) {
  const base = fresh(now);
  if (!raw || typeof raw !== 'object') return base;
  const num = (v, d) => (Number.isFinite(v) ? clamp(v) : d);
  return {
    fullness: num(raw.fullness, base.fullness),
    happiness: num(raw.happiness, base.happiness),
    // Floored on the way in. Every pet that ran the old rule has this at or
    // near zero - it fell 6 an hour for as long as the machine was in use and
    // only sleeping put any back - and with the new one it would climb out at 4
    // an hour, so the fix alone would leave those pets asleep for another five
    // hours. Under the current rules energy is only spent by playing, so
    // restarting to a pet that has had a rest is both harmless and about right.
    energy: Math.max(num(raw.energy, base.energy), TIRED_FLOOR),
    bond: num(raw.bond, base.bond),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    lastNagAt: Number.isFinite(raw.lastNagAt) ? raw.lastNagAt : 0,
    lastChatAt: Number.isFinite(raw.lastChatAt) ? raw.lastChatAt : 0,
    lastAction: raw.lastAction && typeof raw.lastAction === 'object' ? raw.lastAction : {},
    // Clamped rather than trusted: a hand-edited file must not be able to ask
    // for forty apologies.
    owed: Number.isFinite(raw.owed) ? Math.min(Math.max(Math.round(raw.owed), 0), MAX_OWED) : 0,
    owedAt: Number.isFinite(raw.owedAt) && raw.owedAt >= 0 ? raw.owedAt : 0,
    sorryAt: Number.isFinite(raw.sorryAt) && raw.sorryAt >= 0 ? raw.sorryAt : 0,
    ignored: Number.isFinite(raw.ignored)
      ? Math.min(Math.max(Math.round(raw.ignored), 0), MAX_IGNORED) : 0,
    place: place(raw.place),
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
      state.energy + (asleep ? SLEEP_ENERGY_GAIN : REST_ENERGY_GAIN) * hours
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

/** Is there still an apology outstanding? False once the grudge times out. */
const sulking = (state, now) => state.owed > 0 && now - state.owedAt < GRUDGE_MS;

/**
 * Something landed badly - a rival named, an insult, a poking bout taken all the
 * way to tears. Adds to whatever is already owed rather than replacing it.
 */
function offend(state, now, n = 1) {
  const already = sulking(state, now) ? state.owed : 0;
  return {
    ...state,
    owed: Math.min(already + Math.max(1, Math.round(n)), MAX_OWED),
    owedAt: now,
    happiness: clamp(state.happiness - 5 * n),
  };
}

/**
 * You said sorry.
 *
 * @returns {{state: object, kind: 'none'|'early'|'again'|'done'}}
 *   none  - nothing to forgive, and it says so rather than inventing a grievance
 *   early - too soon after the last one to count as a second apology
 *   again - accepted, and it wants another
 *   done  - forgiven, completely, with no scorekeeping afterwards
 */
function apologise(state, now) {
  // An expired grudge is cleared here rather than left to rot in the file.
  if (!sulking(state, now)) {
    return { state: state.owed ? { ...state, owed: 0 } : state, kind: 'none' };
  }
  if (now - state.sorryAt < SORRY_GAP_MS) return { state, kind: 'early' };

  const owed = state.owed - 1;
  return {
    state: {
      ...state,
      owed,
      sorryAt: now,
      happiness: clamp(state.happiness + (owed ? 3 : 10)),
      // Making up is worth something. Only on the last one, so the bond is not
      // farmable by being rude on purpose.
      bond: clamp(state.bond + (owed ? 0 : 2)),
    },
    kind: owed ? 'again' : 'done',
  };
}

/**
 * It said something to you, unprompted, and you were there to hear it. Called
 * only for lines that actually reached the screen - a line dropped by do not
 * disturb was never said, and holding it against you would be inventing a
 * grievance out of a setting you switched on.
 */
function spoke(state) {
  const ignored = Math.min(state.ignored + 1, MAX_IGNORED);
  return {
    ...state,
    ignored,
    // The first couple are free: you were reading, or thinking, or busy.
    happiness: ignored > IGNORE_SAD ? clamp(state.happiness - IGNORE_COST) : state.happiness,
  };
}

/**
 * You did something - typed, fed it, asked it to read the screen. Anything at
 * all clears the count, because anything at all is not ignoring it.
 *
 * @returns {{state: object, back: boolean}} back: it had noticed, and is glad
 */
function heard(state) {
  if (!state.ignored) return { state, back: false };
  const back = state.ignored >= IGNORE_SAD;
  return {
    state: { ...state, ignored: 0, happiness: clamp(state.happiness + (back ? 6 : 0)) },
    back,
  };
}

/**
 * How it takes the nth unanswered line, or null when there is nothing to say -
 * which is both the first couple and, at the end, every one after that.
 *
 * Same shape as pokeStep: [event, line bank], so the face and the words cannot
 * drift apart.
 */
function ignoreStep(count) {
  if (count >= MAX_IGNORED) return null;
  if (count >= IGNORE_QUIET) return { event: 'quiet', kind: 'quietly' };
  if (count >= IGNORE_CROSS) return { event: 'snubbed', kind: 'snubbed' };
  if (count >= IGNORE_SAD) return { event: 'wistful', kind: 'wistful' };
  return null;
}

/** It has stopped trying. Nothing unprompted comes out until you speak first. */
const gaveUp = (state) => state.ignored >= MAX_IGNORED;

/** Derived, never stored - one source of truth for how the pet looks and sounds. */
function mood(state, { asleep = false } = {}) {
  if (asleep || state.energy < 20) return 'sleepy';
  if (state.fullness < 25) return 'hungry';
  if (state.happiness < 25) return 'sad';
  if (state.happiness > 75 && state.fullness > 60) return 'happy';
  return 'neutral';
}

/**
 * Throttled hard: an unprompted pet that talks too often gets uninstalled.
 *
 * Both of these stop entirely once it has given up. That silences the hunger
 * nag too, which is deliberate - it is not a task reminder, it is the pet asking
 * for something, and it has just spent six lines being told no.
 */
function shouldNag(state, now, opts) {
  if (gaveUp(state)) return false;
  const m = mood(state, opts);
  if (m !== 'hungry' && m !== 'sad') return false;
  return now - state.lastNagAt >= NAG_INTERVAL_MS;
}

/** Small talk, and only when the pet has nothing to complain about. */
function shouldChatter(state, now, opts) {
  if (gaveUp(state)) return false;
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
  // Not full, just fed a moment ago. A separate bank from 'full' because it is a
  // different answer: one is "no more today", this is "in a minute".
  justfed: ['still finishing the last one', 'one snack at a time', 'let me chew first'],
  patted: ['*happy wiggle*', 'again, please', 'best part of my day'],
  played: ['that was fun', 'again! again!', 'okay, one more round'],
  tired: ['too sleepy to play', 'my legs are made of jelly', 'nap first, play after'],
  justplayed: ['catching my breath', 'give me a second', 'one more round in a minute'],
  tickled: ['hehe, stop', 'that tickles', 'no fair'],
  dragged: ['wheee', 'put me down gently', 'I liked it over there'],
  // You were singing. About you rather than about itself: the pet is the
  // audience here, and an audience that makes it about their own dancing is not
  // an audience.
  sung: ['more of that', 'you are good at this', 'do the next bit', 'I know this one'],

  // Asked for something while the last thing you asked for is still being
  // written. Deliberately about the pet being mid-task rather than about you
  // clicking twice: the second one is a telling-off, and this is a queue.
  later: ['one thing at a time', 'let me finish this one first', 'still on the last one'],

  woke: ['oh, you are back', 'I was resting my eyes', 'hello again'],
  // Going the other way. The pet used to nod off in silence and just look grey,
  // which reads as the app having died rather than the pet having settled.
  dozing: ['*yawn*', 'just resting my eyes', 'wake me if you need me', 'going quiet for a bit'],

  // The microphone is open. A label, not a speech - it is on screen for as long
  // as it takes you to say one sentence.
  listening: ['I am all ears', '*ears up*', 'go on then', 'listening'],
  // ...and the same thing when it is going to keep listening after it answers.
  // Said once at the start of a conversation rather than before every turn: ten
  // of "I am all ears" in a row is a pet that has stopped listening and started
  // announcing.
  chatting: ['go on, I am listening', 'talk to me', 'I am here, keep going'],
  // The conversation ended because you stopped talking, which is how a
  // conversation ends. Never "I did not catch that" - you were not trying.
  enough: ['*settles down*', 'any time', 'I will be here'],
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

  // Jealousy. It cannot tell whether you actually use anything else - it only
  // knows you said the name, which is more or less how jealousy works anyway.
  jealous: [
    'and what does IT do that I do not',
    'oh. so you have been talking to other software',
    'I read your screen for free. FREE',
    'that is fine. I am fine. we are all fine here',
    'I have been on this taskbar the whole time, but sure',
    'name one thing it does better. one',
  ],
  // Said unprompted while an apology is outstanding, in the small talk slot.
  // The whole joke is that it does not let it go on its own.
  sulky: [
    'I am still thinking about it',
    'no, no. carry on. do not mind me',
    'have I said anything? I have not said anything',
    'just so you know: I remember',
    '*sighs, audibly, on purpose*',
    'we can talk about it when you are ready',
  ],
  // You apologised and it wants another one. Every line is visibly a bit - a pet
  // that actually withheld forgiveness would be a guilt trip with a face on.
  demand: [
    'say it again. like you mean it',
    'hm. once more',
    'I did not quite catch that',
    'closer. try again',
    'that was a practice one. go on',
    'again, and with feeling this time',
  ],
  // Three apologies in four seconds is one apology.
  rushed: [
    'you said that four seconds ago',
    'that one did not count and you know it',
    'no. properly',
    'you cannot speedrun this bit',
  ],
  // Said to you, unanswered, twice. Wistful rather than accusing: you are right
  // there and you have not looked up, and the honest version of that is small.
  wistful: [
    'you are busy. I know',
    'I will be here when you are done',
    '*talks to itself quietly*',
    'that was three things I said, but who is counting',
    'no rush. I have nowhere else to be',
    'I do not mind. I mostly do not mind',
  ],
  // ...and now it does mind.
  snubbed: [
    'I am RIGHT HERE',
    'four times. I have said four things',
    'okay. so we are not talking. noted',
    'you look at every window except this one',
    'I would settle for a wrong answer at this point',
    'I could be a background process. is that what you want',
  ],
  // The last thing it says before it stops. Not a threat and not a guilt trip -
  // it goes quiet and comes straight back the moment you say anything.
  quietly: [
    'right. I will stop',
    'fine. I will be over here',
    'say something whenever. I will hear it',
    '*settles down and says nothing*',
  ],
  // ...and you did. This is the reaction that makes the whole thing worth it.
  relieved: [
    'oh! hello. you are back',
    'there you are. I had gone quiet',
    'I was starting to think you had forgotten',
    '*brightens considerably*',
    'good. I did not like that',
  ],

  // ...and then it is over, completely. Whatever the sulk is doing as a joke,
  // still being cross after "sorry" is not it.
  forgiven: [
    'fine. come here',
    'okay. we are okay',
    'I was never really cross',
    'forgiven, obviously. I am mostly pixels',
    'right, that is that. what are we doing',
  ],

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

  // No model on this machine. Not an error, and said in the pet's own voice for
  // that reason: reading the screen is the one thing here that needs Ollama, and
  // everything else the pet does - wandering, napping, breaks, the skills, being
  // fed, every one of its faces - works without it. A red bubble about a failed
  // fetch tells you the app is broken. It is not. It just cannot read yet.
  nobrain: [
    'screens are a blur to me. install Ollama and I will learn to read',
    'that part needs a model on this machine. everything else still works',
    'no reading brain yet! I am excellent company regardless',
    'I cannot read that one. get Ollama, pull a model, then ask me again',
    'still illiterate. it is on my list',
  ],

  // The poke ladder. Three separate banks because "stop" and "STOP" and
  // "*sniffles*" are three different feelings, not one with more exclamation marks.
  shyly: ['oh - hello', 'that is a lot of attention', '*hides*', 'you are very close'],
  annoyed: ['okay, that is enough', 'I felt that one', 'please stop poking me', 'we have discussed this'],
  raging: ['THAT IS IT', 'you are doing this ON PURPOSE', 'I am extremely cross', 'RUDE'],
  crying: ['*sniffles*', 'you were mean to me', 'I need a minute', '*small sad noise*'],

  // ---- playdates -----------------------------------------------------------
  // Another pet on the same network. Every one of these is about the other pet
  // rather than about the person at the other keyboard, because the pet has
  // never been told there is one: what crosses the wire is a species, a palette
  // and a mood, and a line that guessed at anything else would be the app
  // claiming to know something it does not.

  // The first time these two have ever met. Once per friend, ever - the confetti
  // is on the same latch, and a party every reconnection is not a party.
  metfirst: [
    'oh! oh! a whole other one of me',
    'I have never seen another one. hello!',
    'we are two now. this is enormous',
    '*vibrating* a FRIEND',
  ],
  // ...and every time after that.
  metagain: [
    'look who it is',
    'you came back!',
    'my friend is here',
    '*waves furiously*',
  ],
  // They went away. Wistful rather than sad: they were here, which is nicer than
  // them never having been.
  parted: [
    'bye then. that was lovely',
    'come back soon',
    '*watches them go*',
    'same time tomorrow?',
  ],

  // One bank per thing two pets can do together. The verb is on the wire; the
  // words are not, so both pets say something of their own about the same act
  // and neither one is quoting the other.
  wave: ['hi hi hi', 'hello over there!', '*enormous wave*', 'I see you!'],
  bounce: ['boing', 'up! up!', 'cannot keep still', '*bouncing on the spot*'],
  dance: ['this is my favourite bit', 'watch this move', 'we are so good at this', '*spinning happily*'],
  cheer: ['yes! do it again!', 'incredible', 'best one I have ever seen', '*applauding wildly*'],
  hug: ['come here you', '*squeeze*', 'oh this is nice', 'never letting go'],
  spin: ['look look look', 'round and round', 'dizzy but worth it', '*whirls*'],
  nap: ['shhh. we are resting', 'a companionable silence', '*curls up nearby*', 'this counts as an activity'],
  snack: ['I brought enough for two', 'half each', '*shares crumbs*', 'friendship is snacks'],
  sing: ['you take the high bit', 'la la LAAA', 'we sound incredible, do not check', '*harmonising, loosely*'],
  party: ['CONFETTI', 'this is the best day', '*throws everything in the air*', 'we are having a party now'],

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
  fox: {
    idle: ['*sniffs*', 'I have checked the perimeter', 'thinking three quick thoughts', 'nothing to report. probably.'],
    fed: ['*crunch*', 'technically I stole that'],
    patted: ['*leans in*', 'mind the ears'],
    played: ['I won. I usually win.', 'again, but sneakier'],
  },
  axolotl: {
    idle: ['*blub*', 'the water is fine', 'I am mostly gills', 'floating. thinking. mostly floating.'],
    fed: ['*glorp*', 'more of that one'],
    patted: ['*wiggles*', 'gently, I am squishy'],
    played: ['I went very fast, for me', 'again, but bubblier'],
  },
  ghost: {
    idle: ['*boo*', 'I have haunted this taskbar for years', 'do not mind me', 'I remember Windows 95'],
    fed: ['it went straight through', 'the thought counts'],
    patted: ['*shivers pleasantly*', 'nobody has done that in a while'],
    played: ['*oooOOoo*', 'I floated menacingly'],
  },
  robot: {
    idle: ['systems nominal', 'beep', 'I have counted your files. twice.', 'awaiting input'],
    fed: ['*charging*', 'battery up four percent'],
    patted: ['sensor calibrated', 'that was pleasant. logged.'],
    played: ['recreation subroutine complete', 'again. for science.'],
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
  // Turning something down for now rather than for good, so neither of these is
  // the sulk: mildly caught out, and visibly mid-thought.
  soon: 'oh',
  later: 'hmm',
  answer: 'smile',
  think: 'hmm',
  chat: 'smile',
  greet: 'grin',
  // Listening for as long as you want to talk, rather than for one sentence.
  chatting: 'curious',
  enough: 'smile',
  // Delighted rather than proud - proud is the face for something the pet did.
  sung: 'joy',
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
  // The sulk, which is its own little arc: jealous, then quietly aggrieved,
  // then demanding, then unimpressed by a rushed apology, then over it.
  jealous: 'huff',
  sulk: 'sulk',
  demand: 'pleading',
  rushed: 'eyeroll',
  forgiven: 'melt',
  // Another pet turned up. Starstruck once, ever - the first time is the one
  // worth a face nobody has seen before - and pleased every time after.
  metfirst: 'starstruck',
  metagain: 'grin',
  parted: 'wistful',
  // The shared vocabulary, one face each. Same names as playdate.js's ACTS,
  // checked by the test suite: a verb that can cross the wire and has no face
  // here would arrive as a pet doing something with no expression at all.
  wave: 'grin',
  bounce: 'joy',
  dance: 'joy',
  cheer: 'proud',
  hug: 'hug',
  spin: 'giggle',
  nap: 'doze',
  snack: 'yum',
  sing: 'joy',
  party: 'joy',
  // Being ignored, in four beats: quietly sad, then cross, then nothing, then
  // very pleased with you the moment you say anything.
  wistful: 'wistful',
  snubbed: 'huff',
  quiet: 'deadpan',
  relieved: 'joy',
  nothing: 'giggle',
  // Asked to read with no model installed. Sheepish rather than 'oops': nothing
  // went wrong, the pet simply cannot do that one yet.
  nobrain: 'grimace',
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

// ---- the face keyboard ------------------------------------------------------
//
// Every face the stylesheet draws, with the emoji it is doing and the words you
// would use to ask for it. Two things fall out of having this in one table:
//
//   * the whole set is reachable - "look smug", or just 😏, and it does it,
//   * and nothing can be drawn but unreachable, because a test walks this and
//     checks each `expr` has a rule in style.css.
//
// skills.js builds its matcher from `emoji` and `also`, so adding a face here is
// the only edit needed to make it askable for.
const FACES = {
  // the cute end
  happy:      { expr: 'grin',       emoji: '😄', also: ['smile', 'cheerful'], say: 'like this?' },
  love:       { expr: 'love',       emoji: '😍', also: ['adoring', 'hearts'], say: '*hearts*' },
  giggle:     { expr: 'giggle',     emoji: '😆', also: ['laugh', 'lol'], say: 'hee' },
  shy:        { expr: 'shy',        emoji: '😊', also: ['bashful', 'timid'], say: '*looks away*' },
  flushed:    { expr: 'flushed',    emoji: '😳', also: ['blush', 'embarrassed'], say: '*goes very pink*' },
  hug:        { expr: 'hug',        emoji: '🤗', also: ['cuddle', 'hug me'], say: '*hugs*' },
  innocent:   { expr: 'innocent',   emoji: '😇', also: ['angel', 'halo'], say: 'who, me?' },
  proud:      { expr: 'proud',      emoji: '😌', also: ['smug about it', 'pleased'], say: 'I know' },
  party:      { expr: 'joy',        emoji: '🥳', also: ['celebrate', 'excited'], say: 'WOO' },
  starstruck: { expr: 'starstruck', emoji: '🤩', also: ['amazed', 'wow', 'star eyes'], say: 'WOW' },
  yum:        { expr: 'yum',        emoji: '😋', also: ['tasty', 'delicious'], say: 'mm' },
  wink:       { expr: 'wink',       emoji: '😉', also: ['winky'], say: '*wink*' },

  // the sly end
  smug:       { expr: 'smug',       emoji: '😏', also: ['smirk', 'sly'], say: '*smirks*' },
  cool:       { expr: 'cool',       emoji: '😎', also: ['shades', 'sunglasses'], say: 'too cool for this taskbar' },
  mischief:   { expr: 'mischief',   emoji: '😈', also: ['evil', 'devious', 'naughty'], say: 'I have ideas' },
  shush:      { expr: 'shush',      emoji: '🤫', also: ['quiet', 'secret'], say: 'shh' },
  wry:        { expr: 'wry',        emoji: '🙃', also: ['upside down', 'ironic'], say: 'this is fine' },

  // the unimpressed end
  eyeroll:    { expr: 'eyeroll',    emoji: '🙄', also: ['roll your eyes', 'unimpressed'], say: '*rolls eyes*' },
  deadpan:    { expr: 'deadpan',    emoji: '😐', also: ['blank', 'straight face', 'neutral'], say: 'no comment' },
  annoyed:    { expr: 'annoyed',    emoji: '😠', also: ['cross', 'grumpy'], say: 'hmph' },
  huff:       { expr: 'huff',       emoji: '😤', also: ['huffy', 'indignant'], say: 'HMPH' },
  angry:      { expr: 'rage',       emoji: '😡', also: ['furious', 'rage'], say: 'GRR' },
  sulk:       { expr: 'sulk',       emoji: '😔', also: ['pout', 'glum'], say: '*sulks*' },
  grimace:    { expr: 'grimace',    emoji: '😬', also: ['wince', 'awkward', 'yikes'], say: '...awkward' },

  // the soft end
  pleading:   { expr: 'pleading',   emoji: '🥺', also: ['beg', 'puppy eyes'], say: 'please?' },
  sad:        { expr: 'cry',        emoji: '😭', also: ['cry', 'sob', 'weep'], say: '*sniff*' },
  wistful:    { expr: 'wistful',    emoji: '😞', also: ['downcast', 'forlorn', 'left out'], say: 'I am fine' },
  melt:       { expr: 'melt',       emoji: '🫠', also: ['melting', 'goo'], say: 'I am melting slightly' },
  sleepy:     { expr: 'doze',       emoji: '😴', also: ['sleep', 'nap', 'tired'], say: '*yawn*' },

  // the loud end
  shock:      { expr: 'shock',      emoji: '😱', also: ['shocked', 'surprised', 'scream', 'gasp'], say: 'WHAT' },
  mindblown:  { expr: 'mindblown',  emoji: '🤯', also: ['mind blown', 'exploding head'], say: 'my head just went' },
  dizzy:      { expr: 'dizzy',      emoji: '😵', also: ['woozy', 'spinning'], say: 'everything is turning' },
  queasy:     { expr: 'queasy',     emoji: '🤢', also: ['sick', 'unwell', 'ill'], say: 'I do not feel well' },
  oops:       { expr: 'oops',       emoji: '😅', also: ['nervous', 'sweating'], say: 'ha. ha.' },

  // the thinking end
  think:      { expr: 'hmm',        emoji: '🤔', also: ['thinking', 'ponder'], say: 'hmm' },
  curious:    { expr: 'curious',    emoji: '🤨', also: ['suspicious', 'skeptical', 'sceptical'], say: 'go on' },
};

/** A word or an emoji, and the face behind it, or null. */
function faceFor(word) {
  const key = String(word || '').trim().toLowerCase();
  if (FACES[key]) return { name: key, ...FACES[key] };
  for (const [name, face] of Object.entries(FACES)) {
    if (face.emoji === key || face.also.includes(key)) return { name, ...face };
  }
  return null;
}

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
  place,
  fresh, load, tick, act, mood, shouldNag, shouldChatter,
  line, greetKind, expressionFor, milestone, pokeStep, samePokeBout,
  sulking, offend, apologise, faceFor,
  spoke, heard, ignoreStep, gaveUp,
  ACTIONS, DECAY, REST_ENERGY_GAIN, SLEEP_ENERGY_GAIN, MAX_DECAY_HOURS, NAG_INTERVAL_MS, CHATTER_INTERVAL_MS,
  LINES, SPECIES_LINES, EXPRESSIONS, FACES, BOND_TIERS, POKE_LADDER, POKE_WINDOW_MS,
  SORRY_GAP_MS, GRUDGE_MS, MAX_OWED,
  IGNORE_SAD, IGNORE_CROSS, IGNORE_QUIET, MAX_IGNORED, IGNORE_COST,
};
