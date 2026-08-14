'use strict';

// Which of this app's capabilities the machine underneath it can actually
// provide, and what to run for the ones it can.
//
// Every module in this directory used to open with the same twelve lines: the
// path to a .ps1 with the asar rewrite on it, and the path to Windows
// PowerShell 5.1. That was fine while Windows was the only host. It is not a
// place to put a second one, because "does this machine have a wake word" would
// end up answered in seven files that each get it slightly differently.
//
// The rule here: a capability the host cannot provide fails as a sentence the
// pet can say, at the moment you ask for it. Not an ENOENT, not a silent no-op,
// and not a feature that appears in Settings and then does nothing.

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const PLATFORM = process.platform;

// PowerShell cannot read a script from inside an asar archive, so the scripts
// are listed in asarUnpack and live beside it. In development __dirname holds no
// 'app.asar' and this is a no-op. Same for the macOS helper binary.
const beside = (...parts) =>
  path.join(__dirname, ...parts).replace('app.asar', 'app.asar.unpacked');

// Windows PowerShell 5.1 specifically, not PowerShell 7+: the WinRT type
// projections that ocr.ps1, faces.ps1 and wake.ps1 rely on are not present in 7.
const PWSH = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
);

// One compiled Swift binary answers everything on macOS that needs a framework
// rather than a shell: Vision for text and faces, and the Keychain - which is
// here rather than the `security` CLI for one reason, that `security` takes the
// key as an argv value and argv is visible in `ps` to every process on the
// machine. See BUILDING.md; `npm run build:helper` produces it.
const HELPER = beside('mac', 'screenpet-helper');

const psArgs = (script) => [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', beside(script),
];

/**
 * Every capability that needs something from the operating system, and how to
 * ask for it. A platform absent from `on` does not have it.
 *
 * `why` is read out by the pet, so it is written the way the pet talks and it
 * says what is missing rather than naming an API nobody has heard of.
 */
const CAPABILITIES = {
  ocr: {
    on: {
      win32: () => [PWSH, psArgs('ocr.ps1')],
      darwin: () => [HELPER, ['ocr']],
    },
    why: 'I cannot read the screen on this system yet!',
  },
  listen: {
    // Windows' own dictation engine. macOS has no equivalent that stays on the
    // machine - SFSpeechRecognizer goes to Apple's servers unless it is asked
    // very specifically not to, and this app does not ship a maybe. Dictation
    // there goes through whisper.cpp or Parakeet instead, which were already
    // cross-platform, and main.js routes to them.
    on: { win32: () => [PWSH, psArgs('listen.ps1')] },
    why: 'I need whisper or Parakeet installed to hear you on this system!',
  },
  wake: {
    // A wake word needs a recogniser holding the microphone open continuously.
    // Windows has one built in. Doing it with whisper would mean transcribing
    // every second of the room forever to find one word, which is a different
    // and much worse bargain than the one this setting describes.
    on: { win32: () => [PWSH, psArgs('wake.ps1')] },
    why: 'I cannot listen for my name on this system!',
  },
  // The pet's voice as audio rather than as sound, so it can be put through a
  // filter chain and come out with some character. A host without this is not
  // mute: the renderer falls back to SpeechSynthesis, which is what every
  // version of this app used until now.
  say: {
    on: {
      win32: () => [PWSH, psArgs('say.ps1')],
    },
    why: 'I can only talk in the plain system voice on this system!',
  },
  media: {
    on: {
      win32: () => [PWSH, psArgs('media.ps1')],
      // A fixed script file, never a string built here: -e with interpolation
      // would make every caller of press() an AppleScript injection site.
      darwin: () => ['/usr/bin/osascript', [beside('mac', 'media.applescript')]],
    },
    why: 'I cannot reach the music controls on this system!',
  },
  dnd: {
    on: {
      win32: () => [PWSH, psArgs('dnd.ps1')],
      // Read straight off disk, no process at all. See dnd.js.
      darwin: () => [null, []],
    },
    why: 'I cannot tell whether you are busy on this system!',
  },
  faces: {
    on: {
      win32: () => [PWSH, psArgs('faces.ps1')],
      darwin: () => [HELPER, ['faces']],
    },
    why: 'I cannot look for faces on this system!',
  },
  keys: {
    on: {
      win32: () => [PWSH, psArgs('keys.ps1')],
      darwin: () => [HELPER, ['keychain']],
    },
    why: 'I have nowhere safe to keep a key on this system!',
  },
  // macOS can answer this - CGWindowListCopyWindowInfo - but it needs the
  // Screen Recording permission to return anything useful about other apps, and
  // that is a second thing to explain for a crop. Whole screen there, which is
  // what every version of this app did until now.
  window: {
    on: {
      win32: () => [PWSH, psArgs('window.ps1')],
    },
    why: 'I can only read the whole screen on this system!',
  },
};

/** Whether the host can do this at all. Says nothing about permissions. */
function supports(name, platform = PLATFORM) {
  const cap = CAPABILITIES[name];
  return Boolean(cap && cap.on[platform]);
}

/**
 * On macOS the Vision and Keychain work is a binary somebody has to build, so
 * "the platform supports it" and "this install can do it" are different
 * questions and the second one is the one a user cares about.
 */
function ready(name, platform = PLATFORM) {
  if (!supports(name, platform)) return false;
  const [exe] = CAPABILITIES[name].on[platform]();
  if (exe === HELPER) return fs.existsSync(HELPER);
  return true;
}

/** The error the pet says. Thrown by the module, caught by main.js as usual. */
function unsupported(name) {
  const cap = CAPABILITIES[name];
  if (supports(name) && !ready(name)) {
    return new Error(`${cap.why} (the helper has not been built - see BUILDING.md)`);
  }
  return new Error(cap ? cap.why : `I cannot do ${name} on this system!`);
}

/**
 * What to spawn for a capability, as [executable, baseArgs]. Callers append
 * their own arguments. Throws rather than returning something unspawnable, so a
 * missing capability cannot turn into an ENOENT three frames later.
 */
function command(name) {
  if (!ready(name)) throw unsupported(name);
  return CAPABILITIES[name].on[PLATFORM]();
}

/**
 * Spawn a capability. Extra arguments go after the platform's own. Throws the
 * pet's sentence if the host cannot do it - callers are inside a Promise
 * executor, where a throw is already a rejection, so none of them need a guard.
 */
function spawnFor(name, extra = [], opts = {}) {
  const [exe, args] = command(name);
  // A capability answered in-process on this platform - macOS notification
  // state is a file read. Reaching here means the module forgot to branch, and
  // spawn(null) would fail somewhere much less obvious than this line.
  if (!exe) throw new Error(`${name} needs no process on ${PLATFORM}; the module should not have spawned`);
  return spawn(exe, [...args, ...extra], { windowsHide: true, ...opts });
}

/** Everything, for the doctor and for the settings window. */
const report = (platform = PLATFORM) =>
  Object.keys(CAPABILITIES).map((name) => ({
    name,
    supported: supports(name, platform),
    ready: ready(name, platform),
    why: CAPABILITIES[name].why,
  }));

module.exports = {
  PLATFORM, CAPABILITIES, HELPER, PWSH,
  supports, ready, unsupported, command, spawn: spawnFor, report, beside,
};
