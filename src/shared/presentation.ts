/** Sleep, wake, and gaze blended onto the awake idle motion. Imports nothing. */

export const SLEEP_GLOW = 0.18;
export const SLEEP_NOD = 0.18;
export const SLEEP_ROLL = 0.08;
export const SLEEP_ANTENNA_DROOP = 0.42;
export const BODY_YAW_SHARE = 0.22;
export const BODY_PITCH_SHARE = 0.28;

export interface AmbientSample {
  hover: number;
  tiltX: number;
  tiltZ: number;
  blink: number;
  antenna: number;
}

export interface CharacterPose extends AmbientSample {
  bodyYaw: number;
  glow: number;
  eyeYaw: number;
  eyePitch: number;
  armRelax: number;
  wakeScale: number;
  eyeScale: number;
}

/** Turns the awake idle motion plus alertness and gaze into one pose. */
export function presentCharacter(input: {
  ambient: AmbientSample;
  alertness: number;
  wakeBounce: number;
  gazeYaw: number;
  gazePitch: number;
}): CharacterPose {
  const awake = clamp01(input.alertness);
  const asleep = 1 - awake;
  return {
    hover: input.ambient.hover * (0.2 + 0.8 * awake),
    tiltX: input.ambient.tiltX * awake + SLEEP_NOD * asleep + input.gazePitch * BODY_PITCH_SHARE * awake,
    tiltZ: input.ambient.tiltZ * awake + SLEEP_ROLL * asleep,
    bodyYaw: input.gazeYaw * BODY_YAW_SHARE * awake,
    blink: Math.max(input.ambient.blink * (awake > 0.92 ? 1 : 0), asleep),
    antenna: input.ambient.antenna * awake + SLEEP_ANTENNA_DROOP * asleep,
    glow: SLEEP_GLOW + (1 - SLEEP_GLOW) * awake,
    eyeYaw: input.gazeYaw * awake,
    eyePitch: input.gazePitch * awake,
    armRelax: asleep,
    wakeScale: 1 + Math.max(0, input.wakeBounce) * 0.45,
    eyeScale: 1,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
