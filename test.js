'use strict';

// Self-check for the logic that can break silently. Run: npm test
// No framework on purpose - if this file needs fixtures, the code got too clever.

const assert = require('assert');
const { redact, stripThinking, cleanOcr, buildPrompt, ask, EMPTY_SCREEN } = require('./brain');
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

// --- stripThinking ---
{
  assert.strictEqual(stripThinking('<think>hmm 17*23</think>The answer is 391.'), 'The answer is 391.');
  assert.strictEqual(stripThinking('<THINK>a</THINK> b'), 'b');
  assert.strictEqual(stripThinking('before<think>rambling forever'), 'before');
  assert.strictEqual(stripThinking('  plain answer  '), 'plain answer');
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
  assert.ok(pets.nagLine('hungry', 0).length > 0);
  assert.strictEqual(pets.nagLine('neutral', 0), '');
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

  // Secrets must be redacted in the body actually sent.
  let sent = '';
  const capture = async (_url, init) => { sent = init.body; return ok(); };
  await ask('password: hunter2horse and 2+2?', { fetch: capture });
  assert.ok(!sent.includes('hunter2horse'), 'secret was sent to the model');

  // A starving pet still answers. This is the rule the whole design rests on.
  await ask('What is 2+2?', { fetch: capture, mood: 'hungry' });
  assert.ok(sent.includes('What is 2+2?'), 'mood suppressed the question');

  // Failure modes return a message, never throw into the pet.
  const down = async () => { throw new Error('ECONNREFUSED'); };
  assert.match(await ask('hi', { fetch: down }), /Ollama/);

  const http500 = async () => ({ ok: false, status: 500 });
  assert.match(await ask('hi', { fetch: http500 }), /Ollama/);

  const slow = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  assert.match(await ask('hi', { fetch: slow }), /too long/);

  console.log('all checks passed');
})();
