'use strict';

const { spawn } = require('child_process');
const path = require('path');

// Same arrangement as ocr.js, speech.js, media.js and dnd.js.
const SCRIPT = path.join(__dirname, 'wake.ps1').replace('app.asar', 'app.asar.unpacked');

const PWSH = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);

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

  child = spawn(
    PWSH,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
    { windowsHide: true }
  );

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
