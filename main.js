'use strict';

const {
  app, BrowserWindow, globalShortcut, desktopCapturer, screen, ipcMain, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { recognise } = require('./ocr');
const { ask } = require('./brain');
const pets = require('./pet-state');

const HOTKEY = process.env.SCREENPET_HOTKEY || 'CommandOrControl+Shift+Space';
const STAGE_H = 300;
const TICK_MS = 20000;
const IDLE_SLEEP_S = 300; // system idle this long and the pet naps

let win = null;
let state = null;
let busy = false;
let nagIndex = 0;
let saveTimer = null;

const statePath = () => path.join(app.getPath('userData'), 'pet.json');

function loadState() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    // First run, or the file got mangled. pet-state.load() falls back cleanly.
  }
  return pets.load(raw, Date.now());
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(statePath(), JSON.stringify(state));
    } catch (err) {
      console.error('could not save pet state:', err.message);
    }
  }, 400);
}

const asleep = () => powerMonitor.getSystemIdleTime() >= IDLE_SLEEP_S;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    width: workArea.width,
    height: STAGE_H,
    x: workArea.x,
    y: workArea.y + workArea.height - STAGE_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false, // never steal focus from what the user is actually doing
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  // The window spans the whole bottom strip but the pet is a small part of it.
  // forward:true keeps mousemove flowing so the renderer can tell us when the
  // cursor is actually over the pet and clicks should land.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function pushState(extra = {}) {
  send('pet:stats', {
    ...state,
    mood: pets.mood(state, { asleep: asleep() }),
    asleep: asleep(),
    ...extra,
  });
}

function tick() {
  const napping = asleep();
  state = pets.tick(state, Date.now(), { asleep: napping });

  if (!busy && pets.shouldNag(state, Date.now(), { asleep: napping })) {
    const m = pets.mood(state, { asleep: napping });
    state.lastNagAt = Date.now();
    send('pet:say', { text: pets.nagLine(m, nagIndex++), kind: 'nag' });
  }

  pushState();
  save();
}

// ---- screen answering -------------------------------------------------------

async function grabScreen() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;

  const wasVisible = win && win.isVisible();
  if (wasVisible) win.hide();
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
    });
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!source) throw new Error('No screen source available.');
    return source.thumbnail.toPNG();
  } finally {
    if (wasVisible) win.showInactive();
  }
}

async function answerScreen() {
  if (busy) return;
  busy = true;
  send('pet:say', { text: 'thinking', kind: 'thinking' });
  try {
    const png = await grabScreen();
    const text = await recognise(png);
    // Mood is passed for tone only. Nothing here can refuse to answer.
    const answer = await ask(text, { mood: pets.mood(state, { asleep: asleep() }) });
    send('pet:say', { text: answer, kind: 'answer' });
  } catch (err) {
    send('pet:say', { text: err.message, kind: 'error' });
  } finally {
    busy = false;
  }
}

// ---- wiring -----------------------------------------------------------------

app.whenReady().then(() => {
  state = loadState();
  createWindow();

  win.webContents.once('did-finish-load', () => {
    tick();
    setInterval(tick, TICK_MS);
  });

  if (!globalShortcut.register(HOTKEY, answerScreen)) {
    console.error(`Could not register hotkey ${HOTKEY} - something else owns it.`);
  }
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());

  if (process.env.SCREENPET_SMOKE) {
    ipcMain.removeAllListeners('pet:smoke');
    const orig = send;
    send = (channel, payload) => {
      if (channel !== 'pet:say' || payload.kind === 'thinking') return orig(channel, payload);
      console.log(`[${payload.kind}] ${payload.text}`);
      app.exit(payload.kind === 'error' ? 1 : 0);
    };
    answerScreen();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.on('pet:act', (_e, name) => {
  const result = pets.act(state, name, Date.now());
  state = result.state;
  pushState({ acted: result.ok ? name : null, refused: result.ok ? null : result.reason });
  save();
});

// The renderer owns hit-testing because only it knows where the pet is standing.
ipcMain.on('pet:interactive', (_e, interactive) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('pet:ask', answerScreen);
ipcMain.on('pet:quit', () => app.quit());

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearTimeout(saveTimer);
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state));
  } catch {
    // Losing a few minutes of pet stats on a crash-quit is not worth handling.
  }
});

// Desktop pet: closing the window should not be the same as quitting.
app.on('window-all-closed', () => {});
