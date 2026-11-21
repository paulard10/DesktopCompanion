import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BEDTIME_LINGER_MS, QUIET_MS } from './activity.ts';
import { ambientPose, HOVER_AMPLITUDE_WORLD } from './ambientMotion.ts';
import { ORB_DIAMETER_DIP } from './clickThrough.ts';
import { OVERLAY_HEIGHT_DIP, OVERLAY_WIDTH_DIP } from './placement.ts';
import {
  EXPLORE_HOLD_MS,
  INACTIVITY_MS,
  MAX_FRAME_MS,
  SLEEP_FRAME_MS,
  SLEEP_MS,
  TARGET_LOST_MS,
  WAKE_MS,
  alertness,
  initialBehavior,
  reduceBehavior,
  shouldRenderFrame,
  stepBehavior,
  wakeBounce,
  type BehaviorState,
} from './behavior.ts';
import { EYE_PITCH_MAX, EYE_YAW_MAX, GAZE_RANGE_DIP, MAX_GAZE_FRAME_MS, REST_GAZE, gazeTarget, stepGaze } from './gaze.ts';
import { SLEEP_ANTENNA_DROOP, SLEEP_GLOW, SLEEP_NOD, presentCharacter } from './presentation.ts';
import { rigFitsFrame } from './robotFrame.ts';
import { WANDER_EXPLORE_MS } from './wander.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the robot starts asleep', () => {
  const state = initialBehavior(0);
  assert.equal(state.phase, 'SLEEPING');
  assert.equal(state.sleepDeadline, null);
  assert.equal(state.exploreUntil, null);
  assert.equal(alertness(state, 0), 0);
});

test('an idle robot sleeps at the two minute quiet deadline', () => {
  assert.equal(INACTIVITY_MS, QUIET_MS);
  assert.equal(BEDTIME_LINGER_MS, 25_000);
  const idle = awakeAt(0);
  assert.equal(idle.exploreUntil, null);
  assert.equal(idle.sleepDeadline, INACTIVITY_MS);
  const before = stepBehavior(idle, INACTIVITY_MS - 1, false);
  assert.equal(before.phase, 'IDLE');
  const asleep = stepBehavior(before, INACTIVITY_MS, false);
  assert.equal(asleep.phase, 'RETURNING_TO_SLEEP');
});

test('an exploration hold defers idle sleep and does not renew itself', () => {
  assert.equal(EXPLORE_HOLD_MS, WANDER_EXPLORE_MS);
  const idle = awakeAt(0);
  const held = reduceBehavior(idle, { type: 'EXPLORE', until: idle.lastTick + WANDER_EXPLORE_MS }, idle.lastTick);
  assert.equal(held.phase, 'IDLE');
  assert.equal(held.exploreUntil, idle.lastTick + WANDER_EXPLORE_MS);
  assert.equal(held.sleepDeadline, idle.sleepDeadline);
  const pastDeadline = reduceBehavior(held, { type: 'TICK' }, idle.sleepDeadline ?? 0);
  assert.equal(pastDeadline.phase, 'IDLE');
  assert.equal(pastDeadline.exploreUntil, held.exploreUntil);
  const longer = reduceBehavior(pastDeadline, { type: 'EXPLORE', until: (held.exploreUntil ?? 0) + 60_000 }, (idle.sleepDeadline ?? 0) + 1);
  assert.equal(longer.exploreUntil, held.exploreUntil);
  const cursor = reduceBehavior(longer, { type: 'CURSOR', valid: true }, (idle.sleepDeadline ?? 0) + 2);
  assert.equal(cursor.phase, 'TRACKING');
  assert.equal(cursor.exploreUntil, held.exploreUntil);
  assert.equal(cursor.sleepDeadline, idle.sleepDeadline);
  const woke = reduceBehavior(cursor, { type: 'WAKE' }, (idle.sleepDeadline ?? 0) + 3);
  assert.equal(woke.exploreUntil, held.exploreUntil);
  const released = reduceBehavior(woke, { type: 'EXPLORE', until: null }, held.exploreUntil ?? 0);
  assert.equal(released.phase, 'RETURNING_TO_SLEEP');
  assert.equal(released.exploreUntil, null);
});

test('a later wake does not revive an idle deadline that already elapsed during the hold', () => {
  const idle = awakeAt(0);
  const held = reduceBehavior(idle, { type: 'EXPLORE', until: (idle.sleepDeadline ?? 0) + WANDER_EXPLORE_MS }, idle.lastTick);
  const due = reduceBehavior(held, { type: 'TICK' }, idle.sleepDeadline ?? 0);
  assert.equal(due.phase, 'IDLE');
  const clicked = reduceBehavior(due, { type: 'WAKE' }, (idle.sleepDeadline ?? 0) + 1_000);
  assert.equal(clicked.phase, 'IDLE');
  assert.equal(clicked.sleepDeadline, idle.sleepDeadline);
  assert.equal(clicked.exploreUntil, held.exploreUntil);
  const ended = reduceBehavior(clicked, { type: 'EXPLORE', until: null }, held.exploreUntil ?? 0);
  assert.equal(ended.phase, 'RETURNING_TO_SLEEP');
  assert.equal(ended.exploreUntil, null);
});

test('user sleep overrides an exploration hold and a sleeping robot is not woken by it', () => {
  const idle = awakeAt(1_000);
  const held = reduceBehavior(idle, { type: 'EXPLORE', until: 1_000 + WANDER_EXPLORE_MS }, idle.lastTick);
  const told = reduceBehavior(held, { type: 'USER_SLEEP' }, idle.lastTick + 1_000);
  assert.equal(told.phase, 'RETURNING_TO_SLEEP');
  assert.equal(told.exploreUntil, null);
  const asleep = initialBehavior(0);
  const ignored = reduceBehavior(asleep, { type: 'EXPLORE', until: WANDER_EXPLORE_MS }, 0);
  assert.equal(ignored.phase, 'SLEEPING');
  assert.equal(ignored.exploreUntil, null);
});

test('a hold longer than six minutes is cut, and a clock jump still ends it', () => {
  const idle = awakeAt(0);
  const held = reduceBehavior(idle, { type: 'EXPLORE', until: idle.lastTick + WANDER_EXPLORE_MS + 120_000 }, idle.lastTick);
  assert.equal(held.exploreUntil, idle.lastTick + EXPLORE_HOLD_MS);
  const jumped = reduceBehavior(held, { type: 'CLOCK_RESUME' }, held.exploreUntil ?? 0);
  assert.equal(jumped.phase, 'RETURNING_TO_SLEEP');
  assert.equal(jumped.exploreUntil, null);
});

test('a wake plays once and then rests idle', () => {
  const waking = reduceBehavior(initialBehavior(0), { type: 'WAKE' }, 1_000);
  assert.equal(waking.phase, 'WAKING');
  assert.equal(waking.since, 1_000);
  assert.equal(waking.sleepDeadline, 1_000 + INACTIVITY_MS);
  assert.equal(alertness(waking, 1_000), 0);

  const mid = alertness(waking, 1_000 + WAKE_MS / 2);
  assert.ok(mid > 1, 'the wake eases past rest and settles back');
  assert.ok(wakeBounce(waking, 1_000 + WAKE_MS / 2) > 0);

  const stillWaking = reduceBehavior(waking, { type: 'TICK' }, 1_000 + WAKE_MS - 1);
  assert.equal(stillWaking.phase, 'WAKING');

  const idle = reduceBehavior(waking, { type: 'TICK' }, 1_000 + WAKE_MS);
  assert.equal(idle.phase, 'IDLE');
  assert.equal(alertness(idle, 1_000 + WAKE_MS), 1);
  assert.equal(wakeBounce(idle, 1_000 + WAKE_MS), 0);

  const clickedAgain = reduceBehavior(idle, { type: 'WAKE' }, 2_000);
  assert.equal(clickedAgain.phase, 'IDLE');
  assert.equal(clickedAgain.since, idle.since);
  assert.equal(clickedAgain.sleepDeadline, 2_000 + INACTIVITY_MS);
});

test('a second wake during waking does not restart the animation', () => {
  const first = reduceBehavior(initialBehavior(0), { type: 'WAKE' }, 1_000);
  const second = reduceBehavior(first, { type: 'WAKE' }, 1_200);
  assert.equal(second.phase, 'WAKING');
  assert.equal(second.since, first.since);
  assert.equal(second.sleepDeadline, 1_200 + INACTIVITY_MS);

  const idle = reduceBehavior(second, { type: 'TICK' }, 1_000 + WAKE_MS);
  assert.equal(idle.phase, 'IDLE');
});

test('an awake robot tracks a cursor and a lost cursor returns to idle', () => {
  const idle = awakeAt(0);
  const tracking = reduceBehavior(idle, { type: 'CURSOR', valid: true }, 800);
  assert.equal(tracking.phase, 'TRACKING');
  assert.equal(tracking.sleepDeadline, idle.sleepDeadline);

  const lost = reduceBehavior(tracking, { type: 'CURSOR', valid: false }, 800);
  assert.equal(lost.phase, 'TRACKING');
  const stillLost = reduceBehavior(lost, { type: 'CURSOR', valid: false }, 800 + TARGET_LOST_MS - 1);
  assert.equal(stillLost.phase, 'TRACKING');
  const settled = reduceBehavior(lost, { type: 'CURSOR', valid: false }, 800 + TARGET_LOST_MS);
  assert.equal(settled.phase, 'IDLE');
  assert.equal(settled.sleepDeadline, idle.sleepDeadline);
});

test('cursor movement never wakes the robot or moves the sleep deadline', () => {
  const asleep = initialBehavior(0);
  const stillAsleep = stepBehavior(asleep, 40, true);
  assert.equal(stillAsleep.phase, 'SLEEPING');
  assert.equal(stillAsleep.sleepDeadline, null);

  const ignored = reduceBehavior(asleep, { type: 'CURSOR', valid: true }, 10);
  assert.equal(ignored.phase, 'SLEEPING');
  assert.equal(ignored.sleepDeadline, null);

  const idle = awakeAt(0);
  const tracking = reduceBehavior(idle, { type: 'CURSOR', valid: true }, 50_000);
  assert.equal(tracking.phase, 'TRACKING');
  assert.equal(tracking.sleepDeadline, INACTIVITY_MS);

  const returning = reduceBehavior(tracking, { type: 'TICK' }, INACTIVITY_MS);
  assert.equal(returning.phase, 'RETURNING_TO_SLEEP');
  assert.equal(returning.sleepDeadline, null);
});

test('inactivity returns the robot to sleep', () => {
  const idle = awakeAt(0);
  const before = reduceBehavior(idle, { type: 'TICK' }, INACTIVITY_MS - 1);
  assert.equal(before.phase, 'IDLE');

  const returning = reduceBehavior(idle, { type: 'TICK' }, INACTIVITY_MS);
  assert.equal(returning.phase, 'RETURNING_TO_SLEEP');
  assert.equal(alertness(returning, INACTIVITY_MS), 1);

  const midway = alertness(returning, INACTIVITY_MS + SLEEP_MS / 2);
  assert.ok(midway < 1 && midway > 0);

  const asleep = reduceBehavior(returning, { type: 'TICK' }, INACTIVITY_MS + SLEEP_MS);
  assert.equal(asleep.phase, 'SLEEPING');
  assert.equal(alertness(asleep, INACTIVITY_MS + SLEEP_MS), 0);
  assert.equal(asleep.sleepDeadline, null);
});

test('a wake during the return to sleep reverses from the current pose', () => {
  const returning = reduceBehavior(awakeAt(0), { type: 'TICK' }, INACTIVITY_MS);
  const at = INACTIVITY_MS + SLEEP_MS / 2;
  const level = alertness(returning, at);
  assert.ok(Math.abs(level - 0.5) < 0.02);

  const waking = reduceBehavior(returning, { type: 'WAKE' }, at);
  assert.equal(waking.phase, 'WAKING');
  assert.equal(waking.since, at);
  assert.ok(Math.abs(waking.blendFrom - level) < 1e-9);
  assert.equal(waking.sleepDeadline, at + INACTIVITY_MS);

  const continued = reduceBehavior(waking, { type: 'CURSOR', valid: true }, at + 16);
  assert.equal(continued.phase, 'WAKING');
  assert.equal(continued.since, at);
});

test('tray wake and sleep are the intentional events', () => {
  const asleep = initialBehavior(5_000);
  const woken = reduceBehavior(asleep, { type: 'WAKE' }, 5_000);
  assert.equal(woken.phase, 'WAKING');

  const idle = reduceBehavior(woken, { type: 'TICK' }, 5_000 + WAKE_MS);
  const toldToSleep = reduceBehavior(idle, { type: 'USER_SLEEP' }, 6_000);
  assert.equal(toldToSleep.phase, 'RETURNING_TO_SLEEP');
  assert.equal(toldToSleep.blendFrom, 1);
  assert.equal(toldToSleep.sleepDeadline, null);

  const cursorAfterSleep = reduceBehavior(toldToSleep, { type: 'CURSOR', valid: true }, 6_016);
  assert.equal(cursorAfterSleep.phase, 'RETURNING_TO_SLEEP');
  assert.equal(cursorAfterSleep.sleepDeadline, null);

  const alreadyAsleep = reduceBehavior(initialBehavior(0), { type: 'USER_SLEEP' }, 20);
  assert.equal(alreadyAsleep.phase, 'SLEEPING');

  const again = reduceBehavior(toldToSleep, { type: 'USER_SLEEP' }, 6_100);
  assert.equal(again.phase, 'RETURNING_TO_SLEEP');
  assert.equal(again.since, toldToSleep.since);
});

test('a clock jump clamps the animation and still honors the sleep deadline', () => {
  const waking = reduceBehavior(initialBehavior(0), { type: 'WAKE' }, 0);
  const resumed = reduceBehavior(waking, { type: 'CLOCK_RESUME' }, 5_000);
  assert.equal(resumed.phase, 'WAKING');
  assert.equal(resumed.sleepDeadline, INACTIVITY_MS);
  assert.ok(5_000 - resumed.since <= MAX_FRAME_MS);
  assert.equal(alertness(resumed, 5_000) < 1, true);

  const idle = awakeAt(0);
  const afterGap = stepBehavior(idle, 130_000, true);
  assert.equal(afterGap.phase, 'RETURNING_TO_SLEEP');
  assert.equal(afterGap.since, 130_000);
  assert.equal(afterGap.sleepDeadline, null);

  const finished = reduceBehavior(afterGap, { type: 'TICK' }, 130_000 + SLEEP_MS);
  assert.equal(finished.phase, 'SLEEPING');

  const expiredWake = reduceBehavior(waking, { type: 'CLOCK_RESUME' }, 130_000);
  assert.equal(expiredWake.phase, 'RETURNING_TO_SLEEP');
  assert.ok(expiredWake.blendFrom > 0 && expiredWake.blendFrom < 1);
  assert.equal(expiredWake.since, 130_000);
});

test('sleep skips frames and every other phase renders', () => {
  assert.equal(shouldRenderFrame('SLEEPING', 100, 40), false);
  assert.equal(shouldRenderFrame('SLEEPING', 40 + SLEEP_FRAME_MS, 40), true);
  assert.equal(shouldRenderFrame('WAKING', 50, 40), true);
  assert.equal(shouldRenderFrame('IDLE', 50, 40), true);
  assert.equal(shouldRenderFrame('TRACKING', 50, 40), true);
  assert.equal(shouldRenderFrame('RETURNING_TO_SLEEP', 50, 40), true);
});

test('gaze stays bounded and eases across a long frame', () => {
  assert.equal(MAX_GAZE_FRAME_MS, MAX_FRAME_MS);
  const origin = { originX: 100, originY: 100, width: 300, height: 400 };
  const center = gazeTarget({ ...origin, cursorX: 250, cursorY: 300 });
  assert.deepEqual(center, REST_GAZE);

  const right = gazeTarget({ ...origin, cursorX: 250 + GAZE_RANGE_DIP, cursorY: 300 });
  assert.equal(right.yaw, EYE_YAW_MAX);
  const far = gazeTarget({ ...origin, cursorX: 250 + 4_000, cursorY: 300 - 4_000 });
  assert.equal(far.yaw, EYE_YAW_MAX);
  assert.equal(far.pitch, -EYE_PITCH_MAX);
  const below = gazeTarget({ ...origin, cursorX: 250, cursorY: 300 + GAZE_RANGE_DIP });
  assert.equal(below.pitch, EYE_PITCH_MAX);

  const eased = stepGaze(REST_GAZE, right, 5_000);
  assert.ok(eased.yaw > 0 && eased.yaw < EYE_YAW_MAX);
  assert.deepEqual(stepGaze(right, REST_GAZE, 0), right);
});

test('the sleep tilt still fits inside the overlay', () => {
  assert.equal(
    rigFitsFrame(OVERLAY_WIDTH_DIP, OVERLAY_HEIGHT_DIP, ORB_DIAMETER_DIP, {
      hoverAmplitude: HOVER_AMPLITUDE_WORLD,
      tiltRadians: SLEEP_NOD,
    }),
    true,
  );
});

test('sleep closes and dims the robot, and wake opens it again', () => {
  const ambient = ambientPose(1_000);
  const asleep = presentCharacter({
    ambient,
    alertness: 0,
    wakeBounce: 0,
    gazeYaw: 0.3,
    gazePitch: 0.1,
  });
  assert.equal(asleep.blink, 1);
  assert.equal(asleep.glow, SLEEP_GLOW);
  assert.equal(asleep.armRelax, 1);
  assert.equal(asleep.eyeYaw, 0);
  assert.equal(asleep.bodyYaw, 0);
  assert.equal(asleep.antenna, SLEEP_ANTENNA_DROOP);
  assert.ok(Math.abs(asleep.hover) <= HOVER_AMPLITUDE_WORLD * 0.2 + 1e-9);

  const awake = presentCharacter({
    ambient,
    alertness: 1,
    wakeBounce: 0,
    gazeYaw: 0.2,
    gazePitch: -0.1,
  });
  assert.equal(awake.glow, 1);
  assert.equal(awake.armRelax, 0);
  assert.equal(awake.blink, ambient.blink);
  assert.equal(awake.eyeYaw, 0.2);
  assert.ok(Math.abs(awake.bodyYaw) < Math.abs(awake.eyeYaw));
  assert.equal(awake.wakeScale, 1);

  const bouncing = presentCharacter({
    ambient,
    alertness: 1.08,
    wakeBounce: 0.08,
    gazeYaw: 0,
    gazePitch: 0,
  });
  assert.equal(bouncing.glow, 1);
  assert.ok(bouncing.wakeScale > 1 && bouncing.wakeScale < 1.05);
});

test('the tray keeps show, hide, quit, and recovery, and adds wake and sleep', () => {
  const tray = readFileSync(path.join(here, '../main/tray.ts'), 'utf8');
  const main = readFileSync(path.join(here, '../main/main.ts'), 'utf8');
  const overlay = readFileSync(path.join(here, '../main/overlayWindow.ts'), 'utf8');
  const preload = readFileSync(path.join(here, '../preload/preload.ts'), 'utf8');
  const renderer = readFileSync(path.join(here, '../renderer/main.ts'), 'utf8');
  for (const label of ['Show', 'Hide', 'Quit', 'Wake', 'Sleep', 'Recovery: capture whole window']) {
    assert.match(tray, new RegExp(`label: '${label}'`));
  }
  assert.match(main, /onWake:/);
  assert.match(main, /onSleep:/);
  assert.match(overlay, /setIgnoreMouseEvents\(true\)/);
  assert.match(overlay, /IpcChannels\.cursorSample/);
  assert.match(overlay, /IpcChannels\.behavior/);
  assert.equal(overlay.includes('setPosition'), false);
  assert.equal(preload.includes('setIgnoreMouseEvents'), false);
  assert.equal(preload.includes('ipcRenderer.invoke'), false);
  assert.equal(renderer.includes('setIgnoreMouseEvents'), false);
  assert.equal(renderer.includes('pointermove'), false);
  assert.match(renderer, /scene\.wake\(/);
});

test('cursor samples never wake or postpone sleep, and a real activity note does', () => {
  const asleep = initialBehavior(0);
  assert.equal(reduceBehavior(asleep, { type: 'ENGAGE' }, 1_000).phase, 'SLEEPING');
  const idle = awakeAt(0);
  const watched = reduceBehavior(idle, { type: 'CURSOR', valid: true }, 10_000);
  assert.equal(watched.sleepDeadline, idle.sleepDeadline);
  const engaged = reduceBehavior(watched, { type: 'ENGAGE' }, 10_000);
  assert.equal(engaged.phase, 'TRACKING');
  assert.equal(engaged.sleepDeadline, 10_000 + INACTIVITY_MS);
  const held = reduceBehavior(engaged, { type: 'HOLD' }, 20_000);
  assert.equal(stepBehavior(held, held.sleepDeadline ?? 0, true).phase, 'TRACKING');
  const released = reduceBehavior(held, { type: 'RELEASE' }, 30_000);
  assert.equal(released.activityHold, false);
  assert.equal(released.sleepDeadline, 30_000 + INACTIVITY_MS);
  const kept = reduceBehavior(awakeAt(0), { type: 'LINGER' }, 1_000);
  assert.equal(kept.sleepDeadline, INACTIVITY_MS);
  const lingering = reduceBehavior({ ...awakeAt(0), sleepDeadline: 5_000 }, { type: 'LINGER' }, 1_000);
  assert.equal(lingering.phase, 'IDLE');
  assert.equal(lingering.sleepDeadline, 1_000 + BEDTIME_LINGER_MS);
  assert.equal(reduceBehavior(initialBehavior(0), { type: 'LINGER' }, 1_000).phase, 'SLEEPING');
});

function awakeAt(now: number): BehaviorState {
  const waking = reduceBehavior(initialBehavior(now), { type: 'WAKE' }, now);
  return reduceBehavior(waking, { type: 'TICK' }, now + WAKE_MS);
}
