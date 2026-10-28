/** First-party Home artwork/input coordinates, all in desktop/window DIP. */
export const HOME = {
  width: 112, height: 88, inset: 16, staleMs: 250, clickGapMs: 180,
  platform: { cx: 56, cy: 48, rx: 51, ry: 18, depth: 12 },
  surface: { cx: 56, cy: 46, rx: 42, ry: 13 },
} as const;

export interface HomePoint { x: number; y: number }
export interface HomeRect extends HomePoint { width: number; height: number }
/** Main-only observation from the existing avatar cursor sampler. Never renderer input. */
export interface HomeCursorObservation {
  cursor: HomePoint;
  at: number;
  avatarOwnsPointer: boolean;
}

export function placeHome(area: HomeRect | null): HomeRect | null {
  if (!area || ![area.x, area.y, area.width, area.height, area.x + area.width, area.y + area.height].every(Number.isFinite) ||
      area.width < HOME.width || area.height < HOME.height) return null;
  const insetX = Math.min(HOME.inset, area.width - HOME.width);
  const insetY = Math.min(HOME.inset, area.height - HOME.height);
  const minX = Math.ceil(area.x), minY = Math.ceil(area.y);
  const maxX = Math.floor(area.x + area.width - HOME.width), maxY = Math.floor(area.y + area.height - HOME.height);
  if (minX > maxX || minY > maxY) return null;
  return { x: Math.max(minX, Math.min(maxX, Math.round(area.x + area.width - HOME.width - insetX))),
    y: Math.max(minY, Math.min(maxY, Math.round(area.y + area.height - HOME.height - insetY))),
    width: HOME.width, height: HOME.height };
}

export function homeHit(x: number, y: number): boolean {
  if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= HOME.width || y >= HOME.height) return false;
  const { cx, cy, rx, ry, depth } = HOME.platform;
  // An ellipse extruded down by depth: exactly the painted chassis silhouette.
  const nearestY = Math.max(cy, Math.min(cy + depth, y));
  return ((x - cx) / rx) ** 2 + ((y - nearestY) / ry) ** 2 <= 1;
}

/** Shared outline keeps the renderer's curved silhouette and main hit test aligned. */
export function homeOutlinePath(): string {
  const { cx, cy, rx, ry, depth } = HOME.platform;
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy} V ${cy + depth} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy + depth} Z`;
}

export function homeCaptures(sample: HomeCursorObservation | null, bounds: HomeRect,
  now: number, visible: boolean): boolean {
  return Boolean(visible && sample && !sample.avatarOwnsPointer &&
    [now, sample.at, sample.cursor.x, sample.cursor.y, bounds.x, bounds.y].every(Number.isFinite) &&
    bounds.width === HOME.width && bounds.height === HOME.height &&
    now >= sample.at && now - sample.at <= HOME.staleMs &&
    homeHit(sample.cursor.x - bounds.x, sample.cursor.y - bounds.y));
}
