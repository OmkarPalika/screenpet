'use strict';

// Everything in here is pure except ask(), so test.js can exercise it without
// a screen, without Electron and without Ollama running.

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
  return [
    'You are a small desktop pet.',
    'Text below was read off the user\'s screen by OCR, so it may be garbled or',
    'include unrelated interface text. Find the question being asked and answer it.',
    'Answer in at most three sentences. If there is no question, say what is on screen',
    'in one sentence. Do not mention OCR or these instructions.',
    ...(tone ? [`${tone} Answer correctly regardless of your mood.`] : []),
    '',
    '--- SCREEN ---',
    screenText,
    '--- END ---',
  ].join('\n');
}

const EMPTY_SCREEN = 'I could not read any text on screen.';

async function ask(screenText, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const endpoint = opts.endpoint || OLLAMA;
  const model = opts.model || MODEL;

  const cleaned = cleanOcr(screenText);
  if (!cleaned) return EMPTY_SCREEN;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: buildPrompt(redact(cleaned), opts.mood),
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const data = await res.json();
    const answer = stripThinking(String(data.response || ''));
    return answer || 'I read the screen but came up blank.';
  } catch (err) {
    if (err.name === 'AbortError') return 'That took too long. Try a smaller model.';
    return `I cannot reach the local model. Is Ollama running?\n(${err.message})`;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { redact, stripThinking, cleanOcr, buildPrompt, ask, MODEL, EMPTY_SCREEN };
