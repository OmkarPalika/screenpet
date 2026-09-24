'use strict';

// Records the playdate GIF - two pets meeting. Run: npm run demo:playdate
//
// Same stage and the same real stylesheets as record.js, and the guest is drawn
// by the app's own src/renderer/friend.js rather than a mock-up of it: the
// walk-in, the confetti, the name tag and the emoji for each shared activity are
// the code that runs when somebody else actually opens a laptop on your network.
//
// Unlike record.js this needs no OCR and no model. Nothing here reads a screen,
// so there is nothing to answer - which is the point of the clip: the playdate
// half of the app is the half that does not look at anything.
//
// The verbs and the movements paired with them are not invented here. The verbs
// are core/playdate.js's ACTS and the movements are main.js's MOVE_FOR, copied
// as a table below so that a mapping which drifts shows up as a pet standing
// still in the clip rather than as a silent difference.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Framed to the two of them rather than to a whole desktop: the stage sits
// bottom-right the way it does on a real taskbar, so a larger window is mostly
// empty wallpaper. The friend still walks in from beyond the right edge.
const W = 470;
const H = 290;
const OUT = path.join(__dirname, 'screenpet-playdate.gif');
const STILL = path.join(__dirname, 'screenpet-playdate.png');

// main.js MOVE_FOR, for the verbs this clip uses.
const MOVE_FOR = {
  wave: 'jump',
  dance: 'dance',
  snack: 'sit',
  hug: 'walk',
};

// A validated pet card, the shape core/playdate.js lets through. A different
// species and palette from the pet's own, because the point of the clip is that
// the other one belongs to somebody else. The id is eight hex characters,
// because that is the whole of what an install ever tells anyone about itself:
// no hostname, no MAC address, no user name.
const GUEST = {
  id: '7c1fa93e',
  pet: 'bun',
  skin: 'plum',
  wear: 'bow',
  mood: 'happy',
  name: 'Biscuit',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 470,
    height: 290,
    show: true, // a hidden window throttles compositing and capturePage goes stale
    backgroundColor: '#eef1f6',
    webPreferences: { backgroundThrottling: false },
  });
  // Without these a thrown renderer error rejects executeJavaScript, stops this
  // chain without a word and leaves the window open - which looks exactly like a
  // recording that is merely slow. Say it out loud instead.
  win.webContents.on('console-message', (_e, level, message, line, src) => {
    console.log(`renderer[${level}] ${path.basename(src || '?')}:${line} ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`FAIL - renderer gone: ${details.reason}`);
    app.exit(1);
  });

  await win.loadFile(path.join(__dirname, 'stage.html'));
  await sleep(600);

  const js = (src) => win.webContents.executeJavaScript(src);
  const shot = () => win.webContents.capturePage();

  // The quiz card belongs to the reading clip. This one is about the pets, so
  // the desktop behind them is left empty rather than given something to say.
  await js(`document.querySelector('.card').hidden = true`);

  await js(`demo.pet('cat')`);
  await js(`document.getElementById('pet').dataset.skin = 'sky'`);
  // Further in from the right than a taskbar would put it, so the friend's name
  // tag has room: the tag is centred on the guest, and the guest stands to the
  // right of your pet, so at a real 34px margin it runs off this narrow frame.
  await js(`document.getElementById('stage').style.right = '86px'`);
  await js('demo.showPet()');
  await sleep(300);

  // --- capture --------------------------------------------------------------
  const frames = [];
  let last = Date.now();

  async function frame(minDelay) {
    const img = (await shot()).resize({ width: W, height: H });
    const bgra = img.toBitmap(); // Windows hands back BGRA, not RGBA
    const rgba = Buffer.allocUnsafe(bgra.length);
    for (let i = 0; i < bgra.length; i += 4) {
      rgba[i] = bgra[i + 2];
      rgba[i + 1] = bgra[i + 1];
      rgba[i + 2] = bgra[i];
      rgba[i + 3] = 255;
    }
    const now = Date.now();
    // Real elapsed time, so the GIF plays at the speed it was captured at.
    frames.push({ rgba, delay: Math.max(minDelay || 40, Math.min(now - last, 400)) });
    last = now;
  }

  async function beat(count, minDelay) {
    for (let i = 0; i < count; i++) await frame(minDelay);
  }

  const hold = (ms) => frames.push({ ...frames.at(-1), delay: ms });

  // One pet, on its own, so that the arrival reads as an arrival.
  await beat(5);

  // Somebody else opened a laptop. `true` is "these two have never met before",
  // which is the only thing that gets confetti - every reconnection after this
  // is just a pet turning up.
  await js(`demo.friendArrives(${JSON.stringify(GUEST)}, true)`);
  await beat(20); // walk-in (900ms) and the confetti (2400ms) over the top
  hold(700);

  // Hello, from across the desk.
  await js(`demo.together('wave', '${MOVE_FOR.wave}', 1400, 'grin')`);
  await beat(12);
  hold(500);

  // The main event. Both bodies at once: the app tells each end to do the same
  // thing at the same moment, which is what makes it a shared activity rather
  // than two pets happening to move.
  await js(`demo.together('dance', '${MOVE_FOR.dance}', 2400, 'joy')`);
  await beat(20);
  hold(600);

  // Sharing a snack, sitting down.
  await js(`demo.together('snack', '${MOVE_FOR.snack}', 2000, 'yum')`);
  await beat(16);
  hold(700);

  // And a hug to finish, which is the one that walks them together.
  await js(`demo.together('hug', '${MOVE_FOR.hug}', 1800, 'hug')`);
  await beat(16);
  hold(1500);

  fs.writeFileSync(STILL, (await shot()).toPNG());

  // --- encode ---------------------------------------------------------------
  const { GIFEncoder, quantize, applyPalette } = require('gifenc');

  // One palette for the whole clip: per-frame palettes cost bytes and make
  // static areas shimmer between frames.
  const sample = Buffer.concat(
    frames.filter((_, i) => i % 6 === 0).map((f) => f.rgba)
  );
  const palette = quantize(sample, 200);

  const gif = GIFEncoder();
  for (const f of frames) {
    gif.writeFrame(applyPalette(f.rgba, palette), W, H, { palette, delay: f.delay });
  }
  gif.finish();
  fs.writeFileSync(OUT, Buffer.from(gif.bytes()));

  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log(`wrote ${OUT} - ${frames.length} frames, ${W}x${H}, ${mb}MB`);
  console.log(`wrote ${STILL}`);
  app.exit(0);
}).catch((err) => {
  console.error('FAIL -', err && err.message ? err.message : err);
  app.exit(1);
});
