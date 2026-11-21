import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVITY_MOVE_DIP, ACTIVITY_NOTE_MS, QUIET_MS, decideBedtime, nextMotionAnchor, quietDelayMs } from './activity.ts';

test('quiet time is about two minutes and jitter is not activity', () => {
  assert.equal(QUIET_MS, 120_000);
  assert.ok(quietDelayMs() < QUIET_MS);
  assert.ok(quietDelayMs() > 100_000);
  const first = nextMotionAnchor(null, { x: 10, y: 10 }, 1_000);
  assert.equal(first.noted, false);
  const twitch = nextMotionAnchor(first.anchor, { x: 10 + ACTIVITY_MOVE_DIP - 1, y: 10 }, 2_000);
  assert.equal(twitch.noted, false);
  const moved = nextMotionAnchor(twitch.anchor, { x: twitch.anchor.x + ACTIVITY_MOVE_DIP, y: twitch.anchor.y }, 2_000);
  assert.equal(moved.noted, true);
  const again = nextMotionAnchor(moved.anchor, { x: moved.anchor.x + ACTIVITY_MOVE_DIP, y: moved.anchor.y }, 2_000 + ACTIVITY_NOTE_MS - 1);
  assert.equal(again.noted, false);
});

test('quiet time goes home only when Home can accept the robot', () => {
  assert.equal(decideBedtime({ busy: true, asleep: false, dock: 'undocked', homeAvailable: true }), 'hold');
  assert.equal(decideBedtime({ busy: false, asleep: true, dock: 'undocked', homeAvailable: true }), 'later');
  assert.equal(decideBedtime({ busy: false, asleep: false, dock: 'docked', homeAvailable: true }), 'sleep');
  assert.equal(decideBedtime({ busy: false, asleep: false, dock: 'busy', homeAvailable: true }), 'later');
  assert.equal(decideBedtime({ busy: false, asleep: false, dock: 'undocked', homeAvailable: true }), 'dock');
  assert.equal(decideBedtime({ busy: false, asleep: false, dock: 'undocked', homeAvailable: false }), 'sleep');
});
