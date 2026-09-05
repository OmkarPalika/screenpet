'use strict';

// A voice worth listening to, when you give the pet one.
//
// Everything the pet says goes through voice.js, which asks Windows for the
// audio and hands it to robot.js - and robot.js exists because what Windows
// hands back is Microsoft David, who sounds like a train station. That filter
// chain is a rescue, not a preference: the ring modulator is there to turn a bad
// voice into a deliberate one, on the grounds that a pet that sounds like a
// robot on purpose beats a pet that sounds like a kiosk by accident.
//
// Piper is the other way round. It is a local neural voice that already sounds
// like somebody, so there is nothing to rescue and robot.js switches most of
// itself off for it - see VOICE there.
//
// Same shape as dictation, for the same three reasons:
//
//   * nothing is bundled. Shipping someone else's build inside this installer
//     is a licensing and signing question this project has not answered, and
//     piper1-gpl is GPL. Spawning a binary is not linking it, which is what
//     keeps that licence off this one - but only while it stays a binary you
//     went and got, in a folder of your own.
//   * nothing is configurable. A path to an executable in settings.json is
//     arbitrary code execution wearing a lab coat, and this app hardcodes its
//     OCR script, its weather host and its provider URLs for exactly that
//     reason.
//   * nothing leaves the machine. That is the whole point of choosing this over
//     any of the hosted voices, which are better still and are not an option.
//
// The files live in one fixed place or the pet keeps the voice it had.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// <userData>/piper/ - alongside settings.json and the whisper folder, not inside
// the asar, so a voice survives an app update and nothing has to be unpacked at
// install time.
const DIR = 'piper';

const EXE = process.platform === 'win32' ? 'piper.exe' : 'piper';

// Piper writes a WAV to stdout with `-f -`, one per line of text on stdin. One
// line in and stdin closed means exactly one WAV out, which is the whole reason
// this spawns per sentence rather than keeping a warm child the way say.ps1
// does: with a long-lived process the WAVs arrive back to back with nothing
// between them to say where one ends.
//
// ponytail: a process per line. Measured cold at about 900ms and warm at 400ms
// for a short sentence, most of which is loading the model - against say.ps1's
// 300ms warm. If that turns out to be too long a pause before the pet speaks,
// the upgrade is `--output_raw` on a long-lived child plus framing of our own,
// which is a real amount of work to save 100ms and is not worth doing on a
// guess.
const args = (model) => ['-m', model, '-f', '-'];

// Long enough for a sentence on a slow CPU with a cold model, short enough that
// a wedged process does not hold the pet silent. It falls back to the platform
// voice when this runs out, so the cost of being wrong here is an ordinary
// sounding pet rather than a mute one.
const TIMEOUT_MS = 15000;

// The pet says one or two sentences. This is about a minute of 22kHz 16-bit
// mono, which nothing legitimate reaches.
const MAX_WAV_BYTES = 8 * 1024 * 1024;

// Same ceiling the chat box and dictation use rather than a third one to keep in
// step.
const MAX_CHARS = 500;

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * The voice model to use, or null.
 *
 * Any `.onnx` in the folder with its `.onnx.json` beside it. Both halves,
 * because piper reads the sample rate and the phoneme map out of the json and
 * refuses the model without it - the same rule dictation follows, for the same
 * reason: half an install is worse than none, because it fails at the moment
 * the pet tries to speak rather than at the moment you look.
 *
 * Sorted, so a folder with two voices in it picks the same one every launch.
 * Which one is not worth a setting: delete the one you do not want.
 */
function voiceFor(userData) {
  const dir = path.join(userData || '', DIR);
  let names;
  try {
    names = fs.readdirSync(dir).sort();
  } catch {
    return null;
  }
  const model = names.find((n) => n.endsWith('.onnx') && names.includes(`${n}.json`));
  return model ? path.join(dir, model) : null;
}

const exePath = (userData) => path.join(userData || '', DIR, EXE);

/** Both halves present: the binary, and a voice for it to read with. */
const installed = (userData) => isFile(exePath(userData)) && voiceFor(userData) !== null;

/**
 * Which voice it found, for a settings window that wants to say so. The file
 * name without its extension, which is how piper's own voices are named -
 * `en_GB-jenny_dioco-medium.onnx` reads as well as anything this could invent.
 */
function installedName(userData) {
  const model = voiceFor(userData);
  return model ? path.basename(model, '.onnx') : null;
}

/**
 * One line of text in, one WAV out.
 *
 * Rejects rather than resolving null: voice.js is the place that decides a
 * failed voice means the platform voice, and it already does that for say.ps1.
 * Two modules quietly deciding the same thing is how one of them ends up
 * silently disabled.
 *
 * @param {string} text
 * @param {{userData: string, timeoutMs?: number}} opts
 * @returns {Promise<Buffer>} a WAV, ready to decode
 */
function say(text, opts = {}) {
  // Newlines are the frame, so a line break in the text would be two utterances
  // and two WAVs glued together - the second of which nothing would play.
  const line = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!line) return Promise.reject(new Error('nothing to say'));

  const model = voiceFor(opts.userData);
  const exe = exePath(opts.userData);
  if (!model || !isFile(exe)) return Promise.reject(new Error('no voice installed'));

  return new Promise((resolve, reject) => {
    const ps = spawn(exe, args(model), {
      windowsHide: true,
      cwd: path.dirname(exe), // its own dlls and espeak-ng-data sit beside it
    });

    const chunks = [];
    let size = 0;
    let err = '';
    let done = false;

    const fail = (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ps.kill(); } catch { /* already gone */ }
      reject(e);
    };

    const timer = setTimeout(() => fail(new Error('the voice took too long')), opts.timeoutMs || TIMEOUT_MS);

    ps.stdout.on('data', (d) => {
      size += d.length;
      // Refused as it arrives rather than after the fact: the point of a ceiling
      // is not to hold eight megabytes in memory first and then object to them.
      if (size > MAX_WAV_BYTES) return fail(new Error('that is too much audio'));
      chunks.push(d);
    });
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', fail);
    ps.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        // Piper narrates its progress on stderr, so the useful line is the last
        // one rather than the first - the same way whisper reports itself.
        const last = err.trim().split('\n').pop().trim();
        return reject(new Error(last || `the voice exited with code ${code}`));
      }
      const wav = Buffer.concat(chunks);
      // A header and nothing else. Piper exits 0 having said nothing when it
      // cannot phonemise the line, and an empty buffer reaches decodeAudioData
      // as an exception rather than as silence.
      if (wav.length < 64) return reject(new Error('the voice produced no audio'));
      resolve(wav);
    });

    // EPIPE if it died before reading the line; the close handler above already
    // has the real reason and must not be talked over.
    ps.stdin.on('error', () => {});
    ps.stdin.end(`${line}\n`);
  });
}

module.exports = {
  say, installed, installedName, voiceFor, exePath,
  DIR, EXE, TIMEOUT_MS, MAX_WAV_BYTES, MAX_CHARS,
};
