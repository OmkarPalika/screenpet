'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const host = require('./host');

// Windows answers this through a P/Invoke in dnd.ps1; macOS keeps it in a file
// and is read in-process below. Two different shapes for one question, which is
// why this module branches rather than host.js hiding it.

// QUERY_USER_NOTIFICATION_STATE. The two talkative ones are listed rather than
// the five quiet ones, so a value Windows adds in a future version is treated as
// "keep quiet" instead of "go ahead" - the safe way round for something whose
// job is to not interrupt you.
//
// 1 QUNS_NOT_PRESENT             screen off or locked
// 2 QUNS_BUSY                    a full screen application is running
// 3 QUNS_RUNNING_D3D_FULL_SCREEN a full screen D3D application (a game)
// 4 QUNS_PRESENTATION_MODE       presenting
// 5 QUNS_QUIET_TIME              Focus Assist / Do Not Disturb
// 6 QUNS_APP                     a full screen app that is not D3D
// 7 QUNS_ACCEPTS_NOTIFICATIONS   nothing in the way
const QUNS_QUIET = 5;
const QUNS_ACCEPTS = 7;
const TALKATIVE = new Set([QUNS_ACCEPTS]);

/** Pure half, so the mapping can be tested without spawning anything. */
function isQuiet(state) {
  return !TALKATIVE.has(state);
}

/**
 * Ask Windows for the current notification state.
 *
 * ~750ms, about 400ms of which is PowerShell starting and 350ms compiling the
 * P/Invoke. Called on the pet's existing 20 second tick and never in a loop.
 *
 * @returns {Promise<number>} one of the QUNS values above
 */
// Windows owns this number. The override exists because a machine sitting in one
// state all day can only ever demonstrate half the behaviour, and "the pet went
// quiet" and "the pet is broken" look identical from outside. Same reasoning as
// SCREENPET_MIC_CONFIDENCE: the knob is for the thing that cannot be arranged on
// demand.
const FORCED = Number(process.env.SCREENPET_QUNS);

/**
 * macOS keeps the current Focus in a JSON file rather than behind an API, so
 * this is a file read and not a process. It answers in the same vocabulary as
 * Windows so isQuiet above stays the only place the mapping lives.
 *
 * Narrower than the Windows answer, and deliberately: QUNS also covers a game,
 * a full screen app and presenting, and macOS exposes none of those cheaply.
 * Focus is the part people actually set on purpose.
 *
 * A missing file is a real answer - no assertion is active - so it is 7 rather
 * than an error. A file that will not parse is not an answer, and rejecting
 * lets quiet() fall back the same way it does for a failed Windows check.
 */
function macState() {
  const file = path.join(os.homedir(), 'Library', 'DoNotDisturb', 'DB', 'Assertions.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return Promise.resolve(QUNS_ACCEPTS);
  }
  try {
    const data = JSON.parse(raw);
    const records = ((data.data || [])[0] || {}).storeAssertionRecords;
    return Promise.resolve(Array.isArray(records) && records.length ? QUNS_QUIET : QUNS_ACCEPTS);
  } catch (err) {
    return Promise.reject(new Error(`I could not read the Focus setting: ${err.message}`));
  }
}

function state() {
  if (Number.isInteger(FORCED)) return Promise.resolve(FORCED);
  if (host.PLATFORM === 'darwin') return macState();
  return new Promise((resolve, reject) => {
    const ps = host.spawn('dnd');

    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', reject);
    ps.on('close', (exit) => {
      const value = Number(out.trim());
      if (exit === 0 && Number.isInteger(value)) return resolve(value);
      const first = err.trim().split('\n')[0].trim();
      reject(new Error(first || `The notification state check exited with code ${exit}`));
    });

    ps.stdin.end();
  });
}

/** The whole question, answered. Never rejects: unknown means carry on as normal. */
function quiet() {
  return state().then(isQuiet, () => false);
}

module.exports = { state, quiet, isQuiet, TALKATIVE };
