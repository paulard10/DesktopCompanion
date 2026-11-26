/**
 * Eye silhouettes for the procedural rig.
 * The mesh stays a torus arc. Closure is a vertical scale, not a new eyelid.
 * This module does not touch the window, the trail, or any model.
 */

import type { Phase } from './behavior.js';
import type { PresenceName } from './presence.js';

export const EYE_CLOSED = 0.045;
/** About 90 percent of a change in under half a second. */
export const EYE_RESPONSE_MS = 180;
/** One late frame may cover part of the blend. It cannot finish it. */
export const EYE_FRAME_MS = 120;

export const EYE_CUES = [
  'IDLE',
  'CURIOUS',
  'LISTENING',
  'THINKING',
  'RESPONDING',
  'SPEAKING',
  'HAPPY',
  'SURPRISED',
  'ERROR',
  'SLEEPING',
] as const;

export type EyeCue = (typeof EYE_CUES)[number];

export const EYE_PREVIEW_CUES = [
  'CURIOUS',
  'SURPRISED',
  'SLEEPING',
  'BLINK',
  'WAKING',
  'PROBE_LEFT',
  'PROBE_RIGHT',
  'PROBE_ANTENNA',
  'PROBE_BODY',
  'PROBE_RESET',
  'CLEAR',
] as const;

export type EyePreviewCue = (typeof EYE_PREVIEW_CUES)[number];

export interface EyeShape {
  openness: number;
  curvature: number;
  lift: number;
  tilt: number;
  gazeYaw: number;
  gazePitch: number;
  glow: number;
}

export interface EyePair {
  left: EyeShape;
  right: EyeShape;
}

const REST: EyeShape = {
  openness: 1,
  curvature: 1,
  lift: 0,
  tilt: 0,
  gazeYaw: 0,
  gazePitch: 0,
  glow: 1,
};

export function isEyePreviewCue(value: string): value is EyePreviewCue {
  return (EYE_PREVIEW_CUES as readonly string[]).includes(value);
}

export function restEyes(): EyePair {
  return { left: { ...REST }, right: { ...REST } };
}

/** How shut the shared blink is. 0 is open, 1 is the closed line. */
export function shownOpenness(openness: number, blink: number): number {
  const open = finite(openness, 1);
  const shut = clamp(finite(blink, 0), 0, 1);
  return Math.max(EYE_CLOSED, open * (1 - shut));
}

export function eyeCueFromState(input: {
  presence: PresenceName | null;
  phase: Phase;
  tracking: boolean;
  preview: EyeCue | null;
}): EyeCue {
  if (input.phase === 'SLEEPING' || input.phase === 'RETURNING_TO_SLEEP') {
    return 'SLEEPING';
  }
  if (input.preview) {
    return input.preview;
  }
  if (input.phase === 'WAKING') {
    return 'HAPPY';
  }
  if (input.presence === 'ATTENTIVE') {
    return 'LISTENING';
  }
  if (input.presence === 'THINKING') {
    return 'THINKING';
  }
  if (input.presence === 'RESPONDING') {
    return 'RESPONDING';
  }
  if (input.presence === 'SPEAKING') {
    return 'SPEAKING';
  }
  if (input.presence === 'HAPPY') {
    return 'HAPPY';
  }
  if (input.presence === 'ERROR') {
    return 'ERROR';
  }
  if (input.tracking && (input.presence === null || input.presence === 'IDLE')) {
    return 'CURIOUS';
  }
  return 'IDLE';
}

export function eyeTarget(cue: EyeCue, now: number, reducedMotion: boolean): EyePair {
  const out = restEyes();
  writeEyeTarget(cue, now, reducedMotion, out);
  return out;
}

export function writeEyeTarget(cue: EyeCue, now: number, reducedMotion: boolean, out: EyePair): void {
  const time = finite(now, 0);
  const still = reducedMotion === true;
  if (cue === 'SLEEPING') {
    assign(out, { openness: EYE_CLOSED, curvature: 1, glow: 0.4 }, { openness: EYE_CLOSED, curvature: 1, glow: 0.4 });
    return;
  }
  if (cue === 'CURIOUS') {
    assign(
      out,
      { openness: 1.1, curvature: 1, lift: 0.012, tilt: 0.06, gazePitch: -0.02, glow: 1.04 },
      { openness: 1.1, curvature: 1, lift: 0.012, tilt: -0.06, gazePitch: -0.02, glow: 1.04 },
    );
    return;
  }
  if (cue === 'LISTENING') {
    assign(
      out,
      { openness: 1.16, curvature: 0.98, lift: 0.02, gazePitch: -0.015, glow: 1.18 },
      { openness: 1.16, curvature: 0.98, lift: 0.02, gazePitch: -0.015, glow: 1.18 },
    );
    return;
  }
  if (cue === 'THINKING') {
    const drift = still ? 0 : Math.sin(time / 1400) * 0.035;
    assign(
      out,
      { openness: 0.86, curvature: 0.96, tilt: -0.1, gazeYaw: -0.055 + drift, gazePitch: -0.05, glow: 0.96 },
      { openness: 0.86, curvature: 0.96, tilt: 0.1, gazeYaw: 0.055 + drift, gazePitch: -0.05, glow: 0.96 },
    );
    return;
  }
  if (cue === 'RESPONDING') {
    const breath = still ? 0 : Math.sin(time / 1100) * 0.01;
    assign(
      out,
      { openness: 1.08, curvature: 1.08, lift: 0.01 + breath, tilt: 0.12, glow: 1.06 },
      { openness: 1.08, curvature: 1.08, lift: 0.01 + breath, tilt: -0.12, glow: 1.06 },
    );
    return;
  }
  if (cue === 'SPEAKING') {
    const bob = still ? 0 : Math.sin(time / 520) * 0.02;
    assign(
      out,
      { openness: 1.05 + bob, curvature: 1.04, lift: 0.008, tilt: 0.06, glow: 1.05 },
      { openness: 1.05 + bob, curvature: 1.04, lift: 0.008, tilt: -0.06, glow: 1.05 },
    );
    return;
  }
  if (cue === 'SURPRISED') {
    assign(
      out,
      { openness: 1.18, curvature: 1.04, lift: 0.018, tilt: 0.04, gazePitch: -0.05, glow: 1.12 },
      { openness: 1.18, curvature: 1.04, lift: 0.018, tilt: -0.04, gazePitch: -0.05, glow: 1.12 },
    );
    return;
  }
  if (cue === 'HAPPY') {
    assign(
      out,
      { openness: 1.08, curvature: 1.1, lift: 0.016, tilt: 0.2, glow: 1.1 },
      { openness: 1.08, curvature: 1.1, lift: 0.016, tilt: -0.2, glow: 1.1 },
    );
    return;
  }
  if (cue === 'ERROR') {
    assign(
      out,
      { openness: 0.9, curvature: 0.98, lift: 0, tilt: 0.1, gazePitch: 0.03, glow: 1 },
      { openness: 0.9, curvature: 0.98, lift: 0, tilt: -0.1, gazePitch: 0.03, glow: 1 },
    );
    return;
  }
  const glow = still ? 1 : 1 + Math.sin(time / 2800) * 0.025;
  assign(out, { glow }, { glow });
}

/** Wake opens toward the expression. Sleep stays on the closed line even if the body is still awake. */
export function opennessForAlertness(targetOpen: number, alertness: number, sleeping: boolean): number {
  if (sleeping) {
    return EYE_CLOSED;
  }
  const level = clamp(finite(alertness, 0), 0, 1);
  const open = clamp(finite(targetOpen, 1), EYE_CLOSED, 1.25);
  return EYE_CLOSED + (open - EYE_CLOSED) * level;
}

/** Folds a reused pair. A sleeping cue is forced shut so a preview cannot reopen it. */
export function applyAlertness(out: EyePair, alertness: number, sleeping: boolean): void {
  if (sleeping) {
    shut(out.left);
    shut(out.right);
    return;
  }
  out.left.openness = opennessForAlertness(out.left.openness, alertness, false);
  out.right.openness = opennessForAlertness(out.right.openness, alertness, false);
}

function shut(shape: EyeShape): void {
  shape.openness = EYE_CLOSED;
  shape.curvature = 1;
  shape.lift = 0;
  shape.tilt = 0;
  shape.gazeYaw = 0;
  shape.gazePitch = 0;
}

/** Weighted gap in expression space. Lift counts more because a few hundredths of a world unit is a visible pixel shift. */
export function silhouetteDistance(a: EyePair, b: EyePair): number {
  const weight: Record<keyof EyeShape, number> = {
    openness: 1,
    curvature: 0.9,
    lift: 10,
    tilt: 2.2,
    gazeYaw: 0.4,
    gazePitch: 0.4,
    glow: 0.15,
  };
  let sum = 0;
  for (const side of ['left', 'right'] as const) {
    for (const field of Object.keys(weight) as (keyof EyeShape)[]) {
      sum += Math.abs(a[side][field] - b[side][field]) * weight[field];
    }
  }
  return sum;
}

export interface RevealedEye {
  scaleX: number;
  scaleY: number;
  lift: number;
  tilt: number;
  gazeYaw: number;
  gazePitch: number;
}

/** A shut blink is a level line. Shape returns as the eye opens, without rewriting the target. */
export function revealEyeInto(out: RevealedEye, shape: EyeShape, blink: number): RevealedEye {
  const scaleY = shownOpenness(shape.openness, blink);
  const reveal = clamp((scaleY - EYE_CLOSED) / 0.28, 0, 1);
  out.scaleX = Math.max(0.35, 1 + (finite(shape.curvature, 1) - 1) * reveal);
  out.scaleY = scaleY;
  out.lift = finite(shape.lift, 0) * reveal;
  out.tilt = finite(shape.tilt, 0) * reveal;
  out.gazeYaw = finite(shape.gazeYaw, 0) * reveal;
  out.gazePitch = finite(shape.gazePitch, 0) * reveal;
  return out;
}

export function revealedEye(shape: EyeShape, blink: number): RevealedEye {
  return revealEyeInto({ scaleX: 1, scaleY: 1, lift: 0, tilt: 0, gazeYaw: 0, gazePitch: 0 }, shape, blink);
}

export function meanOpenness(eyes: EyePair): number {
  return (eyes.left.openness + eyes.right.openness) / 2;
}

/** Follows the target without overshoot. dt is clamped, so a long frame cannot jump past the blend. */
export function stepEyePair(current: EyePair, target: EyePair, dtMs: number): EyePair {
  const next = restEyes();
  stepEyePairInto(next, current, target, dtMs);
  return next;
}

export function stepEyePairInto(out: EyePair, current: EyePair, target: EyePair, dtMs: number): void {
  const dt = clamp(finite(dtMs, 0), 0, EYE_FRAME_MS);
  const blend = 1 - Math.exp(-dt / EYE_RESPONSE_MS);
  mixShape(out.left, current.left, target.left, blend);
  mixShape(out.right, current.right, target.right, blend);
}

function assign(out: EyePair, left: Partial<EyeShape>, right: Partial<EyeShape>): void {
  const next = {
    left: sanitize({ ...REST, ...left }),
    right: sanitize({ ...REST, ...right }),
  };
  copyShape(out.left, next.left);
  copyShape(out.right, next.right);
}

function copyShape(out: EyeShape, shape: EyeShape): void {
  out.openness = shape.openness;
  out.curvature = shape.curvature;
  out.lift = shape.lift;
  out.tilt = shape.tilt;
  out.gazeYaw = shape.gazeYaw;
  out.gazePitch = shape.gazePitch;
  out.glow = shape.glow;
}

function mixShape(out: EyeShape, current: EyeShape, target: EyeShape, blend: number): void {
  const from = sanitize(current);
  const to = sanitize(target);
  const step = clamp(finite(blend, 0), 0, 1);
  out.openness = approach(from.openness, to.openness, step);
  out.curvature = approach(from.curvature, to.curvature, step);
  out.lift = approach(from.lift, to.lift, step);
  out.tilt = approach(from.tilt, to.tilt, step);
  out.gazeYaw = approach(from.gazeYaw, to.gazeYaw, step);
  out.gazePitch = approach(from.gazePitch, to.gazePitch, step);
  out.glow = approach(from.glow, to.glow, step);
}

function approach(current: number, target: number, blend: number): number {
  const value = current + (target - current) * blend;
  return finite(value, target);
}

function sanitize(eye: EyeShape): EyeShape {
  return {
    openness: clamp(finite(eye.openness, 1), EYE_CLOSED, 1.25),
    curvature: clamp(finite(eye.curvature, 1), 0.9, 1.18),
    lift: clamp(finite(eye.lift, 0), -0.015, 0.04),
    tilt: clamp(finite(eye.tilt, 0), -0.22, 0.22),
    gazeYaw: clamp(finite(eye.gazeYaw, 0), -0.1, 0.1),
    gazePitch: clamp(finite(eye.gazePitch, 0), -0.1, 0.1),
    glow: clamp(finite(eye.glow, 1), 0.4, 1.2),
  };
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
