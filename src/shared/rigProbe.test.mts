import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MOVE_TEST_DIP, travelBlock } from './desktopMovement.ts';
import { isEyePreviewCue } from './faceExpression.ts';
import {
  ANTENNA_PROBE_Z,
  ARM_PROBE_Z,
  BODY_PROBE_Z,
  RIG_PROBE_MS,
  rigProbeOffset,
} from './rigProbe.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('a rig probe holds one absolute pose and then returns to rest', () => {
  const early = copy(rigProbeOffset('left-arm', 0));
  const later = copy(rigProbeOffset('left-arm', 1_500));
  assert.deepEqual(early, later);
  assert.equal(early?.leftArmZ, ARM_PROBE_Z);
  assert.equal(early?.rightArmZ, 0);
  assert.equal(early?.antennaZ, 0);
  assert.equal(early?.bodyZ, 0);
  assert.equal(rigProbeOffset('left-arm', RIG_PROBE_MS), null);
  assert.equal(rigProbeOffset('left-arm', RIG_PROBE_MS + 10), null);
  assert.equal(rigProbeOffset('left-arm', -1), null);
  const right = copy(rigProbeOffset('right-arm', 10));
  const antenna = copy(rigProbeOffset('antenna', 10));
  const body = copy(rigProbeOffset('body', 10));
  assert.equal(right?.rightArmZ, -ARM_PROBE_Z);
  assert.equal(right?.leftArmZ, 0);
  assert.equal(antenna?.antennaZ, ANTENNA_PROBE_Z);
  assert.equal(antenna?.leftArmZ, 0);
  assert.equal(body?.bodyZ, BODY_PROBE_Z);
  assert.equal(body?.leftArmZ, 0);
  assert.equal(body?.antennaZ, 0);
  assert.equal(rigProbeOffset('head', 10), null);
  assert.equal(rigProbeOffset('body-scale', 10), null);
});

test('the probe writes the visible rig nodes and does not scale the body', () => {
  const robot = readFileSync(path.join(root, 'src/renderer/avatar/proceduralRobot.ts'), 'utf8');
  const apply = robot.slice(robot.indexOf('apply(pose'), robot.indexOf('pulse(nowMs'));
  assert.match(robot, /name = 'Left arm'/);
  assert.match(robot, /name = 'Right arm'/);
  assert.match(robot, /name = 'Antenna base'/);
  assert.match(robot, /name = 'Face display'/);
  assert.match(robot, /name = 'Main body'/);
  assert.match(apply, /leftRest\.z \+ probePose\.leftArmZ/);
  assert.match(apply, /rightRest\.z \+ probePose\.rightArmZ/);
  assert.match(apply, /0\.12 \+ probePose\.antennaZ/);
  assert.match(apply, /face\.rotation\.set\(0, 0, 0\)/);
  assert.match(apply, /pivot\.rotation\.z = bodyRoll \+ probePose\.bodyZ/);
  assert.equal(apply.includes('probePose.head'), false);
  assert.match(robot, /name = 'Body pivot'/);
  assert.match(apply, /updateWorldMatrix/);
  assert.match(apply, /getWorldPosition/);
  assert.equal(apply.includes('body.scale'), true);
  assert.equal(apply.includes('probePose.breathing'), false);
  assert.match(robot, /TorusGeometry\(0\.15, 0\.06/);
  const director = readFileSync(path.join(root, 'src/renderer/avatar/characterDirector.ts'), 'utf8');
  assert.match(director, /probe cancel=sleep/);
  assert.match(director, /rigProbe = null/);
  assert.equal(director.includes('setTimeout'), false);
  assert.equal(readFileSync(path.join(root, 'src/shared/rigProbe.ts'), 'utf8').includes('setTimeout'), false);
});

test('rig diagnostics and the window test stay in development and use the travel controller', () => {
  const chat = readFileSync(path.join(root, 'src/renderer/chat.ts'), 'utf8');
  assert.equal(chat.includes('Test left arm'), false);
  assert.equal(chat.includes('Test right arm'), false);
  assert.equal(chat.includes('Test antenna'), false);
  assert.equal(chat.includes('Test body tilt'), false);
  assert.equal(chat.includes('Test head tilt'), false);
  assert.equal(chat.includes('PROBE_HEAD'), false);
  assert.equal(chat.includes('Reset rig'), false);
  assert.equal(chat.includes('Test window move'), false);
  const main = readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
  const tray = readFileSync(path.join(root, 'src/main/tray.ts'), 'utf8');
  assert.match(main, /move-test received source=/);
  assert.match(main, /Movement cannot run until the chat closes\. block=chat/);
  assert.match(main, /overlay\?\.moveBy\('up', MOVE_TEST_DIP\)/);
  assert.equal(main.slice(main.indexOf('const runMoveTest'), main.indexOf('const noteManualMove')).includes('setBounds'), false);
  assert.match(tray, /Test window move/);
  const overlay = readFileSync(path.join(root, 'src/main/overlayWindow.ts'), 'utf8');
  const chatWindow = readFileSync(path.join(root, 'src/main/chatWindow.ts'), 'utf8');
  assert.match(overlay, /desktop-companion: probe/);
  assert.match(overlay, /removeListener\('console-message'/);
  assert.match(chatWindow, /removeHandler\(IpcChannels\.moveTest\)/);
  assert.match(main, /move received direction=/);
  assert.equal(isEyePreviewCue('PROBE_LEFT'), true);
  assert.equal(isEyePreviewCue('THINKING'), false);
  assert.equal(MOVE_TEST_DIP, 48);
  assert.equal(travelBlock({ chatOpen: true, listening: false, speaking: false, generating: false }), 'chat');
  assert.equal(travelBlock({ chatOpen: false, listening: false, speaking: false, generating: false }), null);
  const preload = readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
  assert.match(preload, /if \(!dev\)/);
});

function copy<T>(value: T): T {
  return value == null ? value : { ...value };
}
