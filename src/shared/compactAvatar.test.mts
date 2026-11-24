import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { COMPANION_LAYOUT, COMPACT_LAYOUT, LEGACY_LAYOUT, chatBadgeBoundsDip, type CompanionLayout } from './companionLayout.ts';
import { armProxyHit, decidePointerMode, INITIAL_POINTER_STATE, observeCircle, orbGeometry } from './clickThrough.ts';
import { placeOverlay } from './placement.ts';
import { chatTriggerHit, withChatTrigger } from './chatTrigger.ts';
import { placeChat } from './chatPlacement.ts';
import { clampWindow, createTravel, requestHome, stepTravel, workAreaDip } from './desktopMovement.ts';
import { canvasBitmapSize, trailingPoint } from './neonTrail.ts';
import { BODY_RADIUS_WORLD, CAMERA_FOV_DEGREES, cameraDistanceForBody } from './robotFrame.ts';
import { ambientPose, type AvatarPose } from './ambientMotion.ts';
import { presentCharacter } from './presentation.ts';
import { applyPresence, PRESENCE_NAMES } from './presence.ts';
import { restSecondary, secondarySampleInto } from './secondaryMotion.ts';
import { gestureOffset, ROBOT_GESTURES } from './gesturePose.ts';
import { BEHAVIOR_PHASES } from './ipc.ts';
import { projectedBodyBottomDip } from './dockingGeometry.ts';
import { alertness, initialBehavior, reduceBehavior, stepBehavior, wakeBounce } from './behavior.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8');

// Transform the real renderer module using the existing Vite dependency. No
// browser, GPU, listening HTTP server, microphone or provider is started.
const loader = await createServer({
  configFile: false, root, define: { 'import.meta.env.DEV': 'false' },
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
let createRobot: typeof import('../renderer/avatar/proceduralRobot.ts').createProceduralRobot;
try {
  ({ createProceduralRobot: createRobot } = await loader.ssrLoadModule('/src/renderer/avatar/proceduralRobot.ts'));
} finally {
  await loader.close();
}
const avatar = createRobot();
after(() => avatar.dispose());

const neutral: AvatarPose = { ...ambientPose(0), hover: 0, tiltX: 0, tiltZ: 0, antenna: 0 };

function project(layout: CompanionLayout, pose: AvatarPose, checkArm = false, pulse = false, bodyOnly = false, subject = avatar) {
  const { width, height } = layout.windowDip;
  const camera = new PerspectiveCamera(CAMERA_FOV_DEGREES, width / height, 0.1, 50);
  camera.position.z = cameraDistanceForBody({
    viewportHeightPx: height, bodyDiameterPx: layout.cameraFramingDip.bodyDiameter,
    bodyRadiusWorld: BODY_RADIUS_WORLD, fovDegrees: CAMERA_FOV_DEGREES,
  });
  camera.updateMatrixWorld();
  if (pulse) subject.pulse(0);
  subject.apply(pose, pulse ? 90 : 1000);
  subject.object.updateMatrixWorld(true);
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const point = new Vector3();
  const matrix = new Matrix4();
  const local = { x: 0, y: 0 };
  let armPoints = 0;
  subject.object.traverse(node => {
    if (!('isMesh' in node) || !node.isMesh) return;
    if (bodyOnly && node.name !== 'Main body') return;
    const mesh = node as import('three').Mesh;
    let parent: import('three').Object3D | null = mesh;
    while (parent && parent.name !== 'Left arm' && parent.name !== 'Right arm') parent = parent.parent;
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(mesh.matrixWorld);
    const positions = mesh.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      point.fromBufferAttribute(positions, index).applyMatrix4(matrix);
      local.x = (point.x + 1) * width / 2;
      local.y = (1 - point.y) * height / 2;
      assert.ok(Number.isFinite(local.x) && Number.isFinite(local.y));
      bounds.left = Math.min(bounds.left, local.x); bounds.right = Math.max(bounds.right, local.x);
      bounds.top = Math.min(bounds.top, local.y); bounds.bottom = Math.max(bounds.bottom, local.y);
      if (checkArm && parent) {
        const onBody = Math.hypot(local.x - width / 2, local.y - height / 2) <= layout.bodyProxyDip.diameter / 2;
        assert.ok(onBody || armProxyHit(local, width, height, layout), `arm vertex missed: ${local.x},${local.y}`);
        armPoints++;
      }
    }
  });
  return { ...bounds, height: bounds.bottom - bounds.top, armPoints };
}

test('docking lower-body anchor agrees with actual sleeping mesh projection without changing the camera or rig', () => {
  const sleeping = presentCharacter({ ambient: { ...ambientPose(0), hover: 0 }, alertness: 0,
    wakeBounce: 0, gazeYaw: 0, gazePitch: 0 });
  const body = project(COMPACT_LAYOUT, sleeping, false, false, true);
  assert.ok(Math.abs(body.bottom - projectedBodyBottomDip()) < 0.15,
    `actual sleeping body bottom=${body.bottom}, analytic=${projectedBodyBottomDip()}`);
  assert.ok(body.top > 0 && body.bottom < COMPACT_LAYOUT.windowDip.height);
});

function decision(x: number, y: number, at = 1000, previous = INITIAL_POINTER_STATE, visible = true, recoveryCapture = false, now = at) {
  const observation = observeCircle({
    cursor: { x: x - 1800, y: y + 40 }, windowOrigin: { x: -1800, y: 40 },
    windowWidth: 216, windowHeight: 224, sampleAt: at,
  });
  return decidePointerMode(observation, previous, { visible, recoveryCapture, now });
}

test('compact dimensions, proxy and independent camera mapping are exact', () => {
  assert.equal(COMPANION_LAYOUT, COMPACT_LAYOUT);
  assert.deepEqual(COMPACT_LAYOUT, {
    windowDip: { width: 216, height: 224 }, placementMarginDip: 16,
    cameraFramingDip: { bodyDiameter: 108 }, bodyProxyDip: { diameter: 108 },
    chatBadgeDip: { centerX: 190, centerY: 92, radius: 18 },
    trailAnchorDip: { bodyRadius: 54 },
    armProxyDip: { fromX: 60, fromY: 0, toX: 72, toY: 42, radius: 25 },
  });
  assert.deepEqual(orbGeometry(216, 224), { centerX: 108, centerY: 112, radius: 54, captureRadius: 54 });
  const cameraZ = cameraDistanceForBody({ viewportHeightPx: 224, bodyDiameterPx: 108, fovDegrees: 28, bodyRadiusWorld: 1 });
  assert.ok(Math.abs(cameraZ - 224 / (108 * Math.tan(14 * Math.PI / 180))) < 1e-12);
  assert.equal(216 * 224, 48384);
});

test('actual neutral mesh projects near 130 DIP high with the original proportions', t => {
  const solo = createRobot();
  const compact = project(COMPACT_LAYOUT, neutral, true, false, false, solo);
  solo.dispose();
  const legacy = project(LEGACY_LAYOUT, neutral);
  assert.ok(Math.abs(compact.height - 130.64191923157043) < 1e-6);
  assert.ok(compact.height >= 125 && compact.height <= 135);
  assert.ok(compact.height < legacy.height * 0.72);
  assert.ok(compact.armPoints > 1000);
  t.diagnostic(`Calculated mesh projection: compact ${compact.height.toFixed(3)} DIP; legacy ${legacy.height.toFixed(3)} DIP. Not a Windows pixel measurement.`);
});

test('real presence, gaze, sleep, gestures and click pulse fit; sampled arms remain clickable', () => {
  let count = 0;
  for (const cue of [...PRESENCE_NAMES, 'SLEEPING'] as const) {
    for (const age of [0, 90, 180, 320, 390, 600, 780, 1200, 3000]) {
      for (const yaw of [-0.5, 0, 0.5]) for (const pitch of [-0.3, 0.3]) {
        const asleep = cue === 'SLEEPING';
        const secondary = restSecondary();
        const gesture = cue === 'HAPPY' ? 'bounce' : cue === 'RESPONDING' ? 'nod' : cue === 'ERROR' ? 'concern' : 'none';
        secondarySampleInto(secondary, cue, age, gesture, age, asleep ? 0 : 1, false, -1);
        const ambient = ambientPose(age);
        ambient.hover *= secondary.ambientMix; ambient.tiltX *= secondary.ambientMix;
        ambient.tiltZ *= secondary.ambientMix; ambient.antenna *= secondary.ambientMix;
        const pose = applyPresence(presentCharacter({ ambient, alertness: asleep ? 0 : 1, wakeBounce: 0, gazeYaw: yaw, gazePitch: pitch }), asleep ? null : cue, asleep ? 0 : 1, age, false);
        const offset = gestureOffset(ROBOT_GESTURES[count % ROBOT_GESTURES.length]!, age);
        const bounds = project(COMPACT_LAYOUT, { ...pose, secondary,
          tiltX: pose.tiltX + (offset?.tiltX ?? 0), tiltZ: pose.tiltZ + (offset?.tiltZ ?? 0),
          antenna: pose.antenna + (offset?.antenna ?? 0), wakeScale: pose.wakeScale * (offset?.wakeScale ?? 1),
        }, true, true);
        assert.ok(bounds.left >= 6 && bounds.right <= 210 && bounds.top >= 6 && bounds.bottom <= 218, JSON.stringify(bounds));
        count++;
      }
    }
  }
  assert.equal(count, 432);
});

test('conservative combined motion envelope and development probes have window padding', t => {
  const union = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (let bits = 0; bits < 256; bits++) {
    // Deliberately combine more extreme channels than normal cue blending.
    const pose = { ...neutral, hover: bits & 1 ? 0.1 : -0.1,
      tiltX: bits & 2 ? 0.4 : -0.3, tiltZ: bits & 4 ? 0.24 : -0.24,
      bodyYaw: bits & 8 ? 0.2 : -0.2, antenna: bits & 16 ? 0.7 : -0.7,
      wakeScale: 1.115, armRelax: bits & 32 ? 1 : 0,
      secondary: { ...restSecondary(), leftArmLift: bits & 64 ? 0.36 : -0.36,
        rightArmLift: bits & 128 ? 0.36 : -0.36, breathingScale: 0.012 },
    };
    const bounds = project(COMPACT_LAYOUT, pose);
    union.left = Math.min(union.left, bounds.left); union.right = Math.max(union.right, bounds.right);
    union.top = Math.min(union.top, bounds.top); union.bottom = Math.max(union.bottom, bounds.bottom);
    assert.ok(bounds.left >= 6 && bounds.right <= 210 && bounds.top >= 6 && bounds.bottom <= 218, JSON.stringify(bounds));
  }
  for (const name of ['left-arm', 'right-arm', 'antenna', 'body'] as const) {
    const bounds = project(COMPACT_LAYOUT, { ...neutral, rigProbe: { name, startedAt: 0 } });
    assert.ok(bounds.left >= 6 && bounds.right <= 210 && bounds.top >= 6 && bounds.bottom <= 218);
  }
  t.diagnostic(`Calculated conservative mesh envelope: ${JSON.stringify(union)}. Arm input coverage is checked against real cue samples separately.`);
});

test('wake overshoot, sleep blend and reduced-motion samples fit and retain arm targets', () => {
  const waking = reduceBehavior(initialBehavior(0), { type: 'WAKE' }, 0);
  const sleeping = reduceBehavior(stepBehavior(waking, 700, false), { type: 'USER_SLEEP' }, 1000);
  for (const state of [waking, sleeping]) for (const age of [0, 90, 180, 320, 390, 600, 700, 800]) {
    const now = state.since + age;
    const level = alertness(state, now);
    for (const reduced of [false, true]) {
      const secondary = restSecondary();
      secondarySampleInto(secondary, level > 0 ? 'IDLE' : 'SLEEPING', now, 'none', -1, level, reduced, -1);
      const pose = presentCharacter({ ambient: ambientPose(now), alertness: level,
        wakeBounce: wakeBounce(state, now), gazeYaw: 0.38, gazePitch: 0.2 });
      const bounds = project(COMPACT_LAYOUT, { ...pose, secondary }, true, true);
      assert.ok(bounds.left >= 6 && bounds.right <= 210 && bounds.top >= 6 && bounds.bottom <= 218);
    }
  }
});

test('compact body/arms capture while corners and empty top/bottom regions pass through', () => {
  for (const point of [[108, 112], [108, 58], [176, 147], [40, 147]]) {
    assert.equal(decision(...point as [number, number]).mode, 'interactive');
  }
  for (const point of [[0, 0], [215, 0], [0, 223], [215, 223], [108, 57], [4, 112], [212, 112], [108, 200]]) {
    assert.equal(decision(...point as [number, number]).mode, 'passthrough', String(point));
  }
  const arm = decision(176, 147);
  const left = decision(215, 223, 1016, arm.state);
  assert.equal(left.mode, 'passthrough');
  assert.equal(decision(176, 147, 1032, left.state).mode, 'interactive');
  assert.equal(decision(176, 147, 1000, arm.state, true, false, 1251).mode, 'passthrough');
  assert.equal(decision(176, 147, 1000, arm.state, false, true).mode, 'passthrough');
  const recovered = decision(0, 0, 1000, arm.state, true, true);
  assert.equal(recovered.mode, 'interactive');
  assert.equal(decision(0, 0, 1016, recovered.state).mode, 'passthrough');
  assert.equal(armProxyHit({ x: NaN, y: 112 }, 216, 224), false);
});

test('badge stays readable, inside compact bounds, independent of body/arm proxies', () => {
  assert.deepEqual(chatBadgeBoundsDip(), { x: 172, y: 74, width: 36, height: 36 });
  for (const point of [[190, 92], [208, 92], [190, 74]]) {
    const [x, y] = point;
    assert.equal(chatTriggerHit(x!, y!), true);
    assert.equal(decision(x!, y!).mode, 'passthrough');
    assert.equal(withChatTrigger({ mode: 'passthrough', reason: 'outside-target' }, x!, y!, true).mode, 'interactive');
    assert.equal(withChatTrigger({ mode: 'passthrough', reason: 'outside-target' }, x!, y!, false).mode, 'passthrough');
  }
  assert.equal(chatTriggerHit(215, 223), false);
});

test('compact Home/chat/trail and live travel footprint respect workArea and negative origins', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  const home = placeOverlay(work);
  assert.deepEqual(home, { x: 1688, y: 800, width: 216, height: 224 });
  assert.deepEqual(placeChat(home, work), { x: 1296, y: 504, width: 380, height: 520 });
  assert.deepEqual(clampWindow({ ...home, x: 9999, y: 9999 }, work), { x: 1704, y: 816, width: 216, height: 224 });
  const returning = requestHome(createTravel({ ...home, x: 1568 }, home), 1000, work);
  assert.equal(returning.durationMs, 750);
  assert.equal(stepTravel(returning, 1375, work, null).x, 1628);
  assert.equal(stepTravel(returning, 1750, work, null).x, 1688);
  assert.equal(stepTravel(returning, 1750, work, null).phase, 'idle');
  for (const [vx, vy, expected] of [
    [20, 0, { x: 1734, y: 912 }], [-20, 0, { x: 1858, y: 912 }],
    [0, 20, { x: 1796, y: 850 }], [0, -20, { x: 1796, y: 974 }],
  ] as const) assert.deepEqual(trailingPoint(home, vx, vy), expected);
  const negative = { x: -1920, y: 40, width: 1920, height: 1040 };
  assert.deepEqual(placeOverlay(negative), { x: -232, y: 840, width: 216, height: 224 });
  assert.deepEqual(placeChat(placeOverlay(negative), negative), { x: -624, y: 544, width: 380, height: 520 });
  for (const scaleFactor of [1, 1.25, 1.5, 2]) assert.deepEqual(workAreaDip({ workArea: negative, scaleFactor }), negative);
});

test('DPR refresh reuses the existing render loop without scaling input DIP or adding timers', () => {
  assert.deepEqual(canvasBitmapSize(216, 224, 1.5), { width: 324, height: 336 });
  assert.deepEqual(canvasBitmapSize(216, 224, 2), { width: 432, height: 448 });
  const scene = read('src/renderer/avatar/createScene.ts');
  const frame = scene.slice(scene.indexOf('const pump ='), scene.indexOf('const attachLoop ='));
  assert.match(frame, /renderer\.getPixelRatio\(\) !== Math\.min\(window\.devicePixelRatio \|\| 1, MAX_PIXEL_RATIO\)/);
  assert.ok(frame.indexOf('resize();') < frame.indexOf('renderer.render('));
  assert.doesNotMatch(scene, /setInterval/);
  assert.equal((scene.match(/window\.setTimeout/g) ?? []).length, 1);
  assert.match(scene, /window\.setTimeout\(pump, SLEEP_FRAME_MS\)/);
});

test('compact mode retains lifecycle, existing window ownership and secure main-owned input', () => {
  assert.deepEqual(BEHAVIOR_PHASES, ['SLEEPING', 'WAKING', 'IDLE', 'TRACKING', 'RETURNING_TO_SLEEP']);
  for (const file of ['overlayWindow.ts', 'chatWindow.ts', 'trailWindow.ts']) {
    assert.equal((read('src/main/' + file).match(/new BrowserWindow\(/g) ?? []).length, 1);
  }
  assert.equal((read('src/renderer/avatar/createScene.ts').match(/new WebGLRenderer\(/g) ?? []).length, 1);
  const preload = read('src/preload/preload.ts');
  assert.doesNotMatch(preload, /armProxy|companionLayout|setIgnoreMouseEvents/);
  assert.match(read('src/main/overlayWindow.ts'), /observation\.onArm === true/);
  assert.match(read('scripts/smoke.mjs'), /!webgl \|\| webglError/);
  assert.match(read('src/main/main.ts'), /verifyWebGL: smoke/);
  assert.match(read('src/shared/companionLayout.ts'), /COMPANION_LAYOUT: CompanionLayout = COMPACT_LAYOUT/);
});
