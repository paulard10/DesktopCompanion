/**
 * Camera framing for the procedural robot.
 * The main-process click proxy is a 160 DIP circle. These numbers keep the
 * body sphere on that circle. The antenna and arms are allowed to extend
 * past it; they are not part of the click target.
 */

export const BODY_RADIUS_WORLD = 1;
export const CAMERA_FOV_DEGREES = 28;

export const ANTENNA_ROOT_Y = 0.9;
export const ANTENNA_STEM_LENGTH = 0.26;
export const ANTENNA_TIP_RADIUS = 0.15;

export const SHOULDER_X = 1.08;
export const SHOULDER_Y = -0.06;
export const UPPER_ARM_LENGTH = 0.34;
export const FOREARM_LENGTH = 0.28;
export const HAND_RADIUS = 0.11;

export const RIG_TOP_WORLD = ANTENNA_ROOT_Y + ANTENNA_STEM_LENGTH + ANTENNA_TIP_RADIUS;
export const RIG_BOTTOM_WORLD = SHOULDER_Y - UPPER_ARM_LENGTH - FOREARM_LENGTH - HAND_RADIUS;
export const RIG_SIDE_WORLD = SHOULDER_X + 0.35;

export function cameraDistanceForBody(input: {
  viewportHeightPx: number;
  bodyDiameterPx: number;
  fovDegrees: number;
  bodyRadiusWorld: number;
}): number {
  const fraction = input.bodyDiameterPx / input.viewportHeightPx;
  const visibleHeight = (input.bodyRadiusWorld * 2) / fraction;
  const halfFov = (input.fovDegrees * Math.PI) / 360;
  return visibleHeight / (2 * Math.tan(halfFov));
}

export function viewHalfExtents(
  distance: number,
  fovDegrees: number,
  aspect: number,
): { halfWidth: number; halfHeight: number } {
  const halfHeight = distance * Math.tan((fovDegrees * Math.PI) / 360);
  return { halfHeight, halfWidth: halfHeight * aspect };
}

/** True when hover, tilt, antenna, and arms stay inside the view. */
export function rigFitsFrame(
  viewportWidth: number,
  viewportHeight: number,
  bodyDiameterPx: number,
  motion: { hoverAmplitude: number; tiltRadians: number },
): boolean {
  const distance = cameraDistanceForBody({
    viewportHeightPx: viewportHeight,
    bodyDiameterPx,
    fovDegrees: CAMERA_FOV_DEGREES,
    bodyRadiusWorld: BODY_RADIUS_WORLD,
  });
  const aspect = viewportWidth / viewportHeight;
  const { halfWidth, halfHeight } = viewHalfExtents(distance, CAMERA_FOV_DEGREES, aspect);
  const top = RIG_TOP_WORLD + motion.hoverAmplitude;
  const bottom = RIG_BOTTOM_WORLD - motion.hoverAmplitude;
  const side = RIG_SIDE_WORLD + top * Math.sin(motion.tiltRadians);
  return top < halfHeight && -bottom < halfHeight && side < halfWidth;
}
