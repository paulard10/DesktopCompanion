import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as current from './cursorFollow.ts';
import * as baseline from '../../scripts/fixtures/cursorFollow.m3.2a.mts';
import { replay, trajectories } from '../../scripts/follow-trajectories.mts';
import type { FollowState, FollowView } from './cursorFollow.ts';

const scenario = (name: string) => trajectories.find(t => t.name === name)!;
const snapshot = (state: FollowState): FollowView => ({
  window: { x: state.x, y: state.y, width: 216, height: 224 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }, displayKey: 'one',
  visualRadiusDip: Math.hypot(108, 112), visible: true, awake: true,
  blocked: false, manual: false, recovery: false, reducedMotion: false,
});

test('baseline fixture is the exact pre-refinement planner, not a simplified approximation', () => {
  const bytes = readFileSync(new URL('../../scripts/fixtures/cursorFollow.m3.2a.mts', import.meta.url));
  // Normalize checkout line endings; the original Windows bytes had SHA256
  // B70A73417388B6AB34A9A2C8BB3477CC2C2E73CBA654622BFB25A61A385B5B6E.
  const normalized = bytes.toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(normalized).digest('hex'), 'b70a73417388b6ab34a9a2c8bb3477cc2c2e73cba654622bfb25a61a385b5b6e');
  assert.equal(baseline.FOLLOW.cruiseSpeed, 130);
  assert.equal(baseline.FOLLOW.maxSpeed, 160);
});

test('stationary and 20-DIP cursor changes retain calm hysteresis with zero movement commands', () => {
  for (const name of ['stationary', 'jump-20']) {
    const result = replay(current, scenario(name));
    assert.equal(result.commands, 0); assert.equal(result.maxSpeed, 0);
  }
});

for (const distance of [200, 500, 1000]) test(`${distance}-DIP jump finishes after the cursor stops instead of abandoning catch-up`, () => {
  const before = replay(baseline, scenario(`jump-${distance}`));
  const after = replay(current, scenario(`jump-${distance}`));
  assert.equal(before.firstApproachMs, null);
  assert.ok(before.stopsBeforeArrival > 0);
  assert.ok(after.firstApproachMs !== null && after.firstApproachMs < 7000);
  assert.equal(after.stopsBeforeArrival, 0);
  assert.ok(after.errors.at(-1)!.trailingErrorDip! <= 8);
  assert.equal(after.firstCommandMs, before.firstCommandMs, 'entry dwell is intentionally unchanged');
});

test('far targets use catch-up speed; near targets retain calm cruise and decelerate', () => {
  const long = replay(current, scenario('jump-1000'));
  const moderate = replay(current, scenario('jump-200'));
  assert.ok(long.maxSpeed > 290 && long.maxSpeed <= 300);
  assert.ok(moderate.maxSpeed < 180);
  let peak = 0, slowedBeforeArrival = false;
  replay(current, scenario('jump-500'), { onStep(previous, next) {
    peak = Math.max(peak, Math.hypot(next.vx, next.vy));
    const remaining = next.target ? Math.hypot(next.target.x - next.x, next.target.y - next.y) : 0;
    if (peak > 200 && remaining < 40 && Math.hypot(next.vx, next.vy) < 100) slowedBeforeArrival = true;
  } });
  assert.equal(slowedBeforeArrival, true);
});

test('all synthetic trajectories bound real integration velocity, acceleration, steps, workArea and actuator frequency', () => {
  for (const trajectory of trajectories) {
    const result = replay(current, trajectory, { onStep(previous, next, at, view) {
      const speed = Math.hypot(next.vx, next.vy);
      assert.ok(speed <= 300 + 1e-8, trajectory.name);
      if (next.phase !== 'held') {
        const dt = Math.min(at - previous.lastTickAt, 64) / 1000;
        assert.ok(Math.hypot(next.vx - previous.vx, next.vy - previous.vy) <= 320 * dt + 1e-8, trajectory.name);
        assert.ok(Math.hypot(next.x - previous.x, next.y - previous.y) <= 300 * dt + 1e-8, trajectory.name);
        assert.ok(next.x >= 0 && next.x + 216 <= 1920);
        assert.ok(next.y >= 0 && next.y + 224 <= 1040);
        assert.ok(current.segmentDistance(next.cursor!,
          { x: previous.x + 108, y: previous.y + 112 },
          { x: next.x + 108, y: next.y + 112 }) >= current.exclusionRadius(view.visualRadiusDip) + 2 - 1e-8);
      }
    } });
    assert.ok(result.maxCommandsPerSecond <= 32);
    assert.ok(result.targetDecisions <= 1 + Math.ceil(trajectory.durationMs / 200));
  }
});

test('continuous moderate movement avoids obsolete-target arrival/dwell cycles and mid-pursuit bout rests', () => {
  const before = replay(baseline, scenario('continuous-60'));
  const after = replay(current, scenario('continuous-60'));
  assert.ok(before.reasons.arrived! >= 4);
  assert.equal(after.reasons.arrived ?? 0, 0);
  assert.equal(after.reasons.dwell, 1);
  assert.equal(after.reasons.rest ?? 0, 0);
  assert.equal(after.finalPhase, 'moving');
  assert.ok(after.errors.at(-1)!.trailingErrorDip! < before.errors.at(-1)!.trailingErrorDip!);
});

test('after sustained travel and cursor stop, it settles stably and does not chase again', () => {
  const after = replay(current, scenario('travel-then-idle'));
  assert.equal(after.finalPhase, 'resting');
  assert.equal(after.reasons.arrived, 1);
  assert.ok(after.errors.at(-1)!.trailingErrorDip! < 32, 'arrival plus paced retarget slack is bounded');
  assert.deepEqual(after.errors.at(-1)!.targetDip, after.errors.at(-2)!.targetDip);
  assert.ok(after.transitions.filter(t => t.at > 10000).every(t => t.phase !== 'moving'));
});

test('quiet bout rest is interruptible only by renewed far motion after the minimum resume interval', () => {
  let state = current.enableFollow({ x: 292, y: 388, width: 216, height: 224 }, 'one', 0);
  state = { ...state, phase: 'resting', reason: 'arrived', wasAwake: true,
    resumeAt: 0, restUntil: 10000, lastMotionAt: 4000,
    cursor: { x: 1000, y: 500, at: 5000 }, anchor: { x: 1000, y: 500, at: 5000 } };
  for (const at of [5016, 5200, 5400]) {
    state = current.observeFollowCursor(state, { x: 1000 + (at - 5000) / 10, y: 500, at });
    state = current.planFollow(state, snapshot(state), at);
    assert.equal(state.restUntil, 10000);
    assert.equal(state.target, null);
  }
  state = current.observeFollowCursor(state, { x: 1080, y: 500, at: 5600 });
  state = current.planFollow(state, snapshot(state), 5600);
  assert.equal(state.restUntil, 0); assert.equal(state.reason, 'dwell');
  assert.equal(state.target, null, 'renewed motion still requires sustained entry');
});

test('negative display origins reproduce the same jump trajectory in DIP without scale conversion', () => {
  const ordinary = replay(current, scenario('jump-1000'));
  const negative = replay(current, scenario('jump-1000'), { offsetX: -1920 });
  assert.equal(negative.firstCommandMs, ordinary.firstCommandMs);
  assert.equal(negative.firstApproachMs, ordinary.firstApproachMs);
  assert.equal(negative.maxSpeed, ordinary.maxSpeed);
  assert.equal(negative.commands, ordinary.commands);
});

test('invalid samples and immediate chat/Sleep gates stop even during fast catch-up', () => {
  for (const gate of ['blocked', 'awake'] as const) {
    let sawHeld = false;
    const result = replay(current, scenario('jump-1000'), {
      view: at => at < 2500 ? {} : gate === 'blocked' ? { blocked: true } : { awake: false },
      onStep(_previous, next, at) {
        if (at >= 2500) { sawHeld = true; assert.equal(next.vx, 0); assert.equal(next.target, null); }
      },
    });
    // Observation gates may stop/remove the actuator before another integration step.
    assert.ok(sawHeld || result.transitions.some(t => t.at >= 2500 && t.phase === 'held'));
    assert.equal(result.finalPhase, 'held');
    assert.equal(result.finalReason, gate === 'blocked' ? 'interaction' : 'asleep');
  }
  const invalid = replay(current, scenario('invalid-cursor'));
  assert.equal(invalid.finalPhase, 'held');
  assert.ok(invalid.transitions.some(t => t.at === 2000 && t.phase === 'held'));
});

test('rapid reversing trajectories remain bounded without repeated entry dwell or nonfinite state', () => {
  const result = replay(current, scenario('rapid-turns'));
  assert.ok(Number.isFinite(result.maxSpeed));
  assert.ok(result.reasons.dwell! <= 2);
  assert.ok(result.maxAcceleration <= 320 + 1e-8);
});
