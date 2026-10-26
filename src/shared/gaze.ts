/** Desktop pointer projected into a small look range. The window does not move. */

export const GAZE_RANGE_DIP = 520;
export const EYE_YAW_MAX = 0.38;
export const EYE_PITCH_MAX = 0.2;
export const GAZE_RESPONSE_MS = 90;
/** Matches the behavior clock clamp. Kept local so this file imports nothing. */
export const MAX_GAZE_FRAME_MS = 100;

export interface Gaze {
  yaw: number;
  pitch: number;
}

export const REST_GAZE: Gaze = { yaw: 0, pitch: 0 };

export function gazeTarget(input: {
  cursorX: number;
  cursorY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
}): Gaze {
  const centerX = input.originX + input.width / 2;
  const centerY = input.originY + input.height / 2;
  const nx = clamp((input.cursorX - centerX) / GAZE_RANGE_DIP, -1, 1);
  const ny = clamp((input.cursorY - centerY) / GAZE_RANGE_DIP, -1, 1);
  return {
    yaw: nx * EYE_YAW_MAX,
    pitch: ny * EYE_PITCH_MAX,
  };
}

export function stepGaze(current: Gaze, target: Gaze, dtMs: number): Gaze {
  const dt = Math.min(Math.max(dtMs, 0), MAX_GAZE_FRAME_MS);
  const blend = 1 - Math.exp(-dt / GAZE_RESPONSE_MS);
  return {
    yaw: current.yaw + (target.yaw - current.yaw) * blend,
    pitch: current.pitch + (target.pitch - current.pitch) * blend,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
