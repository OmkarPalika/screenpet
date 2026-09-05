'use strict';

// Somebody else's model, if you asked for one.
//
// The default is Ollama on this machine and nothing in this file runs at all
// while that is true. Picking anything else is a deliberate trade, and it is a
// real one: with a hosted provider selected, the text this app reads off your
// screen is sent to that company. It is redacted first, by the same patterns
// that guard the local prompt, but redaction is a filter for the secrets it
// knows the shape of - it is not a promise about everything else on the screen.
//
// So: the network switch has to be on, a provider has to be chosen, and a key
// has to be stored. Three deliberate acts, none of them a default.
//
// Pure except for the fetch, which is injected, so every request shape here is
// assertable in test.js without a key or a network.

// Hardcoded, exactly like weather.js. Not configurable, not read from settings,
// not reachable by anything a model or a skill produces. A settings field that
// could point this at an arbitrary host would be a way to post your API key -
// and your screen - anywhere.
const PROVIDERS = {
  ollama: {
    label: 'Ollama — on this machine',
    local: true,
  },
  anthropic: {
    label: 'Anthropic',
    shape: 'anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-5',
    keys: 'console.anthropic.com',
  },
  openai: {
    label: 'OpenAI',
    shape: 'openai',
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    keys: 'platform.openai.com',
    // OpenAI's own endpoint refuses max_tokens outright on its newer models -
    // "Unsupported parameter: 'max_tokens' is not supported with this model" -
    // and wants max_completion_tokens, which the older ones accept as well. The
    // model name is a free text field where whatever you type wins, so without
    // this, typing a current model name is a request that cannot succeed.
    //
    // Only here. NVIDIA and Mistral speak the same shape but are their own
    // implementations of the older spec, and sending them a parameter OpenAI
    // invented is how you break two providers to fix one.
    tokens: 'max_completion_tokens',
  },
  gemini: {
    label: 'Google Gemini',
    shape: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    model: 'gemini-2.0-flash',
    keys: 'aistudio.google.com',
  },
  nvidia: {
    label: 'NVIDIA NIM',
    shape: 'openai',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    model: 'meta/llama-3.1-8b-instruct',
    keys: 'build.nvidia.com',
  },
  mistral: {
    label: 'Mistral',
    shape: 'openai',
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
    keys: 'console.mistral.ai',
  },
};

const NAMES = Object.keys(PROVIDERS);

// The pet answers in two sentences. A ceiling rather than a target, and it is
// also the bill: an unbounded max_tokens on a hosted model is somebody else's
// idea of how long an answer should be, charged to you.
const MAX_TOKENS = 400;

const TIMEOUT_MS = 60000;

// Model names go stale faster than anything else in this file, so the settings
// window offers this as an editable text field with the value above as a
// placeholder. Whatever you type wins.
function modelFor(provider, chosen) {
  const spec = PROVIDERS[provider];
  if (!spec || spec.local) return null;
  const named = typeof chosen === 'string' && chosen.trim();
  return named || spec.model;
}

const isLocal = (provider) => !PROVIDERS[provider] || PROVIDERS[provider].local === true;
const needsKey = (provider) => !isLocal(provider);

// --- the three request shapes ------------------------------------------------
//
// Five providers, three shapes: OpenAI's chat/completions is spoken verbatim by
// NVIDIA NIM and Mistral as well, so there is no adapter layer here, just the
// two that genuinely differ.

const SHAPES = {
  openai: {
    headers: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    body: (model, prompt, spec = {}) => ({
      model,
      messages: [{ role: 'user', content: prompt }],
      [spec.tokens || 'max_tokens']: MAX_TOKENS,
    }),
    read: (data) => {
      const choice = data && Array.isArray(data.choices) && data.choices[0];
      return (choice && choice.message && choice.message.content) || '';
    },
  },

  anthropic: {
    headers: (key) => ({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    body: (model, prompt) => ({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
    read: (data) => {
      const parts = data && Array.isArray(data.content) ? data.content : [];
      return parts.filter((p) => p && p.type === 'text').map((p) => p.text).join('').trim();
    },
  },

  gemini: {
    // In a header rather than the query string, so the key never lands in a URL
    // - which is the one part of a request that ends up in logs and referrers.
    headers: (key) => ({ 'content-type': 'application/json', 'x-goog-api-key': key }),
    body: (_model, prompt) => ({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
    read: (data) => {
      const cand = data && Array.isArray(data.candidates) && data.candidates[0];
      const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
      return parts.map((p) => (p && p.text) || '').join('').trim();
    },
  },
};

/** The exact URL for a request. Only the model name is ever substituted in. */
function urlFor(provider, model) {
  const spec = PROVIDERS[provider];
  if (!spec || spec.local) return null;
  return spec.url.replace('{model}', encodeURIComponent(model));
}

// What a failure is allowed to say out loud. The pet puts this in a speech
// bubble, so it must never contain the key, the prompt, or a provider's error
// body - some of them echo the request back.
function failure(status) {
  if (status === 401 || status === 403) return 'that API key was refused';
  if (status === 404) return 'that model name did not exist';
  if (status === 429) return 'too many questions too fast - give it a minute';
  if (status >= 500) return 'their end fell over. not us, for once';
  return `the provider said ${status}`;
}

/**
 * One prompt, one answer, from a hosted provider.
 *
 * @param {string} prompt  already built and already redacted by the caller
 * @param {object} opts  { provider, model, key, fetch, timeoutMs }
 * @returns {Promise<string>}
 * @throws  with a message safe to show, never containing the key
 */
async function generate(prompt, opts = {}) {
  const spec = PROVIDERS[opts.provider];
  if (!spec || spec.local) throw new Error('that is not a hosted provider');

  const key = String(opts.key || '');
  if (!key) throw new Error(`I need an ${spec.label} key first - put one in settings`);

  const model = modelFor(opts.provider, opts.model);
  const shape = SHAPES[spec.shape];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT_MS);

  try {
    const res = await (opts.fetch || globalThis.fetch)(urlFor(opts.provider, model), {
      method: 'POST',
      headers: shape.headers(key),
      body: JSON.stringify(shape.body(model, prompt, spec)),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(failure(res.status));
    return String(shape.read(await res.json()) || '');
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('that took too long');
    // A transport failure carries a URL and sometimes headers. The host is worth
    // naming; nothing else about the request is.
    throw new Error(
      /^(that|the|too many|their end|I need)/.test(err.message)
        ? err.message
        : `I could not reach ${spec.label}`
    );
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  generate, modelFor, urlFor, isLocal, needsKey, failure,
  PROVIDERS, NAMES, SHAPES, MAX_TOKENS,
};
