'use strict';

const stage = document.getElementById('stage');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const menu = document.getElementById('menu');
const fx = document.getElementById('fx');
const chatForm = document.getElementById('chat');
const chatInput = document.getElementById('chat-input');
// Not `pet`: contextBridge already exposes a global by that name, and a
// top-level const of the same name is a parse error that kills this whole file.
const petEl = document.getElementById('pet');

let hideTimer = null;
let exprTimer = null;
let hovered = false;
let interactive = false;
let busy = false; // thinking - hold still and stop wandering

// ---- speech --------------------------------------------------------------

function say(text, { kind = 'answer', sticky = false } = {}) {
  clearTimeout(hideTimer);
  bubbleText.textContent = text;
  bubble.classList.toggle('is-error', kind === 'error');
  bubble.classList.toggle('is-nag', kind === 'nag');
  bubble.classList.toggle('is-chat', kind === 'chat');
  bubbleText.classList.toggle('dots', kind === 'thinking');
  bubble.hidden = false;
  bubbleText.scrollTop = 0;
  if (sticky) return;
  // Roughly reading time, floored at 8s and capped at a minute.
  const ms = Math.min(60000, Math.max(8000, text.length * 55));
  hideTimer = setTimeout(() => { bubble.hidden = true; }, ms);
}

// ---- expressions ---------------------------------------------------------
// A reaction laid over the mood, then cleared. Only one at a time, on purpose:
// two faces fighting over the same 40 pixels reads as a glitch, not a feeling.

// What falls out of the sky for each feeling. Expressions with nothing here -
// smile, hmm, oh - get no rain, which is what keeps it from becoming wallpaper:
// the pet reacts to the cursor constantly and confetti every time would be
// exhausting.
// Each feeling has more than one way of showing up, picked at random per burst.
// The same five hearts every single headpat stops being a reaction and becomes
// a loading spinner, so the happy end gets confetti and party poppers some of
// the time instead of flowers.
const EMOJI = {
  love:    [['💕', '💖', '💗'], ['💘', '💞'], ['🎀', '💕', '🌷']],
  shy:     [['🌸', '💗'], ['🎀', '🌷'], ['✨', '🌸']],
  giggle:  [['😆', '💫'], ['🎉', '😆'], ['🍬', '💫']],
  proud:   [['✨', '⭐'], ['🎊', '✨'], ['🏆', '✨']],
  joy:     [['🎉', '🎊', '✨'], ['🎉', '🥳', '🎊'], ['🍾', '🎉', '🌟'], ['🎆', '✨', '🎉']],
  yum:     [['🍪', '✨'], ['🍰', '💕'], ['🍓', '✨']],
  annoyed: [['💢']],
  rage:    [['💢', '🔥'], ['💢', '⚡']],
  cry:     [['💧', '💔'], ['💧', '🥺']],
  sulk:    [['💧'], ['🌧️']],
  curious: [['❓'], ['❔', '💭'], ['💭']],
  wink:    [['✨'], ['💫'], ['⭐']],
  doze:    [['💤'], ['💤', '🌙']],
  // 'listen' and 'oops' deliberately rain nothing. The microphone is open for
  // several seconds and confetti the whole time would be a strobe; an error is
  // not something to decorate.

  // The rest of the keyboard. Four of them rain nothing on purpose: eyeroll,
  // deadpan, grimace and shush are all faces whose whole joke is that nothing
  // is happening, and decorating them takes the joke away.
  wistful:    [['💭'], ['🌧️'], ['💧', '💭']],
  smug:       [['😏'], ['💅'], ['✨', '😏']],
  cool:       [['😎'], ['🕶️', '✨'], ['🔥', '😎']],
  pleading:   [['🥺'], ['🥺', '💧'], ['🙏', '🥺']],
  huff:       [['💢'], ['💨', '💢']],
  flushed:    [['🌸', '💗'], ['💗', '💦'], ['🫣', '🌸']],
  shock:      [['❗', '😱'], ['⚡', '❗'], ['💥', '😱']],
  melt:       [['🫠'], ['💗', '🫠'], ['💫']],
  starstruck: [['🤩', '⭐'], ['✨', '🌟'], ['💫', '🤩']],
  mischief:   [['😈'], ['😈', '🔥'], ['💣', '😈']],
  queasy:     [['🤢'], ['🤢', '💚']],
  mindblown:  [['🤯', '💥'], ['💥', '⚡'], ['🎆', '🤯']],
  innocent:   [['😇', '✨'], ['🕊️', '✨'], ['⭐', '😇']],
  wry:        [['🙃'], ['🙃', '💫']],
  hug:        [['🤗', '💞'], ['💕', '🤗'], ['🧸', '💞']],
};

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (sets) => sets[Math.floor(Math.random() * sets.length)];

/** Drop a handful of `chars` in from above the pet's head. */
function rain(chars, count = 5) {
  // One feeling at a time, same rule the face follows. Without this a fast poke
  // sequence leaves hearts still falling through the tantrum.
  fx.replaceChildren();
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'drop';
    el.textContent = chars[i % chars.length];
    // CSSOM setters rather than a style attribute: the CSP is style-src 'self',
    // which permits these and blocks the attribute.
    el.style.left = `${rand(4, 96).toFixed(0)}px`;
    el.style.setProperty('--fall', `${rand(38, 76).toFixed(0)}px`);
    el.style.animationDelay = `${(i * rand(70, 130)).toFixed(0)}ms`;
    el.style.fontSize = `${rand(12, 19).toFixed(0)}px`;
    fx.append(el);
    setTimeout(() => el.remove(), 2600);
  }
}

function express(name, ms = 2600) {
  clearTimeout(exprTimer);
  if (!name) { delete petEl.dataset.expr; return; }
  // Re-triggering the same expression should re-run its animations, otherwise a
  // second poke while the first is still showing changes nothing on screen.
  delete petEl.dataset.expr;
  void petEl.offsetWidth;
  petEl.dataset.expr = name;
  if (EMOJI[name]) rain(pick(EMOJI[name]), name === 'rage' || name === 'joy' ? 7 : 5);
  exprTimer = setTimeout(() => { delete petEl.dataset.expr; }, ms);
}

// ---- speaking out loud ---------------------------------------------------
// Windows' own voices, through the platform synthesiser. localService is the
// filter that keeps this honest: a voice the platform would render over a
// network is not eligible, whatever else is installed. Nothing said here is
// uploaded, because nothing said here leaves SAPI.

let voiceOn = false;
let voice = null;
let utter = null;

function pickVoice() {
  const local = speechSynthesis.getVoices().filter((v) => v.localService);
  const lang = navigator.language.slice(0, 2);
  voice = local.find((v) => v.lang.startsWith(lang)) || local[0] || null;
}

// getVoices() is empty until the platform has enumerated them, and how long that
// takes is not defined anywhere.
speechSynthesis.addEventListener('voiceschanged', pickVoice);
pickVoice();

/** Strip what reads badly out loud: emoji names, and stage directions. */
const speakable = (text) =>
  text.replace(/\p{Extended_Pictographic}/gu, '').replace(/\*/g, '').trim();

function speak(text, kind) {
  // Cancel unconditionally, even when muted - the toggle has to stop a line
  // that is already halfway out.
  speechSynthesis.cancel();
  if (!voiceOn || !voice || kind === 'thinking') return;

  const line = speakable(text);
  if (!line) return;

  const u = new SpeechSynthesisUtterance(line);
  utter = u;
  u.voice = voice;
  u.rate = 1.05;
  u.pitch = 1.4; // small creature, not a narrator
  u.onstart = () => petEl.classList.add('is-talking');
  // Only the current utterance may stop the mouth: cancel() settles the old one
  // after the new one has already started, and it would clear the wrong class.
  const done = () => { if (utter === u) petEl.classList.remove('is-talking'); };
  u.onend = done;
  u.onerror = done;
  speechSynthesis.speak(u);
}

// ---- little noises -------------------------------------------------------
// A woof, a meow, a chirp. Synthesised in voices.js from the species and the
// face, so there is no audio to ship and nothing to load before the pet can
// make a sound.
//
// Its own AudioContext rather than the beat listener's: that one is opened and
// closed with the microphone, and whether the pet can bark should not depend on
// whether anything is listening.

let soundsOn = false;
let sfx = null;

function bark(expr) {
  if (!soundsOn) return;
  if (!sfx) sfx = new AudioContext();
  // Chromium can hand back a suspended context. Without this the first noises
  // are scheduled against a clock that is not running, and never arrive.
  if (sfx.state === 'suspended') sfx.resume();
  sound(sfx, document.documentElement.dataset.pet || 'blob', expr);
}

// ---- body movements ------------------------------------------------------
// The face is an expression on .pet; this is the body, on the svg inside it.
// Separate elements on purpose - see the note in style.css. A movement plays
// under any face, so the pet can lose at rock-paper-scissors, sulk about it and
// fall over all at once.

// How long each one runs, so the attribute comes off when the animation ends
// rather than at some guessed constant.
const MOVE_MS = { walk: 2600, dance: 2600, spin: 1240, jump: 1040, topple: 2400, peek: 2200 };
const MOVES = Object.keys(MOVE_MS);

let moveTimer = null;

function move(name) {
  clearTimeout(moveTimer);
  if (!MOVE_MS[name]) { delete petEl.dataset.move; return; }
  // Same restart trick the expressions use: asking for the movement it is
  // already doing has to visibly do something.
  delete petEl.dataset.move;
  void petEl.offsetWidth;
  petEl.dataset.move = name;
  moveTimer = setTimeout(() => { delete petEl.dataset.move; }, MOVE_MS[name]);
}

window.pet.onSay(({ text, kind, expr, move: movement }) => {
  busy = kind === 'thinking';
  petEl.classList.toggle('is-thinking', busy);
  // Thinking holds its face until the answer lands, so no timeout on it.
  if (busy) express('hmm', 600000);
  else express(expr || null, Math.min(20000, Math.max(2600, text.length * 55)));
  if (movement) move(movement);
  say(text, { kind, sticky: busy });
  // The noise first, then the words: a pet that woofs halfway through its own
  // sentence is two things talking over each other. Nothing while thinking -
  // that face is held until the answer lands, and a bark every few seconds of it
  // would be a progress bar with teeth.
  if (!busy) bark(expr);
  speak(text, kind);
});

// A bubble in the way is a bubble you want gone - and so is the sentence still
// being read out of it.
bubble.addEventListener('click', () => {
  if (busy) return;
  bubble.hidden = true;
  speechSynthesis.cancel();
});

// ---- stats ---------------------------------------------------------------

window.pet.onStats((s) => {
  petEl.dataset.mood = s.mood;
  for (const el of document.querySelectorAll('[data-bar]')) {
    el.style.width = `${Math.round(s[el.dataset.bar])}%`;
  }
  if (s.acted) {
    // is-idling too: a quirk already in flight outranks the action animation on
    // species whose idle rule is the more specific one.
    petEl.classList.remove('is-eating', 'is-playing', 'is-tickled', 'is-idling');
    void petEl.offsetWidth; // restart the animation
    if (s.acted === 'feed') petEl.classList.add('is-eating');
    if (s.acted === 'play') petEl.classList.add('is-playing');
    if (s.acted === 'tickle') petEl.classList.add('is-tickled');
  }
  refreshMenu(s);
});

function refreshMenu(s) {
  menu.querySelector('[data-act="feed"]').disabled = s.fullness >= 92;
  menu.querySelector('[data-act="play"]').disabled = s.energy < 20;
}

// ---- hit testing ---------------------------------------------------------
// The window covers the whole bottom strip, so main keeps it click-through and
// we tell it when the cursor is actually over something clickable.

function hitZone() {
  const boxes = [petEl.getBoundingClientRect()];
  if (!menu.hidden) boxes.push(menu.getBoundingClientRect());
  if (!chatForm.hidden) boxes.push(chatForm.getBoundingClientRect());
  if (!bubble.hidden) boxes.push(bubble.getBoundingClientRect());
  return boxes;
}

function setInteractive(v) {
  if (v === interactive) return;
  interactive = v;
  window.pet.setInteractive(v);
}

// Eyes track the cursor anywhere on the strip, which costs nothing and is most
// of what makes the thing feel awake. Clamped small - a pupil that slides to the
// edge of the eye looks unwell rather than attentive.
function gaze(x, y) {
  const r = petEl.getBoundingClientRect();
  const dx = Math.max(-3, Math.min(3, (x - (r.left + r.width / 2)) / 26));
  const dy = Math.max(-2, Math.min(2, (y - (r.top + r.height / 2)) / 30));
  petEl.style.setProperty('--eye-x', `${dx.toFixed(2)}px`);
  petEl.style.setProperty('--eye-y', `${dy.toFixed(2)}px`);
}

document.addEventListener('mousemove', (e) => {
  gaze(e.clientX, e.clientY);
  if (held) return dragTo(e.clientX); // never hand focus back mid-drag

  const inside = hitZone().some(
    (b) => e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom
  );
  if (inside !== hovered) {
    hovered = inside;
    petEl.classList.toggle('is-hovered', inside);
    if (inside) express('smile', 1400);
  }
  setInteractive(inside);
});

// ---- interactions --------------------------------------------------------

// A double-click is two clicks first, so the headpat waits to find out whether
// a second one is coming. Without this, tickling always headpats on the way in
// and the second action comes back refused by its own cooldown.
let clickTimer = null;

petEl.addEventListener('click', () => {
  menu.hidden = true;
  if (dragged) return; // a drag ends in a click event; it is not a pat
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => window.pet.act('pet'), 220);
});

petEl.addEventListener('dblclick', () => {
  clearTimeout(clickTimer);
  window.pet.act('tickle');
});

petEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  menu.hidden = !menu.hidden;
  // The menu sits where the bubble does; showing both at once is a mess.
  if (!menu.hidden) {
    clearTimeout(hideTimer);
    bubble.hidden = true;
    openChat(false);
  }
});

menu.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  menu.hidden = true;
  if (btn.dataset.act) window.pet.act(btn.dataset.act);
  else if (btn.hasAttribute('data-talk')) openChat(true);
  else if (btn.hasAttribute('data-listen')) window.pet.listen();
  else if (btn.hasAttribute('data-ask')) window.pet.ask();
  else if (btn.hasAttribute('data-settings')) window.pet.settings();
  else if (btn.hasAttribute('data-quit')) window.pet.quit();
});

// ---- picking the pet up --------------------------------------------------

let held = null;   // { grabX, fromX } while the button is down
let dragged = false;

function dragTo(x) {
  if (!dragged && Math.abs(x - held.grabX) > 4) {
    dragged = true;
    petEl.classList.add('is-held');
    express('dizzy', 4000);
  }
  if (dragged) setX(held.fromX + (x - held.grabX));
}

petEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  held = { grabX: e.clientX, fromX: stageX };
  dragged = false;
  stage.classList.add('is-dragging');
});

document.addEventListener('mouseup', () => {
  if (!held) return;
  held = null;
  stage.classList.remove('is-dragging');
  petEl.classList.remove('is-held');
  if (dragged) window.pet.react('drag');
  // Cleared late so the click event that follows this mouseup can still see it.
  setTimeout(() => { dragged = false; }, 0);
});

// ---- chat ----------------------------------------------------------------
// The window is focusable:false so it never steals focus from real work, which
// also means it cannot receive typing. Main flips that only while this is open.

function openChat(open) {
  if (open === !chatForm.hidden) return;
  chatForm.hidden = !open;
  window.pet.chatOpen(open);
  if (open) {
    menu.hidden = true;
    chatInput.focus();
  }
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  chatInput.value = '';
  openChat(false);
  if (text) window.pet.chat(text);
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') openChat(false);
});

// How the pet looks and sounds. Species and palette hang off the root element:
// the shape rules in pets.css are plain descendant selectors, so they work
// anywhere they are set.
window.pet.onLook(({ pet, skin, voice: on, sounds, mic, camera, faces, bop }) => {
  document.documentElement.dataset.pet = pet;
  document.documentElement.dataset.skin = skin;
  voiceOn = !!on;
  soundsOn = !!sounds;
  if (!voiceOn) speechSynthesis.cancel();
  // No microphone, no button. An entry that only tells you the feature is off
  // is a worse answer than the entry not being there.
  menu.querySelector('[data-listen]').hidden = !mic;
  facesOn = !!faces;
  watchRoom(!!camera);
  listenForBeat(!!bop);
});

// ---- the room ------------------------------------------------------------
//
// Opt-in, off by default, and deliberately incapable of more than it needs.
// Frames are drawn to a 32x24 canvas - 768 pixels - reduced to a single number
// (how much changed since the last one) and thrown away. Nothing is stored,
// nothing is recognised, nothing is encoded, nothing is sent. It can tell that
// something moved in front of the laptop. It cannot tell who, and no amount of
// prompting will make it say, because the information is gone before anything
// else in this file can see it.
//
// Two exceptions, below, both of which need a setting switched on:
//
//   - asking for a photo out loud gets you a photo, saved to your Pictures
//     folder by main;
//   - with "tell a face from a curtain" on, one frame at the moment somebody
//     arrives goes to Windows' own face detector, which answers with a count.
//
// Those are the only paths by which a frame leaves this section, each runs once
// per event rather than on the tick, and neither goes anywhere near a network.
//
// ponytail: motion first, faces only to settle the question motion cannot -
// whether the thing that moved was a person. Motion is 30 lines and runs every
// 800ms; the face check is a second of PowerShell and runs when somebody
// arrives.

const camEl = document.getElementById('cam');
const camVideo = document.getElementById('cam-video');
const camCanvas = document.getElementById('cam-canvas');

const CAM_TICK_MS = 800;
// Mean absolute difference per pixel, 0..255. Below this is sensor noise and
// the light changing; a person shifting in a chair is comfortably above it.
const MOTION = 6;
// Quiet for this long and you have gone, rather than merely sitting still.
const GONE_MS = 120000;

let camStream = null;
let camTimer = null;
let camPrev = null;
let present = false;
let lastMotionAt = 0;
let facesOn = false;

function stopRoom() {
  clearInterval(camTimer);
  camTimer = null;
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null;
  camVideo.srcObject = null;
  camPrev = null;
  present = false;
  camEl.hidden = true;
}

function sampleRoom() {
  const c = camCanvas.getContext('2d', { willReadFrequently: true });
  c.drawImage(camVideo, 0, 0, camCanvas.width, camCanvas.height);
  const { data } = c.getImageData(0, 0, camCanvas.width, camCanvas.height);

  const frame = new Uint8Array(data.length / 4);
  for (let i = 0; i < frame.length; i++) {
    const p = i * 4;
    frame[i] = (data[p] + data[p + 1] + data[p + 2]) / 3;
  }

  if (camPrev) {
    let diff = 0;
    for (let i = 0; i < frame.length; i++) diff += Math.abs(frame[i] - camPrev[i]);
    diff /= frame.length;

    const now = Date.now();
    if (diff > MOTION) {
      lastMotionAt = now;
      if (!present) {
        present = true;
        // The face check answers a question motion cannot: whether the thing
        // that moved was a person or a door. Main gets the frame only with the
        // setting on, and gets a count back and nothing else.
        if (facesOn) window.pet.face(grabFrame(320, 240, 0.7));
        else window.pet.presence('arrived');
      }
    } else if (present && now - lastMotionAt > GONE_MS) {
      present = false;
      window.pet.presence('left');
    }
  }
  camPrev = frame;
}

async function watchRoom(on) {
  if (!on) return stopRoom();
  if (camStream) return;
  try {
    // 640x480 so a photo is worth keeping. Presence still samples into the 32x24
    // canvas - drawImage does the scaling - so the motion path is unchanged and
    // the extra pixels only exist for the shutter.
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: 5 },
    });
  } catch {
    // Denied at the OS or Windows level, or there is no camera. Not an error
    // worth a red bubble - the pet just cannot see, and says so once.
    camStream = null;
    window.pet.presence('blind');
    return;
  }
  camVideo.srcObject = camStream;
  await camVideo.play();
  camEl.hidden = false;
  lastMotionAt = Date.now();
  camTimer = setInterval(sampleRoom, CAM_TICK_MS);
}

/**
 * One frame, into a canvas made and dropped here. Not the 32x24 one: that canvas
 * is the motion path, and reusing it would mean either a useless photo or a
 * presence check reading a full-size frame.
 *
 * @param {number} w  0 for the stream's own size
 */
function grabFrame(w = 0, h = 0, quality = 0.9) {
  if (!camStream || !camVideo.videoWidth) return null;
  const shot = document.createElement('canvas');
  shot.width = w || camVideo.videoWidth;
  shot.height = h || camVideo.videoHeight;
  shot.getContext('2d').drawImage(camVideo, 0, 0, shot.width, shot.height);
  return shot.toDataURL('image/jpeg', quality);
}

window.pet.onPhoto(() => window.pet.photo(grabFrame()));

// ---- the beat --------------------------------------------------------------
//
// What reaches this code is a spectrum, forty times a second, and what leaves it
// is the word "beat". Nothing in between is kept: no buffer, no recording, no
// recognition. The microphone is not a second way of hearing you - a
// FFT bin count is incapable of being speech.
//
// Two ways in. "Dance" opens the microphone for the length of the dance and
// closes it; the "bop along" setting holds it open. Both need the microphone
// setting, which is the same consent dictation and the wake word run on.
//
// ponytail: energy against its own rolling average, not a tempo tracker. This
// has to answer "was that a drum" every 25ms on a machine already running a
// language model, and beat detection proper is a research project.

const FFT = 512;
const BEAT_GAP_MS = 300;      // two beats closer than this are one beat
const BEAT_RATIO = 1.35;      // this much above the running average is a hit
const QUIET = 0.02;           // below this the room is silent, not on the beat

let audioStream = null;
let audioCtx = null;
let beatRaf = 0;
let beatAvg = 0;
let lastBeatAt = 0;
let beatUntil = 0; // 0 means "for as long as the setting is on"

function stopBeat() {
  cancelAnimationFrame(beatRaf);
  beatRaf = 0;
  if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
  audioStream = null;
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  beatAvg = 0;
  if (!camStream) camEl.hidden = true; // the dot is shared with the camera
}

async function listenForBeat(on, forMs = 0) {
  if (!on) return stopBeat();
  beatUntil = forMs ? Date.now() + forMs : 0;
  if (audioStream) return;

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    audioStream = null;
    return; // no microphone, or refused. The pet dances on its own instead.
  }

  audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = FFT;
  audioCtx.createMediaStreamSource(audioStream).connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  camEl.hidden = false; // same green dot: something is listening

  const sample = () => {
    if (beatUntil && Date.now() > beatUntil) return stopBeat();
    analyser.getByteFrequencyData(bins);

    // Low end only. A drum lives below ~250Hz and a voice mostly does not, so
    // this is both the better beat signal and the half of the spectrum that
    // carries the least about what was said.
    let energy = 0;
    const low = Math.floor(bins.length / 8);
    for (let i = 0; i < low; i++) energy += bins[i];
    energy /= low * 255;

    const now = Date.now();
    if (energy > QUIET && energy > beatAvg * BEAT_RATIO && now - lastBeatAt > BEAT_GAP_MS) {
      lastBeatAt = now;
      // Moved here rather than reported to main: main has no use for it, and a
      // beat that never crosses the bridge is a beat nothing else can see.
      // Beats arriving mid-move are skipped rather than restarting it.
      if (!petEl.dataset.move) move('jump');
    }
    // Rolling average, weighted towards the past so one loud moment does not
    // become the new normal.
    beatAvg = beatAvg ? beatAvg * 0.9 + energy * 0.1 : energy;
    beatRaf = requestAnimationFrame(sample);
  };
  sample();
}

// A dance you asked for: the microphone opens for the length of it and shuts
// again. With "bop along" on it is already open, and this changes nothing.
window.pet.onDance((ms) => listenForBeat(true, ms));

// ---- wandering -----------------------------------------------------------
// The window never moves. Moving a transparent always-on-top window at 60fps is
// janky and burns CPU on an app that is idle 99% of the time; translating one
// div is free and smoother.

let stageX = 0;

function setX(x) {
  stageX = Math.max(0, Math.min(window.innerWidth - stage.offsetWidth, x));
  stage.style.transform = `translateX(${Math.round(stageX)}px)`;
}

const idle = () =>
  !hovered && !busy && !held && bubble.hidden && menu.hidden && chatForm.hidden;

function wander() {
  if (idle()) {
    setX(Math.random() * (window.innerWidth - stage.offsetWidth));
    // The stage transition is what moves it; this is what makes it look like
    // walking rather than sliding, and it runs for exactly that long.
    move('walk');
  }
  setTimeout(wander, 25000 + Math.random() * 45000);
}

// A quirk while nothing is happening - a stretch, a wag, a hop, depending on
// what the pet is. Which one is entirely pets.css's business; this only decides
// when. Far enough apart that it never reads as a loop.
const QUIRK_MS = 2600;

// Which of the whole-body movements the pet does unprompted. Dancing is not on
// the list: a pet that breaks into a dance at nobody is unsettling rather than
// charming, so that one stays something you ask for.
const IDLE_MOVES = ['peek', 'jump', 'spin'];

function quirk() {
  if (idle()) {
    // Most of the time the small species quirk, occasionally a whole movement.
    // Every time would make the taskbar busy; never would waste the body.
    if (Math.random() < 0.3) {
      move(IDLE_MOVES[Math.floor(Math.random() * IDLE_MOVES.length)]);
    } else {
      petEl.classList.remove('is-idling');
      void petEl.offsetWidth; // restart, rather than waiting out the old run
      petEl.classList.add('is-idling');
      setTimeout(() => petEl.classList.remove('is-idling'), QUIRK_MS);
    }
  }
  setTimeout(quirk, 9000 + Math.random() * 14000);
}

// ---- battery -------------------------------------------------------------
// Only the main process runs skills, and only the renderer can read this, so it
// is pushed rather than asked for. Level and charging state, nothing else.

if (navigator.getBattery) {
  navigator.getBattery().then((b) => {
    const report = () => window.pet.battery({
      percent: Math.round(b.level * 100),
      charging: b.charging,
    });
    report();
    b.addEventListener('levelchange', report);
    b.addEventListener('chargingchange', report);
  }).catch(() => {}); // no battery, or a desktop - the skill says so
}

// Start somewhere on the right, where a taskbar pet belongs.
setX(window.innerWidth - stage.offsetWidth - 40);
setTimeout(wander, 12000);
setTimeout(quirk, 5000);
