/** Desktop travel in DIP. Imports nothing. The main process applies the result. */

export const NUDGE_DIP = 120;
/** Short diagnostic hop. The travel controller still clamps and pauses it. */
export const MOVE_TEST_DIP = 48;
export const MAX_SPEED_DIP_PER_SEC = 160;
export const MIN_MOVE_MS = 280;
export const MAX_MOVE_MS = 4_000;

export type TravelDirection = 'left' | 'right' | 'up' | 'down';
export type TravelPhase = 'idle' | 'moving' | 'paused';
export type TravelBlock = 'chat' | 'voice' | 'busy';

export interface DipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TravelState {
  phase: TravelPhase;
  x: number;
  y: number;
  width: number;
  height: number;
  homeX: number;
  homeY: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  durationMs: number;
  pause: TravelBlock | null;
}

export function createTravel(rect: DipRect, home: { x: number; y: number }): TravelState {
  return {
    phase: 'idle',
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    homeX: home.x,
    homeY: home.y,
    fromX: rect.x,
    fromY: rect.y,
    toX: rect.x,
    toY: rect.y,
    startedAt: 0,
    durationMs: 0,
    pause: null,
  };
}

export function travelBlock(input: {
  chatOpen: boolean;
  listening: boolean;
  speaking: boolean;
  generating: boolean;
}): TravelBlock | null {
  if (input.listening || input.speaking) {
    return 'voice';
  }
  if (input.generating) {
    return 'busy';
  }
  if (input.chatOpen) {
    return 'chat';
  }
  return null;
}

/** Electron workArea is already DIP. Scale is checked and never applied. */
export function workAreaDip(display: { workArea: DipRect; scaleFactor: number } | null): DipRect | null {
  if (!display || !Number.isFinite(display.scaleFactor) || display.scaleFactor <= 0) {
    return null;
  }
  const area = display.workArea;
  if (!Number.isFinite(area.x) || !Number.isFinite(area.y) || area.width < 1 || area.height < 1) {
    return null;
  }
  return area;
}

export function clampWindow(rect: DipRect, workArea: DipRect): DipRect {
  const width = Math.min(Math.max(rect.width, 1), Math.max(workArea.width, 1));
  const height = Math.min(Math.max(rect.height, 1), Math.max(workArea.height, 1));
  const maxX = workArea.x + Math.max(workArea.width - width, 0);
  const maxY = workArea.y + Math.max(workArea.height - height, 0);
  return {
    x: clamp(rect.x, workArea.x, maxX),
    y: clamp(rect.y, workArea.y, maxY),
    width,
    height,
  };
}

export function recoverWindow(current: DipRect, matching: DipRect | null, fallback: DipRect): DipRect {
  return clampWindow(current, matching ?? fallback);
}

export function nudgeTarget(
  state: TravelState,
  direction: TravelDirection,
  workArea: DipRect,
  distanceDip = NUDGE_DIP,
): { x: number; y: number } {
  const step = Number.isFinite(distanceDip) ? distanceDip : NUDGE_DIP;
  const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
  const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;
  const clamped = clampWindow({ ...state, x: state.x + dx, y: state.y + dy, width: state.width, height: state.height }, workArea);
  return { x: clamped.x, y: clamped.y };
}

export function requestTravel(state: TravelState, target: { x: number; y: number }, now: number, workArea: DipRect | null): TravelState {
  if (!workArea) {
    return stopTravel(state);
  }
  const sized = { ...state, width: state.width, height: state.height };
  const clamped = clampWindow({ ...sized, x: target.x, y: target.y }, workArea);
  return begin(sized, clamped.x, clamped.y, now, workArea);
}

export function requestHome(state: TravelState, now: number, workArea: DipRect | null): TravelState {
  return requestTravel(state, { x: state.homeX, y: state.homeY }, now, workArea);
}

export function stopTravel(state: TravelState): TravelState {
  return {
    ...state,
    phase: 'idle',
    pause: null,
    fromX: state.x,
    fromY: state.y,
    toX: state.x,
    toY: state.y,
    durationMs: 0,
  };
}

export function rememberHome(state: TravelState, home: { x: number; y: number }): TravelState {
  return { ...state, homeX: home.x, homeY: home.y };
}

export function syncTravelBounds(state: TravelState, rect: DipRect): TravelState {
  return { ...state, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export function stepTravel(
  state: TravelState,
  now: number,
  workArea: DipRect | null,
  block: TravelBlock | null,
): TravelState {
  if (state.phase === 'idle') {
    return state;
  }
  if (!workArea) {
    return stopTravel(state);
  }
  const dest = clampWindow({ ...state, x: state.toX, y: state.toY }, workArea);
  let next = state;
  if (Math.abs(dest.x - state.toX) > 0.5 || Math.abs(dest.y - state.toY) > 0.5) {
    next = begin(state, dest.x, dest.y, now, workArea);
  }
  if (block) {
    if (next.phase === 'idle') {
      return next;
    }
    return { ...next, phase: 'paused', pause: block };
  }
  if (next.phase === 'paused') {
    next = begin(next, next.toX, next.toY, now, workArea);
  }
  if (next.phase !== 'moving') {
    return next;
  }
  const span = Math.max(next.durationMs, 1);
  const t = clamp((now - next.startedAt) / span, 0, 1);
  if (t >= 1) {
    const arrived = clampWindow({ ...next, x: next.toX, y: next.toY }, workArea);
    return stopTravel({ ...next, x: arrived.x, y: arrived.y, width: arrived.width, height: arrived.height });
  }
  const eased = t * t * (3 - 2 * t);
  const x = next.fromX + (next.toX - next.fromX) * eased;
  const y = next.fromY + (next.toY - next.fromY) * eased;
  const placed = clampWindow({ ...next, x, y }, workArea);
  return { ...next, x: placed.x, y: placed.y, width: placed.width, height: placed.height, pause: null };
}

export function applyTravelPose<T extends { tiltX: number; tiltZ?: number; antenna: number; hover: number; armRelax: number; squash?: number }>(
  pose: T,
  input: { traveling: boolean; alertness: number; presence: string | null; reducedMotion: boolean; now: number; travelAgeMs?: number },
): T {
  if (!input.traveling || input.alertness < 0.9 || input.reducedMotion) {
    return pose;
  }
  if (input.presence === 'SPEAKING' || input.presence === 'ERROR' || input.presence === 'HAPPY') {
    return pose;
  }
  const age = Number.isFinite(input.travelAgeMs) ? Math.max(0, input.travelAgeMs as number) : 360;
  const launch = Math.exp(-age / 240);
  const wave = Math.sin(input.now / 220);
  return {
    ...pose,
    tiltX: pose.tiltX + 0.07 + 0.04 * launch,
    tiltZ: (pose.tiltZ ?? 0) + Math.sin(input.now / 980) * 0.018,
    antenna: pose.antenna - 0.05 * launch + wave * 0.035,
    hover: pose.hover + 0.01,
    armRelax: Math.min(1, pose.armRelax + 0.1 + launch * 0.08),
    squash: 1 - 0.055 * launch,
  };
}

function begin(state: TravelState, toX: number, toY: number, now: number, workArea: DipRect): TravelState {
  const clamped = clampWindow({ ...state, x: toX, y: toY }, workArea);
  const distance = Math.hypot(clamped.x - state.x, clamped.y - state.y);
  if (distance < 1) {
    return stopTravel({ ...state, x: clamped.x, y: clamped.y });
  }
  const atMaxSpeedMs = (distance / MAX_SPEED_DIP_PER_SEC) * 1000;
  // The duration ceiling never raises speed. A long return may outlast MAX_MOVE_MS.
  const durationMs = Math.max(atMaxSpeedMs, MIN_MOVE_MS);
  return {
    ...state,
    phase: 'moving',
    pause: null,
    fromX: state.x,
    fromY: state.y,
    toX: clamped.x,
    toY: clamped.y,
    startedAt: now,
    durationMs,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
