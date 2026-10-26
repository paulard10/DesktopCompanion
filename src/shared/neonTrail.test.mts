import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { workAreaDip } from './desktopMovement.ts';
import { IpcChannels } from './ipc.ts';
import {
  TRAIL_HITCH_DIP,
  TRAIL_MAX_PARTICLES,
  TRAIL_MAX_SPAWNS_PER_SAMPLE,
  TRAIL_SPACING_DIP,
  ageTrail,
  createTrailState,
  canvasBitmapSize,
  particleVisual,
  readTrailFrame,
  readTrailViewport,
  resetTrail,
  setTrailReducedMotion,
  stepTrail,
  trailBounds,
  trailLocal,
  trailPointInside,
  trailWorkArea,
  trailingPoint,
  type TrailSample,
  type TrailState,
} from './neonTrail.ts';
import { isChatRendererUrl, isRobotRendererUrl, isTrailRendererUrl } from './trustedUrl.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const work = { x: 0, y: 0, width: 1920, height: 1000 };

function sample(x: number, y: number, phase: TrailSample['travelPhase'], extra: Partial<TrailSample> = {}): TrailSample {
  return {
    window: { x, y, width: 300, height: 400 },
    workArea: work,
    travelPhase: phase,
    asleep: false,
    chatOpen: false,
    forceClear: false,
    ...extra,
  };
}

function prime(state: TrailState, x = 400, y = 200): TrailState {
  return stepTrail(state, sample(x, y, 'moving'), 1_000).state;
}

test('particles follow traveled distance and never a still or paused robot', () => {
  const start = createTrailState(11);
  const primed = prime(start);
  assert.equal(primed.particles.length, 0);
  assert.equal(start.particles.length, 0);
  const still = stepTrail(primed, sample(400, 200, 'moving'), 5_000);
  assert.equal(still.spawned.length, 0);
  const paused = stepTrail(primed, sample(900, 200, 'paused'), 1_100);
  assert.equal(paused.spawned.length, 0);
  assert.equal(paused.state.particles.length, 0);
  const burst = stepTrail(primed, sample(400 + 40, 200, 'moving'), 1_100);
  assert.equal(burst.spawned.length, TRAIL_MAX_SPAWNS_PER_SAMPLE);
  assert.ok(40 <= TRAIL_HITCH_DIP);
  const hitch = stepTrail(primed, sample(400 + 400, 200, 'moving'), 1_100);
  assert.equal(hitch.spawned.length, 0);
  assert.equal(hitch.state.carryDip, 0);
});

test('the particle cap, lifespan, and fade stay bounded', () => {
  let state = prime(createTrailState(5));
  let now = 2_000;
  for (let step = 0; step < 40; step += 1) {
    now += 10;
    state = stepTrail(state, sample(400 + (step + 1) * TRAIL_SPACING_DIP, 200, 'moving'), now).state;
    assert.ok(state.particles.length <= TRAIL_MAX_PARTICLES);
  }
  assert.equal(state.particles.length, TRAIL_MAX_PARTICLES);
  const particle = state.particles[0];
  assert.ok(particle);
  assert.ok(particle.life >= 500 && particle.life <= 900);
  assert.ok(particle.diameter >= 4 && particle.diameter <= 10);
  const born = particleVisual(particle, particle.born);
  const mid = particleVisual(particle, particle.born + particle.life * 0.5);
  const late = particleVisual(particle, particle.born + particle.life * 0.9);
  assert.ok(born && mid && late);
  assert.equal(born.alpha, 0);
  assert.ok(mid.alpha > 0);
  assert.ok(mid.diameter < particle.diameter);
  assert.ok(late.alpha < mid.alpha);
  assert.equal(particleVisual(particle, particle.born + particle.life), null);
  const aged = ageTrail(state, now + 1_000, work);
  assert.equal(aged.state.particles.length, 0);
  assert.equal(aged.clearView, true);
  assert.equal(aged.bounds, null);
});

test('the trail sits behind the body for every direction', () => {
  const bounds = { x: 500, y: 400, width: 300, height: 400 };
  const centerX = 650;
  const centerY = 600;
  const right = trailingPoint(bounds, 20, 0);
  const left = trailingPoint(bounds, -20, 0);
  const down = trailingPoint(bounds, 0, 20);
  const up = trailingPoint(bounds, 0, -20);
  assert.ok(right && left && down && up);
  assert.equal(right.x, centerX - 88);
  assert.equal(right.y, centerY);
  assert.ok(right.x < centerX && right.y === centerY);
  assert.ok(left.x > centerX && left.y === centerY);
  assert.ok(down.y < centerY && down.x === centerX);
  assert.ok(up.y > centerY && up.x === centerX);
  assert.equal(trailingPoint(bounds, 0, 0), null);
  let state = prime(createTrailState(9), 500, 400);
  const moved = stepTrail(state, sample(532, 400, 'moving'), 1_200);
  const pearl = moved.spawned[0];
  assert.ok(pearl);
  assert.ok(pearl.x < 532 + 150);
  assert.ok(pearl.y > 500 && pearl.y < 700);
});

test('global DIP maps to the trail window, including a negative monitor', () => {
  const local = trailLocal(-1562, 80, -1920, 40);
  assert.deepEqual(local, { x: 358, y: 40 });
  const negative = { x: -1920, y: 40, width: 1600, height: 900 };
  assert.deepEqual(trailWorkArea({ workArea: negative, scaleFactor: 1.5 }), negative);
  assert.deepEqual(trailWorkArea({ workArea: negative, scaleFactor: 2 }), workAreaDip({ workArea: negative, scaleFactor: 2 }));
  assert.equal(trailWorkArea({ workArea: negative, scaleFactor: 0 }), null);
  const window = { x: -1800, y: 40, width: 300, height: 400 };
  const behind = trailingPoint(window, -30, 0);
  assert.ok(behind);
  assert.ok(behind.x > window.x + 150);
  const mapped = trailLocal(behind.x, behind.y, negative.x, negative.y);
  assert.ok(mapped.x > 0 && mapped.y > 0);
});

test('work-area, taskbar, resize, and display changes keep pearls inside one display', () => {
  const low = trailBounds(
    [{ id: 1, x: 100, y: 990, born: 0, life: 800, diameter: 10, driftX: 0, driftY: 8 }],
    work,
  );
  assert.ok(low);
  assert.ok(low.y + low.height <= work.y + work.height);
  assert.equal(
    trailBounds([{ id: 2, x: 100, y: 1200, born: 0, life: 800, diameter: 8, driftX: 0, driftY: 0 }], work),
    null,
  );
  assert.equal(trailPointInside(10, 1001, work), false);
  let state = prime(createTrailState(4), 0, 0);
  const resized = stepTrail(
    state,
    {
      ...sample(24, 0, 'moving'),
      window: { x: 24, y: 0, width: 280, height: 360 },
    },
    1_200,
  );
  const pearl = resized.spawned[0];
  assert.ok(pearl);
  assert.ok(pearl.x < 24 + 140);
  const shifted = stepTrail(resized.state, sample(48, 0, 'moving', { workArea: { x: 0, y: 0, width: 1280, height: 720 } }), 1_300);
  assert.equal(shifted.state.particles.length, 0);
  assert.equal(shifted.clearView, true);
  const lost = stepTrail(primed(createTrailState(2)), sample(420, 200, 'moving', { workArea: null }), 1_300);
  assert.equal(lost.state.particles.length, 0);
});

function primed(state: TrailState): TrailState {
  return prime(state);
}

test('reduced motion, sleep, stop, return home, chat, hide, and quit', () => {
  let state = prime(createTrailState(8));
  state = stepTrail(state, sample(440, 200, 'moving'), 1_200).state;
  assert.ok(state.particles.length > 0);
  const stopped = stepTrail(state, sample(440, 200, 'idle'), 1_250);
  assert.equal(stopped.spawned.length, 0);
  assert.equal(stopped.state.particles.length, state.particles.length);
  const home = stepTrail(stopped.state, sample(472, 200, 'moving'), 1_300);
  assert.ok(home.spawned.length > 0);
  const asleep = stepTrail(home.state, sample(472, 200, 'moving', { asleep: true }), 1_320);
  assert.equal(asleep.state.particles.length, 0);
  assert.equal(asleep.clearView, true);
  const chatting = stepTrail(home.state, sample(472, 200, 'paused', { chatOpen: true }), 1_320);
  assert.equal(chatting.state.particles.length, 0);
  const hidden = stepTrail(home.state, sample(472, 200, 'idle', { forceClear: true }), 1_320);
  assert.equal(hidden.state.particles.length, 0);
  const reduced = setTrailReducedMotion(home.state, true);
  assert.equal(reduced.state.reducedMotion, true);
  assert.equal(reduced.state.particles.length, 0);
  const blocked = stepTrail(reduced.state, sample(560, 200, 'moving'), 1_400);
  assert.equal(blocked.spawned.length, 0);
  const reset = resetTrail(setTrailReducedMotion(reduced.state, false).state);
  assert.equal(reset.clearView, true);
  assert.equal(reset.state.particles.length, 0);
});

test('the trail window stays click-through, unfocused, and off until asked', () => {
  const trail = readFileSync(path.join(root, 'src/main/trailWindow.ts'), 'utf8');
  const overlay = readFileSync(path.join(root, 'src/main/overlayWindow.ts'), 'utf8');
  const main = readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
  const tray = readFileSync(path.join(root, 'src/main/tray.ts'), 'utf8');
  const preload = readFileSync(path.join(root, 'src/preload/trailPreload.ts'), 'utf8');
  const page = readFileSync(path.join(root, 'src/renderer/trail.ts'), 'utf8');
  const movement = readFileSync(path.join(root, 'src/shared/neonTrail.ts'), 'utf8');
  assert.match(trail, /setBackgroundColor\('#00000000'\)/);
  assert.match(trail, /setIgnoreMouseEvents\(true\)/);
  assert.equal(trail.includes('setIgnoreMouseEvents(false)'), false);
  assert.equal(trail.includes('.focus('), false);
  assert.match(trail, /setFocusable\(false\)/);
  assert.match(trail, /moveTop\(/);
  assert.match(trail, /isChatOpen/);
  assert.equal(trail.includes('desktopCapturer'), false);
  assert.equal(trail.includes('globalShortcut'), false);
  assert.match(trail, /let enabled = false/);
  assert.match(trail, /pageFailed/);
  assert.match(trail, /trail-load-failed/);
  assert.match(trail, /trail-preload-missing/);
  assert.match(trail, /trail-renderer-fault/);
  assert.match(trail, /trail-preload-error/);
  assert.match(trail, /preload-error/);
  assert.match(trail, /showMarker/);
  assert.match(trail, /existsSync/);
  assert.match(main, /if \(!devMovement\)/);
  assert.match(main, /devMarker: dev/);
  assert.match(tray, /devMarker/);
  assert.match(tray, /Show Trail Marker/);
  assert.match(overlay, /onTrail\?/);
  assert.equal(preload.includes('ipcRenderer.invoke'), false);
  assert.equal(preload.includes('setBounds'), false);
  assert.equal(preload.includes('setIgnoreMouseEvents'), false);
  assert.equal(preload.includes('neonTrail'), false);
  assert.equal(preload.includes('../shared'), false);
  assert.equal(preload.includes('require('), false);
  assert.match(preload, /trail:marker/);
  assert.match(page, /getContext\('2d', \{ alpha: true \}\)/);
  assert.match(page, /globalCompositeOperation = 'copy'/);
  assert.match(page, /rgba\(0, 0, 0, 0\)/);
  assert.match(page, /notifyFault/);
  assert.match(page, /readTrailFrame/);
  assert.match(page, /onMarker/);
  assert.equal(page.includes("fillStyle = 'white'"), false);
  assert.equal(page.includes('#ffffff'), false);
  assert.match(page, /requestAnimationFrame/);
  assert.match(page, /if \(visible === 0\)/);
  assert.equal(page.includes('three'), false);
  assert.equal(page.includes('shadowBlur'), false);
  assert.equal(page.includes('desktopCapturer'), false);
  assert.equal(movement.includes('qwen'), false);
  assert.equal(movement.includes('getUserMedia'), false);
  assert.equal(movement.includes('speechSynthesis'), false);
  assert.equal(IpcChannels.trailHello, 'trail:hello');
  assert.match(preload, /trail:hello/);
  assert.equal(isTrailRendererUrl('http://127.0.0.1:5173/trail.html', true), true);
  assert.equal(isTrailRendererUrl('app://companion/trail.html', false), true);
  assert.equal(isTrailRendererUrl('http://127.0.0.1:5173/trail.html', false), false);
  assert.equal(isRobotRendererUrl('http://127.0.0.1:5173/trail.html', true), false);
  assert.equal(isChatRendererUrl('http://127.0.0.1:5173/trail.html', true), false);
  const css = readFileSync(path.join(root, 'src/renderer/trail.css'), 'utf8');
  const html = readFileSync(path.join(root, 'src/renderer/trail.html'), 'utf8');
  assert.match(css, /background:\s*transparent/);
  assert.match(css, /rgba\(0,\s*0,\s*0,\s*0\)/);
  assert.equal(css.includes('#fff'), false);
  assert.equal(css.toLowerCase().includes('white'), false);
  assert.match(html, /trail\.css/);
  assert.equal(html.includes('background:'), false);
});

test('IPC keeps a real birth timestamp and the bitmap scale does not move DIP', () => {
  const born = 1_761_300_000_000;
  const frame = readTrailFrame({
    viewport: { x: -1920, y: 40, width: 180, height: 90 },
    particles: [{ id: 4, x: -1700, y: 80, born, life: 700, diameter: 8, driftX: 3, driftY: -2 }],
  });
  assert.ok(frame);
  assert.equal(frame.particles.length, 1);
  assert.equal(frame.particles[0]?.born, born);
  const drawn = frame.particles[0] ? particleVisual(frame.particles[0], born + 250) : null;
  assert.ok(drawn);
  assert.ok(drawn.alpha > 0);
  assert.ok(drawn.diameter < 8);
  assert.equal(readTrailViewport({ x: born, y: 0, width: 20, height: 20 }), null);
  assert.equal(readTrailFrame({ viewport: { x: 0, y: 0, width: 10, height: 10 }, particles: 'nope' }), null);
  assert.deepEqual(canvasBitmapSize(120, 40, 1.5), { width: 180, height: 60 });
  assert.equal(canvasBitmapSize(120, 40, 0), null);
  const local = trailLocal(-1700, 80, -1920, 40);
  assert.deepEqual(local, { x: 220, y: 40 });
});

test('the first move only anchors, and a real step is delivered unless a gate holds it', () => {
  const anchored = stepTrail(createTrailState(), sample(400, 200, 'moving'), 1_000);
  assert.equal(anchored.hold, 'baseline');
  assert.equal(anchored.spawned.length, 0);
  const moved = stepTrail(anchored.state, sample(400, 220, 'moving'), 1_050);
  assert.equal(moved.hold, null);
  assert.ok(moved.spawned.length > 0);
  const born = moved.spawned[0];
  assert.ok(born);
  assert.ok(born.life >= 500 && born.life <= 900);
  const asleep = stepTrail(moved.state, sample(400, 240, 'moving', { asleep: true }), 1_080);
  assert.equal(asleep.hold, 'asleep');
  assert.equal(asleep.spawned.length, 0);
  const chatting = stepTrail(moved.state, sample(400, 240, 'moving', { chatOpen: true }), 1_080);
  assert.equal(chatting.hold, 'chat');
  const reduced = stepTrail(setTrailReducedMotion(moved.state, true).state, sample(400, 260, 'moving'), 1_100);
  assert.equal(reduced.hold, 'reduced');
  assert.equal(reduced.spawned.length, 0);
});
