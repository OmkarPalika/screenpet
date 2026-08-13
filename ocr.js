'use strict';

const { spawn } = require('child_process');
const path = require('path');

// PowerShell cannot read a file from inside an asar archive, so ocr.ps1 is
// listed in asarUnpack and lives beside it in app.asar.unpacked. In development
// __dirname contains no 'app.asar' and this is a no-op.
const SCRIPT = path.join(__dirname, 'ocr.ps1').replace('app.asar', 'app.asar.unpacked');

// Windows 5.1 PowerShell specifically: the WinRT type projections ocr.ps1 relies
// on are not present in PowerShell 7+.
const PWSH = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);

/**
 * @param {Buffer} pngBuffer  PNG bytes, passed on stdin. Never written to disk.
 * @returns {Promise<string>} recognised text
 */
function recognise(pngBuffer) {
  return new Promise((resolve, reject) => {
    const ps = spawn(PWSH, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
      windowsHide: true,
    });

    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `OCR exited with code ${code}`));
    });

    ps.stdin.end(pngBuffer.toString('base64'));
  });
}

module.exports = { recognise };
