'use strict';

// Everything in here is pure except the functions that call Ollama, and those
// take a `fetch` so test.js can exercise them without a server.

const providers = require('./providers');

const OLLAMA = process.env.SCREENPET_OLLAMA || 'http://127.0.0.1:11434';
// Reasoning on purpose, which reverses what this comment used to say. The old
// claim - that reasoning models blow the timeout - turned out to be the num_ctx
// bug below rather than anything about reasoning. With the context capped, this
// answers in 6-12s warm, and it is the only model of eight benchmarked that
// says so when OCR has mangled the thing it was asked about. stripThinking
// removes the <think> block before the pet says anything.
const MODEL = process.env.SCREENPET_MODEL || 'deepseek-r1:8b';
const TIMEOUT_MS = Number(process.env.SCREENPET_TIMEOUT_MS || 120000);

// Screen text can contain secrets the user never meant to hand to a model.
// This is a trust boundary: redact before the text leaves this process, not after.
const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,            // openai-style keys
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,                 // github tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                           // aws access key id
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // jwt
  /\b[A-Fa-f0-9]{32,}\b/g,                           // long hex blobs / hashes
  /\b\d(?:[ -]?\d){14,18}\b/g,                       // card-ish digit runs
  /(?<=\b(?:password|passwd|pwd|secret|token|api[_-]?key)\b\s*[:=]\s*)\S+/gi,
];

function redact(text) {
  return SECRET_PATTERNS.reduce((s, re) => s.replace(re, '[REDACTED]'), text);
}

// Reasoning models narrate before answering. Show the answer, not the monologue.
function stripThinking(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '') // unterminated block = truncated output
    .trim();
}

// Small models restate the question before answering however firmly the prompt
// tells them not to. Drop a leading echo, but only when something follows it -
// a reply that is nothing but a question is the model actually asking one.
function stripEcho(text) {
  const lines = text.split('\n');
  const first = lines[0].trim();
  if (!first.endsWith('?')) return text;
  const rest = lines.slice(1).join('\n').trim();
  return rest || text;
}

// Small models like to wrap a reply in quotation marks, and often open one they
// never close. Either way the punctuation is the model narrating a line of
// dialogue rather than the pet speaking, so it does not belong in the bubble.
function unquote(text) {
  const t = text.trim();
  if (!t.startsWith('"') && !t.startsWith('“')) return t;
  return t.replace(/^["“]\s*/, '').replace(/\s*["”]$/, '').trim();
}

// The bubble is a plain text node, so markdown arrives as visible punctuation:
// the pet saying "the answer is **391**" with the asterisks in it. Only the
// paired emphasis markers go - a lone asterisk is left alone, because
// "*pounces*" is the pet doing something and reads correctly as it is.
function stripMarkup(text) {
  return text
    .replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, '$1')
    .replace(/__(\S(?:[\s\S]*?\S)?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '') // the bubble is two lines, not a bullet list
    .trim();
}

function cleanOcr(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000); // OCR of a full screen can be huge; keep the prompt sane
}

// Mood colours the wording and nothing else. A hungry pet still answers, and it
// still answers correctly - gating usefulness on pet care is charming for a day
// and infuriating after that.
const TONE = {
  hungry: 'You are a little hungry. You may add one short aside about that at the end.',
  sleepy: 'You are sleepy. Keep it especially brief and slightly drowsy.',
  sad: 'You are in a low mood. Stay warm but subdued.',
  happy: 'You are cheerful. One upbeat word is fine.',
  neutral: '',
};

function buildPrompt(screenText, mood = 'neutral') {
  const tone = TONE[mood] || '';
  // Measured, and measured again after the pet framing came back. An early
  // version that opened "you are a desktop pet" and allowed three sentences
  // produced 79-240 character replies that narrated the screen and talked about
  // themselves; a bare instruction to answer produced 28-53 characters that
  // answered but sounded like a search result. The wording below is the third
  // pass: it re-introduces the pet, and pins the answer down explicitly so the
  // warmth cannot eat it. "Say the answer plainly and completely" and the cap of
  // one flourish are both load-bearing - drop either and it narrates again.
  //
  // Fourth pass replaced "warmly, the way a fond pet would" with how a person
  // actually speaks, because "affectionate flourish" is what was producing the
  // tildes, the emoji and the third-person cooing. The wit is capped at one aside
  // and given an explicit way out ("leave it out") - without the escape hatch a
  // small model strains for a joke on questions that do not have one in them.
  // Re-measure before editing; probe against the quiz and mix screens.
  return [
    'You are a small friendly desktop pet, reading over the shoulder of the person',
    'you live with.',
    'The text below was captured from their screen by OCR. It may be garbled',
    'and may include unrelated interface text.',
    'Find the question and answer it, in at most two short sentences.',
    'Say the answer plainly and completely - never hide it, hint at it or make them',
    'work for it. Say it the way a person says it out loud: contractions, plain',
    'words, nothing stiff.',
    'After the answer, at most one dry aside - wry and in passing, never a joke you',
    'stop to tell, and never at their expense. If nothing about it is actually',
    'funny, leave it out; a flat true answer beats a strained one.',
    'Do not restate the question and do not explain your reasoning.',
    'No emoji, no asterisks, no narrated actions.',
    'If there is genuinely no question, say one easy line about that instead.',
    'Never say that you could not find a question or could not help.',
    ...(tone ? [`${tone} Answer correctly regardless of your mood.`] : []),
    '',
    '--- SCREEN ---',
    screenText,
    '--- END ---',
  ].join('\n');
}

// Watching, rather than being asked. One difference, and it is the whole
// feature: silence. Most screens have nothing on them worth saying, and a pet
// that remarks on every one of them gets switched off within the hour - so this
// prompt spends most of its words on permission to say nothing at all.
//
// A sentinel word rather than an empty reply, because a small model told to
// answer with nothing answers with a sentence about having nothing to say.
const SILENT = 'NOTHING';

// Also why the watch path never streams: the sentinel would be typed into the
// bubble live, and then taken away again, which is worse than either outcome.
//
// The word alone, or the word followed by punctuation - a model told to answer
// NOTHING often answers "NOTHING - there is no question here". A reply that
// carries straight on into a sentence is a real answer that happens to start
// with the word, and "Nothing beats a jet2 holiday" must survive. The cost of
// the remaining ambiguity is a one-word answer of "Nothing." going unsaid, and
// silence is the right way for this path to be wrong.
const isSilent = (text) => /^\W*nothing\s*(?:[-–—:,.!?]|$)/i.test(String(text || '').trim());

function buildWatchPrompt(screenText) {
  return [
    'You are a small friendly desktop pet, reading over the shoulder of the person',
    'you live with. They did not ask you anything.',
    'The text below was captured from their screen by OCR. It may be garbled',
    'and may include unrelated interface text.',
    `You may only speak if it contains a question you can answer. Otherwise reply with the single word ${SILENT}.`,
    'Most of the time that is the right answer. Do not describe the screen, do not',
    'greet them, do not comment on what they are working on, and never say that you',
    `found nothing - say ${SILENT} instead.`,
    'If there is a question: answer it in at most two short sentences, plainly and',
    'completely, the way a person says it out loud.',
    'Do not restate the question and do not explain your reasoning.',
    'No emoji, no asterisks, no narrated actions.',
    '',
    '--- SCREEN ---',
    screenText,
    '--- END ---',
  ].join('\n');
}

// Small vision models are far more brittle than text models, and the wording
// below is not arbitrary - it was measured against moondream on a fixed image,
// three runs per variant:
//
//   this exact sentence                          3/3 usable
//   + "in at most three sentences"               0/3, replies "!!!"
//   + mood appended AFTER the task               0/3, replies ""
//     mood prefixed BEFORE the task              3/3 usable
//
// So: one short sentence, no length constraint, mood first. Adding clauses here
// does not make the answer better, it makes the model emit punctuation.
// Re-measure before touching this, and keep buildVisionPrompt short (there is a
// test asserting exactly that).
const VISION_TASK =
  'Look at this screenshot. If there is a question in it, answer it. '
  + 'Otherwise describe what is on screen.';

const VISION_MOOD = {
  hungry: 'You are a hungry desktop pet.',
  sleepy: 'You are a sleepy desktop pet.',
  sad: 'You are a gloomy desktop pet.',
  happy: 'You are a cheerful desktop pet.',
  neutral: 'You are a desktop pet.',
};

function buildVisionPrompt(mood = 'neutral') {
  return `${VISION_MOOD[mood] || VISION_MOOD.neutral} ${VISION_TASK}`;
}

// Typed conversation, which is a different job from answering the screen: no
// OCR, no screenshot, and the model is told plainly that it cannot see anything.
// Without that line a small model happily invents what is on your monitor.
const PERSONA =
  'You are a small friendly desktop pet, talking to the person whose computer you live on.';

// How much of the last screen read is carried into a typed conversation. Enough
// for "what about the second one?" to mean something; not so much that the
// screen crowds out what was actually said.
const SCREEN_MEMORY = 700;

// What it read a moment ago, if it read anything worth carrying. Trimmed before
// it is judged: a read that came back with nothing but whitespace is not a
// screen, and treating it as one puts an empty block in the prompt and takes
// the honest "I cannot see it" sentence out with it.
//
// One function because two things ask the question - what the prompt says, and
// whether the answer is worth thinking about - and those two drifting apart is
// how the pet ends up insisting it cannot see a screen it is reasoning over.
const screenText = (screen) =>
  (screen ? String(screen.text || '').trim() : '').slice(0, SCREEN_MEMORY);

function buildChatPrompt(message, { mood = 'neutral', history = [], memory = [], screen = null } = {}) {
  const tone = TONE[mood] || '';
  const notes = Array.isArray(memory) ? memory.filter((l) => typeof l === 'string') : [];
  // Redacted before it got here, and it goes stale on its own - see main.js.
  const seen = screenText(screen);
  return [
    PERSONA,
    'Talk the way a person talks out loud: contractions, plain words, nothing stiff.',
    'At most two short sentences. If you have written a third, cut it.',
    'Lead with the answer itself rather than a sentence built around it, and never',
    'open with a greeting or your own name.',
    'After it, at most one dry aside - wry and in passing, never a joke you stop to',
    'tell, and never at their expense. If nothing is actually funny, skip it.',
    'No emoji, no asterisks, no narrated actions.',
    'If they ask you something factual, still answer it properly.',
    // Either it has just read the screen or it has not, and it must not claim
    // the other one. A pet that says it cannot see your screen right after
    // answering a question about it is worse than one that never could.
    ...(seen
      ? ['You read their screen a moment ago and the text of it is below. Answer',
         'follow-up questions about it from that text, and say so plainly if the',
         'answer is not in it. Do not describe the screen unless they ask.']
      : ['You cannot see their screen right now. If they ask what is on it, say so',
         'plainly instead of guessing.']),
    ...(tone ? [tone] : []),
    // What the pet has been told to remember, and only what it was told. The
    // instruction is needed: without it a small model treats the notes as the
    // subject and answers a question nobody asked. See memory.js.
    ...(notes.length
      ? ['', ...notes, 'Only mention these if they are actually relevant to what they just said.']
      : []),
    ...(seen ? ['', '--- WHAT YOU READ ---', seen, '--- END ---'] : []),
    '',
    ...history.flatMap((h) => [`Them: ${h.you}`, `You: ${h.pet}`]),
    `Them: ${message}`,
    'You:',
  ].join('\n');
}

/**
 * Talk to the pet. History is passed in and lives in memory only - a desktop
 * pet that keeps a transcript of your evening on disk is a liability.
 */
async function chat(message, opts = {}) {
  const text = String(message || '').trim().slice(0, 500);
  if (!text) return '';
  // Typed text is not redacted on the local path: they are your own words and
  // they never leave the machine. On a hosted provider they do, so they are -
  // pasting a key into the chat box must not be how it ends up at OpenAI.
  const safe = opts.provider && !providers.isLocal(opts.provider) ? redact(text) : text;
  const body = { model: opts.model || MODEL, prompt: buildChatPrompt(safe, opts) };

  // Small talk does not need the reasoner's monologue, and on the default model
  // that monologue IS the wait: measured against one already-loaded
  // deepseek-r1:8b, 8613ms to the first word with it and 394ms without. Nothing
  // else changes - same model, same memory, no second one to swap in and out.
  //
  // Only ever switched off, never on. A model that cannot think rejects the
  // request outright rather than ignoring the field - "llama3.1:8b does not
  // support thinking" - so asking for it would break every model that was never
  // the problem.
  //
  // A question about the screen keeps it. Answering about text it read a moment
  // ago is the one job the careful model was chosen for.
  if (!screenText(opts.screen)) body.think = false;

  return generate(body, opts);
  // opts carries onToken straight through, so a typed conversation fills in as
  // it is written exactly as a screen answer does.
}

// Nothing to answer is not an error, and it is not this file's job to have a
// personality about it - ask() returns nothing and main.js picks a line.
const EMPTY_SCREEN = '';

// Below this many characters, the screen is probably a diagram, a photo or a
// game rather than something to read - the case the vision tier exists for.
// A real question is comfortably longer than this.
const MIN_SCREEN_TEXT = 40;

/**
 * Should the text path handle this screen? Measured, not guessed: moondream
 * describes simple images well but returns nothing at all for a dense screenshot
 * of text, so preferring vision whenever it is installed makes the common case
 * strictly worse. OCR first, vision only where OCR has nothing to offer.
 *
 * A question mark counts on its own. "What is 17 * 23 ?" is 38 characters, which
 * is under any sensible length threshold, and sending that to a vision model
 * instead of a text one would be exactly the wrong call.
 */
function hasEnoughText(ocrText) {
  const cleaned = cleanOcr(String(ocrText || ''));
  return cleaned.length >= MIN_SCREEN_TEXT || cleaned.includes('?');
}

// Ollama sizes the KV cache from the model's own default context window, not
// from the prompt, and some defaults are enormous: phi4-mini-reasoning defaults
// to 131072 tokens, which asks for 21GB for a 3.8B model, spills off an 8GB card
// and gets the process OOM-killed. Measured on an RTX 5050 8GB: capping this
// took llama3.1:8b from 35.0s at 74% CPU to 11.5s entirely on the GPU, and
// mistral-nemo:12b from 104.8s to 18.7s.
//
// 4096 rather than something tighter because cleanOcr caps screen text at 4000
// characters, and that plus the prompt and the answer has to fit.
const NUM_CTX = Number(process.env.SCREENPET_NUM_CTX || 4096);

// Almost all the remaining wall time is loading the model, not running it. On
// the same machine: load_duration 8.35s, prompt_eval 0.21s, eval 1.17s for a
// 44-token answer. Ollama unloads after five idle minutes by default, so a pet
// asked twice an hour pays that load every single time - 12.6s cold against
// 1.2s warm. The timer resets on each use, so this keeps the model resident
// while you are actually using it and lets it go half an hour after you stop.
//
// The cost is real and it is VRAM: llama3.1:8b holds ~5.3GB of an 8GB card for
// that half hour. SCREENPET_KEEP_ALIVE=5m restores Ollama's default, and '0'
// unloads immediately after every answer.
const KEEP_ALIVE = process.env.SCREENPET_KEEP_ALIVE || '30m';

/**
 * Shared transport. Returns an answer string, never throws.
 *
 * Two destinations. By default Ollama on loopback, which is the whole point of
 * this app. With a hosted provider chosen in settings, providers.js instead -
 * and note what that means for the OCR path: the text read off your screen is
 * sent to that company. It is redacted first, by the patterns above, which is a
 * filter for the secrets it knows the shape of and not a promise about the rest.
 */
/**
 * A failure the pet can say as it stands.
 *
 * These used to be returned rather than thrown, which read fine in a bubble and
 * was wrong everywhere else: "I cannot reach the local model" arrived at the
 * caller as an answer, so the pet spoke it in the answer voice, `npm run smoke`
 * counted it as a successful read and exited 0, and nothing anywhere could tell
 * a reply apart from a dead socket. They throw now. Callers already catch and
 * show `err.message`, so the wording reaches the bubble unchanged.
 *
 * `said` marks the ones already phrased for a person, so the catch at the
 * bottom passes them through instead of relabelling them as a network failure.
 */
const speak = (message) => Object.assign(new Error(message), { said: true });

async function generate(body, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;

  if (opts.provider && !providers.isLocal(opts.provider)) {
    try {
      return stripMarkup(unquote(stripEcho(stripThinking(
        await providers.generate(body.prompt, {
          provider: opts.provider,
          model: opts.providerModel,
          key: opts.key,
          fetch: fetchImpl,
          timeoutMs: opts.timeoutMs,
        })
      ))));
    } catch (err) {
      // providers.js only ever throws messages that are safe to show - it never
      // puts the key, the prompt or a provider's error body in one. Passed
      // through as a failure rather than returned as an answer: see `speak`.
      throw err;
    }
  }

  const endpoint = opts.endpoint || OLLAMA;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT_MS);
  // Streamed only when somebody is listening for the pieces. Without a listener
  // there is nothing to show them to, and one response is less to go wrong.
  const live = typeof opts.onToken === 'function';
  try {
    const res = await fetchImpl(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stream: live,
        keep_alive: KEEP_ALIVE,
        options: { num_ctx: NUM_CTX },
        ...body,
      }),
      signal: controller.signal,
    });
    // Ollama is up and answering; it just has not got this model. Worth its own
    // message - "is Ollama running?" sends you to check a service that is fine,
    // and the default model is one plenty of people will not have pulled yet.
    if (res.status === 404) {
      throw speak(`I do not have "${body.model}" yet.\nRun: ollama pull ${body.model}`);
    }
    if (!res.ok) throw speak(`Ollama answered ${res.status}, which I cannot read.`);
    if (live) {
      const whole = await drink(res, opts.onToken);
      return stripMarkup(unquote(stripEcho(stripThinking(whole))));
    }
    const data = await res.json();
    // Empty means empty. The pet's own voice lives in pet-state's line bank, so
    // inventing a sentence here would put a second, blander personality in the
    // one file that is meant to have none.
    return stripMarkup(unquote(stripEcho(stripThinking(String(data.response || '')))));
  } catch (err) {
    // Already phrased for the bubble by one of the throws above. Relabelling it
    // as a dead socket would send somebody to restart a service that answered.
    if (err.said) throw err;
    if (err.name === 'AbortError') throw speak('That took too long. Try a smaller model.');
    throw speak(`I cannot reach the local model. Is Ollama running?\n(${err.message})`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a streamed answer, handing each new piece to `onToken` as it arrives.
 *
 * Ollama streams newline-delimited JSON, one object per token, so a chunk off
 * the socket is very often half an object - the buffer here is why a token
 * split across two TCP packets does not throw away both halves of it.
 *
 * What is shown live is not what is accumulated. The default model is a
 * reasoner: it narrates its whole approach inside <think> before it answers,
 * and stripThinking drops an unterminated block outright, so the bubble stays
 * on the thinking face until the monologue closes and then fills with the
 * answer. Streaming the raw tokens would put the monologue on your screen,
 * which is the one thing that file exists to prevent.
 *
 * unquote and stripEcho are deliberately not applied to the pieces. Both are
 * decisions about a whole answer - a line vanishing halfway through being typed
 * out reads as a bug - so they run once at the end.
 *
 * @returns {Promise<string>} everything the model said, uncleaned
 */
async function drink(res, onToken) {
  const reader = res.body.getReader();
  const decode = new TextDecoder();
  let pending = '';
  let whole = '';
  let shown = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decode.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop(); // the last piece is whatever arrived incomplete
    for (const line of lines) {
      if (!line.trim()) continue;
      let piece;
      try {
        piece = JSON.parse(line);
      } catch {
        continue; // a line Ollama did not finish writing is not an error
      }
      if (piece.error) throw new Error(piece.error);
      whole += piece.response || '';
      const next = stripMarkup(stripThinking(whole));
      // Only when it changed: while the model is still thinking every token
      // leaves this identical, and telling the window so sixty times a second
      // is work nobody sees.
      if (next !== shown) {
        shown = next;
        onToken(next);
      }
    }
  }
  return whole;
}

/**
 * Tier 1: OCR text. Works on any machine, no GPU.
 *
 * `watching` is a read nobody asked for, and it answers with nothing far more
 * often than it answers - see buildWatchPrompt. The sentinel is turned back into
 * an empty answer here so main.js has one rule for both paths: no answer, no
 * bubble.
 */
async function ask(screenText, opts = {}) {
  const cleaned = cleanOcr(screenText);
  if (!cleaned) return EMPTY_SCREEN;
  const watching = opts.watching === true;
  const body = {
    model: opts.model || MODEL,
    prompt: watching
      ? buildWatchPrompt(redact(cleaned))
      : buildPrompt(redact(cleaned), opts.mood),
  };
  // The reasoner earns its wait when you pressed the hotkey and are watching the
  // bubble. It does not earn it here: the honest answer is NOTHING almost every
  // time, and thinking it through first costs a full reasoning pass every
  // watchEvery seconds to arrive at silence. Measured on deepseek-r1:8b against
  // five quiet screens, five runs each: 8181ms and 23/25 correct with thinking,
  // 548ms and 24/25 without. It is not a quality trade - both misfires with
  // thinking on were the model misspelling its own sentinel as NOTING, which
  // isSilent does not catch and the pet would have said out loud.
  //
  // Switched off, never on: a model that cannot think rejects a request for it
  // outright, while think:false is accepted by every model tested, thinking or
  // not - see the same reasoning in chat().
  if (watching) body.think = false;
  const answer = await generate(body, opts);
  return watching && isSilent(answer) ? EMPTY_SCREEN : answer;
}

/**
 * Tier 2: the screenshot itself, for diagrams and geometry that OCR cannot see.
 * Note the image cannot be redacted the way text can - whatever is on screen is
 * what the model receives. It is still local-only, but it is a wider exposure.
 */
async function askVision(pngBase64, opts = {}) {
  if (!pngBase64) return EMPTY_SCREEN;
  // A screenshot cannot be redacted the way text can, so it is never sent to a
  // hosted provider - whatever is on screen would be what they receive, in full.
  // main already avoids selecting the vision tier when one is chosen; this is
  // the second lock on the same door.
  if (opts.provider && !providers.isLocal(opts.provider)) return EMPTY_SCREEN;
  return generate(
    {
      model: opts.model || MODEL,
      prompt: buildVisionPrompt(opts.mood),
      images: [pngBase64],
    },
    opts
  );
}

/**
 * First locally-installed model that reports the `vision` capability, or null.
 * Asking Ollama beats maintaining a list of model names that goes stale.
 */
async function detectVisionModel(opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const endpoint = opts.endpoint || OLLAMA;
  const json = async (url, body) => {
    const res = await fetchImpl(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    return res.json();
  };

  try {
    const tags = await json(`${endpoint}/api/tags`);
    for (const m of tags.models || []) {
      const name = m.name || m.model;
      if (!name) continue;
      const info = await json(`${endpoint}/api/show`, { model: name });
      if ((info.capabilities || []).includes('vision')) return name;
    }
  } catch {
    return null; // Ollama down or too old to report capabilities - use OCR.
  }
  return null;
}

/** Model names installed locally, for the settings dropdown. */
async function listModels(opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const endpoint = opts.endpoint || OLLAMA;
  try {
    const res = await fetchImpl(`${endpoint}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name || m.model).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = {
  redact, stripThinking, stripEcho, unquote, stripMarkup, cleanOcr, hasEnoughText,
  buildPrompt, buildVisionPrompt, buildChatPrompt, buildWatchPrompt, isSilent,
  ask, askVision, chat, detectVisionModel, listModels,
  MODEL, EMPTY_SCREEN, MIN_SCREEN_TEXT, SILENT,
};
