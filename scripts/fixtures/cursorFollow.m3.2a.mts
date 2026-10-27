/** Experimental follow kinematics in desktop DIP and one monotonic clock. */
export const FOLLOW = {
  observeJitterDip: 3, directionResponseMs: 150, decisionMs: 200,
  enterDistanceDip: 220, enterDwellMs: 250, trailingDip: 170,
  minimumExclusionDip: 110, footprintGapDip: 12, roundingGuardDip: 2,
  targetDeadZoneDip: 24, arrivalDip: 8, arrivalSpeed: 5,
  cruiseSpeed: 130, maxSpeed: 160, acceleration: 320,
  maxStepMs: 64, staleMs: 250, idleMs: 1200, resumeMs: 500,
  captureDwellMs: 300, boutMs: 6000, restMs: 5000, leaseMs: 360000,
} as const;

export interface FollowPoint { x: number; y: number }
export interface FollowRect extends FollowPoint { width: number; height: number }
export interface FollowCursor extends FollowPoint { at: number }
export type FollowPhase = 'off' | 'resting' | 'moving' | 'held';
export interface FollowState {
  enabled: boolean; phase: FollowPhase; reason: string;
  x: number; y: number; vx: number; vy: number;
  target: FollowPoint | null; cursor: FollowCursor | null; anchor: FollowCursor | null;
  dirX: number; dirY: number; lastMotionAt: number; lastDecisionAt: number;
  lastTickAt: number; farSince: number | null; resumeAt: number;
  boutUntil: number | null; restUntil: number; leaseUntil: number | null;
  wasAwake: boolean; displayKey: string | null; stoppedAt: number;
}
export interface FollowView {
  window: FollowRect; workArea: FollowRect | null; displayKey: string | null;
  visualRadiusDip: number; visible: boolean; awake: boolean; blocked: boolean;
  recovery: boolean; reducedMotion: boolean; manual: boolean;
}

export function initialFollow(): FollowState {
  return { enabled: false, phase: 'off', reason: 'off', x: 0, y: 0, vx: 0, vy: 0,
    target: null, cursor: null, anchor: null, dirX: 1, dirY: 0,
    lastMotionAt: -Infinity, lastDecisionAt: -Infinity, lastTickAt: 0,
    farSince: null, resumeAt: 0, boutUntil: null, restUntil: 0,
    leaseUntil: null, wasAwake: false, displayKey: null, stoppedAt: -Infinity };
}

export function enableFollow(rect: FollowRect, displayKey: string | null, now: number): FollowState {
  if (!validRect(rect) || !displayKey || !Number.isFinite(now)) return initialFollow();
  return { ...initialFollow(), enabled: true, phase: 'resting', reason: 'enabled',
    x: rect.x, y: rect.y, displayKey, lastTickAt: now, resumeAt: now + FOLLOW.resumeMs };
}

export function holdFollow(state: FollowState, now: number, reason: string): FollowState {
  if (!state.enabled) return state;
  const at = Number.isFinite(now) ? now : state.lastTickAt;
  return { ...state, phase: 'held', reason, vx: 0, vy: 0, target: null,
    farSince: null, boutUntil: null, lastTickAt: at,
    resumeAt: at + FOLLOW.resumeMs,
    stoppedAt: state.phase === 'moving' ? at : state.stoppedAt };
}

/** Retains latest cursor and one motion anchor only, not a cursor history. */
export function observeFollowCursor(state: FollowState, cursor: FollowCursor): FollowState {
  if (!state.enabled) return state;
  if (![cursor.x, cursor.y, cursor.at].every(Number.isFinite) ||
      (state.cursor && cursor.at < state.cursor.at)) return { ...holdFollow(state, state.lastTickAt, 'invalid-cursor'), cursor: null, anchor: null };
  const anchor = state.anchor;
  if (!anchor) return { ...state, cursor, anchor: cursor, lastMotionAt: cursor.at };
  const dx = cursor.x - anchor.x, dy = cursor.y - anchor.y;
  const distance = Math.hypot(dx, dy);
  if (distance < FOLLOW.observeJitterDip) return { ...state, cursor };
  const mix = 1 - Math.exp(-Math.max(1, cursor.at - anchor.at) / FOLLOW.directionResponseMs);
  const x = state.dirX + (dx / distance - state.dirX) * mix;
  const y = state.dirY + (dy / distance - state.dirY) * mix;
  const length = Math.hypot(x, y);
  return { ...state, cursor, anchor: cursor, lastMotionAt: cursor.at,
    dirX: length > 0.001 ? x / length : state.dirX, dirY: length > 0.001 ? y / length : state.dirY };
}

export function exclusionRadius(visualRadiusDip: number): number {
  return Math.max(FOLLOW.minimumExclusionDip, visualRadiusDip + FOLLOW.footprintGapDip);
}

export function segmentDistance(point: FollowPoint, from: FollowPoint, to: FollowPoint): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  const square = dx * dx + dy * dy;
  const t = square > 0 ? clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / square, 0, 1) : 0;
  return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
}

function validRect(rect: FollowRect | null): rect is FollowRect {
  return !!rect && [rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}
function contains(rect: FollowRect, point: FollowPoint): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}
function center(state: FollowPoint, view: FollowView): FollowPoint {
  return { x: state.x + view.window.width / 2, y: state.y + view.window.height / 2 };
}
function gate(state: FollowState, view: FollowView, now: number): string | null {
  if (!Number.isFinite(now) || !validRect(view.window) || !validRect(view.workArea) ||
      !Number.isFinite(view.visualRadiusDip) || view.visualRadiusDip < 0 ||
      view.window.width > view.workArea.width || view.window.height > view.workArea.height ||
      view.window.x < view.workArea.x || view.window.y < view.workArea.y ||
      view.window.x + view.window.width > view.workArea.x + view.workArea.width ||
      view.window.y + view.window.height > view.workArea.y + view.workArea.height ||
      !view.displayKey || state.displayKey !== view.displayKey) return 'display';
  if (!view.visible) return 'hidden';
  if (!view.awake) return 'asleep';
  if (view.blocked) return 'interaction';
  if (view.manual) return 'manual';
  if (view.recovery || view.reducedMotion) return 'accessibility';
  if (!state.cursor || now < state.cursor.at || now - state.cursor.at > FOLLOW.staleMs) return 'stale';
  if (!contains(view.workArea, state.cursor)) return 'cursor-display';
  if (Math.hypot(center(state, view).x - state.cursor.x, center(state, view).y - state.cursor.y) < exclusionRadius(view.visualRadiusDip) + FOLLOW.roundingGuardDip) return 'cursor-near';
  if (state.leaseUntil !== null && now >= state.leaseUntil) return 'lease';
  return null;
}

/** Immediate gates run at observation cadence; target decisions are <=5 Hz. */
export function planFollow(state: FollowState, view: FollowView, now: number): FollowState {
  if (!state.enabled) return state;
  const block = gate(state, view, now);
  if (block) {
    const held = holdFollow({ ...state,
      x: Number.isFinite(view.window.x) ? view.window.x : state.x,
      y: Number.isFinite(view.window.y) ? view.window.y : state.y }, now, block);
    return view.awake ? held : { ...held, wasAwake: false, leaseUntil: null };
  }
  let next = state.wasAwake ? state : { ...state, wasAwake: true, leaseUntil: now + FOLLOW.leaseMs };
  if (now < next.resumeAt || now - next.lastDecisionAt < FOLLOW.decisionMs) return next;
  next = { ...next, lastDecisionAt: now };
  const speed = Math.hypot(next.vx, next.vy);
  if (next.boutUntil !== null && now >= next.boutUntil) next = { ...next, boutUntil: null, restUntil: now + FOLLOW.restMs };
  if (now < next.restUntil || now - next.lastMotionAt >= FOLLOW.idleMs) {
    return { ...next, target: null, farSince: null, phase: speed > 0 ? 'moving' : 'resting', reason: 'rest' };
  }
  const body = center(next, view);
  const cursor = next.cursor!;
  const distance = Math.hypot(cursor.x - body.x, cursor.y - body.y);
  if (next.phase !== 'moving') {
    if (distance <= FOLLOW.enterDistanceDip) return { ...next, phase: 'resting', reason: 'dead-zone', farSince: null };
    const since = next.farSince ?? now;
    if (now - since < FOLLOW.enterDwellMs) return { ...next, farSince: since, phase: 'resting', reason: 'dwell' };
  }
  const target = chooseTarget(next, view);
  if (!target) return holdFollow(next, now, 'no-safe-target');
  const nearOld = next.target && Math.hypot(target.x - next.target.x, target.y - next.target.y) < FOLLOW.targetDeadZoneDip;
  let goal = nearOld ? next.target! : next.target
    ? { x: next.target.x + (target.x - next.target.x) * 0.55, y: next.target.y + (target.y - next.target.y) * 0.55 }
    : target;
  if (!safeSegment(next, goal, view, next.cursor!)) goal = target;
  return { ...next, target: goal, phase: 'moving', reason: 'following',
    lastTickAt: next.phase === 'moving' ? next.lastTickAt : now,
    boutUntil: next.boutUntil ?? now + FOLLOW.boutMs };
}

function chooseTarget(state: FollowState, view: FollowView): FollowPoint | null {
  const area = view.workArea!, cursor = state.cursor!, body = center(state, view);
  const away = Math.hypot(body.x - cursor.x, body.y - cursor.y);
  const spacing = Math.max(FOLLOW.trailingDip, exclusionRadius(view.visualRadiusDip) + 24);
  const directions = [[-state.dirX, -state.dirY], [(body.x - cursor.x) / away, (body.y - cursor.y) / away],
    [-state.dirY, state.dirX], [state.dirY, -state.dirX], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of directions) {
    const goal = {
      x: clamp(cursor.x + dx! * spacing - view.window.width / 2, area.x, area.x + area.width - view.window.width),
      y: clamp(cursor.y + dy! * spacing - view.window.height / 2, area.y, area.y + area.height - view.window.height),
    };
    if (safeSegment(state, goal, view, state.cursor!)) return goal;
  }
  return null;
}
function safeSegment(from: FollowPoint, to: FollowPoint, view: FollowView, cursor: FollowPoint): boolean {
  return segmentDistance(cursor, center(from, view), center(to, view)) >= exclusionRadius(view.visualRadiusDip) + FOLLOW.roundingGuardDip;
}

/** Fractional integration. Safety stops may zero velocity; ordinary braking is bounded. */
export function stepFollow(state: FollowState, view: FollowView, now: number): FollowState {
  if (!state.enabled || state.phase !== 'moving') return state;
  const block = gate(state, view, now);
  if (block) return holdFollow(state, now, block);
  const elapsed = now - state.lastTickAt;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > FOLLOW.staleMs) return holdFollow(state, now, 'clock-gap');
  const dt = Math.min(elapsed, FOLLOW.maxStepMs) / 1000;
  if (dt <= 0) return state;
  const dx = state.target ? state.target.x - state.x : 0, dy = state.target ? state.target.y - state.y : 0;
  const distance = Math.hypot(dx, dy), oldSpeed = Math.hypot(state.vx, state.vy);
  if (state.target && distance <= FOLLOW.arrivalDip && oldSpeed < FOLLOW.arrivalSpeed && oldSpeed <= FOLLOW.acceleration * dt) return { ...state, phase: 'resting', reason: 'arrived', vx: 0, vy: 0, target: null, farSince: null, boutUntil: null, stoppedAt: now, lastTickAt: now };
  const speed = state.target ? Math.min(FOLLOW.maxSpeed, FOLLOW.cruiseSpeed, Math.sqrt(2 * FOLLOW.acceleration * Math.max(0, distance - FOLLOW.arrivalDip))) : 0;
  const desiredX = distance > 0 ? dx / distance * speed : 0, desiredY = distance > 0 ? dy / distance * speed : 0;
  const change = Math.hypot(desiredX - state.vx, desiredY - state.vy);
  const mix = change > 0 ? Math.min(1, FOLLOW.acceleration * dt / change) : 1;
  const vx = state.vx + (desiredX - state.vx) * mix, vy = state.vy + (desiredY - state.vy) * mix;
  const area = view.workArea!;
  const next = { x: state.x + vx * dt, y: state.y + vy * dt };
  const clamped = { x: clamp(next.x, area.x, area.x + area.width - view.window.width), y: clamp(next.y, area.y, area.y + area.height - view.window.height) };
  if (clamped.x !== next.x || clamped.y !== next.y || !safeSegment(state, next, view, state.cursor!)) return holdFollow(state, now, 'safety-stop');
  if (!state.target && vx === 0 && vy === 0) return { ...state, phase: 'resting', vx: 0, vy: 0, stoppedAt: now, lastTickAt: now };
  return { ...state, ...next, vx, vy, lastTickAt: now };
}

export function followInputSuppressed(state: FollowState, now: number): boolean {
  return state.enabled && (state.phase === 'moving' || now - state.stoppedAt < FOLLOW.captureDwellMs);
}
function clamp(value: number, low: number, high: number): number { return Math.min(high, Math.max(low, value)); }
