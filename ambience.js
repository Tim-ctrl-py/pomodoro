'use strict';

/*
 * Generative study ambience, built entirely with the Web Audio API:
 *  - rain: filtered pink noise plus randomly placed droplets
 *  - music: a slow ambient pad with soft bell notes and reverb
 *  - 40 Hz: amplitude modulation of the music layer at 40 Hz ("gamma" modulation)
 * Everything is synthesized live in the browser, so there are no audio files,
 * no downloads and no licensing questions.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const AMBIENCE_SETTINGS = {
  fadeSeconds: 1.5,
  noiseSeconds: 4,
  reverbSeconds: 4.5,
  chordSeconds: 12,
  chordAttackSeconds: 4,
  chordReleaseSeconds: 6,
  bellDecaySeconds: 3.5,
  bellMinGapMs: 2200,
  bellMaxGapMs: 6500,
  dropMinGapMs: 12,
  dropMaxGapMs: 90,
  gammaFrequencyHz: 40,
  maxGammaDepth: 0.5, // 0.5 = the music fully pulses between silence and full volume
  maxRainGain: 0.9,
  maxMusicGain: 0.7,
  levelSmoothingSeconds: 0.1,
};

/** Calm, slowly rotating progression (MIDI note numbers): Fmaj7 – Em7 – Dm9 – Cmaj9. */
const CHORD_PROGRESSION = [
  [53, 57, 60, 64],
  [52, 55, 59, 62],
  [50, 53, 57, 60, 64],
  [48, 52, 55, 59, 62],
];

const BELL_OCTAVE_SHIFT = 24;
const BASS_OCTAVE_SHIFT = -12;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Maps a 0–100 slider value to a gain using a perceptual (squared) curve. */
function levelToGain(level, maxGain) {
  return (level / 100) ** 2 * maxGain;
}

// ---------------------------------------------------------------------------
// Ambience engine
// ---------------------------------------------------------------------------

function createAmbience(initialLevels) {
  const levels = { ...initialLevels };
  const loopTimers = {};
  let context = null;
  let nodes = null;
  let noiseBuffer = null;
  let chordIndex = 0;
  let playing = false;
  let suspendTimeoutId = null;

  // --- Graph setup ---------------------------------------------------------

  function createGain(value) {
    const gain = context.createGain();
    gain.gain.value = value;
    return gain;
  }

  function createFilter(type, frequency, q = 1) {
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    return filter;
  }

  function createPanner(pan) {
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    return panner;
  }

  function fillPinkNoise(data) {
    // Paul Kellet's economy pink noise filter: softer and more natural than white noise.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    }
  }

  function createNoiseBuffer() {
    const length = AMBIENCE_SETTINGS.noiseSeconds * context.sampleRate;
    const buffer = context.createBuffer(2, length, context.sampleRate);
    fillPinkNoise(buffer.getChannelData(0));
    fillPinkNoise(buffer.getChannelData(1));
    return buffer;
  }

  function createImpulseResponse() {
    const length = AMBIENCE_SETTINGS.reverbSeconds * context.sampleRate;
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
      }
    }
    return buffer;
  }

  function buildGraph() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    context = new AudioContextClass();
    noiseBuffer = createNoiseBuffer();

    const master = createGain(0);
    master.connect(context.createDynamicsCompressor()).connect(context.destination);

    const reverb = context.createConvolver();
    reverb.buffer = createImpulseResponse();
    reverb.connect(createGain(0.7)).connect(master);

    const rainBus = createGain(0);
    rainBus.connect(master);

    // gammaGain.gain = (1 - depth) + depth * sin(40 Hz) → pulses between 1 - 2·depth and 1.
    const gammaGain = createGain(1);
    const gammaDepth = createGain(0);
    const gammaOscillator = context.createOscillator();
    gammaOscillator.frequency.value = AMBIENCE_SETTINGS.gammaFrequencyHz;
    gammaOscillator.connect(gammaDepth).connect(gammaGain.gain);
    gammaOscillator.start();

    const musicBus = createGain(0);
    musicBus.connect(gammaGain);
    gammaGain.connect(master);
    gammaGain.connect(reverb);

    nodes = { master, rainBus, musicBus, gammaGain, gammaDepth };
    startRainBed();
    applyLevels();
  }

  // --- Rain ----------------------------------------------------------------

  function startRainBed() {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const bodyGain = createGain(0.8);
    source.connect(createFilter('lowpass', 1300, 0.4)).connect(bodyGain).connect(nodes.rainBus);
    source.connect(createFilter('highpass', 4500, 0.5)).connect(createGain(0.25)).connect(nodes.rainBus);

    // Very slow swell so the rain breathes instead of sounding static.
    const swell = context.createOscillator();
    swell.frequency.value = 0.07;
    swell.connect(createGain(0.15)).connect(bodyGain.gain);
    swell.start();
    source.start();
  }

  function playRainDrop() {
    if (levels.rain === 0) return;
    const start = context.currentTime;
    const duration = randomBetween(0.015, 0.06);
    const envelope = createGain(0);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(randomBetween(0.3, 1.4), start + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source
      .connect(createFilter('bandpass', randomBetween(1500, 6500), randomBetween(1, 4)))
      .connect(envelope)
      .connect(createPanner(randomBetween(-0.9, 0.9)))
      .connect(nodes.rainBus);
    source.start(start, randomBetween(0, AMBIENCE_SETTINGS.noiseSeconds - 0.1), duration + 0.01);
  }

  // --- Music ---------------------------------------------------------------

  function playPadVoice(midi, start, peakGain) {
    const { chordSeconds, chordAttackSeconds, chordReleaseSeconds } = AMBIENCE_SETTINGS;
    const end = start + chordSeconds + chordReleaseSeconds;
    const envelope = createGain(0);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peakGain, start + chordAttackSeconds);
    envelope.gain.setValueAtTime(peakGain, start + chordSeconds);
    envelope.gain.linearRampToValueAtTime(0, end);

    const filter = createFilter('lowpass', 1100, 0.5);
    filter.connect(envelope).connect(nodes.musicBus);

    // Two slightly detuned oscillators give the pad its soft, wide chorus.
    [-7, 7].forEach((detune) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = midiToFrequency(midi);
      oscillator.detune.value = detune;
      oscillator.connect(filter);
      oscillator.start(start);
      oscillator.stop(end);
    });
  }

  function playChord() {
    const chord = CHORD_PROGRESSION[chordIndex];
    const start = context.currentTime + 0.05;
    playPadVoice(chord[0] + BASS_OCTAVE_SHIFT, start, 0.09);
    chord.forEach((midi) => playPadVoice(midi, start, 0.045));
    chordIndex = (chordIndex + 1) % CHORD_PROGRESSION.length;
  }

  function playBell() {
    if (levels.music === 0) return;
    const currentChord = CHORD_PROGRESSION[(chordIndex + CHORD_PROGRESSION.length - 1) % CHORD_PROGRESSION.length];
    const frequency = midiToFrequency(pickRandom(currentChord) + BELL_OCTAVE_SHIFT);
    const start = context.currentTime + 0.02;
    const end = start + AMBIENCE_SETTINGS.bellDecaySeconds;

    const envelope = createGain(0);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(randomBetween(0.05, 0.1), start + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(createPanner(randomBetween(-0.5, 0.5))).connect(nodes.musicBus);

    // Fundamental plus a quiet octave overtone sounds like a soft electric piano / bell.
    [[1, 1], [2, 0.25]].forEach(([ratio, gainValue]) => {
      const oscillator = context.createOscillator();
      oscillator.frequency.value = frequency * ratio;
      oscillator.connect(createGain(gainValue)).connect(envelope);
      oscillator.start(start);
      oscillator.stop(end);
    });
  }

  // --- Scheduling ----------------------------------------------------------

  function runLoop(name, action, getDelayMs) {
    action();
    loopTimers[name] = setTimeout(() => runLoop(name, action, getDelayMs), getDelayMs());
  }

  function startLoops() {
    const s = AMBIENCE_SETTINGS;
    runLoop('chord', playChord, () => s.chordSeconds * 1000);
    runLoop('bell', playBell, () => randomBetween(s.bellMinGapMs, s.bellMaxGapMs));
    runLoop('drop', playRainDrop, () => randomBetween(s.dropMinGapMs, s.dropMaxGapMs));
  }

  function stopLoops() {
    Object.values(loopTimers).forEach(clearTimeout);
  }

  // --- Levels & public API -------------------------------------------------

  function setParam(param, value) {
    param.setTargetAtTime(value, context.currentTime, AMBIENCE_SETTINGS.levelSmoothingSeconds);
  }

  function applyLevels() {
    const depth = (levels.gamma / 100) * AMBIENCE_SETTINGS.maxGammaDepth;
    setParam(nodes.rainBus.gain, levelToGain(levels.rain, AMBIENCE_SETTINGS.maxRainGain));
    setParam(nodes.musicBus.gain, levelToGain(levels.music, AMBIENCE_SETTINGS.maxMusicGain));
    setParam(nodes.gammaGain.gain, 1 - depth);
    setParam(nodes.gammaDepth.gain, depth);
  }

  function fadeMasterTo(target) {
    const gain = nodes.master.gain;
    gain.cancelScheduledValues(context.currentTime);
    gain.setTargetAtTime(target, context.currentTime, AMBIENCE_SETTINGS.fadeSeconds / 3);
  }

  function start() {
    if (playing) return;
    if (!context) buildGraph();
    clearTimeout(suspendTimeoutId);
    context.resume();
    playing = true;
    fadeMasterTo(1);
    startLoops();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    stopLoops();
    fadeMasterTo(0);
    // Suspend after the fade so the audio thread does not keep running in the background.
    suspendTimeoutId = setTimeout(() => context.suspend(), AMBIENCE_SETTINGS.fadeSeconds * 1000 + 300);
  }

  function setLevel(layer, value) {
    levels[layer] = value;
    if (context) applyLevels();
  }

  return {
    start,
    stop,
    setLevel,
    isPlaying: () => playing,
  };
}
