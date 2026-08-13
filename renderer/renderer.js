'use strict';

const stage = document.getElementById('stage');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const menu = document.getElementById('menu');
const hearts = document.getElementById('hearts');
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

function express(name, ms = 2600) {
  clearTimeout(exprTimer);
  if (!name) { delete petEl.dataset.expr; return; }
  petEl.dataset.expr = name;
  exprTimer = setTimeout(() => { delete petEl.dataset.expr; }, ms);
}

window.pet.onSay(({ text, kind, expr }) => {
  busy = kind === 'thinking';
  petEl.classList.toggle('is-thinking', busy);
  // Thinking holds its face until the answer lands, so no timeout on it.
  if (busy) express('hmm', 600000);
  else express(expr || null, Math.min(20000, Math.max(2600, text.length * 55)));
  say(text, { kind, sticky: busy });
});

// A bubble in the way is a bubble you want gone.
bubble.addEventListener('click', () => { if (!busy) bubble.hidden = true; });

// ---- stats ---------------------------------------------------------------

window.pet.onStats((s) => {
  petEl.dataset.mood = s.mood;
  for (const el of document.querySelectorAll('[data-bar]')) {
    el.style.width = `${Math.round(s[el.dataset.bar])}%`;
  }
  if (s.acted) {
    petEl.classList.remove('is-eating', 'is-playing', 'is-tickled');
    void petEl.offsetWidth; // restart the animation
    if (s.acted === 'feed') petEl.classList.add('is-eating');
    if (s.acted === 'play') petEl.classList.add('is-playing');
    if (s.acted === 'tickle') petEl.classList.add('is-tickled');
    if (s.acted === 'pet') popHearts();
  }
  refreshMenu(s);
});

function refreshMenu(s) {
  menu.querySelector('[data-act="feed"]').disabled = s.fullness >= 92;
  menu.querySelector('[data-act="play"]').disabled = s.energy < 20;
}

function popHearts() {
  for (let i = 0; i < 3; i++) {
    const h = document.createElement('span');
    h.className = 'heart';
    h.textContent = '♥';
    h.style.left = `${28 + i * 26}px`;
    h.style.animationDelay = `${i * 90}ms`;
    hearts.append(h);
    setTimeout(() => h.remove(), 1100);
  }
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

window.pet.onSkin((skin) => { document.documentElement.dataset.skin = skin; });

// ---- wandering -----------------------------------------------------------
// The window never moves. Moving a transparent always-on-top window at 60fps is
// janky and burns CPU on an app that is idle 99% of the time; translating one
// div is free and smoother.

let stageX = 0;

function setX(x) {
  stageX = Math.max(0, Math.min(window.innerWidth - stage.offsetWidth, x));
  stage.style.transform = `translateX(${Math.round(stageX)}px)`;
}

function wander() {
  const idle = !hovered && !busy && !held && bubble.hidden && menu.hidden && chatForm.hidden;
  if (idle) setX(Math.random() * (window.innerWidth - stage.offsetWidth));
  setTimeout(wander, 25000 + Math.random() * 45000);
}

// Start somewhere on the right, where a taskbar pet belongs.
setX(window.innerWidth - stage.offsetWidth - 40);
setTimeout(wander, 12000);
