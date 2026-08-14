'use strict';

const host = require('./host');

// Windows only, like listen: see the note in host.js for why a wake word is not
// something whisper can stand in for.


let child = null;

/** The one word wake.ps1 is capable of emitting. */
const WOKE = 'WAKE';

/**
 * Start listening for the wake phrase. Idempotent: calling it twice does not
 * open a second microphone.
 *
 * The child process holds the microphone for as long as it runs. That is the
 * cost of a wake word and there is no version of it that does not have that
 * cost, which is why this is only ever called when the setting is on.
 *
 * @param {(event: string) => void} onEvent  'ready' | 'woke' | 'error: ...'
 */
function start(onEvent) {
  if (child) return;

  // Unlike every other bridge here this is not inside a Promise, so on a host
  // without a wake word the throw would go straight through the caller. There is
  // an error channel already and this is exactly what it is for.
  try {
    child = host.spawn('wake');
  } catch (err) {
    child = null;
    onEvent(`error: ${err.message}`);
    return;
  }

  let buffer = '';
  child.stdout.on('data', (d) => {
    buffer += d;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      const word = line.trim();
      // Nothing else is acted on. A line this does not recognise is dropped
      // rather than passed along, so the only thing that can cross this boundary
      // is the fact that the phrase was said.
      if (word === WOKE) onEvent('woke');
      else if (word === 'READY') onEvent('ready');
    }
  });

  let err = '';
  child.stderr.on('data', (d) => (err += d));
  child.on('error', (e) => onEvent(`error: ${e.message}`));
  child.on('close', (code) => {
    const first = err.trim().split('\n')[0].trim();
    child = null;
    // Code 0 means it was asked to stop. Anything else died on its own.
    if (code !== 0 && code !== null) onEvent(`error: ${first || `the wake word listener exited with code ${code}`}`);
    else onEvent('stopped');
  });

  child.stdin.end();
}

/** Shut the microphone. Safe to call when nothing is running. */
function stop() {
  if (!child) return;
  const dying = child;
  child = null;
  dying.kill();
}

const listening = () => child !== null;

module.exports = { start, stop, listening, WOKE };
