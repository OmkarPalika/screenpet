'use strict';

// Which of the models you already have the pet should use.
//
// The settings window lists whatever Ollama reports and leaves you to pick,
// which is a fair thing to ask of somebody who chose their models on purpose
// and no help at all to anybody else. Nine models is a common state and eight
// of them are the wrong answer - one is a vision model too small to read a
// screen, one is a fine-tune somebody made for writing fiction, and two are the
// same 12B at different quantisations.
//
// So this ranks them, and says why in a sentence you can disagree with. Nothing
// here changes a setting on its own: a model is a taste as well as a
// measurement, and an app that quietly repoints your pet at a different one is
// worse than an app that stays quiet.
//
// Pure, and takes the rows rather than fetching them, so every rule below is
// assertable without Ollama running.

// The model this app ships as its default, which is the one thing here that was
// not arrived at by reasoning about a name and a size. It was picked by running
// eight models against real screens - see the note on it in settings.js - and it
// was the only one that said so when OCR had eaten half of what it was asked
// about. So it outranks everything below by more than any of them can make up.
//
// That ordering is the point rather than a detail. Without it this file
// cheerfully recommends its way past the one number anybody actually measured,
// on the strength of a tool-calling flag the pet does not even use. The ranking
// exists for somebody who does not have that model or wants something else, not
// to argue with the benchmark.
const BENCHMARKED = require('./settings').DEFAULTS.model;

// What the pet actually asks a model to do, and what that rules out.
//
//   * a screen of OCR is a lot of text. Under this much context the prompt is
//     truncated before the model ever sees the bottom of the screen, which is
//     the failure that looks like the model being stupid.
const MIN_CTX = 8192;
//   * under about 7B the answers are confident and wrong in a way that is worse
//     than no answer, because the whole feature is answering questions about
//     something you can see and it cannot.
const MIN_B = 6.5;
//   * over about 14B you wait. The pet answers while you are looking at the
//     bubble, so the ceiling is patience rather than memory.
const MAX_B = 14;

/** "8.2B" -> 8.2, "700M" -> 0.7, anything unreadable -> 0. */
function billions(size) {
  const m = /^([\d.]+)\s*([BM])$/i.exec(String(size || '').trim());
  if (!m) return 0;
  // Divided rather than multiplied by 0.001: 700 * 0.001 is 0.7000000000000001,
  // and a size that does not compare equal to itself is a bad hour later on.
  const n = Number(m[1]);
  return m[2].toUpperCase() === 'M' ? n / 1000 : n;
}

const has = (row, cap) => Array.isArray(row.capabilities) && row.capabilities.includes(cap);

/**
 * Score one model for the pet's text slot - reading the screen, and chatting.
 *
 * Reasoning wins the tie, and that is measured rather than assumed: see the
 * note on the default in settings.js. It was the only model of eight that
 * noticed OCR had eaten half the code it was asked about, instead of confidently
 * answering about text it had never been given. The pet already switches
 * thinking off everywhere it does not pay - small talk and timed reads - so the
 * wait is charged only to the question you actually asked.
 *
 * @returns {number} higher is better, 0 means unusable
 */
function scoreText(row) {
  const b = billions(row.params);
  const ctx = Number(row.ctx) || 0;
  // A vision model with no text capability is not a candidate for this slot at
  // all, whatever its size. It has its own slot below.
  if (has(row, 'vision') && !has(row, 'completion')) return 0;
  if (ctx && ctx < MIN_CTX) return 0;
  if (b && (b < MIN_B || b > MAX_B)) return 0;

  let score = 100;
  if (row.name === BENCHMARKED) score += 60;
  if (has(row, 'thinking')) score += 40;
  // Not because the pet calls tools - it does not, skills.js is plain
  // JavaScript - but because a model trained to follow a schema follows an
  // instruction, and "answer in two sentences" is the instruction that keeps a
  // bubble a bubble.
  if (has(row, 'tools')) score += 10;
  // Nearer 8B than either edge, which is where the measurements landed.
  score -= Math.abs(b - 8) * 3;
  // A tie between two of the same family goes to the one with more room.
  score += Math.min(ctx, 131072) / 131072;
  return score;
}

/** Vision is a different job: reading a diagram, not a page of text. */
function scoreVision(row) {
  if (!has(row, 'vision')) return 0;
  // Bigger is better here and there is no patience ceiling, because this tier
  // only runs when OCR found nothing worth reading - it is already the slow
  // path, taken rarely, and the alternative is silence.
  return 100 + billions(row.params) + Math.min(Number(row.ctx) || 0, 131072) / 131072;
}

function why(row) {
  const bits = [];
  const b = billions(row.params);
  if (row.name === BENCHMARKED) {
    return 'it was the only one of eight tested that noticed when OCR had eaten '
      + 'half of what it was asked about, rather than confidently answering anyway';
  }
  if (has(row, 'thinking')) {
    bits.push('it reasons before answering, which is what catches a screen that was only half read');
  }
  if (b) bits.push(`${row.params} is small enough to answer while you are looking at the bubble`);
  if (!bits.length) bits.push('it is the only one installed that fits');
  return bits.join(', and ');
}

/**
 * Rank what is installed.
 *
 * @param {Array<{name: string, params?: string, ctx?: number, size?: number,
 *   capabilities?: string[]}>} rows  as reported by Ollama
 * @returns {{text: {name: string, why: string}|null,
 *   vision: {name: string, why: string}|null, notes: string[]}}
 */
function advise(rows) {
  const models = Array.isArray(rows) ? rows.filter((r) => r && r.name) : [];
  const notes = [];
  if (!models.length) return { text: null, vision: null, notes };

  const best = (score) => models
    .map((row) => ({ row, score: score(row) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))[0];

  const text = best(scoreText);
  const vision = best(scoreVision);

  if (!text) {
    // Said rather than left blank. "No recommendation" reads as the feature
    // being broken; the reason is short and it is actionable.
    notes.push(
      'None of the installed models fit reading a screen — the pet wants one of '
      + `about ${MIN_B} to ${MAX_B} billion parameters with at least `
      + `${MIN_CTX / 1024}k of context, because a screen of text is a lot of prompt.`
    );
  }
  if (!vision) {
    notes.push(
      'No vision model installed, so diagrams and screenshots with no text in '
      + 'them get read by OCR and mostly come back empty. `ollama pull moondream` '
      + 'is 1.7GB and switches that on.'
    );
  }

  return {
    text: text ? { name: text.row.name, why: why(text.row) } : null,
    vision: vision ? { name: vision.row.name, why: 'it is the one that can see images' } : null,
    notes,
  };
}

module.exports = { advise, billions, scoreText, scoreVision, BENCHMARKED, MIN_CTX, MIN_B, MAX_B };
