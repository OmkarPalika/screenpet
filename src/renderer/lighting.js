'use strict';

// How the pet is lit, in one place.
//
// The shapes are flat paths and stay flat paths: ten species, forty faces and
// nine outfits hang off them, and none of that survives being redrawn as a
// mesh. What makes something look solid on a screen is not geometry, it is
// light - so the geometry is left alone and a light is put on it.
//
// SVG filters do this to any shape at all, which is the whole reason this is
// eleven lines rather than ten models: blur the shape's own alpha to get a
// surface that falls away at the edges, light that surface, and put the result
// back over the colour. A new species is still one path in pets.css and it
// arrives already round.
//
// Loaded by every document that draws a pet - the pet window, the settings
// previews and the demo stage - so a preview cannot be lit differently from the
// thing it is previewing.

// Up and to the left, in front. The same direction for every pet, because two
// pets on one screen lit from two directions is the thing that reads as wrong.
const LIGHT = { x: 24, y: 4, z: 58 };

// How far the surface appears to fall away at the edge. Higher is a fatter
// bevel; past about 9 the pet reads as a balloon rather than a body.
const BEVEL = 6;

// How much of the pet's own colour survives with no light on it at all. The
// light in a room does not come only from the lamp, and a pet that goes pitch
// black the moment the lamp is behind it reads as a bug rather than as shading.
const AMBIENT = 0.45;

const DEFS = `
<filter id="pet-volume" x="-25%" y="-25%" width="150%" height="150%">
  <!-- The shape's own alpha, blurred, is the surface to light. -->
  <feGaussianBlur in="SourceAlpha" stdDeviation="${BEVEL}" result="surface" />

  <!-- Diffuse first: bright where the surface faces the light, dark where it
       turns away. Multiplied over the colour, so it shades any skin. -->
  <feDiffuseLighting in="surface" surfaceScale="4.5" diffuseConstant="1.05"
                     lighting-color="#fff" result="shade">
    <fePointLight x="${LIGHT.x}" y="${LIGHT.y}" z="${LIGHT.z}" />
  </feDiffuseLighting>
  <!-- The rest of the room. Without it, the moment the light swings behind the
       pet - which is exactly what happens halfway through a spin - the multiply
       has nothing to multiply by and the pet turns into a silhouette. Nothing
       real does that: a toy on a desk with the lamp behind it is dark on this
       side, not absent. AMBIENT is the floor under the shading. -->
  <feComponentTransfer in="shade" result="shade">
    <feFuncR type="linear" slope="${1 - AMBIENT}" intercept="${AMBIENT}" />
    <feFuncG type="linear" slope="${1 - AMBIENT}" intercept="${AMBIENT}" />
    <feFuncB type="linear" slope="${1 - AMBIENT}" intercept="${AMBIENT}" />
  </feComponentTransfer>
  <feComposite in="shade" in2="SourceAlpha" operator="in" result="shade" />
  <feBlend in="SourceGraphic" in2="shade" mode="multiply" result="lit" />

  <!-- Then the highlight: a small bright spot where the light hits square on.
       Tight exponent, or it spreads into a sheen and the pet looks wet. -->
  <feSpecularLighting in="surface" surfaceScale="4" specularConstant="0.5"
                      specularExponent="24" lighting-color="#fff" result="gloss">
    <fePointLight x="${LIGHT.x}" y="${LIGHT.y}" z="${LIGHT.z}" />
  </feSpecularLighting>
  <feComposite in="gloss" in2="SourceAlpha" operator="in" result="gloss" />
  <feComposite in="gloss" in2="lit" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" />
</filter>

<!-- The shadow it stands on. A hard ellipse is a sticker; a blurred one is
     contact, and contact is most of what says the pet is on a surface. -->
<filter id="pet-soft" x="-50%" y="-100%" width="200%" height="300%">
  <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" />
</filter>
`;

// The middle of the pet in its own viewBox, which is the axis every turn in
// style.css goes round.
const CENTRE_X = 60;

/**
 * Where the light is once the pet has turned this far.
 *
 * The filter is applied in the pet's own coordinates, before the CSS transform,
 * so a highlight painted on the shape turns with it. That is exactly what a
 * sticker does, and it is what gave the spin away: halfway round the pet is
 * mirrored and the bright side is the side facing away from the lamp.
 *
 * A real object keeps its highlight where the lamp is. So the shape is left to
 * rotate and the light is rotated the other way about the same axis:
 *
 *   x' = cx + dx·cosθ + z·sinθ
 *   z' =      -dx·sinθ + z·cosθ
 *
 * The part that sells it falls out for free. Past a quarter turn z' goes
 * negative, which is the lamp being behind the pet, and the side you are looking
 * at goes dark on its own.
 */
function lightFor(deg) {
  const t = (deg * Math.PI) / 180;
  const dx = LIGHT.x - CENTRE_X;
  return {
    x: CENTRE_X + dx * Math.cos(t) + LIGHT.z * Math.sin(t),
    z: -dx * Math.sin(t) + LIGHT.z * Math.cos(t),
  };
}

/** Put the light where the lamp is, given how far the pet has turned. */
function aimLight(deg, doc = document) {
  const at = lightFor(deg);
  for (const el of doc.querySelectorAll('#pet-volume fePointLight')) {
    el.setAttribute('x', at.x.toFixed(1));
    el.setAttribute('z', at.z.toFixed(1));
  }
}

/**
 * How far something has been turned about the vertical axis, read back out of
 * its computed transform.
 *
 * Read rather than counted, so it cannot drift out of step with the stylesheet:
 * the duration, the easing and the number of turns all live in style.css, and
 * re-implementing any of them here would put the light a little behind the body
 * on every frame. m11 is the cosine and m31 the sine - measured rather than
 * reasoned about, because both conventions are defensible and only one is
 * Chromium's.
 */
function turnedBy(el) {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  const m = new DOMMatrixReadOnly(t);
  return (Math.atan2(m.m31, m.m11) * 180) / Math.PI;
}

/**
 * Put the filters in a document. A zero-sized svg holding nothing but defs:
 * filters are referenced by id from anywhere in the document, so this does not
 * have to be near the pet and must not take up any room.
 */
function installLighting(doc = document) {
  if (doc.getElementById('pet-lighting')) return;
  const holder = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  holder.id = 'pet-lighting';
  holder.setAttribute('width', '0');
  holder.setAttribute('height', '0');
  holder.setAttribute('aria-hidden', 'true');
  // Sized and hidden by a rule in pets.css rather than a style attribute, which
  // the content security policy blocks outright. Not display:none either -
  // Chromium drops filters defined inside a hidden subtree.
  holder.innerHTML = `<defs>${DEFS}</defs>`;
  doc.body.prepend(holder);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFS, LIGHT, BEVEL, CENTRE_X, lightFor, aimLight, turnedBy, installLighting };
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => installLighting());
} else {
  installLighting();
}
