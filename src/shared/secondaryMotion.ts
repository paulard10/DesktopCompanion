/**
 * Body, face, antenna, and arm offsets.
 * Sampled from the clock. The robot module is the only place that writes meshes.
 * This file does not touch the window, the trail, or the eyes.
 */

export const BODY_BOB_MAX = 0.05;
/** Whole-character roll on the parent pivot. The face plate is not a joint. */
export const BODY_TILT_MAX = 0.08;
/** Whole-character pitch on the parent pivot. Never a Face display rotation. */
export const HEAD_TILT_MAX = 0.08;
export const ANTENNA_SWAY_MAX = 0.28;
/** Screen-plane arm raise. The 0.7 diagnostic was larger than a gesture should be. */
export const ARM_LIFT_MAX = 0.36;
export const BREATH_MAX = 0.012;

export const SECONDARY_RESPONSE_MS = 180;
export const SECONDARY_FRAME_MS = 120;

export const NOD_MS = 640;
export const BOUNCE_MS = 780;
export const CONCERN_MS = 860;
export const WAVE_MS = 720;
export const WAKE_PREVIEW_MS = 1_200;

export const SECONDARY_GESTURES = ['none', 'nod', 'bounce', 'concern', 'wave'] as const;

export type SecondaryGesture = (typeof SECONDARY_GESTURES)[number];

export interface SecondaryPose {
  bodyBob: number;
  bodyTilt: number;
  headTilt: number;
  antennaSway: number;
  leftArmLift: number;
  rightArmLift: number;
  breathingScale: number;
  /** 1 keeps the idle sway. 0 lets this pose be the motion. */
  ambientMix: number;
}

export interface SecondaryClock {
  cue: string;
  gesture: SecondaryGesture;
  startedAt: number;
}

const REST: SecondaryPose = {
  bodyBob: 0,
  bodyTilt: 0,
  headTilt: 0,
  antennaSway: 0,
  leftArmLift: 0,
  rightArmLift: 0,
  breathingScale: 0,
  ambientMix: 1,
};

export function restSecondary(): SecondaryPose {
  return { ...REST };
}

export function restClock(): SecondaryClock {
  return { cue: 'IDLE', gesture: 'none', startedAt: 0 };
}

/** Another cue replaces the previous gesture. Sleep drops it. The same cue does not restart it. */
export function noteSecondaryCue(clock: SecondaryClock, cue: string, now: number, sleeping: boolean): void {
  const at = finite(now, clock.startedAt);
  if (sleeping) {
    clock.gesture = 'none';
    return;
  }
  if (cue === clock.cue) {
    return;
  }
  clock.cue = cue;
  clock.startedAt = at;
  if (cue === 'HAPPY') {
    clock.gesture = 'bounce';
    return;
  }
  if (cue === 'RESPONDING') {
    clock.gesture = 'nod';
    return;
  }
  if (cue === 'ERROR') {
    clock.gesture = 'concern';
    return;
  }
  clock.gesture = 'none';
}

export function gestureDuration(gesture: SecondaryGesture): number {
  if (gesture === 'nod') {
    return NOD_MS;
  }
  if (gesture === 'bounce') {
    return BOUNCE_MS;
  }
  if (gesture === 'concern') {
    return CONCERN_MS;
  }
  if (gesture === 'wave') {
    return WAVE_MS;
  }
  return 0;
}

/** Writes the pose for this instant. One-shots are a single arch, then rest. */
export function secondarySampleInto(
  out: SecondaryPose,
  cue: string,
  now: number,
  gesture: SecondaryGesture,
  gestureAge: number,
  alertness: number,
  reducedMotion: boolean,
  wakeAge: number,
): void {
  copyPose(out, REST);
  if (reducedMotion === true) {
    return;
  }
  const time = finite(now, 0);
  const awake = clamp(finite(alertness, 0), 0, 1);
  if (awake <= 0 || cue === 'SLEEPING') {
    out.breathingScale = clamp(slowBreath(time, 5_600, 0.0035), 0, BREATH_MAX);
    out.ambientMix = 1;
    return;
  }
  hold(out, cue, time);
  const age = finite(gestureAge, -1);
  const duration = gestureDuration(gesture);
  const envelope = duration > 0 && age >= 0 && age < duration ? Math.sin((age / duration) * Math.PI) : 0;
  if (envelope > 0) {
    out.ambientMix = 0;
  }
  if (gesture === 'bounce') {
    out.bodyBob = 0.045 * envelope;
    out.leftArmLift = 0.34 * envelope;
    out.rightArmLift = 0.34 * envelope;
  } else if (gesture === 'nod') {
    out.headTilt = 0.08 * envelope;
    out.leftArmLift = 0.22 * envelope;
    out.rightArmLift = 0.22 * envelope;
  } else if (gesture === 'concern') {
    out.bodyTilt = 0.08 * envelope;
    out.leftArmLift = 0.3 * envelope;
    out.rightArmLift = 0.14 * envelope;
    out.antennaSway = -0.16 * envelope;
  } else if (gesture === 'wave') {
    out.leftArmLift = 0.32 * envelope;
    out.rightArmLift = 0.08 * envelope;
    out.antennaSway = 0.1 * envelope;
  }
  if (wakeAge >= 0 && wakeAge < WAKE_PREVIEW_MS) {
    const slumped = 1 - smooth(wakeAge / WAKE_PREVIEW_MS);
    out.antennaSway -= 0.05 * slumped;
    out.leftArmLift -= 0.04 * slumped;
    out.rightArmLift -= 0.04 * slumped;
  }
  scaleAwake(out, awake);
  clampPose(out);
}

export function stepSecondaryInto(out: SecondaryPose, current: SecondaryPose, target: SecondaryPose, dtMs: number): void {
  const dt = clamp(finite(dtMs, 0), 0, SECONDARY_FRAME_MS);
  const blend = 1 - Math.exp(-dt / SECONDARY_RESPONSE_MS);
  out.bodyBob = mix(current.bodyBob, target.bodyBob, blend);
  out.bodyTilt = mix(current.bodyTilt, target.bodyTilt, blend);
  out.headTilt = mix(current.headTilt, target.headTilt, blend);
  out.antennaSway = mix(current.antennaSway, target.antennaSway, blend);
  out.leftArmLift = mix(current.leftArmLift, target.leftArmLift, blend);
  out.rightArmLift = mix(current.rightArmLift, target.rightArmLift, blend);
  out.breathingScale = mix(current.breathingScale, target.breathingScale, blend);
  out.ambientMix = clamp(mix(current.ambientMix, target.ambientMix, blend), 0, 1);
  clampPose(out);
}

/** Stable name for the pose at this instant. Used by logs and tests. */
export function secondaryPoseId(
  cue: string,
  gesture: SecondaryGesture,
  gestureAge: number,
  sleeping: boolean,
  wakeAge = -1,
): string {
  if (sleeping || cue === 'SLEEPING') {
    return 'sleep';
  }
  const age = finite(gestureAge, -1);
  const duration = gestureDuration(gesture);
  if (duration > 0 && age >= 0 && age < duration) {
    return gesture;
  }
  if (wakeAge >= 0 && wakeAge < WAKE_PREVIEW_MS) {
    return 'waking';
  }
  if (cue === 'CURIOUS' || cue === 'LISTENING' || cue === 'THINKING' || cue === 'SPEAKING') {
    return cue.toLowerCase();
  }
  return 'idle';
}

function hold(out: SecondaryPose, cue: string, now: number): void {
  const breath = slowBreath(now, 4_200, 0.008);
  out.breathingScale = breath;
  out.ambientMix = 1;
  if (cue === 'IDLE') {
    const sway = Math.sin(now / 1600) * 0.045;
    out.leftArmLift = sway;
    out.rightArmLift = -sway * 0.65;
    return;
  }
  if (cue === 'CURIOUS') {
    out.bodyTilt = 0.045;
    out.antennaSway = 0.08 + Math.sin(now / 1100) * 0.04;
    out.leftArmLift = 0.05;
    out.rightArmLift = 0.05;
    out.ambientMix = 1;
    return;
  }
  if (cue === 'LISTENING') {
    out.antennaSway = 0.24 + Math.sin(now / 900) * 0.03;
    out.leftArmLift = 0.28;
    out.rightArmLift = 0.28;
    out.ambientMix = 0;
    return;
  }
  if (cue === 'THINKING') {
    out.bodyTilt = -0.07;
    out.antennaSway = -0.2;
    out.breathingScale = breath * 0.6;
    out.ambientMix = 0;
    return;
  }
  if (cue === 'SURPRISED') {
    out.antennaSway = -0.08;
    out.leftArmLift = 0.12;
    out.rightArmLift = 0.12;
    out.ambientMix = 0;
    return;
  }
  if (cue === 'SPEAKING') {
    const beat = Math.sin(now / 420);
    out.antennaSway = 0.2 + beat * 0.04;
    out.leftArmLift = 0.05 + Math.abs(beat) * 0.04;
    out.rightArmLift = out.leftArmLift;
    out.breathingScale = slowBreath(now, 2_400, 0.004);
    out.ambientMix = 0;
  }
}

function slowBreath(now: number, periodMs: number, amplitude: number): number {
  const wave = Math.sin((finite(now, 0) / periodMs) * Math.PI * 2);
  return amplitude * (0.5 + 0.5 * wave);
}

function scaleAwake(pose: SecondaryPose, awake: number): void {
  pose.bodyBob *= awake;
  pose.bodyTilt *= awake;
  pose.headTilt *= awake;
  pose.antennaSway *= awake;
  pose.leftArmLift *= awake;
  pose.rightArmLift *= awake;
  pose.breathingScale *= awake;
}

function clampPose(pose: SecondaryPose): void {
  pose.bodyBob = clamp(finite(pose.bodyBob, 0), -BODY_BOB_MAX, BODY_BOB_MAX);
  pose.bodyTilt = clamp(finite(pose.bodyTilt, 0), -BODY_TILT_MAX, BODY_TILT_MAX);
  pose.headTilt = clamp(finite(pose.headTilt, 0), -HEAD_TILT_MAX, HEAD_TILT_MAX);
  pose.antennaSway = clamp(finite(pose.antennaSway, 0), -ANTENNA_SWAY_MAX, ANTENNA_SWAY_MAX);
  pose.leftArmLift = clamp(finite(pose.leftArmLift, 0), -ARM_LIFT_MAX, ARM_LIFT_MAX);
  pose.rightArmLift = clamp(finite(pose.rightArmLift, 0), -ARM_LIFT_MAX, ARM_LIFT_MAX);
  pose.breathingScale = clamp(finite(pose.breathingScale, 0), 0, BREATH_MAX);
  pose.ambientMix = clamp(finite(pose.ambientMix, 1), 0, 1);
}

function copyPose(out: SecondaryPose, pose: SecondaryPose): void {
  out.bodyBob = pose.bodyBob;
  out.bodyTilt = pose.bodyTilt;
  out.headTilt = pose.headTilt;
  out.antennaSway = pose.antennaSway;
  out.leftArmLift = pose.leftArmLift;
  out.rightArmLift = pose.rightArmLift;
  out.breathingScale = pose.breathingScale;
  out.ambientMix = pose.ambientMix;
}

function mix(current: number, target: number, blend: number): number {
  return finite(current, 0) + (finite(target, 0) - finite(current, 0)) * blend;
}

function smooth(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
