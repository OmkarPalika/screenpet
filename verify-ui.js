'use strict';

// Renderer check: loads the real UI, pushes a state through the real preload
// bridge, asserts nothing threw and the bubble actually appeared, and drops a
// PNG next to it so you can look at the pet.
// Run: npx electron verify-ui.js
//
// This exists because a top-level `const pet` in renderer.js silently collided
// with the contextBridge global and killed the whole script at parse time. Unit
// tests cannot see that; only rendering it can.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'pet-preview.png');

app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({
    width: 360,
    height: 280,
    show: false,
    backgroundColor: '#1b1b1f', // opaque here so capturePage has something to composite
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(e.message);
  });
  win.webContents.on('preload-error', (_e, p, err) => errors.push(`preload ${p}: ${err.message}`));

  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.send('pet:state', {
    status: 'answer',
    text: '17 x 23 = 391, so the answer is A.',
  });
  await new Promise((r) => setTimeout(r, 500));

  const shown = await win.webContents.executeJavaScript(
    `(() => { const b = document.getElementById('bubble');
       return { hidden: b.hidden, text: b.innerText.trim() }; })()`
  );

  fs.writeFileSync(OUT, (await win.webContents.capturePage()).toPNG());

  const problems = [
    ...errors,
    shown.hidden ? 'bubble stayed hidden - the renderer never handled pet:state' : null,
    shown.text.includes('391') ? null : `bubble text wrong: ${JSON.stringify(shown.text)}`,
  ].filter(Boolean);

  if (problems.length) {
    console.error('FAIL\n - ' + problems.join('\n - '));
    app.exit(1);
  }
  console.log(`ok - bubble rendered, no console errors. wrote ${OUT}`);
  app.exit(0);
});
