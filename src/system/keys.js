'use strict';

// API keys, if you have chosen a provider that needs one. Nothing here runs at
// all while the app is in its default local-only mode.
//
// Where a key lives:
//   * in keys.json, wrapped with Windows DPAPI under your user account, never in
//     settings.json - which the settings window round-trips through the renderer
//   * in this process's memory for the session, so the ~700ms PowerShell spawn
//     is paid once per provider rather than once per question
//
// Where it never goes: the renderer, a log line, an error message, or a command
// line. The settings window can set a key and clear a key; it is never told one,
// and there is no IPC channel that returns one. See main.js.

const host = require('./host');

// DPAPI on Windows, the Keychain on macOS. Both are reached by a child process
// that takes the key on stdin, never on a command line.


const TIMEOUT_MS = 15000;

// Long enough for any provider's key, short enough that a mangled paste is
// refused rather than wrapped.
const MAX_KEY_CHARS = 500;

// Unwrapped keys for this session only. Cleared on quit with the process.
const cache = new Map();

function run(mode, payload) {
  return new Promise((resolve, reject) => {
    // The mode is one of three literals chosen inside this file, never by a
    // caller, so neither spelling is a place user input can reach.
    const ps = host.spawn('keys', host.PLATFORM === 'darwin' ? [mode] : ['-Mode', mode]);

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      ps.kill();
      reject(new Error('the key store did not answer'));
    }, TIMEOUT_MS);

    ps.stdout.on('data', (d) => (out += d));
    ps.stderr.on('data', (d) => (err += d));
    ps.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ps.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) return resolve(out.trim());
      // Deliberately not the raw stderr: an unprotect failure can echo the input
      // back, and the input is the thing being protected.
      reject(new Error(
        mode === 'protect' ? 'could not store that key' : 'could not read the stored key'
      ));
    });

    ps.stdin.end(payload, 'utf8');
  });
}

/** A key in, a DPAPI blob out. The only place a key is written down. */
async function protect(key) {
  const text = String(key || '').trim();
  if (!text || text.length > MAX_KEY_CHARS) throw new Error('that does not look like a key');
  return run('protect', text);
}

/** A blob back to a key, once per session per provider. */
async function unprotect(blob) {
  const text = String(blob || '').trim();
  if (!text) throw new Error('no key stored');
  return run('unprotect', text);
}

/**
 * The usable key for a provider, or null.
 *
 * Never throws: a key that cannot be unwrapped means the provider is unusable,
 * and the caller says so in a bubble rather than the app failing sideways.
 *
 * @param {string} provider
 * @param {object} store  the parsed keys.json - { provider: blob }
 */
async function get(provider, store) {
  if (cache.has(provider)) return cache.get(provider);
  const blob = store && typeof store === 'object' ? store[provider] : null;
  if (typeof blob !== 'string' || !blob) return null;
  try {
    const key = await unprotect(blob);
    cache.set(provider, key);
    return key;
  } catch {
    return null;
  }
}

/** Which providers have a key stored. Booleans, which is all the renderer gets. */
function present(store) {
  const out = {};
  if (!store || typeof store !== 'object') return out;
  for (const [name, blob] of Object.entries(store)) {
    if (typeof blob === 'string' && blob) out[name] = true;
  }
  return out;
}

const drop = (provider) => cache.delete(provider);
const clear = () => cache.clear();

module.exports = { protect, unprotect, get, present, drop, clear, MAX_KEY_CHARS };
