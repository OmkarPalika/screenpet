'use strict';

// Looking something up on the web, which only happens with the network switch
// on and only when you asked for it by name.
//
// What leaves this machine: the words you typed after "look up", cleaned and
// redacted. Nothing from your screen, camera, microphone or memory, no account,
// no API key, no cookie, no location.
//
// ponytail: DuckDuckGo's instant answers and Wikipedia's own API, because
// neither needs a key or a registration - so there is no identity attached to
// the request. A keyed search API would tie every lookup to an account, which is
// a worse trade than the better results are worth.

// Hardcoded, same rule as weather.js and providers.js: nothing in settings and
// nothing a model or a skill produces can point this at another host.
const DDG_HOST = 'https://api.duckduckgo.com';
const WIKI_HOST = 'https://en.wikipedia.org';

const TIMEOUT_MS = 8000;

// A search box, not a paste target. Long queries are almost always something
// pasted by accident, and this one goes to a third party.
const MAX_QUERY_CHARS = 120;

// Two lines in a speech bubble. Anything longer is cut at a sentence boundary
// rather than mid-word.
const MAX_ANSWER_CHARS = 280;

const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');

/**
 * What is allowed to be sent. Control characters and anything that is not part
 * of a question come out; the result is rejected rather than truncated, because
 * half a query is a different query.
 */
function cleanQuery(text) {
  if (typeof text !== 'string') return null;
  const flat = text
    .replace(CONTROL, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s'".,!?:;()+\-*/=&%$#@_]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length >= 2 && flat.length <= MAX_QUERY_CHARS ? flat : null;
}

/** Cut to the bubble at a sentence end where there is one. */
function trim(text) {
  const flat = String(text || '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (flat.length <= MAX_ANSWER_CHARS) return flat;
  const cut = flat.slice(0, MAX_ANSWER_CHARS);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return `${stop > 80 ? cut.slice(0, stop + 1) : cut.trimEnd()}…`;
}

async function get(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`the lookup came back ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** DuckDuckGo's instant answer, which handles definitions, conversions and sums. */
async function instant(query, fetchImpl) {
  const data = await get(
    `${DDG_HOST}/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=screenpet`,
    fetchImpl
  ).catch(() => null);
  if (!data) return null;
  const first = Array.isArray(data.RelatedTopics)
    ? (data.RelatedTopics.find((t) => t && typeof t.Text === 'string') || {}).Text
    : null;
  const said = data.Answer || data.AbstractText || data.Definition || first;
  return typeof said === 'string' && said.trim() ? trim(said) : null;
}

/** Wikipedia, for everything an instant answer does not cover - which is most of it. */
async function encyclopedia(query, fetchImpl) {
  const found = await get(
    `${WIKI_HOST}/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search=${encodeURIComponent(query)}`,
    fetchImpl
  ).catch(() => null);

  const title = Array.isArray(found) && Array.isArray(found[1]) ? found[1][0] : null;
  if (typeof title !== 'string' || !title) return null;

  const page = await get(
    `${WIKI_HOST}/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    fetchImpl
  ).catch(() => null);

  return page && typeof page.extract === 'string' && page.extract.trim()
    ? trim(page.extract)
    : null;
}

/**
 * Look something up. Instant answers first because they are exact when they
 * exist; the encyclopedia otherwise.
 *
 * @param {string} query  already redacted by the caller
 * @returns {Promise<string>} one or two sentences for the bubble
 */
async function lookup(query, opts = {}) {
  const q = cleanQuery(query);
  if (!q) throw new Error('give me something shorter to look up!');
  const fetchImpl = opts.fetch || globalThis.fetch;

  const answer = (await instant(q, fetchImpl)) || (await encyclopedia(q, fetchImpl));
  if (!answer) throw new Error(`I could not find anything about ${q}`);
  return answer;
}

module.exports = {
  lookup, cleanQuery, trim, instant, encyclopedia,
  DDG_HOST, WIKI_HOST, MAX_QUERY_CHARS, MAX_ANSWER_CHARS,
};
