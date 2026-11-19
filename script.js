'use strict';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Focus length (minutes) mapped to its matching short break (minutes). */
const BREAK_MINUTES_BY_FOCUS_MINUTES = { 25: 5, 40: 10, 50: 10 };
const DEFAULT_FOCUS_MINUTES = 25;
const LONG_BREAK_MINUTES = 15;
const FOCUS_ROUNDS_PER_CYCLE = 4;
const AUTO_START_NEXT_PHASE = true;

/** Initial slider values (0–100) for the study ambience. */
const DEFAULT_SOUND_LEVELS = { rain: 60, music: 45, gamma: 40 };
const STORAGE_KEY = 'pomodoro-settings-v1';

const TICK_INTERVAL_MS = 250;
const TOAST_DURATION_MS = 7000;
const BEEP_FREQUENCY_HZ = 880;
const BEEP_DURATION_S = 0.25;
const BEEP_COUNT = 3;

const RING_RADIUS = 54; // must match r="54" of the ring circles in index.html
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const RAIN_DROP_COUNT = 160;
const RAIN_WIND = 0.18; // horizontal drift per vertical pixel

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;

const PHASES = {
  focus:      { label: 'Lernphase',   shortName: 'Lernen',      doneMessage: 'Lernphase beendet – Zeit für eine Pause!' },
  shortBreak: { label: 'Pause',       shortName: 'Pause',       doneMessage: 'Pause vorbei – weiter geht’s!' },
  longBreak:  { label: 'Lange Pause', shortName: 'lange Pause', doneMessage: 'Lange Pause vorbei – neuer Durchgang!' },
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const elements = {
  phaseLabel: document.getElementById('phase-label'),
  timeDisplay: document.getElementById('time-display'),
  nextUp: document.getElementById('next-up'),
  ringProgress: document.getElementById('ring-progress'),
  roundDots: document.getElementById('round-dots'),
  roundCounter: document.getElementById('round-counter'),
  toggleButton: document.getElementById('toggle-button'),
  toggleLabel: document.getElementById('toggle-label'),
  skipButton: document.getElementById('skip-button'),
  resetButton: document.getElementById('reset-button'),
  durationPicker: document.getElementById('duration-picker'),
  soundToggle: document.getElementById('sound-toggle'),
  soundSliders: document.querySelectorAll('[data-sound-layer]'),
  rainCanvas: document.getElementById('rain-canvas'),
  toast: document.getElementById('toast'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  focusMinutes: DEFAULT_FOCUS_MINUTES,
  phase: 'focus',
  round: 1,
  remainingMs: DEFAULT_FOCUS_MINUTES * MS_PER_MINUTE,
  endTimestamp: null, // system time (ms) when the running phase ends; null while not running
  intervalId: null,
  soundLevels: { ...DEFAULT_SOUND_LEVELS },
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let ambience = null; // created in init() after saved levels are loaded
let beepContext = null;
let toastTimeoutId = null;

// ---------------------------------------------------------------------------
// Persistence (per-browser convenience; the app works without it)
// ---------------------------------------------------------------------------

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    if (BREAK_MINUTES_BY_FOCUS_MINUTES[saved.focusMinutes]) state.focusMinutes = saved.focusMinutes;
    Object.keys(DEFAULT_SOUND_LEVELS).forEach((layer) => {
      if (Number.isFinite(saved.soundLevels?.[layer])) state.soundLevels[layer] = saved.soundLevels[layer];
    });
  } catch {
    // Storage unavailable or corrupted: keep the defaults.
  }
}

function saveSettings() {
  try {
    const { focusMinutes, soundLevels } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ focusMinutes, soundLevels }));
  } catch {
    // Storage unavailable (e.g. private mode): settings simply are not remembered.
  }
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

function getPhaseMinutes(phase) {
  if (phase === 'focus') return state.focusMinutes;
  if (phase === 'shortBreak') return BREAK_MINUTES_BY_FOCUS_MINUTES[state.focusMinutes];
  return LONG_BREAK_MINUTES;
}

function getPhaseDurationMs(phase) {
  return getPhaseMinutes(phase) * MS_PER_MINUTE;
}

// ---------------------------------------------------------------------------
// Timer control
// ---------------------------------------------------------------------------

function isRunning() {
  return state.endTimestamp !== null;
}

function startTimer() {
  if (isRunning()) return;
  requestNotificationPermission();
  unlockBeepAudio();
  // The end time is anchored to the system clock, so throttled or delayed ticks cannot cause drift.
  state.endTimestamp = Date.now() + state.remainingMs;
  state.intervalId = setInterval(tick, TICK_INTERVAL_MS);
  render();
}

function pauseTimer() {
  if (!isRunning()) return;
  state.remainingMs = getRemainingMs();
  stopTicking();
  render();
}

function toggleTimer() {
  if (isRunning()) pauseTimer();
  else startTimer();
}

function resetTimer() {
  stopTicking();
  state.phase = 'focus';
  state.round = 1;
  state.remainingMs = getPhaseDurationMs('focus');
  render();
}

function skipPhase() {
  const wasRunning = isRunning();
  stopTicking();
  advanceToNextPhase();
  if (wasRunning) startTimer();
  else render();
}

function stopTicking() {
  clearInterval(state.intervalId);
  state.intervalId = null;
  state.endTimestamp = null;
}

function getRemainingMs() {
  return Math.max(0, state.endTimestamp - Date.now());
}

function tick() {
  state.remainingMs = getRemainingMs();
  if (state.remainingMs === 0) {
    finishPhase();
    return;
  }
  render();
}

function finishPhase() {
  const finishedPhase = state.phase;
  stopTicking();
  advanceToNextPhase();
  announcePhaseEnd(finishedPhase);
  if (AUTO_START_NEXT_PHASE) startTimer();
  else render();
}

// ---------------------------------------------------------------------------
// Phase sequence
// ---------------------------------------------------------------------------

function getNextPhase() {
  if (state.phase !== 'focus') return 'focus';
  return state.round === FOCUS_ROUNDS_PER_CYCLE ? 'longBreak' : 'shortBreak';
}

function advanceToNextPhase() {
  const nextPhase = getNextPhase();
  if (state.phase === 'shortBreak') state.round += 1;
  if (state.phase === 'longBreak') state.round = 1;
  state.phase = nextPhase;
  state.remainingMs = getPhaseDurationMs(nextPhase);
}

// ---------------------------------------------------------------------------
// Duration selection
// ---------------------------------------------------------------------------

function handleDurationChange(event) {
  if (isRunning()) return;
  state.focusMinutes = Number(event.target.value);
  // The long break does not depend on the selection, so it keeps its remaining time.
  if (state.phase !== 'longBreak') {
    state.remainingMs = getPhaseDurationMs(state.phase);
  }
  saveSettings();
  render();
}

function syncDurationPicker() {
  const input = elements.durationPicker.querySelector(`input[value="${state.focusMinutes}"]`);
  if (input) input.checked = true;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function formatTime(ms) {
  const totalSeconds = Math.ceil(ms / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function render() {
  const time = formatTime(state.remainingMs);
  const phaseLabel = PHASES[state.phase].label;
  const running = isRunning();

  document.body.dataset.phase = state.phase;
  document.body.classList.toggle('is-running', running);
  document.title = `${running ? '' : '⏸ '}${time} · ${phaseLabel}`;

  elements.timeDisplay.textContent = time;
  elements.phaseLabel.textContent = phaseLabel;
  elements.nextUp.textContent = getNextUpText();
  elements.roundCounter.textContent = `Lernphase ${state.round} von ${FOCUS_ROUNDS_PER_CYCLE}`;
  elements.toggleLabel.textContent = running ? 'Pause' : 'Start';
  elements.durationPicker.disabled = running;

  renderRing();
  renderRoundDots();
}

function getNextUpText() {
  const nextPhase = getNextPhase();
  return `Danach: ${getPhaseMinutes(nextPhase)} min ${PHASES[nextPhase].shortName}`;
}

function renderRing() {
  const fractionLeft = state.remainingMs / getPhaseDurationMs(state.phase);
  elements.ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - fractionLeft);
}

function createRoundDots() {
  for (let i = 0; i < FOCUS_ROUNDS_PER_CYCLE; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'round-dot';
    elements.roundDots.append(dot);
  }
}

function renderRoundDots() {
  const currentIndex = state.round - 1;
  const isFocus = state.phase === 'focus';
  [...elements.roundDots.children].forEach((dot, index) => {
    const isDone = index < currentIndex || (index === currentIndex && !isFocus);
    dot.classList.toggle('is-done', isDone);
    dot.classList.toggle('is-current', index === currentIndex && isFocus);
  });
}

// ---------------------------------------------------------------------------
// Signals: sound, notification, in-page fallback
// ---------------------------------------------------------------------------

function announcePhaseEnd(finishedPhase) {
  const message = PHASES[finishedPhase].doneMessage;
  playBeeps();
  const notified = showBrowserNotification(message);
  if (!notified) showToast(message);
}

function unlockBeepAudio() {
  // Browsers only allow audio after a user gesture, so the context is created on "Start".
  if (!beepContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    beepContext = new AudioContextClass();
  }
  if (beepContext.state === 'suspended') beepContext.resume();
}

function playBeeps() {
  if (!beepContext) return;
  for (let i = 0; i < BEEP_COUNT; i += 1) {
    playBeep(beepContext.currentTime + i * BEEP_DURATION_S * 2);
  }
}

function playBeep(startTime) {
  const oscillator = beepContext.createOscillator();
  const gain = beepContext.createGain();
  oscillator.frequency.value = BEEP_FREQUENCY_HZ;
  gain.gain.setValueAtTime(0.3, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + BEEP_DURATION_S);
  oscillator.connect(gain).connect(beepContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + BEEP_DURATION_S);
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

/** Returns true if a system notification was shown, false if the fallback is needed. */
function showBrowserNotification(message) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    new Notification('Pomodoro-Timer', { body: message });
    return true;
  } catch {
    return false;
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(hideToast, TOAST_DURATION_MS);
}

function hideToast() {
  elements.toast.hidden = true;
}

// ---------------------------------------------------------------------------
// Study ambience controls
// ---------------------------------------------------------------------------

function toggleAmbience() {
  if (ambience.isPlaying()) ambience.stop();
  else ambience.start();
  renderSoundControls();
}

function handleSoundLevelInput(event) {
  const slider = event.target;
  const layer = slider.dataset.soundLayer;
  state.soundLevels[layer] = Number(slider.value);
  ambience.setLevel(layer, state.soundLevels[layer]);
  renderSlider(slider);
  updateRainAnimation();
  saveSettings();
}

function renderSlider(slider) {
  slider.style.setProperty('--fill', `${slider.value}%`);
  slider.closest('.slider').querySelector('output').textContent = slider.value;
}

function renderSoundControls() {
  const playing = ambience.isPlaying();
  elements.soundToggle.setAttribute('aria-pressed', String(playing));
  elements.soundToggle.setAttribute('aria-label', playing ? 'Lernklang stoppen' : 'Lernklang abspielen');
  updateRainAnimation();
}

function syncSoundSliders() {
  elements.soundSliders.forEach((slider) => {
    slider.value = state.soundLevels[slider.dataset.soundLayer];
    renderSlider(slider);
  });
}

// ---------------------------------------------------------------------------
// Rain visual (decorative, runs only while the rain sound is audible)
// ---------------------------------------------------------------------------

const rain = { drops: [], frameId: null, context: elements.rainCanvas.getContext('2d') };

function resizeRainCanvas() {
  const ratio = window.devicePixelRatio || 1;
  elements.rainCanvas.width = window.innerWidth * ratio;
  elements.rainCanvas.height = window.innerHeight * ratio;
  rain.context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function createRainDrop(spreadOverScreen) {
  return {
    x: Math.random() * window.innerWidth * 1.2,
    y: spreadOverScreen ? Math.random() * window.innerHeight : -30,
    length: 10 + Math.random() * 18,
    speed: 7 + Math.random() * 8,
  };
}

function drawRainFrame() {
  const { context, drops } = rain;
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  context.strokeStyle = 'rgba(200, 215, 255, 0.35)';
  context.lineWidth = 1;
  context.beginPath();
  drops.forEach((drop, index) => {
    drop.y += drop.speed;
    drop.x -= drop.speed * RAIN_WIND;
    context.moveTo(drop.x, drop.y);
    context.lineTo(drop.x + drop.length * RAIN_WIND, drop.y - drop.length);
    if (drop.y - drop.length > window.innerHeight) drops[index] = createRainDrop(false);
  });
  context.stroke();
  rain.frameId = requestAnimationFrame(drawRainFrame);
}

function updateRainAnimation() {
  const visible = !reducedMotion && ambience.isPlaying() && state.soundLevels.rain > 0;
  elements.rainCanvas.style.opacity = visible ? String(0.3 + state.soundLevels.rain / 150) : '0';

  if (visible && rain.frameId === null) {
    rain.drops = Array.from({ length: RAIN_DROP_COUNT }, () => createRainDrop(true));
    rain.frameId = requestAnimationFrame(drawRainFrame);
  } else if (!visible && rain.frameId !== null) {
    cancelAnimationFrame(rain.frameId);
    rain.frameId = null;
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

const KEYBOARD_ACTIONS = {
  ' ': toggleTimer,
  r: resetTimer,
  m: toggleAmbience,
};

function handleKeydown(event) {
  // Let focused controls (buttons, sliders, radios) handle their own keys.
  if (event.target.closest('button, input') || event.metaKey || event.ctrlKey || event.altKey) return;
  const action = KEYBOARD_ACTIONS[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
  action();
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

function bindEvents() {
  elements.toggleButton.addEventListener('click', toggleTimer);
  elements.resetButton.addEventListener('click', resetTimer);
  elements.skipButton.addEventListener('click', skipPhase);
  elements.durationPicker.addEventListener('change', handleDurationChange);
  elements.soundToggle.addEventListener('click', toggleAmbience);
  elements.soundSliders.forEach((slider) => slider.addEventListener('input', handleSoundLevelInput));
  elements.toast.addEventListener('click', hideToast);
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', resizeRainCanvas);
  // Background tabs throttle timers; refresh immediately when the tab becomes visible again.
  document.addEventListener('visibilitychange', () => {
    if (isRunning()) tick();
  });
}

function init() {
  loadSettings();
  ambience = createAmbience(state.soundLevels);
  state.remainingMs = getPhaseDurationMs('focus');
  elements.ringProgress.style.strokeDasharray = RING_CIRCUMFERENCE;

  createRoundDots();
  syncDurationPicker();
  syncSoundSliders();
  resizeRainCanvas();
  bindEvents();
  render();
  renderSoundControls();
}

init();
