import assert from 'node:assert/strict';
import test from 'node:test';
import { LIFE_REST_MS, LIFE_STILL_MS, createLifeState, interiorStep, planLife, roamDirection } from './life.ts';

test('life stays still until the pointer rests, then allows one hop', () => {
  const state = createLifeState(0);
  assert.equal(planLife(state, { enabled: true, stillForMs: LIFE_STILL_MS - 1, moving: false, blocked: false, now: LIFE_REST_MS }), false);
  assert.equal(planLife(state, { enabled: true, stillForMs: LIFE_STILL_MS, moving: false, blocked: false, now: LIFE_REST_MS }), true);
  assert.equal(planLife(state, { enabled: true, stillForMs: 20_000, moving: false, blocked: false, now: LIFE_REST_MS + 1 }), false);
});

test('life does not hop while disabled, moving, blocked, or asleep-equivalent', () => {
  for (const input of [
    { enabled: false, stillForMs: 20_000, moving: false, blocked: false },
    { enabled: true, stillForMs: 20_000, moving: true, blocked: false },
    { enabled: true, stillForMs: 20_000, moving: false, blocked: true },
  ]) {
    const state = createLifeState(0);
    assert.equal(planLife(state, { ...input, now: LIFE_REST_MS + 1 }), false);
  }
});

test('a still pointer gets a short path, and a corner does not hop into the edge', () => {
  const state = createLifeState(0);
  assert.equal(planLife(state, { enabled: true, stillForMs: LIFE_STILL_MS, moving: false, blocked: false, now: LIFE_REST_MS }), true);
  assert.equal(planLife(state, { enabled: true, stillForMs: 20_000, moving: false, blocked: false, now: LIFE_REST_MS + 1_400 }), true);
  const area = { x: 0, y: 0, width: 1600, height: 900 };
  const parked = { x: 1368, y: 660, width: 216, height: 224 };
  const cursor = { x: 180, y: 160 };
  assert.notEqual(roamDirection(parked, area, cursor, state.seed), 'right');
  const step = interiorStep(parked, area, 180);
  assert.ok(step);
  assert.ok(step.x < parked.x);
  assert.ok(step.y < parked.y);
});
