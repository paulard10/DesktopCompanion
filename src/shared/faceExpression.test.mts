import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BLINK_CLOSE_MS,
  BLINK_HOLD_MS,
  BLINK_OPEN_MS,
  BLINK_START_MS,
  ambientPose,
  blinkAmount,
} from './ambientMotion.ts';
import {
  EYE_CLOSED,
  EYE_CUES,
  applyAlertness,
  eyeCueFromState,
  eyeTarget,
  isEyePreviewCue,
  meanOpenness,
  opennessForAlertness,
  restEyes,
  revealedEye,
  shownOpenness,
  silhouetteDistance,
  stepEyePair,
  type EyeCue,
  type EyePair,
  type EyeShape,
} from './faceExpression.ts';
import { presentCharacter } from './presentation.ts';
import { PRESENCE_NAMES, applyPresence, isPresenceName } from './presence.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function finiteShape(shape: EyeShape): void {
  for (const value of Object.values(shape)) {
    assert.equal(Number.isFinite(value), true);
  }
}

function settle(start: EyePair, target: EyePair, stepMs: number, frames: number): EyePair {
  let eyes = start;
  for (let frame = 0; frame < frames; frame += 1) {
    eyes = stepEyePair(eyes, target, stepMs);
  }
  return eyes;
}

test('every expression target is finite and thinking is not sleep', () => {
  for (const cue of EYE_CUES) {
    const eyes = eyeTarget(cue, 1_000, true);
    finiteShape(eyes.left);
    finiteShape(eyes.right);
  }
  const thinking = eyeTarget('THINKING', 0, true);
  const sleeping = eyeTarget('SLEEPING', 0, true);
  assert.ok(thinking.left.openness > 0.55);
  assert.ok(sleeping.left.openness <= EYE_CLOSED);
  assert.ok(sleeping.right.openness <= EYE_CLOSED);
  assert.notEqual(thinking.left.openness, thinking.right.openness);
  assert.notEqual(thinking.left.gazeYaw, thinking.right.gazeYaw);
  assert.equal(sleeping.left.tilt, sleeping.right.tilt);
});

test('curious and error eyes are asymmetric and idle eyes match', () => {
  const curious = eyeTarget('CURIOUS', 0, true);
  const error = eyeTarget('ERROR', 0, true);
  const idle = eyeTarget('IDLE', 0, true);
  assert.ok(curious.left.openness - curious.right.openness > 0.1);
  assert.ok(curious.left.openness - curious.right.openness < 0.3);
  assert.ok(curious.left.lift - curious.right.lift > 0.02);
  assert.ok(curious.right.openness > 0.9);
  assert.ok(error.left.openness - error.right.openness > 0.08);
  assert.ok(error.right.openness > 0.75);
  assert.ok(error.left.glow > 0.95);
  assert.ok(error.right.glow > 0.95);
  assert.ok(curious.left.lift + curious.right.lift > error.left.lift + error.right.lift);
  assert.equal(idle.left.openness, 1);
  assert.equal(idle.left.curvature, 1);
  assert.equal(idle.left.lift, 0);
  assert.equal(idle.left.tilt, idle.right.tilt);
  const listening = eyeTarget('LISTENING', 0, true);
  assert.equal(listening.left.openness, listening.right.openness);
  assert.equal(listening.left.tilt, 0);
  assert.ok(listening.left.openness > idle.left.openness + 0.08);
  assert.ok(listening.left.openness < 1.25);
  assert.ok(listening.left.lift > idle.left.lift);
});

test('expressions stay distinct without stretching the eye arc', () => {
  const at = (cue: EyeCue) => eyeTarget(cue, 0, true);
  for (const cue of EYE_CUES) {
    const eyes = at(cue);
    for (const side of [eyes.left, eyes.right]) {
      assert.ok(side.curvature >= 0.9 && side.curvature <= 1.18);
      assert.ok(Math.abs(side.tilt) <= 0.22);
      assert.ok(Math.abs(side.lift) <= 0.04);
      if (cue !== 'SLEEPING') {
        assert.ok(side.openness >= 0.7 && side.openness <= 1.25);
      }
    }
  }
  const idle = at('IDLE');
  const listening = at('LISTENING');
  const responding = at('RESPONDING');
  const happy = at('HAPPY');
  const speaking = at('SPEAKING');
  assert.ok(silhouetteDistance(at('THINKING'), at('SLEEPING')) > 1.5);
  assert.ok(silhouetteDistance(idle, listening) > 0.4);
  assert.ok(silhouetteDistance(listening, responding) > 0.4);
  assert.ok(silhouetteDistance(happy, idle) > 0.6);
  assert.ok(silhouetteDistance(at('CURIOUS'), at('ERROR')) > 0.4);
  assert.ok(happy.left.openness > 1);
  assert.ok(Math.abs(happy.left.tilt) > Math.abs(responding.left.tilt));
  assert.ok(Math.abs(responding.left.tilt) > 0.08);
  assert.equal(happy.left.openness, happy.right.openness);
  assert.equal(responding.left.tilt, -responding.right.tilt);
  assert.ok(speaking.left.curvature > idle.left.curvature);
  assert.ok(Math.abs(speaking.left.tilt) < Math.abs(responding.left.tilt));
  const moving = eyeTarget('SPEAKING', 0, false);
  const later = eyeTarget('SPEAKING', 800, false);
  assert.notEqual(moving.left.openness, later.left.openness);
  assert.equal(at('SPEAKING').left.openness, eyeTarget('SPEAKING', 800, true).left.openness);
  const awakeSleep = at('HAPPY');
  applyAlertness(awakeSleep, 1, true);
  assert.equal(awakeSleep.left.openness, EYE_CLOSED);
  assert.equal(awakeSleep.right.openness, EYE_CLOSED);
  assert.equal(revealedEye(awakeSleep.left, 0).scaleY, EYE_CLOSED);
});

test('a blink closes and reopens without changing the expression target', () => {
  const start = BLINK_START_MS;
  assert.equal(blinkAmount(start), 0);
  assert.ok(blinkAmount(start + BLINK_CLOSE_MS / 2) > 0.4);
  assert.equal(blinkAmount(start + BLINK_CLOSE_MS + BLINK_HOLD_MS / 2), 1);
  assert.equal(blinkAmount(start + BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS), 0);
  const happy = eyeTarget('HAPPY', 0, true);
  const before = happy.left.openness;
  assert.ok(shownOpenness(before, 0) > 1);
  assert.equal(shownOpenness(before, 1), EYE_CLOSED);
  assert.equal(happy.left.openness, before);
  assert.ok(happy.left.curvature > 1.05);
  assert.ok(happy.left.curvature <= 1.18);
  const shut = revealedEye(happy.left, 1);
  assert.equal(shut.scaleY, EYE_CLOSED);
  assert.equal(shut.scaleX, 1);
  assert.equal(shut.tilt, 0);
  assert.equal(shut.lift, 0);
  const drawn = revealedEye(happy.left, 0);
  assert.ok(drawn.scaleX > 1.05 && drawn.scaleX < 1.2);
  assert.equal(drawn.tilt, 0.2);
  assert.equal(happy.left.tilt, 0.2);
});

test('sleep keeps the eyes closed across a blink window', () => {
  const open = ambientPose(0);
  const shut = { ...open, blink: 1 };
  const asleepOpen = presentCharacter({ ambient: open, alertness: 0, wakeBounce: 0, gazeYaw: 0, gazePitch: 0 });
  const asleepShut = presentCharacter({ ambient: shut, alertness: 0, wakeBounce: 0, gazeYaw: 0, gazePitch: 0 });
  assert.equal(asleepOpen.blink, 1);
  assert.equal(asleepShut.blink, 1);
  const sleeping = eyeTarget('SLEEPING', BLINK_START_MS + BLINK_CLOSE_MS, true);
  assert.equal(shownOpenness(sleeping.left.openness, asleepOpen.blink), EYE_CLOSED);
});

test('expression changes ease in without overshoot and agree across frame sizes', () => {
  const happy = eyeTarget('HAPPY', 0, true);
  const fine = settle(restEyes(), happy, 16, 60);
  const coarse = settle(restEyes(), happy, 32, 30);
  assert.ok(fine.left.curvature < happy.left.curvature);
  assert.ok(fine.left.curvature > 1.04);
  assert.ok(Math.abs(fine.left.curvature - coarse.left.curvature) < 0.04);
  assert.ok(Math.abs(fine.right.tilt - coarse.right.tilt) < 0.04);
  let eyes = eyeTarget('ERROR', 0, true);
  const idle = eyeTarget('IDLE', 0, true);
  for (let frame = 0; frame < 50; frame += 1) {
    eyes = stepEyePair(eyes, idle, 40);
  }
  assert.ok(Math.abs(eyes.left.openness - idle.left.openness) < 0.05);
  assert.ok(Math.abs(meanOpenness(eyes) - meanOpenness(idle)) < 0.05);
  const curious = eyeTarget('CURIOUS', 0, true);
  const once = stepEyePair(restEyes(), curious, 32);
  const leftTravel = (once.left.openness - 1) / (curious.left.openness - 1);
  const rightTravel = (once.right.openness - 1) / (curious.right.openness - 1);
  assert.ok(Math.abs(leftTravel - rightTravel) < 1e-9);
  assert.ok(leftTravel > 0 && leftTravel < 1);
  assert.equal(opennessForAlertness(1.08, 1, true), EYE_CLOSED);
  assert.equal(opennessForAlertness(1.08, 0, true), EYE_CLOSED);
  assert.equal(opennessForAlertness(1.08, 0, false), EYE_CLOSED);
  assert.ok(opennessForAlertness(1.08, 1, false) > 1);
  const closing = eyeTarget('HAPPY', 0, true);
  applyAlertness(closing, 0, true);
  assert.equal(closing.left.openness, EYE_CLOSED);
  assert.equal(closing.right.openness, closing.left.openness);
  assert.equal(closing.left.tilt, 0);
  assert.equal(closing.right.tilt, 0);
});

test('bad clocks and shapes stay finite', () => {
  const broken = restEyes();
  broken.left.openness = Number.NaN;
  broken.left.tilt = Number.POSITIVE_INFINITY;
  broken.right.glow = Number.NEGATIVE_INFINITY;
  const next = stepEyePair(broken, eyeTarget('LISTENING', Number.NaN, false), Number.NaN);
  finiteShape(next.left);
  finiteShape(next.right);
  const responding = eyeTarget('RESPONDING', 10_000, false);
  const later = eyeTarget('RESPONDING', 10_450, false);
  assert.ok(Math.abs(responding.left.glow - later.left.glow) < 0.001);
  assert.ok(Math.abs(responding.left.openness - later.left.openness) < 0.08);
});

test('presence names stay the same and sleep still ignores them', () => {
  assert.deepEqual(PRESENCE_NAMES, ['ATTENTIVE', 'THINKING', 'RESPONDING', 'SPEAKING', 'HAPPY', 'ERROR', 'IDLE']);
  assert.equal(isPresenceName('CURIOUS'), false);
  assert.equal(isPresenceName('SLEEPING'), false);
  assert.equal(isEyePreviewCue('CURIOUS'), true);
  assert.equal(isEyePreviewCue('THINKING'), false);
  const asleep = { glow: 0.2, antenna: 0.4, hover: 0, blink: 1 };
  assert.equal(applyPresence(asleep, 'THINKING', 0.2, 0, true), asleep);
  assert.equal(eyeCueFromState({ presence: 'THINKING', phase: 'TRACKING', tracking: true, preview: null }), 'THINKING');
  assert.equal(eyeCueFromState({ presence: null, phase: 'TRACKING', tracking: true, preview: null }), 'CURIOUS');
  assert.equal(eyeCueFromState({ presence: 'ATTENTIVE', phase: 'IDLE', tracking: false, preview: null }), 'LISTENING');
  assert.equal(
    eyeCueFromState({ presence: null, phase: 'SLEEPING', tracking: true, preview: 'THINKING' as EyeCue }),
    'SLEEPING',
  );
});

test('eye preview is development-only and the director owns the eye step', () => {
  const chat = readFileSync(path.join(root, 'src/renderer/chat.ts'), 'utf8');
  const previewStart = chat.indexOf('if (import.meta.env.DEV)');
  const preview = chat.slice(previewStart, chat.indexOf("composer.addEventListener('input'"));
  assert.match(preview, /Curious/);
  assert.match(preview, /Sleeping/);
  assert.match(preview, /Blink/);
  assert.match(preview, /Compare/);
  assert.match(preview, /Idle', 'IDLE', 'Listening'/);
  assert.equal(chat.slice(0, previewStart).includes('Curious'), false);
  const chatWindow = readFileSync(path.join(root, 'src/main/chatWindow.ts'), 'utf8');
  assert.match(chatWindow, /if \(!options\.dev/);
  const face = readFileSync(path.join(root, 'src/shared/faceExpression.ts'), 'utf8');
  assert.equal(face.includes('setBounds'), false);
  assert.equal(face.includes('desktopMovement'), false);
  assert.equal(face.includes('neonTrail'), false);
  assert.equal(face.includes('qwen'), false);
  const robot = readFileSync(path.join(root, 'src/renderer/avatar/proceduralRobot.ts'), 'utf8');
  assert.equal(robot.includes('setBounds'), false);
  assert.equal(robot.includes('EffectComposer'), false);
  assert.equal(robot.includes('GLTFLoader'), false);
  assert.match(robot, /revealEyeInto/);
  const scene = readFileSync(path.join(root, 'src/renderer/avatar/createScene.ts'), 'utf8');
  assert.equal(scene.split('new WebGLRenderer').length, 2);
  const director = readFileSync(path.join(root, 'src/renderer/avatar/characterDirector.ts'), 'utf8');
  assert.match(director, /writeEyeTarget/);
  assert.match(director, /applyAlertness/);
  assert.match(director, /stepEyePairInto/);
  assert.match(director, /level > 0\.92/);
  assert.match(director, /setEyePreview/);
  const movement = readFileSync(path.join(root, 'src/shared/desktopMovement.ts'), 'utf8');
  const trail = readFileSync(path.join(root, 'src/shared/neonTrail.ts'), 'utf8');
  assert.equal(movement.includes('faceExpression'), false);
  assert.equal(trail.includes('faceExpression'), false);
});

test('shape eyes are gone and the torus rig remains the only face', () => {
  assert.equal(existsSync(path.join(root, 'src/shared/faceShape.ts')), false);
  assert.equal(existsSync(path.join(root, 'src/shared/faceShape.test.mts')), false);
  assert.equal(existsSync(path.join(root, 'src/renderer/avatar/faceContours.ts')), false);
  const robot = readFileSync(path.join(root, 'src/renderer/avatar/proceduralRobot.ts'), 'utf8');
  assert.match(robot, /new TorusGeometry/);
  assert.match(robot, /name = 'Left eye'/);
  assert.match(robot, /name = 'Right eye'/);
  assert.equal(robot.includes('ShapeGeometry'), false);
  assert.equal(robot.includes('faceContours'), false);
  assert.equal(robot.includes('eyeRig'), false);
  const director = readFileSync(path.join(root, 'src/renderer/avatar/characterDirector.ts'), 'utf8');
  assert.equal(director.includes('faceShape'), false);
  assert.equal(director.includes('setEyeRig'), false);
  assert.match(director, /preview = null/);
  assert.match(director, /cue === 'SLEEPING'/);
  const chat = readFileSync(path.join(root, 'src/renderer/chat.ts'), 'utf8');
  assert.equal(chat.includes('Shape eyes'), false);
  assert.equal(chat.includes('PROTOTYPE'), false);
  const ipc = readFileSync(path.join(root, 'src/shared/ipc.ts'), 'utf8');
  assert.equal(ipc.includes('eye-rig'), false);
  assert.equal(ipc.includes('onEyeRig'), false);
  const scene = readFileSync(path.join(root, 'src/renderer/avatar/createScene.ts'), 'utf8');
  assert.equal(scene.split('new WebGLRenderer').length, 2);
  const happy = eyeTarget('HAPPY', 0, true);
  const idle = eyeTarget('IDLE', 0, true);
  const sleeping = eyeTarget('SLEEPING', 0, true);
  assert.equal(idle.left.openness, 1);
  assert.equal(idle.left.tilt, 0);
  assert.ok(Math.abs(happy.left.tilt) > 0.15);
  assert.equal(happy.left.openness, happy.right.openness);
  assert.ok(sleeping.left.openness <= EYE_CLOSED);
  assert.equal(shownOpenness(happy.left.openness, 1), EYE_CLOSED);
  assert.equal(eyeCueFromState({ presence: 'HAPPY', phase: 'SLEEPING', tracking: false, preview: 'HAPPY' as EyeCue }), 'SLEEPING');
});
