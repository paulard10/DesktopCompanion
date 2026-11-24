/**
 * Bounded idle life. One decision per call, no timers, no network.
 * A hop is allowed only after the pointer has been still, and never while
 * the robot is already moving, asleep, or the caller says the user is busy.
 */

export const LIFE_STILL_MS = 3_200;
export const LIFE_REST_MS = 16_000;
export const LIFE_PATH_GAP_MS = 1_400;

export interface LifeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LifeState {
  nextHopAt: number;
  seed: number;
  hopsLeft: number;
}

export function createLifeState(now = 0): LifeState {
  return { nextHopAt: now + LIFE_REST_MS, seed: 1, hopsLeft: 0 };
}

/** Returns whether this instant may start one short hop. Mutates the schedule in place. */
export function planLife(
  state: LifeState,
  input: { enabled: boolean; stillForMs: number; moving: boolean; blocked: boolean; now: number },
): boolean {
  const now = Number.isFinite(input.now) ? input.now : 0;
  if (!input.enabled || input.blocked || input.moving) {
    if (input.blocked || input.moving) {
      state.nextHopAt = Math.max(state.nextHopAt, now + LIFE_REST_MS);
    }
    return false;
  }
  if (input.stillForMs < LIFE_STILL_MS) {
    return false;
  }
  if (now < state.nextHopAt) {
    return false;
  }
  state.seed = Math.imul(state.seed | 0, 1664525) + 1013904223 || 1;
  if (state.hopsLeft <= 0) {
    state.hopsLeft = 2 + (Math.abs(state.seed) % 2);
  }
  state.hopsLeft -= 1;
  const extra = 4_000 + (Math.abs(state.seed) % 8_000);
  state.nextHopAt = state.hopsLeft > 0 ? now + LIFE_PATH_GAP_MS : now + LIFE_REST_MS + extra;
  return true;
}

const ROAM_DIRS = ['left', 'right', 'up', 'down'] as const;
export type RoamDirection = (typeof ROAM_DIRS)[number];

/** Pick a cardinal step that still has room. A corner must not keep shoving into the edge. */
export function roamDirection(
  window: LifeRect,
  area: LifeRect,
  cursor: { x: number; y: number },
  seed: number,
): RoamDirection {
  const cx = window.x + window.width / 2;
  const cy = window.y + window.height / 2;
  const room: Record<RoamDirection, number> = {
    left: cx - area.x,
    right: area.x + area.width - cx,
    up: cy - area.y,
    down: area.y + area.height - cy,
  };
  const start = Math.abs(seed | 0) % ROAM_DIRS.length;
  let best: RoamDirection = 'left';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < ROAM_DIRS.length; index += 1) {
    const dir = ROAM_DIRS[(start + index) % ROAM_DIRS.length] ?? 'left';
    const space = room[dir];
    const towardCursor = dir === 'left' ? cursor.x < cx
      : dir === 'right' ? cursor.x > cx
        : dir === 'up' ? cursor.y < cy
          : cursor.y > cy;
    const score = space - (towardCursor ? 48 : 0);
    if (space >= 96 && score > bestScore) {
      best = dir;
      bestScore = score;
    }
  }
  if (bestScore === Number.NEGATIVE_INFINITY) {
    for (const dir of ROAM_DIRS) {
      if (room[dir] > bestScore) {
        best = dir;
        bestScore = room[dir];
      }
    }
  }
  return best;
}

/** A point further inside the work area, used to leave the platform on purpose. */
export function interiorStep(window: LifeRect, area: LifeRect, distance: number): { x: number; y: number } | null {
  const values = [window.x, window.y, window.width, window.height, area.x, area.y, area.width, area.height, distance];
  if (!values.every(Number.isFinite) || window.width <= 0 || window.height <= 0 || distance <= 0) {
    return null;
  }
  const dx = area.x + area.width / 2 - (window.x + window.width / 2);
  const dy = area.y + area.height / 2 - (window.y + window.height / 2);
  const length = Math.hypot(dx, dy);
  if (length < 24) {
    return null;
  }
  const step = Math.min(distance, length);
  const maxX = area.x + area.width - window.width;
  const maxY = area.y + area.height - window.height;
  return {
    x: Math.round(Math.min(maxX, Math.max(area.x, window.x + (dx / length) * step))),
    y: Math.round(Math.min(maxY, Math.max(area.y, window.y + (dy / length) * step))),
  };
}
