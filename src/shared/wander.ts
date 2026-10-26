/**
 * Optional wandering. Pure scheduling and direction choice.
 * The overlay controller is the only code that moves the window.
 * This module does not read the keyboard, the screen, or any other process.
 * Typing in another application is not visible here; an open chat is the block we can see.
 */

import type { DipRect, TravelDirection } from './desktopMovement.js';

/** First departure of a session. Quiet time can hold it until 45 seconds. */
export const WANDER_FIRST_MIN_MS = 30_000;
export const WANDER_FIRST_MAX_MS = 60_000;
/** Rest after a hop. Quiet time is already inside this range. */
export const WANDER_MIN_REST_MS = 45_000;
export const WANDER_MAX_REST_MS = 90_000;
export const WANDER_QUIET_MS = 45_000;
export const WANDER_HOP_MIN_DIP = 80;
export const WANDER_HOP_MAX_DIP = 160;
/** One awake exploration session. It is not renewed by hops, the cursor, or the trail. */
export const WANDER_EXPLORE_MS = 360_000;
export const WANDER_HOME_EVERY = 3;
export const WANDER_MIN_HOP_DIP = 48;

export type WanderCommand = TravelDirection | 'home' | 'stop';

export type WanderHold =
  | 'off'
  | 'asleep'
  | 'waking'
  | 'hidden'
  | 'blocked'
  | 'tracking'
  | 'quiet'
  | 'rest'
  | 'manual'
  | 'moving'
  | 'display'
  | 'edge'
  | 'lease'
  | null;

export interface WanderSnapshot {
  awake: boolean;
  asleep: boolean;
  tracking: boolean;
  blocked: boolean;
  visible: boolean;
  travelPhase: 'idle' | 'moving' | 'paused';
  workArea: DipRect | null;
  window: DipRect;
  home: { x: number; y: number };
  displayKey: string | null;
}

export interface WanderState {
  enabled: boolean;
  seed: number;
  owned: boolean;
  yielded: boolean;
  held: boolean;
  quietSince: number | null;
  nextAt: number | null;
  journeys: number;
  lastDirection: TravelDirection | null;
  displayKey: string | null;
  /** Absolute time when this exploration session must end. Null means no session. */
  exploreUntil: number | null;
}

export interface WanderPlan {
  state: WanderState;
  command: WanderCommand | null;
  scheduleAt: number | null;
  hold: WanderHold;
  /** Set only for a direction hop. Home and manual nudges do not use it. */
  hopDip: number | null;
}

const DIRECTIONS: readonly TravelDirection[] = ['left', 'right', 'up', 'down'];

export function createWanderState(seed = 0x5eed): WanderState {
  return {
    enabled: false,
    seed: seed === 0 ? 1 : seed | 0,
    owned: false,
    yielded: false,
    held: false,
    quietSince: null,
    nextAt: null,
    journeys: 0,
    lastDirection: null,
    displayKey: null,
    exploreUntil: null,
  };
}

export function enableWander(state: WanderState, now: number, snap: WanderSnapshot): WanderPlan {
  if (state.enabled && state.exploreUntil !== null && now < state.exploreUntil) {
    return finish(state, null, boundedSchedule(state, state.owned ? null : state.nextAt, now), null);
  }
  const session = snap.visible && snap.awake && !snap.asleep;
  const opened: WanderState = {
    ...state,
    enabled: true,
    owned: false,
    yielded: false,
    held: !session,
    quietSince: session ? now : null,
    nextAt: null,
    journeys: 0,
    lastDirection: null,
    displayKey: snap.displayKey,
    exploreUntil: session ? now + WANDER_EXPLORE_MS : null,
  };
  const armed = session ? armRest(opened, now) : opened;
  return finish(armed, null, session ? boundedSchedule(armed, earliestMove(armed), now) : null, null);
}

/**
 * A user's wake may open one session. An open session is left unchanged,
 * so a second wake, a hop, or a cursor sample cannot extend it.
 */
export function noteWanderWake(state: WanderState, now: number): WanderState {
  if (!state.enabled) {
    return state;
  }
  if (state.exploreUntil !== null && now < state.exploreUntil) {
    return state;
  }
  return {
    ...state,
    exploreUntil: now + WANDER_EXPLORE_MS,
    held: true,
    owned: false,
    quietSince: null,
    nextAt: null,
    journeys: 0,
  };
}

/** User Sleep ends the session immediately. Wandering stays enabled and does not wake the robot. */
export function endWanderSession(state: WanderState, travelPhase: WanderSnapshot['travelPhase']): WanderPlan {
  if (!state.enabled) {
    return finish(state, null, null, 'off');
  }
  return closeSession(state, travelPhase, 'asleep');
}

export function disableWander(state: WanderState, travelPhase: WanderSnapshot['travelPhase']): WanderPlan {
  const stop = state.owned && travelPhase !== 'idle';
  return finish({ ...createWanderState(state.seed), enabled: false }, stop ? 'stop' : null, null, 'off');
}

/** A manual move replaces any pending wander. Nothing is queued behind it. */
export function yieldWander(state: WanderState): WanderState {
  return { ...state, owned: false, yielded: true, quietSince: null, nextAt: null };
}

export function noteWanderInteraction(state: WanderState): WanderState {
  return { ...state, quietSince: null };
}

export function planWander(state: WanderState, snap: WanderSnapshot, now: number): WanderPlan {
  if (!state.enabled) {
    return finish({ ...state, owned: false, nextAt: null, quietSince: null, exploreUntil: null }, null, null, 'off');
  }
  if (snap.asleep) {
    return endWanderSession(state, snap.travelPhase);
  }
  if (state.exploreUntil !== null && now >= state.exploreUntil) {
    return closeSession(state, snap.travelPhase, 'lease');
  }
  if (state.exploreUntil === null) {
    const stop = state.owned && snap.travelPhase !== 'idle';
    return finish({ ...state, owned: false, nextAt: null, quietSince: null }, stop ? 'stop' : null, null, 'lease');
  }
  if (!snap.awake) {
    const stop = state.owned && snap.travelPhase !== 'idle';
    const held = holdState(state);
    return finish(held, stop ? 'stop' : null, boundedSchedule(held, null, now), 'waking');
  }
  if (!snap.visible) {
    const held = holdState(state);
    return finish(held, null, boundedSchedule(held, null, now), 'hidden');
  }
  if (!snap.workArea || !snap.displayKey) {
    const stop = state.owned && snap.travelPhase !== 'idle';
    const held = { ...holdState(state), displayKey: null };
    return finish(held, stop ? 'stop' : null, boundedSchedule(held, null, now), 'display');
  }
  if (snap.displayKey !== state.displayKey) {
    const stop = state.owned && snap.travelPhase !== 'idle';
    const armed = armRest({
      ...state,
      owned: false,
      yielded: false,
      held: false,
      quietSince: now,
      lastDirection: null,
      displayKey: snap.displayKey,
    }, now);
    return finish(armed, stop ? 'stop' : null, boundedSchedule(armed, earliestMove(armed), now), 'display');
  }
  if (state.held) {
    const armed = armRest({ ...state, held: false, quietSince: now, owned: false }, now);
    return finish(armed, null, boundedSchedule(armed, earliestMove(armed), now), null);
  }
  if (snap.travelPhase !== 'idle') {
    if (!state.owned) {
      return finish(
        { ...state, yielded: true, owned: false, quietSince: null, nextAt: null },
        null,
        boundedSchedule(state, null, now),
        'manual',
      );
    }
    return finish(state, null, boundedSchedule(state, null, now), 'moving');
  }
  if (state.yielded) {
    const armed = armRest({ ...state, yielded: false, owned: false, quietSince: now }, now);
    return finish(armed, null, boundedSchedule(armed, earliestMove(armed), now), null);
  }
  if (state.owned) {
    const armed = armRest({ ...state, owned: false, quietSince: now }, now);
    return finish(armed, null, boundedSchedule(armed, earliestMove(armed), now), null);
  }
  if (snap.blocked) {
    return finish(
      { ...state, quietSince: null },
      null,
      boundedSchedule(state, Math.max(state.nextAt ?? 0, now + WANDER_QUIET_MS), now),
      'blocked',
    );
  }
  if (snap.tracking) {
    return finish(
      { ...state, quietSince: null },
      null,
      boundedSchedule(state, Math.max(state.nextAt ?? 0, now + WANDER_QUIET_MS), now),
      'tracking',
    );
  }
  if (state.quietSince === null) {
    const since = now;
    const at = Math.max(state.nextAt ?? now + WANDER_QUIET_MS, since + WANDER_QUIET_MS);
    return finish({ ...state, quietSince: since }, null, boundedSchedule(state, at, now), 'quiet');
  }
  const nextAt = state.nextAt ?? now + WANDER_MIN_REST_MS;
  const quietAt = state.quietSince + WANDER_QUIET_MS;
  if (now < nextAt || now < quietAt) {
    return finish(state, null, boundedSchedule(state, Math.max(nextAt, quietAt), now), now < quietAt ? 'quiet' : 'rest');
  }
  if ((state.journeys + 1) % WANDER_HOME_EVERY === 0) {
    return finish({
      ...state,
      owned: true,
      journeys: state.journeys + 1,
      quietSince: null,
      nextAt: null,
    }, 'home', boundedSchedule(state, null, now), null);
  }
  const choice = chooseDirection(state, snap);
  if (!choice) {
    const armed = armRest({ ...state, seed: mix(state.seed).seed }, now);
    return finish(armed, null, boundedSchedule(armed, earliestMove(armed), now), 'edge');
  }
  return finish({
    ...state,
    seed: choice.seed,
    owned: true,
    journeys: state.journeys + 1,
    lastDirection: choice.direction,
    quietSince: null,
    nextAt: null,
  }, choice.direction, boundedSchedule(state, null, now), null, choice.hopDip);
}

function closeSession(state: WanderState, travelPhase: WanderSnapshot['travelPhase'], hold: WanderHold): WanderPlan {
  const stop = state.owned && travelPhase !== 'idle';
  return finish({
    ...state,
    owned: false,
    yielded: false,
    held: false,
    quietSince: null,
    nextAt: null,
    exploreUntil: null,
  }, stop ? 'stop' : null, null, hold);
}

/** The next check is never later than the open session. A null session does not schedule. */
function boundedSchedule(state: WanderState, at: number | null, now: number): number | null {
  if (!state.enabled || state.exploreUntil === null || now >= state.exploreUntil) {
    return null;
  }
  if (at === null) {
    return state.exploreUntil;
  }
  return Math.min(at, state.exploreUntil);
}

function holdState(state: WanderState): WanderState {
  return { ...state, owned: false, yielded: false, held: true, quietSince: null, nextAt: null };
}

function earliestMove(state: WanderState): number | null {
  if (state.nextAt == null) {
    return null;
  }
  if (state.quietSince == null) {
    return state.nextAt;
  }
  return Math.max(state.nextAt, state.quietSince + WANDER_QUIET_MS);
}

function armRest(state: WanderState, now: number): WanderState {
  const delay = wanderDelayMs(state.seed, state.journeys === 0);
  return { ...state, seed: delay.seed, nextAt: now + delay.delayMs };
}

export function wanderDelayMs(seed: number, first = false): { seed: number; delayMs: number } {
  const mixed = mix(seed);
  const min = first ? WANDER_FIRST_MIN_MS : WANDER_MIN_REST_MS;
  const max = first ? WANDER_FIRST_MAX_MS : WANDER_MAX_REST_MS;
  const delayMs = min + Math.floor(mixed.unit * (max - min + 1));
  return { seed: mixed.seed, delayMs: Math.min(max, Math.max(min, delayMs)) };
}

export function wanderHopDip(seed: number): { seed: number; hopDip: number } {
  const mixed = mix(seed);
  const hopDip = WANDER_HOP_MIN_DIP + Math.floor(mixed.unit * (WANDER_HOP_MAX_DIP - WANDER_HOP_MIN_DIP + 1));
  return { seed: mixed.seed, hopDip: Math.min(WANDER_HOP_MAX_DIP, Math.max(WANDER_HOP_MIN_DIP, hopDip)) };
}

function chooseDirection(state: WanderState, snap: WanderSnapshot): { seed: number; direction: TravelDirection; hopDip: number } | null {
  const area = snap.workArea;
  if (!area) {
    return null;
  }
  const sized = wanderHopDip(state.seed);
  const mixed = mix(sized.seed);
  const reverse = state.lastDirection ? opposite(state.lastDirection) : null;
  const fresh = DIRECTIONS.filter((direction) => direction !== reverse && direction !== state.lastDirection);
  const start = fresh.length === 0 ? 0 : Math.floor(mixed.unit * fresh.length) % fresh.length;
  const sequence = [...fresh.slice(start), ...fresh.slice(0, start)];
  if (state.lastDirection && state.lastDirection !== reverse) {
    sequence.push(state.lastDirection);
  }
  if (reverse) {
    sequence.push(reverse);
  }
  for (const direction of sequence) {
    const target = wanderHop(snap.window, direction, area, sized.hopDip);
    const distance = Math.hypot(target.x - snap.window.x, target.y - snap.window.y);
    if (distance >= WANDER_MIN_HOP_DIP) {
      return { seed: mixed.seed, direction, hopDip: sized.hopDip };
    }
  }
  return null;
}

export function wanderHop(window: DipRect, direction: TravelDirection, workArea: DipRect, distanceDip = WANDER_HOP_MIN_DIP): { x: number; y: number } {
  const step = Math.min(WANDER_HOP_MAX_DIP, Math.max(1, distanceDip));
  const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
  const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;
  const width = Math.min(Math.max(window.width, 1), Math.max(workArea.width, 1));
  const height = Math.min(Math.max(window.height, 1), Math.max(workArea.height, 1));
  const maxX = workArea.x + Math.max(workArea.width - width, 0);
  const maxY = workArea.y + Math.max(workArea.height - height, 0);
  return {
    x: Math.min(maxX, Math.max(workArea.x, window.x + dx)),
    y: Math.min(maxY, Math.max(workArea.y, window.y + dy)),
  };
}

function opposite(direction: TravelDirection): TravelDirection {
  if (direction === 'left') {
    return 'right';
  }
  if (direction === 'right') {
    return 'left';
  }
  if (direction === 'up') {
    return 'down';
  }
  return 'up';
}

function mix(seed: number): { seed: number; unit: number } {
  let next = Math.imul(seed | 0, 1664525) + 1013904223;
  if (next === 0) {
    next = 1;
  }
  return { seed: next, unit: (next >>> 0) / 4294967296 };
}

function finish(
  state: WanderState,
  command: WanderCommand | null,
  scheduleAt: number | null,
  hold: WanderHold,
  hopDip: number | null = null,
): WanderPlan {
  return { state, command, scheduleAt, hold, hopDip };
}
