'use strict';

const stage = document.getElementById('stage');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const menu = document.getElementById('menu');
const hearts = document.getElementById('hearts');
// Not `pet`: contextBridge already exposes a global by that name, and a
// top-level const of the same name is a parse error that kills this whole file.
const petEl = document.getElementById('pet');

let hideTimer = null;
let hovered = false;
let interactive = false;
let busy = false; // thinking - hold still and stop wandering

// ---- speech --------------------------------------------------------------

function say(text, { kind = 'answer', sticky = false } = {}) {
  clearTimeout(hideTimer);
  bubbleText.textContent = text;
  bubble.classList.toggle('is-error', kind === 'error');
  bubble.classList.toggle('is-nag', kind === 'nag');
  bubbleText.classList.toggle('dots', kind === 'thinking');
  bubble.hidden = false;
  bubbleText.scrollTop = 0;
  if (sticky) return;
  // Roughly reading time, floored at 8s and capped at a minute.
  const ms = Math.min(60000, Math.max(8000, text.length * 55));
  hideTimer = setTimeout(() => { bubble.hidden = true; }, ms);
}

window.pet.onSay(({ text, kind }) => {
  busy = kind === 'thinking';
  petEl.classList.toggle('is-thinking', busy);
  say(text, { kind, sticky: busy });
});

// ---- stats ---------------------------------------------------------------

window.pet.onStats((s) => {
  petEl.dataset.mood = s.mood;
  for (const el of document.querySelectorAll('[data-bar]')) {
    el.style.width = `${Math.round(s[el.dataset.bar])}%`;
  }
  if (s.acted) {
    petEl.classList.remove('is-eating', 'is-playing');
    void petEl.offsetWidth; // restart the animation
    if (s.acted === 'feed') petEl.classList.add('is-eating');
    if (s.acted === 'play') petEl.classList.add('is-playing');
    if (s.acted === 'pet') popHearts();
  }
  if (s.refused) say(s.refused, { kind: 'nag' });
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
  return boxes;
}

function setInteractive(v) {
  if (v === interactive) return;
  interactive = v;
  window.pet.setInteractive(v);
}

document.addEventListener('mousemove', (e) => {
  const inside = hitZone().some(
    (b) => e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom
  );
  if (inside !== hovered) {
    hovered = inside;
    petEl.classList.toggle('is-hovered', inside);
  }
  setInteractive(inside);
});

// ---- interactions --------------------------------------------------------

petEl.addEventListener('click', () => {
  menu.hidden = true;
  window.pet.act('pet');
});

petEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  menu.hidden = !menu.hidden;
  // The menu sits where the bubble does; showing both at once is a mess.
  if (!menu.hidden) {
    clearTimeout(hideTimer);
    bubble.hidden = true;
  }
});

menu.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  menu.hidden = true;
  if (btn.dataset.act) window.pet.act(btn.dataset.act);
  else if (btn.hasAttribute('data-ask')) window.pet.ask();
  else if (btn.hasAttribute('data-quit')) window.pet.quit();
});

// ---- wandering -----------------------------------------------------------
// The window never moves. Moving a transparent always-on-top window at 60fps is
// janky and burns CPU on an app that is idle 99% of the time; translating one
// div is free and smoother.

function wander() {
  const idle = !hovered && !busy && bubble.hidden && menu.hidden;
  if (idle) {
    const limit = Math.max(0, window.innerWidth - stage.offsetWidth);
    stage.style.transform = `translateX(${Math.round(Math.random() * limit)}px)`;
  }
  setTimeout(wander, 25000 + Math.random() * 45000);
}

// Start somewhere on the right, where a taskbar pet belongs.
stage.style.transform = `translateX(${Math.max(0, window.innerWidth - stage.offsetWidth - 40)}px)`;
setTimeout(wander, 12000);
