import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTravel, nudgeTarget } from './desktopMovement.ts';
import {
  WANDER_EXPLORE_MS,
  WANDER_FIRST_MAX_MS,
  WANDER_FIRST_MIN_MS,
  WANDER_HOP_MAX_DIP,
  WANDER_HOP_MIN_DIP,
  WANDER_MAX_REST_MS,
  WANDER_MIN_HOP_DIP,
  WANDER_MIN_REST_MS,
  WANDER_QUIET_MS,
  createWanderState,
  disableWander,
  enableWander,
  endWanderSession,
  noteWanderInteraction,
  noteWanderWake,
  planWander,
  wanderDelayMs,
  wanderHop,
  wanderHopDip,
  yieldWander,
  type WanderSnapshot,
  type WanderState,
} from './wander.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('a yielded manual move is not cancelled by sleep or by an in-progress hop', () => {
  const enabled = { ...createWanderState(1), enabled: true, exploreUntil: 60_000, owned: true };
  const yielded = yieldWander(enabled);
  assert.equal(planWander(yielded, snap({ asleep: true, awake: false }), 1_000).command, null);
  assert.equal(planWander(yielded, snap({ travelPhase: 'moving' }), 1_000).command, null);
});

function snap(extra: Partial<WanderSnapshot> = {}): WanderSnapshot {
  return {
    awake: true,
    asleep: false,
    tracking: false,
    blocked: false,
    visible: true,
    travelPhase: 'idle',
    workArea: { x: 0, y: 0, width: 2000, height: 1400 },
    window: { x: 800, y: 500, width: 300, height: 400 },
    home: { x: 1684, y: 984 },
    displayKey: '0:0:2000:1400',
    ...extra,
  };
}

function due(state: WanderState): number {
  const rest = state.nextAt ?? 0;
  const quiet = state.quietSince == null ? rest : state.quietSince + WANDER_QUIET_MS;
  return Math.max(rest, quiet);
}

function depart(state: WanderState, now: number, view: WanderSnapshot = snap()): WanderState {
  let plan = planWander(state, view, now);
  let at = now;
  if (
    plan.command == null &&
    plan.scheduleAt != null &&
    plan.scheduleAt > now &&
    (plan.state.exploreUntil == null || plan.scheduleAt < plan.state.exploreUntil)
  ) {
    at = plan.scheduleAt;
    plan = planWander(plan.state, view, at);
  }
  assert.ok(plan.command === 'left' || plan.command === 'right' || plan.command === 'up' || plan.command === 'down' || plan.command === 'home');
  const moving = planWander(plan.state, { ...view, travelPhase: 'moving' }, at + 10);
  assert.equal(moving.command, null);
  assert.equal(moving.scheduleAt, moving.state.exploreUntil);
  const arrived = planWander(moving.state, view, at + 20);
  assert.equal(arrived.command, null);
  assert.equal(arrived.state.exploreUntil, plan.state.exploreUntil);
  const lease = arrived.state.exploreUntil;
  const rest = arrived.state.nextAt;
  if (lease != null && rest != null && rest <= lease) {
    assert.ok(arrived.scheduleAt != null && arrived.scheduleAt >= at + 20 + WANDER_MIN_REST_MS);
  } else {
    assert.equal(arrived.scheduleAt, lease);
  }
  return arrived.state;
}

test('wandering is off until enabled and never leaves immediately', () => {
  const state = createWanderState(3);
  assert.equal(state.enabled, false);
  const idle = planWander(state, snap(), 1_000);
  assert.equal(idle.command, null);
  assert.equal(idle.scheduleAt, null);
  const moving = planWander(state, snap({ travelPhase: 'moving' }), 1_000);
  assert.equal(moving.command, null);
  assert.equal(moving.state.owned, false);
  const enabled = enableWander(state, 5_000, snap());
  assert.equal(enabled.command, null);
  assert.equal(enabled.state.enabled, true);
  assert.equal(enabled.state.exploreUntil, 5_000 + WANDER_EXPLORE_MS);
  assert.ok(enabled.state.nextAt != null);
  assert.ok(enabled.state.nextAt >= 5_000 + WANDER_FIRST_MIN_MS);
  assert.ok(enabled.state.nextAt <= 5_000 + WANDER_FIRST_MAX_MS);
  assert.ok(enabled.scheduleAt != null);
  assert.ok(enabled.scheduleAt >= 5_000 + WANDER_QUIET_MS);
  assert.ok(enabled.scheduleAt <= 5_000 + WANDER_FIRST_MAX_MS);
  const again = enableWander(enabled.state, 8_000, snap());
  assert.equal(again.state.exploreUntil, enabled.state.exploreUntil);
  assert.equal(again.state.nextAt, enabled.state.nextAt);
  assert.equal(again.command, null);
  const early = planWander(enabled.state, snap(), enabled.scheduleAt - 1);
  assert.equal(early.command, null);
});

test('first waits are 30 to 60 seconds and later rests are 45 to 90', () => {
  let seed = 1;
  for (let index = 0; index < 40; index += 1) {
    const first = wanderDelayMs(seed, true);
    const later = wanderDelayMs(seed, false);
    const hop = wanderHopDip(seed);
    assert.ok(first.delayMs >= WANDER_FIRST_MIN_MS);
    assert.ok(first.delayMs <= WANDER_FIRST_MAX_MS);
    assert.ok(later.delayMs >= WANDER_MIN_REST_MS);
    assert.ok(later.delayMs <= WANDER_MAX_REST_MS);
    assert.ok(hop.hopDip >= WANDER_HOP_MIN_DIP);
    assert.ok(hop.hopDip <= WANDER_HOP_MAX_DIP);
    seed = later.seed;
  }
});

test('one journey is issued inside the lease and the next is not queued', () => {
  let state = enableWander(createWanderState(9), 0, snap()).state;
  const started = state.exploreUntil;
  const at = due(state);
  const ready = planWander(state, snap(), at);
  assert.ok(ready.command);
  assert.notEqual(ready.command, 'home');
  assert.equal(ready.state.exploreUntil, started);
  const during = planWander(ready.state, snap({ travelPhase: 'moving' }), at + 50);
  assert.equal(during.command, null);
  assert.equal(during.scheduleAt, started);
  const again = planWander(during.state, snap({ travelPhase: 'moving' }), at + 80);
  assert.equal(again.command, null);
  const done = planWander(again.state, snap(), at + 100);
  assert.equal(done.command, null);
  assert.equal(done.state.exploreUntil, started);
  assert.ok(done.scheduleAt != null && done.state.exploreUntil != null && done.scheduleAt <= done.state.exploreUntil);
});

test('the third departure is still home when that departure fits in the lease', () => {
  const opened = enableWander(createWanderState(9), 0, snap());
  const forced = {
    ...opened.state,
    journeys: 2,
    nextAt: 50_000,
    quietSince: 0,
  };
  const ready = planWander(forced, snap(), 50_000);
  assert.equal(ready.command, 'home');
  assert.equal(ready.state.exploreUntil, opened.state.exploreUntil);
});

test('the same seed picks the same direction and does not reverse when another way is open', () => {
  const enabled = enableWander(createWanderState(11), 0, snap());
  const at = enabled.scheduleAt ?? 0;
  const first = planWander(enabled.state, snap(), at);
  const second = planWander(enabled.state, snap(), at);
  assert.equal(first.command, second.command);
  assert.notEqual(first.command, 'home');
  const moving = planWander(first.state, snap({ travelPhase: 'moving' }), at + 10);
  const arrived = planWander(moving.state, snap(), at + 20);
  assert.equal(arrived.state.exploreUntil, enabled.state.exploreUntil);
  const follow = planWander({ ...arrived.state, nextAt: at + 20, quietSince: 0 }, snap(), at + 20);
  if (first.command === 'left') {
    assert.notEqual(follow.command, 'right');
  }
  if (first.command === 'right') {
    assert.notEqual(follow.command, 'left');
  }
  if (first.command === 'up') {
    assert.notEqual(follow.command, 'down');
  }
  if (first.command === 'down') {
    assert.notEqual(follow.command, 'up');
  }
});

test('a hop stays inside the work area, including a negative monitor', () => {
  const area = { x: -1920, y: -80, width: 1600, height: 1000 };
  const window = { x: -1500, y: 120, width: 300, height: 400 };
  const view = snap({
    workArea: area,
    window,
    home: { x: -636, y: 504 },
    displayKey: '-1920:-80:1600:1000',
  });
  let state = enableWander(createWanderState(4), 0, view).state;
  const plan = planWander(state, view, due(state));
  assert.ok(plan.command === 'left' || plan.command === 'right' || plan.command === 'up' || plan.command === 'down');
  assert.ok(plan.hopDip != null && plan.hopDip >= WANDER_HOP_MIN_DIP && plan.hopDip <= WANDER_HOP_MAX_DIP);
  const target = wanderHop(window, plan.command, area, plan.hopDip);
  assert.deepEqual(target, nudgeTarget(createTravel(window, view.home), plan.command, area, plan.hopDip));
  const placed = { ...window, x: target.x, y: target.y };
  assert.ok(placed.x >= area.x);
  assert.ok(placed.y >= area.y);
  assert.ok(placed.x + placed.width <= area.x + area.width);
  assert.ok(placed.y + placed.height <= area.y + area.height);
  assert.ok(placed.x < 0);
  const distance = Math.hypot(target.x - window.x, target.y - window.y);
  assert.ok(distance >= WANDER_MIN_HOP_DIP);
  for (const direction of ['left', 'right', 'up', 'down'] as const) {
    assert.deepEqual(wanderHop(window, direction, area, 120), nudgeTarget(createTravel(window, view.home), direction, area, 120));
  }
  const manual = nudgeTarget(createTravel(window, view.home), 'right', area);
  assert.equal(manual.x, window.x + 120);
});

test('sleep, waking, chat, and voice hold the planner and never wake the robot', () => {
  let state = enableWander(createWanderState(2), 0, snap()).state;
  const asleep = planWander(state, snap({ asleep: true, awake: false, travelPhase: 'moving' }), 10);
  assert.equal(asleep.hold, 'asleep');
  assert.equal(asleep.scheduleAt, null);
  assert.equal(asleep.state.enabled, true);
  assert.equal(asleep.state.exploreUntil, null);
  assert.equal(asleep.command, null);
  const ignored = noteWanderWake(createWanderState(2), 20);
  assert.equal(ignored.exploreUntil, null);
  const woke = noteWanderWake(asleep.state, 20);
  assert.equal(woke.exploreUntil, 20 + WANDER_EXPLORE_MS);
  const again = noteWanderWake(woke, 30_000);
  assert.equal(again.exploreUntil, woke.exploreUntil);
  const waking = planWander(woke, snap({ awake: false, asleep: false }), 20);
  assert.equal(waking.hold, 'waking');
  assert.equal(waking.command, null);
  assert.equal(waking.state.exploreUntil, woke.exploreUntil);
  const awake = planWander(waking.state, snap(), 30);
  assert.equal(awake.command, null);
  assert.ok(awake.scheduleAt != null && awake.scheduleAt >= 30 + WANDER_MIN_REST_MS);
  assert.ok(awake.scheduleAt <= woke.exploreUntil);
  const blocked = planWander(awake.state, snap({ blocked: true }), awake.scheduleAt ?? 0);
  assert.equal(blocked.hold, 'blocked');
  assert.equal(blocked.command, null);
  assert.equal(blocked.state.exploreUntil, woke.exploreUntil);
  const owned = { ...blocked.state, owned: true };
  const voice = planWander(owned, snap({ blocked: true, travelPhase: 'moving' }), 40);
  assert.equal(voice.command, null);
  assert.notEqual(voice.command, 'stop');
  assert.equal(voice.state.exploreUntil, woke.exploreUntil);
  const withoutWake = planWander(asleep.state, snap(), 50);
  assert.equal(withoutWake.command, null);
  assert.equal(withoutWake.scheduleAt, null);
});

test('manual movement cancels the wander claim and a later rest is not a queue', () => {
  let state = enableWander(createWanderState(6), 0, snap()).state;
  const at = due(state);
  const ready = planWander(state, snap(), at);
  assert.ok(ready.command);
  const yielded = yieldWander(ready.state);
  assert.equal(yielded.owned, false);
  const during = planWander(yielded, snap({ travelPhase: 'moving' }), at + 10);
  assert.equal(during.command, null);
  assert.equal(during.hold, 'manual');
  const after = planWander(during.state, snap(), at + 30);
  assert.equal(after.command, null);
  assert.equal(after.state.exploreUntil, ready.state.exploreUntil);
  assert.ok(after.scheduleAt != null && after.state.exploreUntil != null && after.scheduleAt <= after.state.exploreUntil);
  if (after.state.nextAt != null && after.state.nextAt <= after.state.exploreUntil) {
    assert.ok(after.scheduleAt >= at + 30 + WANDER_MIN_REST_MS);
  }
  const stopped = disableWander({ ...ready.state, owned: true }, 'moving');
  assert.equal(stopped.command, 'stop');
  assert.equal(stopped.scheduleAt, null);
});

test('disable stops scheduling immediately', () => {
  const enabled = enableWander(createWanderState(1), 0, snap());
  const off = disableWander({ ...enabled.state, owned: true }, 'moving');
  assert.equal(off.state.enabled, false);
  assert.equal(off.state.exploreUntil, null);
  assert.equal(off.command, 'stop');
  assert.equal(off.scheduleAt, null);
  const later = planWander(off.state, snap(), 999_999);
  assert.equal(later.command, null);
  assert.equal(later.scheduleAt, null);
});

test('a display change replans inside the new key and does not keep the old journey', () => {
  let state = enableWander(createWanderState(8), 0, snap()).state;
  const at = due(state);
  const started = planWander(state, snap(), at);
  const shifted = planWander(started.state, snap({ displayKey: '0:0:1800:1200', travelPhase: 'moving' }), at + 5);
  assert.equal(shifted.hold, 'display');
  assert.equal(shifted.command, 'stop');
  assert.equal(shifted.state.displayKey, '0:0:1800:1200');
  assert.equal(shifted.state.owned, false);
});

test('quiet time and a recent interaction delay the departure', () => {
  const enabled = enableWander(createWanderState(12), 0, snap());
  const touched = planWander(noteWanderInteraction(enabled.state), snap(), (enabled.scheduleAt ?? 0) - 1_000);
  assert.equal(touched.command, null);
  assert.equal(touched.hold, 'quiet');
  assert.ok(touched.scheduleAt != null && touched.scheduleAt >= (enabled.scheduleAt ?? 0) - 1_000 + WANDER_QUIET_MS);
});

test('the scheduler is one timeout, wandering is a tray choice, and it does not touch input or models', () => {
  const wander = readFileSync(path.join(root, 'src/shared/wander.ts'), 'utf8');
  const main = readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
  const overlay = readFileSync(path.join(root, 'src/main/overlayWindow.ts'), 'utf8');
  const tray = readFileSync(path.join(root, 'src/main/tray.ts'), 'utf8');
  assert.equal(wander.includes('setInterval'), false);
  assert.equal(wander.includes('setTimeout'), false);
  assert.equal(wander.includes('globalShortcut'), false);
  assert.equal(wander.includes('uiohook'), false);
  assert.equal(wander.includes('desktopCapturer'), false);
  assert.equal(wander.includes('getUserMedia'), false);
  assert.equal(wander.includes('qwen'), false);
  assert.equal(wander.includes('speechSynthesis'), false);
  assert.equal(wander.includes('.wake'), false);
  assert.equal(wander.includes('setBounds'), false);
  assert.equal(wander.includes('neonTrail'), false);
  assert.match(main, /if \(!wander\.enabled\)/);
  assert.match(main, /noteManualMove/);
  assert.match(main, /overlay\?\.moveBy\(direction\)/);
  const overlaySource = overlay;
  const settleAt = overlaySource.indexOf('let settleQueued = false');
  const returnedAt = overlaySource.indexOf('destroy(): void');
  assert.ok(settleAt >= 0 && returnedAt >= 0 && settleAt < returnedAt);
  assert.equal(overlaySource.includes('travel.pause && travel.phase === \'paused\''), false);
  assert.match(main, /clearTimeout\(wanderTimer\)/);
  assert.match(main, /setTimeout\(\(\) =>/);
  assert.match(main, /phase === 'WAKING'/);
  assert.match(main, /noteWanderWake/);
  assert.match(main, /endWanderSession/);
  assert.match(main, /overlay\?\.setExplore\(null\)/);
  assert.match(main, /clearLeaseTimer/);
  assert.match(main, /wander lease expired/);
  assert.match(main, /onBodyHover/);
  assert.match(overlay, /pointerOnBody/);
  assert.equal(overlay.includes("tracking: robotPhase === 'TRACKING'"), false);
  const releaseAt = main.indexOf('overlay?.setExplore(null)');
  const destroyAt = main.indexOf('overlay?.destroy()');
  assert.ok(releaseAt >= 0 && destroyAt > releaseAt);
  assert.equal(main.includes('setInterval'), false);
  assert.equal(readFileSync(path.join(root, 'src/shared/behavior.ts'), 'utf8').includes('neonTrail'), false);
  assert.match(readFileSync(path.join(root, 'src/preload/preload.ts'), 'utf8'), /360_000/);
  assert.equal(main.includes('setInterval'), false);
  const wanderRun = main.slice(main.indexOf('const runWander'), main.indexOf('const runMoveTest'));
  assert.equal(wanderRun.includes('devMovement'), false);
  assert.equal(wanderRun.includes('DESKTOP_COMPANION_DEV'), false);
  assert.match(tray, /label: 'Wandering'/);
  assert.match(tray, /type: 'checkbox'/);
  assert.match(tray, /label: 'Return Home'/);
  assert.match(overlay, /setIgnoreMouseEvents\(true\)/);
  assert.equal(overlay.includes('.focus('), false);
  assert.match(overlay, /onTrail\?/);
});

test('several hops fit in one six-minute lease and none of them extend it', () => {
  let state = enableWander(createWanderState(15), 10_000, snap()).state;
  const lease = state.exploreUntil ?? 0;
  assert.equal(lease, 10_000 + WANDER_EXPLORE_MS);
  let previous = 10_000;
  let hops = 0;
  while (hops < 8) {
    const departAt = due(state);
    if (state.nextAt == null || departAt >= lease) {
      break;
    }
    if (hops === 0) {
      assert.ok(departAt - 10_000 >= WANDER_QUIET_MS);
      assert.ok(departAt - 10_000 <= WANDER_FIRST_MAX_MS);
    } else {
      assert.ok(departAt - previous >= WANDER_MIN_REST_MS);
      assert.ok(departAt - previous <= WANDER_MAX_REST_MS + 40);
    }
    const before = state.exploreUntil;
    const plan = planWander(state, snap(), departAt);
    assert.ok(plan.command);
    if (hops === 2) {
      assert.equal(plan.command, 'home');
    }
    state = depart(state, departAt);
    assert.equal(state.exploreUntil, before);
    previous = departAt;
    hops += 1;
  }
  assert.ok(hops >= 3);
  const expired = planWander(state, snap(), lease);
  assert.equal(expired.command, null);
  assert.equal(expired.scheduleAt, null);
  assert.equal(expired.hold, 'lease');
  assert.equal(expired.state.exploreUntil, null);
  const later = planWander(expired.state, snap(), lease + 60_000);
  assert.equal(later.command, null);
  assert.equal(later.scheduleAt, null);
});

test('hovering the body delays a hop and the lease still ends on time', () => {
  const enabled = enableWander(createWanderState(4), 1_000, snap());
  const lease = enabled.state.exploreUntil ?? 0;
  const at = enabled.scheduleAt ?? 0;
  const hovered = planWander(enabled.state, snap({ tracking: true }), at);
  assert.equal(hovered.command, null);
  assert.equal(hovered.hold, 'tracking');
  assert.equal(hovered.state.exploreUntil, lease);
  assert.ok((hovered.scheduleAt ?? 0) <= lease);
  const left = planWander({ ...hovered.state, quietSince: 0 }, snap(), at + WANDER_QUIET_MS);
  assert.ok(left.command);
  assert.equal(left.state.exploreUntil, lease);
  const expired = planWander(hovered.state, snap({ tracking: true }), lease);
  assert.equal(expired.hold, 'lease');
  assert.equal(expired.command, null);
  assert.equal(expired.scheduleAt, null);
  assert.equal(expired.state.exploreUntil, null);
});

test('a wander hop and the cursor do not renew the exploration lease', () => {
  const enabled = enableWander(createWanderState(21), 0, snap());
  const lease = enabled.state.exploreUntil;
  const at = enabled.state.nextAt ?? 0;
  const departed = depart(enabled.state, at);
  assert.equal(departed.exploreUntil, lease);
  const tracking = planWander(departed, snap({ tracking: true }), at + 30);
  assert.equal(tracking.hold, 'tracking');
  assert.equal(tracking.state.exploreUntil, lease);
  assert.equal(tracking.command, null);
});

test('a satisfied quiet gate departs in 30 to 60 seconds and a blocked chance is not queued', () => {
  const directions = new Set<string>();
  for (let seed = 1; seed <= 24; seed += 1) {
    const opened = enableWander(createWanderState(seed), 0, snap());
    const quiet = { ...opened.state, quietSince: -WANDER_QUIET_MS };
    const at = quiet.nextAt ?? 0;
    assert.ok(at >= WANDER_FIRST_MIN_MS && at <= WANDER_FIRST_MAX_MS);
    const hop = planWander(quiet, snap({ tracking: false }), at);
    assert.ok(hop.command);
    assert.notEqual(hop.command, 'home');
    assert.equal(hop.state.exploreUntil, opened.state.exploreUntil);
    assert.ok(hop.hopDip != null && hop.hopDip >= WANDER_HOP_MIN_DIP && hop.hopDip <= WANDER_HOP_MAX_DIP);
    directions.add(hop.command ?? '');
    const early = planWander(opened.state, snap(), Math.min(at, WANDER_QUIET_MS) - 1);
    assert.equal(early.command, null);
  }
  assert.ok(directions.size >= 2);
  const opened = enableWander(createWanderState(7), 0, snap());
  const quiet = { ...opened.state, quietSince: -WANDER_QUIET_MS };
  const at = quiet.nextAt ?? 0;
  const onBody = planWander(quiet, snap({ tracking: true }), at);
  assert.equal(onBody.command, null);
  assert.equal(onBody.hold, 'tracking');
  assert.equal(onBody.state.exploreUntil, opened.state.exploreUntil);
  const blocked = planWander(quiet, snap({ blocked: true }), at);
  assert.equal(blocked.command, null);
  assert.equal(blocked.hold, 'blocked');
  assert.equal(blocked.state.nextAt, quiet.nextAt);
  const skipped = planWander(blocked.state, snap(), blocked.scheduleAt ?? at);
  assert.equal(skipped.command, null);
  assert.equal(skipped.hold, 'quiet');
});

test('the lease expires at six minutes and a sleeping robot is not woken', () => {
  const enabled = enableWander(createWanderState(4), 1_000, snap());
  assert.equal(enabled.command, null);
  assert.ok((enabled.scheduleAt ?? 0) < (enabled.state.exploreUntil ?? 0));
  const opportunity = planWander(enabled.state, snap(), enabled.scheduleAt ?? 0);
  assert.ok(opportunity.command);
  assert.equal(opportunity.state.exploreUntil, enabled.state.exploreUntil);
  const atEnd = planWander(enabled.state, snap(), enabled.state.exploreUntil ?? 0);
  assert.equal(atEnd.hold, 'lease');
  assert.equal(atEnd.command, null);
  assert.equal(atEnd.scheduleAt, null);
  const later = planWander(atEnd.state, snap(), (enabled.state.exploreUntil ?? 0) + 60_000);
  assert.equal(later.command, null);
  assert.equal(later.scheduleAt, null);
  const asleep = enableWander(createWanderState(4), 1_000, snap({ awake: false, asleep: true }));
  assert.equal(asleep.command, null);
  assert.equal(asleep.scheduleAt, null);
  assert.equal(asleep.state.exploreUntil, null);
  const ended = endWanderSession(enabled.state, 'moving');
  assert.equal(ended.command, null);
  assert.equal(ended.state.exploreUntil, null);
  assert.equal(ended.scheduleAt, null);
  const owned = endWanderSession({ ...enabled.state, owned: true }, 'moving');
  assert.equal(owned.command, 'stop');
});
