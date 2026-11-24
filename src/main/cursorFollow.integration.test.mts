import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Module, createRequire } from 'node:module';
import path from 'node:path';
import test, { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as followPlanner from '../shared/cursorFollow.ts';
import { replay, trajectories } from '../../scripts/follow-trajectories.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let clock = 0, cursor = { x: 500, y: 400 }, reduced = false, animationReads = 0;
const display = { id: 1, scaleFactor: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const windows: FakeWindow[] = [];
class FakeContents extends EventEmitter {
  mainFrame = { parent: null, url: '' };
  messages: Array<{ channel: string; payload: any }> = [];
  isDestroyed() { return false; }
  send(channel: string, payload: any) { this.messages.push({ channel, payload }); }
}
class FakeWindow extends EventEmitter {
  contents = new FakeContents(); webContents = this.contents;
  bounds: { x: number; y: number; width: number; height: number };
  visible = false; destroyed = false; ignore = true; moves: any[] = []; moveTimes: number[] = [];
  constructor(options: any) { super(); this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; windows.push(this); }
  getBounds() { return { ...this.bounds }; }
  setBounds(bounds: any) { this.bounds = { ...bounds }; this.moves.push({ ...bounds }); this.moveTimes.push(clock); }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  showInactive() { if (!this.visible) { this.visible = true; this.emit('show'); } }
  hide() { if (this.visible) { this.visible = false; this.emit('hide'); } }
  destroy() { this.destroyed = true; this.visible = false; }
  setIgnoreMouseEvents(ignore: boolean) { this.ignore = ignore; }
  setBackgroundMaterial() {} setBackgroundColor() {} setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {} setMenuBarVisibility() {} setSkipTaskbar() {} moveTop() {}
  loadURL(url: string) { this.webContents.mainFrame.url = url; return Promise.resolve(); }
}
const ipc = new EventEmitter();
const screen = Object.assign(new EventEmitter(), {
  getPrimaryDisplay: () => display,
  getDisplayMatching: () => display,
  getCursorScreenPoint: () => ({ ...cursor }),
});
class FakeTray extends EventEmitter {
  static latest: FakeTray;
  menu: any;
  constructor() { super(); FakeTray.latest = this; }
  setToolTip() {} setContextMenu(menu: any) { this.menu = menu; } destroy() {}
}
const electron = { BrowserWindow: FakeWindow, ipcMain: ipc, screen,
  systemPreferences: { getAnimationSettings: () => { animationReads++; return { prefersReducedMotion: reduced }; } },
  Menu: { buildFromTemplate: (items: any[]) => items }, Tray: FakeTray,
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  contextBridge: { exposeInMainWorld: (_name: string, bridge: any) => { exposed = bridge; } },
  ipcRenderer: new EventEmitter(),
};
let exposed: any;
const require = createRequire(import.meta.url);
const originalLoad = (Module as any)._load;
let createOverlayWindow: any, createTray: any;
try {
  (Module as any)._load = function (id: string, ...args: any[]) {
    return id === 'electron' ? electron : originalLoad.call(this, id, ...args);
  };
  ({ createOverlayWindow } = require('../../dist/main/overlayWindow.js'));
  ({ createTray } = require('../../dist/main/tray.js'));
  require('../../dist/preload/preload.js');
} finally { (Module as any)._load = originalLoad; }

function fixture(t: any, dev = true) {
  clock = 0; cursor = { x: 500, y: 400 }; reduced = false; animationReads = 0;
  const timers = new Map<number, { fn: () => void; ms: number; next: number }>();
  let serial = 0, changed = 0;
  const gates = { chatOpen: false, listening: false, speaking: false, generating: false };
  const trail: any[] = [];
  mock.method(performance, 'now', () => clock);
  mock.method(Date, 'now', () => 1000000 + clock);
  mock.method(globalThis, 'setInterval', ((fn: () => void, ms: number) => {
    const id = ++serial; timers.set(id, { fn, ms, next: clock + ms }); return id;
  }) as any);
  mock.method(globalThis, 'clearInterval', ((id: number) => { timers.delete(id); }) as any);
  // Only fake cursor/phase logs are generated; keep test output concise.
  mock.method(console, 'log', () => {});
  const controller = createOverlayWindow({ dev, preloadPath: 'C:\\fixture\\preload.js',
    onFirstFrame: () => {}, getTravelBlock: () => gates,
    onTrail: (sample: any) => trail.push(sample), onFollowChanged: () => changed++,
  });
  const win = windows.at(-1)!;
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const phase = (name: string) => ipc.emit('overlay:phase', event, name);
  ipc.emit('overlay:frame-ready', event, 'm1.6');
  phase('IDLE');
  t.after(() => { controller.destroy(); assert.equal(timers.size, 0); mock.restoreAll(); });
  const advance = (duration: number, movingCursor = true) => {
    const until = clock + duration;
    while (clock < until) {
      clock += 16;
      if (movingCursor) cursor = { x: 500 + clock / 20, y: 400 };
      for (const [id, timer] of [...timers]) {
        if (timers.has(id) && clock >= timer.next) { timer.next += timer.ms; timer.fn(); }
      }
    }
  };
  return { controller, win, phase, gates, timers, advance, trail, changed: () => changed };
}

test('real overlay defaults off, keeps only its existing 16-ms cursor interval, and never moves at startup', t => {
  const f = fixture(t);
  f.advance(2000);
  assert.equal(f.controller.isFollowing(), false);
  assert.equal(f.win.moves.length, 0);
  assert.deepEqual([...f.timers.values()].map(timer => timer.ms), [16]);
  assert.equal(animationReads, 0);
});
test('opt-in uses the one existing 32-ms actuator timer; disable cancels follow and releases input', t => {
  const f = fixture(t);
  f.controller.setFollowEnabled(true); f.advance(1800);
  assert.equal(f.controller.isFollowing(), true);
  assert.ok(f.win.moves.length > 0);
  assert.deepEqual([...f.timers.values()].map(timer => timer.ms).sort(), [16, 32]);
  assert.equal(f.win.ignore, true);
  assert.ok(f.win.webContents.messages.some(message => message.channel === 'overlay:cursor-sample' && message.payload.inputSuppressed === true));
  assert.ok(f.trail.some(sample => sample.travelPhase === 'moving' && sample.window.width === 216));
  f.controller.setFollowEnabled(false);
  const count = f.win.moves.length; f.advance(1000);
  assert.equal(f.win.moves.length, count); assert.equal(f.controller.isFollowing(), false);
  assert.deepEqual([...f.timers.values()].map(timer => timer.ms), [16]);
  assert.equal(f.changed(), 2);
  assert.ok(animationReads <= 1 + 1800 / 200);
});
test('production follow uses the packaged page and can start without the dev server', t => {
  const f = fixture(t, false);
  assert.equal(f.win.webContents.mainFrame.url, 'app://companion/index.html');
  f.win.showInactive();
  f.controller.setFollowEnabled(true); f.advance(2000);
  assert.equal(f.controller.isFollowing(), true);
  assert.equal(f.win.webContents.mainFrame.url.includes('127.0.0.1'), false);
});
test('cursor jumping onto a moving body passes through until the stopped dwell restores its real hit', t => {
  const f = fixture(t);
  f.controller.setFollowEnabled(true); f.advance(1600);
  const bounds = f.win.getBounds();
  cursor = { x: bounds.x + 108, y: bounds.y + 112 };
  f.advance(16, false);
  assert.equal(f.win.ignore, true);
  const moves = f.win.moves.length;
  f.advance(288, false);
  assert.equal(f.win.ignore, true); assert.equal(f.win.moves.length, moves);
  f.advance(32, false);
  assert.equal(f.win.ignore, false);
  assert.equal(f.win.webContents.messages.filter(message => message.channel === 'overlay:cursor-sample').at(-1)!.payload.inputSuppressed, false);
});
for (const direction of ['left', 'home', 'stop']) test(`${direction} explicitly overrides follow without concurrent movement`, t => {
  const f = fixture(t);
  f.controller.setFollowEnabled(true); f.advance(1600);
  if (direction === 'left') f.controller.moveBy('left');
  else if (direction === 'home') f.controller.moveHome();
  else f.controller.stopMovement();
  assert.equal(f.controller.isFollowing(), false);
  const before = f.win.moves.length; f.advance(1000);
  if (direction === 'stop') assert.equal(f.win.moves.length, before);
  assert.ok([...f.timers.values()].filter(timer => timer.ms === 32).length <= 1);
});
test('chat blocks within observation cadence and discards pending movement without disabling opt-in', t => {
  const f = fixture(t);
  f.controller.setFollowEnabled(true); f.advance(1600);
  f.gates.chatOpen = true; f.advance(32);
  const before = f.win.moves.length; f.advance(800);
  assert.equal(f.win.moves.length, before); assert.equal(f.controller.isFollowing(), true);
  assert.deepEqual([...f.timers.values()].map(timer => timer.ms), [16]);
  f.gates.chatOpen = false; f.advance(200);
  assert.equal(f.win.moves.length, before);
  f.advance(1500);
  assert.ok(f.win.moves.length > before);
});
test('Sleep request wins before the renderer phase acknowledgement and never wakes automatically', t => {
  const f = fixture(t);
  f.controller.setFollowEnabled(true); f.advance(1600);
  f.controller.sleep(); const before = f.win.moves.length; f.advance(800);
  assert.equal(f.win.moves.length, before);
  assert.equal(f.win.webContents.messages.some(message => message.channel === 'overlay:behavior' && message.payload === 'wake'), false);
  assert.equal(f.controller.isFollowing(), true);
});
test('Hide clears both intervals; Show resumes only through the existing sampler and rest gates', t => {
  const f = fixture(t);
  f.controller.setFollowEnabled(true); f.advance(1600);
  f.controller.hide(); const before = f.win.moves.length; f.advance(1000);
  assert.equal(f.timers.size, 0); assert.equal(f.win.moves.length, before);
  f.controller.show(); f.advance(200); assert.equal(f.win.moves.length, before);
  f.advance(1800); assert.ok(f.win.moves.length > before);
});
test('display metrics change rebinds follow on the new work area', t => {
  const f = fixture(t);
  f.controller.setFollowEnabled(true); f.advance(1600);
  screen.emit('display-metrics-changed');
  assert.equal(f.controller.isFollowing(), true);
  const before = f.win.moves.length; f.advance(800);
  assert.ok(f.win.moves.length >= before);
});
test('the user reduced-motion preference prevents follow and recovery retains whole-window input', t => {
  const f = fixture(t);
  f.controller.setLife({ autonomous: false, reducedMotion: true, speed: 1 });
  f.controller.setFollowEnabled(true); f.advance(1500);
  assert.equal(f.win.moves.length, 0);
  f.controller.setRecoveryCapture(true);
  assert.equal(f.win.ignore, false);
});
test('the operating-system animation flag alone does not freeze follow', t => {
  const f = fixture(t); reduced = true;
  f.controller.setFollowEnabled(true); f.advance(1500);
  assert.ok(f.win.moves.length > 0);
  assert.equal(f.controller.isFollowing(), true);
});
test('tray follow checkbox is available in production and reflects runtime state', () => {
  const common = { onShow() {}, onHide() {}, onWake() {}, onSleep() {}, onOpenChat() {},
    onToggleRecoveryCapture() {}, isRecoveryCapture: () => false,
    isWandering: () => false, isTrail: () => false, isStartAwake: () => false,
    startupAvailable: false, isStartWithWindows: () => false, onQuit() {} };
  let enabled = false;
  const production = createTray({ ...common, devMovement: false, isFollowing: () => enabled,
    onFollow: (next: boolean) => { enabled = next; } });
  let item = FakeTray.latest.menu.find((entry: any) => entry.label === 'Follow Cursor');
  assert.equal(item.checked, false); item.click({ checked: true });
  item = FakeTray.latest.menu.find((entry: any) => entry.label === 'Follow Cursor');
  assert.equal(item.checked, true);
  assert.equal(FakeTray.latest.menu.some((entry: any) => entry.label === 'Test window move'), false);
  production.destroy();
});
test('main explicitly arbitrates wandering versus follow without persisting it or requesting providers', () => {
  const main = readFileSync(path.join(root, 'src/main/main.ts'), 'utf8');
  const start = main.indexOf('onFollow: (enabled)');
  const follow = main.slice(start, main.indexOf('onMoveTest:', start));
  const wander = main.slice(main.indexOf('onWander: (enabled)'), main.indexOf('onTrail: (action)'));
  assert.doesNotMatch(follow, /!dev/); assert.match(follow, /disableWander/);
  assert.match(follow, /overlay\.setFollowEnabled\(enabled\)/);
  assert.match(wander, /overlay\.setFollowEnabled\(false\)/);
  assert.match(follow, /followCursor/);
  assert.doesNotMatch(follow, /\.wake\(|fetch\(|qwen|transcribe/);
  assert.match(readFileSync(path.join(root, 'src/shared/userPreferences.ts'), 'utf8'), /followCursor/);
  const overlay = readFileSync(path.join(root, 'src/main/overlayWindow.ts'), 'utf8');
  assert.equal((overlay.match(/setInterval\(sampleAndApply, intervalMs\)/g) ?? []).length, 1);
  assert.equal((overlay.match(/setInterval\(tickTravel, 32\)/g) ?? []).length, 1);
  assert.equal((overlay.match(/win\.setBounds\(\{ x: nextX/g) ?? []).length, 1);
  assert.equal((overlay.match(/new BrowserWindow\(/g) ?? []).length, 1);
  assert.match(overlay, /if \(follow\.enabled && travel\.phase === 'idle'\)/);
});

test('preload accepts only a main-sent boolean suppression field and exposes no follow/capture control', () => {
  const received: any[] = [];
  const stop = exposed.onCursorSample((sample: any) => received.push(sample));
  const sample = { x: 100, y: 200, originX: 0, originY: 0, width: 216, height: 224, at: 1000 };
  electron.ipcRenderer.emit('overlay:cursor-sample', {}, { ...sample, inputSuppressed: true });
  electron.ipcRenderer.emit('overlay:cursor-sample', {}, { ...sample, inputSuppressed: false });
  electron.ipcRenderer.emit('overlay:cursor-sample', {}, sample);
  electron.ipcRenderer.emit('overlay:cursor-sample', {}, { ...sample, inputSuppressed: 'capture' });
  assert.deepEqual(received.map(entry => entry.inputSuppressed), [true, false, false]);
  assert.equal(exposed.setFollowEnabled, undefined);
  assert.equal(exposed.setIgnoreMouseEvents, undefined);
  stop();
});

test('destroy disposes the existing timers and pending follow callbacks cannot move a window', t => {
  const f = fixture(t);
  f.controller.setFollowEnabled(true); f.advance(1600);
  const callbacks = [...f.timers.values()].map(timer => timer.fn);
  f.controller.destroy(); const moves = f.win.moves.length;
  assert.equal(f.timers.size, 0);
  for (const callback of callbacks) callback();
  assert.equal(f.win.moves.length, moves);
  assert.equal(f.controller.isFollowing(), false);
});

test('native cursor failure stops follow and defaults to passthrough without crashing the sampler', t => {
  const f = fixture(t);
  f.controller.setFollowEnabled(true); f.advance(1600);
  mock.method(screen, 'getCursorScreenPoint', () => { throw new Error('unavailable'); });
  const moves = f.win.moves.length; f.advance(500);
  assert.equal(f.win.moves.length, moves); assert.equal(f.win.ignore, true);
  assert.deepEqual([...f.timers.values()].map(timer => timer.ms), [16]);
});

test('native display query failure stops follow without a second failing trail query', t => {
  const f = fixture(t);
  f.controller.setFollowEnabled(true); f.advance(1600);
  mock.method(screen, 'getDisplayMatching', () => { throw new Error('unavailable'); });
  const moves = f.win.moves.length; f.advance(500);
  assert.equal(f.win.moves.length, moves);
  assert.deepEqual([...f.timers.values()].map(timer => timer.ms), [16]);
});

for (const trajectory of trajectories) test(`synthetic ${trajectory.name}: replay matches the actual compiled overlay, timers and rounded setBounds`, t => {
  const f = fixture(t);
  f.win.setBounds({ x: 292, y: 388, width: 216, height: 224 });
  f.win.moves.length = 0; f.win.moveTimes.length = 0;
  cursor = trajectory.cursor(0);
  f.controller.setFollowEnabled(true);
  for (let at = 16; at <= trajectory.durationMs; at += 16) {
    cursor = trajectory.cursor(at);
    f.advance(16, false);
    assert.ok([...f.timers.values()].filter(timer => timer.ms === 32).length <= 1);
    assert.equal([...f.timers.values()].filter(timer => timer.ms === 16).length, 1);
  }
  const expected = replay(followPlanner, trajectory);
  assert.equal(f.win.moves.length, expected.commands);
  assert.equal(f.win.moveTimes[0] ?? null, expected.firstCommandMs);
  for (let i = 1; i < f.win.moves.length; i++) {
    const a = f.win.moves[i - 1], b = f.win.moves[i];
    const dt = (f.win.moveTimes[i]! - f.win.moveTimes[i - 1]!) / 1000;
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) <= 300 * dt + Math.SQRT2);
  }
  if (trajectory.name === 'stationary' || trajectory.name === 'jump-20') assert.equal(f.win.moves.length, 0);
  if (trajectory.name.startsWith('jump-') && trajectory.name !== 'jump-20') {
    const last = f.win.getBounds(), point = trajectory.cursor(trajectory.durationMs);
    const spacing = Math.max(170, Math.hypot(108, 112) + 36);
    assert.ok(Math.hypot(last.x + 108 - point.x, last.y + 112 - point.y) <= spacing + 9);
    assert.equal(f.win.ignore, true, 'remote settled cursor remains passthrough');
  }
});
