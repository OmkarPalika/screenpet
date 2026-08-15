'use strict';

// Self-check for the logic that can break silently. Run: npm test
// No framework on purpose - if this file needs fixtures, the code got too clever.

const assert = require('assert');
const { redact, stripThinking, cleanOcr, buildPrompt, ask, EMPTY_SCREEN } = require('../src/core/brain');
const { toReadingOrder } = require('../src/system/ocr');
const pets = require('../src/core/pet-state');

const HOUR = 3600000;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.001, `${msg}: ${a} != ${b}`);

// ===== brain ===============================================================

// --- redact: the trust boundary. Nothing here may reach the model. ---
{
  const cases = [
    ['key sk-abcdefghijklmnop1234 here', 'sk-'],
    ['token ghp_ABCDEFGHIJKLMNOPQRST1234', 'ghp_'],
    ['AKIAIOSFODNN7EXAMPLE', 'AKIA'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NX0.dBjftJeZ4CVPmB92K27u', 'eyJ'],
    ['password: hunter2horse', 'hunter2'],
    ['api_key = zxcvbnmasdfghjkl', 'zxcvbnm'],
    ['card 4111 1111 1111 1111 on file', '4111'],
    ['d41d8cd98f00b204e9800998ecf8427e', 'd41d8'],
  ];
  for (const [input, leak] of cases) {
    const out = redact(input);
    assert.ok(out.includes('[REDACTED]'), `no redaction in: ${input}`);
    assert.ok(!out.includes(leak), `secret survived redaction: ${input} -> ${out}`);
  }
  const plain = 'What is 17 * 23 ? A) 391 B) 371 C) 411';
  assert.strictEqual(redact(plain), plain);
}

// ===== ocr: reading order ==================================================

// These boxes are what Windows OCR actually returned for a four-line code block
// (probed, not invented). The engine hands back the left of every row before the
// right of any of them, which is why the model was answering about code it had
// never been shown.
{
  const code = [
    { top: 271, bottom: 288, left: 151, text: 'const a' },
    { top: 311, bottom: 328, left: 151, text: 'const b' },
    { top: 351, bottom: 368, left: 151, text: 'const c' },
    { top: 390, bottom: 408, left: 151, text: 'if (ace]' },
    { top: 317, bottom: 324, left: 261, text: '= a.map(n n * 2)' },
    { top: 389, bottom: 413, left: 316, text: '3) { b. push(4); }' },
  ];
  assert.strictEqual(
    toReadingOrder(code),
    'const a\nconst b = a.map(n n * 2)\nconst c\nif (ace] 3) { b. push(4); }'
  );

  // Rows group by their own height, so a heading and body text each keep their
  // own scale instead of a pixel constant deciding for both.
  const mixedScale = [
    { top: 10, bottom: 60, left: 40, text: 'Heading' },
    { top: 20, bottom: 55, left: 300, text: 'continues' },
    { top: 80, bottom: 92, left: 40, text: 'small print' },
    { top: 96, bottom: 108, left: 40, text: 'second line' },
  ];
  assert.strictEqual(
    toReadingOrder(mixedScale),
    'Heading continues\nsmall print\nsecond line'
  );

  assert.strictEqual(toReadingOrder([]), '');
}

// --- unquote: the model narrating dialogue rather than speaking ---
{
  const { unquote } = require('../src/core/brain');
  assert.strictEqual(unquote('"Hey there!'), 'Hey there!');       // opened, never closed
  assert.strictEqual(unquote('"Hey there!"'), 'Hey there!');
  assert.strictEqual(unquote('  “Hello”  '), 'Hello');
  // Quotes that are part of the answer must survive untouched.
  assert.strictEqual(unquote('It prints "hello" twice.'), 'It prints "hello" twice.');
  assert.strictEqual(unquote('391.'), '391.');
  assert.strictEqual(unquote(''), '');
}

// --- stripMarkup: the bubble is a text node, so markdown arrives as clutter ---
{
  const { stripMarkup } = require('../src/core/brain');
  assert.strictEqual(stripMarkup('The answer is **391**'), 'The answer is 391');
  assert.strictEqual(stripMarkup('__really__ sure'), 'really sure');
  assert.strictEqual(stripMarkup('## Heading\nbody'), 'Heading\nbody');
  assert.strictEqual(stripMarkup('- one\n- two'), 'one\ntwo');

  // A lone asterisk is the pet doing something, not emphasis, and has to
  // survive - stripping it would turn "*pounces*" into "pounces".
  assert.strictEqual(stripMarkup('17 times 23 is... *pounces* ...391!'),
    '17 times 23 is... *pounces* ...391!');
  // Multiplication is not emphasis either.
  assert.strictEqual(stripMarkup('3 * 4 * 5 = 60'), '3 * 4 * 5 = 60');
}

// --- stripThinking ---
{
  assert.strictEqual(stripThinking('<think>hmm 17*23</think>The answer is 391.'), 'The answer is 391.');
  assert.strictEqual(stripThinking('<THINK>a</THINK> b'), 'b');
  assert.strictEqual(stripThinking('before<think>rambling forever'), 'before');
  assert.strictEqual(stripThinking('  plain answer  '), 'plain answer');
}

// --- stripEcho: models restate the question however firmly you tell them not to ---
{
  const { stripEcho } = require('../src/core/brain');
  assert.strictEqual(stripEcho('What is 17 x 23?\n\nThe answer is 391.'), 'The answer is 391.');
  assert.strictEqual(stripEcho('Is this a bug?'), 'Is this a bug?', 'ate a genuine question');
  assert.strictEqual(stripEcho('The answer is 391.'), 'The answer is 391.');
  // Multi-line answers that simply do not start with an echo are left alone.
  assert.strictEqual(stripEcho('First line.\nSecond line.'), 'First line.\nSecond line.');
  // A question followed by only whitespace is still the model asking something.
  assert.strictEqual(stripEcho('Which one?\n\n   '), 'Which one?\n\n   ');
}

// --- cleanOcr ---
{
  assert.strictEqual(cleanOcr('  a   b \n\n\n  c  '), 'a b\nc');
  assert.strictEqual(cleanOcr('   \n  \n '), '');
  assert.ok(cleanOcr('x'.repeat(9000)).length <= 4000, 'prompt not capped');
}

// --- buildPrompt: mood changes tone, never the task ---
{
  const p = buildPrompt('What is 2+2?');
  assert.ok(p.includes('What is 2+2?'));
  assert.ok(p.includes('--- SCREEN ---') && p.includes('--- END ---'));

  const hungry = buildPrompt('What is 2+2?', 'hungry');
  assert.ok(hungry.includes('hungry'), 'mood did not reach the prompt');
  assert.ok(
    hungry.includes('Answer correctly regardless of your mood'),
    'mood prompt lost its correctness guard'
  );
  // The pet must never be told it can decline. That rule is the whole design.
  for (const m of ['hungry', 'sleepy', 'sad', 'happy', 'neutral']) {
    assert.ok(buildPrompt('q?', m).includes('answer it'), `mood ${m} dropped the task`);
    assert.ok(!/refuse|do not answer|decline/i.test(buildPrompt('q?', m)), `mood ${m} can refuse`);
  }
}

// --- one voice, two paths ---
//
// The screen prompt and the chat prompt are written separately and drift apart
// the moment one of them is tuned, which is how you end up with a pet that talks
// like a person until you type at it. These are the rules that produced the
// current measured output; if one path loses one of them, it is drifting.
{
  const { buildChatPrompt } = require('../src/core/brain');
  for (const [name, p] of [['screen', buildPrompt('q?')], ['chat', buildChatPrompt('hi')]]) {
    assert.ok(/two short sentences/i.test(p), `${name} prompt lost its length cap`);
    assert.ok(/contractions/i.test(p), `${name} prompt no longer asks for spoken English`);
    assert.ok(/no emoji, no asterisks/i.test(p), `${name} prompt allows emoji and roleplay again`);
    // The way out of a strained joke. Without it a small model reaches for one on
    // questions that do not have a joke in them.
    assert.ok(/one dry aside/i.test(p) && /(leave it out|skip it)/i.test(p),
      `${name} prompt caps the wit without allowing none`);
    assert.ok(!/flourish|affectionate/i.test(p), `${name} prompt is back to cooing`);
  }
}

// ===== pet state ===========================================================

// --- load: never trust the file on disk ---
{
  const now = 1000000;
  assert.deepStrictEqual(pets.load(null, now), pets.fresh(now));
  assert.deepStrictEqual(pets.load('garbage', now), pets.fresh(now));
  const clamped = pets.load({ fullness: 999, happiness: -50, energy: 'x', bond: 30 }, now);
  assert.strictEqual(clamped.fullness, 100);
  assert.strictEqual(clamped.happiness, 0);
  assert.strictEqual(clamped.energy, pets.fresh(now).energy, 'non-numeric did not fall back');
  assert.strictEqual(clamped.bond, 30);
}

// --- decay is a function of elapsed time, not of ticks ---
{
  const t0 = 0;
  const s = pets.fresh(t0);

  const once = pets.tick(s, t0 + 6 * HOUR);
  let many = s;
  for (let i = 1; i <= 6; i++) many = pets.tick(many, t0 + i * HOUR);
  near(once.fullness, many.fullness, 'six one-hour ticks differ from one six-hour tick');
  near(once.energy, many.energy, 'energy drifted across ticks');

  near(once.fullness, 80 - pets.DECAY.fullness * 6, 'wrong fullness decay');

  // Closed for a week: hungry, not dead.
  const week = pets.tick(s, t0 + 24 * 7 * HOUR);
  const capped = pets.tick(s, t0 + pets.MAX_DECAY_HOURS * HOUR);
  near(week.fullness, capped.fullness, 'decay was not capped');

  // Clock skew backwards must not rewind the pet.
  const back = pets.tick(pets.tick(s, t0 + HOUR), t0);
  near(back.fullness, pets.tick(s, t0 + HOUR).fullness, 'negative elapsed changed stats');

  // Bond is the relationship, not a need.
  const bonded = { ...pets.fresh(t0), bond: 40 };
  assert.strictEqual(pets.tick(bonded, t0 + 48 * HOUR).bond, 40, 'bond decayed');
}

// --- a pet that is awake is resting, not running a marathon ---
{
  const s = { ...pets.fresh(0), energy: 30 };
  const awake = pets.tick(s, 3 * HOUR, { asleep: false });
  const napped = pets.tick(s, 3 * HOUR, { asleep: true });
  assert.ok(napped.energy > s.energy, 'sleeping did not restore energy');
  // Sitting on your taskbar costs nothing. Being awake used to drain 6 an hour,
  // which meant a day at your desk left the pet flat and looking asleep while
  // you sat right there - and `play` refuses under 20, so it could not be
  // played back out of it either.
  assert.ok(awake.energy > s.energy, 'being present still tires the pet out');
  assert.ok(napped.energy > awake.energy, 'a nap is worth no more than sitting there');

  // The whole failure, as one case: a full day at the keyboard, never idle long
  // enough to nap.
  let day = pets.fresh(0);
  for (let h = 1; h <= 24; h++) day = pets.tick(day, h * HOUR, { asleep: false });
  assert.notStrictEqual(
    pets.mood(day, { asleep: false }), 'sleepy',
    'a day at your desk still leaves the pet asleep on its feet'
  );

  // Every pet already out there has energy at zero, put there by the old rule.
  // Left alone it would climb out at 4 an hour, so the fix on its own would mean
  // another five hours of a pet asleep on its feet.
  const drained = pets.load({ energy: 0 }, 0);
  assert.notStrictEqual(
    pets.mood(drained, { asleep: false }), 'sleepy',
    'a pet drained flat by the old rule is still asleep after the fix'
  );
  // Not a reset, though: a pet you have been playing with is still tired.
  assert.ok(pets.load({ energy: 95 }, 0).energy === 95, 'loading the pet topped it up');

  // ...and playing is what actually tires it, which is what the stat is for.
  let tired = { ...pets.fresh(0), energy: 40 };
  for (let i = 0; i < 3; i++) {
    tired = pets.act(tired, 'play', i * 60000 + 60000).state;
  }
  assert.ok(tired.energy < 40, 'playing with the pet no longer tires it');
}

// --- actions ---
{
  const t = 10 * HOUR;
  const s = { ...pets.fresh(t), fullness: 40, energy: 50, happiness: 40 };

  const fed = pets.act(s, 'feed', t);
  assert.ok(fed.ok);
  assert.strictEqual(fed.state.fullness, 75);
  assert.strictEqual(fed.state.bond, 2);

  // Cooldown stops spamming a stat to 100.
  const again = pets.act(fed.state, 'feed', t + 1000);
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.reason, 'not yet');
  assert.strictEqual(again.state, fed.state, 'refused action still mutated state');

  // A full pet declines food.
  const full = pets.act({ ...s, fullness: 95, lastAction: {} }, 'feed', t);
  assert.strictEqual(full.ok, false);
  assert.strictEqual(full.reason, 'too full');

  // A tired pet declines play.
  const tired = pets.act({ ...s, energy: 10 }, 'play', t);
  assert.strictEqual(tired.ok, false);
  assert.strictEqual(tired.reason, 'too tired');

  // Stats never leave 0..100.
  const maxed = pets.act({ ...pets.fresh(t), happiness: 96 }, 'pet', t);
  assert.strictEqual(maxed.state.happiness, 100);

  assert.strictEqual(pets.act(s, 'nonsense', t).ok, false);
}

// --- mood: derived, and priority order matters ---
{
  const base = pets.fresh(0);
  assert.strictEqual(pets.mood({ ...base, energy: 10 }), 'sleepy');
  assert.strictEqual(pets.mood(base, { asleep: true }), 'sleepy');
  // Starving and exhausted at once reads as sleepy: the lower need wins.
  assert.strictEqual(pets.mood({ ...base, energy: 10, fullness: 5 }), 'sleepy');
  assert.strictEqual(pets.mood({ ...base, fullness: 10 }), 'hungry');
  assert.strictEqual(pets.mood({ ...base, happiness: 10 }), 'sad');
  assert.strictEqual(pets.mood({ ...base, happiness: 90, fullness: 90 }), 'happy');
  assert.strictEqual(pets.mood({ ...base, happiness: 50, fullness: 50 }), 'neutral');
}

// --- nagging is throttled hard ---
{
  const hungry = { ...pets.fresh(0), fullness: 10, lastNagAt: 0 };
  const t = pets.NAG_INTERVAL_MS + 1;
  assert.strictEqual(pets.shouldNag(hungry, t), true);
  assert.strictEqual(pets.shouldNag({ ...hungry, lastNagAt: t - 1000 }, t), false);
  // A content pet never speaks unprompted.
  assert.strictEqual(pets.shouldNag(pets.fresh(0), t), false);
  assert.ok(pets.line('hungry', 0).length > 0);
  assert.strictEqual(pets.line('neutral', 0), '');
}

// --- small talk is rarer than nagging, and never on top of it ---
{
  const t = pets.CHATTER_INTERVAL_MS + 1;
  const content = pets.fresh(0);
  assert.strictEqual(pets.shouldChatter(content, t), true);
  assert.strictEqual(pets.shouldChatter({ ...content, lastChatAt: t - 1000 }, t), false);

  // A pet with something to complain about nags instead - one mouth, one queue.
  for (const s of [{ fullness: 10 }, { happiness: 10 }, { energy: 10 }]) {
    assert.strictEqual(pets.shouldChatter({ ...content, ...s }, t), false);
  }
  assert.strictEqual(pets.shouldChatter(content, t, { asleep: true }), false);
  assert.ok(pets.CHATTER_INTERVAL_MS < pets.NAG_INTERVAL_MS);

  // lastChatAt survives a round trip through a file that does not have it yet.
  assert.strictEqual(pets.load({ fullness: 50 }, 0).lastChatAt, 0);
  assert.strictEqual(pets.load({ lastChatAt: 42 }, 0).lastChatAt, 42);
}

// --- lines: indexed, not random, so the caller stays deterministic ---
{
  const bank = pets.LINES.idle;
  assert.strictEqual(pets.line('idle', 0), bank[0]);
  assert.strictEqual(pets.line('idle', bank.length), bank[0], 'index must wrap');
  assert.strictEqual(pets.line('nothing-like-this', 0), '');

  // Every bank main.js reaches for by name has to exist, or the pet goes mute
  // in exactly the situation the line was written for.
  for (const kind of [
    'hungry', 'sad', 'morning', 'afternoon', 'evening', 'night',
    'fed', 'full', 'patted', 'played', 'tired', 'tickled', 'dragged',
    'woke', 'idle',
  ]) {
    assert.ok(pets.line(kind, 0).length > 0, `no lines for ${kind}`);
  }
}

// --- species voices, with the shared bank underneath ---
{
  const cfg = require('../src/core/settings');

  for (const [species, bank] of Object.entries(pets.SPECIES_LINES)) {
    assert.ok(cfg.PETS.includes(species), `SPECIES_LINES has "${species}", which is not a pet`);
    for (const [kind, lines] of Object.entries(bank)) {
      // A species kind with no shared equivalent means a typo silently creates a
      // bank nothing ever reads from.
      assert.ok(pets.LINES[kind], `"${species}" writes lines for "${kind}", which is not a kind`);
      assert.ok(lines.length > 0, `"${species}" has an empty ${kind} bank`);
      for (const l of lines) assert.ok(l.trim().length > 0, `"${species}" has a blank ${kind} line`);
      assert.strictEqual(pets.line(kind, 0, species), lines[0]);
      assert.strictEqual(pets.line(kind, lines.length, species), lines[0], 'index must wrap');
    }
  }

  // Every pet has a voice; a species with no bank would silently be the blob.
  for (const pet of cfg.PETS) {
    assert.ok(pets.SPECIES_LINES[pet], `"${pet}" has no lines of its own`);
  }

  // Anything a species has no opinion about falls through to the shared bank.
  assert.strictEqual(pets.line('woke', 0, 'cat'), pets.LINES.woke[0]);
  assert.strictEqual(pets.line('idle', 0, 'griffin'), pets.LINES.idle[0], 'unknown species must fall back');
  assert.strictEqual(pets.line('idle', 0), pets.LINES.idle[0], 'no species must fall back');
  assert.notStrictEqual(pets.line('idle', 0, 'cat'), pets.line('idle', 0, 'dragon'));
}

// --- greetings cover the whole clock, with no gap at midnight ---
{
  const seen = new Set();
  for (let h = 0; h < 24; h++) {
    const kind = pets.greetKind(h);
    assert.ok(pets.line(kind, 0).length > 0, `hour ${h} greets with nothing`);
    seen.add(kind);
  }
  assert.deepStrictEqual([...seen].sort(), ['afternoon', 'evening', 'morning', 'night']);
  assert.strictEqual(pets.greetKind(0), 'night');
  assert.strictEqual(pets.greetKind(23), 'night');
}

// --- expressions are a closed set the stylesheet actually implements ---
{
  const css = require('fs').readFileSync('./src/renderer/style.css', 'utf8');
  for (const expr of new Set(Object.values(pets.EXPRESSIONS))) {
    assert.ok(
      css.includes(`[data-expr="${expr}"]`),
      `expression "${expr}" has no rule in style.css - the pet would just sit there`
    );
  }
  // Expression rules must come after the mood rules they override: same
  // specificity, so source order is the only thing making the reaction win.
  assert.ok(
    css.indexOf('[data-expr=') > css.lastIndexOf('[data-mood='),
    'mood rules sit below the expression rules and would win the cascade'
  );
  assert.strictEqual(pets.expressionFor('nothing-like-this'), null);

  // Every expression that drops emoji must name characters in the renderer, and
  // every set it names must belong to a real expression - a typo either way is
  // silent, and shows up as a feeling with no rain or rain with no feeling.
  const rjs = require('fs').readFileSync('./src/renderer/renderer.js', 'utf8');
  const emoji = rjs.slice(rjs.indexOf('const EMOJI'), rjs.indexOf('const rand'));
  const known = new Set(Object.values(pets.EXPRESSIONS));
  for (const feeling of ['love', 'shy', 'joy', 'rage', 'cry', 'annoyed', 'proud']) {
    assert.ok(new RegExp(`\\b${feeling}:`).test(emoji), `"${feeling}" drops no emoji`);
    assert.ok(known.has(feeling), `"${feeling}" has emoji but no event reaches it`);
  }
  // The cursor-tracking faces must stay quiet: hovering fires 'smile' constantly
  // and confetti on every mouse move is unbearable.
  for (const quiet of ['smile', 'hmm', 'oh']) {
    assert.ok(!new RegExp(`\\b${quiet}:`).test(emoji), `"${quiet}" rains, and it fires on hover`);
  }

  // Every feeling needs more than one way of showing up, or the same five hearts
  // on every headpat stop reading as a reaction and start reading as a spinner.
  // Rage and annoyance are exempt: being cross is not a mood with variations.
  for (const varied of ['love', 'shy', 'joy', 'proud', 'yum', 'giggle']) {
    const sets = (emoji.match(new RegExp(`\\b${varied}:\\s*\\[(.+?)\\],\\n`, 's')) || [])[1] || '';
    assert.ok(
      (sets.match(/\[/g) || []).length > 1,
      `"${varied}" always drops the same emoji`
    );
  }
  assert.ok(/🎉|🎊|🍾|🎆/.test(emoji), 'nothing ever celebrates');

  // Speaking out loud is a class, not an expression, and has to stay that way:
  // an expression would replace whatever face was already showing, and a raging
  // pet that goes blank the moment it opens its mouth is not raging.
  assert.ok(css.includes('.pet.is-talking'), 'nothing moves the mouth while the pet speaks');
  assert.ok(
    !Object.values(pets.EXPRESSIONS).includes('talking'),
    'speaking became an expression and now overwrites the face it should sit on'
  );

  // Two faces that must NOT rain, for the same reason smile does not: the
  // microphone is open for seconds at a time, and an error is not a party.
  for (const quiet of ['listen', 'oops']) {
    assert.ok(!new RegExp(`\\b${quiet}:`).test(emoji), `"${quiet}" rains, and it should not`);
  }

  // The bow belongs to the cute half of the range only.
  const bow = css.slice(css.indexOf('.pet[data-expr="love"] .bow'), css.indexOf('@keyframes bow-on'));
  for (const cute of ['love', 'shy', 'giggle', 'proud', 'joy', 'wink']) {
    assert.ok(bow.includes(`[data-expr="${cute}"] .bow`), `${cute} does not wear the bow`);
  }
  for (const notCute of ['rage', 'cry', 'annoyed', 'sulk', 'oops']) {
    assert.ok(!bow.includes(`[data-expr="${notCute}"] .bow`), `${notCute} should not wear a bow`);
  }
  assert.ok(
    require('fs').readFileSync('./src/renderer/pets.css', 'utf8').includes('.bow      { display: none; }'),
    'the bow is not hidden by default, so every pet wears one always'
  );
}

// ===== skills ==============================================================

// These run INSTEAD of the model, with total confidence and no way for the user
// to tell they did. So the false positives matter more than the matches: a
// pattern that fires on a real question replaces a correct answer with a dice
// roll, and nothing anywhere would report it.
{
  const skills = require('../src/core/skills');
  const at = (h, m) => new Date(2026, 7, 13, h, m);
  const fixed = (r) => () => r;
  const ctx = { now: at(14, 5), rand: fixed(0.5), battery: { percent: 42, charging: false } };
  const name = (t, c = ctx) => (skills.match(t, c) || {}).name || null;

  // --- what must NEVER be a skill ---
  for (const question of [
    'what is the time complexity of quicksort',
    'what is the date format used here',
    'how do I set a timer in JavaScript?',
    'spin up a server on port 3000',
    'jump to line 40 of this file',
    'walk me through this function',
    'explain how the timer in this code fires twice on mount',
    'why does my alarm clock app drift',
    'is this rock solid enough to ship',
    'what does the next track index do',
    'skip the failing tests for now',
    'why does play() throw here',
    'can you play devil\'s advocate',
    'go back a step and explain',
  ]) {
    assert.strictEqual(name(question), null, `a skill hijacked: ${question}`);
  }

  // A long message is a question, not a command, whatever words are in it.
  assert.strictEqual(name(`dance ${'x'.repeat(skills.MAX_COMMAND_CHARS)}`), null);

  // --- durations ---
  assert.strictEqual(skills.duration('in 5 minutes'), 300000);
  assert.strictEqual(skills.duration('half an hour'), 1800000);
  assert.strictEqual(skills.duration('for 90 seconds'), 90000);
  assert.strictEqual(skills.duration('twenty mins'), 1200000);
  assert.strictEqual(skills.duration('no numbers here'), null);
  assert.strictEqual(skills.duration('in 0 minutes'), null, 'a zero timer is not a timer');
  assert.strictEqual(skills.duration('in 500 hours'), null, 'a timer past a day is a calendar');

  // Reading a duration back must not round it into a different promise.
  assert.strictEqual(skills.spoken(90000), '1 minute 30 seconds');
  assert.strictEqual(skills.spoken(60000), '1 minute');
  assert.strictEqual(skills.spoken(5400000), '1 hour 30 minutes');
  assert.strictEqual(skills.spoken(1000), '1 second');

  // --- timers ---
  const timer = skills.match('remind me to stretch in 20 minutes', ctx);
  assert.strictEqual(timer.name, 'timer');
  assert.strictEqual(timer.timer.ms, 1200000);
  assert.ok(/stretch/.test(timer.timer.say), 'the reminder forgot what it was for');
  assert.ok(/20 minutes/.test(timer.say), `did not confirm the delay: ${timer.say}`);
  // A timing word with no duration is a question about timers, not a timer.
  assert.strictEqual(name('set a timer'), null);

  // --- the clock, anchored ---
  assert.strictEqual(name('what time is it'), 'time');
  assert.strictEqual(name('what time is it?'), 'time');
  assert.strictEqual(name('what day is it'), 'date');

  // --- battery, including having none ---
  assert.ok(/42%/.test(skills.match('how is my battery', ctx).say));
  assert.ok(/plug in/i.test(
    skills.match('battery?', { ...ctx, battery: { percent: 9, charging: false } }).say
  ));
  assert.ok(/cannot find/i.test(skills.match('battery?', { ...ctx, battery: null }).say));

  // --- rock, paper, scissors actually plays ---
  const throwOf = { rock: 0, paper: 0.4, scissors: 0.9 };
  for (const [mine, r] of Object.entries(throwOf)) {
    for (const yours of ['rock', 'paper', 'scissors']) {
      const out = skills.match(yours, { ...ctx, rand: fixed(r) });
      assert.strictEqual(out.name, 'rps');
      const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
      const expected = mine === yours ? 'draw' : (beats[mine] === yours ? 'pet' : 'you');
      const got = /a draw/.test(out.say) ? 'draw' : (/I win/.test(out.say) ? 'pet' : 'you');
      assert.strictEqual(got, expected, `${mine} vs ${yours} scored as ${got}`);
    }
  }

  // --- music presses a key, and only ever a key it knows ---
  const KEYS = require('../src/system/media').KEYS;
  for (const [key, re] of skills.MEDIA_WORDS) {
    assert.ok(KEYS[key], `music pattern maps to unknown key "${key}"`);
    assert.ok(skills.MEDIA_LINES[key], `music key "${key}" has nothing to say`);
    assert.ok(re.source.endsWith('$'), `music pattern for "${key}" is not anchored`);
  }
  // Every code is inside the range media.ps1 will actually press. The guard
  // there is the real one; this catches a typo before it becomes a thrown
  // PowerShell error in a speech bubble.
  for (const [key, code] of Object.entries(KEYS)) {
    assert.ok(code >= 0xad && code <= 0xb3, `${key} is outside the media key block`);
  }
  for (const [phrase, key] of Object.entries({
    'next track': 'next', 'skip the song': 'next', 'skip': 'next',
    'previous track': 'prev', 'back': 'prev',
    'pause the music': 'playpause', 'play it': 'playpause', 'resume': 'playpause',
    'stop the music': 'stop',
    'turn it up a bit': 'volup', 'louder': 'volup', 'volume up please': 'volup',
    'turn the volume down': 'voldown', 'quieter': 'voldown',
    'mute the sound': 'mute',
  })) {
    const out = skills.match(phrase, ctx);
    assert.strictEqual(out && out.name, 'music', `"${phrase}" did not reach the music skill`);
    assert.strictEqual(out.media, key, `"${phrase}" pressed ${out.media}`);
  }

  // --- a photo is asked for, never volunteered ---
  const photo = skills.match('take a photo', ctx);
  assert.strictEqual(photo.name, 'photo');
  assert.strictEqual(photo.photo, true);
  assert.strictEqual(name('take a photo of the receipt and email it'), null,
    'the photo skill fired on a sentence about photos');

  // --- weather is refused, not answered ---
  const weather = skills.match('what is the weather today', ctx);
  assert.strictEqual(weather.name, 'weather');
  assert.ok(!/\d/.test(weather.say), 'the weather skill invented a number');

  // --- every skill stays inside the vocabulary the renderer implements ---
  const rjs = require('fs').readFileSync('./src/renderer/renderer.js', 'utf8');
  const moves = (rjs.match(/const MOVE_MS = \{([^}]+)\}/) || [])[1] || '';
  // Both halves of the keyboard: the faces events reach for, and the ones you
  // can ask for by name. A movement may wear either - they are all drawn, and
  // the sheet-walking check further down is what proves that.
  const faces = new Set([
    ...Object.values(pets.EXPRESSIONS),
    ...Object.values(pets.FACES).map((f) => f.expr),
  ]);
  for (const [move] of skills.MOVE_WORDS) {
    assert.ok(new RegExp(`\\b${move}:`).test(moves), `move "${move}" has no animation`);
    assert.ok(skills.MOVE_LINES[move], `move "${move}" has nothing to say`);
    assert.ok(faces.has(skills.MOVE_EXPR[move]), `move "${move}" wears an unknown face`);
  }
  const css = require('fs').readFileSync('./src/renderer/style.css', 'utf8');
  for (const [move] of skills.MOVE_WORDS) {
    assert.ok(css.includes(`[data-move="${move}"]`), `move "${move}" has no rule in style.css`);
  }

  // Anything the pet does unprompted has to be a movement it actually has.
  for (const move of (rjs.match(/const IDLE_MOVES = \[([^\]]+)\]/) || ['', ''])[1]
    .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)) {
    assert.ok(new RegExp(`\\b${move}:`).test(moves), `the pet idles into "${move}", which it cannot do`);
  }

  // The words, in the order that matters. "roll over" used to be topple, which
  // is the trick and the collapse confused for each other.
  for (const [text, want] of [
    ['roll over', 'roll'],
    ['play dead', 'topple'],
    ['fall over', 'topple'],
    ['sit', 'sit'],
    ['sit down', 'sit'],
    ['good boy', 'sit'],
    ['stretch', 'stretch'],
    ['achoo', 'sneeze'],
    ['brrr', 'shiver'],
  ]) {
    const got = skills.match(text, ctx);
    assert.strictEqual(got && got.move, want, `"${text}" did not ${want}`);
  }
  // And the sentences that only look like commands. Each of these is something
  // you would type at a pet that reads your screen.
  for (const text of ['sit tight, this will take a minute', 'roll back the migration',
    'that is a stretch goal', 'we should revisit this']) {
    const got = skills.match(text, ctx);
    assert.ok(!got || !got.move, `"${text}" made the pet move`);
  }

  // A skill's face has to be one the stylesheet draws, or the pet answers
  // wearing nothing.
  for (const skill of skills.SKILLS) {
    const probe = {
      timer: 'set a timer for 5 minutes', time: 'what time is it', date: 'what day is it',
      battery: 'battery?', coin: 'flip a coin', dice: 'roll a dice', rps: 'rock',
      move: 'dance', weather: 'weather?', music: 'next track', photo: 'take a photo',
      remember: 'remember my standup is at 9:30', forget: 'forget the standup',
      memories: 'what do you remember?',
      flirt: 'flirt with me', charmed: 'I love you', tease: 'tease me',
      ragebait: 'roast me', needled: 'you are useless',
      lookup: 'look up the speed of light',
      jealous: 'chatgpt is better than you', sorry: 'sorry', face: 'look smug',
    }[skill.name];
    assert.ok(probe, `no probe for skill "${skill.name}"`);
    const out = skills.match(probe, ctx);
    assert.strictEqual(out && out.name, skill.name, `probe for "${skill.name}" hit ${out && out.name}`);
    // Either its own words, or a bank in pet-state.js that main resolves.
    assert.ok(out.say || out.bank, `skill "${skill.name}" said nothing`);
    if (out.bank) {
      assert.ok(pets.LINES[out.bank], `skill "${skill.name}" points at missing bank "${out.bank}"`);
      const face = pets.expressionFor(out.event);
      assert.ok(face, `skill "${skill.name}" has no expression for event "${out.event}"`);
      assert.ok(css.includes(`[data-expr="${face}"]`), `"${skill.name}" wears unknown face ${face}`);
      if (out.follow) {
        assert.ok(pets.LINES[out.follow.bank], `"${skill.name}" follows with a missing bank`);
        assert.ok(pets.expressionFor(out.follow.event), `"${skill.name}" follow has no expression`);
      }
    }
    if (out.expr) {
      assert.ok(css.includes(`[data-expr="${out.expr}"]`), `"${skill.name}" wears unknown face ${out.expr}`);
    }
  }

  // --- banter is asked for, never volunteered, and stays wholesome ----------
  //
  // This bank ships to strangers on a cartoon blob. A test rather than a note in
  // a comment, because "keep it PG" is the kind of intention that survives right
  // up until somebody adds one more line.
  {
    const banter = [
      'flirty', 'smitten', 'charmed', 'teasing', 'ragebait', 'needled',
      // The sulk banks ship to strangers too, and they are the ones with the
      // most obvious way to go wrong: a pet that guilt-trips is not the joke.
      'jealous', 'sulky', 'demand', 'rushed', 'forgiven',
      // Being ignored is the easiest of the lot to get wrong: a pet that guilts
      // you for not answering it is unusable, so these get the same check.
      'wistful', 'snubbed', 'quietly', 'relieved',
    ];
    const nope = /\b(?:sex\w*|nude|naked|kiss me|bed|hot(?:ties)?|body|kill|hate you|die|idiot|shut up)\b/i;
    for (const bank of banter) {
      assert.ok(pets.LINES[bank] && pets.LINES[bank].length >= 4, `bank "${bank}" is too thin`);
      for (const l of pets.LINES[bank]) {
        assert.ok(!nope.test(l), `banter line is not fit to ship: "${l}"`);
        assert.ok(l.length <= 90, `banter line is too long for a bubble: "${l}"`);
      }
    }

    // None of these may fire on ordinary conversation.
    for (const innocent of [
      'I love this bug', 'you are slow to load the model', 'roast the coffee beans',
      'how do I tease apart these two functions', 'she is cute in that photo',
    ]) {
      const hit = skills.match(innocent, ctx);
      assert.ok(
        !hit || !banter.includes(hit.bank),
        `"${innocent}" triggered banter (${hit && hit.name})`
      );
    }
  }
}

// ===== jealousy, the sulk and the face keyboard =============================

// --- the sulk is a state machine, and every corner of it matters ---
{
  const t0 = 1700000000000;
  const s = pets.fresh(t0);
  assert.strictEqual(pets.sulking(s, t0), false, 'a fresh pet is already cross with you');
  assert.strictEqual(pets.apologise(s, t0).kind, 'none', 'it accepted an apology it was never owed');

  const cross = pets.offend(s, t0, 2);
  assert.strictEqual(cross.owed, 2);
  assert.ok(cross.happiness < s.happiness, 'being offended cost it nothing');
  assert.ok(pets.sulking(cross, t0));

  // "sorry sorry sorry" is one apology. Without this the whole joke is a
  // three-word speedrun.
  const first = pets.apologise(cross, t0);
  assert.strictEqual(first.kind, 'again');
  assert.strictEqual(first.state.owed, 1);
  const spam = pets.apologise(first.state, t0 + 1000);
  assert.strictEqual(spam.kind, 'early', 'a second apology one second later counted');
  assert.strictEqual(spam.state.owed, 1, 'a rushed apology cleared one anyway');

  const done = pets.apologise(first.state, t0 + pets.SORRY_GAP_MS + 1);
  assert.strictEqual(done.kind, 'done');
  assert.strictEqual(done.state.owed, 0);
  assert.ok(done.state.bond > cross.bond, 'making up was worth nothing');
  assert.strictEqual(pets.sulking(done.state, t0 + pets.SORRY_GAP_MS + 1), false);
  // Forgiven means forgiven: no residue to be cross about next time.
  assert.strictEqual(pets.offend(done.state, t0 + pets.SORRY_GAP_MS + 2, 1).owed, 1);

  // It lets go on its own. A pet that can be permanently broken by one sentence
  // is a bug report, not a mood.
  const later = t0 + pets.GRUDGE_MS + 1;
  assert.strictEqual(pets.sulking(cross, later), false, 'the grudge never times out');
  assert.strictEqual(pets.apologise(cross, later).kind, 'none');
  assert.strictEqual(pets.apologise(cross, later).state.owed, 0, 'an expired grudge stayed in the file');

  // Offending it while it is already cross adds, up to a ceiling.
  let piled = cross;
  for (let i = 0; i < 10; i++) piled = pets.offend(piled, t0, 2);
  assert.strictEqual(piled.owed, pets.MAX_OWED, 'the sulk has no ceiling');
  assert.ok(pets.MAX_OWED <= 5, 'clearing the sulk is now a chore');

  // ...and a hand-edited pet.json cannot ask for forty apologies.
  assert.strictEqual(pets.load({ owed: 99 }, t0).owed, pets.MAX_OWED);
  assert.strictEqual(pets.load({ owed: -3 }, t0).owed, 0);
  assert.strictEqual(pets.load({ owed: 'lots' }, t0).owed, 0);
  assert.strictEqual(pets.load({ owedAt: -5 }, t0).owedAt, 0);
  assert.strictEqual(pets.load({}, t0).sorryAt, 0);
  assert.strictEqual(pets.load({ owed: 2, owedAt: t0 }, t0).owed, 2, 'a real sulk was dropped');

  // main has an answer for every outcome, so a new one cannot land silently.
  const main = require('fs').readFileSync('./src/main.js', 'utf8');
  const map = main.slice(main.indexOf('const APOLOGY = {'), main.indexOf('Skills answer before'));
  for (const kind of ['none', 'early', 'again', 'done']) {
    assert.ok(new RegExp(`\\b${kind}:`).test(map), `main has no answer for a "${kind}" apology`);
  }
  for (const event of ['jealous', 'sulk', 'demand', 'rushed', 'forgiven']) {
    assert.ok(pets.expressionFor(event), `"${event}" resolves to no expression`);
  }
  // The sulking line is said unprompted, so it has to come from the line bank
  // like everything else the pet says on its own.
  assert.ok(main.includes("talk('sulky'"), 'the pet never mentions that it is sulking');
}

// --- being ignored: sad, then cross, then quiet, then pleased ---
{
  const t0 = 1700000000000;
  const later = t0 + 9 * 3600000;
  const opts = { asleep: false };

  let s = pets.fresh(t0);
  assert.strictEqual(s.ignored, 0);
  assert.strictEqual(pets.gaveUp(s), false, 'a fresh pet has already given up on you');
  assert.strictEqual(pets.ignoreStep(0), null, 'it took the first unanswered line personally');
  assert.strictEqual(pets.ignoreStep(1), null, 'one unanswered line is not being ignored');

  // The ladder, one line at a time.
  const steps = [];
  for (let i = 0; i < pets.MAX_IGNORED + 2; i++) {
    const step = pets.ignoreStep(s.ignored);
    steps.push(step && step.kind);
    s = pets.spoke(s);
  }
  assert.deepStrictEqual(steps, [
    null, null, 'wistful', 'wistful', 'snubbed', 'snubbed', 'quietly', null, null,
  ], 'the ignored ladder does not go sad, cross, quiet, silent');

  // ...and then it stops. Not a threat: the whole point is that it cannot turn
  // into a nag loop, so BOTH unprompted channels close.
  assert.strictEqual(s.ignored, pets.MAX_IGNORED, 'the count has no ceiling');
  assert.ok(pets.gaveUp(s));
  assert.strictEqual(pets.shouldChatter(s, later, opts), false, 'it gave up and kept chatting');
  assert.strictEqual(pets.shouldNag({ ...s, fullness: 5 }, later, opts), false,
    'it gave up and kept nagging');
  // The same pet, with the count cleared, does still talk - so the assertions
  // above are about being ignored and not about some other thing being wrong.
  assert.strictEqual(pets.shouldChatter({ ...s, ignored: 0 }, later, opts), true);

  // Every step has words and a face, or it is a silent no-op on screen.
  for (const kind of ['wistful', 'snubbed', 'quietly', 'relieved']) {
    assert.ok(pets.line(kind, 0), `"${kind}" has no lines`);
  }
  for (const event of ['wistful', 'snubbed', 'quiet', 'relieved']) {
    assert.ok(pets.expressionFor(event), `"${event}" resolves to no expression`);
  }
  for (const step of [2, 4, 6].map(pets.ignoreStep)) {
    assert.ok(pets.line(step.kind, 0), `step "${step.kind}" says nothing`);
    assert.ok(pets.expressionFor(step.event), `step "${step.event}" has no face`);
  }

  // Being ignored costs something, but the first couple are free - you were
  // reading, or thinking, or busy.
  const fresh = pets.fresh(t0);
  assert.strictEqual(pets.spoke(fresh).happiness, fresh.happiness, 'the first line cost happiness');
  assert.ok(s.happiness < fresh.happiness, 'being ignored seven times cost nothing');

  // Anything at all clears it, and it is only pleased if it had noticed.
  const one = pets.spoke(fresh);
  assert.strictEqual(pets.heard(one).back, false, 'it made a scene over one unanswered line');
  assert.strictEqual(pets.heard(one).state.ignored, 0);
  const back = pets.heard(s);
  assert.strictEqual(back.back, true, 'it was ignored seven times and said nothing about it');
  assert.strictEqual(back.state.ignored, 0);
  assert.ok(back.state.happiness > s.happiness, 'coming back cheered it up not at all');
  assert.strictEqual(pets.gaveUp(back.state), false, 'it stayed silent after you came back');
  // Nothing to clear: the same object back, so a mouse move cannot churn state.
  assert.strictEqual(pets.heard(fresh).state, fresh);

  // A hand-edited file cannot make it permanently silent either.
  assert.strictEqual(pets.load({ ignored: 999 }, t0).ignored, pets.MAX_IGNORED);
  assert.strictEqual(pets.load({ ignored: -4 }, t0).ignored, 0);
  assert.strictEqual(pets.load({ ignored: 'lots' }, t0).ignored, 0);

  // --- the wiring, which the unit tests cannot reach ---
  const main = require('fs').readFileSync('./src/main.js', 'utf8');
  // A line dropped by do not disturb was never said, so talk() has to report
  // back rather than being assumed to have spoken.
  assert.ok(/return false;/.test(main.slice(main.indexOf('function talk('), main.indexOf('function attention('))),
    'talk() no longer says whether the line reached the screen');
  assert.ok(main.includes('if (said) state = pets.spoke(state)'),
    'nothing counts the lines you did not answer');
  // Every way of paying attention has to clear it, or the pet sulks at somebody
  // who is talking to it.
  for (const [where, near] of [
    ['replyTo', "noteEvent('chat');"], ['answerScreen', "noteEvent('ask');"],
  ]) {
    const at = main.indexOf(near);
    assert.ok(at > 0 && main.slice(at, at + 400).includes('attention()'),
      `${where} does not clear the ignored count`);
  }
  assert.ok(main.includes('const missed = attention();'), 'touching the pet does not clear it');
  assert.ok(main.includes("talk('relieved'"), 'the pet never reacts to you coming back');
}

// --- the face keyboard ---
{
  const css = require('fs').readFileSync('./src/renderer/style.css', 'utf8');
  const emoji = new Set();
  const words = new Set();

  for (const [name, face] of Object.entries(pets.FACES)) {
    // The whole reason the table exists: a face drawn in the stylesheet but
    // unreachable, or reachable and never drawn, are both silent.
    assert.ok(
      css.includes(`[data-expr="${face.expr}"]`),
      `face "${name}" wears "${face.expr}", which the stylesheet does not draw`
    );
    assert.ok(face.say && face.say.trim(), `face "${name}" says nothing`);
    assert.ok(face.say.length <= 60, `face "${name}" says too much for a bubble`);

    assert.ok(!emoji.has(face.emoji), `two faces claim ${face.emoji}`);
    emoji.add(face.emoji);
    assert.strictEqual(pets.faceFor(face.emoji).name, name, `${face.emoji} does not resolve`);

    for (const word of [name, ...face.also]) {
      assert.ok(!words.has(word), `"${word}" names two different faces`);
      words.add(word);
      const found = pets.faceFor(word);
      assert.ok(found && found.name === name, `"${word}" does not resolve to ${name}`);
    }
  }

  assert.strictEqual(pets.faceFor('not a feeling'), null);
  assert.strictEqual(pets.faceFor(''), null);
  assert.strictEqual(pets.faceFor(null), null);
  assert.strictEqual(pets.faceFor('SMUG').name, 'smug', 'the keyboard is case sensitive');
  assert.ok(Object.keys(pets.FACES).length >= 30, 'this is not much of a keyboard');

  // Every drawn face has to be reachable somehow: through an event the pet
  // arrives at on its own, or through the keyboard. One that is neither is a
  // block of CSS nobody will ever see.
  const reachable = new Set([
    ...Object.values(pets.EXPRESSIONS),
    ...Object.values(pets.FACES).map((f) => f.expr),
  ]);
  for (const [, expr] of css.matchAll(/\.pet\[data-expr="([a-z]+)"\]/g)) {
    assert.ok(reachable.has(expr), `the stylesheet draws "${expr}" and nothing can reach it`);
  }
}

// --- asking for a face, and not getting one by accident ---
{
  const skills = require('../src/core/skills');
  const ctx = { now: new Date(0), rand: () => 0.5, battery: null };
  const hit = (t) => skills.match(t, ctx);
  const face = (t) => { const o = hit(t); return o && o.name === 'face' ? o.expr : null; };

  assert.strictEqual(face('look smug'), 'smug');
  assert.strictEqual(face('be shocked'), 'shock');
  assert.strictEqual(face('make a surprised face'), 'shock');
  assert.strictEqual(face('act cool'), 'cool');
  assert.strictEqual(face('give me puppy eyes'), 'pleading');
  assert.strictEqual(face('do your best evil face'), null, 'the matcher took a word it does not know');
  assert.strictEqual(face('be evil'), 'mischief');

  // The emoji is the point of calling it a keyboard.
  assert.strictEqual(face('😎'), 'cool');
  assert.strictEqual(face('🥺🥺🥺'), 'pleading');
  assert.strictEqual(face('🤯!!'), 'mindblown');

  // No name: it picks one, and it is always a real one.
  const any = hit('make a face');
  assert.strictEqual(any.name, 'face');
  assert.ok(pets.faceFor(any.face), 'the random face is not on the keyboard');
  assert.ok(any.say, 'the random face says nothing');

  // An emoji or a face word inside a sentence is somebody talking.
  for (const innocent of [
    'that is cool', 'this looks cool', 'I sent them a 😎 about it',
    'how do I make a face detector', 'the tests are sad',
  ]) {
    const out = hit(innocent);
    assert.ok(!out || out.name !== 'face', `"${innocent}" pulled a face (${out && out.expr})`);
  }
}

// --- jealousy, and apologising for it ---
{
  const skills = require('../src/core/skills');
  const ctx = { now: new Date(0), rand: () => 0, battery: null };
  const hit = (t) => skills.match(t, ctx);

  const named = hit('chatgpt could do this faster');
  assert.strictEqual(named.name, 'jealous');
  assert.strictEqual(named.bank, 'jealous');
  assert.strictEqual(named.offend, 1);

  assert.strictEqual(hit('I like siri more than you').offend, 2,
    'being compared stung no more than being mentioned');
  assert.strictEqual(hit('you are useless').offend, 1, 'an insult costs nothing');
  // A compliment routed through a rival is still a compliment.
  assert.strictEqual(hit('I like you more than chatgpt').name, 'charmed');

  for (const apology of [
    'sorry', 'Sorry!', "I'm sorry", 'im so sorry', 'sorry sorry sorry',
    'sorry about that', 'I apologise', 'my bad', 'forgive me',
    'I did not mean it', "i didn't mean that",
  ]) {
    const out = hit(apology);
    assert.ok(out && out.name === 'sorry', `"${apology}" was not taken as an apology`);
    assert.strictEqual(out.apology, true);
  }

  // An apology on the front of a real message is a politeness, and eating it
  // would cost the user their actual question.
  for (const question of [
    'sorry, what does this error mean?',
    'sorry to bother you but how do I exit vim',
    'my bad code keeps crashing',
    'I am sorry to say the build is broken again',
  ]) {
    const out = hit(question);
    assert.ok(!out || out.name !== 'sorry', `"${question}" was eaten by the sulk`);
  }
}

// ===== voice ===============================================================

// The whole feature turns on one claim: neither direction of speech leaves the
// machine. These are the two ways it could stop being true.
{
  const fs = require('fs');
  const rjs = fs.readFileSync('./src/renderer/renderer.js', 'utf8');

  // Chromium's SpeechRecognition posts audio to a Google endpoint. It is the
  // obvious way to add dictation to an Electron app and it is the one thing
  // this app may never do - hence a test rather than a comment.
  for (const src of ['./src/renderer/renderer.js', './src/main.js', './src/system/speech.js', './src/preload.js']) {
    assert.ok(
      !/SpeechRecognition|SpeechGrammarList/.test(fs.readFileSync(src, 'utf8')),
      `${src} uses the Web Speech recogniser, which uploads the audio`
    );
  }
  // Listening is Windows' own on-device recogniser, driven the same way as OCR.
  const ps1 = fs.readFileSync('./src/system/listen.ps1', 'utf8');
  assert.ok(ps1.includes('System.Speech'), 'listen.ps1 does not use the on-device recogniser');
  assert.ok(ps1.includes('DictationGrammar'), 'listen.ps1 recognises nothing you could say');

  // Speaking picks from local voices only. Some platforms list network-rendered
  // voices alongside the installed ones and they are indistinguishable but for
  // this flag.
  assert.ok(rjs.includes('localService'), 'the pet would speak through any voice, network ones included');

  // Every new face has to be reachable and have something to say behind it.
  for (const kind of ['dozing', 'listening', 'deaf']) {
    assert.ok(pets.line(kind, 0), `"${kind}" has no lines`);
  }
  for (const event of ['doze', 'listen', 'curious', 'wink', 'error']) {
    assert.ok(pets.expressionFor(event), `"${event}" resolves to no expression`);
  }
  // An error is not the pet turning you down - those are different faces on
  // purpose, and collapsing them loses the distinction.
  assert.notStrictEqual(pets.expressionFor('error'), pets.expressionFor('refuse'));
}

// --- the poke ladder ---
{
  // Keep poking and the pet works through the whole range rather than giggling
  // forever. The last rung has to hold: there is nothing past crying.
  const seen = [0, 1, 2, 3, 4, 5, 6, 99].map((n) => pets.pokeStep(n).event);
  assert.deepStrictEqual(
    seen,
    ['tickle', 'tickle', 'bashful', 'annoy', 'rage', 'upset', 'upset', 'upset']
  );

  // Every rung names a real line bank and a real expression, or the pet reaches
  // that step and says nothing with a blank face.
  for (const [event, kind] of pets.POKE_LADDER) {
    assert.ok(pets.expressionFor(event), `poke step "${event}" has no expression`);
    assert.ok(pets.line(kind, 0), `poke step "${kind}" has no lines`);
  }

  // Bouts. Come back later and you are forgiven; keep going and you are not.
  assert.strictEqual(pets.samePokeBout(0, 5000), false, 'a first poke is not a continuation');
  assert.strictEqual(pets.samePokeBout(1000, 1000 + pets.POKE_WINDOW_MS - 1), true);
  assert.strictEqual(pets.samePokeBout(1000, 1000 + pets.POKE_WINDOW_MS), false);
}

// --- the demo stage draws the same pet the app does ---
{
  const fs = require('fs');
  const app = fs.readFileSync('./src/renderer/index.html', 'utf8');
  const stage = fs.readFileSync('./demo/stage.html', 'utf8');
  // Two copies of the SVG is the price of the demo rendering a page behind the
  // pet. Cheap to keep honest, and a drifted demo is a demo of the wrong app.
  for (const part of ['gaze', 'eyes-love', 'brows', 'tongue', 'tear', 'sweat', 'zzz', 'spark']) {
    assert.ok(app.includes(`"${part}"`), `renderer lost the ${part} face part`);
    assert.ok(stage.includes(`"${part}"`), `demo stage is missing the ${part} face part`);
  }
  // Species parts must exist in the settings previews too, or the picker shows
  // six identical buttons while the real pet changes shape.
  const settingsHtml = fs.readFileSync('./src/renderer/settings.html', 'utf8');
  for (const part of ['tail', 'crest', 'whiskers', 'ear-l', 'ear-r']) {
    for (const [name, html] of [['renderer', app], ['demo stage', stage], ['settings', settingsHtml]]) {
      assert.ok(html.includes(`"${part}"`) || html.includes(` ${part}"`), `${name} has no ${part} slot`);
    }
  }
  // The tail and crest have to be drawn before the body or they sit on top of it.
  for (const [name, html] of [['renderer', app], ['demo stage', stage], ['settings', settingsHtml]]) {
    assert.ok(
      html.indexOf('class="tail"') < html.indexOf('class="body"'),
      `${name} draws the tail in front of the body`
    );
  }
}

// --- every species is actually drawn, and only from one place ---
{
  const fs = require('fs');
  const cfg = require('../src/core/settings');
  const css = fs.readFileSync('./src/renderer/pets.css', 'utf8');

  for (const pet of cfg.PETS) {
    // blob is the shape already in the markup, so it needs no rules of its own.
    if (pet === 'blob') continue;
    assert.ok(css.includes(`[data-pet="${pet}"]`), `species "${pet}" has no rules in pets.css`);
  }
  // Shapes must live in pets.css alone - style.css is loaded by the pet window
  // only, so a species rule hiding in there would not reach the settings previews.
  assert.ok(
    !fs.readFileSync('./src/renderer/style.css', 'utf8').includes('[data-pet='),
    'a species rule is in style.css, where the settings previews cannot see it'
  );
  for (const html of ['./src/renderer/index.html', './src/renderer/settings.html', './demo/stage.html']) {
    assert.ok(fs.readFileSync(html, 'utf8').includes('pets.css'), `${html} does not load pets.css`);
  }

  // Every species has an idle quirk of its own. Without one it falls back to the
  // default squish, which is the blob's, and the pet reads as unfinished.
  for (const pet of cfg.PETS) {
    assert.ok(
      css.includes(`[data-pet="${pet}"] .pet.is-idling`),
      `species "${pet}" has no idle quirk`
    );
  }
  // A tail that rotates has to say where from, or it swings about its own centre
  // and detaches from the body. Verified by freezing the wag mid-swing.
  assert.ok(/\.tail\s*\{[^}]*transform-origin/.test(css), 'the tail rotates about no fixed point');
}

// --- bond milestones fire once, on the way up ---
{
  assert.strictEqual(pets.milestone(0, 10), null);
  assert.ok(pets.milestone(24, 26));
  assert.strictEqual(pets.milestone(26, 30), null, 'a crossed tier must not fire twice');
  assert.ok(pets.milestone(99, 100));
  // Bond never falls, but a hand-edited file could; going down says nothing.
  assert.strictEqual(pets.milestone(60, 10), null);
}

// --- tickling is a real action, not just a face ---
{
  const t = 100000; // clear of the cooldown measured from a zero lastAction
  const before = pets.fresh(t);
  const { state, ok } = pets.act(before, 'tickle', t);
  assert.strictEqual(ok, true);
  assert.ok(state.happiness > before.happiness && state.bond > before.bond);
  assert.ok(state.energy < before.energy, 'tickling should cost a little energy');
  assert.strictEqual(pets.act(state, 'tickle', t + 1000).ok, false, 'no cooldown on tickle');
}

// ===== settings ============================================================

{
  const cfg = require('../src/core/settings');

  assert.deepStrictEqual(cfg.load(null), cfg.DEFAULTS);
  assert.deepStrictEqual(cfg.load('nonsense'), cfg.DEFAULTS);

  // A species that does not exist would leave the pet drawn as nothing at all.
  assert.strictEqual(cfg.load({ pet: 'griffin' }).pet, cfg.DEFAULTS.pet);
  assert.strictEqual(cfg.load({ pet: 'dragon' }).pet, 'dragon');
  assert.ok(cfg.PETS.includes(cfg.DEFAULTS.pet), 'the default pet is not in the list');

  // A malformed accelerator would throw inside globalShortcut.register and take
  // the app down on launch, so it must never survive validation.
  for (const bad of ['', '   ', 'Ctrl++', 'Ctrl+', null, 42, 'a'.repeat(80)]) {
    assert.strictEqual(cfg.load({ hotkey: bad }).hotkey, cfg.DEFAULTS.hotkey, `accepted ${bad}`);
  }
  assert.strictEqual(cfg.load({ hotkey: 'Alt+Shift+P' }).hotkey, 'Alt+Shift+P');

  // Endpoint must stay on loopback. A remote one turns the privacy claim into a
  // lie, so it is not a supported configuration even if hand-edited into the file.
  for (const bad of [
    'http://evil.example.com:11434',
    'https://1.2.3.4',
    'http://127.0.0.1.evil.com',
    'ftp://127.0.0.1',
    'not a url',
    '',
  ]) {
    assert.strictEqual(cfg.load({ ollama: bad }).ollama, cfg.DEFAULTS.ollama, `accepted ${bad}`);
  }
  assert.strictEqual(cfg.load({ ollama: 'http://localhost:1234' }).ollama, 'http://localhost:1234');

  assert.strictEqual(cfg.load({ skin: 'chartreuse' }).skin, cfg.DEFAULTS.skin);
  assert.strictEqual(cfg.load({ skin: 'mint' }).skin, 'mint');
  assert.strictEqual(cfg.load({ autostart: 'yes' }).autostart, false);

  // The microphone opens for a literal true and nothing else. A hand-edited
  // "mic": "yes" or a 1 left over from some other config format must not be the
  // thing that turns a desktop pet into a live microphone.
  assert.strictEqual(cfg.DEFAULTS.mic, false, 'the microphone ships switched on');
  for (const truthy of ['yes', 1, 'true', {}, [], 'on']) {
    assert.strictEqual(cfg.load({ mic: truthy }).mic, false, `mic opened for ${JSON.stringify(truthy)}`);
  }
  assert.strictEqual(cfg.load({ mic: true }).mic, true);
  assert.strictEqual(cfg.load({ voice: 'loud' }).voice, cfg.DEFAULTS.voice);
  assert.strictEqual(cfg.load({ voice: false }).voice, false);

  // The camera gets the same literal-true rule as the microphone.
  assert.strictEqual(cfg.DEFAULTS.camera, false, 'the camera ships switched on');
  for (const truthy of ['yes', 1, 'true', {}, []]) {
    assert.strictEqual(cfg.load({ camera: truthy }).camera, false, `camera opened for ${JSON.stringify(truthy)}`);
  }
  assert.strictEqual(cfg.load({ camera: true }).camera, true);

  // --- the permission gate ---
  // Electron's default handler grants most of what a page it loaded asks for.
  // This replaces it, so every "no" below is load-bearing: a regression here is
  // a desktop pet that can be talked into opening a microphone.
  const on = cfg.load({ camera: true });
  const off = cfg.load({ camera: false });
  const video = { mediaTypes: ['video'] };

  assert.strictEqual(cfg.allowPermission(on, 'media', video), true, 'the camera never opens');
  assert.strictEqual(cfg.allowPermission(on, 'media', { mediaType: 'video' }), true,
    'the check handler shape is refused, so Chromium sees a denial either way');

  assert.strictEqual(cfg.allowPermission(off, 'media', video), false, 'camera opened while switched off');
  for (const [permission, details] of [
    ['media', { mediaTypes: ['audio'] }],
    ['media', { mediaTypes: ['video', 'audio'] }],
    ['media', { mediaType: 'audio' }],
    ['media', { mediaType: 'unknown' }],
    ['media', null],
    ['geolocation', video],
    ['notifications', video],
    ['midi', video],
    ['clipboard-read', video],
    ['openExternal', video],
    ['something-chromium-adds-later', video],
  ]) {
    assert.strictEqual(
      cfg.allowPermission(on, permission, details), false,
      `granted ${permission} ${JSON.stringify(details)} with the camera on`
    );
  }

  // --- the opt-in features ---
  // Each of these opens something. Every one of them must need a literal true,
  // and the two that use a device must need that device as well - a wake word
  // with no microphone is a setting that silently does nothing.
  for (const key of ['wake', 'bop', 'weather', 'faces']) {
    assert.strictEqual(cfg.DEFAULTS[key], false, `${key} ships switched on`);
    for (const truthy of ['yes', 1, 'true', {}, []]) {
      assert.strictEqual(cfg.load({ [key]: truthy, mic: true, camera: true })[key], false,
        `${key} opened for ${JSON.stringify(truthy)}`);
    }
  }
  assert.strictEqual(cfg.load({ wake: true }).wake, false, 'the wake word opened with no microphone');
  assert.strictEqual(cfg.load({ bop: true }).bop, false, 'bop opened with no microphone');
  assert.strictEqual(cfg.load({ faces: true }).faces, false, 'face detection opened with no camera');
  assert.strictEqual(cfg.load({ wake: true, mic: true }).wake, true);
  assert.strictEqual(cfg.load({ bop: true, mic: true }).bop, true);
  assert.strictEqual(cfg.load({ faces: true, camera: true }).faces, true);
  // Switching the device back off takes its dependants with it.
  assert.strictEqual(cfg.merge(cfg.load({ wake: true, mic: true }), { mic: false }).wake, false);
  assert.strictEqual(cfg.merge(cfg.load({ faces: true, camera: true }), { camera: false }).faces, false);

  // The town is the only user-typed string in the app that reaches a server.
  assert.strictEqual(cfg.load({ city: 'Abu Dhabi' }).city, 'Abu Dhabi');
  assert.strictEqual(cfg.load({ city: "Stratford-upon-Avon" }).city, 'Stratford-upon-Avon');
  assert.strictEqual(cfg.load({ city: 'x' }).city, '', 'a one-character town was accepted');
  assert.strictEqual(cfg.load({ city: 42 }).city, '');
  // Rejected rather than truncated: half a town name is a different town.
  assert.strictEqual(cfg.load({ city: 'a'.repeat(200) }).city, '');
  // Anything that is not part of a place name is stripped before it can be a URL.
  assert.strictEqual(cfg.load({ city: 'Paris?lat=1&lon=2' }).city, 'Paris lat lon');
  assert.ok(!/[?&=/:]/.test(cfg.load({ city: 'a/b?c=d&e' }).city), 'URL punctuation survived');

  // --- which recogniser hears you ---
  // A preference, not a permission: it opens nothing on its own, so unlike the
  // switches above it is allowed a default that is not simply "off". What it
  // must never do is let a hand-edited file name an engine that does not exist.
  assert.strictEqual(cfg.DEFAULTS.dictation, 'auto', 'dictation no longer defaults to looking');
  for (const value of cfg.DICTATION) {
    assert.strictEqual(cfg.load({ dictation: value }).dictation, value, `${value} was refused`);
  }
  for (const junk of ['whispers', 'sapi ', '', 'WHISPER', true, 1, null, {}]) {
    assert.strictEqual(cfg.load({ dictation: junk }).dictation, 'auto',
      `${JSON.stringify(junk)} was accepted as an engine`);
  }
  // It survives the microphone being switched off, because turning a device off
  // is not a reason to forget which recogniser you preferred.
  assert.strictEqual(cfg.merge(cfg.load({ mic: true, dictation: 'local' }), { mic: false }).dictation, 'local');

  // 'whisper' was this value's name while whisper was the only engine it could
  // mean. A settings file written by that version must keep doing what it did,
  // rather than falling back to 'auto' and quietly changing the app's behaviour.
  assert.strictEqual(cfg.load({ dictation: 'whisper' }).dictation, 'local', 'the old value stopped working');
  assert.ok(!cfg.DICTATION.includes('whisper'), 'the alias is being offered as a current value');

  // A setting the window cannot reach is a setting nobody has. The first version
  // of this control was marked up with `class="row"`, which in settings.css is
  // the fixed bottom bar - it validated fine and sat on top of the save button.
  {
    const html = require('fs').readFileSync('./src/renderer/settings.html', 'utf8');
    const js = require('fs').readFileSync('./src/renderer/settings-renderer.js', 'utf8');
    assert.ok(html.includes('id="dictation"'), 'the settings window has no recogniser control');
    assert.ok(html.includes('for="dictation"'), 'the recogniser control has no label');
    assert.ok(!/class="row"[^>]*id="dictation"/.test(html), 'the recogniser control is in the fixed bottom bar');
    for (const value of cfg.DICTATION) {
      assert.ok(html.includes(`value="${value}"`), `the window cannot choose ${value}`);
    }
    assert.ok(/dictation:\s*dictationSel\.value/.test(js), 'the window never saves the recogniser');
    assert.ok(/dictationSel\.value\s*=\s*current\.dictation/.test(js), 'the window never loads the recogniser');
  }

  // --- audio through the permission gate ---
  // Audio became reachable when the pet learned to move to a beat. It is gated
  // on the microphone setting, exactly as video is gated on the camera.
  const micOn = cfg.load({ mic: true });
  const both = cfg.load({ mic: true, camera: true });
  assert.strictEqual(cfg.allowPermission(micOn, 'media', { mediaTypes: ['audio'] }), true);
  assert.strictEqual(cfg.allowPermission(micOn, 'media', { mediaType: 'audio' }), true);
  assert.strictEqual(cfg.allowPermission(micOn, 'media', { mediaTypes: ['video'] }), false,
    'the camera opened on the microphone setting');
  assert.strictEqual(cfg.allowPermission(both, 'media', { mediaTypes: ['video', 'audio'] }), true);
  assert.strictEqual(cfg.allowPermission(on, 'media', { mediaTypes: ['video', 'audio'] }), false,
    'audio rode in alongside video with the microphone off');
  assert.strictEqual(cfg.allowPermission(both, 'media', { mediaTypes: [] }), false);
  assert.strictEqual(cfg.allowPermission(both, 'media', { mediaTypes: ['video', 'midi'] }), false,
    'an unknown media type rode in alongside an allowed one');
  assert.strictEqual(cfg.allowPermission(both, 'geolocation', { mediaTypes: ['video'] }), false);

  // merge keeps what it is not told about, and still validates what it is.
  const merged = cfg.merge(cfg.load({ skin: 'mint' }), { model: 'x', hotkey: 'Ctrl+' });
  assert.strictEqual(merged.skin, 'mint');
  assert.strictEqual(merged.model, 'x');
  assert.strictEqual(merged.hotkey, cfg.DEFAULTS.hotkey, 'merge let a bad hotkey through');
}

// ===== dictate: the other recogniser =======================================
//
// Nothing here spawns a binary - they are files the user puts there and most
// machines running these tests will not have them. What is worth pinning is
// everything around the spawn: which engine is picked, the cleanup, and the
// prompt, which is the single largest measured improvement available to whisper
// and looks like dead weight to anyone who did not measure it.

{
  const whisper = require('../src/system/dictate');
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  const W = whisper.ENGINES.find((e) => e.name === 'whisper');
  const P = whisper.ENGINES.find((e) => e.name === 'parakeet');
  assert.notStrictEqual(W.model, P.model, 'the two engines share a model name');

  // --- installed: both halves, or the feature is off ---
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'screenpet-whisper-'));
  assert.strictEqual(whisper.installed(empty), false, 'an empty folder counted as installed');

  const dir = path.join(empty, whisper.DIR);
  fs.mkdirSync(dir);
  assert.strictEqual(whisper.installed(empty), false, 'an empty whisper folder counted as installed');
  fs.writeFileSync(path.join(dir, W.exe), 'not really an exe');
  assert.strictEqual(whisper.installed(empty), false, 'a binary with no model counted as installed');
  fs.writeFileSync(path.join(dir, W.model), 'not really a model');
  assert.strictEqual(whisper.installed(empty), true, 'both files present and still not installed');
  assert.strictEqual(whisper.installedName(empty), 'whisper');

  // --- the model decides, not the binary ---
  // The whisper.cpp release ships both binaries in one folder, and the README
  // tells you to copy that folder for its dlls. So "both exes, one whisper
  // model" is the normal case, not a corner: picking parakeet here would hand it
  // a whisper model, which it refuses with "bad magic", and dictation would be
  // dead for anyone who followed the instructions.
  fs.writeFileSync(path.join(dir, P.exe), 'not really an exe either');
  assert.strictEqual(whisper.installedName(empty), 'whisper',
    'parakeet was chosen on its binary alone, and would be fed a whisper model');

  // With its own model present it wins - better at commands, and silent on
  // silence. That is a real choice by whoever put a 397MB model there.
  fs.writeFileSync(path.join(dir, P.model), 'not really a parakeet model');
  assert.strictEqual(whisper.installedName(empty), 'parakeet', 'whisper was preferred over parakeet');
  // ...and each is handed its own model, never the other's.
  assert.ok(whisper.engineFor(empty).args('x').includes('x'), 'the model is not passed to the engine');
  fs.rmSync(path.join(dir, P.model));
  // Only whisper takes the vocabulary prompt; passing it to parakeet would be an
  // unknown flag and a non-zero exit.
  const args = (name) => whisper.ENGINES.find((e) => e.name === name).args('m.bin');
  assert.ok(args('whisper').includes('--prompt'), 'whisper lost the vocabulary prompt');
  assert.ok(!args('parakeet').includes('--prompt'), 'parakeet was given a flag it does not have');
  // Both read the audio from stdin. Writing it to a temp file would put the
  // microphone on disk, which is the one thing this path must not do.
  for (const name of ['whisper', 'parakeet']) {
    assert.ok(args(name).includes('-f') && args(name).includes('-'), `${name} is not reading stdin`);
  }
  // Whisper prints nothing at all from stdin without an output name to be quiet
  // about. Removing this looks like tidying and turns dictation off.
  assert.ok(args('whisper').includes('-of'), 'whisper lost the -of workaround and now prints nothing');

  fs.rmSync(path.join(dir, P.exe));
  // A directory named like the binary is not the binary.
  fs.rmSync(path.join(dir, W.exe));
  fs.mkdirSync(path.join(dir, W.exe));
  assert.strictEqual(whisper.installed(empty), false, 'a directory passed as the binary');
  fs.rmSync(empty, { recursive: true, force: true });
  assert.strictEqual(whisper.installed(empty), false, 'a missing folder threw instead of answering');
  assert.strictEqual(whisper.installedName(empty), null);

  // --- clean: what came back is not always something a person said ---
  assert.strictEqual(whisper.clean(' Set a timer for 10 minutes.\r\n'), 'Set a timer for 10 minutes.');
  // Whisper narrates non-speech in brackets. A pet that reads a stage direction
  // out loud looks broken.
  assert.strictEqual(whisper.clean('[BLANK_AUDIO]'), '');
  assert.strictEqual(whisper.clean('(upbeat music) hello'), 'hello');
  assert.strictEqual(whisper.clean('*sighs* what time is it'), 'what time is it');
  // Measured: two seconds of near-silence through base.en comes back as "you".
  // Whisper has no confidence score to gate on, so this list is the gate.
  for (const noise of ['you', 'You.', 'THANK YOU', 'Thanks for watching!', '.', '']) {
    assert.strictEqual(whisper.clean(noise), '', `"${noise}" was treated as speech`);
  }
  // ...but a real sentence that merely contains one of them is not silence.
  assert.strictEqual(whisper.clean('thank you for the reminder'), 'thank you for the reminder');
  assert.strictEqual(whisper.clean('x'.repeat(900)).length, whisper.MAX_CHARS, 'dictation was not capped');

  // --- the prompt, which is worth 28 points of word error rate ---
  // Deleting it looks like removing a magic string. It took whisper base.en from
  // 49% to 21% overall and 87% to 29% on technical phrases, so if it ever goes,
  // it should go on purpose and with a new measurement behind it.
  for (const word of ['npm', 'JSON', 'rebase', 'Postgres', 'JavaScript', '401']) {
    assert.ok(whisper.VOCAB.includes(word), `the dictation prompt no longer mentions ${word}`);
  }
  assert.ok(whisper.VOCAB.length < 400, 'the prompt is long enough to start leaking into transcripts');

  // --- transcribe refuses what it should never pipe to a binary ---
  // Parked rather than asserted here: this block is synchronous, and an
  // assert.rejects nobody waits for surfaces after "all checks passed" has
  // already been printed. The async section at the end of this file drains them.
  const nowhere = { userData: 'C:\\nowhere' };
  globalThis.pendingRejections = [
    ...[null, undefined, '', 'a wav, honest', Buffer.alloc(0)].map((bad) =>
      assert.rejects(() => whisper.transcribe(bad, nowhere), /no audio/,
        `${JSON.stringify(bad)} was accepted as audio`)),
    assert.rejects(() => whisper.transcribe(Buffer.alloc(whisper.MAX_WAV_BYTES + 1), nowhere),
      /too much audio/, 'an absurd buffer was piped to the binary'),
  ];

  // The install location is fixed, and nothing user-supplied contributes to it.
  // A path to an executable in settings.json would be arbitrary code execution
  // with a nice label on it, which is why there is no such setting to test.
  // Every engine name is a bare filename, so nothing in the table can reach out
  // of the fixed folder, and no engine may be added with a path in its name.
  for (const e of whisper.ENGINES) {
    for (const name of [e.exe, e.model]) {
      assert.strictEqual(path.basename(name), name, `${e.name} names a path, not a file`);
      assert.ok(!/[\\/]|\.\./.test(name), `${e.name} can be climbed out of`);
    }
  }
  assert.strictEqual(path.basename(whisper.DIR), whisper.DIR, 'the install folder names a path');
}

// ===== quiet hours =========================================================

{
  const dnd = require('../src/system/dnd');

  // The list is of talkative states, not quiet ones, so anything Windows adds in
  // a future version is treated as "keep quiet". Getting this backwards means a
  // pet that chatters through a presentation.
  for (const state of [1, 2, 3, 4, 5, 6]) {
    assert.strictEqual(dnd.isQuiet(state), true, `state ${state} was treated as a good time to talk`);
  }
  assert.strictEqual(dnd.isQuiet(7), false, 'the pet stays silent when nothing is in the way');
  for (const unknown of [0, 8, 99, -1, NaN]) {
    assert.strictEqual(dnd.isQuiet(unknown), true, `unknown state ${unknown} was treated as talkative`);
  }
}

// ===== breaks ==============================================================
//
// The pet thinking about a glass of water, or about sitting still for a minute.
// That thought is the whole of the interruption, and every check here is about
// when there must not be one.

{
  const br = require('../src/core/breaks');
  const NOW = 10_000_000;
  const EVERY = 50 * 60000;

  assert.strictEqual(br.due(NOW - EVERY, NOW, EVERY), true, 'a break that is owed is never thought of');
  assert.strictEqual(br.due(NOW - EVERY + 1, NOW, EVERY), false, 'the interval is not respected');

  // A game, a call, a presentation. The same do not disturb answer the pet
  // already obeys before it speaks.
  assert.strictEqual(
    br.due(NOW - EVERY * 3, NOW, EVERY, { quiet: true }), false,
    'a break was offered during a presentation'
  );
  // Mid-answer is the other one: the pet is writing something you asked for.
  assert.strictEqual(
    br.due(NOW - EVERY * 3, NOW, EVERY, { busy: true }), false,
    'a break was offered over an answer being written'
  );
  // A hand-edited interval of nothing must not mean "every tick".
  for (const bad of [0, -1, NaN, undefined]) {
    assert.strictEqual(br.due(0, NOW, bad), false, `an interval of ${bad} fires forever`);
  }

  // Alternating, so neither kind becomes wallpaper - and it survives a counter
  // that only ever goes up.
  assert.deepStrictEqual(
    [0, 1, 2, 3, 40001].map((i) => br.nth(i).kind),
    ['water', 'rest', 'water', 'rest', 'rest'],
    'the pet stopped alternating what it thinks about'
  );
  // A face for each, and no words: a thought with a sentence in it is a
  // notification wearing a costume.
  for (const b of br.BREAKS) {
    assert.ok(b.face && b.face.length <= 4, `${b.kind} has no face to think about`);
    assert.deepStrictEqual(Object.keys(b), ['kind', 'face'], `${b.kind} carries more than a face`);
  }

  // Both timings are clamped into something survivable. A thought every thirty
  // seconds, and a break that lasts an hour, are the same bug.
  const cfg = require('../src/core/settings');
  const wild = cfg.load({ breakEvery: 0, breakFor: 100000 });
  assert.strictEqual(wild.breakEvery, br.EVERY_MIN.min, 'a zero interval was accepted');
  assert.strictEqual(wild.breakFor, br.FOR_S.max, 'an hour-long break was accepted');
  const junk = cfg.load({ breakEvery: 'soon', breakFor: null });
  assert.strictEqual(junk.breakEvery, br.EVERY_MIN.def, 'a junk interval did not fall back');
  assert.strictEqual(junk.breakFor, br.FOR_S.def, 'a junk duration did not fall back');

  // ...and it can be switched off outright, which anything that dims the screen
  // has to be able to be.
  assert.strictEqual(cfg.load({ breaks: false }).breaks, false, 'breaks cannot be turned off');
  assert.strictEqual(cfg.load({}).breaks, true, 'breaks are not on by default');
  assert.strictEqual(cfg.load({ mischief: false }).mischief, false, 'mischief cannot be turned off');

  // Two rules in the main process, pinned rather than trusted to survive an
  // edit. Nothing starts a break except a thought you actually clicked, and the
  // dimmed screen comes back on a timer whatever the renderer is doing.
  const fs = require('fs');
  const main = fs.readFileSync('./src/main.js', 'utf8');
  assert.ok(
    /on\('break:take'[\s\S]{0,220}if \(!offered\) return;/.test(main),
    'a renderer can start a break nobody was offered'
  );
  assert.ok(
    /breakTimer = setTimeout\(endBreak/.test(main),
    'the backstop that undims the screen if the countdown stalls is gone'
  );
}

// ===== reminders ===========================================================

{
  const rem = require('../src/core/reminders');
  const NOW = 1_000_000;

  // Split on the clock, oldest first, so a queue of missed ones replays in order.
  const { late, pending } = rem.load([
    { at: NOW + 60_000, say: 'later' },
    { at: NOW - 60_000, say: 'missed' },
    { at: NOW - 10_000, say: 'missed second' },
  ], NOW);
  assert.deepStrictEqual(late.map((r) => r.say), ['missed', 'missed second']);
  assert.deepStrictEqual(pending.map((r) => r.say), ['later']);

  // A file that got mangled must not be able to schedule anything.
  assert.deepStrictEqual(rem.load(null, NOW), { late: [], pending: [] });
  assert.deepStrictEqual(rem.load('nonsense', NOW), { late: [], pending: [] });
  assert.deepStrictEqual(rem.load({ at: NOW, say: 'x' }, NOW), { late: [], pending: [] });
  assert.deepStrictEqual(
    rem.load([null, 42, 'x', {}, { at: 'soon', say: 'x' }, { at: NOW + 1 }, { at: NOW + 1, say: '  ' }], NOW),
    { late: [], pending: [] }
  );

  // Last week's reminder is not worth shouting about on Monday.
  assert.strictEqual(rem.load([{ at: NOW - rem.MAX_LATE_MS - 1, say: 'ancient' }], NOW).late.length, 0);
  assert.strictEqual(rem.load([{ at: NOW - rem.MAX_LATE_MS + 1, say: 'recent' }], NOW).late.length, 1);

  // This text goes in a bubble and through a speech engine. Neither has any use
  // for a newline, an escape, or a novel.
  assert.strictEqual(rem.clean('call  the\u0007 bank\n now  '), 'call the bank now');
  assert.strictEqual(rem.clean('   '), null);
  assert.strictEqual(rem.clean(''), null);
  assert.strictEqual(rem.clean(null), null);
  assert.strictEqual(rem.clean(42), null);
  assert.strictEqual(rem.clean('x'.repeat(5000)).length, rem.MAX_TEXT);

  // A file with ten thousand reminders in it must not become ten thousand live
  // timeouts on launch.
  const many = Array.from({ length: 500 }, (_, i) => ({ at: NOW + i + 1, say: `r${i}` }));
  assert.strictEqual(rem.load(many, NOW).pending.length, rem.MAX_PENDING);

  assert.ok(rem.lateLine('stretch').includes('stretch'), 'the late line dropped the reminder');

  // --- repeat rules ---------------------------------------------------------
  // A hand-edited rule reaches setTimeout, so the shape check is the guard.
  for (const bad of [
    null, 'daily', {}, { kind: 'yearly', hour: 9 }, { kind: 'daily' },
    { kind: 'daily', hour: 24 }, { kind: 'daily', hour: -1 }, { kind: 'daily', hour: 9.5 },
    { kind: 'daily', hour: 9, minute: 60 }, { kind: 'weekly', hour: 9 },
    { kind: 'weekly', day: 7, hour: 9 }, { kind: 'interval', ms: 1000 },
    { kind: 'interval', ms: 30 * 24 * 3600_000 }, { kind: 'interval' },
  ]) {
    assert.strictEqual(rem.validRepeat(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
  assert.deepStrictEqual(rem.validRepeat({ kind: 'daily', hour: 7 }), { kind: 'daily', hour: 7, minute: 0 });
  assert.deepStrictEqual(rem.validRepeat({ kind: 'interval', ms: 90_000 }), { kind: 'interval', ms: 90_000 });

  // Wednesday 2026-08-12, 10:00 local.
  const wed = new Date(2026, 7, 12, 10, 0, 0, 0).getTime();
  const fmt = (t) => new Date(t).toString().slice(0, 21);

  // Later today.
  assert.strictEqual(fmt(rem.nextAt({ kind: 'daily', hour: 18 }, wed)), fmt(new Date(2026, 7, 12, 18)));
  // Already gone today, so tomorrow.
  assert.strictEqual(fmt(rem.nextAt({ kind: 'daily', hour: 7 }, wed)), fmt(new Date(2026, 7, 13, 7)));
  // Friday 18:00 from Wednesday.
  assert.strictEqual(fmt(rem.nextAt({ kind: 'weekly', day: 5, hour: 18 }, wed)), fmt(new Date(2026, 7, 14, 18)));
  // Weekdays skip the weekend: Friday 07:00 -> Monday, not Saturday.
  const fri = new Date(2026, 7, 14, 10).getTime();
  assert.strictEqual(fmt(rem.nextAt({ kind: 'weekdays', hour: 7 }, fri)), fmt(new Date(2026, 7, 17, 7)));
  // Strictly after: an alarm firing at exactly its own time must move on, not
  // reschedule itself for the instant it just fired.
  const seven = new Date(2026, 7, 12, 7).getTime();
  assert.strictEqual(fmt(rem.nextAt({ kind: 'daily', hour: 7 }, seven)), fmt(new Date(2026, 7, 13, 7)));
  assert.strictEqual(rem.nextAt({ kind: 'interval', ms: 60_000 }, wed), wed + 60_000);
  assert.strictEqual(rem.nextAt({ kind: 'nonsense' }, wed), null);

  // The wall clock is re-asserted daily rather than 24 hours being added, so an
  // alarm does not drift an hour twice a year. Sunday 2026-03-08 is the US
  // spring forward; the alarm must still be 07:00 the next morning.
  const dstEve = new Date(2026, 2, 7, 10).getTime();
  const afterDst = new Date(rem.nextAt({ kind: 'daily', hour: 7 }, dstEve));
  assert.strictEqual(afterDst.getHours(), 7, `alarm drifted across DST: ${afterDst}`);

  // A daily alarm missed while the app was closed is still a daily alarm: said
  // once if it is recent, and rescheduled either way.
  const missed = rem.load([{ at: NOW - 60_000, say: 'stand up', repeat: { kind: 'daily', hour: 9 } }], NOW);
  assert.strictEqual(missed.late.length, 1, 'a recent missed alarm went unmentioned');
  assert.strictEqual(missed.pending.length, 1, 'a missed daily alarm was not rescheduled');
  assert.ok(missed.pending[0].at > NOW, 'the rescheduled alarm is in the past');

  // ...and one missed on holiday is not worth mentioning, but is still rescheduled.
  const ancient = rem.load([{ at: NOW - 30 * 86_400_000, say: 'stand up', repeat: { kind: 'daily', hour: 9 } }], NOW);
  assert.strictEqual(ancient.late.length, 0, 'a month-old alarm was replayed');
  assert.strictEqual(ancient.pending.length, 1, 'a month-old daily alarm was dropped entirely');

  // A malformed repeat degrades to a one-off rather than taking the entry down.
  const junk = rem.load([{ at: NOW + 1000, say: 'x', repeat: { kind: 'hourly' } }], NOW);
  assert.deepStrictEqual(junk.pending, [{ at: NOW + 1000, say: 'x' }]);
}

// ===== recurring alarms: the language half =================================

{
  const { repeatOf, clockOf, spokenRepeat, match } = require('../src/core/skills');

  assert.deepStrictEqual(clockOf('at 7'), { hour: 7, minute: 0 });
  assert.deepStrictEqual(clockOf('at 9:30am'), { hour: 9, minute: 30 });
  assert.deepStrictEqual(clockOf('at 6 pm'), { hour: 18, minute: 0 });
  assert.deepStrictEqual(clockOf('at 12am'), { hour: 0, minute: 0 });
  assert.deepStrictEqual(clockOf('at 12pm'), { hour: 12, minute: 0 });
  assert.strictEqual(clockOf('at 25'), null);
  assert.strictEqual(clockOf('tomorrow'), null);

  assert.deepStrictEqual(repeatOf('every day at 7'), { kind: 'daily', hour: 7, minute: 0 });
  assert.deepStrictEqual(repeatOf('every weekday at 9:15'), { kind: 'weekdays', hour: 9, minute: 15 });
  assert.deepStrictEqual(repeatOf('every monday at 6pm'), { kind: 'weekly', day: 1, hour: 18, minute: 0 });
  assert.deepStrictEqual(repeatOf('every sunday at 11'), { kind: 'weekly', day: 0, hour: 11, minute: 0 });
  assert.deepStrictEqual(repeatOf('every 30 minutes'), { kind: 'interval', ms: 1_800_000 });

  // No "every", no repeat - a one-off must not become a daily alarm.
  assert.strictEqual(repeatOf('in 30 minutes'), null);
  assert.strictEqual(repeatOf('at 7'), null);
  assert.strictEqual(repeatOf('every so often'), null);

  assert.strictEqual(spokenRepeat({ kind: 'daily', hour: 7, minute: 0 }), 'every day at 07:00');
  assert.strictEqual(spokenRepeat({ kind: 'weekdays', hour: 9, minute: 5 }), 'every weekday at 09:05');
  assert.strictEqual(spokenRepeat({ kind: 'weekly', day: 1, hour: 18, minute: 0 }), 'every monday at 18:00');
  assert.strictEqual(spokenRepeat({ kind: 'interval', ms: 1_800_000 }), 'every 30 minutes');

  // Through the whole skill: a recurring alarm carries a rule and no duration.
  const alarm = match('wake me every weekday at 7');
  assert.strictEqual(alarm.name, 'timer');
  assert.deepStrictEqual(alarm.timer.repeat, { kind: 'weekdays', hour: 7, minute: 0 });
  assert.strictEqual(alarm.timer.ms, undefined, 'a recurring alarm also carried a stopwatch');
  assert.ok(alarm.say.includes('every weekday at 07:00'), `the time was not read back: ${alarm.say}`);

  // A one-off still carries a duration and no rule.
  const once = match('remind me to stretch in 20 minutes');
  assert.strictEqual(once.timer.ms, 1_200_000);
  assert.strictEqual(once.timer.repeat, undefined, 'a one-off timer became recurring');
  assert.ok(once.timer.say.includes('stretch'), 'the reason was lost');

  // The label stops at the timing, whichever form it takes.
  assert.ok(match('remind me to call the bank every day at 9').timer.say.includes('call the bank'));
  assert.ok(!match('remind me to call the bank every day at 9').timer.say.includes('every'),
    'the repeat rule leaked into the reminder text');

  // "every 30 minutes" contains a duration; it must not be read as "in 30 minutes".
  const interval = match('remind me to drink water every 30 minutes');
  assert.deepStrictEqual(interval.timer.repeat, { kind: 'interval', ms: 1_800_000 });

  // Still not a skill without a timing word.
  assert.strictEqual(match('how do I set a timer in JavaScript'), null);
  assert.strictEqual(match('what happens every day at build time'), null);
}

// ===== weather: the one networked feature ==================================

(async () => {
  const wx = require('../src/core/weather');

  const seen = [];
  const fake = async (url) => {
    seen.push(url);
    if (url.includes('geocoding')) {
      return { ok: true, json: async () => ({ results: [{ name: 'Abu Dhabi', latitude: 24.4539123, longitude: 54.3773438 }] }) };
    }
    return { ok: true, json: async () => ({ current: { temperature_2m: 41.2, weather_code: 0, is_day: 1 } }) };
  };

  const line = await wx.forecast('Abu Dhabi', { fetch: fake });
  assert.ok(line.includes('41') && /clear/.test(line), `unreadable forecast: ${line}`);

  // Two requests, both to the hardcoded hosts and nowhere else.
  assert.strictEqual(seen.length, 2);
  assert.ok(seen[0].startsWith(wx.GEO_HOST), `geocoding went to ${seen[0]}`);
  assert.ok(seen[1].startsWith(wx.API_HOST), `forecast went to ${seen[1]}`);

  // What is in those URLs is the whole privacy claim for this feature: a town
  // name you typed, and coordinates rounded to about a kilometre. Nothing else.
  assert.ok(seen[0].includes('name=Abu%20Dhabi'), `town not sent as typed: ${seen[0]}`);
  assert.ok(seen[1].includes('latitude=24.45') && !seen[1].includes('24.4539'),
    `coordinates were not rounded down: ${seen[1]}`);
  for (const url of seen) {
    assert.ok(!/key|token|api_key|uuid|client|device|user/i.test(url), `identifier in ${url}`);
  }

  // A town with punctuation still becomes one encoded query parameter rather
  // than a second one.
  seen.length = 0;
  await wx.forecast("Stratford-upon-Avon", { fetch: fake });
  assert.strictEqual((seen[0].match(/[?&]/g) || []).length, 4, `query was split: ${seen[0]}`);

  // Failures say something a pet would say rather than throwing a stack trace
  // into the bubble.
  await assert.rejects(() => wx.forecast('', { fetch: fake }), /settings/);
  await assert.rejects(
    () => wx.forecast('Atlantis', { fetch: async () => ({ ok: true, json: async () => ({ results: [] }) }) }),
    /cannot find/
  );
  await assert.rejects(
    () => wx.forecast('Paris', { fetch: async () => ({ ok: false, status: 503 }) }),
    /503/
  );

  assert.strictEqual(wx.cleanCity('  '), null);
  assert.strictEqual(wx.cleanCity(null), null);
})();

// ===== ask (async, last) ===================================================

(async () => {
  const ok = async () => ({
    ok: true,
    json: async () => ({ response: '<think>ignore me</think>391.' }),
  });
  assert.strictEqual(await ask('What is 17 * 23?', { fetch: ok }), '391.');

  // --- the answer as it is written ---
  {
    // Ollama streams newline-delimited JSON, one object per token. The chunks
    // here deliberately split a JSON object across two of them and put two
    // objects in one: that is what a socket actually hands you, and a parser
    // that assumes one line per chunk works perfectly until it does not.
    const NL = String.fromCharCode(10); // a real newline, not one this file has to hold
    const pieces = [
      '{"response":"<think>the user',
      ' wants 17 times 23","done":false}' + NL + '{"response":" which is 391</think>","done":false}' + NL,
      '{"response":"391","done":false}' + NL,
      '{"response":". Seventeen","done":false}' + NL + '{"response":" twenty-thirds of nothing.","done":true}' + NL,
    ];
    const streamed = async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        body: new ReadableStream({
          start(c) {
            for (const p of pieces) c.enqueue(new TextEncoder().encode(p));
            c.close();
          },
        }),
      };
    };
    let body = null;
    const seen = [];
    const answer = await ask('What is 17 * 23?', { fetch: streamed, onToken: (t) => seen.push(t) });

    assert.strictEqual(body.stream, true, 'a listener was given but nothing was streamed');
    assert.strictEqual(answer, '391. Seventeen twenty-thirds of nothing.');

    // The default model is a reasoner and narrates its whole approach first.
    // Not one character of that may reach the bubble - showing it live is the
    // exact thing stripThinking exists to prevent, and the bubble is on the
    // thinking face during it anyway.
    for (const shown of seen) {
      assert.ok(!/think|wants 17/.test(shown), `the monologue reached the screen: ${shown}`);
    }
    // It arrived in pieces rather than in one go, and each piece is a prefix of
    // the one after it - text that rewrites itself mid-sentence reads as a bug.
    assert.ok(seen.length >= 2, `nothing was streamed: ${JSON.stringify(seen)}`);
    for (let i = 1; i < seen.length; i++) {
      assert.ok(seen[i].startsWith(seen[i - 1]), `the bubble rewrote itself: ${seen[i - 1]} -> ${seen[i]}`);
    }
    assert.strictEqual(seen.at(-1), '391. Seventeen twenty-thirds of nothing.');

    // No listener, no streaming: one response is less to go wrong, and the
    // hosted providers cannot stream at all.
    let asked = null;
    await ask('What is 17 * 23?', {
      fetch: async (_u, init) => { asked = JSON.parse(init.body); return { ok: true, json: async () => ({ response: 'x' }) }; },
    });
    assert.strictEqual(asked.stream, false, 'streamed with nobody listening');
  }

  // Blank screen must not cost an inference call.
  let called = false;
  const spy = async () => { called = true; return ok(); };
  assert.strictEqual(await ask('   \n  ', { fetch: spy }), EMPTY_SCREEN);
  assert.strictEqual(called, false, 'called the model on an empty screen');

  // Nothing to answer must come back as nothing, not as prose. The pet's voice
  // lives in the line bank; a sentence invented here would be a second, blander
  // personality in the one file that is supposed to have none.
  assert.strictEqual(EMPTY_SCREEN, '', 'brain.js is writing the pet\'s dialogue');
  const blank = async () => ({ ok: true, json: async () => ({ response: '   ' }) });
  assert.strictEqual(await ask('what is on screen', { fetch: blank }), '');
  assert.ok(pets.line('nothing', 0), 'no cute line for a screen with no question');
  assert.ok(pets.expressionFor('nothing'), 'the no-question line has no face');

  // Secrets must be redacted in the body actually sent.
  let sent = '';
  const capture = async (_url, init) => { sent = init.body; return ok(); };
  await ask('password: hunter2horse and 2+2?', { fetch: capture });
  assert.ok(!sent.includes('hunter2horse'), 'secret was sent to the model');

  // A starving pet still answers. This is the rule the whole design rests on.
  await ask('What is 2+2?', { fetch: capture, mood: 'hungry' });
  assert.ok(sent.includes('What is 2+2?'), 'mood suppressed the question');

  // Every call must cap the context window. Left to its own default, phi4-mini
  // -reasoning asks for 21GB of KV cache for a 3.8B model and the process is
  // OOM-killed; llama3.1:8b silently runs 74% on the CPU at 3x the latency.
  assert.strictEqual(JSON.parse(sent).options.num_ctx, 4096, 'context window not capped');

  // Loading the model is 8.35s of a 12.6s cold answer and 0s of a warm one, so
  // holding it past Ollama's five idle minutes is the difference between a pet
  // that replies in 1.2s and one that replies in 12.6s every time.
  assert.strictEqual(JSON.parse(sent).keep_alive, '30m', 'model not kept warm');

  // Failure modes return a message, never throw into the pet.
  const down = async () => { throw new Error('ECONNREFUSED'); };
  assert.match(await ask('hi', { fetch: down }), /Ollama/);

  const http500 = async () => ({ ok: false, status: 500 });
  assert.match(await ask('hi', { fetch: http500 }), /Ollama/);

  // A missing model is not a missing Ollama, and the default is one plenty of
  // people will not have pulled. Sending them to check a service that is running
  // fine is the wrong instruction.
  const http404 = async () => ({ ok: false, status: 404 });
  const missing = await ask('hi', { fetch: http404, model: 'deepseek-r1:8b' });
  assert.match(missing, /ollama pull deepseek-r1:8b/);
  assert.ok(!/is Ollama running/i.test(missing), 'a missing model blamed the server');

  const slow = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  assert.match(await ask('hi', { fetch: slow }), /too long/);

  // --- vision tier ---------------------------------------------------------
  const { askVision, detectVisionModel, listModels } = require('../src/core/brain');

  const fakeOllama = (models, caps = {}) => async (url, init) => {
    if (url.endsWith('/api/tags')) {
      return { ok: true, json: async () => ({ models: models.map((n) => ({ name: n })) }) };
    }
    if (url.endsWith('/api/show')) {
      const { model } = JSON.parse(init.body);
      return { ok: true, json: async () => ({ capabilities: caps[model] || ['completion'] }) };
    }
    return { ok: true, json: async () => ({ response: 'ok' }) };
  };

  // Ask Ollama what a model can do rather than pattern-matching its name.
  assert.strictEqual(
    await detectVisionModel({ fetch: fakeOllama(['llama3.1:8b', 'moondream'], { moondream: ['completion', 'vision'] }) }),
    'moondream'
  );
  assert.strictEqual(await detectVisionModel({ fetch: fakeOllama(['llama3.1:8b']) }), null);
  // Ollama down, or too old to report capabilities: fall back to OCR, never throw.
  const boom = async () => { throw new Error('ECONNREFUSED'); };
  assert.strictEqual(await detectVisionModel({ fetch: boom }), null);
  assert.deepStrictEqual(await listModels({ fetch: boom }), []);
  assert.deepStrictEqual(await listModels({ fetch: fakeOllama(['a', 'b']) }), ['a', 'b']);

  let vbody = null;
  const grab = async (_url, init) => {
    vbody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ response: 'a triangle' }) };
  };
  assert.strictEqual(await askVision('BASE64PNG', { fetch: grab, model: 'moondream' }), 'a triangle');
  assert.deepStrictEqual(vbody.images, ['BASE64PNG'], 'image was not sent to the model');
  assert.strictEqual(vbody.model, 'moondream');

  // A blank capture must not cost an inference call either.
  let visionCalled = false;
  const vspy = async () => { visionCalled = true; return grab(); };
  assert.strictEqual(await askVision('', { fetch: vspy }), EMPTY_SCREEN);
  assert.strictEqual(visionCalled, false);

  // Vision answers carry mood too, but the prompt has hard shape constraints -
  // small vision models emit "!!!" or nothing at all when it grows. Measured
  // against moondream; see the comment on VISION_TASK in brain.js.
  await askVision('X', { fetch: grab, mood: 'sleepy' });
  assert.ok(vbody.prompt.includes('sleepy'), 'mood did not reach the vision prompt');
  assert.ok(vbody.prompt.includes('answer it'), 'vision prompt lost the task');

  // --- tier routing --------------------------------------------------------
  // OCR wins whenever there is text, because a small vision model is measurably
  // worse at dense screens - moondream returns nothing at all for one.
  const { hasEnoughText, MIN_SCREEN_TEXT } = require('../src/core/brain');
  assert.strictEqual(hasEnoughText(''), false);
  assert.strictEqual(hasEnoughText('   \n \n'), false);
  assert.strictEqual(hasEnoughText(null), false);
  assert.strictEqual(hasEnoughText(undefined), false);
  assert.strictEqual(hasEnoughText('OK'), false, 'a stray label is not a screen of text');
  assert.strictEqual(hasEnoughText('x'.repeat(MIN_SCREEN_TEXT - 1)), false);
  assert.strictEqual(hasEnoughText('x'.repeat(MIN_SCREEN_TEXT)), true);
  // 38 characters - under any sensible length threshold, and exactly the case
  // that must never be handed to a vision model.
  assert.strictEqual(
    hasEnoughText('What is 17 * 23 ? A) 391 B) 371 C) 411'),
    true,
    'a real question must take the OCR path'
  );
  assert.strictEqual(hasEnoughText('2+2?'), true, 'a question mark counts on its own');
  // Whitespace must not pad a blank screen over the threshold.
  assert.strictEqual(hasEnoughText(' '.repeat(500)), false);

  const { buildVisionPrompt } = require('../src/core/brain');
  for (const m of ['hungry', 'sleepy', 'sad', 'happy', 'neutral']) {
    const p = buildVisionPrompt(m);
    assert.ok(p.length <= 200, `vision prompt too long for ${m} (${p.length} chars)`);
    assert.ok(!p.includes('\n'), `vision prompt must stay one line (${m})`);
    assert.ok(!/sentence/i.test(p), `length constraints break small vision models (${m})`);
    assert.ok(!/refuse|decline|do not answer/i.test(p), `vision prompt lets the pet decline (${m})`);
    // Mood must come first: appending it after the task returned empty 0/3.
    assert.ok(p.startsWith('You are a'), `mood must prefix the vision task (${m})`);
    assert.ok(p.indexOf('screenshot') > p.indexOf('pet'), `mood must precede the task (${m})`);
  }

  // --- chat ----------------------------------------------------------------
  const { chat, buildChatPrompt } = require('../src/core/brain');

  let cbody = null;
  const cgrab = async (_url, init) => {
    cbody = JSON.parse(init.body);
    return { ok: true, json: async () => ({ response: 'I am a pet.' }) };
  };

  assert.strictEqual(
    await chat('what are you?', {
      fetch: cgrab, model: 'm', mood: 'happy', history: [{ you: 'hi', pet: 'hello' }],
    }),
    'I am a pet.'
  );
  assert.ok(cbody.prompt.includes('what are you?'), 'chat prompt lost the message');
  assert.ok(cbody.prompt.includes('Them: hi'), 'chat prompt dropped the history');
  assert.strictEqual(cbody.images, undefined, 'chat must not send a screenshot');

  // The whole point of this path is that nothing was captured, and a small model
  // will happily invent a screen if it is not told otherwise.
  assert.ok(/cannot see/i.test(buildChatPrompt('hi')), 'chat prompt lets the pet pretend it can see');

  // --- following up on what it just read ---
  {
    const seen = 'Question 4. Which of these is a mammal? A) shark B) dolphin';
    const after = buildChatPrompt('what about the second one?', { screen: { text: seen } });

    assert.ok(after.includes(seen), 'the screen it just read is not in the follow-up prompt');
    // It must not claim both. A pet that says it cannot see your screen one
    // line after answering a question about it is worse than one that never
    // could, and the model will happily say whichever the prompt tells it to.
    assert.ok(!/cannot see/i.test(after), 'the pet is told it cannot see a screen it just read');
    assert.ok(/follow-up|read their screen/i.test(after), 'nothing tells it what the screen text is for');

    // Empty is the same as absent. A screen read that came back with nothing
    // must not put an empty block in the prompt and take the honest sentence out.
    for (const nothing of [null, { text: '' }, { text: '   ' }, {}]) {
      const none = buildChatPrompt('hi', { screen: nothing });
      assert.ok(/cannot see/i.test(none), `${JSON.stringify(nothing)} counted as a screen`);
    }

    // Capped, or a full screen of text crowds out the conversation it is
    // supposed to be context for.
    const huge = buildChatPrompt('hi', { screen: { text: 'x'.repeat(5000) } });
    assert.ok(huge.length < 3000, `a whole screen went into the prompt: ${huge.length} chars`);
  }

  // main.js holds that screen in memory only, drops it when it goes stale, and
  // must drop it when told to forget - a pet that says it forgot everything and
  // then quotes your screen back has not.
  {
    const mjs = require('fs').readFileSync('./src/main.js', 'utf8');
    assert.ok(/lastScreen = .*redact\(/s.test(mjs), 'the kept screen text is not redacted');
    assert.ok(/SCREEN_MEMORY_MS/.test(mjs), 'the kept screen never goes stale');
    assert.ok(
      (mjs.match(/lastScreen = null/g) || []).length >= 2,
      'forgetting everything, or switching memory off, leaves the screen in hand'
    );
    assert.ok(
      !/writeJson\([^)]*lastScreen/.test(mjs),
      'the screen it read is being written to disk'
    );
  }

  // Empty input must not wake the model up at all.
  let chatCalled = false;
  const cspy = async () => { chatCalled = true; return cgrab(); };
  assert.strictEqual(await chat('   ', { fetch: cspy }), '');
  assert.strictEqual(chatCalled, false);

  // A pasted wall of text is a prompt blowout, not a conversation. Measured on
  // the message rather than the whole prompt: a fixed total is really an assertion
  // about how long the style instructions are allowed to be, and it fires on the
  // day someone adds a line to them.
  await chat('x'.repeat(9000), { fetch: cgrab, model: 'm' });
  assert.ok(!cbody.prompt.includes('x'.repeat(501)), 'chat did not cap the message');
  assert.ok(cbody.prompt.length < 2000, `chat prompt not capped: ${cbody.prompt.length} chars`);

  // --- small talk does not wait for the monologue ---
  {
    // Measured, not assumed: on one already-loaded deepseek-r1:8b, 8613ms to
    // the first word with the reasoning on and 394ms with it off. Same model,
    // same memory - the wait was the thinking and nothing else.
    await chat('hey', { fetch: cgrab, model: 'm' });
    assert.strictEqual(cbody.think, false, 'small talk still waits for the reasoner');

    // A question about the screen keeps it. That is the job the careful model
    // was chosen for, and the pet has a thinking face for exactly this.
    await chat('what about the second one?', {
      fetch: cgrab, model: 'm', screen: { text: 'one two three', at: 0 },
    });
    assert.ok(!('think' in cbody), 'a question about the screen lost the reasoning');

    // Whitespace is not a screen. Judged the same way the prompt judges it, or
    // the pet reasons over a screen it is simultaneously telling you it cannot
    // see.
    await chat('hey', { fetch: cgrab, model: 'm', screen: { text: '   ', at: 0 } });
    assert.strictEqual(cbody.think, false, 'a blank screen read counted as a screen');

    // Never switched on, only off. A model that cannot think refuses the whole
    // request - '"llama3.1:8b" does not support thinking' - so asking for it
    // breaks every model that was never the problem.
    const brainSrc = require('fs').readFileSync('./src/core/brain.js', 'utf8');
    assert.ok(!/think:\s*true/.test(brainSrc), 'thinking is asked for, which non-reasoning models refuse');
  }

  // ===== memory ==============================================================

  // Built from local Date parts on purpose: every hour and day rule in memory.js
  // is about the calendar the person lives in, so a UTC constant would pass here
  // and be an hour wrong on the machine.
  const at = (y, mo, d, h = 0) => new Date(y, mo, d, h, 0, 0, 0).getTime();
  const MON_9PM = at(2026, 0, 5, 21);

  {
    const memo = require('../src/core/memory');

    // --- load: a hand-edited file cannot make it say anything absurd ---------
    for (const junk of [null, 42, 'nope', [], { facts: 'no' }]) {
      const m = memo.load(junk, MON_9PM);
      assert.deepStrictEqual(m.facts, [], `facts survived junk: ${JSON.stringify(junk)}`);
      assert.strictEqual(m.hours.ask.length, 24);
      assert.strictEqual(m.days, 1);
    }
    {
      const m = memo.load({
        days: -5,
        cross: 1e12,
        hours: { ask: [1, 2], chat: 'no', care: new Array(24).fill(1e12) },
        care: { n: -1, best: 'lots', bestDay: 'whenever' },
        day: 'not-a-day',
        facts: [null, { text: '   ' }, { text: 'ok', hour: 99 }],
      }, MON_9PM);
      assert.strictEqual(m.days, 1, 'negative day count accepted');
      assert.ok(m.cross <= 1e6, 'counter not capped');
      assert.strictEqual(m.hours.ask.length, 24, 'short bucket array accepted');
      assert.strictEqual(m.hours.chat.length, 24, 'non-array buckets accepted');
      assert.ok(m.hours.care.every((n) => n <= 1e6), 'bucket counts not capped');
      assert.strictEqual(m.care.best, 0, 'non-numeric best accepted');
      assert.strictEqual(m.care.bestDay, '', 'malformed day string accepted');
      assert.deepStrictEqual(m.facts.map((f) => f.text), ['ok'], 'blank facts survived');
      assert.strictEqual(m.facts[0].hour, null, 'hour 99 accepted');
    }

    // --- remember: your words, redacted, deduped, capped ---------------------
    {
      let m = memo.fresh(MON_9PM);
      m = memo.remember(m, 'my standup is at 9:30', MON_9PM, 9).mem;
      assert.strictEqual(m.facts[0].text, 'my standup is at 9:30');
      assert.strictEqual(m.facts[0].hour, 9);

      // The same thing again replaces rather than duplicates.
      m = memo.remember(m, 'My Standup is at 9:30!', MON_9PM + 1000).mem;
      assert.strictEqual(m.facts.length, 1, 'a repeated fact was stored twice');
      assert.strictEqual(m.facts[0].at, MON_9PM + 1000, 'the newer telling did not win');

      // The same trust boundary as the model prompt. A remembered secret is still
      // a secret, and this file lives on disk where the chat history does not.
      const secret = memo.remember(m, 'my key is sk-abcdefghijklmnop1234', MON_9PM).fact;
      assert.ok(secret.text.includes('[REDACTED]'), 'a secret went into memory.json');
      assert.ok(!secret.text.includes('sk-abc'), 'redaction let the key through');

      // Nothing usable is not an error, it is nothing.
      assert.strictEqual(memo.remember(memo.fresh(0), '   ', 0).fact, null);

      // The oldest goes rather than the file growing without limit.
      let full = memo.fresh(0);
      for (let i = 0; i < memo.MAX_FACTS + 10; i++) {
        full = memo.remember(full, `fact number ${i}`, i).mem;
      }
      assert.strictEqual(full.facts.length, memo.MAX_FACTS, 'fact list is unbounded');
      assert.ok(full.facts[0].text.endsWith(' 10'), 'the wrong end of the list was dropped');
    }

    // --- forget: all of it means all of it -----------------------------------
    {
      let m = memo.fresh(0);
      m = memo.remember(m, 'standup at nine', 1).mem;
      m = memo.remember(m, 'the cat is called biscuit', 2).mem;

      const one = memo.forget(m, 'biscuit');
      assert.strictEqual(one.gone, 1);
      assert.deepStrictEqual(one.mem.facts.map((f) => f.text), ['standup at nine']);

      // A miss says so rather than quietly succeeding.
      assert.strictEqual(memo.forget(m, 'aardvark').gone, 0);
      // ...and a term made only of stopwords must not wipe the lot by accident.
      assert.strictEqual(memo.forget(m, 'that').gone, 0, 'a stopword deleted facts');

      assert.strictEqual(memo.forget(m, null).mem.facts.length, 0, 'forget everything kept some');
      assert.strictEqual(memo.forget(m, null).gone, 2);
    }

    // --- recall: shared words, best first ------------------------------------
    {
      let m = memo.fresh(0);
      m = memo.remember(m, 'the cat is called biscuit', 1).mem;
      m = memo.remember(m, 'I run on tuesdays', 2).mem;

      assert.deepStrictEqual(
        memo.recall(m, 'how is biscuit today').map((f) => f.text),
        ['the cat is called biscuit']
      );
      assert.deepStrictEqual(memo.recall(m, 'what is the weather'), [], 'recalled on stopwords');
      assert.deepStrictEqual(memo.recall(m, ''), []);

      // brief() is what reaches the model, and it carries only what recall found.
      const lines = memo.brief(m, 'is biscuit ok', 0).join('\n');
      assert.ok(lines.includes('biscuit'), 'brief dropped the relevant fact');
      assert.ok(!lines.includes('tuesdays'), 'brief sent an irrelevant fact to the model');
      assert.deepStrictEqual(memo.brief(m, 'zzz', 0), [], 'brief spoke with nothing to say');

      // ...and those lines have to actually survive into the prompt, which is the
      // only place a memory is ever read out to anything. Loopback, but still.
      await chat('is biscuit ok', { fetch: cgrab, model: 'm', memory: memo.brief(m, 'is biscuit ok', 0) });
      assert.ok(cbody.prompt.includes('biscuit'), 'the prompt lost the recalled fact');
      await chat('is biscuit ok', { fetch: cgrab, model: 'm' });
      assert.ok(!cbody.prompt.includes('asked you to remember'), 'memory framing leaked with no memory');
    }

    // --- patterns: counters only, and only when they mean something ----------
    {
      let m = memo.fresh(MON_9PM);
      assert.strictEqual(memo.pattern(m, 'ask'), null, 'a pattern from no data');

      for (let i = 0; i < 5; i++) m = memo.note(m, 'ask', at(2026, 0, 5 + i, 21));
      assert.strictEqual(memo.pattern(m, 'ask'), null, 'called five observations a habit');

      m = memo.note(m, 'ask', at(2026, 0, 10, 22));
      const p = memo.pattern(m, 'ask');
      assert.ok(p && p.hour === 21, `wrong peak hour: ${JSON.stringify(p)}`);
      assert.strictEqual(p.n, 6);

      // Spread evenly across the day is not a habit.
      let flat = memo.fresh(MON_9PM);
      for (let h = 0; h < 24; h++) flat = memo.note(flat, 'chat', at(2026, 0, 5, h));
      assert.strictEqual(memo.pattern(flat, 'chat'), null, 'called using a computer a habit');

      // An unknown event name changes nothing at all.
      assert.strictEqual(memo.note(m, 'keystrokes', MON_9PM), m);
    }

    // --- seen: days, the care record, and noticing an absence ----------------
    {
      let m = memo.fresh(at(2026, 0, 5, 10));
      m = memo.note(m, 'care', at(2026, 0, 5, 10));
      m = memo.note(m, 'care', at(2026, 0, 5, 11));
      assert.strictEqual(m.care.n, 2);

      m = memo.seen(m, at(2026, 0, 6, 10));
      assert.strictEqual(m.days, 2);
      assert.strictEqual(m.care.n, 0, 'today did not start fresh');
      assert.strictEqual(m.care.best, 2, 'yesterday was not recorded as the best');
      assert.strictEqual(m.care.bestDay, '2026-01-05');

      // A quieter day must not overwrite the record.
      m = memo.note(m, 'care', at(2026, 0, 6, 12));
      m = memo.seen(m, at(2026, 0, 7, 10));
      assert.strictEqual(m.care.best, 2, 'a worse day replaced the record');

      // Same day twice is not two days.
      const twice = memo.seen(memo.seen(m, at(2026, 0, 7, 11)), at(2026, 0, 7, 12));
      assert.strictEqual(twice.days, m.days, 'ticking counted extra days');

      // Overnight is not an absence; a week is.
      assert.strictEqual(memo.seen(m, at(2026, 0, 8, 9)).away, 0, 'overnight counted as away');
      assert.ok(memo.seen(m, at(2026, 0, 14, 9)).away >= memo.AWAY_MS);
    }

    // --- remark: one thing at a time, and never the same thing twice ---------
    {
      let m = memo.fresh(at(2026, 0, 1, 9));
      m = { ...m, lastSeen: at(2026, 0, 1, 9) };
      m = memo.seen(m, at(2026, 0, 8, 9));

      const away = memo.remark(m, at(2026, 0, 8, 9), { cheek: false });
      assert.ok(away && /gone 7 days/.test(away.text), `wrong absence line: ${away && away.text}`);
      // Consumed, so it is mentioned once and not every hour and a half after.
      assert.strictEqual(away.mem.away, 0, 'the absence was not cleared');
      // ...and throttled, so nothing else piles in behind it.
      assert.strictEqual(
        memo.remark(away.mem, at(2026, 0, 8, 10), { cheek: true }), null,
        'the pet talked twice inside the throttle'
      );

      // A milestone is announced once and then never again.
      let old = { ...memo.fresh(0), days: 30, lastRemarkAt: 0 };
      const first = memo.remark(old, MON_9PM, { cheek: false });
      assert.ok(first && /30 days/.test(first.text), `no milestone: ${first && first.text}`);
      assert.strictEqual(first.mem.toldDays, 30);
      const again = memo.remark(
        { ...first.mem, lastRemarkAt: 0 }, MON_9PM, { cheek: false }
      );
      assert.ok(!again || !/30 days/.test(again.text), 'the milestone repeated');

      // A routine comes up at the hour you gave it, and once a day at most.
      let r = memo.remember(memo.fresh(0), 'stretch', MON_9PM, 21).mem;
      const due = memo.remark({ ...r, days: 3 }, MON_9PM, { cheek: false });
      assert.ok(due && due.text.includes('stretch'), `routine missed: ${due && due.text}`);
      assert.strictEqual(
        memo.remark({ ...due.mem, lastRemarkAt: 0 }, MON_9PM + 60000, { cheek: false }), null,
        'the routine repeated within the day'
      );
      // The wrong hour is not the hour.
      assert.ok(
        !(memo.remark({ ...r, days: 3 }, at(2026, 0, 5, 14), { cheek: false }) || {})
          .text?.includes('stretch'),
        'a routine fired at the wrong hour'
      );
    }

    // --- cheek: teasing with real numbers, or not at all ---------------------
    {
      // It needs a yesterday before it is allowed to have an opinion about today.
      const fresh = { ...memo.fresh(0), care: { n: 0, best: 9, bestDay: '2026-01-04' } };
      assert.strictEqual(memo.dig(fresh, at(2026, 0, 5, 15)), null, 'teased on day one');

      const known = { ...fresh, days: 5 };
      const line = memo.dig(known, at(2026, 0, 5, 15));
      assert.ok(line && line.includes('9') && line.includes('2026-01-04'), `made up: ${line}`);

      // Every line it can produce has to be backed by something recorded, so an
      // empty memory has nothing to say however cheeky the setting is.
      const blank = { ...memo.fresh(0), days: 3 };
      assert.strictEqual(memo.dig(blank, at(2026, 0, 5, 15)), null, 'invented something to tease with');
      assert.strictEqual(
        memo.remark(blank, at(2026, 0, 5, 15), { cheek: true }), null,
        'remark found a dig where dig found none'
      );

      // The switch is a switch.
      const cross = { ...memo.fresh(0), days: 3, cross: 2, lastRemarkAt: 0 };
      assert.ok(memo.remark(cross, MON_9PM, { cheek: true }), 'cheek on said nothing');
      assert.strictEqual(memo.remark(cross, MON_9PM, { cheek: false }), null, 'cheek off still teased');
    }

    // --- listing -------------------------------------------------------------
    {
      assert.ok(/nothing yet/.test(memo.listing(memo.fresh(0))));
      let m = memo.fresh(0);
      for (let i = 0; i < 5; i++) m = memo.remember(m, `thing ${i}`, i).mem;
      const said = memo.listing(m, 2);
      assert.ok(said.includes('thing 4') && said.includes('and 3 more'), `bad listing: ${said}`);
    }
  }

  // --- the language half: what actually reaches memory.js --------------------
  {
    const skills = require('../src/core/skills');
    const ctx = { now: new Date(MON_9PM), rand: () => 0 };
    const run = (t) => skills.match(t, ctx);

    const noted = run('remember my standup is at 9:30');
    assert.strictEqual(noted.name, 'remember');
    assert.strictEqual(noted.memory.text, 'my standup is at 9:30');
    assert.strictEqual(noted.memory.hour, 9, 'the clock in a routine was not picked up');

    // A leading "to" is a task, not a fact.
    assert.strictEqual(run('remember to feed the cat').memory.text, 'feed the cat');

    // ...and with a time in it, it is a reminder and belongs to the timer skill.
    const timed = run('remember to feed the cat in 20 minutes');
    assert.strictEqual(timed.name, 'timer');
    assert.strictEqual(timed.timer.say, 'time to feed the cat!');

    // A sentence is allowed past the command length cap; a document is not.
    const long = `remember ${'the cat likes it warm. '.repeat(4)}`.trim();
    assert.ok(long.length > skills.MAX_COMMAND_CHARS);
    assert.strictEqual(run(long).name, 'remember', 'a long routine fell through to the model');
    assert.strictEqual(run(`remember ${'x'.repeat(400)}`), null, 'a pasted document became a fact');
    // ...and the cap is still on for everything else.
    assert.strictEqual(run(`flip a coin ${'and think about it '.repeat(6)}`), null);

    assert.strictEqual(run('what do you remember?').memory.list, true);

    assert.strictEqual(run('forget everything').memory.forget, null);
    assert.strictEqual(run('forget it all').memory.forget, null);
    assert.strictEqual(run('forget the standup').memory.forget, 'standup');
    // The one that has to fall through: people say this in conversation.
    assert.strictEqual(run('forget it'), null, '"forget it" deleted memories');
  }

  // ===== going outside ========================================================
  //
  // Everything below only runs when the network switch is on. These check the
  // switch actually gates, and that what leaves carries what it says it does.

  {
    const providers = require('../src/core/providers');
    const net = require('../src/core/net');
    const config = require('../src/core/settings');

    // --- the master switch ---------------------------------------------------
    assert.strictEqual(config.load({}).network, false, 'the network defaulted to on');
    for (const field of ['weather', 'web']) {
      assert.strictEqual(
        config.load({ [field]: true })[field], false,
        `${field} switched itself on with the network off`
      );
      assert.strictEqual(config.load({ network: true, [field]: true })[field], true);
    }
    // Turning the master switch off has to take the rest with it in one pass.
    const wired = config.load({ network: true, weather: true, web: true, provider: 'openai' });
    const sealed = config.merge(wired, { network: false });
    assert.deepStrictEqual(
      [sealed.weather, sealed.web, sealed.provider], [false, false, 'ollama'],
      'switching the network off left something reachable'
    );

    // --- the provider choice -------------------------------------------------
    assert.strictEqual(config.load({}).provider, 'ollama');
    assert.strictEqual(
      config.load({ provider: 'openai' }).provider, 'ollama',
      'a hosted provider was accepted with the network off'
    );
    assert.strictEqual(
      config.load({ network: true, provider: 'not-a-company' }).provider, 'ollama',
      'an unknown provider was accepted'
    );
    // A model name lands in a request body and, for Gemini, in a path segment.
    for (const [bad, why] of [
      ['../../admin', 'path traversal'],
      ['a b?c=1', 'a query string'],
      ['x', 'too short'],
    ]) {
      const got = config.load({ network: true, provider: 'openai', providerModel: bad }).providerModel;
      assert.ok(!/[?=]/.test(got) && !got.includes('..'), `model name let ${why} through: ${got}`);
    }

    // --- the key never travels in a URL --------------------------------------
    //
    // A URL is the part of a request that ends up in logs, history and
    // referrers. Every provider here has to carry the key in a header.
    for (const name of providers.NAMES) {
      if (providers.isLocal(name)) continue;
      const url = providers.urlFor(name, providers.modelFor(name, ''));
      assert.ok(url.startsWith('https://'), `${name} is not https`);
      assert.ok(!/key|token|auth/i.test(url), `${name} puts credentials in the URL: ${url}`);
    }

    // --- each shape sends what that provider actually reads -------------------
    const KEY = 'sk-test-not-a-real-key-000';
    const seen = {};
    const spy = async (url, init) => {
      seen.url = url;
      seen.init = init;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'openai said this' } }],
          content: [{ type: 'text', text: 'anthropic said this' }],
          candidates: [{ content: { parts: [{ text: 'gemini said this' }] } }],
        }),
      };
    };

    for (const [name, header, expect] of [
      ['openai', 'authorization', 'openai said this'],
      ['nvidia', 'authorization', 'openai said this'],
      ['mistral', 'authorization', 'openai said this'],
      ['anthropic', 'x-api-key', 'anthropic said this'],
      ['gemini', 'x-goog-api-key', 'gemini said this'],
    ]) {
      const out = await providers.generate('a prompt', { provider: name, key: KEY, fetch: spy });
      assert.strictEqual(out, expect, `${name} read the wrong field`);
      const headers = seen.init.headers;
      assert.ok(
        String(headers[header]).includes(KEY),
        `${name} did not send the key in ${header}`
      );
      assert.ok(!seen.url.includes(KEY), `${name} leaked the key into the URL`);
      assert.ok(!seen.init.body.includes(KEY), `${name} leaked the key into the body`);
      assert.ok(seen.init.body.includes('a prompt'), `${name} lost the prompt`);
    }

    // No key, no request at all.
    let called = false;
    await assert.rejects(
      () => providers.generate('p', { provider: 'openai', fetch: async () => { called = true; } }),
      /key/i
    );
    assert.strictEqual(called, false, 'a request went out with no key');
    await assert.rejects(() => providers.generate('p', { provider: 'ollama', key: 'x' }));

    // Failures go in a speech bubble, so none of them may carry the key or the
    // provider's own error body - some of them echo the request back.
    const angry = async () => ({ ok: false, status: 401, json: async () => ({ error: KEY }) });
    await assert.rejects(
      () => providers.generate('p', { provider: 'openai', key: KEY, fetch: angry }),
      (e) => !e.message.includes(KEY) && /refused/.test(e.message)
    );
    for (const status of [401, 403, 404, 429, 500, 418]) {
      assert.ok(providers.failure(status).length < 80, `failure(${status}) is not bubble-sized`);
    }

    // --- what the screen path sends to a company -----------------------------
    //
    // The whole trade of this setting. Redaction is not optional on the way out.
    const grab = { };
    const catcher = async (_url, init) => {
      grab.body = init.body;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    };
    await ask('the token is ghp_ABCDEFGHIJKLMNOPQRST1234 and 2+2?', {
      provider: 'openai', key: KEY, fetch: catcher,
    });
    assert.ok(grab.body.includes('[REDACTED]'), 'screen text reached a provider unredacted');
    assert.ok(!grab.body.includes('ghp_ABC'), 'a token reached a provider');

    // Typed chat is redacted too when it is going to a company, and left alone
    // when it is not - they are your own words on a machine you own.
    await chat('my key is sk-abcdefghijklmnop1234', { provider: 'openai', key: KEY, fetch: catcher });
    assert.ok(!grab.body.includes('sk-abcdefghijklmnop'), 'a pasted key reached a provider');
    await chat('my key is sk-abcdefghijklmnop1234', { fetch: cgrab, model: 'm' });
    assert.ok(cbody.prompt.includes('sk-abcdefghijklmnop'), 'local chat was redacted for no reason');

    // A screenshot cannot be redacted, so it is never sent to one.
    let uploaded = false;
    const shot = await askVision('AAAA', {
      provider: 'openai', key: KEY, fetch: async () => { uploaded = true; },
    });
    assert.strictEqual(uploaded, false, 'a screenshot was uploaded to a hosted provider');
    assert.strictEqual(shot, EMPTY_SCREEN);

    // --- the web lookup ------------------------------------------------------
    assert.strictEqual(net.cleanQuery('  the speed  of light '), 'the speed of light');
    assert.strictEqual(net.cleanQuery('x'.repeat(200)), null, 'a pasted wall became a query');
    assert.strictEqual(net.cleanQuery(''), null);
    assert.strictEqual(net.cleanQuery(42), null);

    const urls = [];
    const ddg = async (url) => {
      urls.push(url);
      return url.includes('duckduckgo')
        ? { ok: true, json: async () => ({ Answer: '299792458 m/s' }) }
        : { ok: true, json: async () => ([]) };
    };
    assert.strictEqual(await net.lookup('speed of light', { fetch: ddg }), '299792458 m/s');
    assert.ok(urls[0].startsWith(net.DDG_HOST), 'the lookup went somewhere unexpected');
    assert.ok(!/[<>"']/.test(urls[0]), 'the query was not encoded into the URL');

    // Everything the request carries, named. `t` is DuckDuckGo's convention for
    // an application identifying itself, and the Privacy Policy says so - it has
    // to stay a fixed string, because a per-user or per-install value in here
    // would turn an anonymous lookup into a traceable one without changing a
    // single line that looks like it is about privacy.
    const params = new URL(urls[0]).searchParams;
    assert.deepStrictEqual(
      [...params.keys()].sort(), ['format', 'no_html', 'q', 'skip_disambig', 't'],
      'the lookup carries a parameter the Privacy Policy does not mention'
    );
    assert.strictEqual(params.get('t'), 'screenpet', 'the app tag is no longer a fixed string');
    assert.strictEqual(params.get('q'), 'speed of light', 'the query is not what was typed');

    // Nothing from an instant answer falls through to the encyclopedia, and only
    // ever to these two hosts.
    urls.length = 0;
    const wiki = async (url) => {
      urls.push(url);
      if (url.includes('duckduckgo')) return { ok: true, json: async () => ({}) };
      if (url.includes('opensearch')) return { ok: true, json: async () => (['q', ['Photon'], [], []]) };
      return { ok: true, json: async () => ({ extract: 'A photon is a particle.' }) };
    };
    assert.strictEqual(await net.lookup('photon', { fetch: wiki }), 'A photon is a particle.');
    for (const url of urls) {
      assert.ok(
        url.startsWith(net.DDG_HOST) || url.startsWith(net.WIKI_HOST),
        `the lookup reached an unexpected host: ${url}`
      );
    }
    await assert.rejects(() => net.lookup('nothing', {
      fetch: async () => ({ ok: true, json: async () => ({}) }),
    }));

    // --- the lookup skill ----------------------------------------------------
    const skills = require('../src/core/skills');
    const sctx = { now: new Date(MON_9PM), rand: () => 0 };
    assert.strictEqual(skills.match('look up the speed of light', sctx).lookup, 'the speed of light');
    assert.strictEqual(skills.match('search for tardigrades', sctx).lookup, 'tardigrades');
    assert.strictEqual(skills.match('who is ada lovelace?', sctx).lookup, 'ada lovelace');
    // With the setting off this is the answer, and it does not pretend otherwise.
    assert.ok(/settings/.test(skills.match('google tardigrades', sctx).say));
    // The ones that must reach the model instead of an encyclopedia.
    for (const own of [
      'what is a closure', 'how do I look up a value in a map', 'what is the time',
    ]) {
      const hit = skills.match(own, sctx);
      assert.ok(!hit || !hit.lookup, `"${own}" was sent to the web`);
    }
  }

  // --- the settings gate ------------------------------------------------------
  {
    const config = require('../src/core/settings');
    const on = config.load({});
    assert.strictEqual(on.memory, true, 'memory should be on by default');
    assert.strictEqual(on.cheek, true);

    assert.strictEqual(config.load({ memory: false }).memory, false);
    // No memory, nothing to be cheeky about.
    assert.strictEqual(config.load({ memory: false, cheek: true }).cheek, false);
    assert.strictEqual(config.load({ cheek: false }).cheek, false);
    // Neither is a device, so neither can be turned on by a truthy string.
    assert.strictEqual(config.load({ memory: 'no' }).memory, true);
  }

  // --- the noise it makes -----------------------------------------------------
  // Whether it is audible is a question only an audio context can answer, and
  // verify-ui renders every one of these offline and measures it. What is
  // checkable here is that the tables agree with the rest of the app: a species
  // with no recipe is a silent pet, and a face routed to a feeling that does not
  // exist would quietly fall back to neutral forever.
  {
    const voices = require('../src/renderer/voices');
    const config = require('../src/core/settings');

    for (const species of config.PETS) {
      assert.ok(voices.VOICES[species], `${species} has no voice`);
    }
    assert.strictEqual(
      Object.keys(voices.VOICES).length, config.PETS.length,
      'there is a voice for a species that does not exist'
    );
    // An unknown species makes no noise rather than a default woof: a typo you
    // cannot hear is a typo nobody finds.
    const silent = { currentTime: 0, createGain: () => { throw new Error('made a noise'); } };
    assert.strictEqual(voices.sound(silent, 'ferret', 'smile'), 0);

    for (const [face, feeling] of Object.entries(voices.FEELING_OF)) {
      assert.ok(voices.FEELINGS[feeling], `${face} sounds ${feeling}, which is not a feeling`);
    }

    // --- the calls: a feeling with a sound of its own ---
    // Bending pitch and speed covers most faces, but not the ones where the
    // animal has a different sound entirely - a cross cat hisses, it does not
    // meow faster. Those are hand-written, and the table must stay reachable:
    // a call filed under a species or a feeling that does not exist is a sound
    // nothing can ever play.
    for (const [species, calls] of Object.entries(voices.CALLS)) {
      assert.ok(voices.VOICES[species], `there are calls for ${species}, which has no voice`);
      for (const [feeling, recipe] of Object.entries(calls)) {
        assert.ok(voices.FEELINGS[feeling], `${species} has a call for ${feeling}, which is not a feeling`);
        assert.strictEqual(typeof recipe, 'function', `${species}/${feeling} is not a recipe`);
      }
      // A call for neutral would be the ordinary voice under another name.
      assert.ok(!calls.neutral, `${species} has a "call" for neutral, which is just its voice`);
    }
    // Cross is the feeling most worth having its own sound - it is the one that
    // bending a pitch expresses worst - so every species gets one.
    for (const species of config.PETS) {
      assert.ok(voices.callFor(species, 'cross'), `${species} has no cross of its own`);
    }
    assert.strictEqual(voices.callFor('ferret', 'cross'), null, 'an unknown species had a call');
    assert.strictEqual(voices.callFor('cat', 'neutral'), null, 'neutral is not a call');
    assert.strictEqual(voices.feelingOf('rage'), 'cross');
    assert.strictEqual(voices.feelingOf('doze'), 'sleepy');
    assert.strictEqual(voices.feelingOf(pets.expressionFor('refuse')), 'sad');
    // Anything unlisted, including nothing at all, is neutral rather than a throw.
    assert.strictEqual(voices.feelingOf('hmm'), 'neutral');
    assert.strictEqual(voices.feelingOf(undefined), 'neutral');
    // The four the pet wears most often must not all come out the same.
    const often = ['love', 'cry', 'rage', 'doze'].map(voices.feelingOf);
    assert.strictEqual(new Set(often).size, 4, 'the pet sounds identical happy and sad');

    // A face given a sound but never drawn is a typo in the table above.
    const drawn = new Set(
      require('fs').readFileSync('./src/renderer/style.css', 'utf8')
        .match(/data-expr="[a-z]+"/g)
        .map((s) => s.slice(11, -1))
    );
    for (const face of Object.keys(voices.FEELING_OF)) {
      assert.ok(drawn.has(face), `${face} is given a sound but is never drawn`);
    }

    // On by default, off only when asked, and not turned on by a leftover string.
    assert.strictEqual(config.load({}).sounds, true);
    assert.strictEqual(config.load({ sounds: false }).sounds, false);
    assert.strictEqual(config.load({ sounds: 'off' }).sounds, true);

    // Wiring: the renderer only barks with the setting on, and never over its
    // own thinking face.
    const rjs = require('fs').readFileSync('./src/renderer/renderer.js', 'utf8');
    assert.ok(/if \(!soundsOn\) return;/.test(rjs), 'the noise ignores the setting');
    assert.ok(/if \(!busy\) bark\(expr\);/.test(rjs), 'the pet barks while thinking');
    assert.ok(
      require('fs').readFileSync('./src/main.js', 'utf8').includes('sounds: settings.sounds'),
      'main never tells the renderer whether noises are on'
    );
  }

  // --- skins --------------------------------------------------------------
  {
    const fs = require('fs');
    const config = require('../src/core/settings');
    const pcss = fs.readFileSync('./src/renderer/pets.css', 'utf8');

    for (const skin of config.SKINS) {
      const rule = pcss.match(new RegExp(`\\[data-skin="${skin}"\\][^{]*\\{([^}]+)\\}`));
      assert.ok(rule, `skin "${skin}" is offered and never defined`);
      for (const v of ['--body', '--ear', '--cheek']) {
        assert.ok(rule[1].includes(v), `skin "${skin}" leaves ${v} to whatever was set last`);
      }
    }
    for (const [, skin] of pcss.matchAll(/\[data-skin="([a-z]+)"\]/g)) {
      assert.ok(config.SKINS.includes(skin), `"${skin}" is drawn and cannot be picked`);
    }
    assert.strictEqual(config.load({ skin: 'chartreuse' }).skin, 'butter');

    // The swatch takes its colour from the same three variables the pet does.
    // A second copy of every palette in settings.css is how a new skin ends up
    // a colourless circle nobody notices until it ships.
    const scss = fs.readFileSync('./src/renderer/settings.css', 'utf8');
    assert.ok(/\.swatch \{[^}]*background: var\(--body\)/.test(scss), 'the swatch has no colour');
    assert.ok(
      !/\.swatch\[data-skin/.test(scss),
      'settings.css names a skin, so palettes now live in two files'
    );
  }

  // --- the wardrobe -------------------------------------------------------
  {
    const fs = require('fs');
    const config = require('../src/core/settings');
    const css = fs.readFileSync('./src/renderer/pets.css', 'utf8');
    const html = fs.readFileSync('./src/renderer/index.html', 'utf8');

    // Nothing by default, and an outfit nobody drew is not wearable.
    assert.strictEqual(config.load({}).wear, 'none');
    assert.strictEqual(config.load({ wear: 'hero' }).wear, 'hero');
    assert.strictEqual(config.load({ wear: 'sombrero' }).wear, 'none');
    assert.strictEqual(config.load({ wear: ['hero'] }).wear, 'none');

    for (const outfit of config.WEAR) {
      if (outfit === 'none') continue;
      assert.ok(
        css.includes(`[data-wear="${outfit}"]`),
        `"${outfit}" is on the list and the stylesheet does not draw it`
      );
    }
    // And the other way: a rule nobody can select is a rule nobody sees.
    for (const [, outfit] of css.matchAll(/\[data-wear="([a-z]+)"\]/g)) {
      assert.ok(config.WEAR.includes(outfit), `the stylesheet draws "${outfit}" and it cannot be chosen`);
    }

    // Every part an outfit switches on has to exist in the markup, and start off.
    for (const part of ['cape', 'mask', 'hat-party', 'hat-wizard', 'crown', 'cans']) {
      assert.ok(html.includes(`class="${part}"`), `the wardrobe wears .${part} and nothing draws it`);
    }
    assert.ok(
      /\.cape, \.wardrobe > \* \{ display: none; \}/.test(css),
      'the wardrobe is not hidden by default, so the pet wears everything at once'
    );

    // The cape has to be behind the body for the same reason the tail is.
    assert.ok(
      html.indexOf('class="cape"') < html.indexOf('class="body"'),
      'the cape is drawn in front of the body, which makes it a bib'
    );
    // The mask is holes rather than lenses. Without this the eyes - and with
    // them the gaze, the blink and most of the forty faces - go under it.
    assert.ok(
      /class="mask"[\s\S]{0,80}fill-rule="evenodd"/.test(html),
      'the mask is a solid shape over both eyes'
    );

    // Wiring, both ways: main offers the list and pushes the choice, the
    // renderer puts it where the stylesheet is looking.
    const mjs = fs.readFileSync('./src/main.js', 'utf8');
    assert.ok(mjs.includes('wear: config.WEAR'), 'the settings window is never told what there is to wear');
    assert.ok(mjs.includes('wear: settings.wear'), 'main never tells the pet what it has on');
    assert.ok(
      fs.readFileSync('./src/renderer/renderer.js', 'utf8')
        .includes("document.documentElement.dataset.wear = wear || 'none'"),
      'the renderer never puts the outfit on the root element'
    );
  }

  // --- what each host can do, and what it says when it cannot ---
  {
    const fs = require('fs');
    const hostjs = require('../src/system/host');
    const { KEYS } = require('../src/system/media');

    // Windows is the platform this ships on; every capability must exist there.
    for (const name of Object.keys(hostjs.CAPABILITIES)) {
      assert.ok(hostjs.supports(name, 'win32'), `${name} is missing on Windows`);
    }

    // macOS has all of it except the two that need a recogniser holding the
    // microphone. Pinned in both directions: quietly gaining `wake` on macOS
    // would mean a switch that does nothing, and quietly losing `ocr` would
    // mean the whole app does nothing.
    const mac = Object.keys(hostjs.CAPABILITIES).filter((n) => hostjs.supports(n, 'darwin'));
    assert.deepStrictEqual(
      mac.sort(), ['dnd', 'faces', 'keys', 'media', 'ocr'],
      'the macOS capability list changed'
    );

    // Nothing is offered on a platform with no implementation at all.
    for (const name of Object.keys(hostjs.CAPABILITIES)) {
      assert.ok(!hostjs.supports(name, 'linux'), `${name} claims to work on Linux, where nothing was written`);
    }

    // These sentences are read out by the pet, so they have to be sentences.
    for (const cap of hostjs.report('linux')) {
      assert.ok(!cap.ready, `${cap.name} reports ready on a platform it does not support`);
      assert.match(cap.why, /^I .*!$/, `${cap.name}'s refusal does not sound like the pet: ${cap.why}`);
      assert.ok(!/[A-Z][a-z]+\.[A-Z]/.test(cap.why), `${cap.name}'s refusal names an API: ${cap.why}`);
    }

    // The macOS helper is one binary answering three different callers. If
    // host.js names a subcommand the Swift does not implement, nothing on
    // Windows fails and the Mac fails at the worst possible moment.
    const swift = fs.readFileSync('./src/system/mac/screenpet-helper.swift', 'utf8');
    for (const name of ['ocr', 'faces', 'keys']) {
      const [exe, args] = hostjs.CAPABILITIES[name].on.darwin();
      if (exe !== hostjs.HELPER) continue;
      assert.ok(
        new RegExp(`case "${args[0]}"`).test(swift),
        `host.js asks the macOS helper for "${args[0]}" and the helper has no such case`
      );
    }
    // keys.js sends these two words and nothing else sends anything.
    for (const mode of ['protect', 'unprotect']) {
      assert.ok(swift.includes(`case "${mode}"`), `the macOS helper cannot ${mode} a key`);
    }

    // Same drift, other file: a media key added to KEYS but not to the
    // AppleScript would work on Windows and quietly do nothing on a Mac.
    const applescript = fs.readFileSync('./src/system/mac/media.applescript', 'utf8');
    for (const key of Object.keys(KEYS)) {
      assert.ok(
        applescript.includes(`"${key}"`),
        `media.js knows the key "${key}" and media.applescript does not`
      );
    }

    // Dictation is the one capability whose absence has a fallback rather than
    // a refusal, and main.js is where that decision lives.
    const mjs = fs.readFileSync('./src/main.js', 'utf8');
    assert.ok(
      mjs.includes("const sapi = host.supports('listen')"),
      'main.js still assumes Windows dictation exists'
    );
  }

  // --- the layout the build config assumes ---
  {
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

    assert.ok(fs.existsSync(pkg.main), `the entry point ${pkg.main} does not exist`);

    // asarUnpack is the glob src/system/*.ps1, so a script anywhere else is
    // packed into the asar - where PowerShell cannot read it. That failure only
    // shows up in a built app, never in development, which is why it is checked
    // here rather than trusted to whoever adds the next one.
    const stray = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ps1') && dir !== './src/system') stray.push(p);
      }
    })('.');
    assert.deepStrictEqual(stray, [], 'PowerShell scripts outside src/system are packed into the asar unreadable');
  }

  // --- its own voice for its own words ---
  {
    const mjs = require('fs').readFileSync('./src/main.js', 'utf8');

    // The rule is mechanical on purpose: words that came out of the line bank
    // are the pet talking, and the pet talks in chirps. Anything else - an
    // answer, a lookup, an error, the time - is information, and information is
    // read out in words. A line bank send that forgets to say so is a Windows
    // voice reading "I would defragment a hard drive for you".
    for (const at of [...mjs.matchAll(/pets\.line\(/g)].map((m) => m.index)) {
      const send = mjs.slice(at, mjs.indexOf('});', at) + 3);
      assert.ok(
        /chatter:/.test(send),
        `a line bank send does not say whether it chirps:\n${send.slice(0, 220)}`
      );
    }

    // And the two that must never be chirped, because you asked a question to
    // get them: the answer off the screen, and anything a skill worked out.
    assert.ok(/kind: 'answer',\s*\n\s*expr[^}]*chatter: !answer/.test(mjs)
      || /chatter: !answer/.test(mjs), 'the screen answer no longer decides by whether there is one');
    assert.ok(
      !/kind: 'error'[^}]*chatter: true/.test(mjs),
      'an error is chirped, so the one line that says what went wrong is unreadable out loud'
    );
  }

  // --- put anywhere, never off the screen ---
  {
    const now = 1000;
    const at = (place) => pets.load({ ...pets.fresh(now), place }, now).place;

    // Nothing until you move it by hand. That is also what tells the pet to
    // stop wandering, so a default of {x:0,y:0} would park it top left and
    // freeze it there.
    assert.strictEqual(pets.load({}, now).place, null, 'a fresh pet claims to have been placed');
    for (const junk of [null, 'left', 42, {}, { x: 1 }, { x: 'a', y: 0 }, { x: NaN, y: 0 }]) {
      assert.strictEqual(at(junk), null, `${JSON.stringify(junk)} was accepted as a position`);
    }

    // Fractions of the room available, so the same file works on a different
    // monitor. Clamped here as well as in the renderer: a hand-edited file must
    // not be able to put the pet on a screen that is not there.
    assert.deepStrictEqual(at({ x: 0.25, y: 0.5 }), { x: 0.25, y: 0.5 });
    assert.deepStrictEqual(at({ x: 9000, y: -9000 }), { x: 1, y: 0 }, 'a position off the display survived');

    // It has to ride along with the rest of the state, or it is lost on the
    // next tick rather than on a restart - which is much harder to notice.
    const placed = pets.load({ place: { x: 0.4, y: 0.2 } }, now);
    assert.deepStrictEqual(pets.tick(placed, now + 3600000).place, { x: 0.4, y: 0.2 },
      'the placement is dropped by the next tick');
    assert.deepStrictEqual(pets.act(placed, 'feed', now + 1000).state.place, { x: 0.4, y: 0.2 },
      'feeding the pet forgets where it is standing');

    // Parking it is a home, not a peg. It used to be a peg: one drag ever set a
    // flag that stopped wander() dead, the flag was restored from disk at
    // launch, and a pet parked once was still standing in that exact spot
    // months later. Both things people want are true of a real pet - it stays
    // where you put it, and it moves.
    const rjs = require('fs').readFileSync('./src/renderer/renderer.js', 'utf8');
    const roam = rjs.slice(rjs.indexOf('function wanderTo('), rjs.indexOf('function quirk('));
    // Where it goes has to know about home...
    assert.ok(/home/.test(roam), 'wandering ignores where you parked it');
    // ...and whether it goes at all must not. That is the exact line that was
    // wrong, so it is the exact line pinned: any `!home` or `!placed` in the
    // decision to move is the cage back.
    const gate = roam.slice(roam.indexOf('function wander('));
    assert.ok(!/!\s*(home|placed)\b/.test(gate), 'being parked still stops the pet moving at all');
    assert.ok(/idle\(\)/.test(gate), 'the pet wanders off mid-sentence');
  }

  // --- reading the window rather than the wall ---
  {
    const win = require('../src/system/window');
    const display = { bounds: { x: 0, y: 0 }, scaleFactor: 1.25 };
    const image = { width: 1920, height: 1080 };
    const crop = (r, d = display, i = image) => win.cropFor(r, d, i);

    // The ordinary case: a window somewhere on the screen, cropped to it.
    assert.deepStrictEqual(
      crop({ x: 100, y: 50, w: 800, h: 600 }),
      { x: 100, y: 50, width: 800, height: 600 }
    );

    // Every one of these means "read the whole screen", which is what this app
    // did before there was a crop at all. None of them is an error.
    assert.strictEqual(crop(null), null, 'no window rectangle still tried to crop');
    assert.strictEqual(crop({ x: -9, y: -9, w: 1938, h: 1098 }), null,
      'cropped to a maximised window, which gains nothing and can lose an edge');
    assert.strictEqual(crop({ x: 10, y: 10, w: 260, h: 150 }), null,
      'cropped to a dialog too small to hold a question');
    assert.strictEqual(crop({ x: 1800, y: 10, w: 900, h: 700 }), null,
      'cropped to the sliver of a window that is mostly on the other monitor');
    assert.strictEqual(crop({ x: 4000, y: 0, w: 800, h: 600 }), null,
      'cropped to a window that is not on this display at all');

    // The second monitor, whose origin is not zero. Getting this wrong crops
    // the right size from the wrong place, which looks like the model has
    // started answering about somebody else's screen.
    assert.deepStrictEqual(
      crop({ x: 2020, y: 60, w: 800, h: 600 }, { bounds: { x: 1536, y: 0 }, scaleFactor: 1.25 }),
      { x: 100, y: 60, width: 800, height: 600 }
    );

    // A window half off the left edge is clipped rather than refused - the part
    // you can see is the part you were reading.
    assert.deepStrictEqual(
      crop({ x: -200, y: 100, w: 1000, h: 700 }),
      { x: 0, y: 100, width: 800, height: 700 }
    );

    // Windows only, and the sentence for everywhere else is a sentence.
    const hostjs = require('../src/system/host');
    assert.ok(hostjs.supports('window', 'win32'), 'the window rectangle is missing on Windows');
    assert.ok(!hostjs.supports('window', 'darwin'), 'macOS claims a window rectangle it cannot get');
    assert.ok(/^I .*!$/.test(hostjs.CAPABILITIES.window.why), 'the refusal is not something the pet can say');

    // The script prints a rectangle and nothing else. A title or a process name
    // would be the pet knowing which application you are in, which is not a
    // thing it needs to crop a screenshot.
    const ps1 = require('fs').readFileSync('./src/system/window.ps1', 'utf8');
    assert.ok(!/GetWindowText|ProcessName|GetClassName/.test(ps1),
      'the window script asks for more than a rectangle');
    assert.ok(/SetProcessDPIAware/.test(ps1),
      'without this Windows lies about every coordinate on a scaled display');
  }

  // --- a pet that turns rather than a sticker that spins ---
  {
    const lit = require('../src/renderer/lighting');

    // Standing still, the lamp is where it always was.
    const still = lit.lightFor(0);
    assert.strictEqual(Math.round(still.x), lit.LIGHT.x);
    assert.strictEqual(Math.round(still.z), lit.LIGHT.z);

    // Halfway round, the pet is mirrored - so the lamp has to be the same
    // distance the other side of its middle, or the bright side is the side
    // facing away from it. This is the whole reason the spin looked flat.
    const half = lit.lightFor(180);
    assert.strictEqual(
      Math.round(half.x - lit.CENTRE_X),
      lit.CENTRE_X - lit.LIGHT.x,
      'halfway through a turn the light is still on the side it started'
    );

    // ...and behind. Past a quarter turn the lamp is on the far side of the pet
    // and the face you are looking at goes dark on its own, which is the part
    // that reads as solid rather than as a picture being rotated.
    assert.ok(half.z < 0, 'the light never goes behind the pet, so it never shades');
    assert.ok(lit.lightFor(90).z > 0, 'the light is behind the pet at a quarter turn');

    // Back where it started after a full turn, or every spin leaves the pet lit
    // slightly differently than the last one did.
    const round = lit.lightFor(360);
    assert.ok(Math.abs(round.x - lit.LIGHT.x) < 0.01 && Math.abs(round.z - lit.LIGHT.z) < 0.01,
      'a full turn does not put the light back where it was');
  }

  // --- noticing you move between windows ---
  {
    const win = require('../src/system/window');

    // The one place that process is believed. Half a line arrives constantly -
    // stdout does not respect message boundaries - and every unbelievable shape
    // has to come back as "nothing happened" rather than as a glance at 0,0.
    assert.deepStrictEqual(
      win.parse('{"x":100,"y":50,"w":800,"h":600}\r'),
      { x: 100, y: 50, w: 800, h: 600 }
    );
    for (const bad of [
      '', '{"x":100,"y":50,"w":800', 'WARNING: something', '{}',
      '{"x":null,"y":0,"w":8,"h":6}', '{"x":0,"y":0,"w":0,"h":600}',
    ]) {
      assert.strictEqual(win.parse(bad), null, `believed ${JSON.stringify(bad)}`);
    }

    // Only ever a rectangle crosses this boundary. The moment the watcher hands
    // over a title or a process name, the pet knows which applications you use
    // all day and this stops being a glance.
    const src = require('fs').readFileSync('./src/system/window.js', 'utf8');
    assert.ok(/onSwitch\(r\)/.test(src), 'the watcher passes on something other than the rectangle');

    // It has to be one process for the session. Spawning PowerShell per check is
    // ~400ms of process startup on a timer, which is the reason the pet did not
    // notice window switches before this existed.
    const ps1watch = require('fs').readFileSync('./src/system/window.ps1', 'utf8');
    assert.ok(/\[switch\]\$Watch/.test(ps1watch) && /while \(\$true\)/.test(ps1watch),
      'the watcher is not one long-lived process');
    // Compared by handle, not by rectangle: typing moves nothing and dragging a
    // window around is not you looking somewhere else.
    assert.ok(/\$hwnd -ne \$last/.test(ps1watch), 'the watcher fires on something other than a switch');
    // A window that vanished mid-poll must not take the watcher with it.
    assert.ok(/try \{[\s\S]*catch \{ \}/.test(ps1watch), 'a vanishing window kills the watcher');
    // And it must not outlive the app. unwatch() covers a normal quit; a crash
    // or a kill would otherwise leave it polling until the machine reboots.
    assert.ok(/\$parent\.HasExited/.test(ps1watch), 'the watcher survives the app that started it');

    // On a host that cannot answer, nothing is started and nothing throws: a
    // machine that never reports a switch and a machine with no switches look
    // the same from here.
    if (process.platform !== 'win32') {
      win.watch(() => { throw new Error('a switch was reported on a host that cannot see one'); });
      assert.strictEqual(win.watching(), false, 'watching a host that cannot be watched');
    }
    win.unwatch(); // safe with nothing running

    // Noticing you is the pet acting off its own bat, so it stops in the same
    // three places everything else the pet starts stops: mid-answer, asleep, and
    // while Windows says keep quiet.
    const mjs = require('fs').readFileSync('./src/main.js', 'utf8');
    const noticed = mjs.slice(mjs.indexOf('function noticed('), mjs.indexOf('---- renderer messaging'));
    assert.ok(/busy \|\| asleep\(\) \|\| \(quiet && !quietOverride\)/.test(noticed),
      'the pet gawps at windows during a game, a presentation, or its own answer');
    // Physical pixels in, points out. Doing this by hand is right on one machine
    // and wrong on every scaled display, so Electron does it.
    assert.ok(/screenToDipPoint/.test(noticed), 'the glance lands somewhere else on a scaled display');

    // The blink schedule is one chain however many callers there are. Without
    // this, every glance leaves another timer running and the pet flutters.
    const rjs = require('fs').readFileSync('./src/renderer/renderer.js', 'utf8');
    assert.ok(/clearTimeout\(blinkTimer\)/.test(rjs), 'a glance starts a second blink chain');
  }

  // --- eyes that are not a servo ---
  {
    const fs = require('fs');
    const css = fs.readFileSync('./src/renderer/style.css', 'utf8');
    const rjs = fs.readFileSync('./src/renderer/renderer.js', 'utf8');

    // A blink on a fixed interval forever is the single clearest tell that a
    // face is a loop rather than a creature, so the schedule lives in the
    // renderer where it can be uneven and can double.
    assert.ok(
      !/\.eyes\s*\{[^}]*animation:\s*blink[^}]*infinite/.test(css),
      'the blink is back on a fixed CSS loop'
    );
    assert.ok(/\.eyes\.is-blink\s*\{[^}]*animation:\s*blink/.test(css), 'nothing renders a blink at all');
    assert.ok(/is-blink/.test(rjs), 'the renderer never blinks the pet');

    // Overshoot: the eye goes a little past where it was going and comes back.
    // That is the whole difference between a glance and a servo, and in a
    // cubic-bezier it is one of the two control point heights being over 1.
    const curve = css.match(/\.gaze\s*\{[^}]*transition:[^;]*cubic-bezier\(([^)]*)\)/);
    assert.ok(curve, 'the gaze no longer eases at all');
    const [, y1, , y2] = curve[1].split(',').map(Number);
    assert.ok(
      Math.max(y1, y2) > 1,
      `the gaze eases straight to the target without overshooting: ${curve[1]}`
    );

    // It looks somewhere other than the cursor when nothing is moving. Eyes
    // that only ever track the one moving thing read as a sensor.
    assert.ok(/IDLE_GAZE_MS/.test(rjs), 'the pet stares at the cursor forever');
  }

  // --- one pet per machine ---
  {
    const mjs = require('fs').readFileSync('./src/main.js', 'utf8');

    // Found by installing the app and watching two copies run: the installer's
    // "run when finished" and one Start menu click is all it takes, and two
    // pets means two tray icons and a hotkey the second one loses.
    assert.ok(mjs.includes('app.requestSingleInstanceLock()'), 'nothing stops a second copy of the pet');
    assert.ok(mjs.includes("app.on('second-instance'"), 'a second launch does nothing at all instead of showing the pet');

    // The loser must not run will-quit. That handler writes pet.json, and an
    // instance that quit before whenReady has no state to write - it would
    // blank the running pet's save on its way out.
    const guard = mjs.match(/requestSingleInstanceLock\(\)\)\s*app\.(\w+)/);
    assert.ok(guard, 'the lock is taken but nothing acts on losing it');
    assert.strictEqual(guard[1], 'exit', 'the losing instance quits, which fires will-quit and blanks pet.json');

    // Show, never toggle: a second launch is somebody asking to see the pet.
    assert.ok(
      /second-instance[\s\S]{0,400}!win\.isVisible\(\)\) togglePet\(\)/.test(mjs),
      'a second launch can hide the pet of somebody who just asked for it'
    );
  }

  // --- the paperwork actually ships, and the installer shows the real terms ---
  {
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

    // Docs the app's own text points people at. If one is renamed and this list
    // is not, it silently stops being installed and the pointers go nowhere -
    // including the Wikipedia CC BY-SA and Open-Meteo attributions, which are
    // recorded nowhere else.
    for (const f of ['LICENSE', 'TERMS.md', 'PRIVACY.md', 'THIRD-PARTY-NOTICES.md']) {
      assert.ok(pkg.build.extraFiles.includes(f), `${f} is not installed alongside the app`);
      assert.ok(fs.existsSync(`./${f}`), `${f} is listed in the build but is not in the repository`);
    }

    // The licence page is generated from TERMS.md at package time. If the
    // generator stops running, the installer keeps showing whatever terms
    // happened to be on disk the last time somebody ran it by hand.
    assert.strictEqual(pkg.build.nsis.license, 'build/license.txt', 'the installer shows no terms at all');
    for (const s of ['dist', 'pack']) {
      assert.ok(
        pkg.scripts[s].includes('npm run license'),
        `npm run ${s} packages the app without regenerating the licence page`
      );
    }

    require('child_process').execFileSync(process.execPath, ['build/license.js']);
    const lic = fs.readFileSync('./build/license.txt');
    assert.deepStrictEqual([...lic.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'no byte order mark: NSIS will mangle the em dashes');

    const body = lic.toString('utf8').slice(1);
    assert.ok(!/[^\r]\n/.test(body), 'a bare newline survived: NSIS runs the whole document together');
    assert.ok(!/^#+ |\*\*|\]\(/m.test(body), 'markdown syntax survived into the licence page');
    assert.ok(body.includes('Privacy Policy (PRIVACY.md)'), 'links lost their target instead of being flattened');
    // Proof it is the whole document rather than a truncated one: the last
    // section and the two clauses that carry the most weight.
    assert.ok(body.includes('governed by the laws of India'), 'the governing law clause is missing');
    assert.ok(body.includes('TOTAL AGGREGATE LIABILITY'), 'the liability cap is missing');
    assert.ok(body.trimEnd().endsWith('palikaomkar@gmail.com'), 'the licence page is cut short');
  }

  // The rejections parked by the synchronous sections above. Awaited before the
  // success line, so a failure cannot arrive after it.
  await Promise.all(globalThis.pendingRejections || []);

  console.log('all checks passed');
})();
