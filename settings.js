'use strict';

// Pure settings handling. No disk, no Electron - main.js owns both.

const SKINS = ['butter', 'mint', 'blossom', 'slate'];

// Species and skin are orthogonal on purpose: every pet works in every palette,
// because the difference is shape and the palette is three CSS variables.
const PETS = ['blob', 'cat', 'pup', 'bun', 'bird', 'dragon'];

const DEFAULTS = {
  // Reasoning, and slower than llama3.1:8b for it - 6-12s against 1-3s warm.
  // Bought with that: it is the only model of eight benchmarked that noticed
  // when OCR had eaten half the code it was asked about, instead of confidently
  // answering a question about data it had never seen. On a tool whose whole job
  // is answering what is on your screen, that trade is worth making. See the
  // model table in the README.
  model: 'deepseek-r1:8b',
  // 'auto' picks a vision-capable model if Ollama has one, 'off' forces the OCR
  // path, anything else is treated as an explicit model name.
  vision: 'auto',
  hotkey: 'CommandOrControl+Shift+Space',
  pet: 'blob',
  skin: 'butter',
  autostart: false,
  ollama: 'http://127.0.0.1:11434',
};

// A malformed accelerator makes globalShortcut.register throw, which would take
// the app down on launch. Cheap shape check rather than a full parser.
const ACCELERATOR = /^([A-Za-z0-9]+\+)*[A-Za-z0-9]+$/;

function validHotkey(v) {
  return typeof v === 'string' && v.length > 0 && v.length < 64 && ACCELERATOR.test(v);
}

// Only loopback. A remote endpoint would silently turn the whole privacy claim
// into a lie, so it is not a supported configuration.
function validEndpoint(v) {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Anything unrecognised falls back to the default rather than being trusted. */
function load(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    model: str(s.model) || DEFAULTS.model,
    vision: str(s.vision) || DEFAULTS.vision,
    hotkey: validHotkey(s.hotkey) ? s.hotkey : DEFAULTS.hotkey,
    pet: PETS.includes(s.pet) ? s.pet : DEFAULTS.pet,
    skin: SKINS.includes(s.skin) ? s.skin : DEFAULTS.skin,
    autostart: typeof s.autostart === 'boolean' ? s.autostart : DEFAULTS.autostart,
    ollama: validEndpoint(s.ollama) ? s.ollama : DEFAULTS.ollama,
  };
}

/** Merge a partial update from the settings window, validating as we go. */
function merge(current, patch) {
  return load({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
}

module.exports = { DEFAULTS, SKINS, PETS, load, merge, validHotkey, validEndpoint };
