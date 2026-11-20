import { COMPANION_LAYOUT } from './companionLayout.ts';
import { chatTriggerHit, chatTriggerVisible } from './chatTrigger.ts';

/**
 * A small screen-question button in the overlay's lower left, opposite the
 * chat badge and outside the body circle. The body click stays wake/chat.
 * The main process accepts it only while the robot is awake.
 */

export const SCREEN_ASK_RADIUS_DIP = COMPANION_LAYOUT.chatBadgeDip.radius;
/** Invisible target. The painted circle stays at SCREEN_ASK_RADIUS_DIP. */
export const SCREEN_ASK_HIT_RADIUS_DIP = 30;
export const SCREEN_ASK_CENTER_X = COMPANION_LAYOUT.windowDip.width - COMPANION_LAYOUT.chatBadgeDip.centerX;
export const SCREEN_ASK_CENTER_Y = COMPANION_LAYOUT.chatBadgeDip.centerY;

export function screenAskVisible(phase: string): boolean {
  return chatTriggerVisible(phase);
}

export function screenAskHit(localX: number, localY: number): boolean {
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) return false;
  const dx = localX - SCREEN_ASK_CENTER_X;
  const dy = localY - SCREEN_ASK_CENTER_Y;
  return dx * dx + dy * dy <= SCREEN_ASK_HIT_RADIUS_DIP * SCREEN_ASK_HIT_RADIUS_DIP;
}

/** Click box. Larger than the painted circle and clipped to the window. */
export function screenAskHitBoundsDip(): { x: number; y: number; width: number; height: number } {
  const width = COMPANION_LAYOUT.windowDip.width;
  const height = COMPANION_LAYOUT.windowDip.height;
  const x = Math.max(0, SCREEN_ASK_CENTER_X - SCREEN_ASK_HIT_RADIUS_DIP);
  const y = Math.max(0, SCREEN_ASK_CENTER_Y - SCREEN_ASK_HIT_RADIUS_DIP);
  const right = Math.min(width, SCREEN_ASK_CENTER_X + SCREEN_ASK_HIT_RADIUS_DIP);
  const bottom = Math.min(height, SCREEN_ASK_CENTER_Y + SCREEN_ASK_HIT_RADIUS_DIP);
  return { x, y, width: right - x, height: bottom - y };
}

export function screenAskBoundsDip(): { x: number; y: number; width: number; height: number } {
  return {
    x: SCREEN_ASK_CENTER_X - SCREEN_ASK_RADIUS_DIP,
    y: SCREEN_ASK_CENTER_Y - SCREEN_ASK_RADIUS_DIP,
    width: SCREEN_ASK_RADIUS_DIP * 2,
    height: SCREEN_ASK_RADIUS_DIP * 2,
  };
}

export function withScreenAskTrigger<T extends { mode: 'passthrough' | 'interactive'; reason: string }>(
  decision: T,
  localX: number,
  localY: number,
  enabled: boolean,
): T {
  if (!enabled || decision.mode === 'interactive' || !screenAskHit(localX, localY) || chatTriggerHit(localX, localY)) {
    return decision;
  }
  return { ...decision, mode: 'interactive', reason: 'screen-ask' };
}
