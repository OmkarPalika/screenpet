'use strict';

const {
  app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, screen,
  ipcMain, powerMonitor, nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { recognise } = require('./ocr');
const { listen } = require('./speech');
const { ask, askVision, chat, detectVisionModel, listModels, hasEnoughText } = require('./brain');
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
let listening = false; // the microphone is open - separate from busy, and rarer
let lastPath = 'ocr'; // which tier actually answered, for the smoke check
let lineIndex = 0;
let chats = 0;
let saveTimer = null;
let quitting = false;
let wasAsleep = false;

// Conversation context, in memory only and never written anywhere. A desktop
// pet that keeps a transcript of your evening on disk is a liability.
const HISTORY_TURNS = 3;
const history = [];

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
    height: 980,
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
    // Muting belongs here rather than only in settings: the moment you want the
    // pet to stop talking is the moment a call starts, and opening a settings
    // window to find a checkbox is three seconds too many.
    {
      label: 'Mute voice',
      type: 'checkbox',
      checked: !settings.voice,
      click: () => saveSettings({ voice: !settings.voice }),
    },
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

/**
 * One door for everything the pet says off its own bat, so the line bank and the
 * face that goes with it can never drift apart.
 */
function talk(kind, { event = null, text = null, tone = 'chat' } = {}) {
  // The smoke check exits on the first thing the pet says, and it is checking
  // the answer, not the small talk.
  if (process.env.SCREENPET_SMOKE) return;
  const said = text || pets.line(kind, lineIndex++, settings.pet);
  if (!said) return;
  send('pet:say', { text: said, kind: tone, expr: pets.expressionFor(event) });
}

function tick() {
  const now = Date.now();
  const napping = asleep();
  state = pets.tick(state, now, { asleep: napping });

  if (wasAsleep && !napping) talk('woke', { event: 'wake' });
  // Going under used to be silent, so the pet just turned grey and stopped
  // answering - which reads as a crash rather than a nap.
  if (!wasAsleep && napping) talk('dozing', { event: 'doze' });
  wasAsleep = napping;

  if (!busy && !napping) {
    if (pets.shouldNag(state, now, { asleep: napping })) {
      state.lastNagAt = now;
      talk(pets.mood(state, { asleep: napping }), { tone: 'nag' });
    } else if (pets.shouldChatter(state, now, { asleep: napping })) {
      state.lastChatAt = now;
      // Every other one is a compliment rather than small talk - and then the
      // pet is immediately embarrassed about having said it, which is the whole
      // joke. Praise on every chatter would be flattery and stop landing.
      if (chats++ % 2) {
        talk('praised', { event: 'praise' });
        setTimeout(() => talk('bashful', { event: 'bashful' }), 3200);
      } else {
        talk('idle');
      }
    }
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

    // Nothing to answer is not a failure. Said through the line bank rather than
    // reported as one, and not through talk(), which the smoke check silences.
    const said = answer || pets.line('nothing', lineIndex++, settings.pet);
    send('pet:say', {
      text: said,
      kind: 'answer',
      expr: pets.expressionFor(answer ? 'answer' : 'nothing'),
    });
  } catch (err) {
    send('pet:say', { text: err.message, kind: 'error', expr: pets.expressionFor('error') });
  } finally {
    busy = false;
  }
}

// ---- talking ----------------------------------------------------------------

// How many replies this session, only so the face can alternate. A conversation
// where every answer wears the same smile stops looking like a conversation.
let replies = 0;

async function replyTo(message) {
  const text = String(message || '').trim();
  if (!text || busy) return;
  busy = true;
  send('pet:say', { text: 'thinking', kind: 'thinking' });
  try {
    const reply = await chat(text, {
      mood: pets.mood(state, { asleep: asleep() }),
      history,
      model: settings.model,
      endpoint: endpoint(),
    });
    history.push({ you: text, pet: reply });
    if (history.length > HISTORY_TURNS) history.shift();
    talk(null, { text: reply, event: replies++ % 2 ? 'wink' : 'chat' });
  } catch (err) {
    send('pet:say', { text: err.message, kind: 'error', expr: pets.expressionFor('error') });
  } finally {
    busy = false;
  }
}

/**
 * Push to talk. The microphone opens when you ask it to and shuts as soon as
 * you stop speaking - there is no wake word and no listening loop, because a
 * pet that is always listening is a microphone with a face on it.
 */
async function listenAndReply() {
  if (busy || listening || !settings.mic) return;
  listening = true;
  // Said directly rather than through talk(): the user needs to see that the
  // microphone is open, and the smoke check silences talk().
  send('pet:say', {
    text: pets.line('listening', lineIndex++, settings.pet),
    kind: 'chat',
    expr: pets.expressionFor('listen'),
  });
  try {
    const heard = await listen();
    if (!heard) {
      return send('pet:say', {
        text: pets.line('deaf', lineIndex++, settings.pet),
        kind: 'chat',
        expr: pets.expressionFor('curious'),
      });
    }
    await replyTo(heard);
  } catch (err) {
    send('pet:say', { text: err.message, kind: 'error', expr: pets.expressionFor('error') });
  } finally {
    listening = false;
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

// How the pet looks and sounds. One message, because the renderer needs all of
// it at the same moments: on load, and on every save.
function sendLook() {
  send('pet:look', {
    pet: settings.pet,
    skin: settings.skin,
    voice: settings.voice,
    mic: settings.mic,
  });
}

async function applySettings() {
  applyHotkey();
  applyAutostart();
  sendLook();
  refreshTray(); // the mute state is shown there
  visionModel = await resolveVision();
}

/** The one way settings change, wherever the change came from. */
async function saveSettings(patch) {
  settings = config.merge(settings, patch);
  writeJson('settings.json', settings);
  await applySettings();
  return settings;
}

// ---- wiring -----------------------------------------------------------------

app.whenReady().then(async () => {
  settings = config.load(readJson('settings.json'));
  state = pets.load(readJson('pet.json'), Date.now());

  createWindow();
  createTray();

  win.webContents.once('did-finish-load', () => {
    sendLook();
    // Launching counts as small talk, otherwise a fresh pet greets you and then
    // immediately chatters because lastChatAt is still zero.
    state.lastChatAt = Date.now();
    tick();
    setInterval(tick, TICK_MS);
    talk(pets.greetKind(new Date().getHours()), { event: 'greet' });
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

// What the pet says about each action, and about turning one down. A cooldown
// ('not yet') says nothing at all - the pet ignoring a fourth headpat in a row
// is better manners than complaining about it.
const SAID = { feed: 'fed', pet: 'patted', play: 'played', tickle: 'tickled' };
const REFUSED = { feed: 'full', play: 'tired' };

// How far up the poke ladder this bout has climbed. In memory only and on
// purpose: a tantrum should not survive a restart, and forgiveness on relaunch
// is the right default for something that lives on your taskbar.
let pokes = 0;
let lastPokeAt = 0;

ipcMain.on('pet:act', (_e, name) => {
  const now = Date.now();
  const before = state.bond;
  const result = pets.act(state, name, now);
  state = result.state;
  pushState({ acted: result.ok ? name : null });

  // Tickling is the one you can do over and over, so it is the one that
  // escalates. Refusals count too - the cooldown is what spamming it produces,
  // and a pet that ignores the fourth poke entirely feels broken rather than
  // patient.
  if (name === 'tickle') {
    pokes = pets.samePokeBout(lastPokeAt, now) ? pokes + 1 : 0;
    lastPokeAt = now;
    const { event, kind } = pets.pokeStep(pokes);
    talk(kind, { event, tone: pokes >= 3 ? 'nag' : 'chat' });
  } else if (result.ok) {
    // A bond milestone outranks the usual line - it only happens four times.
    const reached = pets.milestone(before, state.bond);
    talk(SAID[name], { event: reached ? 'milestone' : name, text: reached });
  } else if (REFUSED[name] && result.reason !== 'not yet') {
    talk(REFUSED[name], { event: 'refuse', tone: 'nag' });
  }
  savePet();
});

ipcMain.on('pet:react', (_e, event) => {
  if (event === 'drag') talk('dragged', { event: 'drag' });
});

ipcMain.on('pet:chat-open', (_e, open) => {
  if (!win || win.isDestroyed()) return;
  // Normally focusable:false so the pet can never steal focus from real work.
  // Typing needs focus, so it is granted for exactly as long as the box is open.
  win.setFocusable(!!open);
  if (open) win.focus();
});

ipcMain.on('pet:chat', (_e, text) => replyTo(text));
ipcMain.on('pet:listen', listenAndReply);

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
  pets: config.PETS,
  models: await listModels({ endpoint: endpoint() }),
  visionModel,
  packaged: app.isPackaged,
}));

ipcMain.handle('config:save', async (_e, patch) => ({
  settings: await saveSettings(patch),
  visionModel,
}));

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
