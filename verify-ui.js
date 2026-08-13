'use strict';

// Renderer check: loads the real UI, drives it through the real preload bridge,
// and asserts what came back over real IPC. Writes PNGs so you can look at it.
// Run: npm run verify:ui
//
// This exists because a top-level `const pet` in renderer.js silently collided
// with the contextBridge global and killed the whole script at parse time. Unit
// tests cannot see that; only rendering it can.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

app.whenReady().then(async () => {
  const errors = [];
  const ipc = { act: [], interactive: [], ask: 0 };
  ipcMain.on('pet:act', (_e, name) => ipc.act.push(name));
  ipcMain.on('pet:interactive', (_e, v) => ipc.interactive.push(v));
  ipcMain.on('pet:ask', () => { ipc.ask += 1; });

  const win = new BrowserWindow({
    width: 520,
    height: 300,
    // Must be shown: a hidden window throttles compositing and capturePage then
    // hands back a stale frame, which makes the PNGs quietly lie.
    show: true,
    backgroundColor: '#1b1b1f', // opaque so capturePage has something to composite
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });

  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(e.message);
  });
  win.webContents.on('preload-error', (_e, p, err) => errors.push(`preload ${p}: ${err.message}`));

  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const js = (src) => win.webContents.executeJavaScript(src);
  const shot = async (name) => fs.writeFileSync(
    path.join(__dirname, name), (await win.webContents.capturePage()).toPNG()
  );
  const settle = () => new Promise((r) => setTimeout(r, 250));
  const shownOnScreen = async (id) =>
    (await js(`getComputedStyle(document.getElementById('${id}')).display`)) !== 'none';

  // Rendered state, not the .hidden property: an author `display` rule overrides
  // the UA [hidden] stylesheet, and the element stays on screen regardless.
  check(!(await shownOnScreen('menu')), 'menu is visible before anyone opened it');
  check(!(await shownOnScreen('bubble')), 'bubble is visible before the pet said anything');

  // --- speech -------------------------------------------------------------
  win.webContents.send('pet:say', { text: '17 x 23 = 391, so the answer is A.', kind: 'answer' });
  await settle();
  const bubble = await js(
    `(() => { const b = document.getElementById('bubble');
      return { hidden: b.hidden, text: b.innerText.trim() }; })()`
  );
  check(!bubble.hidden, 'bubble stayed hidden - renderer never handled pet:say');
  check(bubble.text.includes('391'), `bubble text wrong: ${JSON.stringify(bubble.text)}`);
  await shot('pet-preview.png');

  // --- stats drive mood and bars -----------------------------------------
  for (const [mood, stats] of Object.entries({
    happy: { fullness: 90, happiness: 90, energy: 80 },
    hungry: { fullness: 12, happiness: 60, energy: 70 },
    sad: { fullness: 60, happiness: 10, energy: 70 },
    sleepy: { fullness: 60, happiness: 60, energy: 10 },
    neutral: { fullness: 50, happiness: 50, energy: 50 },
  })) {
    win.webContents.send('pet:stats', { ...stats, bond: 10, mood });
    await settle();
    const got = await js(
      `(() => ({ mood: document.getElementById('pet').dataset.mood,
                 bar: document.querySelector('[data-bar="fullness"]').style.width,
                 bodyFill: getComputedStyle(document.querySelector('.body')).fill }))()`
    );
    check(got.mood === mood, `mood not applied: wanted ${mood}, got ${got.mood}`);
    check(
      got.bar === `${stats.fullness}%`,
      `fullness bar wrong for ${mood}: ${got.bar}`
    );
    if (mood === 'hungry') await shot('pet-hungry.png');
  }

  // Sleepy must actually close the eyes, not just recolour.
  win.webContents.send('pet:stats', { fullness: 60, happiness: 60, energy: 10, bond: 0, mood: 'sleepy' });
  await settle();
  const lids = await js(
    `(() => ({ eyes: getComputedStyle(document.querySelector('.eyes')).display,
               lids: getComputedStyle(document.querySelector('.lids')).display }))()`
  );
  check(lids.eyes === 'none' && lids.lids === 'block', 'sleepy pet did not close its eyes');

  // --- skins repaint the pet, and moods stay filters so they compose --------
  const fill = () => js(`getComputedStyle(document.querySelector('.body')).fill`);
  const butter = await fill();
  win.webContents.send('pet:skin', 'mint');
  await settle();
  const mint = await fill();
  check(mint !== butter, 'skin change did not repaint the pet');
  check(mint === 'rgb(127, 209, 176)', `mint skin wrong: ${mint}`);

  // A mood on top of a skin must tint, not overwrite the palette.
  win.webContents.send('pet:stats', { fullness: 60, happiness: 10, energy: 70, bond: 0, mood: 'sad' });
  await settle();
  check(await fill() === mint, 'mood overwrote the skin colour instead of filtering it');
  check(
    (await js(`getComputedStyle(document.querySelector('.pet svg')).filter`)) !== 'none',
    'sad mood applied no filter'
  );
  win.webContents.send('pet:skin', 'butter');
  await settle();

  // --- interaction wiring, asserted over real IPC -------------------------
  await js(
    `(() => { const r = document.getElementById('pet').getBoundingClientRect();
       document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
         clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); })()`
  );
  await settle();
  check(ipc.interactive.at(-1) === true, 'hovering the pet did not make the window clickable');

  await js(`document.getElementById('pet').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await settle();
  check(ipc.act.includes('pet'), 'clicking the pet did not send a headpat');

  await js(
    `document.getElementById('pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))`
  );
  await settle();
  check(await shownOnScreen('menu'), 'right-click did not open the menu');
  check(
    !(await shownOnScreen('bubble')),
    'menu and bubble are both showing - they occupy the same space'
  );
  await shot('pet-menu.png');

  await js(`document.querySelector('[data-act="feed"]').click()`);
  await settle();
  check(ipc.act.includes('feed'), 'Feed menu item did not send an action');

  await js(
    `document.getElementById('pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
     document.querySelector('[data-ask]').click()`
  );
  await settle();
  check(ipc.ask === 1, 'Read screen menu item did not request an answer');

  // Menu disables what the pet would refuse anyway.
  win.webContents.send('pet:stats', { fullness: 98, happiness: 60, energy: 10, bond: 0, mood: 'sleepy' });
  await settle();
  const disabled = await js(
    `(() => ({ feed: document.querySelector('[data-act="feed"]').disabled,
               play: document.querySelector('[data-act="play"]').disabled }))()`
  );
  check(disabled.feed, 'Feed stayed enabled on a full pet');
  check(disabled.play, 'Play stayed enabled on an exhausted pet');

  // --- settings window ----------------------------------------------------
  let saved = null;
  ipcMain.handle('config:get', async () => ({
    settings: {
      model: 'llama3.1:8b', vision: 'auto', hotkey: 'CommandOrControl+Shift+Space',
      skin: 'butter', autostart: false, ollama: 'http://127.0.0.1:11434',
    },
    skins: ['butter', 'mint', 'blossom', 'slate'],
    models: ['llama3.1:8b', 'mistral:7b'],
    visionModel: null,
    packaged: false,
  }));
  ipcMain.handle('config:save', async (_e, patch) => {
    saved = patch;
    return { settings: { ...patch, ollama: 'http://127.0.0.1:11434' }, visionModel: null };
  });

  const sw = new BrowserWindow({
    width: 460, height: 660, show: true, // must match openSettings() in main.js
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  sw.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(`settings: ${e.message}`);
  });
  await sw.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  await settle();
  const sjs = (src) => sw.webContents.executeJavaScript(src);

  check(
    (await sjs(`document.querySelectorAll('#model option').length`)) === 2,
    'settings did not list the installed models'
  );
  check(
    (await sjs(`document.querySelectorAll('#skins .swatch').length`)) === 4,
    'settings did not render the skin swatches'
  );
  check(
    (await sjs(`document.getElementById('vision-hint').classList.contains('warn')`)),
    'settings did not warn that no vision model is installed'
  );
  check(
    await sjs(`document.getElementById('autostart').disabled`),
    'autostart was offered in an unpackaged build, where it would register electron.exe'
  );
  // The window is not resizable, so anything below the fold is unreachable.
  check(
    await sjs(
      `document.getElementById('save').getBoundingClientRect().bottom <= window.innerHeight`
    ),
    'Save button falls outside the settings window - it is not resizable, so it cannot be reached'
  );
  fs.writeFileSync(path.join(__dirname, 'pet-settings.png'), (await sw.webContents.capturePage()).toPNG());

  // A malformed accelerator must not be savable - registering one throws.
  await sjs(
    `(() => { const h = document.getElementById('hotkey');
       h.value = 'Ctrl+'; h.dispatchEvent(new Event('input')); })()`
  );
  await settle();
  check(await sjs(`document.getElementById('save').disabled`), 'a bad hotkey was still savable');

  await sjs(
    `(() => { const h = document.getElementById('hotkey');
       h.value = 'Alt+Shift+P'; h.dispatchEvent(new Event('input'));
       document.querySelector('[data-skin="blossom"]').click();
       document.getElementById('save').click(); })()`
  );
  await settle();
  check(saved !== null, 'Save sent nothing to the main process');
  check(saved && saved.hotkey === 'Alt+Shift+P', `hotkey not saved: ${saved && saved.hotkey}`);
  check(saved && saved.skin === 'blossom', `skin not saved: ${saved && saved.skin}`);

  // --- report -------------------------------------------------------------
  const all = [...errors, ...problems];
  if (all.length) {
    console.error('FAIL\n - ' + all.join('\n - '));
    return app.exit(1);
  }
  console.log('ok - speech, moods, skins, bars, hover, headpat, menu, settings and IPC all good.');
  console.log('wrote pet-preview.png, pet-hungry.png, pet-menu.png, pet-settings.png');
  app.exit(0);
});
