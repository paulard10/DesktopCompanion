/**
 * Occasional idle acts chosen from the animation clock.
 * No timer, no wake, and no work while the caller says the robot is busy.
 */

import type { EyePair } from './faceExpression.js';

export const IDLE_ACTS = ['rest', 'glance', 'lookup', 'wave', 'happy'] as const;
export type IdleAct = (typeof IDLE_ACTS)[number];

const SLOT_MS = 6_400;
const ACT_MS = 1_100;

export interface IdleBeat {
  slot: number;
  act: IdleAct;
  age: number;
  active: boolean;
}

export function idleBeat(now: number): IdleBeat {
  const time = Number.isFinite(now) ? Math.max(0, now) : 0;
  const slot = Math.floor(time / SLOT_MS);
  const age = time - slot * SLOT_MS;
  const act = actForSlot(slot);
  const active = act !== 'rest' && age < ACT_MS;
  return { slot, act: active ? act : 'rest', age, active };
}

/** Both eyes move together. Size stays matched. */
export function applyIdleEyes(pair: EyePair, act: IdleAct): void {
  if (act === 'glance') {
    pair.left.gazeYaw = 0.07;
    pair.right.gazeYaw = 0.07;
    return;
  }
  if (act === 'lookup') {
    pair.left.gazePitch = -0.07;
    pair.right.gazePitch = -0.07;
    pair.left.openness = 1.12;
    pair.right.openness = 1.12;
    return;
  }
  if (act === 'happy') {
    pair.left.openness = 1.08;
    pair.right.openness = 1.08;
    pair.left.tilt = 0.16;
    pair.right.tilt = -0.16;
    pair.left.glow = 1.08;
    pair.right.glow = 1.08;
  }
}

function actForSlot(slot: number): IdleAct {
  const mixed = Math.abs(Math.imul(slot + 1, 1103515245) + 12345) % 8;
  if (mixed <= 2) return 'rest';
  if (mixed === 3) return 'glance';
  if (mixed === 4) return 'lookup';
  if (mixed === 5) return 'wave';
  if (mixed === 6) return 'happy';
  return 'rest';
}
