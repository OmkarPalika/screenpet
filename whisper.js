'use strict';

// Dictation with whisper.cpp, when it is installed. Still entirely on this
// machine: a binary in your own app folder, a model file beside it, and audio
// that goes down a pipe and is never written anywhere.
//
// Why this exists at all, measured on fourteen phrases spoken into the actual
// microphone (see the benchmark note in the README):
//
//   System.Speech        88% word error rate, and 14 of 14 results scored under
//                        listen.ps1's own 0.30 confidence floor - so the feature
//                        did not merely mishear, it declined to answer at all
//   whisper base.en      49%
//   whisper base.en      21%   <- with the vocabulary prompt below
//   whisper tiny.en      27%   with the same prompt, and faster than the
//                        PowerShell spawn System.Speech needs
//
// The install is deliberately not configurable. A path to an executable in
// settings.json is an arbitrary-code-execution setting wearing a lab coat, and
// this app hardcodes its OCR script, its weather host and its provider URLs for
// exactly that reason. Both files live in one fixed place or the feature is off.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// <userData>/whisper/ - alongside settings.json, not inside the asar, so a model
// survives an app update and nothing has to be unpacked at install time.
const DIR = 'whisper';
const EXE = 'whisper-cli.exe';
const MODEL = 'model.bin';

// Long enough for base.en on a slow CPU (measured: 1.6s for a 3s clip, and a
// cold first run is slower), short enough that a wedged process does not hold
// the pet's mouth open.
const TIMEOUT_MS = 20000;

// The chat box caps typing at 500 characters and speech.js caps dictation at the
// same. A third ceiling would be a third thing to keep in step.
const MAX_CHARS = 500;

// About eight minutes of 16 kHz mono. Nothing legitimate reaches this - the
// recorder stops on silence - so anything that does is a bug upstream, and it is
// refused before it becomes a 40MB pipe write.
const MAX_WAV_BYTES = 16 * 1024 * 1024;

/**
 * What the pet is likely to be told, in the words it is likely to be told in.
 *
 * This single string is the largest measured improvement in the whole swap: 49%
 * to 21% overall, and 87% to 29% on technical phrases. "git rebase onto main"
 * went from "Get re-based on domain." to exact, and "why is my Postgres query
 * slow" from "Why is my post just very slow?" to exact.
 *
 * It biases decoding, it does not constrain it - ordinary sentences were
 * unaffected in the measurement (chat phrases scored 0% either way). Keep it to
 * vocabulary the app actually exists to hear; a prompt that starts describing a
 * task begins to leak into the transcript.
 */
const VOCAB =
  'Technical dictation for a developer: npm, JSON, git, rebase, Postgres, '
  + 'JavaScript, async, await, API, HTTP status code, 401, syntax error, stack trace, '
  + 'localhost, SQL query, commit, branch, merge.';

// Whisper narrates non-speech in brackets - [BLANK_AUDIO], (upbeat music),
// *sighs*. That is a stage direction, not something the person said, and a pet
// that reads it out loud looks broken.
const ANNOTATION = /[[(*][^\])*]{0,60}[\])*]/g;

/**
 * What it says when it has been handed silence.
 *
 * Measured, not guessed: two seconds of near-silence through base.en comes back
 * as "you". Whisper has no confidence score to gate on the way System.Speech
 * does, so the gate has to be here and at the recorder, which does not send
 * audio it measured as silent in the first place. This list is the second lock.
 */
const HALLUCINATIONS = new Set([
  'you', 'thank you', 'thanks for watching', 'thanks for watching!', 'bye',
  'the end', 'silence', 'blank_audio', 'so', 'uh', 'um', '.', '',
]);

const paths = (userData) => ({
  exe: path.join(userData, DIR, EXE),
  model: path.join(userData, DIR, MODEL),
});

/** Both halves present, or the setting cannot be honoured. */
function installed(userData) {
  const p = paths(userData);
  try {
    return fs.statSync(p.exe).isFile() && fs.statSync(p.model).isFile();
  } catch {
    return false;
  }
}

/** Strip the annotations, the stray carriage returns and the leading space. */
function clean(raw) {
  const text = String(raw || '')
    .replace(ANNOTATION, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
  return HALLUCINATIONS.has(text.toLowerCase().replace(/[.!?]+$/, '')) ? '' : text;
}

/**
 * One WAV in, one line of text out.
 *
 * The audio goes down stdin and is never written to disk, which is what keeps
 * the promise listen.ps1 already makes. That costs one piece of arcana: with
 * `-f -`, whisper-cli derives its output base name from the input name, ends up
 * with "-", decides that means stdout, and silently prints nothing. `-of` gives
 * it a name to be quiet about. It writes no file, because no --output-* format
 * is asked for. Removing that flag looks like tidying and turns dictation off.
 *
 * @param {Buffer} wav  16 kHz mono 16-bit PCM, from the recorder
 * @param {{userData: string, timeoutMs?: number}} opts
 * @returns {Promise<string>} what was said, or '' if nothing was
 */
function transcribe(wav, opts = {}) {
  const p = paths(opts.userData);
  if (!Buffer.isBuffer(wav) || !wav.length) return Promise.reject(new Error('no audio to listen to'));
  if (wav.length > MAX_WAV_BYTES) return Promise.reject(new Error('that is too much audio'));

  return new Promise((resolve, reject) => {
    const ps = spawn(
      p.exe,
      [
        '-m', p.model,
        '-f', '-',            // stdin: the audio never lands on disk
        '-of', 'transcript',  // see above - without this it prints nothing
        '-nt',                // no timestamps, this is one spoken line
        '-np',                // no progress chatter on stdout
        '-l', 'en',
        '--prompt', VOCAB,
      ],
      { windowsHide: true, cwd: path.dirname(p.exe) }
    );

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      ps.kill();
      reject(new Error('that took too long to hear'));
    }, opts.timeoutMs || TIMEOUT_MS);

    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ps.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const first = err.trim().split('\n').pop().trim();
        return reject(new Error(first || `whisper exited with code ${code}`));
      }
      resolve(clean(out));
    });

    // EPIPE if it died before reading the audio; the close handler above already
    // has the real reason, so this must not throw over the top of it.
    ps.stdin.on('error', () => {});
    ps.stdin.end(wav);
  });
}

module.exports = {
  transcribe, installed, paths, clean,
  DIR, EXE, MODEL, VOCAB, HALLUCINATIONS, MAX_CHARS, MAX_WAV_BYTES,
};
