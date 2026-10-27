import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { OVERLAY_HEIGHT_DIP, OVERLAY_WIDTH_DIP } from './placement.ts';
import {
  HIT_SLACK_DIP,
  LEAVE_HOLD_MS,
  ORB_DIAMETER_DIP,
  ORB_RADIUS_DIP,
  SAMPLE_STALE_MS,
  INITIAL_POINTER_STATE,
  decidePointerMode,
  observeCircle,
  type CircleObservation,
  type PointerDecisionState,
  type WindowSample,
} from './clickThrough.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const windowOrigin = { x: 100, y: 50 };
const centerX = OVERLAY_WIDTH_DIP / 2;
const centerY = OVERLAY_HEIGHT_DIP / 2;

function sample(localX: number, localY: number, sampleAt = 1_000): WindowSample {
  return {
    cursor: { x: windowOrigin.x + localX, y: windowOrigin.y + localY },
    windowOrigin,
    windowWidth: OVERLAY_WIDTH_DIP,
    windowHeight: OVERLAY_HEIGHT_DIP,
    sampleAt,
  };
}

function observeAt(localX: number, localY: number, sampleAt = 1_000): CircleObservation {
  return observeCircle(sample(localX, localY, sampleAt));
}

function decideAt(
  localX: number,
  localY: number,
  previous: PointerDecisionState = INITIAL_POINTER_STATE,
  sampleAt = 1_000,
) {
  const observation = observeAt(localX, localY, sampleAt);
  return decidePointerMode(observation, previous, {
    visible: true,
    recoveryCapture: false,
    now: sampleAt,
  });
}

test('the hit target is the visible circle with no extra padding or exit hold', () => {
  assert.equal(OVERLAY_WIDTH_DIP, 216);
  assert.equal(OVERLAY_HEIGHT_DIP, 224);
  assert.equal(ORB_DIAMETER_DIP, 108);
  assert.equal(ORB_RADIUS_DIP, 54);
  assert.equal(HIT_SLACK_DIP, 0);
  assert.equal(LEAVE_HOLD_MS, 0);
});

test('converts desktop DIP into window-local DIP, including a negative monitor', () => {
  const observation = observeCircle({
    cursor: { x: -1920 + centerX, y: centerY },
    windowOrigin: { x: -1920, y: 0 },
    windowWidth: OVERLAY_WIDTH_DIP,
    windowHeight: OVERLAY_HEIGHT_DIP,
    sampleAt: 10,
  });
  assert.equal(observation.cursorInsideWindow, true);
  assert.equal(observation.distanceDip, 0);
});

test('the circle center and visual edge are interactive', () => {
  const center = decideAt(centerX, centerY);
  assert.equal(center.mode, 'interactive');
  assert.equal(center.reason, 'inside-target');

  const edge = decideAt(centerX, centerY - ORB_RADIUS_DIP);
  assert.equal(edge.mode, 'interactive');
});

test('one DIP inside the visible circle captures and one DIP outside does not', () => {
  const insideEdge = decideAt(centerX, centerY - ORB_RADIUS_DIP + 1);
  assert.equal(insideEdge.mode, 'interactive');
  assert.equal(insideEdge.reason, 'inside-target');

  const onEdge = decideAt(centerX, centerY - ORB_RADIUS_DIP);
  assert.equal(onEdge.mode, 'interactive');

  const outsideEdge = decideAt(centerX, centerY - ORB_RADIUS_DIP - 1, insideEdge.state, 1_000);
  assert.equal(outsideEdge.mode, 'passthrough');
  assert.equal(outsideEdge.reason, 'left-target');
});

test('every window corner is outside the circle', () => {
  const corners = [
    [0, 0],
    [OVERLAY_WIDTH_DIP - 1, 0],
    [0, OVERLAY_HEIGHT_DIP - 1],
    [OVERLAY_WIDTH_DIP - 1, OVERLAY_HEIGHT_DIP - 1],
  ] as const;
  for (const [x, y] of corners) {
    const result = decideAt(x, y);
    assert.equal(result.mode, 'passthrough', `${x},${y}`);
  }
});

test('all four corners pass through immediately after the pointer was on the circle', () => {
  const inside = decideAt(centerX, centerY, INITIAL_POINTER_STATE, 1_000);
  assert.equal(inside.mode, 'interactive');
  const corners = [
    [0, 0],
    [OVERLAY_WIDTH_DIP - 1, 0],
    [0, OVERLAY_HEIGHT_DIP - 1],
    [OVERLAY_WIDTH_DIP - 1, OVERLAY_HEIGHT_DIP - 1],
  ] as const;
  for (const [x, y] of corners) {
    const result = decideAt(x, y, inside.state, 1_000);
    assert.equal(result.mode, 'passthrough', `${x},${y}`);
    assert.equal(result.reason, 'left-target', `${x},${y}`);
  }
});

test('moving from the circle to a transparent point inside the window is passthrough', () => {
  const inside = decideAt(centerX, centerY, INITIAL_POINTER_STATE, 1_000);
  const beside = decideAt(4, centerY, inside.state, 1_000);
  assert.equal(beside.mode, 'passthrough');
  assert.equal(beside.reason, 'left-target');
  const stayed = decideAt(4, centerY + 30, beside.state, 1_016);
  assert.equal(stayed.mode, 'passthrough');
  assert.equal(stayed.reason, 'outside-target');
});

test('leaving the circle and re-entering on the next sample captures again', () => {
  const inside = decideAt(centerX, centerY, INITIAL_POINTER_STATE, 1_000);
  const left = decideAt(0, 0, inside.state, 1_016);
  assert.equal(left.mode, 'passthrough');
  assert.equal(left.state.leavePendingSince, null);

  const returned = decideAt(centerX, centerY, left.state, 1_032);
  assert.equal(returned.mode, 'interactive');
  assert.equal(returned.reason, 'inside-target');
  assert.equal(returned.state.leavePendingSince, null);
});

test('a cursor outside the window passes through immediately', () => {
  const inside = decideAt(centerX, centerY);
  const observation = observeCircle({
    cursor: { x: windowOrigin.x - 2, y: windowOrigin.y + centerY },
    windowOrigin,
    windowWidth: OVERLAY_WIDTH_DIP,
    windowHeight: OVERLAY_HEIGHT_DIP,
    sampleAt: 1_100,
  });
  const result = decidePointerMode(observation, inside.state, {
    visible: true,
    recoveryCapture: false,
    now: 1_100,
  });
  assert.equal(observation.cursorInsideWindow, false);
  assert.equal(result.mode, 'passthrough');
  assert.equal(result.reason, 'outside-window');
});

test('a stale or missing sample defaults to passthrough', () => {
  const freshHit = observeAt(centerX, centerY, 1_000);
  const stale = decidePointerMode(freshHit, INITIAL_POINTER_STATE, {
    visible: true,
    recoveryCapture: false,
    now: 1_000 + SAMPLE_STALE_MS + 1,
  });
  assert.equal(stale.mode, 'passthrough');
  assert.equal(stale.reason, 'stale');

  const missing = decidePointerMode(null, { mode: 'interactive', leavePendingSince: null }, {
    visible: true,
    recoveryCapture: false,
    now: 2_000,
  });
  assert.equal(missing.mode, 'passthrough');
  assert.equal(missing.reason, 'stale');
});

test('passthrough does not stick after the pointer returns to the circle', () => {
  const outside = decideAt(0, 0);
  assert.equal(outside.mode, 'passthrough');
  const back = decideAt(centerX, centerY, outside.state, 2_000);
  assert.equal(back.mode, 'interactive');
});

test('recovery is off by default in source and is not written to disk', () => {
  const overlay = readFileSync(path.join(here, '../main/overlayWindow.ts'), 'utf8');
  const tray = readFileSync(path.join(here, '../main/tray.ts'), 'utf8');
  assert.match(overlay, /let recoveryCapture = false/);
  assert.equal(overlay.includes('writeFile'), false);
  assert.equal(overlay.includes('forward: true'), false);
  assert.equal(tray.includes('writeFile'), false);
  assert.match(tray, /Recovery: capture whole window/);
});

test('recovery captures a corner, and turning it off releases that corner', () => {
  const corner = observeAt(0, 0, 1_000);
  const enabled = decidePointerMode(corner, { mode: 'passthrough', leavePendingSince: null }, {
    visible: true,
    recoveryCapture: true,
    now: 1_000,
  });
  assert.equal(enabled.mode, 'interactive');
  assert.equal(enabled.reason, 'recovery');

  const disabled = decidePointerMode(corner, enabled.state, {
    visible: true,
    recoveryCapture: false,
    now: 1_000,
  });
  assert.equal(disabled.mode, 'passthrough');
  assert.equal(disabled.reason, 'left-target');
});

test('recovery captures the window, and hiding wins over recovery', () => {
  const outside = observeAt(0, 0, 1_000);
  const recovered = decidePointerMode(outside, INITIAL_POINTER_STATE, {
    visible: true,
    recoveryCapture: true,
    now: 1_000,
  });
  assert.equal(recovered.mode, 'interactive');
  assert.equal(recovered.reason, 'recovery');

  const hidden = decidePointerMode(outside, recovered.state, {
    visible: false,
    recoveryCapture: true,
    now: 1_010,
  });
  assert.equal(hidden.mode, 'passthrough');
  assert.equal(hidden.reason, 'hidden');
});

test('the body proxy is 108 DIP and the page does not paint a circle', () => {
  const css = readFileSync(path.join(here, '../renderer/styles.css'), 'utf8');
  const html = readFileSync(path.join(here, '../renderer/index.html'), 'utf8');
  const renderer = readFileSync(path.join(here, '../renderer/main.ts'), 'utf8');
  const scene = readFileSync(path.join(here, '../renderer/avatar/createScene.ts'), 'utf8');
  const preload = readFileSync(path.join(here, '../preload/preload.ts'), 'utf8');
  assert.equal(css.includes('#39ff14'), false);
  assert.equal(html.includes('id="orb"'), false);
  assert.match(html, /<canvas id="view"/);
  assert.match(scene, /bodyDiameterPx:\s*COMPANION_LAYOUT\.cameraFramingDip\.bodyDiameter/);
  assert.equal(preload.includes('setIgnoreMouseEvents'), false);
  assert.equal(preload.includes('overlay:circle-click'), true);
  assert.equal(renderer.includes('setIgnoreMouseEvents'), false);
  assert.equal(renderer.includes('pointermove'), false);
});
