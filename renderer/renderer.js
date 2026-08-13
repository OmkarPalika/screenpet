'use strict';

const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
// Not `pet`: contextBridge already exposes a global by that name, and a
// top-level const of the same name is a parse error that kills this whole file.
const petEl = document.getElementById('pet');

let hideTimer = null;

function show(text, { error = false, sticky = false } = {}) {
  clearTimeout(hideTimer);
  bubbleText.textContent = text;
  bubble.classList.toggle('is-error', error);
  bubble.hidden = false;
  bubbleText.scrollTop = 0;

  if (sticky) return;
  // Give roughly reading time, floored at 8s and capped at a minute.
  const ms = Math.min(60000, Math.max(8000, text.length * 55));
  hideTimer = setTimeout(() => { bubble.hidden = true; }, ms);
}

window.pet.onState((state) => {
  if (state.status === 'thinking') {
    petEl.classList.add('is-thinking');
    show('thinking', { sticky: true });
    bubbleText.classList.add('dots');
    return;
  }
  petEl.classList.remove('is-thinking');
  bubbleText.classList.remove('dots');
  show(state.text, { error: state.status === 'error' });
});
