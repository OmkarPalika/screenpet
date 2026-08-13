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

  // merge keeps what it is not told about, and still validates what it is.
  const merged = cfg.merge(cfg.load({ skin: 'mint' }), { model: 'x', hotkey: 'Ctrl+' });
  assert.strictEqual(merged.skin, 'mint');
  assert.strictEqual(merged.model, 'x');
  assert.strictEqual(merged.hotkey, cfg.DEFAULTS.hotkey, 'merge let a bad hotkey through');
}

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

  console.log('all checks passed');
})();
