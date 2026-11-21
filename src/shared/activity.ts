/**
 * Meaningful activity for the quiet timer.
 * Cursor jitter and the robot's own animation never count.
 * This module does not read the screen or wake a sleeping robot.
 */

export const QUIET_MS = 120_000;
/** Start the trip home slightly early so the renderer cannot fall asleep first. */
export const BEDTIME_LEAD_MS = 3_000;
/** Keep the eyes open through one dock attempt. Matches the dock timeout plus a small margin. */
export const BEDTIME_LINGER_MS = 25_000;
/** Ignore pointer noise below this distance. */
export const ACTIVITY_MOVE_DIP = 12;
/** A continuing move refreshes the quiet timer at most once a second. */
export const ACTIVITY_NOTE_MS = 1_000;

export function quietDelayMs(): number {
  return QUIET_MS - BEDTIME_LEAD_MS;
}

export type QuietDock = 'undocked' | 'docked' | 'busy';

/**
 * What to do when the quiet timer fires.
 * A hidden Home or a dock that cannot start sleeps in place.
 * A dock already underway is left alone and tried again later.
 */
export function decideBedtime(input: {
  busy: boolean;
  asleep: boolean;
  dock: QuietDock;
  homeAvailable: boolean;
}): 'hold' | 'sleep' | 'dock' | 'later' {
  if (input.asleep) {
    return 'later';
  }
  if (input.busy) {
    return 'hold';
  }
  if (input.dock === 'docked') {
    return 'sleep';
  }
  if (input.dock === 'busy') {
    return 'later';
  }
  return input.homeAvailable ? 'dock' : 'sleep';
}

export interface MotionAnchor {
  x: number;
  y: number;
  notedAt: number;
}

/** The first sample only sets the anchor. A later move of at least ACTIVITY_MOVE_DIP can count. */
export function nextMotionAnchor(
  anchor: MotionAnchor | null,
  point: { x: number; y: number },
  now: number,
): { anchor: MotionAnchor; noted: boolean } {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(now)) {
    return anchor
      ? { anchor, noted: false }
      : { anchor: { x: 0, y: 0, notedAt: Number.NEGATIVE_INFINITY }, noted: false };
  }
  if (!anchor) {
    return { anchor: { x: point.x, y: point.y, notedAt: Number.NEGATIVE_INFINITY }, noted: false };
  }
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  if (dx * dx + dy * dy < ACTIVITY_MOVE_DIP * ACTIVITY_MOVE_DIP) {
    return { anchor, noted: false };
  }
  const noted = now - anchor.notedAt >= ACTIVITY_NOTE_MS;
  return {
    anchor: { x: point.x, y: point.y, notedAt: noted ? now : anchor.notedAt },
    noted,
  };
}
