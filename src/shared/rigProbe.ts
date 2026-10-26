/**
 * Development actuator offsets.
 * Each value is an absolute addition to the saved rest pose.
 * The same age always returns the same offset, so frames cannot stack.
 */

export const RIG_PROBE_MS = 2_000;

/** Screen-plane lift. Rotation X on these arms points into the camera and does not read. */
export const ARM_PROBE_Z = 0.7;

/** Tip travel is about 14 DIP at the desktop framing. */
export const ANTENNA_PROBE_Z = 0.55;

/**
 * Whole-rig roll on the parent pivot. Face display stays at its neutral orientation.
 * 0.08 rad moves the crown of the 160 DIP body by about 6 DIP.
 */
export const BODY_PROBE_Z = 0.08;

export const RIG_PROBE_NAMES = ['left-arm', 'right-arm', 'antenna', 'body'] as const;

export type RigProbeName = (typeof RIG_PROBE_NAMES)[number];

export interface RigProbeOffset {
  leftArmZ: number;
  rightArmZ: number;
  antennaZ: number;
  bodyZ: number;
}

const live: RigProbeOffset = {
  leftArmZ: 0,
  rightArmZ: 0,
  antennaZ: 0,
  bodyZ: 0,
};

export function isRigProbeName(value: string): value is RigProbeName {
  return value === 'left-arm' || value === 'right-arm' || value === 'antenna' || value === 'body';
}

/** Null once the hold is over. The returned object is reused on the next call. */
export function rigProbeOffset(name: string, ageMs: number): RigProbeOffset | null {
  if (!isRigProbeName(name) || !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= RIG_PROBE_MS) {
    return null;
  }
  live.leftArmZ = name === 'left-arm' ? ARM_PROBE_Z : 0;
  live.rightArmZ = name === 'right-arm' ? -ARM_PROBE_Z : 0;
  live.antennaZ = name === 'antenna' ? ANTENNA_PROBE_Z : 0;
  live.bodyZ = name === 'body' ? BODY_PROBE_Z : 0;
  return live;
}
