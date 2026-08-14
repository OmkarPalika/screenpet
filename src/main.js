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
const media = require('./system/media');
const dnd = require('./system/dnd');
const reminders = require('./core/reminders');
const weather = require('./core/weather');
const wake = require('./system/wake');
const faces = require('./system/faces');
const memory = require('./core/memory');
const net = require('./core/net');
const providers = require('./core/providers');
const keys = require('./system/keys');
const {
  ask, askVision, chat, detectVisionModel, listModels, hasEnoughText, redact,
} = require('./core/brain');
const pets = require('./core/pet-state');
const skills = require('./core/skills');
const config = require('./core/settings');

// Outside src/, but still inside the asar - Electron's patched fs reads it from
// in there, so unlike the PowerShell scripts an icon needs no asarUnpack.
const ASSETS = path.join(__dirname, '..', 'assets');

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
    height: 940,
    resizable: false,
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
  send('pet:say', { text: said, kind: tone, expr: pets.expressionFor(event), move });
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
  // The hour, and nothing else. Not what was on the screen, not what was asked.
  noteEvent('ask');
  attention();
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

    const where = await llm();
    const answer = useVision
      ? await askVision(png.toString('base64'), {
          ...where, mood, model: visionModel, timeoutMs: VISION_TIMEOUT_MS,
        })
      : await ask(ocrText, { ...where, mood });

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
    });
    // Same beat as praise: say the thing, then be visibly embarrassed about it.
    if (skill.follow) {
      setTimeout(() => send('pet:say', {
        text: pets.line(skill.follow.bank, lineIndex++, settings.pet),
        kind: 'chat',
        expr: pets.expressionFor(skill.follow.event),
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
  busy = true;
  send('pet:say', { text: 'thinking', kind: 'thinking' });
  try {
    const reply = await chat(text, {
      ...(await llm()),
      mood: pets.mood(state, { asleep: asleep() }),
      history,
      // Only the facts you asked it to remember, and only the ones sharing a
      // word with what you just said. On the default settings that goes to
      // Ollama on loopback; with a hosted provider chosen, it goes there.
      memory: settings.memory ? memory.brief(mem, text, Date.now()) : [],
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
 * Which recogniser hears you. 'auto' looks rather than demands, because whisper
 * is a file the user puts there and not something this app installs.
 *
 * @returns {'sapi'|'whisper'|'missing'} 'missing' is whisper asked for by name
 *   and not present, which is worth saying out loud rather than silently
 *   falling back to the recogniser they chose to move away from.
 */
function recogniser() {
  if (settings.dictation === 'sapi') return 'sapi';
  const have = dictate.installed(app.getPath('userData'));
  if (settings.dictation === 'local') return have ? 'local' : 'missing';
  return have ? 'local' : 'sapi';
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
  });
}

async function applySettings() {
  applyHotkey();
  applyAutostart();
  applyWake();
  sendLook();
  refreshTray(); // the mute state is shown there
  visionModel = await resolveVision();
}

/** The one way settings change, wherever the change came from. */
async function saveSettings(patch) {
  const remembered = settings.memory;
  settings = config.merge(settings, patch);
  // Off means gone. A memory you can only pause is one that quietly keeps the
  // file, and the file is the whole thing anyone would object to.
  if (remembered && !settings.memory) {
    clearTimeout(memTimer);
    mem = memory.fresh(Date.now());
    dropJson('memory.json');
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
