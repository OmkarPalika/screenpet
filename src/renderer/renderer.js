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

// Which line is currently allowed to make a noise. The audio for a line is
// fetched over IPC, so a second line can be asked for while the first is still
// being synthesised - and the answer arriving late for a line nobody is waiting
// for any more must not start playing over the top of the new one.
let sayId = 0;
let playing = null;

function speak(text, kind, chatty = false) {
  // Cancel unconditionally, even when muted - the toggle has to stop a line
  // that is already halfway out.
  hush();
  if (!voiceOn || kind === 'thinking') return;

  // Its own voice for its own words. An answer you asked a question to get is
  // never chirped: a reply you cannot hear is not a reply, and reading it off
  // the bubble is what the setting is there to avoid.
  if (chatty) return chirp(text, kind === 'error' ? 'oops' : petEl.dataset.expr);

  const line = speakable(text);
  if (!line) return;

  // The pet's own voice first, and the platform's if that is not available. The
  // difference is the filter chain in robot.js, which needs the audio itself -
  // and SpeechSynthesis will speak a sentence but will not hand it over.
  const mine = ++sayId;
  const fallback = () => { if (mine === sayId) system(line); };
  window.pet.voice(line, SLOW).then((said) => {
    if (mine !== sayId) return; // a newer line took over while this was coming
    if (said && said.wav) return play(said, mine, fallback);
    fallback();
  }).catch(fallback);
}

/** Play a base64 WAV through the filter chain its engine needs. */
function play(said, mine, fallback) {
  const ctx = audio();
  const bytes = Uint8Array.from(atob(said.wav), (c) => c.charCodeAt(0));
  ctx.decodeAudioData(bytes.buffer).then((buffer) => {
    if (mine !== sayId) return;
    // An unknown engine gets the chain written for the worst case rather than
    // no chain at all: a voice nobody has heard played flat is a gamble, and
    // the robot is at least a deliberate sound.
    playing = robot(ctx, buffer, ctx.destination, VOICE[said.engine] || VOICE.sapi);
    petEl.classList.add('is-talking');
    // Off the length of the audio rather than an event, because the mouth has
    // to stop when the sound does, and `ended` on a source that was stopped
    // early fires after the next line has already started its own.
    chirpTimer = setTimeout(() => {
      if (mine === sayId) petEl.classList.remove('is-talking');
    }, playing.seconds * 1000);
  }).catch(fallback);
}

/** The platform voice, which is what this app used before robot.js existed. */
function system(line) {
  if (!voice) return;
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

function audio() {
  if (!sfx) sfx = new AudioContext();
  // Chromium can hand back a suspended context. Without this the first noises
  // are scheduled against a clock that is not running, and never arrive.
  if (sfx.state === 'suspended') sfx.resume();
  return sfx;
}

function bark(expr) {
  if (!soundsOn) return;
  sound(audio(), document.documentElement.dataset.pet || 'blob', expr);
}

// Chirp speech: the pet's own lines, in its own voice. Shares the noises'
// AudioContext and voices.js, but not their switch - this is the voice, and
// muting the voice has to silence it.
let chirpTimer = null;
let chirpOut = null;

function chirp(text, expr) {
  const ctx = audio();
  chirpOut = ctx.createGain();
  chirpOut.connect(ctx.destination);
  const end = chatter(ctx, text, expr, undefined, chirpOut);
  petEl.classList.add('is-talking');
  // The same class SpeechSynthesis drives, stopped the same way. A mouth left
  // moving after the sound stopped is the one failure anybody would notice.
  chirpTimer = setTimeout(
    () => petEl.classList.remove('is-talking'),
    Math.max(0, (end - ctx.currentTime) * 1000)
  );
}

/**
 * Stop talking, whichever way it was talking. Blips are scheduled ahead rather
 * than played, so silencing them means turning their own tap off - cancelling
 * the timer alone would leave the rest of the line arriving in an empty room.
 */
function hush() {
  speechSynthesis.cancel();
  // Any audio still in flight is for a line that has been superseded. Bumping
  // the id is what stops it: the fetch cannot be recalled, and without this its
  // answer arrives and starts playing over whatever is being said now.
  sayId++;
  if (playing) { playing.stop(); playing = null; }
  clearTimeout(chirpTimer);
  if (chirpOut) {
    // A ramp rather than a jump: gain to zero in one sample is a click.
    chirpOut.gain.setTargetAtTime(0, sfx.currentTime, 0.008);
    chirpOut = null;
  }
  petEl.classList.remove('is-talking');
}

// ---- body movements ------------------------------------------------------
// The face is an expression on .pet; this is the body, on the svg inside it.
// Separate elements on purpose - see the note in style.css. A movement plays
// under any face, so the pet can lose at rock-paper-scissors, sulk about it and
// fall over all at once.

// How long each one runs, so the attribute comes off when the animation ends
// rather than at some guessed constant.
const MOVE_MS = {
  walk: 2600, dance: 2600, spin: 1240, jump: 1040, topple: 2400, peek: 2200,
  roll: 900, sit: 2000, stretch: 1400, shiver: 1260, sneeze: 900,
};
const MOVES = Object.keys(MOVE_MS);

let moveTimer = null;

// The step cycle in style.css is 620ms long with a foot down at each end of it,
// so a footfall lands every half cycle. Taken from there rather than guessed:
// steps that drift out of time with the legs are worse than no steps.
const STEP_MS = 310;
let stepTimer = null;

function footsteps(ms) {
  clearInterval(stepTimer);
  if (!soundsOn) return;
  const ctx = audio();
  step(ctx);
  stepTimer = setInterval(() => step(ctx), STEP_MS);
  setTimeout(() => clearInterval(stepTimer), ms - 40);
}

// The pet turns, the light stays where the lamp is. Without this a spin is a
// sticker on a turntable: the highlight goes round with the shape and is on the
// dark side by the time the pet is halfway round.
//
// Driven off the pet's own computed transform rather than a copy of the timing,
// so it follows whatever style.css says the movement is - and it costs nothing
// when the movement does not turn, because then the angle is zero and the light
// is where it always was.
const petSvg = petEl.querySelector('svg');
let turning = 0;

function follow() {
  const deg = turnedBy(petSvg);
  aimLight(deg);
  if (petEl.dataset.move) return requestAnimationFrame(follow);
  turning = 0;
  aimLight(0); // back to the lamp on the left, wherever the animation stopped
}

/**
 * Play a body movement.
 *
 * @param {string} name  one of MOVE_MS
 * @param {number} [ms]  how long to run it for, when the thing it illustrates
 *   is shorter than the movement itself - the walk home takes 900ms and a
 *   walk is 2600, and footsteps still going after the pet is indoors are the
 *   sound of a bug.
 */
function move(name, ms = MOVE_MS[name]) {
  clearTimeout(moveTimer);
  if (!MOVE_MS[name]) { delete petEl.dataset.move; return; }
  // Same restart trick the expressions use: asking for the movement it is
  // already doing has to visibly do something.
  delete petEl.dataset.move;
  void petEl.offsetWidth;
  petEl.dataset.move = name;
  if (name === 'walk') footsteps(ms);
  if (!turning) { turning = 1; requestAnimationFrame(follow); }
  moveTimer = setTimeout(() => { delete petEl.dataset.move; }, ms);
}

window.pet.onSay(({ text, kind, expr, move: movement, chatter: chatty, partial }) => {
  // An answer arriving as it is written. The bubble fills; nothing else moves.
  // No face, no noise, and above all nothing spoken - a voice restarting the
  // sentence from the top on every token is unlistenable, and the words are not
  // final until the model stops.
  if (partial) {
    busy = true;
    petEl.classList.remove('is-thinking');
    say(text, { kind, sticky: true });
    return;
  }
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
  speak(text, kind, chatty);
});

// A bubble in the way is a bubble you want gone - and so is the sentence still
// being read out of it.
bubble.addEventListener('click', () => {
  if (busy) return;
  bubble.hidden = true;
  hush();
});

// ---- stats ---------------------------------------------------------------

window.pet.onStats((s) => {
  petEl.dataset.mood = s.mood;
  // Where you left it last time. Applied once - after that the pet is where it
  // is, and a state push arriving mid-drag must not yank it back.
  applyPlace(s.place);
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
// The window covers the whole display, so main keeps it click-through and we
// tell it when the cursor is actually over something clickable.

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

// Eyes track the cursor anywhere on the screen, which costs nothing and is most
// of what makes the thing feel awake. Clamped small - a pupil that slides to the
// edge of the eye looks unwell rather than attentive.
//
// On top of the cursor there are two things real eyes do that a tracker does
// not. They flick about a little on their own rather than sitting perfectly
// still (a saccade), and when nothing is moving they stop tracking and look
// somewhere else entirely. A gaze locked on the cursor to the pixel is the
// single most machine-like thing a face can do.

let lookAt = null;      // where the cursor was, or null if it has not moved yet
let jitter = { x: 0, y: 0 };
let lastMoveAt = 0;
const IDLE_GAZE_MS = 4000;

function aim(x, y) {
  const r = petEl.getBoundingClientRect();
  const dx = Math.max(-3, Math.min(3, (x - (r.left + r.width / 2)) / 26));
  const dy = Math.max(-2, Math.min(2, (y - (r.top + r.height / 2)) / 30));
  petEl.style.setProperty('--eye-x', `${(dx + jitter.x).toFixed(2)}px`);
  petEl.style.setProperty('--eye-y', `${(dy + jitter.y).toFixed(2)}px`);
  // And the head goes with them. Small: past about eight degrees the flat face
  // slides off the side of a round body and takes the illusion with it.
  petEl.style.setProperty('--turn-y', `${(dx * 2.4).toFixed(2)}deg`);
  petEl.style.setProperty('--turn-x', `${(-dy * 2.2).toFixed(2)}deg`);
}

function gaze(x, y) {
  lookAt = { x, y };
  lastMoveAt = performance.now();
  aim(x, y);
}

/**
 * A flick of the eyes, and - if the cursor has been still a while - a look at
 * something else in the room. The pet has no idea what is over there, which is
 * the point: eyes that only ever track the one thing that moves read as a
 * sensor rather than as attention.
 */
function saccade() {
  const still = performance.now() - lastMoveAt > IDLE_GAZE_MS;
  jitter = still
    ? { x: rand(-2.6, 2.6), y: rand(-1.6, 1.2) }
    : { x: rand(-0.5, 0.5), y: rand(-0.4, 0.4) };
  if (lookAt) aim(lookAt.x, lookAt.y);
  // Uneven on purpose. A flick every N seconds exactly is a metronome, and the
  // eye reads a metronome as a machine faster than it reads anything else.
  setTimeout(saccade, still ? rand(900, 2600) : rand(1400, 4200));
}

// Blinking is scheduled rather than a CSS loop, for the same reason: a blink
// every 5.4 seconds forever is a tell. Real ones come in uneven gaps and
// sometimes in pairs.
const eyesEl = document.querySelector('.eyes');

// One chain, however many callers. A blink asked for from outside - the pet
// noticing something - has to join the rhythm rather than start a second one:
// without this every glance leaves another timer running and the pet ends up
// fluttering.
let blinkTimer = null;

/**
 * How long until the next one.
 *
 * Read fresh at every reschedule rather than settled once, because the rate is
 * the whole point: people blink about twice as often while they are speaking,
 * and noticeably less while they are watching something move. One random range
 * covering all three is a slower metronome, not a face.
 */
function blinkGap() {
  if (petEl.classList.contains('is-talking')) return rand(1200, 3400);
  // The cursor moved a moment ago, so the pet is following it. Eyes tracking
  // something hold open - blinking straight through it is what a screensaver
  // does, and it is why an idle loop reads as an idle loop.
  if (performance.now() - lastMoveAt < IDLE_GAZE_MS) return rand(3400, 9000);
  return rand(2600, 7400);
}

function blink(again = Math.random() < 0.28) {
  clearTimeout(blinkTimer);
  eyesEl.classList.remove('is-blink');
  void eyesEl.offsetWidth;
  eyesEl.classList.add('is-blink');
  setTimeout(() => eyesEl.classList.remove('is-blink'), 200);
  // A double blink lands close enough to read as one gesture rather than two.
  if (again) blinkTimer = setTimeout(() => blink(false), 320);
  else blinkTimer = setTimeout(() => blink(), blinkGap());
}

// The other half of the track: the blinks that are caused by something rather
// than scheduled. Both triggers are edges on the pet's own attributes, watched
// in one place instead of being called from each of the sites that cause them -
// seven of which start or stop speech, and thirteen of which hide the eyes.
//
// Watching the result rather than the causes is also what keeps it honest. A
// new expression that shuts the eyes gets its blink on the way out for free,
// and has no way to forget to ask for one.
let wasTalking = false;
let hadEyes = true;

new MutationObserver(() => {
  // The mouth opening and closing. People blink on phrase boundaries, and it is
  // the most missed one there is: a mouth that starts moving under a perfectly
  // still face is a puppet with a hand in it.
  const talking = petEl.classList.contains('is-talking');
  // And the eyes opening. Waking up, letting go of a hug, coming out of a sit -
  // every one of those ends with eyes that were shut being open again, and eyes
  // do not come back open without passing through a blink on the way.
  const eyes = getComputedStyle(eyesEl).display !== 'none';

  if (talking !== wasTalking || (eyes && !hadEyes)) blink(false);
  wasTalking = talking;
  hadEyes = eyes;
}).observe(petEl, { attributeFilter: ['class', 'data-mood', 'data-expr'] });

// You changed windows. The pet looks over at whatever lit up, and now and then
// leans across to see it properly. It stays looking there until the cursor
// moves, which is the same rule the cursor already had - the last thing that
// happened is the thing worth watching.
window.pet.onGlance(({ x, y, peek, perch }) => {
  if (held) return; // being carried is more interesting than a window
  gaze(x, y);
  blink();
  if (perch && idle()) return sitOn(perch);
  if (peek) move('peek');
});

/**
 * Climb up and sit on the top edge of the window you just switched to.
 *
 * All it is given is a rectangle - it does not know, and cannot be told, what is
 * inside it. Somewhere along the edge rather than the corner, because a pet that
 * lands on exactly the same pixel every time is a widget.
 */
function sitOn({ x, y, w }) {
  const along = x + Math.random() * Math.max(0, w - stage.offsetWidth);
  setXY(along, y - petH());
  move('jump');
}

document.addEventListener('mousemove', (e) => {
  gaze(e.clientX, e.clientY);
  if (held) return dragTo(e.clientX, e.clientY); // never hand focus back mid-drag
  // During a break the whole window takes clicks, because the dimmed screen
  // behind the pet is the thing you click to stop it. Hit-testing the pet would
  // hand the mouse straight back to whatever is underneath.
  if (breaking) return;

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

function dragTo(x, y) {
  if (!dragged && Math.hypot(x - held.grabX, y - held.grabY) > 4) {
    dragged = true;
    petEl.classList.add('is-held');
    express('dizzy', 4000);
  }
  if (!dragged) return;
  setXY(held.fromX + (x - held.grabX), held.fromTop + (y - held.grabY));

  // Enough of the recent path to measure a throw off, and no more: a hand that
  // slows to a stop before letting go has not thrown anything, and averaging
  // over the whole drag would say it did.
  held.path.push({ t: performance.now(), x, y });
  if (held.path.length > 6) held.path.shift();

  // It swings from where you are holding it. Small, and damped, or a pet held
  // still ends up wobbling like a metronome.
  const swing = Math.max(-14, Math.min(14, (x - (held.lastX ?? x)) * 1.6));
  held.lastX = x;
  held.tilt = (held.tilt ?? 0) * 0.7 + swing * 0.3;
  petEl.style.transform = `rotate(${held.tilt.toFixed(1)}deg) scale(1.04)`;
}

// ---- weight ---------------------------------------------------------------
// Throw it and it goes. This is the whole of what separates picking a sprite up
// from picking something up: released, it keeps the speed it had, falls, hits
// the edge of the screen and loses some of it.
//
// A gentle move is still a placement - put it down where you want it and it
// stays there. Only an actual throw becomes a flight, or the pet could never be
// parked anywhere but the floor.

const GRAVITY = 3400;   // px/s², about twice real gravity - a light thing falls slowly and reads as floaty
const BOUNCE = 0.44;    // how much speed survives hitting an edge
const AIR = 0.55;       // horizontal speed kept per second
const THROW_MIN = 320;  // px/s, below which letting go is a placement rather than a throw
const REST = 110;       // px/s at the floor, below which it has stopped bouncing

let flight = null;

/** Speed at the moment of release, from the last few positions. */
function thrown(path) {
  if (!path || path.length < 2) return { x: 0, y: 0 };
  const a = path[0];
  const b = path[path.length - 1];
  const dt = (b.t - a.t) / 1000;
  // Stale samples mean the hand stopped before letting go, which is a place.
  // Under a frame apart there is no speed to measure, only a huge number from
  // dividing by nearly zero - and that is a pet fired across the screen by a
  // drag that never actually moved.
  if (dt < 0.016 || performance.now() - b.t > 90) return { x: 0, y: 0 };
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
}

function launch(v) {
  flight = { vx: v.x, vy: v.y, x: stageX, top: stageTop, last: performance.now(), spin: 0 };
  stage.classList.add('is-dragging'); // the wander easing would fight every frame
  petEl.classList.remove('is-held');
  petEl.classList.add('is-flying');
  requestAnimationFrame(fly);
}

function fly(now) {
  if (!flight) return;
  // Capped: a background tab hands back one enormous step, and the pet would
  // teleport through the floor rather than bounce off it.
  const dt = Math.min(0.032, (now - flight.last) / 1000);
  flight.last = now;

  flight.vy += GRAVITY * dt;
  flight.vx *= Math.pow(AIR, dt);
  flight.x += flight.vx * dt;
  flight.top += flight.vy * dt;
  flight.spin += flight.vx * dt * 0.5;

  const maxX = roomX();
  const maxY = roomY();
  let hit = 0;
  if (flight.x < 0) { flight.x = 0; flight.vx = -flight.vx * BOUNCE; hit = Math.abs(flight.vx); }
  if (flight.x > maxX) { flight.x = maxX; flight.vx = -flight.vx * BOUNCE; hit = Math.abs(flight.vx); }
  if (flight.top < 0) { flight.top = 0; flight.vy = -flight.vy * BOUNCE; hit = Math.abs(flight.vy); }
  let floor = false;
  if (flight.top > maxY) {
    flight.top = maxY;
    floor = true;
    hit = Math.abs(flight.vy);
    flight.vy = -flight.vy * BOUNCE;
  }

  setXY(flight.x, flight.top);
  petEl.style.transform = `rotate(${flight.spin.toFixed(1)}deg)`;
  // Scaled by how hard it hit, against a speed that is a good hard throw.
  if (hit > REST) thump(hit / 1800);

  // Settled: on the floor with nothing left. Checked after the bounce, so the
  // last little hop does not get one more frame of gravity added to it.
  if (floor && Math.abs(flight.vy) < REST && Math.abs(flight.vx) < REST) return land();
  requestAnimationFrame(fly);
}

/** The squash of hitting something. Its own class rather than a data-move, so a
 *  pet thrown mid-dance keeps dancing. */
let thumpTimer = null;
function thump(force = 1) {
  if (soundsOn) thud(audio(), force);
  clearTimeout(thumpTimer);
  petEl.classList.remove('is-thumped');
  void petEl.offsetWidth;
  petEl.classList.add('is-thumped');
  thumpTimer = setTimeout(() => petEl.classList.remove('is-thumped'), 260);
}

function land() {
  flight = null;
  stage.classList.remove('is-dragging');
  petEl.classList.remove('is-flying');
  petEl.style.transform = '';
  express('dizzy', 1800);
  keep();
}

/** Where it ended up is where it lives now. */
function keep() {
  home = { ...where };
  window.pet.place(where);
}

petEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  // A throw in flight is caught rather than fought over.
  flight = null;
  stage.classList.remove('is-dragging');
  petEl.classList.remove('is-flying');
  held = {
    grabX: e.clientX, grabY: e.clientY, fromX: stageX, fromTop: stageTop,
    path: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
  };
  dragged = false;
  stage.classList.add('is-dragging');
});

document.addEventListener('mouseup', () => {
  if (!held) return;
  // Measured before the grip is dropped: the path is the only record of how
  // fast your hand was going, and it lives on `held`.
  const v = dragged ? thrown(held.path) : { x: 0, y: 0 };
  held = null;
  stage.classList.remove('is-dragging');
  petEl.classList.remove('is-held');
  if (dragged) {
    petEl.style.transform = '';
    // Put somewhere on purpose stays there. Thrown, it goes - and wherever it
    // lands is where it lives, which is the only reason any of this reaches the
    // main process at all.
    if (Math.hypot(v.x, v.y) > THROW_MIN) launch(v);
    else keep();
    window.pet.react('drag');
  }
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
window.pet.onLook(({
  pet, skin, wear, voice: on, sounds, mic, camera, faces, bop,
  mischief: up, watching,
}) => {
  mischief = up !== false;
  // The amber dot. Reading the screen on a timer is the one thing this app does
  // that you did not just ask for, so it says so on the pet's own face.
  document.getElementById('reading').hidden = !watching;
  document.documentElement.dataset.pet = pet;
  document.documentElement.dataset.skin = skin;
  document.documentElement.dataset.wear = wear || 'none';
  voiceOn = !!on;
  soundsOn = !!sounds;
  if (!voiceOn) hush();
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
// Reset with the microphone rather than kept across it, so a dance that ended
// twenty minutes ago is not still half way through a note.
let heardSinging = null;

function stopBeat() {
  cancelAnimationFrame(beatRaf);
  beatRaf = 0;
  if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
  audioStream = null;
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  beatAvg = 0;
  heardSinging = null;
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
  // Which frequency each bin covers. Read off the context rather than assumed:
  // a 44.1kHz machine and a 48kHz one put the voice in different bins, and
  // singing.js works in Hz because that is the thing that does not move.
  const hzPerBin = audioCtx.sampleRate / 2 / bins.length;
  heardSinging = singing.tracker();
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
    // ...and whether that was you rather than the record. Reported rather than
    // acted on here, which is the one place this differs from the beat above:
    // a beat is a movement and main has no use for it, but singing is answered
    // with a line, and every line the pet says comes out of one door in main so
    // the bank and the face cannot drift apart. Quiet hours and a half-written
    // answer both get to refuse it there, which is the right place for both.
    if (heardSinging(bins, hzPerBin, now)) window.pet.sang();

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

// ---- dictation, for the whisper path ---------------------------------------
//
// Windows' own recogniser opens the microphone inside PowerShell and hears you
// there; whisper is handed audio, and only this side of the app can open a
// microphone at all. So: main asks, this records exactly one phrase, and one WAV
// goes back. It is never written to disk on either side.
//
// The microphone is open from the moment main asks until the phrase ends, and
// the same green dot that means "the camera is on" means this too.

const REC_RATE = 16000;        // what whisper wants; anything else it resamples
const REC_MAX_MS = 10000;      // a stuck recording is worse than a cut sentence
const REC_HUSH_MS = 900;       // silence this long after speech ends the phrase
const REC_GIVEUP_MS = 4000;    // nothing said at all by now, and there will not be
const REC_SPEECH = 0.035;      // RMS above this is a voice, not a room

// Measured on this microphone at -25 dBFS peak with no automatic gain: quiet, and
// still comfortably above the floor. The recorder asks for the raw capture -
// echo cancellation, noise suppression and automatic gain all off - because that
// is the audio the swap was measured on, and turning a processor on afterwards
// would make the shipped behaviour something nobody has benchmarked.
const RAW = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };

/** 16-bit PCM in a WAV wrapper, which is the one format both engines read. */
function toWav(samples) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const str = (off, s) => [...s].forEach((c, n) => view.setUint8(off + n, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, REC_RATE, true);
  view.setUint32(28, REC_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let n = 0; n < samples.length; n++) {
    const s = Math.max(-1, Math.min(1, samples[n]));
    view.setInt16(44 + n * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

let recording = false;

/**
 * One phrase. Stops on silence the way System.Speech does, so the two paths feel
 * the same to talk to, and answers with nothing at all if nobody spoke - whisper
 * has no confidence score, and handed a quiet room it invents a word.
 */
async function recordPhrase() {
  if (recording) return window.pet.audio(null);
  recording = true;

  let stream = null;
  let ctx = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: RAW });
  } catch {
    recording = false;
    return window.pet.audio(null); // no microphone, or refused
  }

  camEl.hidden = false; // the same dot: something is listening

  try {
    const chunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => chunks.push(e.data);

    // The stop decision is energy, measured on a live analyser rather than after
    // the fact, because a recorder that only stops on a timer makes every phrase
    // as long as the longest one.
    ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const frame = new Float32Array(analyser.fftSize);

    let spoke = false;
    let loudest = 0;
    let quietSince = 0;
    const startedAt = Date.now();

    const done = new Promise((resolve) => {
      rec.onstop = resolve;
      const watch = () => {
        if (rec.state !== 'recording') return;
        analyser.getFloatTimeDomainData(frame);
        let sum = 0;
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
        const rms = Math.sqrt(sum / frame.length);
        loudest = Math.max(loudest, rms);

        const now = Date.now();
        if (rms > REC_SPEECH) {
          spoke = true;
          quietSince = 0;
        } else if (spoke && !quietSince) {
          quietSince = now;
        }

        const ended = spoke && quietSince && now - quietSince > REC_HUSH_MS;
        const gaveUp = !spoke && now - startedAt > REC_GIVEUP_MS;
        if (ended || gaveUp || now - startedAt > REC_MAX_MS) return rec.stop();
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });

    rec.start();
    await done;

    // Nobody spoke. Sending the audio anyway would get a confident sentence back
    // from a model that had nothing to work with.
    if (!spoke || loudest < REC_SPEECH) return window.pet.audio(null);

    const decoded = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
    // The browser's own resampler rather than a hand-rolled one: a bad downsample
    // is aliasing, and aliasing is indistinguishable from a bad recogniser.
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * REC_RATE), REC_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const wav = toWav((await off.startRendering()).getChannelData(0));
    window.pet.audio(wav);
  } catch {
    window.pet.audio(null); // main says "I did not catch that" and life goes on
  } finally {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close();
    if (!camStream && !audioStream) camEl.hidden = true;
    recording = false;
  }
}

window.pet.onRecord(recordPhrase);

// ---- wandering -----------------------------------------------------------
// The window never moves. Moving a transparent always-on-top window at 60fps is
// janky and burns CPU on an app that is idle 99% of the time; translating one
// div is free and smoother.

// Where the pet is, as the top left corner of the pet itself in window
// coordinates - not as an offset from an edge, because which edge the stage is
// pinned to changes when it flips and the pet must not move when it does.
let stageX = 0;
let stageTop = 0;
// Where you put it by hand, or null if you never have. Home rather than a peg:
// it wanders around this and comes back to it, because "stays where I put it"
// and "moves like it is alive" are both true of a real pet and only the first
// one was true of this. See wander().
let home = null;
// The last position as fractions of the room available, which is what survives
// the window changing size under it. Same shape as pet-state.js keeps on disk.
let where = { x: 1, y: 1 };

// How much room a speech bubble needs above the pet's head. Above this line the
// stage flips and says everything below itself instead.
const BUBBLE_ROOM = 160;
const STAGE_BOTTOM = 4; // matches .stage { bottom: 4px }

const roomX = () => Math.max(0, window.innerWidth - stage.offsetWidth);
const petH = () => petEl.offsetHeight || 110;
const roomY = () => Math.max(0, window.innerHeight - petH() - STAGE_BOTTOM);

/**
 * Put the pet at a window position, clamped so that no part of it can leave the
 * window - and the window is exactly one display's work area, which is the
 * whole of "it can never be sent off the screen".
 */
function setXY(x, top = stageTop) {
  stageX = Math.max(0, Math.min(roomX(), x));
  stageTop = Math.max(0, Math.min(roomY(), top));

  // Flipped, the stage hangs off the top edge and the pet is its first item, so
  // the offset is the pet's own position. Upright it hangs off the bottom, so
  // the offset is how far up from the floor the pet has been lifted.
  const down = stageTop < BUBBLE_ROOM;
  stage.dataset.flip = down ? 'down' : 'up';
  const y = down ? stageTop : -(roomY() - stageTop);
  stage.style.transform = `translate(${Math.round(stageX)}px, ${Math.round(y)}px)`;

  where = { x: roomX() ? stageX / roomX() : 0, y: roomY() ? stageTop / roomY() : 1 };
}

/**
 * Move without the walk. The stage eases every transform over 2.6 seconds,
 * which is what makes wandering look like walking and what makes anything else
 * look like the pet sliding across the room on ice - and mid-glide it can be
 * outside the window it was just clamped into.
 */
function snap(x, top) {
  stage.classList.add('is-dragging');
  setXY(x, top);
  requestAnimationFrame(() => {
    if (!held && !flight) stage.classList.remove('is-dragging');
  });
}

function applyPlace(place) {
  if (!place || home) return;
  home = { x: place.x, y: place.y };
  snap(place.x * roomX(), place.y * roomY());
}

// A resolution change, or the pet sent to a different monitor, resizes the
// window under it. Re-placed by fraction rather than re-clamped by pixel: a pet
// parked halfway up a tall display belongs halfway up the short one, not
// wherever that many pixels happens to land.
window.addEventListener('resize', () => snap(where.x * roomX(), where.y * roomY()));

const idle = () =>
  !hovered && !busy && !held && !breaking
  && bubble.hidden && menu.hidden && chatForm.hidden;

// How far either side of a parked pet counts as still being there, as a share
// of the room. A pet that never moves is furniture; one that walks off the spot
// you chose is disobedient. This is the gap between the two.
const ROAM = 0.16;

// Whether the pet gets to go anywhere but the floor. Off puts it back to pacing
// the bottom of the screen and never sitting on your windows, which is what it
// did before. Set from the settings; assumed on until they arrive.
let mischief = true;

// How often a wander goes up the screen instead of along it. Most of the time it
// stays on the floor, because a pet permanently halfway up a monitor is not
// roaming, it is in the way.
const CLIMB = 0.3;

let trips = 0;

/** Pick somewhere to be and go there. Separate from the schedule so it can be
    asked for twenty times in a row without leaving twenty timers behind.
    @returns {boolean} whether it left the floor, which changes how it moves. */
function wanderTo() {
  const room = window.innerWidth - stage.offsetWidth;
  let to = Math.random() * room;
  // Where it already is, unless something below decides otherwise: a pet put on
  // a shelf halfway up the screen stays on that shelf.
  let top = stageTop;
  const climbing = mischief && Math.random() < CLIMB;
  if (climbing) top = Math.random() * roomY();
  if (home) {
    // Around where you put it, and back to it every other time - so it is always
    // visibly heading somewhere, and where it settles is still your spot.
    // Parking it used to stop it moving at all, and one drag lasted forever: the
    // spot was restored from disk at launch, so a pet parked once in March was
    // still standing in exactly that place in June.
    const at = home.x * room;
    const back = trips++ % 2;
    to = back ? at : at + (Math.random() * 2 - 1) * room * ROAM;
    // Coming home means all the way home, off whatever it climbed onto.
    if (back) top = home.y * roomY();
  }
  setXY(Math.max(0, Math.min(room, to)), top);
  return top < roomY() - 1;
}

function wander() {
  if (idle()) {
    // The stage transition is what moves it; the animation is what makes it look
    // like walking rather than sliding, and it runs for exactly that long. Off
    // the floor there is nothing to walk on, so it hops instead.
    move(wanderTo() ? 'jump' : 'walk');
  }
  setTimeout(wander, 25000 + Math.random() * 45000);
}

// ---- breaks ---------------------------------------------------------------
//
// The pet thinks about a glass of water, or about sitting still for a minute.
// That thought is the whole of the interruption: it is the size of a coin, it
// goes away on its own if you ignore it, and nothing happens until you click it.
//
// Click it and the pet takes the screen - everything behind it dims, it walks to
// the middle, and it drinks or meditates for as long as you set. Which is the
// point: nobody is told to take a break, the pet takes one and you watch.

const veil = document.getElementById('veil');
const counting = document.getElementById('counting');
const thought = document.getElementById('thought');
const thoughtFace = document.getElementById('thought-face');
const glass = document.getElementById('glass');
const water = document.getElementById('water');

// How long the offer stands. Long enough to finish a sentence and look up,
// short enough that it is not still sitting there an hour later.
const THOUGHT_MS = 45000;

// The walk to the middle and back, matching the stage transition in style.css.
const CROSS_MS = 2600;

// How full the glass starts. Not 100: a glass filled to the brim has no rim
// showing and reads as a blue rectangle rather than as a glass with water in it.
const FULL = 82;

// How full the glass is, as the top edge of a half plane rather than the height
// of a block: see .glass i in style.css. Empty is a surface at the bottom of the
// glass, not a block of no height, and those are the same picture only while the
// glass is upright.
const level = (fill) => {
  water.style.top = `${(100 - fill).toFixed(1)}%`;
};

// Raising the glass to the mouth, matching sip-raise in style.css. Everything
// else in the drink is delayed by it, because a pet that starts sipping before
// the glass arrives is drinking air.
const RAISE_MS = 520;

// Roughly how long one mouthful takes. The break is divided into a whole number
// of these, so the glass runs out exactly as the break ends - the level is the
// clock, and a clock that stops before the hour is a broken one.
const GULP_MS = 3500;

// Where inside the sip the swallow happens, as a fraction of one mouthful. The
// glass is tipped from 34% to 52% in sip-tip, so the water goes down inside
// that window rather than drifting down between drinks.
const SWALLOW_AT = 0.4;
const SWALLOW_FOR = 0.16;

// ...and where the glass is upright again, from sip-tip. The last mouthful is
// swallowed mid-tip like every other one, so lowering the glass has to wait for
// the tip to finish - drop it the moment the water runs out and the glass snaps
// from tilted to level in one frame, halfway through a drink.
const UPRIGHT_AT = 0.72;

let thoughtTimer = null;
let breakTimer = null;
let arriveTimer = null;
let gulpTimer = null;
let firstGulp = null;
let emptyTimer = null;
let breaking = false;
let breakBack = null; // where it was standing before, as fractions

function dropThought() {
  clearTimeout(thoughtTimer);
  thought.hidden = true;
}

window.pet.onThink(({ face }) => {
  // Not over an answer, and not while it is being carried around.
  if (busy || held || breaking) return;
  thoughtFace.textContent = face;
  thought.hidden = false;
  express('curious', 2400);
  clearTimeout(thoughtTimer);
  thoughtTimer = setTimeout(dropThought, THOUGHT_MS);
});

thought.addEventListener('click', () => {
  dropThought();
  window.pet.breakTake();
});

// Anywhere on the dimmed screen stops it early. The pet itself stays pattable
// during a break, which is the whole reason the veil is underneath it.
veil.addEventListener('click', () => endBreak());

window.pet.onBreak(({ kind, seconds }) => startBreak(kind, seconds));

function startBreak(kind, seconds) {
  dropThought();
  hush(); // nothing it was in the middle of saying survives into the quiet bit
  bubble.hidden = true;
  menu.hidden = true;
  breaking = true;
  breakBack = { ...where };
  veil.hidden = false;
  counting.hidden = false;
  // The window ignores the mouse except where the pet is standing; for as long
  // as the veil is up, the whole of it has to take a click.
  setInteractive(true);

  // Into the middle of the screen, on foot.
  setXY((window.innerWidth - stage.offsetWidth) / 2, roomY() / 2);
  move('walk');

  const total = Math.max(1, Math.round(Number(seconds) || 0));
  let left = total;
  const show = () => { counting.textContent = `${left}s`; };
  show();

  // How many mouthfuls this break is worth, over the time there actually is to
  // drink in: the pet spends the first CROSS_MS walking to the middle of the
  // screen and RAISE_MS lifting the glass, and neither is drinking. Spread the
  // gulps over the whole break instead and the glass is still half full when the
  // break ends, which makes a liar of the one thing it is for.
  //
  // At least two - one gulp is not somebody drinking a glass of water, it is
  // somebody knocking one back - and capped, so a long break is a slow drink
  // rather than a stream of tiny sips.
  const drinkMs = Math.max(1500, total * 1000 - CROSS_MS - RAISE_MS);
  const gulps = Math.min(12, Math.max(2, Math.round(drinkMs / GULP_MS)));
  const sipMs = drinkMs / gulps;

  // It starts once it gets there. Drinking on the way across looks like a pet
  // being dragged along by a glass.
  clearTimeout(arriveTimer);
  arriveTimer = setTimeout(() => {
    if (!breaking) return;
    if (kind === 'water') {
      // The stylesheet knows how a mouthful looks; this is how long this one
      // lasts, and the level going down is the same clock rather than a second
      // one running alongside it.
      petEl.style.setProperty('--sip', `${Math.round(sipMs)}ms`);
      petEl.style.setProperty('--raise', `${RAISE_MS}ms`);
      petEl.style.setProperty('--gulp', `${Math.round(sipMs * SWALLOW_FOR)}ms`);
      level(FULL);
      glass.hidden = false;
      petEl.classList.add('is-drinking');

      // Down a mouthful at a time, timed to land inside the tip. Nothing here
      // reads the countdown: the glass empties because the pet drank it.
      let gulp = 0;
      const swallow = () => {
        if (!breaking) return;
        gulp += 1;
        level(Math.max(0, ((gulps - gulp) / gulps) * FULL));
        if (gulp < gulps) return;

        // Finished it. Everything stops and the glass comes back down - a pet
        // still miming mouthfuls out of an empty glass is the thing this whole
        // sequence was supposed to stop looking like. After the tip it was
        // swallowed on, though, not during it.
        clearInterval(gulpTimer);
        emptyTimer = setTimeout(() => {
          if (!breaking) return;
          glass.classList.add('is-empty');
          petEl.classList.remove('is-drinking');
        }, sipMs * (UPRIGHT_AT - SWALLOW_AT));
      };
      firstGulp = setTimeout(() => {
        swallow();
        gulpTimer = setInterval(swallow, sipMs);
      }, RAISE_MS + sipMs * SWALLOW_AT);
    } else {
      petEl.classList.add('is-meditating');
    }
  }, CROSS_MS);

  clearInterval(breakTimer);
  breakTimer = setInterval(() => {
    left -= 1;
    show();
    if (left <= 0) endBreak();
  }, 1000);
}

function endBreak() {
  if (!breaking) return;
  breaking = false;
  clearInterval(breakTimer);
  clearTimeout(arriveTimer);
  clearTimeout(firstGulp);
  clearTimeout(emptyTimer);
  clearInterval(gulpTimer);
  petEl.classList.remove('is-drinking', 'is-meditating');
  glass.classList.remove('is-empty');
  glass.hidden = true;
  level(FULL);
  for (const v of ['--sip', '--raise', '--gulp']) petEl.style.removeProperty(v);
  veil.hidden = true;
  counting.hidden = true;
  move(null);
  setInteractive(false);

  // Back to where it was standing, on foot, and before the main process is told
  // - it resizes the window on that message, and the resize re-places the pet
  // by fraction. Putting it home first means the fraction it re-places by is
  // home rather than the middle of the screen.
  if (breakBack) {
    setXY(breakBack.x * roomX(), breakBack.y * roomY());
    move('walk');
    breakBack = null;
  }
  window.pet.breakDone();
}

// A quirk while nothing is happening - a stretch, a wag, a hop, depending on
// what the pet is. Which one is entirely pets.css's business; this only decides
// when. Far enough apart that it never reads as a loop.
const QUIRK_MS = 2600;

// Which of the whole-body movements the pet does unprompted. Dancing is not on
// the list: a pet that breaks into a dance at nobody is unsettling rather than
// charming, so that one stays something you ask for.
const IDLE_MOVES = ['peek', 'jump', 'spin', 'sit', 'stretch'];

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

// Start on the floor at the right, where a taskbar pet belongs, until a saved
// placement arrives with the first push of the pet's state.
setXY(window.innerWidth - stage.offsetWidth - 40, roomY());
setTimeout(wander, 12000);
setTimeout(quirk, 5000);
setTimeout(saccade, 1800);
setTimeout(blink, 2400);

// ---- coming and going -----------------------------------------------------

// One house, used twice: the pet comes out of it when the app starts and goes
// back into it when you quit. The second is the first played backwards, which
// is most of why it reads as the same house rather than two animations that
// happen to share a drawing.
//
// Each step waits for the one before it rather than all firing off one clock,
// so a slow frame delays the sequence instead of desynchronising it.
const WALK_MS = 900;
const DOOR_MS = 280;
const INSIDE_MS = 380;
const LIGHT_MS = 700;
const HOUSE_GONE_MS = 380;

// LIGHT_MS is the only one of these that is a pause rather than a movement. The
// window itself takes 300ms to come up, so anything near that is a house that
// starts sinking while its light is still arriving - the ending is "the pet is
// in there", and it needs a beat to be that.

// The geometry of the drawing, which the walk has to agree with: a 240px house
// holding a 200px body, with a 70px doorway centred in it - so 85px into the
// house, and its middle exactly halfway. These have to stay in step with the
// clip-path notch in style.css, because that notch is the hole this walk aims
// at and a hole somewhere else is a pet stepping into a wall.
const HOUSE_W = 240;
const DOOR_X = 85;
const DOOR_W = 70;
const DOOR_MID = DOOR_X + DOOR_W / 2;

// Where the pet stops walking, measured from the door: at it, not beside the
// house. It is in front of the wall at this point rather than behind it, which
// is what makes this the pet arriving at its own front door instead of walking
// into the side of a building.
//
// Roughly half the pet clear of the opening, so the door has somewhere to swing
// and the last movement is a step across rather than a shuffle on the spot.
const PET_W = 120;
const DOOR_STAND = 78;

// How far the pet walks between its own spot and the door. Measured as the walk
// rather than as the distance to the house, because the walk is the part
// anybody sees.
const HOUSE_WALK = 190;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise(requestAnimationFrame);

const houseBack = document.getElementById('house-back');
const house = document.getElementById('house');
const houseDoor = document.getElementById('house-door');

let leaving = false;

/**
 * Stand a house next to a pet whose middle is at `petMiddle`, and work out where
 * that pet stands to use the door.
 *
 * Shared by both directions so they are the same house in the same place: the
 * pet comes out of a house exactly where it will later walk back into one.
 */
function setHouse(petMiddle) {
  const half = stage.offsetWidth / 2;
  const want = petMiddle < window.innerWidth / 2 ? 1 : -1;

  // Where the door goes, and the house is hung off it - not the other way round.
  //
  // setXY clamps the stage to the window and the pet stands in the middle of a
  // 340px stage, so the pet can never get its own middle within half a stage of
  // either edge. Place the house first and clamp that, and near an edge you get
  // a house whose door is somewhere the pet is not allowed to stand: it walks as
  // far as it is permitted, shrinks, and stops beside the house. Clamping the
  // door instead means the spot the pet is aiming at is always reachable, and
  // the house follows it inward.
  const door = Math.min(
    Math.max(
      petMiddle + want * (HOUSE_WALK + DOOR_STAND),
      half,           // as far left as the pet can stand
      6 + DOOR_MID    // ...and as far left as the house fits
    ),
    window.innerWidth - half,
    window.innerWidth - 6 - HOUSE_W + DOOR_MID
  );
  const houseX = door - DOOR_MID;

  house.style.left = `${Math.round(houseX)}px`;
  // The recess lines up with the hole in the facade rather than with the house.
  houseBack.style.left = `${Math.round(houseX + DOOR_X)}px`;

  // Which side of the door the pet uses, decided by where the door actually
  // landed rather than which half of the screen the pet started in. Clamped
  // against an edge the door can end up behind the pet, and then the side it was
  // going to approach from is the wrong one - it walks through the house to
  // stand on the far side, which looks like the pet arriving from round the back.
  const side = door >= petMiddle ? 1 : -1;
  const room = window.innerWidth - stage.offsetWidth;
  const stand = (x) => Math.max(0, Math.min(room, x - half));

  return { door: stand(door), beside: stand(door - side * DOOR_STAND) };
}

/**
 * The app just started. The pet is already where you left it - put its house
 * around the corner, open the door, and let it walk out to the spot it was
 * going to be standing on anyway.
 *
 * Deliberately not its own animation: it is the goodbye backwards, so a session
 * opens and closes on the same shot.
 */
async function arrive() {
  // Where it goes back to, read off the screen rather than off stageX. At launch
  // the two agree, but they part company the moment anything has moved the stage
  // without going through setXY - and an arrival that ends somewhere other than
  // where the pet was left has moved the pet behind the user's back.
  snap(stage.getBoundingClientRect().left, stageTop);
  await frame();
  const back = { x: stageX, top: stageTop };
  const { door, beside } = setHouse(stageX + stage.offsetWidth / 2);

  busy = true;
  stage.classList.add('is-leaving', 'is-stepping', 'is-entering', 'is-inside');

  // Shut, lit, and in front of the pet: exactly the state the house was left in.
  house.classList.add('is-shut', 'is-close');
  for (const el of [houseBack, house]) el.hidden = false;

  // Put the pet in the doorway without it travelling there. Nothing to see - the
  // door is shut and the wall is in front of it - but it has to be standing in
  // the right place before the door opens.
  snap(door, roomY());
  await frame();
  await frame();
  stage.classList.remove('is-inside', 'is-dragging');

  // Let the house finish coming out of the ground before anything opens.
  await wait(HOUSE_GONE_MS);
  if (leaving) return;

  house.classList.remove('is-shut');
  houseDoor.classList.add('is-open');
  await wait(DOOR_MS);
  if (leaving) return;

  // Out. The wall drops behind the pet first, while the pet is still centred in
  // the opening and smaller than it, so nothing visibly jumps - the same frame
  // the wall came forward on, in reverse.
  house.classList.remove('is-close');
  stage.classList.remove('is-entering');
  setXY(beside, roomY());
  move('walk', INSIDE_MS);
  await wait(INSIDE_MS);
  if (leaving) return;

  // And away, while the house shuts up behind it.
  stage.classList.remove('is-stepping');
  setXY(back.x, back.top);
  move('walk', WALK_MS);
  houseDoor.classList.remove('is-open');
  await wait(DOOR_MS);
  if (leaving) return;

  for (const el of [houseBack, house]) el.classList.add('is-going');
  await wait(HOUSE_GONE_MS);
  if (leaving) return;

  for (const el of [houseBack, house]) {
    el.hidden = true;
    el.classList.remove('is-going');
  }

  // Not free until it has finished walking, or the wander schedule takes over
  // mid-stride and the pet never reaches the spot it was left on.
  await wait(Math.max(0, WALK_MS - DOOR_MS - HOUSE_GONE_MS));
  if (leaving) return;

  stage.classList.remove('is-leaving');
  busy = false;
}

/**
 * Quit was pressed. Walk to the house, step inside, shut the door, turn the
 * light on, and take the house away again.
 *
 * The main process is holding a timer of its own the whole time, so nothing in
 * here has to be reliable enough to quit on - the worst a thrown error can do is
 * make the goodbye abrupt.
 */
async function leave() {
  if (leaving) return;
  leaving = true;
  // Everything that would otherwise move it: the wander schedule reads busy, and
  // the bubble, menu and chat go the moment is-leaving lands.
  busy = true;

  // Quit can land in the middle of a wander, and mid-wander stageX is where the
  // pet is going rather than where it is - the transition is still running. Put
  // it down where it actually is before measuring anything, or the house is
  // placed around a pet that has not arrived yet, and can be built on top of the
  // one on screen. One frame for the snap to take, then the walk.
  snap(stage.getBoundingClientRect().left, stageTop);
  await frame();
  await frame();

  const { door, beside } = setHouse(stageX + stage.offsetWidth / 2);
  stage.classList.add('is-leaving');
  stage.classList.remove('is-stepping', 'is-entering', 'is-inside');
  for (const el of [houseBack, house]) {
    el.hidden = false;
    el.classList.remove('is-going');
  }
  house.classList.remove('is-shut', 'is-close');

  // Up to the front door, on the floor whatever it was standing on when Quit was
  // pressed.
  setXY(beside, roomY());
  move('walk', WALK_MS);

  // Opened during the walk rather than on arrival. A door that opens once the
  // pet is already standing at it makes the pet look like it is waiting to be
  // let in; open as it arrives, it looks expected.
  await wait(Math.max(0, WALK_MS - DOOR_MS));
  houseDoor.classList.add('is-open');
  await wait(DOOR_MS);

  // In. A step sideways into the opening, shrinking as it goes because it is
  // walking away from the viewer as well as across - and dimming, because the
  // room it is stepping into has no light on yet.
  stage.classList.add('is-stepping', 'is-entering');
  setXY(door, roomY());
  move('walk', INSIDE_MS);
  await wait(INSIDE_MS);

  // Only now does the wall come forward. The pet is centred in the opening and
  // smaller than it at this exact moment, so nothing is overlapping the facade
  // and the swap costs nothing visually - a frame earlier and the pet visibly
  // disappears into brickwork on its way to the door.
  house.classList.add('is-close');

  houseDoor.classList.remove('is-open');
  await wait(DOOR_MS);

  house.classList.add('is-shut');

  // And now it can go. Up to this point the pet is on screen and merely covered
  // by the wall, which is what makes going in read as going in - but the house
  // leaves in a moment, and an occluder that leaves gives the pet back. Taken
  // off behind a shut door, so there is nothing to see happen.
  stage.classList.add('is-inside');

  await wait(LIGHT_MS);

  for (const el of [houseBack, house]) el.classList.add('is-going');
  await wait(HOUSE_GONE_MS);

  window.pet.left();
}

window.pet.onEnter(arrive);
window.pet.onLeave(leave);
