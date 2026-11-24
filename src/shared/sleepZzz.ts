/**
 * Three reused sleep marks. The caller owns the array.
 * Sleep frames are already sparse, so this only writes numbers.
 */

export const SLEEP_ZZZ_COUNT = 3;
export const SLEEP_ZZZ_LIFE_MS = 2_800;

export interface SleepMark {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  visible: boolean;
}

export function createSleepMarks(): SleepMark[] {
  return Array.from({ length: SLEEP_ZZZ_COUNT }, () => ({
    x: 0,
    y: 0,
    scale: 0,
    opacity: 0,
    visible: false,
  }));
}

export function writeSleepMarks(now: number, sleeping: boolean, reducedMotion: boolean, out: SleepMark[]): void {
  const time = Number.isFinite(now) ? now : 0;
  for (let index = 0; index < out.length; index += 1) {
    const mark = out[index];
    if (!mark) {
      continue;
    }
    if (!sleeping || reducedMotion) {
      mark.visible = false;
      mark.opacity = 0;
      continue;
    }
    const stagger = index * (SLEEP_ZZZ_LIFE_MS / SLEEP_ZZZ_COUNT);
    const age = positiveMod(time + stagger, SLEEP_ZZZ_LIFE_MS);
    const t = age / SLEEP_ZZZ_LIFE_MS;
    const boost = index === 1 ? 1.95 : index === 2 ? 1.7 : 1.55;
    mark.visible = true;
    mark.x = 0.16 + index * 0.2;
    mark.y = 1.28 + t * (0.78 + index * 0.08);
    mark.scale = (0.14 + t * 0.1) * boost;
    mark.opacity = Math.sin(t * Math.PI);
  }
}

function positiveMod(value: number, period: number): number {
  const mod = value % period;
  return mod < 0 ? mod + period : mod;
}
