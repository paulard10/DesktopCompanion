import { COMPANION_LAYOUT } from './companionLayout.ts';

/**
 * A small chat button in the overlay's lower right, outside the central body
 * circle. It does not change that circle. The main process enables it only
 * while the robot is awake.
 */

export const CHAT_TRIGGER_RADIUS_DIP = COMPANION_LAYOUT.chatBadgeDip.radius;
export const CHAT_TRIGGER_CENTER_X = COMPANION_LAYOUT.chatBadgeDip.centerX;
export const CHAT_TRIGGER_CENTER_Y = COMPANION_LAYOUT.chatBadgeDip.centerY;

export function chatTriggerVisible(phase: string): boolean {
  return phase === 'WAKING' || phase === 'IDLE' || phase === 'TRACKING';
}

export function chatTriggerHit(localX: number, localY: number): boolean {
  if (!Number.isFinite(localX) || !Number.isFinite(localY)) {
    return false;
  }
  const dx = localX - CHAT_TRIGGER_CENTER_X;
  const dy = localY - CHAT_TRIGGER_CENTER_Y;
  return dx * dx + dy * dy <= CHAT_TRIGGER_RADIUS_DIP * CHAT_TRIGGER_RADIUS_DIP;
}

export function withChatTrigger<T extends { mode: 'passthrough' | 'interactive'; reason: string }>(
  decision: T,
  localX: number,
  localY: number,
  enabled: boolean,
): T {
  if (!enabled || decision.mode === 'interactive' || !chatTriggerHit(localX, localY)) {
    return decision;
  }
  return { ...decision, mode: 'interactive', reason: 'chat-trigger' };
}
