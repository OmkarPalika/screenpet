'use strict';

const host = require('./host');

// Windows dictation only. macOS has no on-device recogniser this app is willing
// to use, so host.js does not offer `listen` there and main.js routes dictation
// to whisper.cpp or Parakeet instead.


// The chat box caps typing at 500 characters; dictation gets the same ceiling
// rather than a second, larger one nobody remembers to keep in step.
const MAX_CHARS = 500;

// Dictation returns a fluent-looking sentence for room noise - measured at 0.029
// on this machine against silence. See the note in listen.ps1 before changing
// it; the override exists because microphones and rooms differ and this is the
// number that will need moving.
const MIN_CONFIDENCE = Number(process.env.SCREENPET_MIC_CONFIDENCE || 0.3);

/**
 * Open the microphone for one phrase. Push to talk, not always-on: the mic is
 * live only between this call and the promise settling, which is the whole
 * reason it is a single blocking recognition rather than a listening loop.
 *
 * @returns {Promise<string>} what was said, or '' if nothing was.
 */
function listen({ seconds = 8 } = {}) {
  return new Promise((resolve, reject) => {
    const ps = host.spawn('listen', [String(seconds), String(MIN_CONFIDENCE)]);

    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code !== 0) {
        // PowerShell prints the whole error record; the first line is the
        // message thrown, and the rest is a stack trace nobody wants in a
        // speech bubble.
        const first = err.trim().split('\n')[0].trim();
        return reject(new Error(first || `Listening exited with code ${code}`));
      }
      resolve(out.trim().slice(0, MAX_CHARS));
    });

    ps.stdin.end();
  });
}

module.exports = { listen, MAX_CHARS };
