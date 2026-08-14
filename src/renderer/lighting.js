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
  module.exports = { DEFS, LIGHT, BEVEL, installLighting };
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => installLighting());
} else {
  installLighting();
}
