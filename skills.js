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
//   media - a media key for main to press (see KEYS in media.js)
//   photo - true to ask the renderer for one camera frame
//   weather - true if this needs the one networked feature, which main gates

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

// --- recurring alarms --------------------------------------------------------
//
// The language half only. What "every weekday at 9" means on a calendar - and
// what it means across a daylight saving boundary - is reminders.js's problem.

const DAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

const EVERY = /\b(?:every|each)\b|\bdaily\b/i;
const CLOCK = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

/**
 * "at 7", "at 9:30am", "at 6 pm" -> { hour, minute }.
 *
 * A bare number is read on a 24 hour clock rather than guessed at: "at 7" is
 * 07:00, and the pet says the time back so a wrong guess is visible immediately
 * rather than at seven in the evening.
 */
function clockOf(text) {
  const m = CLOCK.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  const half = (m[3] || '').toLowerCase();
  if (half === 'pm' && hour < 12) hour += 12;
  if (half === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** A repeat rule, or null if this is a one-off. */
function repeatOf(text) {
  if (!EVERY.test(text)) return null;
  const clock = clockOf(text);

  if (clock) {
    if (/\bweek\s?days?\b/i.test(text)) return { kind: 'weekdays', ...clock };
    for (const [name, day] of Object.entries(DAYS)) {
      if (new RegExp(`\\b(?:every|each)\\s+${name}s?\\b`, 'i').test(text)) {
        return { kind: 'weekly', day, ...clock };
      }
    }
    return { kind: 'daily', ...clock };
  }

  // "every 30 minutes". No clock time, so it is an interval from now.
  const ms = duration(text);
  return ms ? { kind: 'interval', ms } : null;
}

const DAY_NAMES = Object.keys(DAYS);
const two = (n) => String(n).padStart(2, '0');

/** How the pet reads a repeat rule back, which is also how you catch it being wrong. */
function spokenRepeat(repeat) {
  if (repeat.kind === 'interval') return `every ${spoken(repeat.ms)}`;
  const at = `${two(repeat.hour)}:${two(repeat.minute)}`;
  if (repeat.kind === 'daily') return `every day at ${at}`;
  if (repeat.kind === 'weekdays') return `every weekday at ${at}`;
  return `every ${DAY_NAMES[repeat.day]} at ${at}`;
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

const SKILLS = [
  {
    name: 'timer',
    // Needs both a timing word and an actual duration. "how do I set a timer in
    // JavaScript" has the first and not the second, and falls through to the
    // model where it belongs.
    match: (t) => /\b(timer|alarm|remind me|wake me|nudge me|ping me)\b/i.test(t)
      && (duration(t) || repeatOf(t)),
    run: (text) => {
      // A repeat rule wins over a bare duration: "every 30 minutes" contains
      // one, and it means something different from "in 30 minutes".
      const repeat = repeatOf(text);
      const ms = repeat ? null : duration(text);
      // "remind me to stretch in 20 minutes" - everything between the verb and
      // the timing is what you actually wanted reminding about.
      const label = (/\b(?:remind|wake|nudge|ping) me (?:to|about) (.+?)(?:\s+in\b|\s+(?:every|each)\b|\s+at\b|\s*$)/i
        .exec(text) || [])[1];
      const what = label && label.trim();
      const when = repeat ? spokenRepeat(repeat) : `${spoken(ms)} from now`;

      return {
        say: what
          ? `Okay! ${when}: ${what}`
          : `${repeat ? 'Alarm' : 'Timer'} set. I will shout ${repeat ? when : `in ${spoken(ms)}`}`,
        expr: 'proud',
        timer: {
          // One of the two, never both: ms is a stopwatch, repeat is a calendar.
          ...(repeat ? { repeat } : { ms }),
          say: what
            ? `time to ${what}!`
            : repeat ? 'that is the alarm!' : `that is ${spoken(ms)}. time is up!`,
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
    name: 'music',
    match: (t) => MEDIA_WORDS.some(([, re]) => re.test(t)),
    run: (text, ctx) => {
      const [key] = MEDIA_WORDS.find(([, re]) => re.test(text));
      return { media: key, say: pick(MEDIA_LINES[key], ctx.rand), expr: 'grin' };
    },
  },
  {
    name: 'photo',
    // The camera is off unless you turned it on, and main checks that before
    // asking for a frame - a skill cannot see the settings and must not pretend.
    match: (t) => PHOTO_WORDS.some((re) => re.test(t)),
    run: (_t, ctx) => ({
      say: pick(['Smile!', 'Say cheese!', 'Hold still…'], ctx.rand),
      expr: 'grin',
      photo: true,
    }),
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
    // skills.js cannot see the settings, so it returns the request and lets main
    // decide. With the setting off, main says the line below instead - which is
    // still the honest answer, and still better than letting the model invent a
    // forecast, which is exactly what it does if this falls through.
    run: () => ({
      say: 'I cannot see outside! I would have to ask a stranger on the internet, '
        + 'and tell them where you are',
      expr: 'curious',
      weather: true,
    }),
  },
];

// Music. The pet presses the keyboard's transport keys, so whatever is already
// playing obeys - and nothing comes back. It cannot see a track name, an artist
// or an app, which is why every line below is true whether or not anything was
// listening. First pattern wins, so the phrases come before the bare words.
//
// The bare forms are here because "next" typed at a pet that just started a song
// obviously means the song. The phrased forms are here because "skip the failing
// tests" must not.
//
// Anchored at the end for the same reason the clock is: "what does the next
// track index do" contains "next track" and is a question about code. A command
// ends after the command, give or take a politeness.
const TAIL = String.raw`\s*(?:a bit|a little|please|now|for me)*\s*[?!.]*$`;
const cmd = (body) => new RegExp(body + TAIL, 'i');

const MEDIA_WORDS = [
  ['next', cmd(String.raw`\b(?:next|skip)(?:\s+(?:this|the))?\s+(?:track|song|tune)`)],
  ['prev', cmd(String.raw`\b(?:previous|last|go back a)\s+(?:track|song|tune)`)],
  ['stop', cmd(String.raw`\bstop\s+(?:the\s+)?(?:music|song|playback|audio)`)],
  ['playpause', cmd(String.raw`\b(?:play|pause|resume|unpause)\s+(?:the\s+|my\s+)?(?:music|song|track|tune|audio|it)`)],
  ['mute', cmd(String.raw`\bmute\s+(?:the\s+)?(?:music|sound|audio|volume|speakers?)`)],
  ['volup', cmd(String.raw`\b(?:volume up|turn (?:it|the (?:volume|music|sound)) up|louder)`)],
  ['voldown', cmd(String.raw`\b(?:volume down|turn (?:it|the (?:volume|music|sound)) down|quieter)`)],
  ['next', /^(?:next|skip)[!.]*$/i],
  ['prev', /^(?:previous|back)[!.]*$/i],
  ['playpause', /^(?:play|pause|resume)[!.]*$/i],
];

// Anchored for the same reason: "take a photo of the receipt and email it" is a
// task you are describing, not one the pet is being given.
const PHOTO_WORDS = [
  cmd(String.raw`\btake (?:a |my |one )?(?:photo|picture|selfie|snap)(?: of (?:me|us))?`),
  cmd(String.raw`\b(?:say cheese|smile for the camera)`),
];

const MEDIA_LINES = {
  playpause: ['*taps play*', '*presses the button*', 'there'],
  next: ['*skips*', 'next one', 'not this one, then'],
  prev: ['*rewinds*', 'again then', 'back one'],
  stop: ['*stops the music*', 'quiet now'],
  volup: ['*turns it up*', 'louder!'],
  voldown: ['*turns it down*', 'shh'],
  mute: ['*mutes it*', 'silence'],
};

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
  match, duration, spoken, repeatOf, clockOf, spokenRepeat,
  SKILLS, MOVE_WORDS, MOVE_LINES, MOVE_EXPR, MEDIA_WORDS, MEDIA_LINES, PHOTO_WORDS,
  MAX_TIMER_MS, MAX_COMMAND_CHARS,
};
