/**
 * Pure character behavior. Cursor samples never wake the robot and never
 * move the inactivity deadline. Wake, tray Sleep, and explicit activity
 * notes are the intentional events. An exploration hold can defer the idle
 * deadline once. It does not move that deadline, and it never wakes a sleeping robot.
 *
 * INACTIVITY_MS matches activity.ts QUIET_MS. BEDTIME_LINGER_MS matches the
 * dock window there. The node test runner loads this file as TypeScript, so
 * the equality is checked from the test instead of a runtime import.
 */

export const WAKE_MS = 700;
export const SLEEP_MS = 800;
/** Backstop if the main process never sends the robot home. Real quiet time is activity.ts QUIET_MS. */
export const INACTIVITY_MS = 120_000;
/** Keep the eyes open through one dock attempt. Matches activity.ts BEDTIME_LINGER_MS. */
const BEDTIME_LINGER_MS = 25_000;
/** Matches WANDER_EXPLORE_MS. A hold longer than this is cut so the robot cannot stay awake. */
export const EXPLORE_HOLD_MS = 360_000;
export const TARGET_LOST_MS = 400;
export const MAX_FRAME_MS = 100;
/** While fully asleep the pose barely moves, so the GPU can skip most frames. */
export const SLEEP_FRAME_MS = 80;

export type Phase = 'SLEEPING' | 'WAKING' | 'IDLE' | 'TRACKING' | 'RETURNING_TO_SLEEP';

export interface BehaviorState {
  phase: Phase;
  since: number;
  blendFrom: number;
  sleepDeadline: number | null;
  cursorValid: boolean;
  targetLostSince: number | null;
  lastTick: number;
  exploreUntil: number | null;
  /** Chat, screen selection, or a live Qwen request. The robot's own motion never sets this. */
  activityHold: boolean;
}

export type BehaviorEvent =
  | { type: 'WAKE' }
  | { type: 'USER_SLEEP' }
  | { type: 'CURSOR'; valid: boolean }
  | { type: 'TICK' }
  | { type: 'CLOCK_RESUME' }
  | { type: 'EXPLORE'; until: number | null }
  | { type: 'ENGAGE' }
  | { type: 'LINGER' }
  | { type: 'HOLD' }
  | { type: 'RELEASE' };

export function initialBehavior(now: number): BehaviorState {
  return {
    phase: 'SLEEPING',
    since: now,
    blendFrom: 0,
    sleepDeadline: null,
    cursorValid: false,
    targetLostSince: null,
    lastTick: now,
    exploreUntil: null,
    activityHold: false,
  };
}

export function reduceBehavior(state: BehaviorState, event: BehaviorEvent, now: number): BehaviorState {
  switch (event.type) {
    case 'WAKE':
      return wake(state, now);
    case 'USER_SLEEP':
      return userSleep(state, now);
    case 'CURSOR':
      return followCursor(state, event.valid, now);
    case 'TICK':
      return stamp(settle(state, now), now);
    case 'CLOCK_RESUME':
      return clockResume(state, now);
    case 'EXPLORE':
      return explore(state, event.until, now);
    case 'ENGAGE':
      return engage(state, now);
    case 'LINGER':
      return linger(state, now);
    case 'HOLD':
      return holdActivity(state, now);
    case 'RELEASE':
      return releaseActivity(state, now);
    default:
      return state;
  }
}

/** One frame. A long gap is clamped for animation and still checks the sleep deadline. */
export function stepBehavior(state: BehaviorState, now: number, cursorValid: boolean): BehaviorState {
  const gap = now - state.lastTick;
  const timed =
    gap > MAX_FRAME_MS
      ? reduceBehavior(state, { type: 'CLOCK_RESUME' }, now)
      : reduceBehavior(state, { type: 'TICK' }, now);
  return reduceBehavior(timed, { type: 'CURSOR', valid: cursorValid }, now);
}

/** 0 is asleep, 1 is awake. Wake may briefly exceed 1 for the elastic settle. */
export function alertness(state: BehaviorState, now: number): number {
  if (state.phase === 'SLEEPING') {
    return 0;
  }
  if (state.phase === 'IDLE' || state.phase === 'TRACKING') {
    return 1;
  }
  const duration = state.phase === 'WAKING' ? WAKE_MS : SLEEP_MS;
  const t = clamp01((now - state.since) / duration);
  const eased = state.phase === 'WAKING' ? easeOutBack(t) : smoothstep(t);
  const target = state.phase === 'WAKING' ? 1 : 0;
  return lerp(state.blendFrom, target, eased);
}

export function shouldRenderFrame(phase: Phase, now: number, lastRenderAt: number): boolean {
  if (phase !== 'SLEEPING') {
    return true;
  }
  return now - lastRenderAt >= SLEEP_FRAME_MS;
}

export function wakeBounce(state: BehaviorState, now: number): number {
  if (state.phase !== 'WAKING') {
    return 0;
  }
  return Math.max(0, alertness(state, now) - 1);
}

function wake(state: BehaviorState, now: number): BehaviorState {
  const deadline = now + INACTIVITY_MS;
  if (
    (state.phase === 'WAKING' || state.phase === 'IDLE' || state.phase === 'TRACKING') &&
    state.exploreUntil !== null &&
    now < state.exploreUntil &&
    state.sleepDeadline !== null &&
    now >= state.sleepDeadline
  ) {
    return stamp(state, now);
  }
  if (state.phase === 'WAKING') {
    return stamp({ ...state, sleepDeadline: deadline }, now);
  }
  if (state.phase === 'IDLE' || state.phase === 'TRACKING') {
    return stamp({ ...state, sleepDeadline: deadline }, now);
  }
  return stamp(
    {
      ...state,
      phase: 'WAKING',
      since: now,
      blendFrom: alertness(state, now),
      sleepDeadline: deadline,
      targetLostSince: null,
    },
    now,
  );
}

function userSleep(state: BehaviorState, now: number): BehaviorState {
  if (state.phase === 'SLEEPING' || state.phase === 'RETURNING_TO_SLEEP') {
    return stamp({ ...state, exploreUntil: null }, now);
  }
  return stamp(
    {
      ...state,
      phase: 'RETURNING_TO_SLEEP',
      since: now,
      blendFrom: alertness(state, now),
      sleepDeadline: null,
      targetLostSince: null,
      exploreUntil: null,
      activityHold: false,
    },
    now,
  );
}

function followCursor(state: BehaviorState, valid: boolean, now: number): BehaviorState {
  const next: BehaviorState = { ...state, cursorValid: valid, lastTick: now };
  if (state.phase === 'SLEEPING' || state.phase === 'WAKING' || state.phase === 'RETURNING_TO_SLEEP') {
    return next;
  }
  if (state.phase === 'IDLE' && valid) {
    return { ...next, phase: 'TRACKING', targetLostSince: null };
  }
  if (state.phase === 'TRACKING' && valid) {
    return { ...next, targetLostSince: null };
  }
  if (state.phase === 'TRACKING' && !valid) {
    const lostSince = state.targetLostSince ?? now;
    if (now - lostSince >= TARGET_LOST_MS) {
      return { ...next, phase: 'IDLE', targetLostSince: null };
    }
    return { ...next, targetLostSince: lostSince };
  }
  return next;
}

function clockResume(state: BehaviorState, now: number): BehaviorState {
  const gap = Math.max(0, now - state.lastTick);
  const skip = Math.max(0, gap - MAX_FRAME_MS);
  const clamped: BehaviorState = {
    ...state,
    since: state.since + skip,
    targetLostSince: state.targetLostSince === null ? null : state.targetLostSince + skip,
    lastTick: now,
  };
  if (idleElapsed(clamped, now) && !leaseOpen(clamped, now)) {
    return beginSleep(clamped, now, clamp01(alertness(clamped, now)));
  }
  return settle(clamped, now);
}

function explore(state: BehaviorState, until: number | null, now: number): BehaviorState {
  if (until === null) {
    return settle(stamp({ ...state, exploreUntil: null }, now), now);
  }
  if (state.phase === 'SLEEPING' || state.phase === 'RETURNING_TO_SLEEP') {
    return stamp(state, now);
  }
  if (state.exploreUntil !== null && now < state.exploreUntil) {
    return stamp(state, now);
  }
  const capped = Math.min(until, now + EXPLORE_HOLD_MS);
  return stamp({ ...state, exploreUntil: capped }, now);
}

function settle(state: BehaviorState, now: number): BehaviorState {
  let current = state;
  if (current.phase === 'WAKING' && now - current.since >= WAKE_MS) {
    current = { ...current, phase: 'IDLE', since: now, blendFrom: 1 };
  }
  if (current.phase === 'RETURNING_TO_SLEEP' && now - current.since >= SLEEP_MS) {
    current = {
      ...current,
      phase: 'SLEEPING',
      since: now,
      blendFrom: 0,
      sleepDeadline: null,
      targetLostSince: null,
    };
  }
  if (idleElapsed(current, now) && !leaseOpen(current, now)) {
    current = beginSleep(current, now, 1);
  }
  return current;
}

function idleElapsed(state: BehaviorState, now: number): boolean {
  return (
    (state.phase === 'IDLE' || state.phase === 'TRACKING' || state.phase === 'WAKING') &&
    state.sleepDeadline !== null &&
    now >= state.sleepDeadline &&
    !state.activityHold
  );
}

function leaseOpen(state: BehaviorState, now: number): boolean {
  return state.exploreUntil !== null && now < state.exploreUntil;
}

function beginSleep(state: BehaviorState, now: number, blendFrom: number): BehaviorState {
  return {
    ...state,
    phase: 'RETURNING_TO_SLEEP',
    since: now,
    blendFrom,
    sleepDeadline: null,
    targetLostSince: null,
    exploreUntil: null,
    activityHold: false,
  };
}

function awakePhase(state: BehaviorState): boolean {
  return state.phase === 'WAKING' || state.phase === 'IDLE' || state.phase === 'TRACKING';
}

/** Extends quiet time. A sleeping robot stays asleep. */
function engage(state: BehaviorState, now: number): BehaviorState {
  if (!awakePhase(state)) {
    return stamp(state, now);
  }
  const deadline = now + INACTIVITY_MS;
  if (state.sleepDeadline !== null && state.sleepDeadline >= deadline) {
    return stamp(state, now);
  }
  return stamp({ ...state, sleepDeadline: deadline }, now);
}

/** Keeps the current pose awake long enough to dock, without starting another two minutes. */
function linger(state: BehaviorState, now: number): BehaviorState {
  if (!awakePhase(state)) {
    return stamp(state, now);
  }
  const deadline = now + BEDTIME_LINGER_MS;
  const sleepDeadline = state.sleepDeadline !== null && state.sleepDeadline > deadline ? state.sleepDeadline : deadline;
  return stamp({ ...state, sleepDeadline }, now);
}

function holdActivity(state: BehaviorState, now: number): BehaviorState {
  if (!awakePhase(state)) {
    return stamp(state, now);
  }
  return stamp({ ...state, activityHold: true }, now);
}

function releaseActivity(state: BehaviorState, now: number): BehaviorState {
  if (!awakePhase(state)) {
    return stamp({ ...state, activityHold: false }, now);
  }
  return stamp({ ...state, activityHold: false, sleepDeadline: now + INACTIVITY_MS }, now);
}

function stamp(state: BehaviorState, now: number): BehaviorState {
  return { ...state, lastTick: now };
}

function easeOutBack(t: number): number {
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
