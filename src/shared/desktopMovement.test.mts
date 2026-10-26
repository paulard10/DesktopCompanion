import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { observeCircle, decidePointerMode, INITIAL_POINTER_STATE } from './clickThrough.ts';
import {
  MAX_SPEED_DIP_PER_SEC,
  applyTravelPose,
  clampWindow,
  MAX_MOVE_MS,
  MIN_MOVE_MS,
  createTravel,
  nudgeTarget,
  recoverWindow,
  requestHome,
  requestTravel,
  stepTravel,
  stopTravel,
  syncTravelBounds,
  travelBlock,
  workAreaDip,
} from './desktopMovement.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const work = { x: 0, y: 0, width: 1920, height: 1040 };
const home = { x: 1604, y: 624 };

test('startup travel is idle and a nudge eases without teleporting', () => {
  const travel = createTravel({ x: home.x, y: home.y, width: 300, height: 400 }, home);
  assert.equal(travel.phase, 'idle');
  const target = nudgeTarget(travel, 'left', work);
  const started = requestTravel(travel, target, 1_000, work);
  assert.equal(started.phase, 'moving');
  assert.equal(started.x, home.x);
  const mid = stepTravel(started, 1_000 + started.durationMs / 2, work, null);
  assert.equal(mid.phase, 'moving');
  assert.ok(mid.x < home.x);
  assert.ok(mid.x > target.x);
  const arrived = stepTravel(started, 1_000 + started.durationMs, work, null);
  assert.equal(arrived.phase, 'idle');
  assert.equal(arrived.x, target.x);
  const speed = Math.hypot(target.x - home.x, target.y - home.y) / (started.durationMs / 1000);
  assert.ok(speed <= MAX_SPEED_DIP_PER_SEC + 0.01);
  assert.ok(started.durationMs >= MIN_MOVE_MS);
  assert.ok(started.durationMs <= MAX_MOVE_MS);
  const far = requestTravel(travel, { x: home.x - 2000, y: home.y }, 1_000, { x: -4000, y: 0, width: 8000, height: 2000 });
  const farSpeed = 2000 / (far.durationMs / 1000);
  assert.ok(farSpeed <= MAX_SPEED_DIP_PER_SEC + 0.01);
  const farMid = stepTravel(far, 1_000 + far.durationMs / 2, { x: -4000, y: 0, width: 8000, height: 2000 }, null);
  assert.ok(farMid.x < home.x && farMid.x > far.toX);
});

test('stop, pause, and return home stay inside one work area', () => {
  const travel = createTravel({ x: 800, y: 400, width: 300, height: 400 }, home);
  const moving = requestTravel(travel, nudgeTarget(travel, 'right', work), 0, work);
  const stopped = stopTravel(stepTravel(moving, 100, work, null));
  assert.equal(stopped.phase, 'idle');
  assert.equal(stepTravel(stopped, 500, work, null).x, stopped.x);
  const paused = stepTravel(moving, 40, work, 'chat');
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.x, moving.x);
  const resumed = stepTravel(paused, 1_000, work, null);
  assert.equal(resumed.phase, 'moving');
  const back = requestHome(stopped, 2_000, work);
  const done = stepTravel(back, 2_000 + back.durationMs, work, null);
  assert.equal(done.x, home.x);
  assert.equal(done.y, home.y);
});

test('negative coordinates, DPI, and the taskbar work area stay in DIP', () => {
  const negative = { x: -1920, y: 40, width: 1600, height: 900 };
  assert.deepEqual(workAreaDip({ workArea: negative, scaleFactor: 1.5 }), negative);
  assert.equal(workAreaDip({ workArea: negative, scaleFactor: 0 }), null);
  const parked = clampWindow({ x: -100, y: 20, width: 300, height: 400 }, negative);
  assert.ok(parked.x >= negative.x);
  assert.ok(parked.y + parked.height <= negative.y + negative.height);
  const aboveTaskbar = { x: 0, y: 0, width: 1920, height: 1000 };
  const low = clampWindow({ x: 100, y: 900, width: 300, height: 400 }, aboveTaskbar);
  assert.ok(low.y + low.height <= 1000);
  const disconnected = recoverWindow({ x: 4000, y: 10, width: 300, height: 400 }, null, work);
  assert.ok(disconnected.x + disconnected.width <= work.x + work.width);
  const travel = createTravel({ x: 800, y: 200, width: 300, height: 400 }, home);
  const rejected = requestTravel(travel, { x: -5000, y: 9000 }, 0, work);
  assert.ok(rejected.toX >= work.x && rejected.toY >= work.y);
  assert.ok(rejected.toX + rejected.width <= work.x + work.width);
  const moving = requestTravel(travel, { x: 100, y: 100 }, 0, work);
  const lost = stepTravel(moving, 40, null, null);
  assert.equal(lost.phase, 'idle');
  assert.equal(lost.x, moving.x);
  const shrunk = { x: 0, y: 0, width: 520, height: 520 };
  const redirected = stepTravel(moving, 20, shrunk, null);
  assert.ok(redirected.toX + redirected.width <= shrunk.x + shrunk.width);
  assert.ok(redirected.toY + redirected.height <= shrunk.y + shrunk.height);
  const resized = syncTravelBounds(moving, { x: moving.x, y: moving.y, width: 280, height: 360 });
  const afterResize = stepTravel(resized, 30, work, null);
  assert.equal(afterResize.width, 280);
  assert.equal(afterResize.height, 360);
});

test('a stationary cursor is clickable only while the body covers it', () => {
  const cursor = { x: 500, y: 400 };
  const away = observeCircle({
    cursor,
    windowOrigin: { x: 0, y: 0 },
    windowWidth: 300,
    windowHeight: 400,
    sampleAt: 10,
  });
  const awayMode = decidePointerMode(away, INITIAL_POINTER_STATE, { visible: true, recoveryCapture: false, now: 10 });
  assert.equal(awayMode.mode, 'passthrough');
  const over = observeCircle({
    cursor,
    windowOrigin: { x: 500 - 150, y: 400 - 200 },
    windowWidth: 300,
    windowHeight: 400,
    sampleAt: 20,
  });
  const overMode = decidePointerMode(over, INITIAL_POINTER_STATE, { visible: true, recoveryCapture: false, now: 20 });
  assert.equal(over.distanceDip, 0);
  assert.equal(overMode.mode, 'interactive');
});

test('each manual direction moves with chat closed and waits while chat is open', () => {
  const origin = createTravel({ x: 500, y: 500, width: 300, height: 400 }, { x: 500, y: 500 });
  const area = { x: 0, y: 0, width: 2000, height: 1400 };
  const chat = travelBlock({ chatOpen: true, listening: false, speaking: false, generating: false });
  assert.equal(chat, 'chat');
  assert.equal(travelBlock({ chatOpen: false, listening: false, speaking: false, generating: false }), null);
  for (const direction of ['up', 'down', 'left', 'right'] as const) {
    const moving = requestTravel(origin, nudgeTarget(origin, direction, area), 0, area);
    assert.equal(moving.phase, 'moving');
    const paused = stepTravel(moving, 40, area, chat);
    assert.equal(paused.phase, 'paused');
    assert.equal(paused.pause, 'chat');
    assert.equal(Math.round(paused.x), 500);
    assert.equal(Math.round(paused.y), 500);
    const released = stepTravel(paused, 1_000, area, null);
    assert.equal(released.phase, 'moving');
    assert.equal(released.pause, null);
    const later = stepTravel(released, 1_000 + released.durationMs / 2, area, null);
    if (direction === 'left' || direction === 'right') {
      assert.notEqual(Math.round(later.x), 500);
    } else {
      assert.notEqual(Math.round(later.y), 500);
    }
  }
});

test('chat, recording, speech, and generation defer travel', () => {
  assert.equal(travelBlock({ chatOpen: true, listening: false, speaking: false, generating: false }), 'chat');
  assert.equal(travelBlock({ chatOpen: true, listening: true, speaking: false, generating: true }), 'voice');
  assert.equal(travelBlock({ chatOpen: false, listening: false, speaking: true, generating: false }), 'voice');
  assert.equal(travelBlock({ chatOpen: false, listening: false, speaking: false, generating: true }), 'busy');
  assert.equal(travelBlock({ chatOpen: false, listening: false, speaking: false, generating: false }), null);
  const travel = requestTravel(createTravel({ x: 400, y: 200, width: 300, height: 400 }, home), { x: 200, y: 200 }, 0, work);
  const held = stepTravel(travel, travel.durationMs, work, 'voice');
  assert.equal(held.phase, 'paused');
  assert.equal(held.x, 400);
});

test('travel pose yields to sleep, speech, errors, and reduced motion', () => {
  const base = { tiltX: 0.01, antenna: 0.02, hover: 0.03, armRelax: 0 };
  const moving = applyTravelPose(base, { traveling: true, alertness: 1, presence: 'IDLE', reducedMotion: false, now: 1000 });
  assert.ok(moving.tiltX > base.tiltX);
  assert.equal(applyTravelPose(base, { traveling: true, alertness: 0.2, presence: 'IDLE', reducedMotion: false, now: 1000 }), base);
  assert.equal(applyTravelPose(base, { traveling: true, alertness: 1, presence: 'SPEAKING', reducedMotion: false, now: 1000 }), base);
  assert.equal(applyTravelPose(base, { traveling: true, alertness: 1, presence: 'ERROR', reducedMotion: false, now: 1000 }), base);
  assert.equal(applyTravelPose(base, { traveling: true, alertness: 1, presence: null, reducedMotion: true, now: 1000 }), base);
});

test('movement stays in the main process and does not start by itself', () => {
  const overlay = readFileSync(path.join(root, 'src/main/overlayWindow.ts'), 'utf8');
  const main = readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
  const movement = readFileSync(path.join(root, 'src/shared/desktopMovement.ts'), 'utf8');
  assert.equal(overlay.includes('setPosition'), false);
  assert.equal(overlay.includes('globalShortcut'), false);
  assert.match(overlay, /setBounds/);
  assert.equal(main.includes('DESKTOP_COMPANION_MOVE'), false);
  assert.equal(movement.includes('qwen'), false);
  assert.equal(movement.includes('speechSynthesis'), false);
  assert.equal(movement.includes('getUserMedia'), false);
  const tray = readFileSync(path.join(root, 'src/main/tray.ts'), 'utf8');
  assert.match(tray, /Recovery: capture whole window/);
  assert.match(tray, /Move Left/);
  assert.match(tray, /Stop movement/);
  assert.match(overlay, /setIgnoreMouseEvents\(true\)/);
  assert.equal(overlay.includes('.focus('), false);
  assert.equal(overlay.includes('globalShortcut'), false);
  const move = main.slice(main.indexOf('onMove: (direction)'), main.indexOf('onWander:'));
  assert.equal(move.includes('devMovement'), false);
  assert.equal(move.includes('enableWander'), false);
  assert.equal(move.includes('setEnabled'), false);
});
