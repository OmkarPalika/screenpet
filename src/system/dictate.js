'use strict';

// Dictation with a local engine, when one is installed. Still entirely on this
// machine: a binary in your own app folder, a model file beside it, and audio
// that goes down a pipe and is never written anywhere.
//
// Why this exists at all, measured on fourteen phrases spoken into the actual
// microphone (see the benchmark in DESIGN.md):
//
//   System.Speech        88% word error rate, and 14 of 14 results scored under
//                        listen.ps1's own 0.30 confidence floor - so the feature
//                        did not merely mishear, it declined to answer at all
//   whisper base.en      49%, and 21% with the vocabulary prompt below
//   parakeet tdt q4_k    19%
//
// Two engines rather than one, because they do not win at the same things and
// the difference is not a rounding error:
//
//   parakeet is better at commands   10% against whisper's 23%. It heard
//                                    "forget everything" where whisper heard
//                                    "Forward everything" - in this app a wrong
//                                    word does not just misread, it fires a real
//                                    skill. It also returns nothing at all on
//                                    silence, where whisper answers "you".
//   whisper is better at code words  29% against parakeet's 35%, entirely
//                                    because of the prompt below. Parakeet has no
//                                    equivalent, so "git rebase onto main" comes
//                                    back as "Get rebassed on to main".
//   ...and whisper is much smaller   142MB against 397MB, which for a tray pet
//                                    is most of the argument.
//
// So the engine is whichever binary you put in the folder, and the app adapts.
// Neither is bundled: shipping someone else's build inside this installer is a
// licensing and signing question this project has not answered.
//
// The install is deliberately not configurable. A path to an executable in
// settings.json is arbitrary-code-execution wearing a lab coat, and this app
// hardcodes its OCR script, its weather host and its provider URLs for exactly
// that reason. The files live in one fixed place or the feature is off.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// <userData>/whisper/ - alongside settings.json, not inside the asar, so a model
// survives an app update and nothing has to be unpacked at install time. The
// folder keeps its original name so an existing install does not break.
const DIR = 'whisper';

/**
 * What the pet is likely to be told, in the words it is likely to be told in.
 *
 * Whisper only - parakeet takes no prompt. This single string is the largest
 * measured improvement available to whisper: 49% to 21% overall, and 87% to 29%
 * on technical phrases. "git rebase onto main" went from "Get re-based on
 * domain." to exact, and "why is my Postgres query slow" from "Why is my post
 * just very slow?" to exact.
 *
 * It biases decoding, it does not constrain it - ordinary sentences were
 * unaffected in the measurement. Keep it to vocabulary the app exists to hear; a
 * prompt that starts describing a task begins to leak into the transcript.
 */
const VOCAB =
  'Technical dictation for a developer: npm, JSON, git, rebase, Postgres, '
  + 'JavaScript, async, await, API, HTTP status code, 401, syntax error, stack trace, '
  + 'localhost, SQL query, commit, branch, merge.';

/**
 * The engines, in the order they are preferred.
 *
 * **The model file picks the engine, not the binary.** That is not fussiness:
 * the whisper.cpp release ships `parakeet-cli.exe` and `whisper-cli.exe` in the
 * same folder, so anyone who copies that folder wholesale - which is what the
 * README tells you to do, for the dlls - has both binaries and one model. Choose
 * on the binary and you hand a whisper model to parakeet, which refuses it with
 * "invalid model data (bad magic)" and takes dictation down.
 *
 * So each engine has its own model name, and both have to be present for it to
 * count as installed. `model.bin` stays whisper's, because that is what the
 * first version of this shipped with and an existing install must keep working.
 *
 * Parakeet is preferred where both are genuinely installed: it is better at the
 * commands this app is mostly given, and it answers silence with silence.
 *
 * Both read the WAV from stdin, which is what keeps the audio off the disk.
 * Whisper costs one piece of arcana for it: with `-f -` it derives its output
 * base name from the input name, ends up with "-", decides that means stdout,
 * and silently prints nothing. `-of` gives it a name to be quiet about, and it
 * writes no file because no --output-* format is asked for. Removing that flag
 * looks like tidying and turns dictation off.
 */
// whisper.cpp ships the same binaries with no extension outside Windows, and
// the model files are named identically everywhere. Keeping this in one place
// means the engine table below stays about the engines.
const EXE = process.platform === 'win32' ? '.exe' : '';

const ENGINES = [
  {
    name: 'parakeet',
    exe: `parakeet-cli${EXE}`,
    model: 'parakeet.bin',
    args: (model) => ['-m', model, '-f', '-', '-np'],
  },
  {
    name: 'whisper',
    exe: `whisper-cli${EXE}`,
    model: 'model.bin',
    args: (model) => [
      '-m', model,
      '-f', '-',
      '-of', 'transcript', // see above - without this it prints nothing
      '-nt',               // no timestamps, this is one spoken line
      '-np',               // no progress chatter on stdout
      '-l', 'en',
      '--prompt', VOCAB,
    ],
  },
];

// Long enough for either engine on a slow CPU (measured: 1.1-1.6s for a 3s clip,
// and a cold first run is slower), short enough that a wedged process does not
// hold the pet's mouth open.
const TIMEOUT_MS = 20000;

// The chat box caps typing at 500 characters and speech.js caps dictation at the
// same. A third ceiling would be a third thing to keep in step.
const MAX_CHARS = 500;

// About eight minutes of 16 kHz mono. Nothing legitimate reaches this - the
// recorder stops on silence - so anything that does is a bug upstream, and it is
// refused before it becomes a 40MB pipe write.
const MAX_WAV_BYTES = 16 * 1024 * 1024;

// Both engines narrate non-speech in brackets - [BLANK_AUDIO], (upbeat music),
// *sighs*. That is a stage direction, not something the person said, and a pet
// that reads it out loud looks broken.
const ANNOTATION = /[[(*][^\])*]{0,60}[\])*]/g;

/**
 * What an engine says when it has been handed silence.
 *
 * Measured, not guessed: two seconds of near-silence through whisper base.en
 * comes back as "you". Neither engine reports a confidence the way System.Speech
 * does, so the gate has to be here and at the recorder, which does not send
 * audio it measured as silent in the first place. Parakeet returns nothing at
 * all, which is the better shape and the reason it is preferred above - this
 * list is dead weight for it and cheap enough to keep in one place.
 */
const HALLUCINATIONS = new Set([
  'you', 'thank you', 'thanks for watching', 'thanks for watching!', 'bye',
  'the end', 'silence', 'blank_audio', 'so', 'uh', 'um', '.', '',
]);

const modelPath = (userData, engine) => path.join(userData, DIR, engine.model);
const exePath = (userData, engine) => path.join(userData, DIR, engine.exe);

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Which engine is installed, or null. Both of *its own* halves have to be
 * present - see the note on ENGINES for why the model is what decides.
 *
 * @returns {{name: string, exe: string, model: string, args: Function}|null}
 */
function engineFor(userData) {
  return ENGINES.find((e) => isFile(modelPath(userData, e)) && isFile(exePath(userData, e))) || null;
}

/** Whether dictation can use a local engine at all. */
const installed = (userData) => engineFor(userData) !== null;

/** Its name, for a settings window that wants to say which one it found. */
const installedName = (userData) => (engineFor(userData) || {}).name || null;

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
 * @param {Buffer} wav  16 kHz mono 16-bit PCM, from the recorder
 * @param {{userData: string, timeoutMs?: number}} opts
 * @returns {Promise<string>} what was said, or '' if nothing was
 */
function transcribe(wav, opts = {}) {
  if (!Buffer.isBuffer(wav) || !wav.length) return Promise.reject(new Error('no audio to listen to'));
  if (wav.length > MAX_WAV_BYTES) return Promise.reject(new Error('that is too much audio'));

  const engine = engineFor(opts.userData);
  if (!engine) return Promise.reject(new Error('no dictation engine installed'));
  const exe = exePath(opts.userData, engine);

  return new Promise((resolve, reject) => {
    const ps = spawn(exe, engine.args(modelPath(opts.userData, engine)), {
      windowsHide: true,
      cwd: path.dirname(exe), // its own dlls sit beside it
    });

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
        return reject(new Error(first || `${engine.name} exited with code ${code}`));
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
  transcribe, installed, installedName, engineFor, clean,
  ENGINES, DIR, VOCAB, HALLUCINATIONS, MAX_CHARS, MAX_WAV_BYTES,
};
