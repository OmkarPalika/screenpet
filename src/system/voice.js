'use strict';

const host = require('./host');
const piper = require('./piper');

// The pet's voice, fetched as audio so the renderer can do something with it.
// say.ps1 explains why that is worth a process at all; this is the request half.
//
// One long-lived child, like the window watcher: ~400ms to start PowerShell and
// another ~150ms to load the speech engine, and paying that before every
// sentence would be a pet that pauses to think about how to say hello. Warm, a
// sentence comes back in about 300ms.
//
// Never rejects. A voice that cannot be fetched means the renderer speaks the
// line with SpeechSynthesis instead, which is what this app always did, and a
// pet that says nothing because its filter chain was unavailable is a worse
// answer than a pet that sounds ordinary.

let child = null;
let ready = false;
// One at a time. The pet says one thing at a time, and a second request while
// the first is in flight is a line that interrupted another line - the newer one
// is the one worth hearing.
let waiting = null;
let buffer = '';

// Warm: ~300ms for a sentence. Cold enough to matter only if the engine is
// wedged, and then the fallback voice is right there.
const TIMEOUT_MS = 6000;

// Base64 of 22050Hz 16-bit mono. A minute of speech is about 3.5MB of it, and
// the pet's lines are seconds long - anything past this is not a sentence.
const MAX_AUDIO_CHARS = 8 * 1024 * 1024;

function settle(value) {
  const pending = waiting;
  waiting = null;
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.resolve(value);
}

function onLine(line) {
  const text = line.trim();
  if (!text) return;
  if (text === 'READY') { ready = true; return; }
  // Anything that is not base64 audio is a refusal. say.ps1 keeps its errors to
  // one line for this reason: the pet should fall back to talking, not read an
  // exception out loud.
  if (text.startsWith('ERROR ') || text.length > MAX_AUDIO_CHARS) return settle(null);
  settle(text);
}

function start() {
  if (child) return true;
  try {
    child = host.spawn('say');
  } catch {
    child = null;
    return false;
  }

  child.stdout.on('data', (d) => {
    buffer += d;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    // A sentence of audio is megabytes of base64 and arrives in many chunks, so
    // there is no cap on the partial line here - the cap is on the whole one,
    // in onLine, where it can actually be judged.
    for (const line of lines) onLine(line);
  });

  const gone = () => {
    child = null;
    ready = false;
    buffer = '';
    settle(null); // whoever was waiting gets the system voice
  };
  child.on('error', gone);
  child.on('close', gone);
  return true;
}

/**
 * Windows' own voice, which is what this app has always used.
 *
 * @param {string} line
 * @param {number} rate  SAPI's -10..10. Slower than natural on purpose when the
 *   renderer is going to play it back faster - see robot.js, where that is what
 *   raises the pitch without turning the pet into a chipmunk.
 */
function sapi(line, rate) {
  if (!start()) return Promise.resolve(null);

  // The previous line was interrupted by this one. It is not coming.
  settle(null);

  return new Promise((resolve) => {
    waiting = {
      resolve,
      timer: setTimeout(() => settle(null), TIMEOUT_MS),
    };
    // JSON.stringify, never string concatenation: the text is a model's output
    // and a stray quote in it would otherwise be a line of PowerShell.
    child.stdin.write(`${JSON.stringify({ text: line, rate })}\n`);
  }).then((wav) => (wav ? { wav, engine: 'sapi' } : null));
}

/**
 * A line of speech as audio, or null to use the platform voice.
 *
 * Piper first when a voice has been installed, because the whole reason to
 * install one is that it sounds better than the other branch. It falls back to
 * Windows rather than to silence: a voice that could not be started should cost
 * you the good voice, not the pet's ability to speak.
 *
 * The engine comes back with the audio because the two need different playback.
 * robot.js is a rescue written for Microsoft David, and running a neural voice
 * through a ring modulator would undo the thing that was paid for.
 *
 * @param {string} text
 * @param {number} rate
 * @param {{userData?: string}} opts
 * @returns {Promise<{wav: string, engine: string}|null>} base64 WAV and which
 *   engine made it, or null for the platform voice.
 */
function say(text, rate = 0, opts = {}) {
  const line = String(text || '').trim();
  if (!line) return Promise.resolve(null);

  if (piper.installed(opts.userData)) {
    return piper.say(line, opts).then(
      (wav) => ({ wav: wav.toString('base64'), engine: 'piper' }),
      () => sapi(line, rate)
    );
  }
  return sapi(line, rate);
}

/** Shut the voice. Safe to call when nothing is running. */
function stop() {
  if (!child) return;
  const dying = child;
  child = null;
  ready = false;
  settle(null);
  dying.kill();
}

const running = () => child !== null;
const isReady = () => ready;

module.exports = { say, stop, running, isReady, TIMEOUT_MS, MAX_AUDIO_CHARS };
