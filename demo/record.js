'use strict';

// Records the demo GIF. Run: npm run demo
//
// The pet, the bubble and the animations are the real stylesheet, and the answer
// is produced by the real pipeline - the mock quiz page is captured, run through
// Windows OCR and answered by the local model, exactly as the app would. Nothing
// here is typed in by hand, and it never touches your actual screen.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { recognise } = require('../ocr');
const { ask } = require('../brain');

const W = 720;
const H = 480;
const OUT = path.join(__dirname, 'screenpet-demo.gif');
const STILL = path.join(__dirname, 'screenpet-still.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: true, // a hidden window throttles compositing and capturePage goes stale
    backgroundColor: '#eef1f6',
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, 'stage.html'));
  await sleep(600);

  const js = (src) => win.webContents.executeJavaScript(src);
  const shot = () => win.webContents.capturePage();

  // --- get a real answer, the real way -------------------------------------
  await js('demo.hidePet()');
  await sleep(200);
  const quizPng = (await shot()).toPNG();

  const ocrText = (await recognise(quizPng)).trim();
  console.log(`OCR read ${ocrText.length} chars: ${JSON.stringify(ocrText.slice(0, 90))}`);

  const answer = await ask(ocrText);
  console.log(`model answered: ${JSON.stringify(answer)}`);
  if (!answer || /cannot reach|took too long/i.test(answer)) {
    console.error('FAIL - no usable answer from the local model, refusing to fake one.');
    return app.exit(1);
  }

  await js('demo.showPet()');
  await sleep(300);

  // --- capture ------------------------------------------------------------
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

  await beat(18);                               // idle: bobbing, blinking
  await js('demo.badge(true)');
  await beat(6);                                // hotkey pressed
  await js(`demo.thinking(); demo.expr('hmm')`);
  await beat(16);                               // thinking, dots animating
  await js('demo.badge(false)');
  await js(
    `demo.answer(${JSON.stringify(answer)}); demo.mood('happy'); demo.expr('smile')`
  );
  await beat(12);                               // answer pops in

  frames.push({ ...frames.at(-1), delay: 1600 }); // hold so it can be read

  await js(`demo.headpat(); demo.expr('love')`);
  await beat(14);                               // headpat, heart eyes, hearts float up
  frames.push({ ...frames.at(-1), delay: 1500 });

  fs.writeFileSync(STILL, (await shot()).toPNG());

  // --- encode -------------------------------------------------------------
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
});
