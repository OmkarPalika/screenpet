'use strict';

// Self-check for the logic that can break silently. Run: npm test
// No framework on purpose - if this file needs fixtures, the code got too clever.

const assert = require('assert');
const { redact, stripThinking, cleanOcr, buildPrompt, ask, EMPTY_SCREEN } = require('./brain');
const { toReadingOrder } = require('./ocr');
const pets = require('./pet-state');

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
  const { unquote } = require('./brain');
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
  const { stripMarkup } = require('./brain');
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
  const { stripEcho } = require('./brain');
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

// --- sleep regenerates energy instead of draining it ---
{
  const s = { ...pets.fresh(0), energy: 30 };
  const awake = pets.tick(s, 3 * HOUR, { asleep: false });
  const napped = pets.tick(s, 3 * HOUR, { asleep: true });
  assert.ok(napped.energy > s.energy, 'sleeping did not restore energy');
  assert.ok(awake.energy < s.energy, 'being awake did not cost energy');
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
  const cfg = require('./settings');

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
  const css = require('fs').readFileSync('./renderer/style.css', 'utf8');
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
  const rjs = require('fs').readFileSync('./renderer/renderer.js', 'utf8');
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
    require('fs').readFileSync('./renderer/pets.css', 'utf8').includes('.bow      { display: none; }'),
    'the bow is not hidden by default, so every pet wears one always'
  );
}

// ===== skills ==============================================================

// These run INSTEAD of the model, with total confidence and no way for the user
// to tell they did. So the false positives matter more than the matches: a
// pattern that fires on a real question replaces a correct answer with a dice
// roll, and nothing anywhere would report it.
{
  const skills = require('./skills');
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
  const KEYS = require('./media').KEYS;
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
  const rjs = require('fs').readFileSync('./renderer/renderer.js', 'utf8');
  const moves = (rjs.match(/const MOVE_MS = \{([^}]+)\}/) || [])[1] || '';
  const faces = new Set(Object.values(pets.EXPRESSIONS));
  for (const [move] of skills.MOVE_WORDS) {
    assert.ok(new RegExp(`\\b${move}:`).test(moves), `move "${move}" has no animation`);
    assert.ok(skills.MOVE_LINES[move], `move "${move}" has nothing to say`);
    assert.ok(faces.has(skills.MOVE_EXPR[move]), `move "${move}" wears an unknown face`);
  }
  const css = require('fs').readFileSync('./renderer/style.css', 'utf8');
  for (const [move] of skills.MOVE_WORDS) {
    assert.ok(css.includes(`[data-move="${move}"]`), `move "${move}" has no rule in style.css`);
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
    }[skill.name];
    assert.ok(probe, `no probe for skill "${skill.name}"`);
    const out = skills.match(probe, ctx);
    assert.strictEqual(out && out.name, skill.name, `probe for "${skill.name}" hit ${out && out.name}`);
    assert.ok(out.say, `skill "${skill.name}" said nothing`);
    if (out.expr) {
      assert.ok(css.includes(`[data-expr="${out.expr}"]`), `"${skill.name}" wears unknown face ${out.expr}`);
    }
  }
}

// ===== voice ===============================================================

// The whole feature turns on one claim: neither direction of speech leaves the
// machine. These are the two ways it could stop being true.
{
  const fs = require('fs');
  const rjs = fs.readFileSync('./renderer/renderer.js', 'utf8');

  // Chromium's SpeechRecognition posts audio to a Google endpoint. It is the
  // obvious way to add dictation to an Electron app and it is the one thing
  // this app may never do - hence a test rather than a comment.
  for (const src of ['./renderer/renderer.js', './main.js', './speech.js', './preload.js']) {
    assert.ok(
      !/SpeechRecognition|SpeechGrammarList/.test(fs.readFileSync(src, 'utf8')),
      `${src} uses the Web Speech recogniser, which uploads the audio`
    );
  }
  // Listening is Windows' own on-device recogniser, driven the same way as OCR.
  const ps1 = fs.readFileSync('./listen.ps1', 'utf8');
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
  const app = fs.readFileSync('./renderer/index.html', 'utf8');
  const stage = fs.readFileSync('./demo/stage.html', 'utf8');
  // Two copies of the SVG is the price of the demo rendering a page behind the
  // pet. Cheap to keep honest, and a drifted demo is a demo of the wrong app.
  for (const part of ['gaze', 'eyes-love', 'brows', 'tongue', 'tear', 'sweat', 'zzz', 'spark']) {
    assert.ok(app.includes(`"${part}"`), `renderer lost the ${part} face part`);
    assert.ok(stage.includes(`"${part}"`), `demo stage is missing the ${part} face part`);
  }
  // Species parts must exist in the settings previews too, or the picker shows
  // six identical buttons while the real pet changes shape.
  const settingsHtml = fs.readFileSync('./renderer/settings.html', 'utf8');
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
  const cfg = require('./settings');
  const css = fs.readFileSync('./renderer/pets.css', 'utf8');

  for (const pet of cfg.PETS) {
    // blob is the shape already in the markup, so it needs no rules of its own.
    if (pet === 'blob') continue;
    assert.ok(css.includes(`[data-pet="${pet}"]`), `species "${pet}" has no rules in pets.css`);
  }
  // Shapes must live in pets.css alone - style.css is loaded by the pet window
  // only, so a species rule hiding in there would not reach the settings previews.
  assert.ok(
    !fs.readFileSync('./renderer/style.css', 'utf8').includes('[data-pet='),
    'a species rule is in style.css, where the settings previews cannot see it'
  );
  for (const html of ['./renderer/index.html', './renderer/settings.html', './demo/stage.html']) {
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
  const cfg = require('./settings');

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

// ===== quiet hours =========================================================

{
  const dnd = require('./dnd');

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

// ===== reminders ===========================================================

{
  const rem = require('./reminders');
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
  const { repeatOf, clockOf, spokenRepeat, match } = require('./skills');

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
  const wx = require('./weather');

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
  const { askVision, detectVisionModel, listModels } = require('./brain');

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
  const { hasEnoughText, MIN_SCREEN_TEXT } = require('./brain');
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

  const { buildVisionPrompt } = require('./brain');
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
  const { chat, buildChatPrompt } = require('./brain');

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

  // Empty input must not wake the model up at all.
  let chatCalled = false;
  const cspy = async () => { chatCalled = true; return cgrab(); };
  assert.strictEqual(await chat('   ', { fetch: cspy }), '');
  assert.strictEqual(chatCalled, false);

  // A pasted wall of text is a prompt blowout, not a conversation.
  await chat('x'.repeat(9000), { fetch: cgrab, model: 'm' });
  assert.ok(cbody.prompt.length < 1200, `chat prompt not capped: ${cbody.prompt.length} chars`);

  // ===== memory ==============================================================

  // Built from local Date parts on purpose: every hour and day rule in memory.js
  // is about the calendar the person lives in, so a UTC constant would pass here
  // and be an hour wrong on the machine.
  const at = (y, mo, d, h = 0) => new Date(y, mo, d, h, 0, 0, 0).getTime();
  const MON_9PM = at(2026, 0, 5, 21);

  {
    const memo = require('./memory');

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
    const skills = require('./skills');
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

  // --- the settings gate ------------------------------------------------------
  {
    const config = require('./settings');
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

  console.log('all checks passed');
})();
