/**
 * Occasional idle acts chosen from the animation clock.
 * No timer, no wake, and no work while the caller says the robot is busy.
 */

import type { EyePair } from './faceExpression.js';

export const IDLE_ACTS = ['rest', 'glance', 'lookup', 'wave', 'happy', 'stretch', 'antenna', 'tilt', 'surprise', 'turn'] as const;
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
  if (act === 'happy' || act === 'stretch') {
    pair.left.openness = 1.08;
    pair.right.openness = 1.08;
    pair.left.tilt = 0.16;
    pair.right.tilt = -0.16;
    pair.left.glow = 1.08;
    pair.right.glow = 1.08;
    return;
  }
  if (act === 'surprise') {
    pair.left.openness = 1.22;
    pair.right.openness = 1.22;
    pair.left.glow = 1.16;
    pair.right.glow = 1.16;
    return;
  }
  if (act === 'turn') {
    pair.left.gazeYaw = 0.14;
    pair.right.gazeYaw = 0.14;
    return;
  }
  if (act === 'tilt') {
    pair.left.tilt = 0.14;
    pair.right.tilt = -0.14;
    pair.left.gazePitch = -0.05;
    pair.right.gazePitch = -0.05;
  }
}

function actForSlot(slot: number): IdleAct {
  const mixed = Math.abs(Math.imul(slot + 1, 1103515245) + 12345) % 14;
  if (mixed <= 3) return 'rest';
  if (mixed === 4) return 'glance';
  if (mixed === 5) return 'lookup';
  if (mixed === 6) return 'wave';
  if (mixed === 7) return 'happy';
  if (mixed === 8) return 'stretch';
  if (mixed === 9) return 'antenna';
  if (mixed === 10) return 'tilt';
  if (mixed === 11) return 'surprise';
  if (mixed === 12) return 'turn';
  return 'rest';
}
