/** Synthetic-only replay of the real planner and the overlay's timer/rounding contract.
 * No Electron, device access, real cursor samples or wall-clock performance claims.
 * Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/follow-trajectories.mts
 */
import { pathToFileURL } from 'node:url';
import * as current from '../src/shared/cursorFollow.ts';
import * as baseline from './fixtures/cursorFollow.m3.2a.mts';
import type { FollowPoint, FollowState, FollowView } from '../src/shared/cursorFollow.ts';

export type FollowEngine = Pick<typeof current,
  'enableFollow' | 'observeFollowCursor' | 'planFollow' | 'stepFollow'>;
export interface Trajectory {
  name: string;
  durationMs: number;
  cursor: (at: number) => FollowPoint;
}
const origin = { x: 292, y: 388, width: 216, height: 224 };
const area = { x: 0, y: 0, width: 1920, height: 1040 };
const restingCursor = { x: 591.5892027097068, y: 500 };
const jump = (distance: number): Trajectory => ({
  name: `jump-${distance}`, durationMs: 16000,
  cursor: at => ({ x: restingCursor.x + (at >= 1000 ? distance : 0), y: 500 }),
});
export const trajectories: readonly Trajectory[] = [
  { name: 'stationary', durationMs: 16000, cursor: () => restingCursor },
  jump(20), jump(200), jump(500), jump(1000),
  { name: 'rapid-turns', durationMs: 12000, cursor: at => ({
    x: restingCursor.x + (at < 1000 ? 0 : 500),
    y: at < 1000 ? 500 : 500 + (Math.floor((at - 1000) / 800) % 2 ? -180 : 180),
  }) },
  { name: 'continuous-60', durationMs: 12000,
    cursor: at => ({ x: restingCursor.x + at * 0.06, y: 500 }) },
  { name: 'travel-then-idle', durationMs: 16000,
    cursor: at => ({ x: restingCursor.x + Math.min(at, 8000) * 0.09, y: 500 }) },
  { name: 'display-edges', durationMs: 12000, cursor: at => {
    if (at < 1000) return restingCursor;
    return [{ x: 1800, y: 80 }, { x: 1800, y: 960 },
      { x: 120, y: 960 }, { x: 120, y: 80 }][Math.min(3, Math.floor((at - 1000) / 2500))]!;
  } },
  { name: 'invalid-cursor', durationMs: 6000, cursor: at => at >= 2000
    ? { x: NaN, y: 500 } : { x: restingCursor.x + (at >= 1000 ? 500 : 0), y: 500 } },
];

export interface ReplayOptions {
  offsetX?: number;
  view?: (at: number) => Partial<FollowView>;
  onStep?: (previous: FollowState, next: FollowState, at: number, view: FollowView) => void;
}
export function replay(engine: FollowEngine, trajectory: Trajectory, options: ReplayOptions = {}) {
  const offsetX = options.offsetX ?? 0;
  let live = { ...origin, x: origin.x + offsetX };
  let state = engine.enableFollow(live, 'one', 0);
  let movementDue: number | null = null;
  let firstCommandMs: number | null = null, firstApproachMs: number | null = null;
  let maxSpeed = 0, maxAcceleration = 0, maxStep = 0, commands = 0, targetDecisions = 0;
  let stopsBeforeArrival = 0, reversals = 0, previousSign = 0;
  let finalTarget: FollowPoint | null = null;
  const commandsBySecond: number[] = [];
  const transitions: Array<{ at: number; phase: string; reason: string }> = [];
  const errors: Array<{ at: number; targetDip: number | null; trailingErrorDip: number | null }> = [];
  const reasons: Record<string, number> = {};
  let previousSignature = '';
  const snapshot = (at: number): FollowView => ({ window: live,
    workArea: { ...area, x: offsetX }, displayKey: 'one', visualRadiusDip: Math.hypot(108, 112),
    visible: true, awake: true, blocked: false, manual: false, recovery: false,
    reducedMotion: false, ...options.view?.(at) });
  const finish = (previous: FollowState, at: number) => {
    const point = trajectory.cursor(at);
    const spacing = Math.max(170, Math.hypot(108, 112) + 12 + 24);
    const behind = Number.isFinite(point.x) && Math.hypot(state.x + 108 - point.x - offsetX, state.y + 112 - point.y) > spacing + 32;
    if (previous.phase === 'moving' && state.phase !== 'moving' && finalTarget &&
        (Math.hypot(finalTarget.x - state.x, finalTarget.y - state.y) > 8 || behind)) stopsBeforeArrival++;
    if (state.phase === 'moving' && movementDue === null) movementDue = at + 32;
    else if (state.phase !== 'moving') movementDue = null;
  };
  for (let at = 0; at <= trajectory.durationMs; at += 16) {
    // Same ordering as the existing sampler followed by a due shared actuator tick.
    const point = trajectory.cursor(at);
    const cursor = { ...point, x: point.x + offsetX, at };
    const previous = state;
    state = engine.observeFollowCursor(state, cursor);
    state = engine.planFollow(state, snapshot(at), at);
    if (state.lastDecisionAt !== previous.lastDecisionAt) targetDecisions++;
    if (state.target) finalTarget = state.target;
    finish(previous, at);
    if (movementDue !== null && at >= movementDue) {
      movementDue += 32;
      const before = state;
      const view = snapshot(at);
      const planned = engine.planFollow(state, view, at);
      state = engine.stepFollow(planned, view, at);
      const speed = Math.hypot(state.vx, state.vy);
      maxSpeed = Math.max(maxSpeed, speed);
      const elapsed = (at - before.lastTickAt) / 1000;
      // Safety gates are deliberately immediate; ordinary integration must be bounded.
      if (state.phase !== 'held' && elapsed > 0) maxAcceleration = Math.max(maxAcceleration,
        Math.hypot(state.vx - before.vx, state.vy - before.vy) / elapsed);
      maxStep = Math.max(maxStep, Math.hypot(state.x - before.x, state.y - before.y));
      const sign = Math.abs(state.vx) > 5 ? Math.sign(state.vx) : 0;
      if (sign && previousSign && sign !== previousSign) reversals++;
      if (sign) previousSign = sign;
      if (state.phase === 'moving') {
        const x = Math.round(state.x), y = Math.round(state.y);
        if (live.x !== x || live.y !== y) {
          live = { ...live, x, y };
          commands++;
          commandsBySecond[Math.floor(at / 1000)] = (commandsBySecond[Math.floor(at / 1000)] ?? 0) + 1;
          firstCommandMs ??= at;
        }
      }
      options.onStep?.(before, state, at, view);
      finish(before, at);
    }
    const spacing = Math.max(170, Math.hypot(108, 112) + 12 + 24);
    const trailingError = Number.isFinite(cursor.x) ? Math.max(0,
      Math.hypot(state.x + 108 - cursor.x, state.y + 112 - cursor.y) - spacing) : null;
    const targetError = finalTarget ? Math.hypot(finalTarget.x - state.x, finalTarget.y - state.y) : null;
    // For jumps, only count approach after the deliberate change at 1 second.
    if (at >= 1000 && finalTarget && targetError! <= 8 && trailingError !== null && trailingError <= 8) firstApproachMs ??= at;
    if ([1008, 2000, 4000, 8000, 12000, 16000].includes(at)) errors.push({ at,
      targetDip: targetError === null ? null : round(targetError), trailingErrorDip: trailingError === null ? null : round(trailingError) });
    const signature = `${state.phase}:${state.reason}`;
    if (signature !== previousSignature) {
      transitions.push({ at, phase: state.phase, reason: state.reason });
      reasons[state.reason] = (reasons[state.reason] ?? 0) + 1;
      previousSignature = signature;
    }
  }
  return { name: trajectory.name, firstCommandMs, firstApproachMs,
    maxSpeed: round(maxSpeed), maxAcceleration: round(maxAcceleration), maxStepDip: round(maxStep),
    commands, maxCommandsPerSecond: Math.max(0, ...Array.from(commandsBySecond, value => value ?? 0)),
    targetDecisions, stopsBeforeArrival, reversals, finalPhase: state.phase,
    finalReason: state.reason, reasons, errors, transitions };
}
function round(value: number) { return Math.round(value * 1000) / 1000; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--candidates')) {
    const saved = { ...current.FOLLOW };
    try {
      for (const cap of [160, 240, 300, 360]) {
        // Test-process-only experiment, never a runtime/app tuning surface.
        Object.assign(current.FOLLOW, { maxSpeed: cap });
        console.log(JSON.stringify({ cap, results: trajectories.map(t => replay(current, t)) }));
      }
    } finally { Object.assign(current.FOLLOW, saved); }
  } else {
    console.log(JSON.stringify({ kind: 'synthetic DIP replay, not Windows performance',
      baseline: trajectories.map(t => replay(baseline, t)),
      current: trajectories.map(t => replay(current, t)),
    }, null, 2));
  }
}
