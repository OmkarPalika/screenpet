'use strict';

const {
  app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, screen,
  ipcMain, powerMonitor, nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { recognise } = require('./ocr');
const { ask, askVision, detectVisionModel, listModels, hasEnoughText } = require('./brain');
const pets = require('./pet-state');
const config = require('./settings');

const STAGE_H = 300;
const TICK_MS = 20000;
const IDLE_SLEEP_S = 300; // system idle this long and the pet naps
const VISION_TIMEOUT_MS = 240000; // vision on CPU is much slower than text

let win = null;
let settingsWin = null;
let tray = null;
let state = null;
let settings = null;
let visionModel = null; // resolved model name, or null for the OCR path
let busy = false;
let lastPath = 'ocr'; // which tier actually answered, for the smoke check
let nagIndex = 0;
let saveTimer = null;
let quitting = false;

const filePath = (name) => path.join(app.getPath('userData'), name);

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch {
    return null; // first run, or the file got mangled - callers validate anyway
  }
}

function writeJson(name, value) {
  try {
    fs.writeFileSync(filePath(name), JSON.stringify(value));
  } catch (err) {
    console.error(`could not save ${name}:`, err.message);
  }
}

function savePet() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson('pet.json', state), 400);
}

const asleep = () => powerMonitor.getSystemIdleTime() >= IDLE_SLEEP_S;
const endpoint = () => settings.ollama;

// ---- windows ----------------------------------------------------------------

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

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 460,
    height: 660,
    resizable: false,
    title: 'screenpet',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function togglePet() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isVisible()) win.hide();
  else win.showInactive();
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const shown = win && !win.isDestroyed() && win.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Read screen now', click: answerScreen },
    { label: shown ? 'Hide pet' : 'Show pet', click: togglePet },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')));
  tray.setToolTip('screenpet');
  tray.on('click', togglePet);
  refreshTray();
}

// ---- renderer messaging -----------------------------------------------------

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
  savePet();
}

// ---- answering --------------------------------------------------------------

async function resolveVision() {
  if (settings.vision === 'off') return null;
  if (settings.vision !== 'auto') return settings.vision;
  return detectVisionModel({ endpoint: endpoint() });
}

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
    // Mood is passed for tone only. Nothing here can refuse to answer.
    const mood = pets.mood(state, { asleep: asleep() });

    // OCR first. On 'auto' the vision model is a fallback for screens with no
    // text to read, not the preferred path - a small vision model is far worse
    // than OCR at dense text. Naming a model explicitly opts into always using it.
    const alwaysVision = settings.vision !== 'auto' && settings.vision !== 'off';
    const ocrText = alwaysVision ? '' : await recognise(png);
    const useVision = visionModel && (alwaysVision || !hasEnoughText(ocrText));
    lastPath = `${useVision ? `vision:${visionModel}` : 'ocr'} (ocr read ${ocrText.trim().length} chars)`;

    const answer = useVision
      ? await askVision(png.toString('base64'), {
          mood, model: visionModel, endpoint: endpoint(), timeoutMs: VISION_TIMEOUT_MS,
        })
      : await ask(ocrText, { mood, model: settings.model, endpoint: endpoint() });
    send('pet:say', { text: answer, kind: 'answer' });
  } catch (err) {
    send('pet:say', { text: err.message, kind: 'error' });
  } finally {
    busy = false;
  }
}

// ---- settings application ---------------------------------------------------

function applyHotkey() {
  globalShortcut.unregisterAll();
  try {
    if (!globalShortcut.register(settings.hotkey, answerScreen)) {
      console.error(`Could not register hotkey ${settings.hotkey} - something else owns it.`);
    }
  } catch (err) {
    console.error(`Bad hotkey ${settings.hotkey}: ${err.message}`);
  }
  globalShortcut.register('CommandOrControl+Shift+Q', () => { quitting = true; app.quit(); });
}

function applyAutostart() {
  // Skipped in dev: this would register electron.exe, not the packaged app.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.autostart, path: process.execPath });
}

async function applySettings() {
  applyHotkey();
  applyAutostart();
  send('pet:skin', settings.skin);
  visionModel = await resolveVision();
}

// ---- wiring -----------------------------------------------------------------

app.whenReady().then(async () => {
  settings = config.load(readJson('settings.json'));
  state = pets.load(readJson('pet.json'), Date.now());

  createWindow();
  createTray();

  win.webContents.once('did-finish-load', () => {
    send('pet:skin', settings.skin);
    tick();
    setInterval(tick, TICK_MS);
  });

  await applySettings();

  if (process.env.SCREENPET_SMOKE) {
    const orig = send;
    send = (channel, payload) => {
      if (channel !== 'pet:say' || payload.kind === 'thinking') return orig(channel, payload);
      console.log(`[${payload.kind}] via ${lastPath}`);
      console.log(payload.text);
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
  savePet();
});

// The renderer owns hit-testing because only it knows where the pet is standing.
ipcMain.on('pet:interactive', (_e, interactive) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('pet:ask', answerScreen);
ipcMain.on('pet:settings', openSettings);
ipcMain.on('pet:quit', () => { quitting = true; app.quit(); });

ipcMain.handle('config:get', async () => ({
  settings,
  skins: config.SKINS,
  models: await listModels({ endpoint: endpoint() }),
  visionModel,
  packaged: app.isPackaged,
}));

ipcMain.handle('config:save', async (_e, patch) => {
  settings = config.merge(settings, patch);
  writeJson('settings.json', settings);
  await applySettings();
  return { settings, visionModel };
});

ipcMain.on('config:close', () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearTimeout(saveTimer);
  writeJson('pet.json', state);
});

// Desktop pet: closing a window is not the same as quitting. The tray is the
// way out, so the app stays alive with no windows open.
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
