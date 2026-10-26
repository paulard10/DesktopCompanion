import type { EyePair } from './faceExpression.js';
import type { RigProbeName } from './rigProbe.js';
import type { SecondaryPose } from './secondaryMotion.js';

/** Deterministic idle motion. A later GLB plays the same pose; it does not own the clock. */

export const HOVER_AMPLITUDE_WORLD = 0.04;
export const HOVER_PERIOD_MS = 3400;

export const TILT_Z_RADIANS = 0.055;
export const TILT_X_RADIANS = 0.03;
export const TILT_Z_PERIOD_MS = 4600;
export const TILT_X_PERIOD_MS = 5200;

export const ANTENNA_SWAY_RADIANS = 0.12;
export const ANTENNA_PERIOD_MS = 2700;

export const BLINK_PERIOD_MS = 3400;
export const BLINK_START_MS = 500;
export const BLINK_CLOSE_MS = 60;
export const BLINK_HOLD_MS = 50;
export const BLINK_OPEN_MS = 70;

export const CLICK_PULSE_MS = 180;

export interface AvatarPose {
  hover: number;
  tiltX: number;
  tiltZ: number;
  bodyYaw: number;
  /** 0 is open, 1 is shut. */
  blink: number;
  antenna: number;
  /** 0 is dim sleep light, 1 is full neon. */
  glow: number;
  eyeYaw: number;
  eyePitch: number;
  /** 0 is the awake arm pose, 1 is fully relaxed. */
  armRelax: number;
  /** Extra scale from the wake overshoot. 1 is rest. */
  wakeScale: number;
  /** 1 is the normal eye arch. Kept for callers that predate the eye pair. */
  eyeScale: number;
  /** Stepped expression. Absent poses fall back to eyeScale. */
  eyes?: EyePair;
  /** Body, face, antenna, and arm offsets. Absent means neutral. */
  secondary?: SecondaryPose;
  /** Development actuator. Absent means the normal pose. */
  rigProbe?: { name: RigProbeName; startedAt: number } | null;
}

export function ambientPose(timeMs: number): AvatarPose {
  return {
    hover: wave(timeMs, HOVER_PERIOD_MS, 0) * HOVER_AMPLITUDE_WORLD,
    tiltZ: wave(timeMs, TILT_Z_PERIOD_MS, 0.4) * TILT_Z_RADIANS,
    tiltX: wave(timeMs, TILT_X_PERIOD_MS, 1.1) * TILT_X_RADIANS,
    antenna: wave(timeMs, ANTENNA_PERIOD_MS, 0.8) * ANTENNA_SWAY_RADIANS,
    blink: blinkAmount(timeMs),
    bodyYaw: 0,
    glow: 1,
    eyeYaw: 0,
    eyePitch: 0,
    armRelax: 0,
    wakeScale: 1,
    eyeScale: 1,
  };
}

export function clickPulseScale(startedAtMs: number | null, nowMs: number): number {
  if (startedAtMs === null) {
    return 1;
  }
  const elapsed = nowMs - startedAtMs;
  if (elapsed < 0 || elapsed >= CLICK_PULSE_MS) {
    return 1;
  }
  return 1 + Math.sin((elapsed / CLICK_PULSE_MS) * Math.PI) * 0.035;
}

function wave(timeMs: number, periodMs: number, phaseTurns: number): number {
  const turns = timeMs / periodMs + phaseTurns;
  return Math.sin(turns * Math.PI * 2);
}

export function blinkAmount(timeMs: number, periodMs = BLINK_PERIOD_MS): number {
  const period = Math.max(periodMs, BLINK_START_MS + BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS);
  const phase = modulo(timeMs, period);
  const elapsed = phase - BLINK_START_MS;
  const closeEnd = BLINK_CLOSE_MS;
  const holdEnd = closeEnd + BLINK_HOLD_MS;
  const openEnd = holdEnd + BLINK_OPEN_MS;
  if (elapsed < 0 || elapsed >= openEnd) {
    return 0;
  }
  if (elapsed < closeEnd) {
    return elapsed / BLINK_CLOSE_MS;
  }
  if (elapsed < holdEnd) {
    return 1;
  }
  return 1 - (elapsed - holdEnd) / BLINK_OPEN_MS;
}

function modulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}
