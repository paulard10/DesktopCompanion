import assert from 'node:assert/strict';
import test from 'node:test';
import { DOCK, arrived, contains, dockingGeometry, placeDockableHome, projectedBodyBottomDip } from './dockingGeometry.ts';
import { HOME } from './homeGeometry.ts';
import { workAreaDip } from './desktopMovement.ts';

const area = { x: 0, y: 0, width: 1920, height: 1040 };

test('joint placement reserves the whole compact avatar without resizing or changing the platform artwork', () => {
  const home = placeDockableHome(area)!;
  assert.deepEqual(home, { x: 1756, y: 932, width: 112, height: 88 });
  const geometry = dockingGeometry(home, area)!;
  assert.deepEqual(geometry.target, { x: 1704, y: 816, width: 216, height: 224 });
  assert.ok(contains(area, home)); assert.ok(contains(area, geometry.target));
  assert.equal(geometry.target.x + 108, home.x + HOME.surface.cx);
  const overlap = geometry.target.y + projectedBodyBottomDip() - (home.y + HOME.surface.cy);
  assert.ok(overlap >= DOCK.overlapDip - 0.5 && overlap <= DOCK.overlapDip + 0.5);
  assert.ok(geometry.target.y + 112 < home.y + HOME.surface.cy, 'body center is above the black surface');
});

test('negative desktop coordinates preserve centering, body support and an interior departure', () => {
  const negative = { x: -1920, y: 40, width: 1920, height: 1040 };
  const home = placeDockableHome(negative)!;
  assert.deepEqual(home, { x: -164, y: 972, width: 112, height: 88 });
  const geometry = dockingGeometry(home, negative)!;
  assert.deepEqual(geometry.target, { x: -216, y: 856, width: 216, height: 224 });
  assert.deepEqual(geometry.departure, { x: -336, y: 808, width: 216, height: 224 });
});

test('DIP geometry does not multiply Windows scale factors into desktop positions', () => {
  for (const scaleFactor of [1, 1.25, 1.5, 2]) {
    const dip = workAreaDip({ workArea: area, scaleFactor })!;
    assert.deepEqual(placeDockableHome(dip), placeDockableHome(area));
  }
});

test('unsafe old corner position is rejected instead of silently clamping the robot off its platform', () => {
  assert.equal(dockingGeometry({ x: 1792, y: 936, width: 112, height: 88 }, area), null);
  for (const invalid of [null, { x: 0, y: 0, width: 100, height: 70 },
    { ...area, x: NaN }, { ...area, width: Infinity }]) assert.equal(placeDockableHome(invalid), null);
  assert.equal(dockingGeometry({ ...placeDockableHome(area)!, width: 113 }, area), null);
});

test('departure stays in the workArea and moves substantially toward its interior', () => {
  for (const area of [{ x: 0, y: 0, width: 1920, height: 1040 },
    { x: -900, y: -500, width: 800, height: 600 }, { x: 12, y: 28, width: 400, height: 320 }]) {
    const geometry = dockingGeometry(placeDockableHome(area), area)!;
    assert.ok(geometry); assert.ok(contains(area, geometry.departure));
    assert.ok(Math.hypot(geometry.departure.x - geometry.target.x, geometry.departure.y - geometry.target.y) >= 24);
    assert.ok(geometry.departure.x < geometry.target.x);
  }
});

test('arrival requires actual matching native size and position within one DIP', () => {
  const target = dockingGeometry(placeDockableHome(area), area)!.target;
  assert.equal(arrived(target, target), true);
  assert.equal(arrived({ ...target, x: target.x + 1 }, target), true);
  assert.equal(arrived({ ...target, x: target.x + 1.01 }, target), false);
  assert.equal(arrived({ ...target, width: target.width - 1 }, target), false);
  assert.equal(arrived({ ...target, y: NaN }, target), false);
});
