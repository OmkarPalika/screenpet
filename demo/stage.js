'use strict';

// Drives the demo stage. The recorder calls these over executeJavaScript; the
// visuals themselves are the real pet stylesheet, not a mock-up of it.

const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const badge = document.getElementById('badge');
const hearts = document.getElementById('hearts');
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

  headpat() {
    for (let i = 0; i < 3; i++) {
      const h = document.createElement('span');
      h.className = 'heart';
      h.textContent = '♥';
      h.style.left = `${28 + i * 26}px`;
      h.style.animationDelay = `${i * 90}ms`;
      hearts.append(h);
      setTimeout(() => h.remove(), 1100);
    }
  },
};
