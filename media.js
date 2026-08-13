'use strict';

const { spawn } = require('child_process');
const path = require('path');

// Same arrangement as ocr.js and speech.js: PowerShell cannot read a script from
// inside an asar archive.
const SCRIPT = path.join(__dirname, 'media.ps1').replace('app.asar', 'app.asar.unpacked');

const PWSH = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);

// Windows virtual key codes. This is the entire vocabulary: there is no way to
// press anything else through here, because the name is looked up in this object
// and an unknown one never reaches the shell.
//
// Note what is missing. The app cannot ask what is playing, cannot see a track
// name, and gets nothing back but an exit code - a media key is a broadcast, not
// a conversation. That is the whole reason this is the media-control design and
// not a Spotify integration: an integration would need an account and a server.
const KEYS = {
  mute: 0xad,
  voldown: 0xae,
  volup: 0xaf,
  next: 0xb0,
  prev: 0xb1,
  stop: 0xb2,
  playpause: 0xb3,
};

/**
 * Press one media key. ~800ms, most of it PowerShell starting up, which is fine
 * for something a person asked for out loud and would be wrong in a loop.
 *
 * @param {string} name  a key of KEYS
 * @returns {Promise<void>}
 */
function press(name) {
  const code = KEYS[name];
  if (!code) return Promise.reject(new Error(`I do not know the key "${name}"`));

  return new Promise((resolve, reject) => {
    const ps = spawn(
      PWSH,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, String(code)],
      { windowsHide: true }
    );

    let err = '';
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', reject);
    ps.on('close', (exit) => {
      if (exit === 0) return resolve();
      const first = err.trim().split('\n')[0].trim();
      reject(new Error(first || `The media key exited with code ${exit}`));
    });

    ps.stdin.end();
  });
}

module.exports = { press, KEYS };
