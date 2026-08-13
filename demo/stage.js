'use strict';

// Drives the demo stage. The recorder calls these over executeJavaScript; the
// visuals themselves are the real pet stylesheet, not a mock-up of it.

const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const badge = document.getElementById('badge');
const fx = document.getElementById('fx');
const petEl = document.getElementById('pet');
const petLayer = document.getElementById('pet-layer');

window.demo = {
  hidePet() { petLayer.hidden = true; },
  showPet() { petLayer.hidden = false; },

  badge(on) { badge.classList.toggle('on', on); },

  thinking() {
    petEl.classList.add('is-thinking');
    bubbleText.textContent = 'thinking';
    bubbleText.classList.add('dots');
    bubble.hidden = false;
  },

  answer(text) {
    petEl.classList.remove('is-thinking');
    bubbleText.classList.remove('dots');
    bubbleText.textContent = text;
    bubble.hidden = false;
    // Re-trigger the pop animation so the answer lands visibly.
    bubble.style.animation = 'none';
    void bubble.offsetWidth;
    bubble.style.animation = '';
  },

  mood(m) { petEl.dataset.mood = m; },

  expr(e) {
    if (e) petEl.dataset.expr = e;
    else delete petEl.dataset.expr;
  },

  pet(name) { document.documentElement.dataset.pet = name; },

  // The same class the renderer toggles; which movement it produces is the
  // stylesheet's business here exactly as it is in the app.
  quirk() {
    petEl.classList.remove('is-idling');
    void petEl.offsetWidth;
    petEl.classList.add('is-idling');
    setTimeout(() => petEl.classList.remove('is-idling'), 2600);
  },

  // Whole-body movements, the same data-move attribute the renderer sets. The
  // animations come from the app's stylesheet, so what the clip shows is what
  // the app does.
  move(name, ms = 2400) {
    delete petEl.dataset.move;
    void petEl.offsetWidth;
    petEl.dataset.move = name;
    setTimeout(() => { delete petEl.dataset.move; }, ms);
  },

  // The app walks by translating the stage under a CSS transition and running
  // the step cycle for exactly as long as it lasts. Same here, so the walk in
  // the clip is the walk in the app rather than a slide staged for the camera.
  walkTo(x, ms = 2200) {
    petLayer.style.transition = `transform ${ms}ms cubic-bezier(0.4, 0, 0.25, 1)`;
    petLayer.style.transform = `translateX(${x}px)`;
    window.demo.move('walk', ms);
  },

  // Same shape as the renderer's rain(): the stylesheet decides how a falling
  // thing moves, this only picks what falls and from where.
  rain(chars, count = 5) {
    // One feeling at a time, the same rule the renderer follows - without this
    // the hearts are still falling through the confetti.
    fx.replaceChildren();
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = 'drop';
      el.textContent = chars[i % chars.length];
      el.style.left = `${4 + Math.random() * 92}px`;
      el.style.setProperty('--fall', `${38 + Math.random() * 38}px`);
      el.style.animationDelay = `${i * (70 + Math.random() * 60)}ms`;
      fx.append(el);
      setTimeout(() => el.remove(), 2600);
    }
  },

  headpat() { window.demo.rain(['💕', '💖', '💗']); },
};
