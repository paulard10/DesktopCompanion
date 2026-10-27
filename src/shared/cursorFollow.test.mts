import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FOLLOW, enableFollow, exclusionRadius, followInputSuppressed, holdFollow, initialFollow,
  observeFollowCursor, planFollow, segmentDistance, stepFollow, type FollowState, type FollowView } from './cursorFollow.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rect = { x: 100, y: 200, width: 216, height: 224 };
const work = { x: 0, y: 0, width: 1920, height: 1040 };
const view = (state: FollowState, overrides: Partial<FollowView> = {}): FollowView => ({
  window: { ...rect, x: state.x, y: state.y }, workArea: work, displayKey: 'one',
  visualRadiusDip: Math.hypot(108, 112), visible: true, awake: true, blocked: false,
  recovery: false, reducedMotion: false, manual: false, ...overrides,
});
function entered(): FollowState {
  let state = enableFollow(rect, 'one', 0);
  for (let at = 0; at <= 1200; at += 16) {
    state = observeFollowCursor(state, { x: 1000 + at / 20, y: 500, at });
    state = planFollow(state, view(state), at);
    if (state.phase === 'moving') return state;
  }
  assert.fail('explicitly enabled, far moving cursor must start following');
}
function observed(state: FollowState, at: number, x = 1050, y = 500): FollowState {
  return observeFollowCursor(state, { x, y, at });
}

test('follow defaults off and observations cannot enable or move it', () => {
  const off = initialFollow();
  assert.equal(off.enabled, false);
  assert.equal(observeFollowCursor(off, { x: 1000, y: 500, at: 1000 }), off);
  assert.equal(planFollow(off, view(off), 1000), off);
  assert.equal(stepFollow(off, view(off), 1000), off);
});
test('enable waits for resume rest and sustained far cursor; it never changes window coordinates', () => {
  let state = enableFollow(rect, 'one', 0);
  state = observed(state, 0);
  for (const at of [0, 200, 400]) {
    state = planFollow(observed(state, at), view(state), at);
    assert.notEqual(state.phase, 'moving');
  }
  assert.equal(state.x, 100); assert.equal(state.y, 200);
  assert.equal(entered().enabled, true);
});
test('ideal target trails the cursor with enough space for the full compact footprint', () => {
  const state = entered(), snap = view(state);
  assert.ok(state.target && state.cursor);
  const spacing = Math.hypot(state.target.x + 108 - state.cursor.x, state.target.y + 112 - state.cursor.y);
  assert.ok(Math.abs(spacing - Math.max(170, exclusionRadius(snap.visualRadiusDip) + 24)) < 1e-8);
});
test('near distance dead zone does not issue a move', () => {
  let state = enableFollow(rect, 'one', 0);
  for (let at = 0; at < 1000; at += 32) {
    state = planFollow(observed(state, at, 408, 312), view(state), at);
    assert.notEqual(state.phase, 'moving');
  }
});
test('tiny jitter does not renew cursor motion or produce an idle chase', () => {
  let state = observed(enableFollow(rect, 'one', 0), 0, 1000, 500);
  for (let at = 2000; at <= 4000; at += 16) {
    state = observeFollowCursor(state, { x: 1000 + Math.sin(at) * 0.8, y: 500 + Math.cos(at) * 0.8, at });
    state = planFollow(state, view(state), at);
    assert.notEqual(state.phase, 'moving');
    assert.equal(state.lastMotionAt, 0);
  }
});
test('ordinary integration bounds speed, acceleration and per-step distance without teleportation', () => {
  let state = entered();
  for (let step = 1; step <= 160; step++) {
    const at = state.lastTickAt + 32;
    const previous = state;
    state = stepFollow(observed(state, at, 1300, 600), view(state), at);
    assert.ok(Math.hypot(state.vx, state.vy) <= FOLLOW.maxSpeed + 1e-8);
    assert.ok(Math.hypot(state.vx - previous.vx, state.vy - previous.vy) <= FOLLOW.acceleration * 0.032 + 1e-8);
    assert.ok(Math.hypot(state.x - previous.x, state.y - previous.y) <= FOLLOW.maxSpeed * 0.032 + 1e-8);
    if (state.phase !== 'moving') break;
  }
});
test('fixed target arrives stably and does not oscillate around the destination', () => {
  let state = entered();
  const goal = { ...state.target! };
  let at = state.lastTickAt;
  for (let index = 0; index < 500 && state.phase === 'moving'; index++) {
    at += 32;
    state = stepFollow(observed(state, at, 1400, 700), view(state), at);
  }
  assert.equal(state.phase, 'resting');
  assert.ok(Math.hypot(state.x - goal.x, state.y - goal.y) <= FOLLOW.arrivalDip);
  assert.equal(state.vx, 0); assert.equal(state.vy, 0);
  const parked = { x: state.x, y: state.y };
  state = stepFollow(state, view(state), at + 32);
  assert.deepEqual({ x: state.x, y: state.y }, parked);
});
test('last idle-braking step never snaps away a residual velocity above its acceleration budget', () => {
  let state = entered();
  const at = state.lastTickAt + 32;
  state = observed({ ...state, target: null, vx: FOLLOW.acceleration * 0.032 + 0.005, vy: 0 }, at, 1400, 700);
  const next = stepFollow(state, view(state), at);
  assert.ok(Math.abs(next.vx - state.vx) <= FOLLOW.acceleration * 0.032 + 1e-10);
  assert.ok(next.vx > 0 && next.phase === 'moving');
  const stopped = stepFollow(observed(next, at + 32, 1400, 700), view(next), at + 32);
  assert.equal(stopped.phase, 'resting'); assert.equal(stopped.vx, 0);
});
test('planner target interpolation is paced and filters small retarget changes', () => {
  const start = entered();
  const early = planFollow(observed(start, start.lastDecisionAt + 100, 1100, 520), view(start), start.lastDecisionAt + 100);
  assert.deepEqual(early.target, start.target);
  const later = planFollow(observed(early, start.lastDecisionAt + 200, 1150, 540), view(early), start.lastDecisionAt + 200);
  assert.ok(later.target && start.target);
  assert.ok(Math.hypot(later.target.x - start.target.x, later.target.y - start.target.y) < 150);
});
test('rapid cursor movement is safe and bounded, including a jump onto the avatar', () => {
  let state = entered();
  for (let index = 1; index <= 25; index++) {
    const at = state.lastTickAt + 32;
    const before = state;
    state = stepFollow(planFollow(observed(state, at, index % 2 ? 1700 : 1200, 700), view(state), at), view(state), at);
    assert.ok(Math.hypot(state.x - before.x, state.y - before.y) <= FOLLOW.maxSpeed * 0.032 + 1e-8);
  }
  const held = planFollow(observed(state, state.lastTickAt + 16, state.x + 108, state.y + 112), view(state), state.lastTickAt + 16);
  assert.equal(held.phase, 'held'); assert.equal(held.reason, 'cursor-near');
  assert.equal(held.vx, 0);
});
test('idle cursor completes its accepted safe target, then settles without a pending chase', () => {
  let state = entered();
  const cursor = { ...state.cursor! };
  let at = state.lastTickAt;
  for (let index = 1; index < 500; index++) {
    at += 32;
    state = observeFollowCursor(state, { ...cursor, at });
    state = stepFollow(planFollow(state, view(state), at), view(state), at);
    if (state.phase !== 'moving' && at - state.lastMotionAt >= FOLLOW.idleMs) break;
  }
  assert.notEqual(state.phase, 'moving'); assert.equal(state.target, null);
  assert.ok(Math.hypot(state.x + 108 - cursor.x, state.y + 112 - cursor.y) < 225);
  const parked = { x: state.x, y: state.y };
  for (let index = 0; index < 100; index++) {
    at += 32;
    state = stepFollow(planFollow(observeFollowCursor(state, { ...cursor, at }), view(state), at), view(state), at);
    assert.deepEqual({ x: state.x, y: state.y }, parked);
  }
});
for (const [name, override] of [
  ['Sleep', { awake: false }], ['chat or voice', { blocked: true }],
  ['hidden', { visible: false }], ['manual', { manual: true }],
  ['reduced motion', { reducedMotion: true }], ['recovery', { recovery: true }],
  ['other display', { displayKey: 'two' }], ['missing display', { workArea: null }],
  ['invalid display', { workArea: { ...work, width: Infinity } }],
] as const) test(`${name} stops follow and discards its target`, () => {
  const state = entered();
  const held = planFollow(state, view(state, override), state.lastTickAt);
  assert.equal(held.phase, 'held'); assert.equal(held.target, null);
  assert.equal(held.vx, 0); assert.equal(held.vy, 0);
});
test('pause recovery rests and uses a fresh cursor instead of a stale destination', () => {
  const start = entered();
  const paused = planFollow(start, view(start, { blocked: true }), 1200);
  const resumed = planFollow(observed(paused, 1300, 1500, 700), view(paused), 1300);
  assert.notEqual(resumed.phase, 'moving'); assert.equal(resumed.target, null);
  assert.equal(resumed.enabled, true);
});
test('stale, reversed or invalid samples and clock gaps fail closed', () => {
  const start = entered();
  for (const cursor of [{ x: NaN, y: 5, at: 2000 }, { x: 1000, y: Infinity, at: 2000 }, { x: 1000, y: 500, at: -1 }]) {
    assert.equal(observeFollowCursor(start, cursor).cursor, null);
  }
  assert.equal(stepFollow(start, view(start), start.cursor!.at + 251).phase, 'held');
  const fresh = observed(start, start.lastTickAt + 300);
  assert.equal(stepFollow(fresh, view(fresh), fresh.cursor!.at).reason, 'clock-gap');
});
test('negative workArea and edge targets remain inside one display', () => {
  let state = enableFollow({ ...rect, x: -1200, y: 300 }, 'one', 0);
  const negative = { x: -1920, y: 40, width: 1920, height: 1040 };
  for (let at = 0; at <= 1200; at += 16) {
    state = planFollow(observed(state, at, -1900 + at / 100, 600), view(state, { workArea: negative }), at);
    if (state.target) {
      assert.ok(state.target.x >= -1920 && state.target.x + 216 <= 0);
      assert.ok(state.target.y >= 40 && state.target.y + 224 <= 1080);
    }
  }
  assert.equal(state.phase, 'moving');
});
test('whole-segment exclusion rejects paths through the cursor, not merely unsafe endpoints', () => {
  assert.equal(segmentDistance({ x: 800, y: 500 }, { x: 500, y: 500 }, { x: 1100, y: 500 }), 0);
  let state = { ...enableFollow({ ...rect, x: 392, y: 388 }, 'one', 0), dirX: -1 };
  for (let at = 0; at <= 1200; at += 16) state = planFollow(observed(state, at, 800, 500), view(state), at);
  assert.ok(state.target);
  assert.ok(state.target.x + 108 < 800);
});
test('leaving the pinned workArea and lease expiry stop immediately; completed bouts rest at natural arrival', () => {
  const state = entered();
  assert.equal(planFollow(observed(state, 1200, 2000, 500), view(state), 1200).reason, 'cursor-display');
  assert.equal(planFollow(observed({ ...state, leaseUntil: 1200 }, 1200), view(state), 1200).reason, 'lease');
  const arriving = { ...observed(state, 1200, 1400, 700), target: { x: state.x + 1, y: state.y },
    boutUntil: 1200, lastMotionAt: 0, lastTickAt: 1168, vx: 0, vy: 0 };
  const rested = stepFollow(arriving, view(arriving), 1200);
  assert.equal(rested.target, null); assert.equal(rested.restUntil, 6200);
});
test('motion suppresses capture and stopped dwell is bounded; disabling releases it', () => {
  const moving = entered();
  assert.equal(followInputSuppressed(moving, 1200), true);
  const held = holdFollow(moving, 1200, 'chat');
  assert.equal(followInputSuppressed(held, 1499), true);
  assert.equal(followInputSuppressed(held, 1500), false);
  assert.equal(followInputSuppressed(initialFollow(), 1200), false);
});
test('planner has no imports, platforms, timers, services or device authority', () => {
  const source = readFileSync(path.join(root, 'src/shared/cursorFollow.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
  assert.doesNotMatch(source, /\b(?:import|require|BrowserWindow|setInterval|setTimeout|fetch)\b|(?<![\w.])(?:window|document|process)\s*\./);
});
