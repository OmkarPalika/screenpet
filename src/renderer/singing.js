'use strict';

// Telling singing from talking, out of the same spectrum the beat listener is
// already looking at forty times a second.
//
// Nothing new is opened for this. The microphone is already live whenever the
// pet is bopping along or has been asked to dance, and this reads the bins that
// were being read anyway - so there is no second consent to give, no second
// thing to switch off, and the same rule holds as for the beat: what arrives is
// a spectrum and what leaves is one boolean. A bin count cannot be speech.
//
// ponytail: no pitch tracker. Proper singing detection wants autocorrelation,
// note segmentation and a vibrato test, and this has to answer every 25ms on a
// machine that is also running a language model. What it uses instead is the
// one difference between singing and talking that is visible in a magnitude
// spectrum without any of that:
//
//   talking drops out. Every consonant is a gap, and a spoken vowel rarely
//   lasts a fifth of a second.
//   singing holds. A note is held, and holding is the entire point of it.
//
// So: a held, tonal, voice-band sound. That is also why humming counts, which
// is correct, and why a long "aaaaah" counts, which is close enough - and why a
// sustained church organ would count too, which is the honest ceiling here. The
// upgrade is a pitch tracker looking for notes that change; it is a real amount
// of work and nobody has been annoyed by an over-enthusiastic pet yet.
//
// Everything lives inside the closure and exactly one name reaches the page.
// That is not tidiness. These are classic scripts sharing one top level scope,
// so a `const QUIET` here and a `const QUIET` in renderer.js is not a shadowed
// variable - it is a redeclaration, which is a parse error, which takes the
// whole renderer down before it draws anything. This file was written the
// obvious way round first and that is exactly what happened; verify-ui.js
// caught it, which is the bug that file was written for in the first place.
const singing = (() => {
  // The voice band. A sung vowel puts its fundamental and first few harmonics
  // in here; a kick drum sits below it, and a cymbal, a hiss and a fan are
  // spread across everything.
  const LO_HZ = 150;
  const HI_HZ = 1200;

  // How peaked that band has to be against its own mean. A vowel is a
  // fundamental with harmonics falling away above it and troughs between them;
  // room noise is flat. Flat is what this rejects, and it does most of the work.
  //
  // Deliberately generous, because the two ways of being wrong are not the same
  // size. Too eager and the pet occasionally compliments a hum or a held vowel
  // in ordinary speech, which is a pet. Too strict and it never notices you
  // singing at all - a feature that looks broken, and the one nobody can debug,
  // because there is nothing on screen to say it listened and decided no.
  const PEAK = 2.2;

  // Below this the room is quiet rather than singing, and this is what keeps
  // the pet from praising the neighbours: a radio two rooms away has exactly
  // the shape of a voice and a fortieth of the level. Together with PEAK these
  // are the two numbers that will need moving on a different microphone in a
  // different room - the same thing that is true of the wake word's confidence
  // floor and of dictation's.
  const QUIET = 0.06;

  // How long it has to hold. Comfortably past a spoken vowel and comfortably
  // inside a sung one.
  const HOLD_MS = 900;

  // A gap this short is a consonant, not the end of the singing. Sung words
  // have consonants in them too, and resetting on every one of them means
  // nothing ever reaches HOLD_MS.
  const BREAK_MS = 220;

  // One reaction per performance rather than one per note. A pet that praises
  // every bar is a pet you sing at once.
  const AGAIN_MS = 12000;

  /**
   * Is this one frame a held, tonal, voice-band sound?
   *
   * @param {Uint8Array} bins  magnitudes, as getByteFrequencyData leaves them
   * @param {number} hzPerBin  the width of one bin
   */
  function voiced(bins, hzPerBin) {
    if (!bins || !bins.length || !(hzPerBin > 0)) return false;
    // Rounded up, so the band starts at the first bin entirely above LO_HZ. A
    // bin that straddles it carries the top of a kick drum, and one loud bin at
    // the bottom edge looks exactly like a fundamental with nothing above it -
    // rounding down measured a drum as a voice. The max is the separate
    // question of bin 0, which is DC and is never anything.
    const lo = Math.max(1, Math.ceil(LO_HZ / hzPerBin));
    const hi = Math.min(bins.length, Math.ceil(HI_HZ / hzPerBin));
    if (hi - lo < 3) return false; // too coarse a spectrum to say anything

    let sum = 0;
    let peak = 0;
    for (let i = lo; i < hi; i++) {
      sum += bins[i];
      if (bins[i] > peak) peak = bins[i];
    }
    const mean = sum / (hi - lo);
    if (mean / 255 < QUIET) return false;
    return peak / mean >= PEAK;
  }

  /**
   * The tracker. Fed one frame at a time, answers true exactly once per
   * performance - on the frame the holding has gone on long enough to count.
   *
   * A closure rather than module state, so the beat listener starting again
   * gets a tracker that has forgotten the last one, and the tests can run
   * several at once.
   *
   * @returns {(bins: Uint8Array, hzPerBin: number, now: number) => boolean}
   */
  function tracker() {
    let since = 0;   // when this stretch of holding started
    let heardAt = 0; // and when it last counted for anything
    let lastAt = 0;  // the last frame that was voiced at all

    return (bins, hzPerBin, now) => {
      if (!voiced(bins, hzPerBin)) {
        // Nothing to do but wait. The stretch is not ended here: the lines
        // below start a new one whenever the last voiced frame was longer ago
        // than a consonant, so ending it here as well cannot change any answer.
        // Which is exactly what happened when that line was removed to see
        // whether anything noticed, and nothing did.
        return false;
      }
      // A gap longer than a consonant means this is a new stretch rather than
      // the same one carrying on.
      if (!since || now - lastAt > BREAK_MS) since = now;
      lastAt = now;

      if (now - since < HOLD_MS) return false;
      if (heardAt && now - heardAt < AGAIN_MS) return false;
      heardAt = now;
      // Held long enough, and said so. The stretch is not reset: the singing
      // has not stopped, and AGAIN_MS is what keeps it from counting twice.
      return true;
    };
  }

  return { voiced, tracker, LO_HZ, HI_HZ, PEAK, QUIET, HOLD_MS, BREAK_MS, AGAIN_MS };
})();

if (typeof module !== 'undefined') module.exports = singing;
