import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HOVER_AMPLITUDE_WORLD, TILT_Z_RADIANS } from './ambientMotion.ts';
import { ORB_DIAMETER_DIP } from './clickThrough.ts';
import { isEyePreviewCue } from './faceExpression.ts';
import { OVERLAY_HEIGHT_DIP, OVERLAY_WIDTH_DIP } from './placement.ts';
import { rigFitsFrame } from './robotFrame.ts';
import {
  ANTENNA_SWAY_MAX,
  ARM_LIFT_MAX,
  BODY_BOB_MAX,
  BODY_TILT_MAX,
  BOUNCE_MS,
  BREATH_MAX,
  CONCERN_MS,
  HEAD_TILT_MAX,
  NOD_MS,
  WAKE_PREVIEW_MS,
  noteSecondaryCue,
  restClock,
  restSecondary,
  secondarySampleInto,
  stepSecondaryInto,
  type SecondaryGesture,
  type SecondaryPose,
} from './secondaryMotion.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the neutral secondary pose is a full reset', () => {
  const pose = restSecondary();
  assert.deepEqual(pose, {
    bodyBob: 0,
    bodyTilt: 0,
    headTilt: 0,
    antennaSway: 0,
    leftArmLift: 0,
    rightArmLift: 0,
    breathingScale: 0,
    ambientMix: 1,
  });
  const clock = restClock();
  noteSecondaryCue(clock, 'HAPPY', 1_000, false);
  noteSecondaryCue(clock, 'SLEEPING', 1_200, true);
  assert.equal(clock.gesture, 'none');
  assert.equal(clock.cue, 'HAPPY');
});

test('secondary channels stay inside their bounds', () => {
  const cues = ['IDLE', 'CURIOUS', 'LISTENING', 'THINKING', 'RESPONDING', 'SPEAKING', 'HAPPY', 'ERROR', 'SLEEPING'];
  const gestures: SecondaryGesture[] = ['none', 'nod', 'bounce', 'concern', 'wave'];
  const pose = restSecondary();
  for (const cue of cues) {
    for (const gesture of gestures) {
      for (const age of [-1, 0, 120, 400, 5_000]) {
        secondarySampleInto(pose, cue, 4_000 + age, gesture, age, 1, false, -1);
        within(pose);
      }
    }
  }
});

test('each cue raises only its own gesture', () => {
  const curious = sample('CURIOUS', 'none', -1, 2_000);
  const listening = sample('LISTENING', 'none', -1, 2_000);
  const thinking = sample('THINKING', 'none', -1, 2_000);
  assert.equal(curious.headTilt, 0);
  assert.ok(curious.bodyTilt > 0.03);
  assert.ok(curious.antennaSway > 0.03);
  assert.equal(curious.ambientMix, 1);
  assert.equal(curious.bodyBob, 0);
  assert.ok(listening.antennaSway > curious.antennaSway);
  assert.ok(listening.leftArmLift > 0.2);
  assert.equal(listening.leftArmLift, listening.rightArmLift);
  assert.equal(listening.bodyTilt, 0);
  assert.equal(listening.headTilt, 0);
  assert.equal(listening.ambientMix, 0);
  assert.equal(thinking.headTilt, 0);
  assert.ok(thinking.bodyTilt < -0.06);
  assert.ok(thinking.antennaSway < -0.15);
  assert.equal(thinking.ambientMix, 0);
  assert.ok(thinking.bodyTilt < 0);
  assert.notEqual(Math.sign(curious.bodyTilt), Math.sign(thinking.bodyTilt));
  const idle = sample('IDLE', 'none', -1, 2_000);
  assert.equal(idle.bodyBob, 0);
  assert.equal(idle.bodyTilt, 0);
  assert.equal(idle.ambientMix, 1);
  const speaking = sample('SPEAKING', 'none', -1, 2_000);
  assert.equal(speaking.bodyBob, 0);
  assert.equal(speaking.ambientMix, 0);
  assert.notDeepEqual(
    [curious.headTilt, curious.bodyTilt, curious.antennaSway, curious.leftArmLift],
    [listening.headTilt, listening.bodyTilt, listening.antennaSway, listening.leftArmLift],
  );
  assert.notDeepEqual(
    [listening.headTilt, listening.bodyTilt, listening.antennaSway],
    [thinking.headTilt, thinking.bodyTilt, thinking.antennaSway],
  );
});

test('happy bounces once and then rests', () => {
  const clock = restClock();
  noteSecondaryCue(clock, 'HAPPY', 1_000, false);
  noteSecondaryCue(clock, 'HAPPY', 1_400, false);
  assert.equal(clock.startedAt, 1_000);
  assert.equal(clock.gesture, 'bounce');
  const mid = sample('HAPPY', 'bounce', BOUNCE_MS / 2, 1_000);
  assert.ok(mid.bodyBob > 0.02);
  assert.ok(mid.leftArmLift > 0.2);
  assert.equal(mid.leftArmLift, mid.rightArmLift);
  assert.equal(mid.headTilt, 0);
  assert.equal(mid.ambientMix, 0);
  assert.ok(mid.rightArmLift > 0.2);
  const done = sample('HAPPY', 'bounce', BOUNCE_MS, 1_000);
  assert.equal(done.bodyBob, 0);
  assert.equal(done.leftArmLift, 0);
  assert.equal(done.rightArmLift, 0);
  assert.equal(done.ambientMix, 1);
});

test('the responding nod starts on entry and does not restart', () => {
  const clock = restClock();
  noteSecondaryCue(clock, 'RESPONDING', 500, false);
  noteSecondaryCue(clock, 'RESPONDING', 900, false);
  assert.equal(clock.gesture, 'nod');
  assert.equal(clock.startedAt, 500);
  const nod = sample('RESPONDING', 'nod', NOD_MS / 2, 500);
  assert.ok(nod.headTilt > 0.06);
  assert.ok(nod.leftArmLift > 0.15);
  assert.equal(nod.leftArmLift, nod.rightArmLift);
  assert.equal(nod.bodyBob, 0);
  assert.equal(nod.ambientMix, 0);
  const nodded = sample('RESPONDING', 'nod', NOD_MS, 500);
  assert.equal(nodded.headTilt, 0);
  assert.equal(nodded.ambientMix, 1);
  noteSecondaryCue(clock, 'IDLE', 2_000, false);
  assert.equal(clock.gesture, 'none');
});

test('speaking motion is held only while the speaking cue is current', () => {
  const speaking = sample('SPEAKING', 'none', -1, 1_000);
  const idle = sample('IDLE', 'none', -1, 1_000);
  assert.ok(speaking.antennaSway > 0.15);
  assert.equal(speaking.headTilt, 0);
  assert.equal(speaking.leftArmLift, 0);
  assert.equal(speaking.bodyBob, 0);
  assert.equal(speaking.ambientMix, 0);
  assert.equal(idle.antennaSway, 0);
  assert.equal(idle.ambientMix, 1);
  const quietHover = 0.04 * speaking.ambientMix;
  const idleHover = 0.04 * idle.ambientMix;
  assert.equal(quietHover, 0);
  assert.equal(idleHover, 0.04);
});

test('sleep drops an active gesture and keeps a smaller breath', () => {
  const clock = restClock();
  noteSecondaryCue(clock, 'HAPPY', 0, false);
  noteSecondaryCue(clock, 'SLEEPING', 100, true);
  assert.equal(clock.gesture, 'none');
  const asleep = sample('SLEEPING', 'bounce', BOUNCE_MS / 2, 1_400);
  assert.equal(asleep.bodyBob, 0);
  assert.equal(asleep.headTilt, 0);
  assert.equal(asleep.antennaSway, 0);
  assert.equal(asleep.leftArmLift, 0);
  assert.equal(asleep.rightArmLift, 0);
  assert.ok(asleep.breathingScale > 0);
  assert.ok(asleep.breathingScale < sample('IDLE', 'none', -1, 1_050).breathingScale);
});

test('wake returns the body to the awake posture and the preview ends', () => {
  const asleep = sample('IDLE', 'none', -1, 1_000, 0);
  assert.equal(asleep.leftArmLift, 0);
  assert.equal(asleep.antennaSway, 0);
  assert.ok(asleep.breathingScale > 0);
  const slumped = sample('IDLE', 'none', -1, 0, 1, 0);
  assert.ok(slumped.antennaSway < 0);
  assert.ok(slumped.leftArmLift < 0);
  const awake = sample('IDLE', 'none', -1, 0, 1, WAKE_PREVIEW_MS);
  assert.equal(awake.leftArmLift, 0);
  assert.equal(awake.antennaSway, 0);
  assert.equal(awake.headTilt, 0);
  const current = { ...slumped };
  const target = restSecondary();
  for (let step = 0; step < 40; step += 1) {
    stepSecondaryInto(current, current, target, 50);
  }
  assert.ok(Math.abs(current.leftArmLift) < 0.001);
  assert.ok(Math.abs(current.antennaSway) < 0.001);
  assert.ok(Math.abs(current.headTilt) < 0.001);
  assert.ok(current.breathingScale < 0.001);
});

test('a new cue cancels the previous gesture', () => {
  const clock = restClock();
  noteSecondaryCue(clock, 'ERROR', 10, false);
  assert.equal(clock.gesture, 'concern');
  const mid = sample('ERROR', 'concern', CONCERN_MS / 2, 10);
  assert.ok(mid.bodyTilt > 0.06);
  assert.equal(mid.headTilt, 0);
  assert.ok(mid.leftArmLift > mid.rightArmLift);
  assert.ok(mid.leftArmLift > 0.2);
  noteSecondaryCue(clock, 'LISTENING', 40, false);
  assert.equal(clock.gesture, 'none');
  const current = { ...mid };
  const target = sample('LISTENING', 'none', -1, 40);
  stepSecondaryInto(current, current, target, 16);
  assert.ok(current.leftArmLift < mid.leftArmLift);
});

test('the pose at one timestamp does not depend on earlier frames', () => {
  const direct = sample('HAPPY', 'bounce', 240, 8_000);
  const again = sample('HAPPY', 'bounce', 240, 8_000);
  assert.deepEqual(direct, again);
  const held = restSecondary();
  stepSecondaryInto(held, held, direct, 0);
  assert.deepEqual(held, restSecondary());
  const broken = restSecondary();
  secondarySampleInto(broken, 'SPEAKING', Number.NaN, 'nod', Number.NaN, Number.POSITIVE_INFINITY, false, Number.NaN);
  within(broken);
});

test('reduced motion and a finished blend leave every channel neutral', () => {
  const reduced = sample('HAPPY', 'bounce', 200, 1_000, 1, -1, true);
  assert.deepEqual(reduced, restSecondary());
  const current = sample('CURIOUS', 'none', -1, 1_000);
  const target = restSecondary();
  for (let step = 0; step < 50; step += 1) {
    stepSecondaryInto(current, current, target, 40);
  }
  assert.ok(Math.abs(current.headTilt) < 0.001);
  assert.ok(Math.abs(current.bodyTilt) < 0.001);
  assert.ok(Math.abs(current.antennaSway) < 0.001);
  assert.ok(Math.abs(current.leftArmLift) < 0.001);
  assert.ok(current.breathingScale < 0.001);
});

test('secondary motion does not allocate geometry or own the window', () => {
  const motion = readFileSync(path.join(root, 'src/shared/secondaryMotion.ts'), 'utf8');
  const robot = readFileSync(path.join(root, 'src/renderer/avatar/proceduralRobot.ts'), 'utf8');
  const eyes = readFileSync(path.join(root, 'src/shared/faceExpression.ts'), 'utf8');
  const director = readFileSync(path.join(root, 'src/renderer/avatar/characterDirector.ts'), 'utf8');
  const movement = readFileSync(path.join(root, 'src/shared/desktopMovement.ts'), 'utf8');
  const wander = readFileSync(path.join(root, 'src/shared/wander.ts'), 'utf8');
  const trail = readFileSync(path.join(root, 'src/shared/neonTrail.ts'), 'utf8');
  const apply = robot.slice(robot.indexOf('apply(pose'), robot.indexOf('pulse(nowMs'));
  assert.equal(motion.includes('new '), false);
  assert.equal(motion.includes('setTimeout'), false);
  assert.equal(motion.includes('setInterval'), false);
  assert.equal(motion.includes('setBounds'), false);
  assert.equal(motion.includes('setIgnoreMouseEvents'), false);
  assert.equal(apply.includes('new '), false);
  assert.match(apply, /bodyRest/);
  assert.match(apply, /face\.rotation\.set\(0, 0, 0\)/);
  assert.equal(apply.includes('face.rotation.set(motion'), false);
  assert.equal(apply.includes('probePose.head'), false);
  assert.match(apply, /pivot\.rotation\.x = pose\.tiltX \+ \(motion\?\.headTilt \?\? 0\)/);
  assert.match(apply, /leftRest\.z \* \(1 - relax \* 0\.45\) \+ leftLift/);
  assert.match(apply, /rightRest\.z \* \(1 - relax \* 0\.45\) - rightLift/);
  assert.equal(apply.includes('leftRest.x + relax * 0.28 - leftLift'), false);
  assert.match(apply, /0\.12 \+ pose\.antenna/);
  assert.match(robot, /TorusGeometry\(0\.15, 0\.06/);
  assert.equal(robot.includes('ShapeGeometry'), false);
  assert.equal(eyes.includes('secondaryMotion'), false);
  assert.equal(movement.includes('secondaryMotion'), false);
  assert.equal(wander.includes('secondaryMotion'), false);
  assert.equal(trail.includes('secondaryMotion'), false);
  assert.match(director, /secondarySampleInto/);
  assert.match(director, /ambient\.hover \*= mix/);
  assert.match(director, /import\.meta\.env\.DEV/);
  const overlay = readFileSync(path.join(root, 'src/main/overlayWindow.ts'), 'utf8');
  const chat = readFileSync(path.join(root, 'src/main/chatWindow.ts'), 'utf8');
  assert.match(overlay, /travel request command=/);
  assert.match(overlay, /travel bounds/);
  const preview = chat.slice(chat.indexOf('const onPreview'), chat.indexOf('const onReset'));
  assert.equal(preview.includes('ttsSpeaking'), false);
  assert.equal(preview.includes('captureBusy'), false);
  assert.match(director, /wakePreviewUntil = Number\.NEGATIVE_INFINITY/);
  const waking = director.slice(director.indexOf("cue === 'WAKING'"), director.indexOf("cue === 'BLINK'"));
  assert.equal(waking.includes('wake('), false);
  assert.equal(waking.includes('reduceBehavior'), false);
  assert.equal(isEyePreviewCue('WAKING'), true);
  assert.equal(isEyePreviewCue('THINKING'), false);
});

test('the extra body motion still fits the click circle and the overlay', () => {
  assert.equal(
    rigFitsFrame(OVERLAY_WIDTH_DIP, OVERLAY_HEIGHT_DIP, ORB_DIAMETER_DIP, {
      hoverAmplitude: HOVER_AMPLITUDE_WORLD + 0.018 + BODY_BOB_MAX,
      tiltRadians: TILT_Z_RADIANS + 0.01,
    }),
    true,
  );
  assert.equal(
    rigFitsFrame(OVERLAY_WIDTH_DIP, OVERLAY_HEIGHT_DIP, ORB_DIAMETER_DIP, {
      hoverAmplitude: HOVER_AMPLITUDE_WORLD,
      tiltRadians: TILT_Z_RADIANS + BODY_TILT_MAX,
    }),
    true,
  );
  assert.ok(ARM_LIFT_MAX <= 0.36);
  assert.ok(ARM_LIFT_MAX >= 0.2);
  assert.ok(ANTENNA_SWAY_MAX <= 0.28);
  assert.ok(ANTENNA_SWAY_MAX >= 0.15);
  assert.ok(BODY_TILT_MAX <= 0.08);
  assert.ok(HEAD_TILT_MAX <= 0.08);
  const armReach = 0.34 + 0.28 + 0.11;
  const raisedHand = 1.08 + armReach * Math.sin(0.42 + ARM_LIFT_MAX);
  assert.ok(raisedHand < 1.875);
  assert.ok(BREATH_MAX <= 0.012);
});

test('the waking preview is development-only and cannot call the sleep clock', () => {
  const chat = readFileSync(path.join(root, 'src/renderer/chat.ts'), 'utf8');
  const preview = chat.slice(chat.indexOf('if (import.meta.env.DEV)'), chat.indexOf("composer.addEventListener('input'"));
  assert.match(preview, /Waking/);
  assert.match(preview, /'WAKING'/);
  assert.equal(chat.slice(0, chat.indexOf('if (import.meta.env.DEV)')).includes('Waking'), false);
});

function sample(
  cue: string,
  gesture: SecondaryGesture,
  age: number,
  now: number,
  alertness = 1,
  wakeAge = -1,
  reducedMotion = false,
): SecondaryPose {
  const pose = restSecondary();
  secondarySampleInto(pose, cue, now, gesture, age, alertness, reducedMotion, wakeAge);
  return pose;
}

function within(pose: SecondaryPose): void {
  for (const value of Object.values(pose)) {
    assert.equal(Number.isFinite(value), true);
  }
  assert.ok(Math.abs(pose.bodyBob) <= BODY_BOB_MAX);
  assert.ok(Math.abs(pose.bodyTilt) <= BODY_TILT_MAX);
  assert.ok(Math.abs(pose.headTilt) <= HEAD_TILT_MAX);
  assert.ok(Math.abs(pose.antennaSway) <= ANTENNA_SWAY_MAX);
  assert.ok(Math.abs(pose.leftArmLift) <= ARM_LIFT_MAX);
  assert.ok(Math.abs(pose.rightArmLift) <= ARM_LIFT_MAX);
  assert.ok(pose.breathingScale >= 0 && pose.breathingScale <= BREATH_MAX);
  assert.ok(pose.ambientMix >= 0 && pose.ambientMix <= 1);
}
