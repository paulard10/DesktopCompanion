/**
 * House clicks choose one of three modes. Free roam never expires.
 * Only a completed stay on the platform can fall asleep, and only after one minute.
 */

export const HOUSE_DOUBLE_MS = 300;
export const HOUSE_REPEAT_MS = 40;
export const HOME_AWAKE_SLEEP_MS = 60_000;

export type CompanionMode = 'FREE_ROAM' | 'HOME_AWAKE' | 'HOME_SLEEPING';
export type HouseGesture = 'single' | 'double';
export type HouseAction = 'dock-awake' | 'leave' | 'wake-leave' | 'sleep' | 'stay-asleep';

export function houseAction(mode: CompanionMode, gesture: HouseGesture): HouseAction {
  if (gesture === 'double') {
    return mode === 'HOME_SLEEPING' ? 'stay-asleep' : 'sleep';
  }
  if (mode === 'FREE_ROAM') return 'dock-awake';
  if (mode === 'HOME_AWAKE') return 'leave';
  return 'wake-leave';
}

export function homeAwakeExpired(enteredAt: number, now: number): boolean {
  return Number.isFinite(enteredAt) && Number.isFinite(now) && now - enteredAt >= HOME_AWAKE_SLEEP_MS;
}

/** Short hover instruction. One sentence per mode, in the same voice as the other controls. */
export function houseTooltip(mode: CompanionMode): string {
  if (mode === 'HOME_SLEEPING') return 'Click: wake up';
  if (mode === 'HOME_AWAKE') return 'Click: explore · Double-click: sleep';
  return 'Click: return home · Double-click: sleep';
}
