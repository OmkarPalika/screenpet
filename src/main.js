'use strict';

const {
  app, BrowserWindow, Tray, Menu, globalShortcut, desktopCapturer, screen,
  ipcMain, powerMonitor, nativeImage, session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { recognise } = require('./system/ocr');
const { listen } = require('./system/speech');
const dictate = require('./system/dictate');
const host = require('./system/host');
const media = require('./system/media');
const dnd = require('./system/dnd');
const reminders = require('./core/reminders');
const breaks = require('./core/breaks');
const watch = require('./core/watch');
const weather = require('./core/weather');
const wake = require('./system/wake');
const windows = require('./system/window');
const voice = require('./system/voice');
const faces = require('./system/faces');
const memory = require('./core/memory');
const net = require('./core/net');
const providers = require('./core/providers');
const keys = require('./system/keys');
const update = require('./system/update');
const {
  ask, askVision, chat, detectVisionModel, listModels, hasEnoughText, redact,
} = require('./core/brain');
const pets = require('./core/pet-state');
const skills = require('./core/skills');
const config = require('./core/settings');

// One pet. Launching it again - from the Start menu, or the installer's "run
// when finished" landing on top of a copy already in the tray - shows the one
// that is there rather than booting a rival with a second tray icon, a second
// set of timers and a losing bid for the hotkey.
//
// app.exit rather than app.quit: quit fires will-quit, which writes pet.json,
// and this instance has no state loaded. The loser would blank the winner's
// save on the way out.
//
// The smoke check is exempt. It answers once and exits, and having it depend on
// whether the tray copy happens to be running makes it useless as a check.
if (!process.env.SCREENPET_SMOKE && !app.requestSingleInstanceLock()) app.exit(0);

app.on('second-instance', () => {
  // Only ever shows. Toggling would hide the pet of somebody who just asked to
  // see it - and togglePet already handles a window that is gone, and already
  // gets the quiet-hours override right for a pet asked for by hand.
  if (!win || win.isDestroyed() || !win.isVisible()) togglePet();
});

// Outside src/, but still inside the asar - Electron's patched fs reads it from
// in there, so unlike the PowerShell scripts an icon needs no asarUnpack.
const ASSETS = path.join(__dirname, '..', 'assets');

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
// How long the microphone stays open for a dance you asked for. Long enough for
// a chorus, short enough that forgetting about it costs nothing.
const DANCE_MS = 20000;
// Whisper needs the audio itself, and only the renderer can open a microphone.
// This is the ceiling on that round trip: the recorder stops on silence long
// before it, so reaching it means the renderer never answered.
const RECORD_TIMEOUT_MS = 15000;
// setTimeout wraps past this and fires immediately, which for a reminder means
// shouting the moment you set it. Long timers are re-armed instead.
const MAX_DELAY_MS = 2147483647;

let win = null;
let settingsWin = null;
let tray = null;
let state = null;
let mem = null;
let settings = null;
let visionModel = null; // resolved model name, or null for the OCR path
let busy = false;
let listening = false; // the microphone is open - separate from busy, and rarer
let lastPath = 'ocr'; // which tier actually answered, for the smoke check
let lastCrop = 'screen'; // and how much of the screen it was given
let lineIndex = 0;
let chats = 0;
let saveTimer = null;
let memTimer = null;
let quitting = false;
let wasAsleep = false;

// Conversation context, in memory only and never written anywhere. A desktop
// pet that keeps a transcript of your evening on disk is a liability.
const HISTORY_TURNS = 3;
const history = [];

// The last thing it read off the screen, so "what about the second one?" works
// after a screen answer. Redacted on the way in, held in memory only, replaced
// by the next read, and stale after this long - answering a follow-up from a
// screen you left ten minutes ago is worse than admitting it does not know.
const SCREEN_MEMORY_MS = 5 * 60 * 1000;
let lastScreen = null;

const screenContext = () =>
  lastScreen && Date.now() - lastScreen.at < SCREEN_MEMORY_MS ? lastScreen : null;

// Reading the screen on a timer, while that setting is on. All three of these
// are in memory only and none of them survive a restart: what the pet read last
// is exactly the kind of thing that has no business being written down, and the
// clock starting fresh on launch is what stops a machine that has been off all
// weekend reading the screen the moment it comes back.
let lastWatchAt = 0;
let lastWatched = ''; // the OCR text of the last screen it read
let lastWatchSaid = ''; // ...and the last thing it said about one

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

function dropJson(name) {
  try {
    fs.rmSync(filePath(name), { force: true });
  } catch (err) {
    console.error(`could not delete ${name}:`, err.message);
  }
}

// Nothing is written while the setting is off, and switching it off deletes what
// is already there - a memory you can only pause is not one you can turn off.
function saveMem() {
  clearTimeout(memTimer);
  if (!settings.memory) return;
  memTimer = setTimeout(() => writeJson('memory.json', mem), 400);
}

/** Record an observation. A counter, never anything that was said. See memory.js. */
function noteEvent(event) {
  if (!settings.memory) return;
  mem = memory.note(mem, event, Date.now());
  saveMem();
}

const asleep = () => powerMonitor.getSystemIdleTime() >= IDLE_SLEEP_S;
const endpoint = () => settings.ollama;

// ---- which model answers ----------------------------------------------------

// DPAPI blobs, one per provider. Kept out of settings.json on purpose: that file
// is round-tripped through the settings window, and a key has no business
// crossing into a renderer. Nothing here is read while the provider is 'ollama'.
let keyStore = {};

/**
 * Everything ask/chat need to know about where the answer comes from.
 *
 * Awaited because unwrapping a key is a PowerShell spawn - once per provider per
 * session, cached in keys.js after that.
 */
async function llm() {
  const local = providers.isLocal(settings.provider);
  return {
    model: settings.model,
    endpoint: endpoint(),
    provider: settings.provider,
    providerModel: settings.providerModel,
    key: local ? null : await keys.get(settings.provider, keyStore),
  };
}

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

// The floor the pet stands on is the whole of one display's work area, because
// you can put it anywhere on that display. The window itself still never moves:
// the pet is a div inside it, and translating a div is free where dragging a
// transparent always-on-top window at 60fps is not.
//
// The work area rather than the display bounds, so the pet cannot be put behind
// the taskbar - and the renderer clamps the div inside this, which is the whole
// of "it can never be sent off the screen".
//
// A function rather than a constant because there is more than one display and
// the pet does not have to stay on the first one.
function stageBounds(display) {
  const { workArea } = display;
  return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
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
    width: 500,
    height: 700,
    minWidth: 420,
    minHeight: 460,
    // Resizable now that the panel between the tabs and the button row is the
    // only thing that scrolls - Save cannot be pushed off the bottom, which is
    // the reason this was pinned shut and 940px tall.
    resizable: true,
    title: 'screenpet',
    icon: path.join(ASSETS, 'icon.png'),
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
    // Asked for by hand, so it starts rather than being offered - and it resets
    // the clock, so a break taken at ten past is not followed by the scheduled
    // one at quarter past.
    {
      label: 'Take a break now',
      click: () => {
        lastBreakAt = Date.now();
        offered = null;
        startBreak(breaks.nth(breakCount++).kind);
      },
    },
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
    // Its own entry rather than part of the one above: muting a pet that reads
    // your screen aloud and muting a pet that goes "woof" are two different
    // wants, and the second is the one that outstays its welcome first.
    {
      label: 'Mute noises',
      type: 'checkbox',
      checked: !settings.sounds,
      click: () => saveSettings({ sounds: !settings.sounds }),
    },
    { type: 'separator' },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'icon.png')));
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

// ---- breaks -----------------------------------------------------------------
//
// Every so often the pet takes the screen for twenty seconds and tells you to
// drink something or look at something further away than a monitor.
//
// This is the only thing in the app that interrupts you rather than waits to be
// asked, so all of the care is in when it does not: not during a game, a call or
// a presentation, which is the same do not disturb check the pet already
// respects; not while an answer is being written; and not while you are away,
// because time away from the machine is the break.
//
// It always closes. Escape, either button, the countdown running out, or the
// backstop timer below if the window somehow stops counting.

let breakTimer = null;
let breakCount = 0;
let lastBreakAt = 0;
let breaking = null; // the kind being taken, or null

let offered = null; // the thought currently on screen, if you click it

/** The pet thinks about it. Nothing else happens unless you click the thought. */
function offerBreak() {
  lastBreakAt = Date.now();
  offered = breaks.nth(breakCount++);
  send('pet:think', offered);
}

/**
 * You clicked it. The pet's own window grows to cover the whole display - the
 * work area leaves your taskbar lit up through a screen that is supposed to be
 * a pause - and the renderer dims everything and walks the pet into the middle.
 */
function startBreak(kind) {
  if (breaking || !win || win.isDestroyed()) return;
  breaking = kind;
  const seconds = settings.breakFor;
  // Shown even during quiet hours, because at this point you asked for it.
  if (!win.isVisible()) win.showInactive();
  win.setBounds(cursorDisplay().bounds);
  send('break:show', { kind, seconds });

  // The screen comes back whatever the renderer does. A stalled countdown, a
  // message that went missing, a page that fell over - none of those are
  // allowed to leave a dimmed screen in front of somebody's work.
  clearTimeout(breakTimer);
  breakTimer = setTimeout(endBreak, (seconds + CROSS_S + 5) * 1000);
}

// The walk into the middle and back again, from style.css. Only used to know how
// long the backstop above has to wait before it is genuinely late.
const CROSS_S = 3;

function endBreak() {
  clearTimeout(breakTimer);
  breakTimer = null;
  if (!breaking) return;
  breaking = null;
  if (win && !win.isDestroyed()) win.setBounds(stageBounds(screen.getDisplayMatching(win.getBounds())));
}

ipcMain.on('break:take', () => {
  // Only the thought that is actually on screen can be clicked into a break, and
  // only once - a renderer sending this on its own gets nothing.
  if (!offered) return;
  const { kind } = offered;
  offered = null;
  startBreak(kind);
});

ipcMain.on('break:done', endBreak);

// ---- noticing you move between windows --------------------------------------

// A rectangle arrives whenever you change windows. The pet looks over at it, and
// occasionally leans across to see what turned up. That is the whole reaction:
// it does not know which application it is looking at, cannot read anything from
// over there, and says nothing, because a pet that pipes up every time you
// alt-tab is the single most annoying thing this app could do.

// How often the leaning-over is allowed. The glance is free and can happen on
// every switch; a body movement on every switch would have the pet convulsing
// through a normal morning of flicking between two windows.
const PEEK_MS = 45000;
let lastPeekAt = 0;

// ...and how often a peek turns into climbing up and sitting on the top edge of
// whatever you just switched to. A third of the peeks, so a few times an hour at
// most. It knows the rectangle and nothing else - it cannot read the title, so
// it has no idea whether it just sat on a spreadsheet or a game, and the pet's
// window ignores the mouse, so nothing it sits on stops being clickable.
const PERCH_CHANCE = 0.34;

function noticed(r) {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  // Thinking, asleep, or told to keep quiet - the same three things that stop
  // the pet speaking up, for the same reason. This is it noticing you rather
  // than answering you.
  if (busy || asleep() || (quiet && !quietOverride)) return;

  // Windows counts in physical pixels, Electron in points, and the pet's window
  // is one display's work area. Electron owns that conversion, including the
  // case where the window that lit up is on your other monitor: the point lands
  // outside the pet's window, aim() clamps it, and the pet looks that way.
  const p = screen.screenToDipPoint({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const at = win.getBounds();

  const now = Date.now();
  const peek = now - lastPeekAt > PEEK_MS;
  if (peek) lastPeekAt = now;

  // Where to sit, if it is going to: the top left of that rectangle, in the same
  // window coordinates as the glance. The renderer picks the spot along the edge
  // and subtracts its own height, because only it knows how tall the pet is.
  const climb = peek && settings.mischief && Math.random() < PERCH_CHANCE;
  const from = climb ? screen.screenToDipPoint({ x: r.x, y: r.y }) : null;
  const to = climb ? screen.screenToDipPoint({ x: r.x + r.w, y: r.y }) : null;

  send('pet:glance', {
    x: p.x - at.x,
    y: p.y - at.y,
    peek,
    perch: climb ? { x: from.x - at.x, y: from.y - at.y, w: to.x - from.x } : null,
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
 *
 * @returns {boolean} whether the line actually reached the screen. The caller
 *   needs to know: a line dropped by do not disturb was never said, and counting
 *   it as one you ignored would hold a setting against you.
 */
function talk(kind, { event = null, text = null, tone = 'chat', move = null } = {}) {
  // The smoke check exits on the first thing the pet says, and it is checking
  // the answer, not the small talk.
  if (process.env.SCREENPET_SMOKE) return false;
  // The whole point of the quiet check: this is the door everything the pet says
  // off its own bat goes through, and none of it is worth interrupting a game or
  // a presentation for.
  if (quiet && !quietOverride) return false;
  const said = text || pets.line(kind, lineIndex++, settings.pet);
  if (!said) return false;
  // Everything through this door is the pet talking rather than answering, so
  // it is chirped rather than read out by a Windows voice. The rule is exactly
  // "the words came out of the line bank", which is what makes it checkable.
  send('pet:say', { text: said, kind: tone, expr: pets.expressionFor(event), move, chatter: true });
  return true;
}

/**
 * You did something. Clears the ignored count wherever it is called from, and
 * says whether the pet had noticed being ignored - which is the one thing worth
 * reacting to, and only ever once.
 */
function attention() {
  const { state: next, back } = pets.heard(state);
  state = next;
  return back;
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

  // Away from the machine is already a break, so the clock is pushed along
  // rather than left running. Without this, five minutes in the kitchen is
  // rewarded with a break screen the moment you sit back down.
  if (napping) lastBreakAt = now;
  else if (settings.breaks && breaks.due(lastBreakAt, now, settings.breakEvery * 60000, {
    quiet: quiet && !quietOverride,
    busy,
  })) {
    offerBreak();
  }

  // Reading the screen without being asked. Same three reasons not to as the
  // break above, and one more of its own: away from the machine, the screen is
  // whatever was left there, and answering it is answering nobody. The clock is
  // pushed along while nobody is there so sitting back down is not met with an
  // immediate read of a screen that has not changed since you left it.
  if (napping) lastWatchAt = now;
  else if (settings.watch && watch.due(lastWatchAt, now, settings.watchEvery * 1000, {
    quiet: quiet && !quietOverride,
    busy,
  })) {
    lastWatchAt = now;
    readScreen({ unprompted: true });
  }

  if (wasAsleep && !napping) talk('woke', { event: 'wake' });
  // Going under used to be silent, so the pet just turned grey and stopped
  // answering - which reads as a crash rather than a nap.
  if (!wasAsleep && napping) talk('dozing', { event: 'doze' });
  wasAsleep = napping;

  if (settings.memory) {
    mem = memory.seen(mem, now);
    saveMem();
  }

  if (!busy && !napping) {
    // Everything in here is the pet speaking first, and every line that reaches
    // the screen counts as one you have not answered yet. `said` is what makes
    // that honest: do not disturb drops lines, and a line nobody saw is not one
    // anybody ignored.
    let said = false;
    const nagging = pets.shouldNag(state, now, { asleep: napping });
    const chatting = !nagging && pets.shouldChatter(state, now, { asleep: napping });

    // Being ignored takes whichever slot came up rather than adding one of its
    // own. A pet that talks MORE because you are not answering is the exact
    // failure mode this is supposed to avoid.
    const snub = nagging || chatting ? pets.ignoreStep(state.ignored) : null;

    if (snub) {
      if (nagging) state.lastNagAt = now;
      else state.lastChatAt = now;
      said = talk(snub.kind, { event: snub.event, tone: 'nag' });
    } else if (nagging) {
      state.lastNagAt = now;
      said = talk(pets.mood(state, { asleep: napping }), { tone: 'nag' });
    } else if (chatting) {
      state.lastChatAt = now;
      // Sulking outranks all of it: a pet waiting for an apology and making
      // small talk about the weather is not waiting for an apology.
      //
      // Below that, something it remembers outranks small talk when it has one -
      // "you were gone three days" is worth more than "mrrp". Both spend the
      // chatter slot rather than adding a second one, and memory.js throttles
      // its half far harder than chatter is throttled.
      const sulk = pets.sulking(state, now);
      const remark = !sulk && settings.memory
        && memory.remark(mem, now, { cheek: settings.cheek, index: lineIndex });
      if (sulk) {
        said = talk('sulky', { event: 'sulk' });
      } else if (remark) {
        mem = remark.mem;
        saveMem();
        lineIndex++;
        said = talk(null, { text: remark.text, event: remark.event });
      // Every other one is a compliment rather than small talk - and then the
      // pet is immediately embarrassed about having said it, which is the whole
      // joke. Praise on every chatter would be flattery and stop landing.
      } else if (chats++ % 2) {
        said = talk('praised', { event: 'praise' });
        setTimeout(() => talk('bashful', { event: 'bashful' }), 3200);
      } else {
        said = talk('idle');
      }
    }

    // One line, one count, however it was chosen.
    if (said) state = pets.spoke(state);
  }

  pushState();
  savePet();
}

// ---- answering --------------------------------------------------------------

// Whether there is a model to answer with at all.
//
// The pet does not need one. It wanders, naps, sits on your windows, takes
// breaks, eats, is petted, wears hats, answers every skill in skills.js and
// pulls all forty faces without ever speaking to Ollama. Reading the screen is
// the one thing that needs a model, and it is meant to read as a part you
// switch on rather than as the app being broken until you do.
//
// So this exists to tell "off" apart from "broken" before anything shows a
// thinking bubble and then a failed fetch three seconds later.
let brainReady = false;

/**
 * One GET to loopback. Cheap enough to redo whenever settings change and
 * whenever a read is asked for, which is what makes installing Ollama halfway
 * through a session work without restarting the pet.
 */
async function probeBrain() {
  // A hosted provider is a key and a URL rather than an install. There is
  // nothing local to look for, and providers.js is the thing that reports on it.
  if (!providers.isLocal(settings.provider)) {
    brainReady = true;
    return true;
  }
  brainReady = (await listModels({ endpoint: endpoint() })).length > 0;
  return brainReady;
}

/**
 * Said instead of answering, when there is no model to answer with. The pet's
 * own words, out of the line bank, because nothing has gone wrong.
 *
 * Never during the smoke check: that check exists to prove the app can answer,
 * and a pet cheerfully saying it cannot read would have it pass on a machine
 * with no model at all.
 */
function sayNoBrain() {
  if (process.env.SCREENPET_SMOKE) return false;
  send('pet:say', {
    text: pets.line('nobrain', lineIndex++, settings.pet),
    kind: 'chat',
    expr: pets.expressionFor('nobrain'),
    chatter: true,
  });
  return true;
}

async function resolveVision() {
  // A screenshot cannot be redacted, so the vision tier is local-only. Choosing
  // a hosted provider gives up reading diagrams rather than uploading the screen
  // to get them - brain.js refuses the same request a second time.
  if (!providers.isLocal(settings.provider)) return null;
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

  // Asked before the pet gets out of the way, not after: hiding a window takes
  // a moment, and this is a PowerShell spawn on the path of a key you just
  // pressed. The pet's own window is never the foreground one - it is
  // focusable:false, which is what makes this safe to ask at any point.
  const where = settings.focus ? await windows.rect() : null;

  const wasVisible = win && win.isVisible();
  if (wasVisible) win.hide();
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
    });
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!source) throw new Error('No screen source available.');
    // Cropped to the window you are in, when that is a sensible thing to do.
    // window.js decides; null means the whole screen, which is what this always
    // did and what every system that cannot answer the question still gets.
    const crop = windows.cropFor(where, display, source.thumbnail.getSize());
    lastCrop = crop ? 'window' : 'screen';
    return (crop ? source.thumbnail.crop(crop) : source.thumbnail).toPNG();
  } finally {
    if (wasVisible) win.showInactive();
  }
}

/**
 * A listener that puts the answer in the bubble as it is written.
 *
 * Throttled: Ollama hands over a token every few milliseconds and the window
 * cannot draw faster than the screen refreshes, so an unthrottled stream is
 * hundreds of messages a second nobody can see. The last piece is always sent -
 * a stream that stops mid-word because the final token landed inside the
 * throttle window is exactly the bug this is meant to prevent.
 */
function streamer() {
  let at = 0;
  let queued = null;
  let timer = null;
  const push = (text) => {
    at = Date.now();
    queued = null;
    send('pet:say', { text, kind: 'answer', partial: true });
  };
  const onToken = (text) => {
    const wait = 70 - (Date.now() - at);
    if (wait <= 0) return push(text);
    queued = text;
    if (!timer) timer = setTimeout(() => { timer = null; if (queued !== null) push(queued); }, wait);
  };
  onToken.stop = () => { clearTimeout(timer); timer = null; queued = null; };
  return onToken;
}

/**
 * Read the screen and say something about it.
 *
 * Two callers, and the difference between them is who asked. The hotkey, the
 * tray and the pet's own menu all mean "read it now, and tell me something
 * either way". The timer below means nobody asked, and that changes three
 * things: the vision tier is off, the same screen is never answered twice, and
 * a screen with no question on it gets silence rather than a line about there
 * being no question.
 */
async function readScreen({ unprompted = false } = {}) {
  if (busy) return;
  // A read nobody asked for never leaves this machine. settings.js already
  // refuses the combination; this is the second lock on the same door, and the
  // one that holds if a settings file is edited by hand.
  if (unprompted && !providers.isLocal(settings.provider)) return;
  // Declared out here so the finally can stop it. A failure now throws out of
  // ask(), and a streamer left running paints its queued partial answer into
  // the bubble up to 70ms after the error has already replaced it.
  let onToken = null;
  // Set before the probe below, which awaits: without it a second press of the
  // hotkey during that round trip walks straight past the guard on the line
  // above and reads the screen twice.
  busy = true;
  try {
    if (!unprompted) {
      // The hour, and nothing else. Not what was on the screen, not what was
      // asked. True whether or not there turns out to be a model to answer
      // with: you asked, and the pet noticed you.
      noteEvent('ask');
      attention();
    }
    // Nothing to answer with. Checked before the screenshot rather than after
    // the model refuses, so there is no shot taken, no thinking bubble and no
    // wait - and re-probed here, so installing Ollama and pressing the hotkey
    // again is all it takes to turn reading on.
    if (!brainReady && !(await probeBrain())) {
      // A timer that cannot read says nothing at all. Once a minute is the
      // wrong frequency for news that does not change.
      if (unprompted) return;
      // Falls through only for the smoke check, which sayNoBrain refuses: it is
      // there to prove the app can answer, so it takes the real path and
      // reports the real failure.
      if (sayNoBrain()) return;
    }
    if (!unprompted) send('pet:say', { text: 'thinking', kind: 'thinking' });
    const png = await grabScreen();
    // Mood is passed for tone only. Nothing here can refuse to answer.
    const mood = pets.mood(state, { asleep: asleep() });

    // OCR first. On 'auto' the vision model is a fallback for screens with no
    // text to read, not the preferred path - a small vision model is far worse
    // than OCR at dense text. Naming a model explicitly opts into always using it.
    //
    // Never on the watch path. A screenshot cannot be redacted, vision on CPU
    // takes minutes rather than seconds, and "there is no text to read" is the
    // most common screen there is - so watching would spend most of its life in
    // the expensive tier, for the screens least likely to have a question on them.
    const alwaysVision = !unprompted && settings.vision !== 'auto' && settings.vision !== 'off';
    const ocrText = alwaysVision ? '' : await recognise(png);
    const useVision = !unprompted && visionModel && (alwaysVision || !hasEnoughText(ocrText));
    lastPath = `${useVision ? `vision:${visionModel}` : 'ocr'} of the ${lastCrop} (ocr read ${ocrText.trim().length} chars)`;

    // The same screen, still there. Reading it again is what a timer does;
    // answering it again is what makes one unbearable.
    if (unprompted) {
      const worth = watch.changed(lastWatched, ocrText);
      lastWatched = ocrText;
      if (!worth) return;
    }

    const where = await llm();
    // Streamed on the local path only. A hosted provider answers through
    // providers.js, which asks for the whole thing at once - and the smoke
    // check exits on the first answer it sees, so a half-written one would cut
    // it short.
    //
    // Never while watching either: most of those answers are the sentinel that
    // means "say nothing", and streaming would type it into the bubble and then
    // take it away again.
    onToken = providers.isLocal(settings.provider) && !process.env.SCREENPET_SMOKE && !unprompted
      ? streamer() : null;
    const answer = useVision
      ? await askVision(png.toString('base64'), {
          ...where, mood, model: visionModel, timeoutMs: VISION_TIMEOUT_MS, onToken,
        })
      : await ask(ocrText, { ...where, mood, onToken, watching: unprompted });

    // Kept for a follow-up question, redacted the same way the model's copy was.
    // Vision answers keep no text: there was none to read, and the screenshot
    // itself is never held anywhere.
    lastScreen = answer && !useVision
      ? { text: redact(ocrText), answer, at: Date.now() }
      : null;

    if (unprompted) {
      // Nothing worth saying is the usual outcome, and it is said by not saying
      // anything. The second half is for an answer that comes back identical
      // read after read, which is worth hearing once and not once a minute.
      if (!answer || answer === lastWatchSaid) return;
      lastWatchSaid = answer;
      return send('pet:say', { text: answer, kind: 'answer', expr: pets.expressionFor('answer') });
    }

    // Nothing to answer is not a failure. Said through the line bank rather than
    // reported as one, and not through talk(), which the smoke check silences.
    const said = answer || pets.line('nothing', lineIndex++, settings.pet);
    send('pet:say', {
      text: said,
      kind: 'answer',
      expr: pets.expressionFor(answer ? 'answer' : 'nothing'),
      // A screen with no question on it is the pet's own line, not an answer,
      // and there is nothing in it worth a Windows voice reading out.
      chatter: !answer,
    });
  } catch (err) {
    // A read nobody asked for fails quietly. A red bubble every minute about a
    // recogniser that is not there tells you the same thing sixty times an hour.
    if (unprompted) console.error('watch:', err.message);
    else send('pet:say', { text: err.message, kind: 'error', expr: pets.expressionFor('error') });
  } finally {
    if (onToken) onToken.stop();
    busy = false;
  }
}

// Wrapped rather than passed straight to the tray, the hotkey and the IPC
// handler: all three call their handler with arguments, and none of those
// arguments mean anything here.
const answerScreen = () => readScreen();

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

function startTimer({ ms, say, repeat = null }, at = null) {
  // A repeat rule knows its own next occurrence; a duration is measured from now.
  const when = at !== null ? at
    : repeat ? reminders.nextAt(repeat, Date.now())
    : Date.now() + ms;
  if (!Number.isFinite(when)) return false;

  const id = setTimeout(() => {
    timers.delete(id);
    // Anything past 24 days had to be clamped to get here; re-arm rather than
    // shout early.
    if (Date.now() < when) return startTimer({ say, repeat }, when);
    saveTimers();
    ring(say);
    // The next one is scheduled after this one fires rather than in a batch, so
    // a daily alarm is exactly one live timeout at any moment.
    if (repeat) startTimer({ say, repeat });
  }, Math.min(Math.max(when - Date.now(), 0), MAX_DELAY_MS));

  timers.set(id, repeat ? { at: when, say, repeat } : { at: when, say });
  saveTimers();
  return true;
}

/** Reminders from a previous run: the ones still to come, and the ones missed. */
function restoreTimers(now) {
  const { late, pending } = reminders.load(readJson('timers.json'), now);
  for (const item of pending) startTimer(item, item.at);
  saveTimers(); // whatever was dropped as malformed or stale goes now

  // Staggered, because one bubble replaces the last: five at once would show you
  // the fifth and nothing else.
  late.forEach((item, i) => setTimeout(() => ring(item.say, true), 2500 + i * 5000));
}

// How each outcome of an apology sounds. `none` has no bank because the skill's
// own wording is right there: there was nothing to forgive, and inventing a
// grievance so the pet has something to forgive would be the joke inverted.
const APOLOGY = {
  none: { bank: null, event: null },
  early: { bank: 'rushed', event: 'rushed' },
  again: { bank: 'demand', event: 'demand' },
  done: { bank: 'forgiven', event: 'forgiven' },
};

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

  // Same shape as the weather below it: skills.js gives the honest refusal, and
  // switching the setting on is what replaces it. What goes out is the words you
  // typed after "look up", redacted first - a query is your own text, but a
  // pasted key is text too. See net.js.
  if (skill.lookup && settings.network && settings.web) {
    send('pet:say', { text: 'thinking', kind: 'thinking' });
    net.lookup(redact(skill.lookup))
      .then((line) => send('pet:say', { text: line, kind: 'answer', expr: 'proud' }))
      .catch((err) => send('pet:say', {
        text: err.message, kind: 'error', expr: pets.expressionFor('error'),
      }));
    return true;
  }

  // The refusal in skills.js is the default answer. Switching the setting on is
  // what replaces it - and the request that goes out carries the town you typed
  // and nothing else. See weather.js.
  if (skill.weather && settings.weather && settings.city) {
    send('pet:say', { text: 'thinking', kind: 'thinking' });
    weather.forecast(settings.city)
      .then((line) => send('pet:say', { text: line, kind: 'answer', expr: 'happy' }))
      .catch((err) => send('pet:say', {
        text: err.message, kind: 'error', expr: pets.expressionFor('error'),
      }));
    return true;
  }

  // The three commands that write, read back or empty memory.json. Gated here
  // rather than in skills.js for the same reason the camera is: a pure matcher
  // cannot see the settings and must not pretend it can.
  if (skill.memory) {
    if (!settings.memory) {
      send('pet:say', {
        text: 'I am not keeping notes! switch my memory on in settings and tell me again',
        kind: 'chat',
        expr: 'curious',
      });
      return true;
    }
    const now = Date.now();
    if (skill.memory.list) {
      send('pet:say', { text: memory.listing(mem), kind: 'chat', expr: 'proud' });
      return true;
    }
    if ('forget' in skill.memory) {
      const { mem: next, gone } = memory.forget(mem, skill.memory.forget);
      mem = next;
      saveMem();
      // "forget everything" has to mean everything, including the screen it
      // still has in hand for follow-up questions. A pet that says it forgot
      // and then quotes your screen back has not.
      if (!skill.memory.forget) lastScreen = null;
      send('pet:say', {
        // Said honestly: "Forgotten" when nothing matched is the pet agreeing to
        // something it did not do, and you would never find out.
        text: gone ? skill.say : 'I did not have anything about that',
        kind: 'chat',
        expr: gone ? skill.expr : 'curious',
      });
      return true;
    }
    const { mem: next, fact } = memory.remember(mem, skill.memory.text, now, skill.memory.hour);
    mem = next;
    saveMem();
    // Normally the skill's own wording, which also reads back the hour it picked
    // out. When redaction or cleaning changed the text, what was actually stored
    // is echoed instead - a password you told it to remember should visibly come
    // back as [REDACTED] rather than be quietly altered in a file you never open.
    const changed = fact && fact.text !== String(skill.memory.text || '').trim();
    send('pet:say', {
      text: !fact ? 'there was nothing in that to remember'
        : changed ? `Noted, with a bit taken out: ${fact.text}`
        : skill.say,
      kind: 'chat',
      expr: fact ? skill.expr : 'curious',
    });
    return true;
  }

  // You said sorry. How that lands depends on how cross the pet actually is,
  // which skills.js cannot see - it only knows an apology was made.
  if (skill.apology) {
    const { state: next, kind } = pets.apologise(state, Date.now());
    state = next;
    savePet();
    pushState();
    const { bank, event } = APOLOGY[kind];
    send('pet:say', {
      text: bank ? pets.line(bank, lineIndex++, settings.pet) : skill.say,
      kind: 'chat',
      expr: bank ? pets.expressionFor(event) : skill.expr,
      chatter: !!bank,
    });
    return true;
  }

  // Naming a rival, or calling it useless. It answers, and it files it.
  if (skill.offend) {
    state = pets.offend(state, Date.now(), skill.offend);
    savePet();
    pushState();
  }

  // The banter skills point at a bank instead of carrying their own words, so
  // the pet's voice - and its per species variations - stay in one file.
  if (skill.bank) {
    send('pet:say', {
      text: pets.line(skill.bank, lineIndex++, settings.pet),
      kind: 'chat',
      expr: pets.expressionFor(skill.event),
      move: skill.move,
      chatter: true,
    });
    // Same beat as praise: say the thing, then be visibly embarrassed about it.
    if (skill.follow) {
      setTimeout(() => send('pet:say', {
        text: pets.line(skill.follow.bank, lineIndex++, settings.pet),
        kind: 'chat',
        expr: pets.expressionFor(skill.follow.event),
        chatter: true,
      }), 3200);
    }
    return true;
  }

  // Not through talk(): these are answers to something you asked for, and the
  // wording comes from skills.js rather than the line bank.
  send('pet:say', { text: skill.say, kind: 'chat', expr: skill.expr, move: skill.move });
  // Dancing to whatever is actually playing needs the microphone, so it opens
  // for the length of the dance and shuts again - unless "bop along" already
  // holds it, in which case this changes nothing. Without the microphone the
  // pet dances on its own, which is what it always did.
  if (skill.move === 'dance' && settings.mic) send('pet:dance', DANCE_MS);
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
  // Before the skills, not after: "set a timer" is still you talking to it, and a
  // habit built only from the messages a small model happened to answer would be
  // a habit about the model rather than about you.
  noteEvent('chat');
  // You spoke to it, so it is not being ignored. No line for it here: the answer
  // you are waiting for is the reaction, and a "you are back!" in front of it
  // would just be the pet talking over itself.
  attention();
  if (runSkill(text)) return;
  // Both out here for the same reasons they are in readScreen: the probe below
  // awaits, so the guard at the top has to be closed before it, and the finally
  // has to be able to stop a streamer that a thrown failure jumped over.
  let onToken = null;
  busy = true;
  try {
    // After the skills, not before: timers, faces, memory, music and the rest of
    // skills.js are the pet's own and never needed a model, so a machine with no
    // Ollama still has a pet that does most of what you ask it.
    if (!brainReady && !(await probeBrain()) && sayNoBrain()) return;
    send('pet:say', { text: 'thinking', kind: 'thinking' });
    onToken = providers.isLocal(settings.provider) && !process.env.SCREENPET_SMOKE
      ? streamer() : null;
    const reply = await chat(text, {
      ...(await llm()),
      mood: pets.mood(state, { asleep: asleep() }),
      onToken,
      history,
      screen: screenContext(),
      // Only the facts you asked it to remember, and only the ones sharing a
      // word with what you just said. On the default settings that goes to
      // Ollama on loopback; with a hosted provider chosen, it goes there.
      memory: settings.memory ? memory.brief(mem, text, Date.now()) : [],
      // What you called it, if you called it anything. Never leaves the machine
      // on the default settings, and goes wherever the question goes on a
      // hosted provider - it is in the prompt, not a separate field.
      name: settings.name,
    });
    history.push({ you: text, pet: reply });
    if (history.length > HISTORY_TURNS) history.shift();
    talk(null, { text: reply, event: replies++ % 2 ? 'wink' : 'chat' });
  } catch (err) {
    send('pet:say', { text: err.message, kind: 'error', expr: pets.expressionFor('error') });
  } finally {
    if (onToken) onToken.stop();
    busy = false;
  }
}

/**
 * Which recogniser hears you. 'auto' looks rather than demands, because whisper
 * is a file the user puts there and not something this app installs.
 *
 * @returns {'sapi'|'whisper'|'missing'} 'missing' is whisper asked for by name
 *   and not present, which is worth saying out loud rather than silently
 *   falling back to the recogniser they chose to move away from.
 */
function recogniser() {
  const have = dictate.installed(app.getPath('userData'));
  // Windows' own recogniser is a Windows capability. Asking for it on a host
  // that has none has to answer 'missing' rather than fall through to it, or
  // the pet spends its life saying it did not catch that.
  const sapi = host.supports('listen');
  if (settings.dictation === 'sapi') return sapi ? 'sapi' : 'missing';
  if (settings.dictation === 'local') return have ? 'local' : 'missing';
  return have ? 'local' : (sapi ? 'sapi' : 'missing');
}

// Only the renderer can open a microphone, so main asks it for one phrase and
// waits. One at a time, which `listening` already guarantees - this holds the
// resolver for the request in flight and nothing else.
let pendingAudio = null;

function recordPhrase() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAudio = null;
      resolve(null);
    }, RECORD_TIMEOUT_MS);
    pendingAudio = (buf) => {
      clearTimeout(timer);
      pendingAudio = null;
      resolve(buf);
    };
    send('pet:record');
  });
}

// Audio only ever crosses this bridge in answer to a request main just made.
// Unasked-for audio is dropped rather than transcribed - the renderer has no
// business starting a recording on its own, and if it ever does, this is where
// that stops being true quietly.
ipcMain.on('pet:audio', (_e, buf) => {
  if (!pendingAudio) return;
  pendingAudio(buf && buf.byteLength ? Buffer.from(buf) : null);
});

/**
 * Push to talk. The microphone opens when you ask it to and shuts as soon as
 * you stop speaking - there is no wake word and no listening loop, because a
 * pet that is always listening is a microphone with a face on it.
 */
async function listenAndReply() {
  if (busy || listening || !settings.mic) return;
  const engine = recogniser();
  if (engine === 'missing') {
    return send('pet:say', {
      text: `I have no dictation engine. Put ${dictate.ENGINES.map((e) => `${e.exe} + ${e.model}`).join('\nor ')}\nin ${path.join(app.getPath('userData'), dictate.DIR)}`,
      kind: 'error',
      expr: pets.expressionFor('error'),
    });
  }
  listening = true;
  // Said directly rather than through talk(): the user needs to see that the
  // microphone is open, and the smoke check silences talk().
  send('pet:say', {
    text: pets.line('listening', lineIndex++, settings.pet),
    kind: 'chat',
    expr: pets.expressionFor('listen'),
    chatter: true,
  });
  try {
    // Two engines, one contract: a string, empty if nothing was said. Whisper
    // needs the audio handed to it; System.Speech opens the microphone itself.
    // Silence is answered the same way on both paths - the recorder declines to
    // send audio it measured as silent, because whisper has no confidence score
    // to gate on and will cheerfully transcribe a quiet room as "you".
    const wav = engine === 'local' ? await recordPhrase() : null;
    const heard = engine === 'local'
      ? (wav ? await dictate.transcribe(wav, { userData: app.getPath('userData') }) : '')
      : await listen();
    if (!heard) {
      return send('pet:say', {
        text: pets.line('deaf', lineIndex++, settings.pet),
        kind: 'chat',
        expr: pets.expressionFor('curious'),
        chatter: true,
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

// The microphone is held open for as long as this is on, which is why it is the
// one setting that also lights the same green dot the camera does. Restarted
// rather than left running when settings change, so switching the microphone off
// takes the wake word down with it.
function applyWake() {
  wake.stop();
  if (!settings.wake) return;

  wake.start((event) => {
    if (event === 'woke') listenAndReply();
    else if (event.startsWith('error:')) {
      console.error(event);
      send('pet:say', {
        text: `my ears gave out - ${event.slice(7)}`,
        kind: 'error',
        expr: pets.expressionFor('error'),
      });
    }
  });
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
    wear: settings.wear,
    voice: settings.voice,
    sounds: settings.sounds,
    mic: settings.mic,
    camera: settings.camera,
    faces: settings.faces,
    bop: settings.bop,
    mischief: settings.mischief,
    // Lights a dot on the pet for as long as this is on. The camera has one for
    // the same reason: something is being read, and the app that is doing the
    // reading is the one that should say so.
    watching: settings.watch,
  });
}

async function applySettings() {
  applyHotkey();
  applyAutostart();
  applyWake();
  sendLook();
  refreshTray(); // the mute state is shown there
  visionModel = await resolveVision();
  await probeBrain();
}

/** The one way settings change, wherever the change came from. */
async function saveSettings(patch) {
  const remembered = settings.memory;
  const watched = settings.watch;
  const named = settings.name;
  settings = config.merge(settings, patch);
  // Switching it off drops what it read. Nothing here was ever written down, but
  // "off" has to mean the process is not still holding the last screen it took
  // on its own - and it means the first read after switching it back on is
  // treated as a new screen, which it is.
  if (watched && !settings.watch) {
    lastWatched = '';
    lastWatchSaid = '';
  }
  // Off means gone. A memory you can only pause is one that quietly keeps the
  // file, and the file is the whole thing anyone would object to.
  if (remembered && !settings.memory) {
    clearTimeout(memTimer);
    mem = memory.fresh(Date.now());
    dropJson('memory.json');
    // Same rule as forgetting everything: switching memory off must not leave
    // the last screen sitting in this process ready to be quoted back.
    lastScreen = null;
  }
  // Named, or renamed. Worth one line out loud: a name typed into a settings
  // window and silently accepted is a form field, and a pet that answers to it a
  // second later is a pet. Goes through talk() like everything else it says off
  // its own bat, so do not disturb still silences it.
  if (settings.name && settings.name !== named) {
    talk(null, { text: `${settings.name}. I like that.`, event: 'chat' });
  }
  writeJson('settings.json', settings);
  await applySettings();
  return settings;
}

// ---- wiring -----------------------------------------------------------------

app.whenReady().then(async () => {
  settings = config.load(readJson('settings.json'));
  state = pets.load(readJson('pet.json'), Date.now());
  // Loaded before seen() runs, so the gap since the last run is still visible -
  // that is what "you were gone three days" is measured from.
  mem = memory.load(settings.memory ? readJson('memory.json') : null, Date.now());
  // Wrapped blobs only. Nothing is unwrapped until something actually needs a
  // key, and never at all on the default local-only settings.
  keyStore = readJson('keys.json') || {};

  // Before any window exists, so nothing can ask for anything in the gap.
  lockPermissions();

  // Awaited exactly once, here, and polled in the background from then on. The
  // 750ms is worth paying at launch: without it the greeting goes out before the
  // first answer comes back, which is precisely the interruption this prevents.
  quiet = await dnd.quiet();

  createWindow();
  createTray();

  // One process for the whole session, started with the pet and killed with it.
  // Not during the smoke check, which leaves through app.exit and would leave it
  // running behind. The first thing it prints is the window you were already in:
  // worth a glance, not worth leaning over for on top of the greeting.
  if (!process.env.SCREENPET_SMOKE) {
    lastPeekAt = Date.now();
    windows.watch(noticed);
  }

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
    // immediately chatters because lastChatAt is still zero. The break clock
    // starts here for the same reason, and with more at stake: at zero the first
    // tick is overdue by fifty-five years and covers the screen on launch.
    state.lastChatAt = Date.now();
    lastBreakAt = Date.now();
    lastWatchAt = Date.now();
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
  // Touching it counts as answering it, even if you say nothing. Read before
  // the action, because act() returns a fresh object and would drop the clear.
  const missed = attention();
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
    // The one thing it holds against you, and it is a number. Recorded on the
    // step into tears rather than every poke after it, so one long bout counts
    // once however long you keep going.
    if (event === 'upset' && pets.pokeStep(pokes - 1).event !== 'upset') {
      if (settings.memory) {
        mem = memory.upset(mem);
        saveMem();
      }
      // ...and it wants apologising to, which is a different thing from the
      // count above: the grudge clears when you say sorry, the count never does.
      // In pet.json rather than memory.json, so this works with memory off.
      state = pets.offend(state, now, 2);
    }
    talk(kind, { event, tone: pokes >= 3 ? 'nag' : 'chat' });
  } else if (result.ok) {
    noteEvent('care');
    // A bond milestone outranks the usual line - it only happens four times.
    const reached = pets.milestone(before, state.bond);
    // ...and coming back after it had given up outranks the everyday reaction.
    // Said once, because the count is cleared: the pet is pleased, not owed.
    if (missed && !reached) talk('relieved', { event: 'relieved' });
    else talk(SAID[name], { event: reached ? 'milestone' : name, text: reached });
  } else if (REFUSED[name] && result.reason !== 'not yet') {
    talk(REFUSED[name], { event: 'refuse', tone: 'nag' });
  }
  savePet();
});

ipcMain.on('pet:react', (_e, event) => {
  if (event === 'drag') talk('dragged', { event: 'drag' });
});

// Picked up and put down somewhere. Clamped by pets.place rather than trusted:
// this arrives from the renderer, and a position off the display is a pet you
// cannot get back.
ipcMain.on('pet:place', (_e, at) => {
  const place = pets.place(at);
  if (!place) return;
  state = { ...state, place };
  savePet();
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

// One frame, at the moment somebody arrived, with the setting on. It goes down a
// pipe to Windows' own face detector and is never written anywhere; what comes
// back is a count. Windows.Media.FaceAnalysis has no identify and no compare, so
// there is no version of this that knows who it is looking at - which is why the
// pet says "there you are" and not your name.
ipcMain.on('pet:face-check', (_e, dataUrl) => {
  if (!settings.faces) return; // the renderer should not have asked; refuse anyway
  faces.count(dataUrl).then(
    (n) => talk(n > 0 ? 'arrived' : 'moved', {
      event: n > 0 ? 'arrived' : 'curious',
      move: n > 0 ? 'jump' : null,
    }),
    // A failed check is still someone arriving. Falling back to the motion line
    // is better than a red bubble about PowerShell.
    () => talk('arrived', { event: 'arrived', move: 'jump' })
  );
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

// A line of speech as audio, for the filter chain in robot.js. Gated on the
// voice setting here as well as in the renderer: the switch that silences the
// pet must also stop a speech engine being started to be ignored.
//
// null is the ordinary answer on a host without it, and the renderer falls back
// to the platform voice. Nothing is stored and nothing touches disk - see
// say.ps1, which synthesises to a buffer for that reason.
// The rate comes from the renderer because robot.js is where the pairing lives:
// the line is synthesised slow and played back fast, and one of those two
// numbers moving on its own is a pet talking at the wrong speed. voice.js and
// say.ps1 both clamp it, so it is a preference here rather than a trusted value.
ipcMain.handle('pet:voice', async (_e, text, rate) => {
  if (!settings.voice) return null;
  return voice.say(String(text || ''), Number(rate) || 0);
});

ipcMain.on('pet:ask', answerScreen);
ipcMain.on('pet:settings', openSettings);
ipcMain.on('pet:quit', () => { quitting = true; app.quit(); });

ipcMain.handle('config:get', async () => ({
  settings,
  skins: config.SKINS,
  pets: config.PETS,
  wear: config.WEAR,
  models: await listModels({ endpoint: endpoint() }),
  visionModel,
  packaged: app.isPackaged,
  version: app.getVersion(),
  // Whether anything can answer at all. The settings window says which of "no
  // model installed" and "Ollama is not running" it is looking at, and says it
  // without calling either one a failure.
  brain: brainReady,
  // What this machine can actually do. A switch for a capability the host does
  // not have is worse than no switch: it reads as a promise and then does
  // nothing. The settings window disables those and says why.
  capabilities: host.report(),
  providers: Object.entries(providers.PROVIDERS).map(([name, spec]) => ({
    name, label: spec.label, local: spec.local === true, model: spec.model || '', keys: spec.keys || '',
  })),
  // Booleans. There is no channel that returns a key, and this is the only thing
  // the settings window is ever told about them.
  keys: keys.present(keyStore),
}));

/**
 * Store an API key. One way: it goes in, it is wrapped, and nothing hands it
 * back - not to this window, not to any other.
 */
ipcMain.handle('keys:set', async (_e, provider, key) => {
  if (!providers.needsKey(provider)) return { ok: false, why: 'that provider takes no key' };
  try {
    keyStore = { ...keyStore, [provider]: await keys.protect(key) };
    writeJson('keys.json', keyStore);
    keys.drop(provider); // the cached one is now the old one
    return { ok: true, keys: keys.present(keyStore) };
  } catch (err) {
    return { ok: false, why: err.message };
  }
});

ipcMain.handle('keys:clear', async (_e, provider) => {
  const next = { ...keyStore };
  delete next[provider];
  keyStore = next;
  writeJson('keys.json', keyStore);
  keys.drop(provider);
  return { ok: true, keys: keys.present(keyStore) };
});

/**
 * Is there a newer one? Pressed, never scheduled - see update.js for what the
 * request carries, which is nothing about this machine.
 */
ipcMain.handle('update:check', async () => {
  try {
    return await update.check();
  } catch (err) {
    return { state: 'error', why: err.message, version: app.getVersion() };
  }
});

/**
 * Download it, check it against the release manifest, and replace this copy.
 * Only resolves when it did not happen: on success the app is already on its
 * way out and there is nobody left to answer.
 */
ipcMain.handle('update:install', async () => {
  try {
    await update.install((percent) => {
      if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.webContents.send('update:progress', percent);
      }
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, why: err.message };
  }
});

ipcMain.handle('config:save', async (_e, patch) => ({
  settings: await saveSettings(patch),
  visionModel,
}));

ipcMain.on('config:close', () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  wake.stop(); // the microphone closes before anything else happens
  windows.unwatch();
  voice.stop();
  endBreak();
  // The timeouts go; the file stays. That is the whole point of the file.
  for (const id of timers.keys()) clearTimeout(id);
  clearTimeout(saveTimer);
  clearTimeout(memTimer);
  writeJson('pet.json', state);
  if (settings.memory) writeJson('memory.json', mem);
});

// Desktop pet: closing a window is not the same as quitting. The tray is the
// way out, so the app stays alive with no windows open.
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
