import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy } from './csp.ts';
import {
  NUDGE_DIP,
  clampWindow,
  createTravel,
  nudgeTarget,
  requestHome,
  travelBlock,
} from './desktopMovement.ts';
import { createTrailState, stepTrail } from './neonTrail.ts';
import { createOverlayWebPreferences } from './overlayOptions.ts';
import { ARM_LIFT_MAX, BODY_TILT_MAX, SECONDARY_GESTURES } from './secondaryMotion.ts';
import {
  createWanderState,
  disableWander,
  enableWander,
  endWanderSession,
  planWander,
  type WanderSnapshot,
} from './wander.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');

const work = { x: 0, y: 0, width: 1920, height: 1040 };
const windowRect = { x: 400, y: 300, width: 300, height: 400 };

function snap(patch: Partial<WanderSnapshot> = {}): WanderSnapshot {
  return {
    awake: true,
    asleep: false,
    tracking: false,
    blocked: false,
    visible: true,
    travelPhase: 'idle',
    workArea: work,
    window: windowRect,
    home: { x: 800, y: 400 },
    displayKey: 'primary',
    ...patch,
  };
}

test('production tray exposes movement, wandering, and the neon trail', () => {
  const tray = read('src/main/tray.ts');
  const gate = tray.indexOf('options.devMovement');
  assert.ok(gate > 0);
  const product = tray.slice(0, gate);
  const diagnostics = tray.slice(gate);
  for (const label of ['Move Up', 'Move Down', 'Move Left', 'Move Right', 'Return Home', 'Stop movement']) {
    assert.match(product, new RegExp(`label: '${label}'`));
  }
  assert.match(product, /label: 'Movement'/);
  assert.match(product, /submenu:/);
  assert.match(product, /label: 'Wandering'/);
  assert.match(product, /label: 'Neon Trail'/);
  assert.match(product, /type: 'checkbox'/);
  assert.match(product, /checked: options\.isWandering\(\)/);
  assert.match(product, /checked: options\.isTrail\(\)/);
  assert.match(product, /refresh\(\)/);
  assert.equal(product.includes('Test window move'), false);
  assert.equal(product.includes('Show Trail Marker'), false);
  assert.equal(product.includes('Reset Trail'), false);
  assert.equal(product.includes('Test body tilt'), false);
  assert.equal(product.includes('Dev Compare'), false);
  assert.match(diagnostics, /Test window move/);
  assert.match(diagnostics, /Reset Trail/);
  assert.match(diagnostics, /Show Trail Marker/);
  assert.match(diagnostics, /options\.devMarker/);
});

test('wandering and the neon trail default off and wait for a user command', () => {
  assert.equal(createWanderState().enabled, false);
  assert.equal(createWanderState().nextAt, null);
  assert.equal(createTrailState().particles.length, 0);
  const main = read('src/main/main.ts');
  const start = read('scripts/start.mjs');
  assert.match(main, /let trailOn = false/);
  assert.match(main, /let wander: WanderState = createWanderState\(\)/);
  assert.equal(start.includes('DESKTOP_COMPANION_MOVE'), false);
  assert.match(start, /delete env\.DESKTOP_COMPANION_DEV/);
  const beforeHandlers = main.slice(0, main.indexOf('onMove: (direction)'));
  assert.equal(beforeHandlers.includes('enableWander('), false);
  const gated = beforeHandlers.indexOf('if (savedPreferences.neonTrailEnabled)');
  const restored = beforeHandlers.indexOf('trailWindow.setEnabled(true)');
  assert.ok(gated >= 0 && restored > gated);
  assert.equal(beforeHandlers.slice(0, gated).includes('setEnabled(true)'), false);
  assert.equal(main.includes('DESKTOP_COMPANION_MOVE'), false);
  const move = main.slice(main.indexOf('onMove: (direction)'), main.indexOf('onWander:'));
  assert.equal(move.includes('enableWander'), false);
  assert.equal(move.includes('setEnabled'), false);
  assert.equal(move.includes('DESKTOP_COMPANION_DEV'), false);
});

test('movement and return home stay inside the work area', () => {
  const travel = createTravel(windowRect, { x: 800, y: 400 });
  const nudged = nudgeTarget(travel, 'right', work, NUDGE_DIP);
  assert.ok(nudged.x + windowRect.width <= work.x + work.width);
  assert.ok(nudged.y >= work.y);
  const edge = createTravel({ x: 1800, y: 900, width: 300, height: 400 }, { x: 100, y: 100 });
  const clamped = nudgeTarget(edge, 'right', work, NUDGE_DIP);
  assert.equal(clamped.x, work.width - 300);
  assert.equal(clamped.y, work.height - 400);
  const home = requestHome(edge, 1_000, work);
  assert.equal(home.toX, 100);
  assert.equal(home.toY, 100);
  const outside = clampWindow({ x: -50, y: 2_000, width: 300, height: 400 }, work);
  assert.equal(outside.x, 0);
  assert.equal(outside.y, work.height - 400);
});

test('chat, voice, and busy still block travel, and sleep ends the wander session', () => {
  assert.equal(travelBlock({ chatOpen: true, listening: false, speaking: false, generating: false }), 'chat');
  assert.equal(travelBlock({ chatOpen: false, listening: true, speaking: false, generating: false }), 'voice');
  assert.equal(travelBlock({ chatOpen: false, listening: false, speaking: true, generating: false }), 'voice');
  assert.equal(travelBlock({ chatOpen: false, listening: false, speaking: false, generating: true }), 'busy');
  assert.equal(travelBlock({ chatOpen: false, listening: false, speaking: false, generating: false }), null);
  const enabled = enableWander(createWanderState(3), 1_000, snap());
  const asleep = endWanderSession(enabled.state, 'idle');
  assert.equal(asleep.state.enabled, true);
  assert.equal(asleep.scheduleAt, null);
  assert.equal(asleep.state.exploreUntil, null);
  assert.equal(asleep.command, null);
  const planned = planWander(asleep.state, snap({ asleep: true, awake: false }), 2_000);
  assert.equal(planned.command, null);
  assert.equal(planned.scheduleAt, null);
  const main = read('src/main/main.ts');
  const sleep = main.slice(main.indexOf('onSleep:'), main.indexOf('onOpenChat:'));
  assert.match(sleep, /endWanderSession/);
  assert.match(sleep, /overlay\?\.sleep\(\)/);
  assert.equal(sleep.includes('.wake('), false);
});

test('wandering and the neon trail enable and disable independently', () => {
  const enabled = enableWander(createWanderState(9), 5_000, snap());
  assert.equal(enabled.state.enabled, true);
  assert.ok(enabled.scheduleAt != null);
  const disabled = disableWander(enabled.state, 'idle');
  assert.equal(disabled.state.enabled, false);
  assert.equal(disabled.scheduleAt, null);
  assert.equal(disabled.state.nextAt, null);
  const again = disableWander(disabled.state, 'idle');
  assert.equal(again.state.enabled, false);
  const main = read('src/main/main.ts');
  const wander = main.slice(main.indexOf('onWander: (enabled)'), main.indexOf('onTrail: (action)'));
  const trail = main.slice(main.indexOf('onTrail: (action)'), main.indexOf('onQuit:'));
  assert.match(wander, /disableWander/);
  assert.match(wander, /enableWander/);
  assert.equal(wander.includes('setEnabled'), false);
  assert.equal(wander.includes('trailOn'), false);
  assert.match(trail, /neonTrailEnabled: false/);
  assert.match(trail, /setEnabled\(trailOn\)/);
  assert.match(trail, /neonTrailEnabled: true/);
  assert.equal(trail.includes('enableWander'), false);
  assert.equal(trail.includes('disableWander'), false);
  const idle = stepTrail(createTrailState(), {
    window: windowRect,
    workArea: work,
    travelPhase: 'idle',
    asleep: false,
    chatOpen: false,
    forceClear: false,
  }, 1_000);
  assert.equal(idle.spawned.length, 0);
  const sleeping = stepTrail(createTrailState(), {
    window: windowRect,
    workArea: work,
    travelPhase: 'moving',
    asleep: true,
    chatOpen: false,
    forceClear: false,
  }, 1_000);
  assert.equal(sleeping.hold, 'asleep');
  assert.equal(sleeping.state.particles.length, 0);
});

test('quit clears wander timers and the trail, and development tools stay gated', () => {
  const main = read('src/main/main.ts');
  const shutdown = main.slice(main.indexOf('async function shutdown'), main.indexOf("app.on('second-instance'"));
  assert.match(shutdown, /clearWanderTimer\(\)/);
  assert.match(shutdown, /clearLeaseTimer\(\)/);
  const timerAt = shutdown.indexOf('clearWanderTimer()');
  const trailAt = shutdown.indexOf('trail?.destroy()');
  const quitAt = shutdown.indexOf('app.quit()');
  assert.ok(timerAt >= 0 && trailAt > timerAt && quitAt > trailAt);
  const chat = read('src/renderer/chat.ts');
  assert.equal(chat.includes('Test body tilt'), false);
  assert.equal(chat.includes('Test window move'), false);
  assert.equal(chat.includes('previewPresence'), false);
  const run = main.slice(main.indexOf('const runWander'), main.indexOf('const runMoveTest'));
  assert.equal(run.includes('dev'), false);
  const probe = main.slice(main.indexOf('const runMoveTest'), main.indexOf('const noteManualMove'));
  assert.match(probe, /if \(!dev\)/);
  assert.equal(read('src/preload/preload.ts').includes('ipcRenderer.invoke'), false);
  assert.equal(read('src/preload/trailPreload.ts').includes('ipcRenderer.invoke'), false);
  const policy = contentSecurityPolicy(false);
  assert.equal(policy, "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'");
  const preferences = createOverlayWebPreferences('C:\\app\\preload.js', false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.webSecurity, true);
});

test('movement does not add a renderer, a network call, or a second WebGL context', () => {
  const scene = read('src/renderer/avatar/createScene.ts');
  assert.equal((scene.match(/new WebGLRenderer\(/g) ?? []).length, 1);
  const sources = ['src/main/main.ts', 'src/main/tray.ts', 'src/shared/wander.ts', 'src/shared/neonTrail.ts', 'src/main/trailWindow.ts'];
  for (const relative of sources) {
    const source = read(relative);
    assert.equal(source.includes('new WebGLRenderer'), false);
    assert.equal(source.includes('getUserMedia'), false);
    assert.equal(source.includes('fetch('), false);
  }
  assert.match(read('src/renderer/trail.ts'), /getContext\('2d'/);
  assert.match(read('src/renderer/avatar/proceduralRobot.ts'), /TorusGeometry\(0\.15, 0\.06/);
  assert.equal(BODY_TILT_MAX, 0.08);
  assert.equal(ARM_LIFT_MAX, 0.36);
  assert.deepEqual(SECONDARY_GESTURES, ['none', 'nod', 'bounce', 'concern', 'wave']);
  const wander = read('src/shared/wander.ts');
  assert.equal(wander.includes('neonTrail'), false);
  assert.equal(wander.includes('.wake'), false);
  assert.equal(read('src/shared/neonTrail.ts').includes('wander'), false);
});
