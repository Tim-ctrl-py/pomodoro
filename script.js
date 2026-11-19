'use strict';

// ---------------------------------------------------------------------------
// Settings & constants
// ---------------------------------------------------------------------------

/** Quick presets shown in the segmented control (index = radio value). */
const PRESETS = [
  { focusMinutes: 25, shortBreakMinutes: 5 },
  { focusMinutes: 40, shortBreakMinutes: 10 },
  { focusMinutes: 50, shortBreakMinutes: 10 },
];

const DEFAULT_SETTINGS = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsPerCycle: 4,
  dailyGoal: 8,
  autoStartBreaks: true,
  autoStartFocus: false,
  duckAmbienceInBreaks: true,
  chimeVolume: 70,
  soundLevels: { rain: 60, music: 45, gamma: 40 },
};

/** Allowed [min, max] for every numeric setting. */
const SETTING_LIMITS = {
  focusMinutes: [1, 120],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 90],
  roundsPerCycle: [1, 12],
  dailyGoal: [1, 24],
  chimeVolume: [0, 100],
};

const STORAGE_KEYS = {
  settings: 'pomodoro-settings-v2',
  legacySettings: 'pomodoro-settings-v1',
  session: 'pomodoro-session-v1',
  stats: 'pomodoro-stats-v1',
};

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;

const TICK_INTERVAL_MS = 250;
const TOAST_DURATION_MS = 7000;
const EXTEND_MINUTES = 5;
const MAX_PHASE_MINUTES = 180;
const TASK_MAX_LENGTH = 80;

const STATS_DAYS_SHOWN = 7;
const STATS_DAYS_KEPT = 400;
const STATS_FLUSH_INTERVAL_MS = 10 * MS_PER_SECOND; // how often running focus time is saved
const MIN_PARTIAL_LOG_MS = 5 * MS_PER_MINUTE; // unfinished units this long still appear in the list
const MIN_STREAK_MINUTES = 10; // focus time that keeps the streak alive without a finished unit
const MIN_RECORD_MINUTES = 30; // a "new best day" is only celebrated above this
const MILESTONE_HOURS = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
const CONFETTI_PIECES = 48;
const CONFETTI_DURATION_MS = 3200;
const TOAST_QUEUE_LIMIT = 3;
const LOG_ENTRIES_KEPT = 300;
const RECENT_SESSIONS_SHOWN = 5;

/** Chime melodies (MIDI notes) played when a phase ends: descending = relax, ascending = get going. */
const CHIME_NOTES = {
  focus: [79, 76, 72],
  shortBreak: [72, 76, 79],
  longBreak: [72, 76, 79, 84],
};
const CHIME_NOTE_GAP_S = 0.2;
const CHIME_DECAY_S = 1.8;
const CHIME_MAX_GAIN = 0.35;
/** Bell-like partials: [frequency ratio, relative gain]. */
const CHIME_PARTIALS = [[1, 1], [2.76, 0.16], [5.4, 0.05]];

const RING_RADIUS = 54; // must match r="54" of the ring circles in index.html
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const FAVICON_SIZE = 64;
const FAVICON_STEPS = 60; // the favicon is redrawn at most this many times per phase

const RAIN_DROP_COUNT = 160;
const RAIN_WIND = 0.18; // horizontal drift per vertical pixel

const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const PHASES = {
  focus: {
    label: 'Lernphase', shortName: 'Lernen', settingKey: 'focusMinutes', color: '#ff7a59',
    doneMessage: 'Lernphase geschafft – Zeit für eine Pause!',
  },
  shortBreak: {
    label: 'Pause', shortName: 'Pause', settingKey: 'shortBreakMinutes', color: '#2dd4bf',
    doneMessage: 'Pause vorbei – weiter geht’s!',
  },
  longBreak: {
    label: 'Lange Pause', shortName: 'lange Pause', settingKey: 'longBreakMinutes', color: '#818cf8',
    doneMessage: 'Lange Pause vorbei – neuer Durchgang!',
  },
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const elements = {
  favicon: $('favicon'),
  phaseLabel: $('phase-label'),
  taskInput: $('task-input'),
  timeDisplay: $('time-display'),
  nextUp: $('next-up'),
  extendButton: $('extend-button'),
  ringProgress: $('ring-progress'),
  roundDots: $('round-dots'),
  roundCounter: $('round-counter'),
  toggleButton: $('toggle-button'),
  toggleLabel: $('toggle-label'),
  skipButton: $('skip-button'),
  resetButton: $('reset-button'),
  durationPicker: $('duration-picker'),
  customPreset: $('custom-preset'),
  customFocusLabel: $('custom-focus-label'),
  customBreakLabel: $('custom-break-label'),
  zenButton: $('zen-button'),
  settingsButton: $('settings-button'),
  soundToggle: $('sound-toggle'),
  soundSliders: document.querySelectorAll('[data-sound-layer]'),
  rainCanvas: $('rain-canvas'),
  statsDate: $('stats-date'),
  liveBadge: $('live-badge'),
  statsMessage: $('stats-message'),
  sessionTile: $('session-tile'),
  streakTile: $('streak-tile'),
  statSessions: $('stat-sessions'),
  statGoal: $('stat-goal'),
  statMinutes: $('stat-minutes'),
  statStreak: $('stat-streak'),
  statStreakLabel: $('stat-streak-label'),
  goalBar: $('goal-bar'),
  goalFill: $('goal-fill'),
  goalLive: $('goal-live'),
  goalText: $('goal-text'),
  weekChart: $('week-chart'),
  statWeek: $('stat-week'),
  statBest: $('stat-best'),
  statTotal: $('stat-total'),
  recentHeading: $('recent-heading'),
  recentList: $('recent-list'),
  settingsDialog: $('settings-dialog'),
  settingsForm: $('settings-form'),
  settingInputs: document.querySelectorAll('[data-setting]'),
  runningNote: $('running-note'),
  chimeVolumeOutput: $('chime-volume-output'),
  testChimeButton: $('test-chime-button'),
  notificationStatus: $('notification-status'),
  notificationButton: $('notification-button'),
  resetStatsButton: $('reset-stats-button'),
  toast: $('toast'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let settings = null; // loaded in init()
let stats = null; // loaded in init()

const state = {
  phase: 'focus',
  round: 1,
  phaseDurationMs: DEFAULT_SETTINGS.focusMinutes * MS_PER_MINUTE, // can grow with "+5 min"
  remainingMs: DEFAULT_SETTINGS.focusMinutes * MS_PER_MINUTE,
  endTimestamp: null, // system time (ms) when the running phase ends; null while not running
  intervalId: null,
  task: '',
  focusCreditedMs: 0, // part of the current focus phase that is already in the stats
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let ambience = null; // created in init() after saved levels are loaded
let audioContext = null;
let toastTimeoutId = null;
let wakeLock = null;
let wakeLockPending = false;
let renderedStatsDay = '';
let lastStatsKey = '';
let lastStatsFlushAt = 0;
const toastQueue = [];
let lastFaviconKey = '';

// ---------------------------------------------------------------------------
// Storage helpers (per-browser convenience; the app works without storage)
// ---------------------------------------------------------------------------

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (e.g. private mode): data simply is not remembered.
  }
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Returns the value as a valid integer for the setting, or null if it is not a number. */
function sanitizeSetting(key, value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return null;
  const [min, max] = SETTING_LIMITS[key];
  return clampNumber(number, min, max);
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

function migrateLegacySettings() {
  const legacy = readJson(STORAGE_KEYS.legacySettings);
  if (!legacy) return null;
  const preset = PRESETS.find((p) => p.focusMinutes === legacy.focusMinutes);
  return { ...preset, soundLevels: legacy.soundLevels };
}

function loadSettings() {
  const loaded = structuredClone(DEFAULT_SETTINGS);
  const saved = readJson(STORAGE_KEYS.settings) ?? migrateLegacySettings();
  if (!saved || typeof saved !== 'object') return loaded;

  Object.keys(DEFAULT_SETTINGS).forEach((key) => {
    if (key === 'soundLevels') return;
    if (typeof DEFAULT_SETTINGS[key] === 'boolean') {
      if (typeof saved[key] === 'boolean') loaded[key] = saved[key];
      return;
    }
    const value = sanitizeSetting(key, saved[key]);
    if (value !== null) loaded[key] = value;
  });

  Object.keys(DEFAULT_SETTINGS.soundLevels).forEach((layer) => {
    const level = saved.soundLevels?.[layer];
    if (Number.isFinite(level)) loaded.soundLevels[layer] = clampNumber(level, 0, 100);
  });
  return loaded;
}

function saveSettings() {
  writeJson(STORAGE_KEYS.settings, settings);
}

// ---------------------------------------------------------------------------
// Session persistence: a running timer survives reloads and closed tabs
// ---------------------------------------------------------------------------

function saveSession() {
  const { phase, round, phaseDurationMs, remainingMs, endTimestamp, task, focusCreditedMs } = state;
  writeJson(STORAGE_KEYS.session, { phase, round, phaseDurationMs, remainingMs, endTimestamp, task, focusCreditedMs });
}

/** Restores the saved session. Returns 'resume', 'expired', 'paused' or null (nothing saved). */
function restoreSession() {
  const saved = readJson(STORAGE_KEYS.session);
  if (!saved || !PHASES[saved.phase]) return null;

  state.phase = saved.phase;
  state.round = clampNumber(Math.round(Number(saved.round)) || 1, 1, settings.roundsPerCycle);
  state.task = typeof saved.task === 'string' ? saved.task.slice(0, TASK_MAX_LENGTH) : '';

  const duration = Number(saved.phaseDurationMs);
  state.phaseDurationMs = duration > 0 && duration <= MAX_PHASE_MINUTES * MS_PER_MINUTE
    ? duration
    : getPhaseDurationMs(state.phase);
  const remaining = Number(saved.remainingMs);
  state.remainingMs = Number.isFinite(remaining) && remaining > 0
    ? Math.min(remaining, state.phaseDurationMs)
    : state.phaseDurationMs;
  state.focusCreditedMs = state.phase === 'focus'
    ? clampNumber(toNumber(saved.focusCreditedMs), 0, state.phaseDurationMs)
    : 0;

  if (Number.isFinite(saved.endTimestamp)) {
    const left = saved.endTimestamp - Date.now();
    if (left <= 0) return 'expired';
    state.remainingMs = Math.min(left, state.phaseDurationMs);
    return 'resume';
  }
  return 'paused';
}

/** A phase ran out while the page was closed: count it, move on, but do not auto-start. */
function completePhaseWhileAway() {
  const finishedPhase = state.phase;
  state.remainingMs = 0; // the whole phase ran out
  const { achievements } = finalizeFocusPhase(true);
  advanceToNextPhase();
  showToast(`${PHASES[finishedPhase].label} ist abgelaufen, während die Seite geschlossen war – sie zählt trotzdem.`);
  showAchievements(achievements);
  commit();
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

function getPhaseMinutes(phase) {
  return settings[PHASES[phase].settingKey];
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

function getRemainingMs() {
  return isRunning() ? Math.max(0, state.endTimestamp - Date.now()) : state.remainingMs;
}

function startTimer() {
  if (isRunning()) return;
  if (state.remainingMs <= 0) state.remainingMs = state.phaseDurationMs;
  // The end time is anchored to the system clock, so throttled or delayed ticks cannot cause drift.
  state.endTimestamp = Date.now() + state.remainingMs;
  state.intervalId = setInterval(tick, TICK_INTERVAL_MS);
  lastStatsFlushAt = Date.now();
  commit();
}

function pauseTimer() {
  if (!isRunning()) return;
  state.remainingMs = getRemainingMs();
  stopTicking();
  showAchievements(flushFocusProgress());
  commit();
}

function toggleTimer() {
  if (isRunning()) {
    pauseTimer();
    return;
  }
  requestNotificationPermission();
  unlockAudio();
  startTimer();
}

function stopTicking() {
  clearInterval(state.intervalId);
  state.intervalId = null;
  state.endTimestamp = null;
}

function resetPhase() {
  showAchievements(finalizeFocusPhase(false).achievements);
  stopTicking();
  state.phaseDurationMs = getPhaseDurationMs(state.phase);
  state.remainingMs = state.phaseDurationMs;
  commit();
}

function resetCycle() {
  showAchievements(finalizeFocusPhase(false).achievements);
  stopTicking();
  state.phase = 'focus';
  state.round = 1;
  state.phaseDurationMs = getPhaseDurationMs('focus');
  state.remainingMs = state.phaseDurationMs;
  commit();
  showToast('Neuer Durchgang – bereit, wenn du es bist.');
}

function isAtCycleStart() {
  return state.phase === 'focus' && state.round === 1;
}

function isPhaseUntouched() {
  return !isRunning() && state.remainingMs === state.phaseDurationMs;
}

/** First press resets the current phase; pressing again on an untouched phase restarts the cycle. */
function handleResetButton() {
  if (isPhaseUntouched() && !isAtCycleStart()) resetCycle();
  else resetPhase();
}

function skipPhase() {
  const wasRunning = isRunning();
  showAchievements(finalizeFocusPhase(false).achievements);
  stopTicking();
  advanceToNextPhase();
  if (wasRunning) startTimer();
  else commit();
}

function extendPhase() {
  const extraMs = EXTEND_MINUTES * MS_PER_MINUTE;
  if (state.phaseDurationMs + extraMs > MAX_PHASE_MINUTES * MS_PER_MINUTE) return;
  state.phaseDurationMs += extraMs;
  if (isRunning()) state.endTimestamp += extraMs;
  state.remainingMs = getRemainingMs() + (isRunning() ? 0 : extraMs);
  commit();
}

function tick() {
  state.remainingMs = getRemainingMs();
  if (state.remainingMs === 0) {
    finishPhase();
    return;
  }
  if (state.phase === 'focus' && Date.now() - lastStatsFlushAt >= STATS_FLUSH_INTERVAL_MS) {
    showAchievements(flushFocusProgress());
  }
  render();
  renderLiveStats();
}

function finishPhase() {
  const finishedPhase = state.phase;
  stopTicking();
  const { goalReached, achievements } = finalizeFocusPhase(true);
  advanceToNextPhase();

  const autoStart = state.phase === 'focus' ? settings.autoStartFocus : settings.autoStartBreaks;
  let message = PHASES[finishedPhase].doneMessage;
  if (goalReached) message += ' Tagesziel erreicht 🎉';
  if (!autoStart) message += ' Drück Start, wenn du bereit bist.';
  announcePhaseEnd(finishedPhase, message);
  showAchievements(achievements);

  if (autoStart) startTimer();
  else commit();
}

// ---------------------------------------------------------------------------
// Phase sequence
// ---------------------------------------------------------------------------

function getNextPhase() {
  if (state.phase !== 'focus') return 'focus';
  return state.round >= settings.roundsPerCycle ? 'longBreak' : 'shortBreak';
}

function advanceToNextPhase() {
  const nextPhase = getNextPhase();
  if (state.phase === 'shortBreak') state.round = Math.min(state.round + 1, settings.roundsPerCycle);
  if (state.phase === 'longBreak') state.round = 1;
  state.phase = nextPhase;
  state.phaseDurationMs = getPhaseDurationMs(nextPhase);
  state.remainingMs = state.phaseDurationMs;
}

// ---------------------------------------------------------------------------
// Statistics
// Focus time is written to the stats continuously while you learn (not only when a
// phase ends), so the numbers count up live and nothing is lost if the app closes.
// ---------------------------------------------------------------------------

function dayKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function loadStats() {
  const saved = readJson(STORAGE_KEYS.stats);
  const days = {};
  if (saved?.days && typeof saved.days === 'object') {
    Object.entries(saved.days).forEach(([key, day]) => {
      days[key] = { minutes: toNumber(day?.minutes), sessions: Math.round(toNumber(day?.sessions)) };
    });
  }
  const dayList = Object.entries(days);
  const bestDay = dayList.reduce((best, [key, day]) => (day.minutes > best.minutes ? { key, minutes: day.minutes } : best), { key: '', minutes: 0 });

  return {
    days,
    log: Array.isArray(saved?.log) ? saved.log.filter((entry) => Number.isFinite(entry?.ts)) : [],
    // Totals and the best day are kept separately because old days are pruned eventually.
    totals: saved?.totals && Number.isFinite(saved.totals.minutes)
      ? { minutes: toNumber(saved.totals.minutes), sessions: Math.round(toNumber(saved.totals.sessions)) }
      : {
        minutes: dayList.reduce((sum, [, day]) => sum + day.minutes, 0),
        sessions: dayList.reduce((sum, [, day]) => sum + day.sessions, 0),
      },
    best: saved?.best && Number.isFinite(saved.best.minutes) ? { key: String(saved.best.key), minutes: toNumber(saved.best.minutes) } : bestDay,
  };
}

function saveStats() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STATS_DAYS_KEPT);
  const cutoffKey = dayKey(cutoff);
  Object.keys(stats.days).forEach((key) => {
    if (key < cutoffKey) delete stats.days[key];
  });
  stats.log = stats.log.slice(-LOG_ENTRIES_KEPT);
  writeJson(STORAGE_KEYS.stats, stats);
}

function getDayStats(key) {
  return stats.days[key] ?? { minutes: 0, sessions: 0 };
}

function ensureDayStats(key) {
  return stats.days[key] ?? (stats.days[key] = { minutes: 0, sessions: 0 });
}

function roundMinutes(minutes) {
  return Math.round(minutes * 100) / 100;
}

/** Adds focus time to today and the totals. Returns the achievements it unlocked (as messages). */
function addFocusTime(durationMs) {
  if (durationMs <= 0) return [];
  const key = dayKey();
  const day = ensureDayStats(key);
  const minutes = durationMs / MS_PER_MINUTE;
  const totalBefore = stats.totals.minutes;
  day.minutes = roundMinutes(day.minutes + minutes);
  stats.totals.minutes = roundMinutes(stats.totals.minutes + minutes);

  const achievements = [];
  if (day.minutes > stats.best.minutes) {
    const previous = stats.best;
    stats.best = { key, minutes: day.minutes };
    // Announce a new record once per day, and only if there was a real record to beat.
    if (previous.key !== key && previous.minutes >= MIN_RECORD_MINUTES) {
      achievements.push({ message: 'Neuer Rekord: dein bester Lerntag bisher! 🏆', confetti: true });
    }
  }
  const milestone = MILESTONE_HOURS.find((hours) => totalBefore < hours * 60 && stats.totals.minutes >= hours * 60);
  if (milestone) {
    achievements.push({ message: `Meilenstein: ${milestone} ${milestone === 1 ? 'Stunde' : 'Stunden'} Fokus insgesamt! 🚀`, confetti: true });
  }
  return achievements;
}

function getFocusElapsedMs() {
  if (state.phase !== 'focus') return 0;
  return clampNumber(state.phaseDurationMs - getRemainingMs(), 0, state.phaseDurationMs);
}

/** Focus time of the current phase that is not yet written to the stats (at most a few seconds). */
function getUnsavedFocusMs() {
  return Math.max(0, getFocusElapsedMs() - state.focusCreditedMs);
}

/** Writes the not-yet-counted focus time of the current phase into the stats. */
function flushFocusProgress() {
  const pendingMs = getUnsavedFocusMs();
  lastStatsFlushAt = Date.now();
  if (pendingMs <= 0) return [];
  state.focusCreditedMs += pendingMs;
  const achievements = addFocusTime(pendingMs);
  saveStats();
  saveSession();
  return achievements;
}

/**
 * Closes the current focus phase for the stats (finished, skipped or reset): counts the remaining
 * time, logs the unit and starts the next phase's count at zero.
 */
function finalizeFocusPhase(completed) {
  const result = { goalReached: false, achievements: [] };
  if (state.phase !== 'focus') return result;
  result.achievements = flushFocusProgress();
  const creditedMs = state.focusCreditedMs;
  state.focusCreditedMs = 0;

  if (completed) {
    const day = ensureDayStats(dayKey());
    day.sessions += 1;
    stats.totals.sessions += 1;
    result.goalReached = day.sessions === settings.dailyGoal;
  }
  if (completed || creditedMs >= MIN_PARTIAL_LOG_MS) {
    stats.log.push({
      ts: Date.now(),
      minutes: Math.max(1, Math.round(creditedMs / MS_PER_MINUTE)),
      task: state.task.trim(),
      ...(completed ? {} : { partial: true }),
    });
  }
  saveStats();
  saveSession();
  if (completed) celebrateUnit(result.goalReached);
  // No render here: the phase has not moved on yet. Every caller re-renders via commit().
  return result;
}

function showAchievements(achievements) {
  achievements.forEach(({ message, confetti }) => {
    showToast(message);
    if (confetti) launchConfetti();
  });
}

/** A day keeps the streak alive with one finished unit or a little focus time. */
function dayCountsForStreak(day) {
  return day.sessions > 0 || day.minutes >= MIN_STREAK_MINUTES;
}

/** Today's numbers including the few seconds that are not saved yet. */
function getLiveToday() {
  const day = getDayStats(dayKey());
  return { minutes: day.minutes + getUnsavedFocusMs() / MS_PER_MINUTE, sessions: day.sessions };
}

function getStreak(today) {
  const date = new Date();
  const todayCounts = dayCountsForStreak(today);
  let streak = todayCounts ? 1 : 0;
  date.setDate(date.getDate() - 1);
  while (dayCountsForStreak(getDayStats(dayKey(date)))) {
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  return { streak, todayCounts };
}

function getWeekMinutes(todayMinutes) {
  const date = new Date();
  const daysSinceMonday = (date.getDay() + 6) % 7;
  let minutes = todayMinutes;
  for (let offset = 1; offset <= daysSinceMonday; offset += 1) {
    date.setDate(date.getDate() - 1);
    minutes += getDayStats(dayKey(date)).minutes;
  }
  return minutes;
}

function formatMinutes(minutes) {
  const rounded = Math.floor(minutes + 0.001);
  if (rounded < 60) return `${rounded} min`;
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')} h`;
}

function resetStats() {
  if (!window.confirm('Alle Statistiken unwiderruflich löschen?')) return;
  stats = { days: {}, log: [], totals: { minutes: 0, sessions: 0 }, best: { key: '', minutes: 0 } };
  state.focusCreditedMs = getFocusElapsedMs(); // time before the reset does not come back
  saveStats();
  saveSession();
  renderStats();
}

// ---------------------------------------------------------------------------
// Rendering: timer
// ---------------------------------------------------------------------------

function formatTime(ms) {
  const totalSeconds = Math.ceil(ms / MS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Saves the session and re-renders everything that depends on a state change. */
function commit() {
  saveSession();
  render();
  renderStats();
  ambience.setDucked(settings.duckAmbienceInBreaks && state.phase !== 'focus');
  syncWakeLock();
}

function render() {
  const time = formatTime(state.remainingMs);
  const phaseLabel = PHASES[state.phase].label;
  const running = isRunning();

  document.body.dataset.phase = state.phase;
  document.body.classList.toggle('is-running', running);
  document.title = `${running ? '' : '⏸ '}${time} · ${state.task.trim() || phaseLabel}`;

  elements.timeDisplay.textContent = time;
  elements.phaseLabel.textContent = phaseLabel;
  elements.nextUp.textContent = getNextUpText();
  elements.roundCounter.textContent = `Lernphase ${state.round} von ${settings.roundsPerCycle}`;
  elements.toggleLabel.textContent = running ? 'Pause' : getStartLabel();
  elements.durationPicker.disabled = running;

  renderRing();
  renderRoundDots();
  renderFavicon();
}

function getStartLabel() {
  return state.remainingMs < state.phaseDurationMs ? 'Weiter' : 'Start';
}

function getNextUpText() {
  const nextPhase = getNextPhase();
  return `Danach: ${getPhaseMinutes(nextPhase)} min ${PHASES[nextPhase].shortName}`;
}

function renderRing() {
  const fractionLeft = state.remainingMs / state.phaseDurationMs;
  elements.ringProgress.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - fractionLeft);
}

function renderRoundDots() {
  const container = elements.roundDots;
  while (container.children.length < settings.roundsPerCycle) {
    const dot = document.createElement('span');
    dot.className = 'round-dot';
    container.append(dot);
  }
  while (container.children.length > settings.roundsPerCycle) container.lastElementChild.remove();

  const currentIndex = state.round - 1;
  const isFocus = state.phase === 'focus';
  [...container.children].forEach((dot, index) => {
    const isDone = index < currentIndex || (index === currentIndex && !isFocus);
    dot.classList.toggle('is-done', isDone);
    dot.classList.toggle('is-current', index === currentIndex && isFocus);
  });
}

/** Draws the remaining time as a small ring into the browser tab icon. */
function renderFavicon() {
  const fractionLeft = state.remainingMs / state.phaseDurationMs;
  const key = `${state.phase}|${isRunning()}|${Math.round(fractionLeft * FAVICON_STEPS)}`;
  if (key === lastFaviconKey) return;
  lastFaviconKey = key;

  const canvas = renderFavicon.canvas ?? (renderFavicon.canvas = document.createElement('canvas'));
  canvas.width = FAVICON_SIZE;
  canvas.height = FAVICON_SIZE;
  const context = canvas.getContext('2d');
  const center = FAVICON_SIZE / 2;
  const color = PHASES[state.phase].color;

  context.fillStyle = '#0b0a12';
  context.beginPath();
  context.arc(center, center, center, 0, Math.PI * 2);
  context.fill();

  context.lineWidth = 9;
  context.lineCap = 'round';
  context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  context.beginPath();
  context.arc(center, center, 22, 0, Math.PI * 2);
  context.stroke();

  if (fractionLeft > 0) {
    context.strokeStyle = color;
    context.beginPath();
    context.arc(center, center, 22, -Math.PI / 2, -Math.PI / 2 + fractionLeft * Math.PI * 2);
    context.stroke();
  }

  if (!isRunning()) {
    context.fillStyle = color;
    context.fillRect(center - 8, center - 9, 5, 18);
    context.fillRect(center + 3, center - 9, 5, 18);
  }
  elements.favicon.href = canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Rendering: statistics
// ---------------------------------------------------------------------------

/** Called on every tick: cheap live parts every time, the full card only when a number changes. */
function renderLiveStats() {
  const today = getLiveToday();
  const remainingMinutes = Math.ceil(getRemainingMs() / MS_PER_MINUTE);
  const key = [dayKey(), Math.floor(today.minutes), today.sessions, state.phase, isRunning(), remainingMinutes].join('|');
  if (key !== lastStatsKey) renderStats();
  else renderGoalProgress(today);
}

function getCurrentUnitFraction() {
  return state.phase === 'focus' ? getFocusElapsedMs() / state.phaseDurationMs : 0;
}

function renderGoalProgress(today) {
  const goal = settings.dailyGoal;
  const doneFraction = Math.min(1, today.sessions / goal);
  const liveFraction = Math.min(1 - doneFraction, getCurrentUnitFraction() / goal);
  elements.goalFill.style.width = `${doneFraction * 100}%`;
  elements.goalLive.style.left = `${doneFraction * 100}%`;
  elements.goalLive.style.width = `${liveFraction * 100}%`;
  elements.goalBar.style.setProperty('--segments', String(Math.min(goal, 24)));
  elements.goalBar.setAttribute('aria-valuemax', String(goal));
  elements.goalBar.setAttribute('aria-valuenow', String(Math.min(today.sessions, goal)));
  elements.goalBar.classList.toggle('is-complete', today.sessions >= goal);
}

function renderStats() {
  const todayKey = dayKey();
  const today = getLiveToday();
  const goal = settings.dailyGoal;
  const { streak, todayCounts } = getStreak(today);
  const focusRunning = isRunning() && state.phase === 'focus';
  renderedStatsDay = todayKey;
  lastStatsKey = [todayKey, Math.floor(today.minutes), today.sessions, state.phase, isRunning(), Math.ceil(getRemainingMs() / MS_PER_MINUTE)].join('|');

  elements.statsDate.textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  elements.liveBadge.hidden = !focusRunning;
  elements.statsMessage.textContent = getMotivation(today, streak, todayCounts);

  elements.statSessions.textContent = today.sessions >= goal ? `${today.sessions} ✓` : String(today.sessions);
  elements.statGoal.textContent = `von ${goal} ${goal === 1 ? 'Einheit' : 'Einheiten'}`;
  elements.sessionTile.classList.toggle('is-done', today.sessions >= goal);
  elements.statMinutes.textContent = formatMinutes(today.minutes);
  elements.statStreak.textContent = streak > 0 ? `🔥 ${streak}` : '0';
  elements.statStreakLabel.textContent = getStreakLabel(streak, todayCounts);
  elements.streakTile.classList.toggle('is-at-risk', streak > 0 && !todayCounts);
  elements.streakTile.classList.toggle('is-active', todayCounts);
  elements.goalText.textContent = `${today.sessions} / ${goal}`;
  renderGoalProgress(today);

  elements.statWeek.textContent = formatMinutes(getWeekMinutes(today.minutes));
  elements.statBest.textContent = formatMinutes(Math.max(stats.best.minutes, today.minutes));
  elements.statTotal.textContent = formatMinutes(stats.totals.minutes + getUnsavedFocusMs() / MS_PER_MINUTE);

  renderWeekChart(today.minutes);
  renderRecentSessions(todayKey);
}

function getStreakLabel(streak, todayCounts) {
  if (streak === 0) return 'Tage in Folge';
  if (!todayCounts) return 'Heute lernen hält die Serie!';
  return streak === 1 ? 'Tag in Folge' : 'Tage in Folge';
}

/** One short, honest line that reacts to where you are today. */
function getMotivation(today, streak, todayCounts) {
  const goal = settings.dailyGoal;
  const left = goal - today.sessions;
  const remainingMinutes = Math.ceil(getRemainingMs() / MS_PER_MINUTE);
  const nextUnit = today.sessions + 1;

  if (state.phase === 'focus' && isRunning()) {
    if (left <= 0) return `Bonusrunde läuft – noch ${remainingMinutes} min. Alles ab jetzt ist extra 💪`;
    if (left === 1) return `Letzte Einheit für dein Tagesziel – noch ${remainingMinutes} min!`;
    return `Du bist im Flow – noch ${remainingMinutes} min bis Einheit ${nextUnit} geschafft ist.`;
  }
  if (state.phase !== 'focus') {
    return left <= 0
      ? 'Pause verdient – dein Tagesziel hast du heute schon geknackt.'
      : `Pause verdient. Danach geht’s weiter mit Einheit ${nextUnit}.`;
  }
  if (left <= 0) return `Tagesziel geschafft – ${formatMinutes(today.minutes)} Fokus heute. Darauf kannst du stolz sein 🎉`;
  if (streak > 0 && !todayCounts) return `Halte deine ${streak}-Tage-Serie am Leben – eine Einheit reicht.`;
  if (today.sessions === 0 && today.minutes < 1) return 'Starte deine erste Einheit – der Anfang ist der schwerste Teil.';
  if (left === 1) return 'Nur noch eine Einheit bis zu deinem Tagesziel!';
  if (today.sessions >= goal / 2) return `Mehr als die Hälfte geschafft – noch ${left} Einheiten bis zum Ziel.`;
  return `Guter Start! Noch ${left} Einheiten bis zu deinem Tagesziel.`;
}

function renderWeekChart(todayMinutes) {
  const days = [];
  for (let offset = STATS_DAYS_SHOWN - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const minutes = offset === 0 ? todayMinutes : getDayStats(dayKey(date)).minutes;
    days.push({ date, minutes, isToday: offset === 0 });
  }
  const goalMinutes = settings.dailyGoal * settings.focusMinutes;
  const scaleMinutes = Math.max(...days.map((d) => d.minutes), goalMinutes, 1);
  elements.weekChart.style.setProperty('--goal-line', String(goalMinutes / scaleMinutes));

  elements.weekChart.replaceChildren(...days.map(({ date, minutes, isToday }) => {
    const column = document.createElement('div');
    column.className = `week-day${isToday ? ' is-today' : ''}`;
    column.title = `${date.toLocaleDateString('de-DE', { weekday: 'long' })}: ${formatMinutes(minutes)}`;

    const track = document.createElement('div');
    track.className = 'week-track';
    const bar = document.createElement('span');
    bar.className = 'week-bar';
    bar.style.height = `${(minutes / scaleMinutes) * 100}%`;
    if (minutes > 0) bar.classList.add('has-value');
    if (minutes >= goalMinutes) bar.classList.add('is-goal');
    track.append(bar);

    const label = document.createElement('span');
    label.className = 'week-label';
    label.textContent = WEEKDAY_SHORT[date.getDay()];

    column.append(track, label);
    return column;
  }));

  const summary = days.map(({ date, minutes }) => `${WEEKDAY_SHORT[date.getDay()]} ${formatMinutes(minutes)}`).join(', ');
  elements.weekChart.setAttribute('aria-label', `Fokuszeit der letzten 7 Tage: ${summary}`);
}

function createRecentItem({ time, task, minutes, className, note }) {
  const item = document.createElement('li');
  if (className) item.className = className;
  const timeElement = document.createElement('span');
  timeElement.className = 'recent-time';
  timeElement.textContent = time;
  const taskElement = document.createElement('span');
  taskElement.className = 'recent-task';
  taskElement.textContent = task;
  if (note) {
    const noteElement = document.createElement('small');
    noteElement.textContent = note;
    taskElement.append(' ', noteElement);
  }
  const minutesElement = document.createElement('span');
  minutesElement.className = 'recent-minutes';
  minutesElement.textContent = `${minutes} min`;
  item.append(timeElement, taskElement, minutesElement);
  return item;
}

function renderRecentSessions(todayKey) {
  const todaysEntries = stats.log.filter((entry) => dayKey(new Date(entry.ts)) === todayKey);
  const finished = todaysEntries.filter((entry) => !entry.partial).length;
  elements.recentHeading.textContent = finished > 0 ? `Erledigt heute (${finished})` : 'Erledigt heute';

  const items = [];
  const elapsedMinutes = Math.floor(getFocusElapsedMs() / MS_PER_MINUTE);
  if (state.phase === 'focus' && getFocusElapsedMs() > 0) {
    items.push(createRecentItem({
      time: isRunning() ? 'jetzt' : 'pausiert',
      task: state.task.trim() || 'Aktuelle Lernphase',
      minutes: elapsedMinutes,
      className: isRunning() ? 'is-live' : 'is-paused',
    }));
  }
  todaysEntries.slice(-RECENT_SESSIONS_SHOWN).reverse().forEach((entry) => {
    items.push(createRecentItem({
      time: new Date(entry.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      task: entry.task || 'Lernphase',
      minutes: entry.minutes,
      className: entry.partial ? 'is-partial' : '',
      note: entry.partial ? 'teilweise' : '',
    }));
  });

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'recent-empty';
    empty.textContent = 'Noch nichts heute – deine erste Einheit erscheint hier.';
    items.push(empty);
  }
  elements.recentList.replaceChildren(...items);
}

/** Small reward moments: the unit counter pops, reaching the daily goal throws confetti. */
function celebrateUnit(goalReached) {
  const tile = elements.sessionTile;
  tile.classList.remove('is-popping');
  void tile.offsetWidth; // restart the animation
  tile.classList.add('is-popping');
  if (goalReached) launchConfetti();
}

function launchConfetti() {
  if (reducedMotion) return;
  const colors = ['#ff7a59', '#ff4f8b', '#8b5cf6', '#2dd4bf', '#facc15', '#60a5fa'];
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < CONFETTI_PIECES; i += 1) {
    const piece = document.createElement('i');
    piece.style.setProperty('--x', `${(Math.random() * 2 - 1) * 45}vw`);
    piece.style.setProperty('--y', `${60 + Math.random() * 40}vh`);
    piece.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.setProperty('--delay', `${Math.random() * 0.25}s`);
    piece.style.background = colors[i % colors.length];
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), CONFETTI_DURATION_MS);
}

// ---------------------------------------------------------------------------
// Presets & settings dialog
// ---------------------------------------------------------------------------

function findActivePreset() {
  return PRESETS.findIndex((p) => p.focusMinutes === settings.focusMinutes && p.shortBreakMinutes === settings.shortBreakMinutes);
}

function syncDurationPicker() {
  const presetIndex = findActivePreset();
  const isCustom = presetIndex === -1;
  const value = isCustom ? 'custom' : String(presetIndex);
  elements.durationPicker.querySelector(`input[value="${value}"]`).checked = true;
  elements.customFocusLabel.innerHTML = isCustom ? `${settings.focusMinutes} <em>min</em>` : 'Eigene';
  elements.customBreakLabel.textContent = isCustom ? `${settings.shortBreakMinutes} min Pause` : 'anpassen';
}

/**
 * Persists changed settings and applies them. If the current phase's length changed while the
 * timer is not running, the phase restarts with the new length; a running phase keeps its time.
 */
function applySettingsChange(durationBefore) {
  saveSettings();
  state.round = Math.min(state.round, settings.roundsPerCycle);
  const durationAfter = getPhaseDurationMs(state.phase);
  if (durationAfter !== durationBefore && !isRunning()) {
    showAchievements(finalizeFocusPhase(false).achievements);
    state.phaseDurationMs = durationAfter;
    state.remainingMs = durationAfter;
  }
  syncDurationPicker();
  renderStats();
  commit();
}

function handlePresetChange(event) {
  if (event.target.value === 'custom') {
    syncDurationPicker(); // the dialog opens via the click handler; keep showing the real setting
    return;
  }
  const durationBefore = getPhaseDurationMs(state.phase);
  Object.assign(settings, PRESETS[Number(event.target.value)]);
  applySettingsChange(durationBefore);
}

function openSettings() {
  if (elements.settingsDialog.open) return;
  syncSettingsForm();
  elements.settingsDialog.showModal();
}

function syncSettingsForm() {
  elements.settingInputs.forEach((input) => {
    const value = settings[input.dataset.setting];
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
    if (input.type === 'range') renderSlider(input);
  });
  elements.runningNote.hidden = !isRunning();
  renderNotificationStatus();
}

function handleSettingInput(event) {
  const input = event.target.closest('[data-setting]');
  if (!input) return;
  // Number fields apply on "change" (blur/enter) so typing "45" does not briefly apply "4".
  if (event.type === 'input' && input.type !== 'range') return;

  const key = input.dataset.setting;
  const durationBefore = getPhaseDurationMs(state.phase);
  if (input.type === 'checkbox') {
    settings[key] = input.checked;
  } else {
    const value = sanitizeSetting(key, input.value);
    if (value === null) {
      input.value = settings[key];
      return;
    }
    settings[key] = value;
    input.value = value;
    if (input.type === 'range') renderSlider(input);
  }
  applySettingsChange(durationBefore);
}

function renderNotificationStatus() {
  const supported = 'Notification' in window;
  const permission = supported ? Notification.permission : 'unsupported';
  const texts = {
    granted: 'Benachrichtigungen: erlaubt',
    denied: 'Benachrichtigungen blockiert – in den Browser-Einstellungen änderbar',
    unsupported: 'Benachrichtigungen werden nicht unterstützt',
    default: '',
  };
  elements.notificationStatus.textContent = texts[permission];
  elements.notificationButton.hidden = permission !== 'default';
}

// ---------------------------------------------------------------------------
// Signals: chime, notification, in-page toast
// ---------------------------------------------------------------------------

function announcePhaseEnd(finishedPhase, message) {
  playChime(finishedPhase);
  // A visible page gets the in-page toast; a hidden one a system notification (toast as fallback).
  if (document.visibilityState === 'visible' || !showBrowserNotification(message)) showToast(message);
}

function unlockAudio() {
  // Browsers only allow audio after a user gesture, so the context is created on the first interaction.
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
}

function playChime(finishedPhase) {
  if (!audioContext) return;
  const volume = (settings.chimeVolume / 100) ** 2 * CHIME_MAX_GAIN;
  if (volume === 0) return;
  const start = audioContext.currentTime + 0.05;
  CHIME_NOTES[finishedPhase].forEach((midi, index) => {
    playChimeNote(midiToFrequency(midi), start + index * CHIME_NOTE_GAP_S, volume);
  });
}

function playChimeNote(frequency, start, volume) {
  const end = start + CHIME_DECAY_S;
  const envelope = audioContext.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);
  envelope.connect(audioContext.destination);

  CHIME_PARTIALS.forEach(([ratio, gainValue]) => {
    const oscillator = audioContext.createOscillator();
    const partialGain = audioContext.createGain();
    oscillator.frequency.value = frequency * ratio;
    partialGain.gain.value = gainValue;
    oscillator.connect(partialGain).connect(envelope);
    oscillator.start(start);
    oscillator.stop(end);
  });
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(renderNotificationStatus, () => {});
  }
}

/** Returns true if a system notification was shown, false if the fallback is needed. */
function showBrowserNotification(message) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const notification = new Notification('Pomodoro-Timer', { body: message, tag: 'pomodoro-phase' });
    notification.addEventListener('click', () => {
      window.focus();
      notification.close();
    });
    return true;
  } catch {
    return false;
  }
}

/** Shows a message; if one is already visible, it waits its turn instead of replacing it. */
function showToast(message) {
  const toast = elements.toast;
  if (!toast.hidden) {
    if (toast.textContent !== message && !toastQueue.includes(message) && toastQueue.length < TOAST_QUEUE_LIMIT) {
      toastQueue.push(message);
    }
    return;
  }
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(hideToast, TOAST_DURATION_MS);
}

function hideToast() {
  clearTimeout(toastTimeoutId);
  elements.toast.hidden = true;
  const next = toastQueue.shift();
  if (next) setTimeout(() => showToast(next), 300);
}

// ---------------------------------------------------------------------------
// Zen mode & screen wake lock
// ---------------------------------------------------------------------------

function isZen() {
  return document.body.classList.contains('is-zen');
}

function toggleZen(force) {
  const enabled = typeof force === 'boolean' ? force : !isZen();
  document.body.classList.toggle('is-zen', enabled);
  elements.zenButton.setAttribute('aria-pressed', String(enabled));
  elements.zenButton.setAttribute('aria-label', enabled ? 'Zen-Modus beenden' : 'Zen-Modus');
  syncWakeLock();
}

/** Keeps the screen on while the timer runs in zen mode (where supported). */
async function syncWakeLock() {
  if (!('wakeLock' in navigator) || wakeLockPending) return;
  const wanted = isRunning() && isZen() && document.visibilityState === 'visible';
  wakeLockPending = true;
  try {
    if (wanted && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!wanted && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null; // denied or unsupported here: the timer works without it
  } finally {
    wakeLockPending = false;
  }
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

function handleTaskInput() {
  state.task = elements.taskInput.value.slice(0, TASK_MAX_LENGTH);
  saveSession();
  render();
}

function focusTask() {
  if (isZen()) return;
  elements.taskInput.focus();
  elements.taskInput.select();
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
  settings.soundLevels[layer] = Number(slider.value);
  ambience.setLevel(layer, settings.soundLevels[layer]);
  renderSlider(slider);
  updateRainAnimation();
  saveSettings();
}

function renderSlider(slider) {
  slider.style.setProperty('--fill', `${slider.value}%`);
  const output = slider.closest('.slider')?.querySelector('output');
  if (output) output.textContent = slider.value;
}

function renderSoundControls() {
  const playing = ambience.isPlaying();
  elements.soundToggle.setAttribute('aria-pressed', String(playing));
  elements.soundToggle.setAttribute('aria-label', playing ? 'Lernklang stoppen' : 'Lernklang abspielen');
  updateRainAnimation();
}

function syncSoundSliders() {
  elements.soundSliders.forEach((slider) => {
    slider.value = settings.soundLevels[slider.dataset.soundLayer];
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
  const visible = !reducedMotion && ambience.isPlaying() && settings.soundLevels.rain > 0;
  elements.rainCanvas.style.opacity = visible ? String(0.3 + settings.soundLevels.rain / 150) : '0';

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
  s: skipPhase,
  r: (event) => (event.shiftKey ? resetCycle() : handleResetButton()),
  '+': extendPhase,
  t: focusTask,
  m: toggleAmbience,
  z: toggleZen,
  e: openSettings,
  escape: () => toggleZen(false),
};

function isTextField(target) {
  return target.matches?.('input[type="text"], input[type="number"], textarea, [contenteditable="true"]');
}

function handleKeydown(event) {
  if (elements.settingsDialog.open || event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTextField(event.target)) {
    if (event.key === 'Enter' || event.key === 'Escape') event.target.blur();
    return;
  }
  // Space on a focused button, radio or slider keeps its native meaning; other shortcuts always work.
  if (event.key === ' ' && event.target.closest('button, input, label')) return;
  const action = KEYBOARD_ACTIONS[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
  action(event);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

function bindEvents() {
  elements.toggleButton.addEventListener('click', toggleTimer);
  elements.resetButton.addEventListener('click', handleResetButton);
  elements.skipButton.addEventListener('click', skipPhase);
  elements.extendButton.addEventListener('click', extendPhase);
  elements.durationPicker.addEventListener('change', handlePresetChange);
  elements.customPreset.addEventListener('click', openSettings);
  elements.taskInput.addEventListener('input', handleTaskInput);
  elements.zenButton.addEventListener('click', () => toggleZen());
  elements.settingsButton.addEventListener('click', openSettings);
  elements.settingsForm.addEventListener('change', handleSettingInput);
  elements.settingsForm.addEventListener('input', handleSettingInput);
  elements.testChimeButton.addEventListener('click', () => {
    unlockAudio();
    playChime('focus');
  });
  elements.notificationButton.addEventListener('click', requestNotificationPermission);
  elements.resetStatsButton.addEventListener('click', resetStats);
  elements.soundToggle.addEventListener('click', toggleAmbience);
  elements.soundSliders.forEach((slider) => slider.addEventListener('input', handleSoundLevelInput));
  elements.toast.addEventListener('click', hideToast);

  document.addEventListener('keydown', handleKeydown);
  // Create the audio context on the first interaction so the end-of-phase chime can play.
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('resize', resizeRainCanvas);
  // Background tabs throttle timers; refresh immediately when the tab becomes visible again.
  // Save running focus time when the app goes to the background or closes.
  window.addEventListener('pagehide', () => flushFocusProgress());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushFocusProgress();
    if (isRunning()) tick();
    if (dayKey() !== renderedStatsDay) renderStats();
    syncWakeLock();
  });
}

function init() {
  settings = loadSettings();
  stats = loadStats();
  ambience = createAmbience(settings.soundLevels);
  state.phaseDurationMs = getPhaseDurationMs('focus');
  state.remainingMs = state.phaseDurationMs;
  const restored = restoreSession();

  elements.ringProgress.style.strokeDasharray = RING_CIRCUMFERENCE;
  elements.taskInput.value = state.task;
  syncDurationPicker();
  syncSoundSliders();
  resizeRainCanvas();
  bindEvents();
  renderStats();
  renderSoundControls();

  if (restored === 'resume') startTimer();
  else if (restored === 'expired') completePhaseWhileAway();
  else commit();
}

/** Enables offline use when served over http(s), e.g. as an installed app from GitHub Pages. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Offline support is optional: the timer works without it.
  });
}

init();
registerServiceWorker();
