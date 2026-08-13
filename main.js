'use strict';

const {
  app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, screen,
  ipcMain, powerMonitor, nativeImage, session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { recognise } = require('./ocr');
const { listen } = require('./speech');
const media = require('./media');
const dnd = require('./dnd');
const reminders = require('./reminders');
const { ask, askVision, chat, detectVisionModel, listModels, hasEnoughText } = require('./brain');
const pets = require('./pet-state');
const skills = require('./skills');
const config = require('./settings');

const STAGE_H = 300;
const TICK_MS = 20000;
const IDLE_SLEEP_S = 300; // system idle this long and the pet naps
const VISION_TIMEOUT_MS = 240000; // vision on CPU is much slower than text
const PHOTO_DELAY_MS = 1500; // between "smile!" and the shutter
// A 640x480 JPEG is well under a megabyte; this is the ceiling before anything
// is decoded, so a renderer sending something absurd is refused rather than
// buffered.
const MAX_PHOTO_CHARS = 12 * 1024 * 1024;
// How long anything the pet says keeps it on screen during quiet hours. Long
// enough to read an answer, short enough that it goes away again on its own.
const QUIET_SHOW_MS = 30000;
// setTimeout wraps past this and fires immediately, which for a reminder means
// shouting the moment you set it. Long timers are re-armed instead.
const MAX_DELAY_MS = 2147483647;

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

// ---- permissions ------------------------------------------------------------

// Deny by default; config.allowPermission owns the one exception and is tested
// on its own. Both handlers are installed because Chromium consults them in
// different situations and leaving either at Electron's default undoes the other.
function lockPermissions() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) => {
    done(config.allowPermission(settings, permission, details));
  });

  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) =>
    config.allowPermission(settings, permission, details)
  );
}

// ---- windows ----------------------------------------------------------------

// The strip the pet stands on: the full width of one display's work area, along
// the bottom of it. A function rather than a constant because there is more than
// one display and the pet does not have to stay on the first one.
function stageBounds(display) {
  const { workArea } = display;
  return {
    x: workArea.x,
    y: workArea.y + workArea.height - STAGE_H,
    width: workArea.width,
    height: STAGE_H,
  };
}

function placeOn(display) {
  if (win && !win.isDestroyed()) win.setBounds(stageBounds(display));
}

// Where you are looking, as far as anything here can tell. The cursor is a
// better guess than "the primary display", which is only right for people with
// one monitor.
const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

function createWindow() {
  win = new BrowserWindow({
    ...stageBounds(screen.getPrimaryDisplay()),
    // Launching into a game or a presentation should not put a pet on the screen
    // for even one frame. It still loads and still works; it is just not shown
    // until Windows says the coast is clear.
    show: !quiet,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false, // never steal focus from what the user is actually doing
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  hiddenByQuiet = quiet;
  // Windows hands a frameless transparent window back a few pixels taller than
  // it was asked for, which puts the strip over the taskbar. setBounds is exact.
  win.setBounds(stageBounds(screen.getPrimaryDisplay()));
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
    height: 820,
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
  if (win.isVisible()) {
    win.hide();
    quietOverride = false;
  } else {
    win.showInactive();
    // Asking for the pet during quiet hours outranks Windows, but only until the
    // quiet spell ends - the next game gets to hide it again.
    quietOverride = quiet;
  }
  hiddenByQuiet = false;
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const shown = win && !win.isDestroyed() && win.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Read screen now', click: answerScreen },
    { label: shown ? 'Hide pet' : 'Show pet', click: togglePet },
    // Two monitors and the pet is on the wrong one is not worth a settings page.
    { label: 'Move pet here', click: () => placeOn(cursorDisplay()) },
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

// ---- quiet hours ------------------------------------------------------------

// Windows already knows when you are in a game, presenting, or have Do Not
// Disturb switched on, and it is the same question it asks itself before showing
// a toast. While the answer is "not now" the pet stops speaking up on its own
// and gets off the screen - it does not stop working. Anything you ask for still
// answers, and answering brings it back for half a minute.
let quiet = false;
let hiddenByQuiet = false; // the pet was put away by this, not by you
let quietOverride = false; // ...and then you asked for it back
let showUntil = 0;

function applyQuiet(now = Date.now()) {
  if (!win || win.isDestroyed()) return;
  const hide = quiet && !quietOverride && now >= showUntil;

  if (hide && win.isVisible()) {
    win.hide();
    hiddenByQuiet = true;
    refreshTray();
  } else if (!hide && hiddenByQuiet) {
    hiddenByQuiet = false;
    win.showInactive();
    refreshTray();
  }
}

function pollQuiet() {
  // Never rejects: a check that failed means carry on as normal, because the
  // failure mode of guessing "quiet" is a pet that silently never comes back.
  dnd.quiet().then((now) => {
    if (now !== quiet) {
      quiet = now;
      if (!quiet) quietOverride = false; // the override covered one quiet spell
    }
    applyQuiet();
  });
}

// ---- renderer messaging -----------------------------------------------------

function send(channel, payload) {
  // Unprompted talk is already stopped upstream in talk(), so a line reaching
  // here during quiet hours is an answer to something you asked for - worth
  // pulling the window back for.
  if (channel === 'pet:say') {
    showUntil = Date.now() + QUIET_SHOW_MS;
    applyQuiet();
  }
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
function talk(kind, { event = null, text = null, tone = 'chat', move = null } = {}) {
  // The smoke check exits on the first thing the pet says, and it is checking
  // the answer, not the small talk.
  if (process.env.SCREENPET_SMOKE) return;
  // The whole point of the quiet check: this is the door everything the pet says
  // off its own bat goes through, and none of it is worth interrupting a game or
  // a presentation for.
  if (quiet && !quietOverride) return;
  const said = text || pets.line(kind, lineIndex++, settings.pet);
  if (!said) return;
  send('pet:say', { text: said, kind: tone, expr: pets.expressionFor(event), move });
}

function tick() {
  const now = Date.now();
  const napping = asleep();

  // Fire and forget, once per tick. ~750ms in a background PowerShell, so the
  // pet notices a game starting within twenty seconds rather than instantly -
  // which is the trade for not shipping a native module to poll it faster.
  pollQuiet();
  applyQuiet(now);
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
  // The display the cursor is on, not the primary one. On two monitors the
  // question is almost always about the screen you are working on, and reading
  // the other one back is worse than useless - it is confidently wrong.
  const display = cursorDisplay();
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

// What the renderer last reported, since only it can read the battery. Null
// until it says otherwise, and the skill answers honestly in that case.
let battery = null;

// Pending reminders, in memory and on disk. The disk half is why "remind me to
// call the bank in an hour" survives a restart, and it is also why timers.json
// is the one file here with your own words in it - capped and cleaned in
// reminders.js, and deleted the moment it fires.
const timers = new Map(); // timeout id -> { at, say }

const saveTimers = () => writeJson('timers.json', [...timers.values()]);

function ring(say, late = false) {
  send('pet:say', {
    text: late ? reminders.lateLine(say) : say,
    kind: 'nag',
    expr: pets.expressionFor(late ? 'curious' : 'ring'),
    move: 'jump',
  });
}

function startTimer({ ms, say }, at = Date.now() + ms) {
  const id = setTimeout(() => {
    timers.delete(id);
    // Anything past 24 days had to be clamped to get here; re-arm rather than
    // shout early.
    if (Date.now() < at) return startTimer({ ms: at - Date.now(), say }, at);
    saveTimers();
    ring(say);
  }, Math.min(Math.max(ms, 0), MAX_DELAY_MS));

  timers.set(id, { at, say });
  saveTimers();
}

/** Reminders from a previous run: the ones still to come, and the ones missed. */
function restoreTimers(now) {
  const { late, pending } = reminders.load(readJson('timers.json'), now);
  for (const item of pending) startTimer({ ms: item.at - now, say: item.say }, item.at);
  saveTimers(); // whatever was dropped as malformed or stale goes now

  // Staggered, because one bubble replaces the last: five at once would show you
  // the fifth and nothing else.
  late.forEach((item, i) => setTimeout(() => ring(item.say, true), 2500 + i * 5000));
}

/**
 * Skills answer before the model does, so "set a timer for five minutes" is
 * exact and instant rather than a small model's best guess at what you meant.
 * Returns true if it handled the message.
 */
function runSkill(text) {
  const skill = skills.match(text, { now: new Date(), battery });
  if (!skill) return false;

  // skills.js is pure and cannot see the settings, so the refusal lives here -
  // and it replaces the line rather than following it, because "Smile!" followed
  // by "actually I can't see" is a worse answer than just saying so.
  if (skill.photo && !settings.camera) {
    send('pet:say', {
      text: 'my eyes are shut! switch the camera on in settings and ask me again',
      kind: 'chat',
      expr: 'curious',
    });
    return true;
  }

  // Not through talk(): these are answers to something you asked for, and the
  // wording comes from skills.js rather than the line bank.
  send('pet:say', { text: skill.say, kind: 'chat', expr: skill.expr, move: skill.move });
  if (skill.timer) startTimer(skill.timer);
  if (skill.media) {
    media.press(skill.media).catch((err) => {
      send('pet:say', { text: err.message, kind: 'error', expr: pets.expressionFor('error') });
    });
  }
  // Long enough to look up and stop typing. The renderer takes the frame; only
  // it has the camera, and only main can write a file.
  if (skill.photo) setTimeout(() => send('pet:photo'), PHOTO_DELAY_MS);
  return true;
}

async function replyTo(message) {
  const text = String(message || '').trim();
  if (!text || busy) return;
  if (runSkill(text)) return;
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
    camera: settings.camera,
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

  // Before any window exists, so nothing can ask for anything in the gap.
  lockPermissions();

  // Awaited exactly once, here, and polled in the background from then on. The
  // 750ms is worth paying at launch: without it the greeting goes out before the
  // first answer comes back, which is precisely the interruption this prevents.
  quiet = await dnd.quiet();

  createWindow();
  createTray();

  // A monitor unplugged with the pet standing on it leaves the window running
  // somewhere that no longer exists. getDisplayMatching returns the nearest
  // survivor, which also covers a display simply changing resolution.
  const restage = () => {
    if (win && !win.isDestroyed()) placeOn(screen.getDisplayMatching(win.getBounds()));
  };
  screen.on('display-removed', restage);
  screen.on('display-added', restage);
  screen.on('display-metrics-changed', restage);

  win.webContents.once('did-finish-load', () => {
    sendLook();
    restoreTimers(Date.now());
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

// Three words, never a frame. The renderer reduces what the camera saw to one
// of these before it crosses the bridge; see "the room" in renderer.js.
ipcMain.on('pet:presence', (_e, event) => {
  if (!['arrived', 'left', 'blind'].includes(event)) return;
  if (busy) return; // do not talk over an answer you are waiting for
  talk(event, { event, move: event === 'arrived' ? 'jump' : null });
});

// The one time a frame crosses the bridge, and only because you asked for it by
// name. It goes to your Pictures folder and nowhere else: no upload, no
// thumbnail cache, no analysis. The filename is generated here rather than taken
// from the renderer, so nothing it sends can pick a path.
ipcMain.on('pet:photo-taken', (_e, dataUrl) => {
  const usable = typeof dataUrl === 'string'
    && dataUrl.startsWith('data:image/jpeg;base64,')
    && dataUrl.length <= MAX_PHOTO_CHARS;

  try {
    const img = usable ? nativeImage.createFromDataURL(dataUrl) : null;
    if (!img || img.isEmpty()) {
      return send('pet:say', {
        text: 'I could not see anything! is the camera covered?',
        kind: 'chat',
        expr: 'curious',
      });
    }
    const dir = path.join(app.getPath('pictures'), 'screenpet');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const name = `screenpet-${stamp}.jpg`;
    fs.writeFileSync(path.join(dir, name), img.toJPEG(90));
    send('pet:say', {
      text: `*click* saved ${name} in your Pictures\\screenpet folder`,
      kind: 'chat',
      expr: 'proud',
      move: 'jump',
    });
  } catch (err) {
    send('pet:say', { text: err.message, kind: 'error', expr: pets.expressionFor('error') });
  }
});

ipcMain.on('pet:battery', (_e, level) => {
  const ok = level && Number.isFinite(level.percent)
    && level.percent >= 0 && level.percent <= 100;
  battery = ok ? { percent: Math.round(level.percent), charging: !!level.charging } : null;
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
  // The timeouts go; the file stays. That is the whole point of the file.
  for (const id of timers.keys()) clearTimeout(id);
  clearTimeout(saveTimer);
  writeJson('pet.json', state);
});

// Desktop pet: closing a window is not the same as quitting. The tray is the
// way out, so the app stays alive with no windows open.
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
