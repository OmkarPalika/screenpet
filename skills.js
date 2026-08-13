'use strict';

// What the pet can do on its own: no model, no network, no round trip. Matched
// before a message ever reaches Ollama, so "set a timer for five minutes" is
// instant and exact instead of a small model's best guess at what you meant.
//
// Pure, and deliberately so. The clock, the randomness and the battery all
// arrive through ctx, which is what makes every answer pinnable in a test.
//
// A skill returns any of:
//   say   - what the pet says now
//   move  - a body movement to play (see MOVES in the renderer)
//   timer - { ms, say } for main to fire later
//   expr  - a face, when the default for the kind is wrong

const HOUR = 3600000;

// Anything longer than this is a calendar, not a desktop pet.
const MAX_TIMER_MS = 24 * HOUR;

// Real questions are long and rambling; commands are short. A skill that fires
// on a paragraph is almost always a false positive, and the cost of being wrong
// here is high - it answers instead of the model, with total confidence.
const MAX_COMMAND_CHARS = 90;

const WORD_NUM = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
  fortyfive: 45, sixty: 60, half: 0.5,
};

const NUMBER = Object.keys(WORD_NUM).join('|');
const DURATION = new RegExp(
  `\\b(\\d+|half\\s+an?|${NUMBER})\\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\\b`,
  'i'
);

const UNIT_MS = { h: HOUR, m: 60000, s: 1000 };

/** "half an hour", "20 mins", "5s" -> milliseconds, or null. */
function duration(text) {
  const m = DURATION.exec(text);
  if (!m) return null;
  const word = m[1].toLowerCase().split(/\s+/)[0];
  const n = /^\d+$/.test(word) ? Number(word) : WORD_NUM[word];
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round(n * UNIT_MS[m[2][0].toLowerCase()]);
  return ms >= 1000 && ms <= MAX_TIMER_MS ? ms : null;
}

/**
 * Milliseconds back into something a pet would say. Rounding to the nearest
 * minute is wrong below two of them - 90 seconds read back as "2 minutes" is the
 * pet agreeing to something you did not ask for - so this decomposes instead.
 * Seconds are dropped once there are hours, because nobody says "1 hour 5
 * seconds".
 */
function spoken(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s && !h) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 seconds';
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

const SKILLS = [
  {
    name: 'timer',
    // Needs both a timing word and an actual duration. "how do I set a timer in
    // JavaScript" has the first and not the second, and falls through to the
    // model where it belongs.
    match: (t) => /\b(timer|alarm|remind me|wake me|nudge me|ping me)\b/i.test(t) && duration(t),
    run: (text, ctx) => {
      const ms = duration(text);
      // "remind me to stretch in 20 minutes" - everything between the verb and
      // the duration is what you actually wanted reminding about.
      const label = (/\b(?:remind|wake|nudge|ping) me (?:to|about) (.+?)(?:\s+in\b|\s*$)/i
        .exec(text) || [])[1];
      return {
        say: label
          ? `Okay! ${spoken(ms)} from now: ${label.trim()}`
          : `Timer set. I will shout in ${spoken(ms)}`,
        expr: 'proud',
        timer: {
          ms,
          say: label ? `time to ${label.trim()}!` : `that is ${spoken(ms)}. time is up!`,
        },
      };
    },
  },
  {
    name: 'time',
    // Anchored at the end on purpose: "what is the time complexity of quicksort"
    // begins with "what is the time" and is emphatically not a request for the
    // clock. Anything after the word has to be punctuation.
    match: (t) => /\b(?:what(?:'s| is) the time|what time is it|got the time)\s*[?!.]*$/i.test(t),
    run: (_t, ctx) => ({
      say: `It is ${ctx.now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
      expr: 'smile',
    }),
  },
  {
    name: 'date',
    match: (t) => /\b(?:what(?:'s| is) (?:the )?date|what day is it(?: today)?)\s*[?!.]*$/i.test(t),
    run: (_t, ctx) => ({
      say: `It is ${ctx.now.toLocaleDateString(undefined, {
        weekday: 'long', day: 'numeric', month: 'long',
      })}`,
      expr: 'smile',
    }),
  },
  {
    name: 'battery',
    match: (t) => /\bbattery\b|\bhow much charge\b|\bam i (?:plugged in|charging)\b/i.test(t),
    run: (_t, ctx) => {
      if (!ctx.battery) return { say: 'I cannot find a battery on this machine', expr: 'curious' };
      const { percent, charging } = ctx.battery;
      if (charging) return { say: `${percent}% and charging. we are fine`, expr: 'smile' };
      if (percent <= 15) return { say: `${percent}% left. plug in, please`, expr: 'oops' };
      return { say: `${percent}% left, no cable`, expr: 'smile' };
    },
  },
  {
    name: 'coin',
    match: (t) => /\bflip a coin\b|\bheads or tails\b|\btoss a coin\b/i.test(t),
    run: (_t, ctx) => ({
      say: `${pick(['Heads', 'Tails'], ctx.rand)}!`,
      move: 'spin',
      expr: 'grin',
    }),
  },
  {
    name: 'dice',
    match: (t) => /\broll (?:a |the )?(?:dice|die|d\d+)\b/i.test(t),
    run: (text, ctx) => {
      const sides = Number((/\bd(\d+)\b/i.exec(text) || [])[1]) || 6;
      const capped = Math.min(Math.max(sides, 2), 1000);
      return {
        say: `${1 + Math.floor(ctx.rand() * capped)}${capped === 6 ? '' : ` (d${capped})`}`,
        move: 'spin',
        expr: 'grin',
      };
    },
  },
  {
    name: 'rps',
    // Either the invitation, or a throw on its own. "I pick rock" counts; a
    // sentence that merely contains the word rock does not.
    match: (t) => /^(?:i (?:pick|choose|throw) )?(rock|paper|scissors)[!.]?$/i.test(t.trim())
      || /\brock,? paper,? scissors\b/i.test(t),
    run: (text, ctx) => {
      const yours = (/\b(rock|paper|scissors)\b/i.exec(text.trim()) || [])[1];
      const mine = pick(['rock', 'paper', 'scissors'], ctx.rand);
      if (!yours || /\brock,? paper,? scissors\b/i.test(text)) {
        return { say: 'Rock, paper, scissors! throw one and I will too', expr: 'grin' };
      }
      const you = yours.toLowerCase();
      if (you === mine) return { say: `${mine}! a draw. again?`, move: 'jump', expr: 'giggle' };
      const iWon = BEATS[mine] === you;
      return {
        say: iWon ? `${mine}. I win!` : `${mine}. you win, fine`,
        move: iWon ? 'dance' : 'topple',
        expr: iWon ? 'proud' : 'sulk',
      };
    },
  },
  {
    name: 'move',
    match: (t) => MOVE_WORDS.some(([, re]) => re.test(t)),
    run: (text, ctx) => {
      const [move] = MOVE_WORDS.find(([, re]) => re.test(text));
      return { move, say: pick(MOVE_LINES[move], ctx.rand), expr: MOVE_EXPR[move] };
    },
  },
  {
    name: 'weather',
    // Matched on purpose, and turned down on purpose. Every weather source is
    // somebody else's server, and it would want your location to be useful.
    // Saying so is a better answer than letting the model invent a forecast,
    // which is exactly what it does if this falls through.
    match: (t) => /\bweather\b|\bforecast\b|\bis it (?:going to )?rain/i.test(t),
    run: () => ({
      say: 'I cannot see outside! I would have to ask a stranger on the internet, '
        + 'and tell them where you are',
      expr: 'curious',
    }),
  },
];

// Movement commands. Order matters: the first pattern that matches wins, so the
// specific ones come before the general.
// The lookaheads are not decoration. "spin up a server", "jump to line 40" and
// "walk me through this" are all things you would type at a pet that reads your
// screen, and all three would otherwise make it dance instead of answer.
const MOVE_WORDS = [
  ['dance', /\b(dance|boogie|bust a move)\b/i],
  ['spin', /\b(spin(?!\s+up)|twirl)\b/i],
  ['jump', /\b(jump(?!\s+(?:to|into|in)\b)|hop|bounce)\b/i],
  ['topple', /\b(fall over|topple|play dead|roll over)\b/i],
  ['peek', /\b(look around|look about|have a look)\b/i],
  ['walk', /\b(walk(?!\s+(?:through|me\b))|move over|shoo)\b/i],
];

const MOVE_LINES = {
  dance: ['watch this', 'my best one', '*dances*'],
  spin: ['wheee', '*spins*', 'again?'],
  jump: ['hup', '*boing*', 'look how high'],
  topple: ['*flops over*', 'I am unwell', 'this is my final form'],
  peek: ['*looks around*', 'all clear', 'checking the corners'],
  walk: ['off I go', '*wanders*', 'I like it over here'],
};

const MOVE_EXPR = {
  dance: 'joy', spin: 'giggle', jump: 'grin',
  topple: 'dizzy', peek: 'curious', walk: 'smile',
};

/**
 * @param {string} text     what was typed or said
 * @param {object} ctx      { now, rand, battery }
 * @returns {object|null}   the skill's result, or null to let the model answer
 */
function match(text, ctx = {}) {
  const t = String(text || '').trim();
  if (!t || t.length > MAX_COMMAND_CHARS) return null;

  const full = {
    now: ctx.now instanceof Date ? ctx.now : new Date(ctx.now || 0),
    rand: typeof ctx.rand === 'function' ? ctx.rand : Math.random,
    battery: ctx.battery || null,
  };

  for (const skill of SKILLS) {
    if (skill.match(t)) return { name: skill.name, ...skill.run(t, full) };
  }
  return null;
}

module.exports = {
  match, duration, spoken,
  SKILLS, MOVE_WORDS, MOVE_LINES, MOVE_EXPR,
  MAX_TIMER_MS, MAX_COMMAND_CHARS,
};
