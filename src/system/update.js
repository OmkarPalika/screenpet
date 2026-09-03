'use strict';

// Getting the next version without clicking through the setup wizard again.
//
// What leaves this machine: one HTTPS request for the release list, and then,
// only if you press the second button, the installer itself. Nothing about you
// goes with either - no settings, no screen, no memory, no identifier, no
// account. Nothing here runs on a timer: there is no background check, no
// "checking for updates" on launch, and nothing is downloaded or installed
// until the button for that is pressed.
//
// ponytail: electron-updater rather than a hand-rolled fetch-and-run. This is
// the one path in the app that downloads an executable and then executes it, so
// it is the last place to be writing the code myself: the library already does
// the sha512 check against the signed release manifest, the partial-download
// resume and the Windows publisher-signature check, and each of those is a
// security control that is worse for being ours.

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

// The feed is baked into app-update.yml at build time from the `publish` block
// in package.json - this repository's own releases. Deliberately not a setting:
// a URL that settings can change is a URL a hand-edited settings file can point
// at somebody else's installer, and this is the one channel where that ends in
// running it.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
// A pre-release is something you opt into by downloading it by hand.
autoUpdater.allowPrerelease = false;
// The library logs to console by default, which on Windows means a detached
// process writing nowhere. Off rather than noisy.
autoUpdater.logger = null;

/** What is running right now. */
function version() {
  return app.getVersion();
}

/**
 * Ask the release list what the newest version is. One request, made because
 * the button was pressed and at no other time.
 *
 * @returns {Promise<{state: string, version: string, latest?: string}>}
 *   `dev` when unpackaged (there is no installer to replace), `current`,
 *   or `available` with the version that is out.
 */
async function check() {
  // In development the running copy is Electron itself, not an installed
  // screenpet, and there is nothing an installer could replace. The library
  // refuses too; saying so plainly beats letting it fail with a warning.
  if (!app.isPackaged) return { state: 'dev', version: version() };

  const found = await autoUpdater.checkForUpdates();
  const latest = found && found.updateInfo ? String(found.updateInfo.version || '') : '';
  // `isUpdateAvailable` is the library's own semver comparison, which handles
  // the cases a string compare gets wrong (0.10.0 against 0.9.0, build
  // metadata, a downgrade published by mistake).
  const newer = found ? found.isUpdateAvailable === true : false;

  return newer && latest
    ? { state: 'available', version: version(), latest }
    : { state: 'current', version: version() };
}

/**
 * Download the release and replace this copy with it. The installer is run
 * silently, so there is no wizard and no "choose an install directory" - it
 * lands where the current copy already lives and starts again.
 *
 * The download is verified against the sha512 in the release manifest before
 * anything is executed; a mismatch throws here rather than installing.
 *
 * @param {(percent: number) => void} [onProgress] whole percent, 0-100
 */
async function install(onProgress) {
  if (!app.isPackaged) throw new Error('there is no installed copy to replace in development');

  const tick = (p) => {
    if (typeof onProgress === 'function') onProgress(Math.round(p.percent || 0));
  };
  autoUpdater.on('download-progress', tick);
  try {
    await autoUpdater.downloadUpdate();
  } finally {
    autoUpdater.off('download-progress', tick);
  }

  // (silent, then run it again). Silent is the whole point of the button; the
  // relaunch is so the pet comes back rather than leaving an empty tray.
  autoUpdater.quitAndInstall(true, true);
}

module.exports = { check, install, version, autoUpdater };
