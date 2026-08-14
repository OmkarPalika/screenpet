'use strict';

const { spawn } = require('child_process');
const path = require('path');

// Same arrangement as ocr.js, and the same PowerShell 5.1 requirement: the WinRT
// projections faces.ps1 relies on are not present in PowerShell 7+.
const SCRIPT = path.join(__dirname, 'faces.ps1').replace('app.asar', 'app.asar.unpacked');

const PWSH = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);

// A 320x240 JPEG is tens of kilobytes. This is the ceiling before anything is
// decoded, so a renderer sending something absurd is refused rather than piped
// into a shell.
const MAX_CHARS = 4 * 1024 * 1024;

const PREFIX = 'data:image/jpeg;base64,';

// A frame is worth about a second of PowerShell, so this is asked at the moment
// the answer matters - somebody arrived - and never on a loop.
const TIMEOUT_MS = 15000;

/**
 * How many faces are in one frame. Not whose: Windows.Media.FaceAnalysis has no
 * identify, no compare and no embedding, so there is no version of this function
 * that could tell you who it is.
 *
 * The frame goes to PowerShell down a pipe and is never written anywhere. It
 * exists in this process for as long as this call takes and then it is gone.
 *
 * @param {string} dataUrl  a data:image/jpeg;base64 frame from the renderer
 * @returns {Promise<number>} 0 or more
 */
function count(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX) || dataUrl.length > MAX_CHARS) {
    return Promise.reject(new Error('that is not a frame I can look at'));
  }

  return new Promise((resolve, reject) => {
    const ps = spawn(
      PWSH,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
      { windowsHide: true }
    );

    const timer = setTimeout(() => ps.kill(), TIMEOUT_MS);
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', (e) => { clearTimeout(timer); reject(e); });
    ps.on('close', (code) => {
      clearTimeout(timer);
      const n = Number(out.trim());
      if (code === 0 && Number.isInteger(n) && n >= 0) return resolve(n);
      const first = err.trim().split('\n')[0].trim();
      reject(new Error(first || `the face check exited with code ${code}`));
    });

    ps.stdin.end(dataUrl.slice(PREFIX.length));
  });
}

module.exports = { count, MAX_CHARS, PREFIX };
