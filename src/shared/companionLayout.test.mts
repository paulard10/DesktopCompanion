import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMPANION_LAYOUT, COMPACT_LAYOUT, LEGACY_LAYOUT, chatBadgeBoundsDip } from './companionLayout.ts';
import { OVERLAY_WIDTH_DIP, OVERLAY_HEIGHT_DIP, OVERLAY_MARGIN_DIP, placeOverlay } from './placement.ts';
import { orbGeometry, windowLocalPoint, observeCircle, decidePointerMode, INITIAL_POINTER_STATE } from './clickThrough.ts';
import { chatTriggerHit } from './chatTrigger.ts';
import { placeChat } from './chatPlacement.ts';
import { cameraDistanceForBody, BODY_RADIUS_WORLD, CAMERA_FOV_DEGREES } from './robotFrame.ts';
import { trailingPoint, trailLocal, trailWorkArea, canvasBitmapSize } from './neonTrail.ts';
import { clampWindow, createTravel, nudgeTarget, requestHome, stepTravel, workAreaDip } from './desktopMovement.ts';
import { applyChatBadgeLayout } from '../renderer/chatBadgeLayout.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const work = { x: 0, y: 0, width: 1920, height: 1040 };
const legacyHome = { x: 1604, y: 624, width: 300, height: 400 };

test('the rollback preset preserves each independent legacy DIP role', () => {
  assert.deepEqual(LEGACY_LAYOUT, {
    windowDip: { width: 300, height: 400 },
    placementMarginDip: 16,
    cameraFramingDip: { bodyDiameter: 160 },
    bodyProxyDip: { diameter: 160 },
    chatBadgeDip: { centerX: 262, centerY: 332, radius: 18 },
    trailAnchorDip: { bodyRadius: 80 },
    armProxyDip: null,
  });
  assert.equal(COMPANION_LAYOUT, COMPACT_LAYOUT);
  assert.equal(OVERLAY_WIDTH_DIP, 216);
  assert.equal(OVERLAY_HEIGHT_DIP, 224);
  assert.equal(OVERLAY_MARGIN_DIP, 16);
  assert.deepEqual(placeOverlay(work, 16, LEGACY_LAYOUT), legacyHome);
});

test('body projection and interaction remain the legacy camera and circle', () => {
  assert.deepEqual(orbGeometry(300, 400, LEGACY_LAYOUT), {
    centerX: 150, centerY: 200, radius: 80, captureRadius: 80,
  });
  assert.equal(BODY_RADIUS_WORLD, 1);
  assert.equal(CAMERA_FOV_DEGREES, 28);
  const cameraZ = cameraDistanceForBody({
    viewportHeightPx: 400,
    bodyDiameterPx: LEGACY_LAYOUT.cameraFramingDip.bodyDiameter,
    fovDegrees: CAMERA_FOV_DEGREES,
    bodyRadiusWorld: BODY_RADIUS_WORLD,
  });
  assert.ok(Math.abs(cameraZ - 10.026952333839612) < 1e-12);
  for (const [local, expected] of [
    [{ x: 150, y: 200 }, 'interactive'],
    [{ x: 230, y: 200 }, 'interactive'],
    [{ x: 231, y: 200 }, 'passthrough'],
    [{ x: 0, y: 0 }, 'passthrough'],
    [{ x: 299, y: 0 }, 'passthrough'],
    [{ x: 0, y: 399 }, 'passthrough'],
    [{ x: 299, y: 399 }, 'passthrough'],
  ] as const) {
    const observation = observeCircle({
      cursor: { x: legacyHome.x + local.x, y: legacyHome.y + local.y },
      windowOrigin: legacyHome, windowWidth: 300, windowHeight: 400, sampleAt: 100,
    }, LEGACY_LAYOUT);
    assert.equal(decidePointerMode(observation, INITIAL_POINTER_STATE,
      { visible: true, recoveryCapture: false, now: 100 }).mode, expected);
  }
});

test('badge bounds follow compact layout while legacy box and readable chat are preserved', () => {
  assert.deepEqual(chatBadgeBoundsDip(LEGACY_LAYOUT), { x: 244, y: 314, width: 36, height: 36 });
  assert.deepEqual(chatBadgeBoundsDip(), { x: 172, y: 74, width: 36, height: 36 });
  const style = { left: '', top: '', width: '', height: '' };
  applyChatBadgeLayout(style);
  assert.deepEqual(style, { left: '172px', top: '74px', width: '36px', height: '36px' });
  assert.equal(chatTriggerHit(190, 92), true);
  assert.equal(chatTriggerHit(208, 92), true);
  assert.equal(chatTriggerHit(209, 92), false);
  assert.equal(chatTriggerHit(172, 74), false); // square CSS corner is not a circular hit
  assert.deepEqual(placeChat(legacyHome, work), { x: 1212, y: 504, width: 380, height: 520 });
  const main = readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');
  assert.ok(main.indexOf('applyChatBadgeLayout(trigger.style)') < main.indexOf('const scene ='));
  assert.match(main, /applyChatBadgeLayout\(trigger\.style\)/);
  const css = readFileSync(path.join(root, 'src/renderer/styles.css'), 'utf8');
  const badgeCss = css.match(/#chat-trigger\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.doesNotMatch(badgeCss, /(?:left|top|width|height)\s*:/); // no second source of placement values
});

test('trail offset remains 80 DIP plus its separate 8 DIP gap in every direction', () => {
  assert.deepEqual(trailingPoint(legacyHome, 20, 0, LEGACY_LAYOUT), { x: 1666, y: 824 });
  assert.deepEqual(trailingPoint(legacyHome, -20, 0, LEGACY_LAYOUT), { x: 1842, y: 824 });
  assert.deepEqual(trailingPoint(legacyHome, 0, 20, LEGACY_LAYOUT), { x: 1754, y: 736 });
  assert.deepEqual(trailingPoint(legacyHome, 0, -20, LEGACY_LAYOUT), { x: 1754, y: 912 });
  const diagonal = trailingPoint(legacyHome, 6, 8, LEGACY_LAYOUT);
  assert.ok(diagonal);
  assert.ok(Math.abs(diagonal.x - 1701.2) < 1e-10);
  assert.ok(Math.abs(diagonal.y - 753.6) < 1e-10);
  assert.equal(trailingPoint(legacyHome, 0, 0), null);
});

test('travel uses live bounds and preserves clamping, easing and Return Home', () => {
  assert.deepEqual(clampWindow({ x: 9999, y: 9999, width: 300, height: 400 }, work),
    { x: 1620, y: 640, width: 300, height: 400 });
  assert.deepEqual(clampWindow({ x: 9999, y: 9999, width: 280, height: 360 }, work),
    { x: 1640, y: 680, width: 280, height: 360 }); // no new nominal-size travel footprint
  const away = createTravel({ x: 1484, y: 624, width: 300, height: 400 }, legacyHome);
  assert.deepEqual(nudgeTarget(away, 'left', work), { x: 1364, y: 624 });
  const returning = requestHome(away, 1000, work);
  assert.equal(returning.durationMs, 750);
  assert.deepEqual({ x: returning.toX, y: returning.toY }, { x: 1604, y: 624 });
  const mid = stepTravel(returning, 1375, work, null);
  assert.deepEqual({ x: mid.x, y: mid.y }, { x: 1544, y: 624 });
  const done = stepTravel(returning, 1750, work, null);
  assert.equal(done.phase, 'idle');
  assert.deepEqual({ x: done.x, y: done.y }, { x: 1604, y: 624 });
  assert.deepEqual(placeOverlay({ x: 10, y: 20, width: 200, height: 150 }, 16, LEGACY_LAYOUT),
    { x: 10, y: 20, width: 200, height: 150 });
});

test('negative-monitor DIP transforms and bitmap scaling stay separate', () => {
  const negativeWork = { x: -1920, y: 40, width: 1920, height: 1040 };
  for (const scaleFactor of [1, 1.25, 1.5, 2]) {
    assert.deepEqual(workAreaDip({ workArea: negativeWork, scaleFactor }), negativeWork);
    assert.deepEqual(trailWorkArea({ workArea: negativeWork, scaleFactor }), negativeWork);
  }
  const parked = placeOverlay(negativeWork, 16, LEGACY_LAYOUT);
  assert.deepEqual(parked, { x: -316, y: 664, width: 300, height: 400 });
  assert.deepEqual(windowLocalPoint({ x: -166, y: 864 }, parked), { x: 150, y: 200 });
  assert.deepEqual(trailLocal(-166, 864, -1920, 40), { x: 1754, y: 824 });
  assert.deepEqual(placeChat(parked, negativeWork), { x: -708, y: 544, width: 380, height: 520 });
  assert.deepEqual(canvasBitmapSize(300, 400, 1.5), { width: 450, height: 600 });
  assert.deepEqual(canvasBitmapSize(300, 400, 2), { width: 600, height: 800 });
});

test('layout has no platform imports or globals and the shared runtime graph is acyclic', () => {
  // Node records the real imports after TypeScript emits CommonJS. This also
  // catches cycles through re-exports without relying on a compiler parser API.
  const require = createRequire(import.meta.url);
  const sharedOutput = path.join(root, 'dist/shared');
  const layoutSource = readFileSync(path.join(here, 'companionLayout.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
  assert.doesNotMatch(layoutSource, /\b(?:import|require|window|document|process|BrowserWindow)\b/);
  for (const file of readdirSync(sharedOutput).filter(name => name.endsWith('.js'))) {
    require(path.join(sharedOutput, file));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(file: string): void {
    assert.equal(visiting.has(file), false, 'shared import cycle at ' + file);
    if (visited.has(file)) return;
    visiting.add(file);
    const loaded = require.cache[file];
    assert.ok(loaded, 'compiled shared module must have loaded: ' + file);
    for (const child of loaded.children) {
      if (path.dirname(child.filename) === sharedOutput) visit(child.filename);
    }
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of readdirSync(sharedOutput).filter(name => name.endsWith('.js'))) visit(path.join(sharedOutput, file));
  const layoutFile = path.join(sharedOutput, 'companionLayout.js');
  assert.ok(visited.has(layoutFile));
  assert.equal(require.cache[layoutFile]?.children.length, 0);
});

test('compiled production consumers resolve the same layout without source TS imports', () => {
  const require = createRequire(import.meta.url);
  const compiled = require('../../dist/shared/companionLayout.js');
  const placement = require('../../dist/shared/placement.js');
  const pointer = require('../../dist/shared/clickThrough.js');
  const badge = require('../../dist/shared/chatTrigger.js');
  const trail = require('../../dist/shared/neonTrail.js');
  assert.deepEqual(compiled.COMPANION_LAYOUT, COMPANION_LAYOUT);
  assert.deepEqual(placement.placeOverlay(work), { x: 1688, y: 800, width: 216, height: 224 });
  assert.deepEqual(pointer.orbGeometry(300, 400), orbGeometry(300, 400));
  assert.equal(badge.chatTriggerHit(190, 92), true);
  assert.deepEqual(trail.trailingPoint(legacyHome, 20, 0), { x: 1692, y: 824 });
});

