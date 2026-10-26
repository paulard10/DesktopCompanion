import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { OVERLAY_HEIGHT_DIP, OVERLAY_WIDTH_DIP } from './placement.ts';
import { ORB_DIAMETER_DIP } from './clickThrough.ts';
import {
  ANTENNA_SWAY_RADIANS,
  BLINK_CLOSE_MS,
  BLINK_HOLD_MS,
  BLINK_START_MS,
  HOVER_AMPLITUDE_WORLD,
  TILT_Z_RADIANS,
  ambientPose,
  clickPulseScale,
} from './ambientMotion.ts';
import { cameraDistanceForBody, rigFitsFrame, viewHalfExtents, CAMERA_FOV_DEGREES, BODY_RADIUS_WORLD } from './robotFrame.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

test('idle motion is deterministic and stays inside its bounds', () => {
  const first = ambientPose(1_250);
  const second = ambientPose(1_250);
  assert.deepEqual(first, second);
  assert.ok(Math.abs(first.hover) <= HOVER_AMPLITUDE_WORLD);
  assert.ok(Math.abs(first.tiltZ) <= TILT_Z_RADIANS);
  assert.ok(Math.abs(first.antenna) <= ANTENNA_SWAY_RADIANS);
  assert.equal(ambientPose(0).blink, 0);
  assert.equal(ambientPose(-100).blink, 0);
});

test('a blink closes and reopens on the fixed schedule', () => {
  const shut = BLINK_START_MS + BLINK_CLOSE_MS + BLINK_HOLD_MS / 2;
  assert.equal(ambientPose(shut).blink, 1);
  const openAgain = BLINK_START_MS + BLINK_CLOSE_MS + BLINK_HOLD_MS + 70 + 20;
  assert.equal(ambientPose(openAgain).blink, 0);
  assert.equal(ambientPose(shut + 3_400).blink, 1);
});

test('a click pulse is a short symmetric scale and then rests', () => {
  assert.equal(clickPulseScale(null, 0), 1);
  assert.equal(clickPulseScale(100, 100), 1);
  const mid = clickPulseScale(100, 190);
  assert.ok(mid > 1.03);
  assert.equal(clickPulseScale(100, 100 + 180), 1);
});

test('the body sphere is framed to the 160 DIP proxy and the rig stays inside the window', () => {
  const distance = cameraDistanceForBody({
    viewportHeightPx: OVERLAY_HEIGHT_DIP,
    bodyDiameterPx: ORB_DIAMETER_DIP,
    fovDegrees: CAMERA_FOV_DEGREES,
    bodyRadiusWorld: BODY_RADIUS_WORLD,
  });
  const { halfHeight } = viewHalfExtents(distance, CAMERA_FOV_DEGREES, OVERLAY_WIDTH_DIP / OVERLAY_HEIGHT_DIP);
  const projected = ((BODY_RADIUS_WORLD * 2) / (halfHeight * 2)) * OVERLAY_HEIGHT_DIP;
  assert.ok(Math.abs(projected - ORB_DIAMETER_DIP) < 0.01);
  assert.equal(
    rigFitsFrame(OVERLAY_WIDTH_DIP, OVERLAY_HEIGHT_DIP, ORB_DIAMETER_DIP, {
      hoverAmplitude: HOVER_AMPLITUDE_WORLD,
      tiltRadians: TILT_Z_RADIANS,
    }),
    true,
  );
});

test('the procedural avatar keeps the semantic node names and does not own input capture', () => {
  const robot = readFileSync(path.join(here, '../renderer/avatar/proceduralRobot.ts'), 'utf8');
  const adapter = readFileSync(path.join(here, '../renderer/avatar/avatarAdapter.ts'), 'utf8');
  for (const name of [
    'Root',
    'Hover',
    'Main body',
    'Face display',
    'Left eye',
    'Right eye',
    'Cheek lights',
    'Antenna base',
    'Antenna tip',
    'Left arm',
    'Right arm',
  ]) {
    assert.match(robot, new RegExp(`name = '${name}'`));
  }
  assert.match(adapter, /interface AvatarAdapter/);
  assert.equal(robot.includes('setIgnoreMouseEvents'), false);
  assert.equal(robot.includes('ipcRenderer'), false);
});
