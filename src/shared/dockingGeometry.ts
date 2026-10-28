import { COMPANION_LAYOUT } from './companionLayout.ts';
import { HOME, placeHome, type HomeRect } from './homeGeometry.ts';
import { BODY_RADIUS_WORLD, BODY_REST_SCALE, CAMERA_FOV_DEGREES, cameraDistanceForBody } from './robotFrame.ts';
import { SLEEP_NOD, SLEEP_ROLL } from './presentation.ts';

export const DOCK = { overlapDip: 3, toleranceDip: 1, settleMs: 400, timeoutMs: 20_000, departureDip: 120 } as const;
export interface DockGeometry { platform: HomeRect; target: HomeRect; departure: HomeRect; area: HomeRect }

/** Nominal sleeping body's projected bottom. Analytic ellipsoid tangent, not the hit circle.
 * Same camera, mesh rest scale and sleeping pivot rotations as the actual renderer.
 * Breathing/hover remain animated: this is a nominal anchor, not per-frame pixel precision.
 */
export function projectedBodyBottomDip(): number {
  const { height } = COMPANION_LAYOUT.windowDip;
  const halfFov = CAMERA_FOV_DEGREES * Math.PI / 360;
  const distance = cameraDistanceForBody({ viewportHeightPx: height,
    bodyDiameterPx: COMPANION_LAYOUT.cameraFramingDip.bodyDiameter,
    fovDegrees: CAMERA_FOV_DEGREES, bodyRadiusWorld: BODY_RADIUS_WORLD });
  const { x, y, z } = BODY_REST_SCALE;
  const cross = x * x * Math.sin(SLEEP_ROLL) ** 2 + y * y * Math.cos(SLEEP_ROLL) ** 2;
  const c = Math.cos(SLEEP_NOD), s = Math.sin(SLEEP_NOD);
  const yy = c * c * cross + s * s * z * z;
  const zz = s * s * cross + c * c * z * z;
  const yz = c * s * (cross - z * z);
  const denom = distance * distance - zz;
  const slope = (-yz + Math.sqrt(yz * yz + denom * yy)) / denom;
  return height / 2 + height / (2 * Math.tan(halfFov)) * slope;
}

function valid(rect: HomeRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0;
}
export function contains(area: HomeRect, rect: HomeRect): boolean {
  return valid(area) && valid(rect) && rect.x >= area.x && rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height;
}

/** Reserve the whole compact viewport. Do not clamp the avatar away from its support anchor. */
export function placeDockableHome(area: HomeRect | null): HomeRect | null {
  if (!area || !valid(area)) return null;
  const home = placeHome(area);
  if (!home) return null;
  const { width, height } = COMPANION_LAYOUT.windowDip;
  const dx = HOME.surface.cx - width / 2;
  const dy = HOME.surface.cy + DOCK.overlapDip - projectedBodyBottomDip();
  const minX = Math.ceil(Math.max(area.x, area.x - dx));
  const maxX = Math.floor(Math.min(area.x + area.width - HOME.width, area.x + area.width - width - dx));
  const minY = Math.ceil(Math.max(area.y, area.y - dy));
  const maxY = Math.floor(Math.min(area.y + area.height - HOME.height, area.y + area.height - height - dy));
  if (minX > maxX || minY > maxY) return null;
  return { ...home, x: Math.max(minX, Math.min(maxX, home.x)), y: Math.max(minY, Math.min(maxY, home.y)) };
}

export function dockingGeometry(platform: HomeRect | null, area: HomeRect | null): DockGeometry | null {
  if (!platform || !area || !contains(area, platform) || platform.width !== HOME.width || platform.height !== HOME.height) return null;
  const { width, height } = COMPANION_LAYOUT.windowDip;
  const target = { x: Math.round(platform.x + HOME.surface.cx - width / 2),
    y: Math.round(platform.y + HOME.surface.cy + DOCK.overlapDip - projectedBodyBottomDip()), width, height };
  if (!contains(area, target)) return null;
  // Move toward the available interior, preserving the original travel easing.
  const centerX = area.x + area.width / 2, centerY = area.y + area.height / 2;
  const departure = { ...target,
    x: Math.max(Math.ceil(area.x), Math.min(Math.floor(area.x + area.width - width), target.x + (target.x + width / 2 > centerX ? -DOCK.departureDip : DOCK.departureDip))),
    y: Math.max(Math.ceil(area.y), Math.min(Math.floor(area.y + area.height - height), target.y + (target.y + height / 2 > centerY ? -48 : 48))) };
  if (!contains(area, departure) || Math.hypot(departure.x - target.x, departure.y - target.y) < 24) return null;
  return { platform: { ...platform }, area: { ...area }, target, departure };
}

export function sameRect(a: HomeRect | null, b: HomeRect | null): boolean {
  return Boolean(a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}
export function arrived(live: HomeRect, target: HomeRect): boolean {
  return live.width === target.width && live.height === target.height &&
    Number.isFinite(live.x) && Number.isFinite(live.y) &&
    Math.abs(live.x - target.x) <= DOCK.toleranceDip && Math.abs(live.y - target.y) <= DOCK.toleranceDip;
}
