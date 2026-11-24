import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { armProxyHit, orbGeometry } from './clickThrough.ts';
import { COMPANION_LAYOUT } from './companionLayout.ts';
import { dockingGeometry, placeDockableHome } from './dockingGeometry.ts';
import { homeHit } from './homeGeometry.ts';
import { chatTriggerHit } from './chatTrigger.ts';
import { SCREEN_ASK_CENTER_X, SCREEN_ASK_CENTER_Y, SCREEN_ASK_HIT_RADIUS_DIP, SCREEN_ASK_RADIUS_DIP, screenAskBoundsDip, screenAskHit, screenAskHitBoundsDip, screenAskVisible, withScreenAskTrigger } from './screenAskTrigger.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('screen ask sits opposite chat, outside the body and the arms', () => {
  const bounds = screenAskBoundsDip();
  assert.deepEqual(bounds, { x: 8, y: 74, width: 36, height: 36 });
  assert.equal(screenAskHit(SCREEN_ASK_CENTER_X, SCREEN_ASK_CENTER_Y), true);
  assert.equal(screenAskHit(bounds.x, bounds.y), true);
  assert.ok(SCREEN_ASK_HIT_RADIUS_DIP > SCREEN_ASK_RADIUS_DIP);
  const hit = screenAskHitBoundsDip();
  assert.ok(hit.width > bounds.width && hit.height > bounds.height);
  const body = orbGeometry(COMPANION_LAYOUT.windowDip.width, COMPANION_LAYOUT.windowDip.height);
  const nearest = Math.hypot(SCREEN_ASK_CENTER_X - body.centerX, SCREEN_ASK_CENTER_Y - body.centerY);
  assert.ok(nearest > body.captureRadius + SCREEN_ASK_HIT_RADIUS_DIP);
  assert.equal(screenAskHit(COMPANION_LAYOUT.chatBadgeDip.centerX, COMPANION_LAYOUT.chatBadgeDip.centerY), false);
  assert.equal(chatTriggerHit(SCREEN_ASK_CENTER_X, SCREEN_ASK_CENTER_Y), false);
  const geometry = orbGeometry(COMPANION_LAYOUT.windowDip.width, COMPANION_LAYOUT.windowDip.height);
  const distance = Math.hypot(SCREEN_ASK_CENTER_X - geometry.centerX, SCREEN_ASK_CENTER_Y - geometry.centerY);
  assert.ok(distance > geometry.captureRadius + 18);
  assert.equal(armProxyHit({ x: SCREEN_ASK_CENTER_X, y: SCREEN_ASK_CENTER_Y }, COMPANION_LAYOUT.windowDip.width, COMPANION_LAYOUT.windowDip.height), false);
});

test('the screen ask hit is awake-only and never replaces an existing interactive target', () => {
  const passthrough = { mode: 'passthrough' as const, reason: 'outside-target' };
  assert.equal(screenAskVisible('SLEEPING'), false);
  assert.equal(screenAskVisible('RETURNING_TO_SLEEP'), false);
  assert.equal(screenAskVisible('IDLE'), true);
  assert.equal(withScreenAskTrigger(passthrough, SCREEN_ASK_CENTER_X, SCREEN_ASK_CENTER_Y, false).mode, 'passthrough');
  const armed = withScreenAskTrigger(passthrough, SCREEN_ASK_CENTER_X, SCREEN_ASK_CENTER_Y, true);
  assert.equal(armed.mode, 'interactive');
  assert.equal(armed.reason, 'screen-ask');
  assert.equal(withScreenAskTrigger({ mode: 'interactive', reason: 'inside-target' }, SCREEN_ASK_CENTER_X, SCREEN_ASK_CENTER_Y, true).reason, 'inside-target');
});

test('the robot page keeps body click for wake and chat, and adds a separate screen control', () => {
  const renderer = readFileSync(path.join(root, 'src/renderer/main.ts'), 'utf8');
  const html = readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const preload = readFileSync(path.join(root, 'src/preload/preload.ts'), 'utf8');
  const ask = renderer.match(/function bindScreenAsk[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(html, /id="screen-ask"/);
  assert.match(renderer, /notifyCircleClick\(\)/);
  assert.match(renderer, /requestOpenChat\(\)/);
  assert.equal(ask.includes('notifyCircleClick'), false);
  assert.equal(ask.includes('requestOpenChat'), false);
  assert.match(ask, /requestSelectScreen\(\)/);
  assert.match(renderer, /screenAsk\.hidden = !show \|\| !screenAskVisible\(currentPhase\)/);
  assert.equal(renderer.includes('screenAsk.hidden = !import.meta.env.DEV'), false);
  assert.match(preload, /overlay:select-screen/);
  assert.equal(preload.includes('setIgnoreMouseEvents'), false);
});

test('docked chat and screen-ask stay off the house, and the house wins the pointer', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const platform = placeDockableHome(area);
  assert.ok(platform);
  const target = dockingGeometry(platform, area)!.target;
  const chat = COMPANION_LAYOUT.chatBadgeDip;
  const circles = [
    { x: chat.centerX, y: chat.centerY, radius: chat.radius },
    { x: SCREEN_ASK_CENTER_X, y: SCREEN_ASK_CENTER_Y, radius: SCREEN_ASK_HIT_RADIUS_DIP },
  ];
  for (const circle of circles) {
    for (let step = 0; step < 8; step += 1) {
      const angle = (step / 8) * Math.PI * 2;
      const localX = circle.x + Math.cos(angle) * circle.radius;
      const localY = circle.y + Math.sin(angle) * circle.radius;
      assert.equal(homeHit(target.x + localX - platform.x, target.y + localY - platform.y), false);
    }
  }
  const ring = homeHit(target.x + 108 - platform.x, target.y + 162 - platform.y);
  assert.equal(ring, true);
  const overlay = readFileSync(path.join(root, 'src/main/overlayWindow.ts'), 'utf8');
  assert.match(overlay, /reason: 'home-platform'/);
  assert.match(overlay, /homeHit\(cursor\.x - platform\.x, cursor\.y - platform\.y\)/);
});
