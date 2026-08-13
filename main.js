'use strict';

const { app, BrowserWindow, globalShortcut, desktopCapturer, screen, ipcMain } = require('electron');
const path = require('path');
const { recognise } = require('./ocr');
const { ask } = require('./brain');

const HOTKEY = process.env.SCREENPET_HOTKEY || 'CommandOrControl+Shift+Space';
const PET_W = 340;
const PET_H = 260;

let win = null;
let busy = false;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: workArea.x + workArea.width - PET_W - 24,
    y: workArea.y + workArea.height - PET_H - 8,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  // The window is a rectangle but the pet is not. Let every click fall through
  // to whatever is underneath; nothing in Phase 0 needs to be clicked.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function send(state) {
  if (win && !win.isDestroyed()) win.webContents.send('pet:state', state);
}

async function grabScreen() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;

  // Hide first so the pet and its bubble are not in the shot.
  const wasVisible = win && win.isVisible();
  if (wasVisible) win.hide();
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
    });
    const source =
      sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!source) throw new Error('No screen source available.');
    return source.thumbnail.toPNG();
  } finally {
    if (wasVisible) win.showInactive();
  }
}

async function answerScreen() {
  if (busy) return;
  busy = true;
  send({ status: 'thinking' });
  try {
    const png = await grabScreen();
    const text = await recognise(png);
    send({ status: 'answer', text: await ask(text) });
  } catch (err) {
    send({ status: 'error', text: err.message });
  } finally {
    busy = false;
  }
}

app.whenReady().then(() => {
  createWindow();

  if (!globalShortcut.register(HOTKEY, answerScreen)) {
    console.error(`Could not register hotkey ${HOTKEY} - something else owns it.`);
  }

  // Smoke check: exercise capture -> OCR -> model once, print, exit. The only
  // part of the pipeline a unit test cannot reach, since it needs a real screen.
  if (process.env.SCREENPET_SMOKE) {
    send = (state) => {
      if (state.status === 'thinking') return;
      console.log(`[${state.status}] ${state.text}`);
      app.exit(state.status === 'error' ? 1 : 0);
    };
    answerScreen();
  }
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.on('pet:quit', () => app.quit());

app.on('will-quit', () => globalShortcut.unregisterAll());
// Desktop pet: closing the window should not be the same as quitting.
app.on('window-all-closed', () => {});
