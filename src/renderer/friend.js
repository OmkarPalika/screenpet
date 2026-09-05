'use strict';

// Another pet, on this network.
//
// Everything here is drawing. What may arrive is decided in core/playdate.js and
// checked before it reaches the main process, so by the time anything gets here
// it is a species from a list of ten, a palette from a list of ten, a hat from a
// list of nine, a mood word, a bond number, a name that has been through the
// same cleaner the pet's own name goes through, and one verb from a list of ten.
// Nothing on this side interprets a string: the name is set with textContent and
// everything else picks a CSS attribute value out of a fixed set.
//
// The friend is a `.pet`, not a picture of one. Same class, same SVG - cloned
// from the pet at startup rather than written out twice - and the same
// data-pet / data-skin / data-wear / data-mood / data-expr / data-move
// attributes, so every species, palette, hat, face and movement the pet has, the
// friend has too, and a new one is new for both. What it deliberately does not
// have is a bubble, stat bars, a glass, a gaze or a menu: it is a guest, not a
// second pet you own.
//
// One name at the top level, like singing.js, because these are classic scripts
// and two files declaring the same const is a parse error that kills the window.

const friend = (() => {
  const el = document.getElementById('friend');
  const fx = document.getElementById('friend-fx');
  const tag = document.getElementById('friend-name');
  const mine = document.getElementById('pet');

  // The SVG, once. Cloned rather than duplicated in the HTML so the two can
  // never drift: a shape added to the pet is a shape the friend has.
  const svg = mine.querySelector('svg').cloneNode(true);
  // The clone carries the pet's own id-less markup, but not its identity: the
  // mouth has an id in the original and two of those in one document is invalid.
  for (const node of svg.querySelectorAll('[id]')) node.removeAttribute('id');
  el.append(svg);

  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  // ---- the party ----------------------------------------------------------
  // Only for the first time two pets have ever met. Confetti every reconnection
  // is not confetti, it is weather.

  const COLOURS = ['#f4b942', '#ef6f6c', '#5bc0be', '#9b7ede', '#7fd18f', '#f38ba8'];
  const PIECES = 46;
  const PARTY_MS = 2400;

  let partyTimer = null;

  function party(host = document.getElementById('stage')) {
    clearTimeout(partyTimer);
    const box = document.createElement('div');
    box.className = 'confetti';
    for (let i = 0; i < PIECES; i++) {
      const bit = document.createElement('i');
      // CSSOM setters, not a style attribute: the CSP here is style-src 'self',
      // which permits these and blocks the attribute.
      bit.style.background = COLOURS[i % COLOURS.length];
      // Wide enough to cover both pets from above, and falling far enough to
      // land past their feet rather than stopping at their faces.
      bit.style.left = `${rand(-165, 165).toFixed(0)}px`;
      bit.style.setProperty('--dx', `${rand(-60, 60).toFixed(0)}px`);
      bit.style.setProperty('--dy', `${rand(120, 250).toFixed(0)}px`);
      bit.style.setProperty('--spin', `${rand(-900, 900).toFixed(0)}deg`);
      bit.style.setProperty('--for', `${rand(1500, PARTY_MS).toFixed(0)}ms`);
      bit.style.animationDelay = `${rand(0, 600).toFixed(0)}ms`;
      box.append(bit);
    }
    host.append(box);
    partyTimer = setTimeout(() => box.remove(), PARTY_MS + 800);
  }

  // ---- what falls out of the sky for each shared activity ------------------
  // The same idea as the pet's own expression rain, and deliberately a different
  // table: these are about two of them rather than one, so the hearts are a pair
  // and the music is a duet.
  const EMOJI = {
    wave: ['👋', '✨'],
    bounce: ['💫', '✨'],
    dance: ['🎵', '🎶', '✨'],
    cheer: ['👏', '🎉'],
    hug: ['💞', '🤗'],
    spin: ['💫', '⭐'],
    nap: ['💤', '🌙'],
    snack: ['🍪', '🍰'],
    sing: ['🎵', '🎤', '🎶'],
    party: ['🎉', '🎊', '🥳'],
  };

  function rain(act) {
    const chars = EMOJI[act];
    if (!chars) return;
    fx.replaceChildren();
    for (let i = 0; i < 5; i++) {
      const drop = document.createElement('span');
      drop.className = 'drop';
      drop.textContent = chars[i % chars.length];
      drop.style.left = `${rand(4, 96).toFixed(0)}px`;
      drop.style.setProperty('--fall', `${rand(38, 76).toFixed(0)}px`);
      drop.style.animationDelay = `${(i * rand(70, 130)).toFixed(0)}ms`;
      drop.style.fontSize = `${rand(12, 19).toFixed(0)}px`;
      fx.append(drop);
      setTimeout(() => drop.remove(), 2600);
    }
  }

  // ---- coming and going ----------------------------------------------------

  const ARRIVE_MS = 900;
  const LEAVE_MS = 700;

  let goneTimer = null;
  let moveTimer = null;
  let exprTimer = null;
  let here = null; // the id currently on screen, or null

  /**
   * Somebody turned up.
   *
   * @param {object} card  a validated pet card - see core/playdate.js
   * @param {boolean} first  the first time these two have ever met
   */
  function show(card, first = false) {
    if (!card || typeof card !== 'object') return;
    clearTimeout(goneTimer);
    const changed = here !== card.id;
    here = card.id;
    // Attribute values, not markup. Each of these is one of a fixed set on the
    // far side of the validator, and an unknown one simply matches no rule.
    el.dataset.pet = card.pet;
    el.dataset.skin = card.skin;
    el.dataset.wear = card.wear || 'none';
    el.dataset.mood = card.mood || 'neutral';
    // The one string a person chose, and the only one that ever crosses. Set as
    // text, never as markup, and hidden entirely when they did not name theirs.
    tag.textContent = card.name || '';
    tag.hidden = !card.name;
    el.hidden = false;
    el.classList.remove('is-leaving');
    if (changed) {
      el.classList.remove('is-arriving');
      void el.offsetWidth; // restart the walk-in
      el.classList.add('is-arriving');
      setTimeout(() => el.classList.remove('is-arriving'), ARRIVE_MS);
    }
    if (first) party();
  }

  /** They went. Walks out rather than blinking off - it is a goodbye either way. */
  function hide(id = null) {
    if (id !== null && here !== id) return;
    here = null;
    if (el.hidden) return;
    clearTimeout(goneTimer);
    el.classList.remove('is-arriving');
    el.classList.add('is-leaving');
    goneTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('is-leaving');
      fx.replaceChildren();
    }, LEAVE_MS);
  }

  /**
   * They did something.
   *
   * @param {string} act  one of playdate.js's ACTS
   * @param {string} movement  the body movement, chosen by the main process
   * @param {number} ms  how long that movement runs for
   * @param {string} expr  the face, chosen by the main process
   */
  function act(name, movement, ms, expr) {
    if (el.hidden) return;
    if (movement && ms > 0) {
      clearTimeout(moveTimer);
      delete el.dataset.move;
      void el.offsetWidth; // asking for the movement it is already doing must show
      el.dataset.move = movement;
      moveTimer = setTimeout(() => { delete el.dataset.move; }, ms);
    }
    if (expr) {
      clearTimeout(exprTimer);
      delete el.dataset.expr;
      void el.offsetWidth;
      el.dataset.expr = expr;
      exprTimer = setTimeout(() => { delete el.dataset.expr; }, 2600);
    }
    rain(name);
    if (name === 'party') party();
  }

  return {
    show, hide, act, party,
    /** Whose pet is on screen, or null. The menu asks; nothing else does. */
    who: () => here,
    ARRIVE_MS, LEAVE_MS, PARTY_MS, PIECES, EMOJI, COLOURS,
  };
})();

if (typeof module !== 'undefined') module.exports = friend;
