'use strict';

const host = require('./host');

// Where the window you are working in is. Windows only - see host.js for why.
//
// A rectangle in physical pixels and nothing else: no title, no process name,
// no class. The pet crops a screenshot with it and has no idea what it cropped.

// It is a PowerShell spawn, on the path of a key you just pressed, so it has to
// be short. Missing the crop and reading the whole screen is a worse answer,
// not a broken one.
const TIMEOUT_MS = 3000;

/**
 * A line of that script's output as a rectangle, or null for anything else.
 *
 * The one place its output is believed, so "it threw", "it printed a warning"
 * and "it printed half a line" are one answer here rather than two guesses in
 * two callers.
 */
function parse(text) {
  try {
    const r = JSON.parse(String(text).trim());
    const ok = ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(r[k]));
    return ok && r.w > 0 && r.h > 0 ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
  } catch {
    return null; // it threw, or printed something that is not a rectangle
  }
}

/**
 * The foreground window's rectangle.
 *
 * @returns {Promise<{x: number, y: number, w: number, h: number}|null>} null
 *   when there is nothing sensible to crop to - no foreground window, a
 *   minimised one, or a system that cannot answer at all. Every one of those is
 *   "read the whole screen", which is what this app always did.
 */
function rect() {
  return new Promise((resolve) => {
    if (!host.supports('window')) return resolve(null);

    const ps = host.spawn('window');
    let out = '';
    const stop = setTimeout(() => { ps.kill(); resolve(null); }, TIMEOUT_MS);

    ps.stdout.on('data', (d) => (out += d));
    ps.on('error', () => { clearTimeout(stop); resolve(null); });
    ps.on('close', () => { clearTimeout(stop); resolve(parse(out)); });
    ps.stdin.end();
  });
}

// ---- noticing you move between windows --------------------------------------

// The same script, left running. It prints a rectangle when the foreground
// window changes and says nothing the rest of the time, so what crosses this
// boundary is "you are looking somewhere else now, and it is over there" - not
// which application, not for how long, and nothing at all while you work.

let watcher = null;

// A rectangle is about fifty characters. Anything that has come this far without
// a newline is not one, and holding on to it forever is how a child process that
// starts spewing turns into a memory leak.
const MAX_BUFFER = 4096;

/**
 * Watch for the foreground window changing. Idempotent, and silent on a host
 * that cannot answer the question at all - a machine that never reports a switch
 * and a machine with no switches look the same from here, which is the right
 * shape for something whose entire output is a glance.
 *
 * @param {(rect: {x: number, y: number, w: number, h: number}) => void} onSwitch
 */
function watch(onSwitch) {
  if (watcher || !host.supports('window')) return;

  // Not inside a Promise, unlike rect() above, so a host that cannot spawn this
  // would throw straight through the caller. There is nothing to report: the pet
  // simply never notices, which is what it did before this existed.
  try {
    watcher = host.spawn('window', ['-Watch']);
  } catch {
    watcher = null;
    return;
  }

  let buffer = '';
  watcher.stdout.on('data', (d) => {
    buffer += d;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    if (buffer.length > MAX_BUFFER) buffer = '';
    for (const line of lines) {
      const r = parse(line);
      if (r) onSwitch(r);
    }
  });

  const gone = () => { watcher = null; };
  watcher.on('error', gone);
  watcher.on('close', gone);
  watcher.stdin.end();
}

/** Stop watching. Safe to call when nothing is running. */
function unwatch() {
  if (!watcher) return;
  const dying = watcher;
  watcher = null;
  dying.kill();
}

const watching = () => watcher !== null;

/**
 * The part of a captured display that window covers, in the image's own pixels.
 *
 * Pure, and separate from the spawn above, because every judgement about
 * whether cropping is a good idea lives here and none of it needs a Windows to
 * test: too small to be worth reading, mostly off the display that was
 * captured, or so nearly the whole display that cropping gains nothing.
 *
 * @param {object} r        the window rectangle, physical pixels, virtual desktop
 * @param {object} display  Electron's display: bounds in points, scaleFactor
 * @param {{width: number, height: number}} image  the captured screenshot
 * @returns {{x: number, y: number, width: number, height: number}|null} null
 *   meaning read the whole screen
 */
function cropFor(r, display, image) {
  if (!r) return null;
  const scale = display.scaleFactor || 1;

  // Electron measures displays in points and Windows hands back pixels, so the
  // display's own origin has to come off in the same units the rectangle is in.
  const left = Math.round(r.x - display.bounds.x * scale);
  const top = Math.round(r.y - display.bounds.y * scale);

  // Clipped to the image: a window hanging off the edge of the screen, or
  // sitting mostly on the other monitor, is normal rather than exceptional.
  const x = Math.max(0, left);
  const y = Math.max(0, top);
  const width = Math.min(image.width, left + r.w) - x;
  const height = Math.min(image.height, top + r.h) - y;
  if (width <= 0 || height <= 0) return null;

  // Mostly somewhere else. Reading the sliver of it that is on this display
  // would be confidently answering about a third of a window.
  if (width * height < r.w * r.h * 0.6) return null;

  // Too small to hold a question. A 300x120 dialog cropped out of a screen is a
  // worse thing to hand a model than the screen was.
  if (width < 320 || height < 200) return null;

  // Nearly the whole display anyway - a maximised window. Cropping gains
  // nothing and risks losing a strip of it to a rounding error.
  if (width * height > image.width * image.height * 0.9) return null;

  return { x, y, width, height };
}

module.exports = { rect, cropFor, parse, watch, unwatch, watching, TIMEOUT_MS };
