'use strict';

const { spawn } = require('child_process');
const path = require('path');

// Same arrangement as ocr.js, speech.js and media.js: PowerShell cannot read a
// script from inside an asar archive.
const SCRIPT = path.join(__dirname, 'dnd.ps1').replace('app.asar', 'app.asar.unpacked');

const PWSH = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);

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
const TALKATIVE = new Set([7]);

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
function state() {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      PWSH,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
      { windowsHide: true }
    );

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
