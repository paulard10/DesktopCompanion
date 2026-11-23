import { COMPANION_LAYOUT, type CompanionLayout } from './companionLayout.ts';

/**
 * Diameter of the main-body click proxy, in DIP.
 * The renderer frames the robot body to this same circle. Compact arms have
 * separate trusted capsules. The antenna is outside the guaranteed hit target.
 */
export const ORB_DIAMETER_DIP = COMPANION_LAYOUT.bodyProxyDip.diameter;
export const ORB_RADIUS_DIP = ORB_DIAMETER_DIP / 2;

/**
 * Extra padding on the central body circle. Kept at zero; the arm envelopes
 * are separate explicit shapes, and window corners are not an extra target.
 */
export const HIT_SLACK_DIP = 0;

/**
 * How long the window stays clickable after the pointer leaves the target
 * while still inside the overlay rectangle. Zero means the next sample
 * returns to passthrough. The poll interval is the only remaining delay.
 */
export const LEAVE_HOLD_MS = 0;

/** A sample older than this is ignored and the window goes click-through. */
export const SAMPLE_STALE_MS = 250;

/** Cursor poll while the overlay is visible. Main process only. */
export const CURSOR_POLL_MS = 16;
/** Asleep and away from the robot. Click-through returns to the fast poll inside the margin. */
export const CURSOR_IDLE_POLL_MS = 80;
export const CURSOR_IDLE_MARGIN_DIP = 96;

export interface DipPoint {
  x: number;
  y: number;
}

export interface OrbGeometry {
  centerX: number;
  centerY: number;
  radius: number;
  captureRadius: number;
}

export function orbGeometry(windowWidth: number, windowHeight: number, layout: CompanionLayout = COMPANION_LAYOUT): OrbGeometry {
  const radius = layout.bodyProxyDip.diameter / 2;
  return {
    centerX: windowWidth / 2,
    centerY: windowHeight / 2,
    radius,
    captureRadius: radius + HIT_SLACK_DIP,
  };
}

export function windowLocalPoint(cursor: DipPoint, windowOrigin: DipPoint): DipPoint {
  return {
    x: cursor.x - windowOrigin.x,
    y: cursor.y - windowOrigin.y,
  };
}

export function isInsideWindow(local: DipPoint, width: number, height: number): boolean {
  return local.x >= 0 && local.y >= 0 && local.x < width && local.y < height;
}

export function distanceToOrb(local: DipPoint, geometry: OrbGeometry): number {
  return Math.hypot(local.x - geometry.centerX, local.y - geometry.centerY);
}

/** Fixed main-owned arm envelopes; no renderer-provided geometry or raycasts. */
export function armProxyHit(local: DipPoint, width: number, height: number, layout: CompanionLayout = COMPANION_LAYOUT): boolean {
  const arm = layout.armProxyDip;
  if (!arm || !isInsideWindow(local, width, height)) return false;
  const x = Math.abs(local.x - width / 2) - arm.fromX;
  const y = local.y - height / 2 - arm.fromY;
  const dx = arm.toX - arm.fromX;
  const dy = arm.toY - arm.fromY;
  const along = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy)));
  return (x - along * dx) ** 2 + (y - along * dy) ** 2 <= arm.radius ** 2;
}

export type PointerMode = 'passthrough' | 'interactive';

export type PointerReason =
  | 'hidden'
  | 'recovery'
  | 'stale'
  | 'outside-window'
  | 'inside-target'
  | 'outside-target'
  | 'holding-exit'
  | 'left-target';

export interface WindowSample {
  cursor: DipPoint;
  windowOrigin: DipPoint;
  windowWidth: number;
  windowHeight: number;
  sampleAt: number;
}

export interface CircleObservation {
  cursorInsideWindow: boolean;
  distanceDip: number | null;
  captureRadiusDip: number;
  sampleAt: number;
  onArm?: boolean;
}

export interface PointerDecisionState {
  mode: PointerMode;
  leavePendingSince: number | null;
}

export interface PointerDecision {
  state: PointerDecisionState;
  mode: PointerMode;
  reason: PointerReason;
}

export const INITIAL_POINTER_STATE: PointerDecisionState = {
  mode: 'passthrough',
  leavePendingSince: null,
};

export interface PointerOptions {
  visible: boolean;
  recoveryCapture: boolean;
  now: number;
}

export function observeCircle(sample: WindowSample, layout: CompanionLayout = COMPANION_LAYOUT): CircleObservation {
  const local = windowLocalPoint(sample.cursor, sample.windowOrigin);
  const geometry = orbGeometry(sample.windowWidth, sample.windowHeight, layout);
  const inside = isInsideWindow(local, sample.windowWidth, sample.windowHeight);
  return {
    cursorInsideWindow: inside,
    distanceDip: inside ? distanceToOrb(local, geometry) : null,
    captureRadiusDip: geometry.captureRadius,
    sampleAt: sample.sampleAt,
    onArm: inside && armProxyHit(local, sample.windowWidth, sample.windowHeight, layout),
  };
}

/**
 * Main-process input policy. A null observation, a stale sample, or a cursor
 * outside the window becomes passthrough. The renderer cannot supply this hit.
 */
export function decidePointerMode(
  observation: CircleObservation | null,
  previous: PointerDecisionState,
  options: PointerOptions,
): PointerDecision {
  if (!options.visible) {
    return decision('passthrough', 'hidden', null);
  }
  if (options.recoveryCapture) {
    return decision('interactive', 'recovery', null);
  }
  if (!observation || options.now - observation.sampleAt > SAMPLE_STALE_MS) {
    return decision('passthrough', 'stale', null);
  }
  if (!observation.cursorInsideWindow || observation.distanceDip === null) {
    return decision('passthrough', 'outside-window', null);
  }

  const onTarget = observation.distanceDip <= observation.captureRadiusDip || observation.onArm === true;
  if (onTarget) {
    return decision('interactive', 'inside-target', null);
  }
  if (previous.mode === 'passthrough') {
    return decision('passthrough', 'outside-target', null);
  }

  const pendingSince = previous.leavePendingSince ?? observation.sampleAt;
  if (observation.sampleAt - pendingSince >= LEAVE_HOLD_MS) {
    return decision('passthrough', 'left-target', null);
  }
  return decision('interactive', 'holding-exit', pendingSince);
}

function decision(
  mode: PointerMode,
  reason: PointerReason,
  leavePendingSince: number | null,
): PointerDecision {
  return {
    mode,
    reason,
    state: { mode, leavePendingSince },
  };
}
