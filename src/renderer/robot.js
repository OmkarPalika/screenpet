'use strict';

// What turns Microsoft David into something you would keep on your desk.
//
// Windows will speak a sentence but it will not hand over the audio, so the pet
// used to be stuck with whatever the platform voice sounded like - and the
// platform voice sounds like a train station. say.ps1 synthesises to a buffer
// instead, and everything below is what happens to that buffer on the way to
// the speakers.
//
// Five things, in order, and each one is doing a job:
//
//   pitch    the line is synthesised slow and played back fast. Slow-then-fast
//            raises the pitch without changing how long the sentence takes,
//            which is the difference between a small creature and a tape on the
//            wrong speed. Chromium has no pitch shifter, and this is the trick
//            that does not need one.
//   ring     a low oscillator multiplying the signal. This is the sound people
//            mean by "robot" - it is what a vocoder does to a voice, and it is
//            the one effect that is unmistakably not a human throat.
//   band     the ends cut off it, because a small machine has a small speaker
//            and the illusion is mostly the absence of chest and air.
//   grit     a soft clip. Not distortion for its own sake: it is what stops a
//            quiet consonant sounding like it came from a different room.
//   box      13ms of feedback delay - a tiny metallic resonance, the sound of
//            something being inside a case rather than in the open.
//
// It is all AudioNodes. No library, no impulse response file, nothing to load
// before the pet can talk.

// A voice the pet was given rather than one it was stuck with, played back a
// little quick. Not the slow-then-fast trick below - piper has its own speed
// knob and the two builds spell it differently, so this is done here where it
// works on both. About two semitones up and a tenth shorter: enough that a
// small creature is talking rather than an adult standing in the room, little
// enough that it is still the voice you chose.
const PET_SPEED = 1.12;

// SAPI's rate scale, and the playback rate that undoes it. -2 and 1.22 rather
// than -6 and 1.9: past about a quarter, slow synthesis stops being the same
// voice slowed down and starts being a different, mushier reading of the line,
// and speeding that up gets you the mush at a higher pitch.
const SLOW = -2;
const SPEED = 1.22;

// The robot itself. Low enough to read as a machine rather than as a bell, and
// deliberately not a round number - 50 sits right on top of mains hum and a
// listener hears it as a fault in the recording.
const RING_HZ = 52;
// Kept well under half: a full ring modulator is a Dalek, and a Dalek is not a
// pet. Most of what comes out is still the voice.
const RING_MIX = 0.3;

// The small speaker. Below the first number is chest, above the second is air,
// and a machine the size of a mug has neither.
const LOW_CUT = 170;
const HIGH_CUT = 5200;

// The case it lives in. Long enough to hear as a resonance, short enough not to
// be an echo, and the feedback low enough that it decays inside a syllable.
const BOX_S = 0.013;
const BOX_FEEDBACK = 0.18;

/** A gentle soft clip. Steeper than tanh near zero, so quiet parts come up. */
function grit(amount = 2.2) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

/**
 * The two chains, by the engine that produced the audio.
 *
 * Everything above is written about Microsoft David, and it is a rescue rather
 * than a taste: a pet that sounds like a robot on purpose beats one that sounds
 * like a kiosk by accident. Hand it a voice that already has a throat and most
 * of it becomes vandalism - so the ring modulator, which is the one effect that
 * is unmistakably not a throat, comes off entirely, and the grit and the case
 * come most of the way down.
 *
 * What is left is the part that was never about the robot: the small body. A
 * lift so it is a small creature, and a band and a 13ms case so it is coming
 * out of something the size of a mug. That is the pet - the robot was only ever
 * how it was reached with the voice Windows gives you.
 */
const VOICE = {
  sapi: {
    speed: SPEED, ring: RING_MIX, lowCut: LOW_CUT, highCut: HIGH_CUT,
    grit: 2.2, box: BOX_FEEDBACK, gain: 0.5,
  },
  piper: {
    speed: PET_SPEED, ring: 0, lowCut: 140, highCut: 7600,
    grit: 1.15, box: 0.1, gain: 0.85,
  },
};

/**
 * Play one line of speech, robot and all.
 *
 * @param {BaseAudioContext} ctx
 * @param {AudioBuffer} buffer  the decoded WAV from say.ps1
 * @param {AudioNode} dest      where it comes out
 * @returns {{stop: () => void, seconds: number}} how to stop it early, and how
 *   long it will take - the mouth animation is driven off that rather than off
 *   an event, because a mouth still moving after the sound stopped is the one
 *   failure anybody notices.
 */
function robot(ctx, buffer, dest = ctx.destination, chain = VOICE.sapi) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = chain.speed;

  // Ring modulation: the oscillator drives a gain stage whose own gain is zero,
  // so what comes out is the product of the two rather than a sum. A gain
  // AudioParam adds its inputs to its value, which is exactly the multiplication
  // wanted here and the reason this needs no custom node.
  // Built at all only when it is going to be heard. An oscillator at zero mix
  // is still an oscillator running for the length of every sentence, and the
  // chain it feeds is what the band limit at the end exists to clean up after.
  const ringing = chain.ring > 0;
  const ring = ringing ? ctx.createGain() : null;
  const osc = ringing ? ctx.createOscillator() : null;
  if (ringing) {
    ring.gain.value = 0;
    osc.type = 'sine';
    osc.frequency.value = RING_HZ;
    osc.connect(ring.gain);
  }

  const wet = ringing ? ctx.createGain() : null;
  if (ringing) wet.gain.value = chain.ring;
  const dry = ctx.createGain();
  dry.gain.value = ringing ? 1 - chain.ring : 1;

  // Two of them in series. One biquad is 12dB an octave, which measured as
  // *more* energy under the cut than the untouched voice had - everything after
  // the ring modulator puts something down there, and a gentle slope lets most
  // of it through. Two is 24dB an octave, and is what a small enclosure
  // actually does to bass anyway.
  const low = ctx.createBiquadFilter();
  low.type = 'highpass';
  low.frequency.value = chain.lowCut;
  const low2 = ctx.createBiquadFilter();
  low2.type = 'highpass';
  low2.frequency.value = chain.lowCut;
  const high = ctx.createBiquadFilter();
  high.type = 'lowpass';
  high.frequency.value = chain.highCut;

  const shaper = ctx.createWaveShaper();
  shaper.curve = grit(chain.grit);

  const box = ctx.createDelay(1);
  box.delayTime.value = BOX_S;
  const back = ctx.createGain();
  back.gain.value = chain.box;

  const out = ctx.createGain();
  // The chain adds up to more than it started with - the soft clip alone lifts
  // everything quiet. Without this the pet is louder than it was and clips on
  // its own consonants.
  out.gain.value = chain.gain;

  // The band limit goes last, which is both what a small speaker physically is
  // and the only place it can be trusted. Put in the middle it measured as
  // adding low end rather than removing it: ring modulation puts sidebands
  // below every frequency it touches, a soft clip makes intermodulation
  // products out of them, and a 13ms comb resonates at 77Hz and its multiples.
  // All three of those arrive after the filter and walk straight past it.
  if (ringing) {
    source.connect(ring);
    ring.connect(wet);
    wet.connect(shaper);
  }
  source.connect(dry);
  dry.connect(shaper);
  shaper.connect(box);
  box.connect(back);
  back.connect(box); // the resonance, decaying by BOX_FEEDBACK each pass
  shaper.connect(low);
  box.connect(low);
  low.connect(low2);
  low2.connect(high);
  high.connect(out);
  out.connect(dest);

  if (osc) osc.start();
  source.start();

  const seconds = buffer.duration / chain.speed;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    // A ramp rather than a jump: gain to zero in one sample is a click, and the
    // same rule the chirps follow.
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.008);
    try { source.stop(ctx.currentTime + 0.05); } catch { /* already finished */ }
    if (osc) try { osc.stop(ctx.currentTime + 0.05); } catch { /* already finished */ }
  };
  source.onended = () => { if (osc) try { osc.stop(); } catch { /* already stopped */ } };

  return { stop, seconds };
}

if (typeof module !== 'undefined') {
  module.exports = { robot, VOICE, SLOW, SPEED, PET_SPEED, RING_HZ, RING_MIX };
}
