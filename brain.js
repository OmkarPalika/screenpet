'use strict';

// Everything in here is pure except the functions that call Ollama, and those
// take a `fetch` so test.js can exercise them without a server.

const OLLAMA = process.env.SCREENPET_OLLAMA || 'http://127.0.0.1:11434';
// Non-reasoning on purpose: reasoning models emit far more tokens and blow the
// timeout on CPU, which is the machine this has to run on. See README.
const MODEL = process.env.SCREENPET_MODEL || 'llama3.1:8b';
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
  // Measured against llama3.1:8b on a fixed OCR string. The earlier wording -
  // which opened by telling the model it was a desktop pet and allowed three
  // sentences - produced 79-240 character replies that narrated the screen and
  // talked about themselves. This produces 28-53 characters that answer.
  return [
    "The text below was captured from the user's screen by OCR. It may be garbled",
    'and may include unrelated interface text.',
    'Find the question and answer it directly, in at most two sentences.',
    'Do not restate the question, do not explain your reasoning, and do not describe',
    'yourself or the screen. If there is genuinely no question, describe the screen',
    'in one short sentence.',
    ...(tone ? [`${tone} Answer correctly regardless of your mood.`] : []),
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

function buildChatPrompt(message, { mood = 'neutral', history = [] } = {}) {
  const tone = TONE[mood] || '';
  return [
    PERSONA,
    'Reply in at most two short sentences. Be warm and plain-spoken.',
    'You cannot see their screen right now, so never claim to know what is on it.',
    ...(tone ? [tone] : []),
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
  return generate({ model: opts.model || MODEL, prompt: buildChatPrompt(text, opts) }, opts);
}

const EMPTY_SCREEN = 'I could not read any text on screen.';

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

/** Shared transport. Returns an answer string, never throws. */
async function generate(body, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const endpoint = opts.endpoint || OLLAMA;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: false, ...body }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const data = await res.json();
    const answer = stripEcho(stripThinking(String(data.response || '')));
    return answer || 'I read the screen but came up blank.';
  } catch (err) {
    if (err.name === 'AbortError') return 'That took too long. Try a smaller model.';
    return `I cannot reach the local model. Is Ollama running?\n(${err.message})`;
  } finally {
    clearTimeout(timer);
  }
}

/** Tier 1: OCR text. Works on any machine, no GPU. */
async function ask(screenText, opts = {}) {
  const cleaned = cleanOcr(screenText);
  if (!cleaned) return EMPTY_SCREEN;
  return generate(
    {
      model: opts.model || MODEL,
      prompt: buildPrompt(redact(cleaned), opts.mood),
    },
    opts
  );
}

/**
 * Tier 2: the screenshot itself, for diagrams and geometry that OCR cannot see.
 * Note the image cannot be redacted the way text can - whatever is on screen is
 * what the model receives. It is still local-only, but it is a wider exposure.
 */
async function askVision(pngBase64, opts = {}) {
  if (!pngBase64) return EMPTY_SCREEN;
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
  redact, stripThinking, stripEcho, cleanOcr, hasEnoughText,
  buildPrompt, buildVisionPrompt, buildChatPrompt,
  ask, askVision, chat, detectVisionModel, listModels,
  MODEL, EMPTY_SCREEN, MIN_SCREEN_TEXT,
};
