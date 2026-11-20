import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Module, createRequire } from 'node:module';
import test, { mock } from 'node:test';

let clock = 0, cursor = { x: 500, y: 400 };
let area = { x: 0, y: 0, width: 1920, height: 1040 };
const windows: FakeWindow[] = [];
class FakeContents extends EventEmitter {
  mainFrame = { parent: null as unknown, url: '' };
  sent: Array<{ channel: string; payload: unknown }> = [];
  open: any;
  isDestroyed() { return false; }
  send(channel: string, payload?: unknown) { this.sent.push({ channel, payload }); }
  setWindowOpenHandler(fn: any) { this.open = fn; }
}
class FakeWindow extends EventEmitter {
  webContents = new FakeContents();
  bounds: { x: number; y: number; width: number; height: number };
  options: any;
  visible = false; destroyed = false; ignore = true; moves: any[] = []; focuses = 0;
  above: string[] = [];
  constructor(options: any) { super(); this.options = options; this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; windows.push(this); }
  getBounds() { return { ...this.bounds }; }
  setBounds(bounds: any) { this.bounds = { ...bounds }; this.moves.push({ ...bounds }); }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  setIgnoreMouseEvents(ignore: boolean) { this.ignore = ignore; }
  setBackgroundMaterial() {} setBackgroundColor() {} setSkipTaskbar() {} setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {} setMenuBarVisibility() {} moveTop() {}
  getMediaSourceId() { return `window:${windows.indexOf(this) + 1}:0`; }
  moveAbove(source: string) { this.above.push(source); }
  focus() { this.focuses++; }
  showInactive() { this.visible = true; this.emit('show'); }
  hide() { this.visible = false; this.emit('hide'); }
  destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  loadURL(url: string) { this.webContents.mainFrame.url = url; return Promise.resolve(); }
}
const ipc = new EventEmitter();
const screen = Object.assign(new EventEmitter(), {
  getPrimaryDisplay: () => ({ id: 1, scaleFactor: 1, workArea: { ...area } }),
  getDisplayMatching: () => ({ id: 1, scaleFactor: 1, workArea: { ...area } }),
  getCursorScreenPoint: () => ({ ...cursor }),
});
class FakeTray extends EventEmitter {
  static last: FakeTray;
  menu: any;
  constructor() { super(); FakeTray.last = this; }
  setToolTip() {} setContextMenu(menu: any) { this.menu = menu; } destroy() {}
}
const ipcRenderer = Object.assign(new EventEmitter(), {
  sent: [] as any[], send(channel: string, ...args: unknown[]) { this.sent.push({ channel, args }); },
});
let bridge: any;
const electron = { BrowserWindow: FakeWindow, ipcMain: ipc, screen,
  systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) },
  Menu: { buildFromTemplate: (items: any[]) => items }, Tray: FakeTray,
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  contextBridge: { exposeInMainWorld: (_name: string, exposed: any) => { bridge = exposed; } }, ipcRenderer };
const require = createRequire(import.meta.url), originalLoad = (Module as any)._load;
let createHomeWindow: any, createOverlayWindow: any, createTray: any;
try {
  (Module as any)._load = function (id: string, ...args: any[]) { return id === 'electron' ? electron : originalLoad.call(this, id, ...args); };
  ({ createHomeWindow } = require('../../dist/main/homeWindow.js'));
  ({ createOverlayWindow } = require('../../dist/main/overlayWindow.js'));
  ({ createTray } = require('../../dist/main/tray.js'));
  require('../../dist/preload/homePreload.js');
} finally { (Module as any)._load = originalLoad; }

function fixture(t: any, homeDev = true, docking = false) {
  clock = 0; cursor = { x: 500, y: 400 }; area = { x: 0, y: 0, width: 1920, height: 1040 }; windows.length = 0;
  const timers = new Map<number, { fn: () => void; ms: number; next: number; repeat: boolean }>();
  let serial = 0, changed = 0;
  mock.method(performance, 'now', () => clock);
  mock.method(Date, 'now', () => 1000000 + clock);
  for (const [name, repeat] of [['setInterval', true], ['setTimeout', false]] as const) {
    mock.method(globalThis, name, ((fn: () => void, ms: number) => {
      const id = ++serial; timers.set(id, { fn, ms, next: clock + ms, repeat }); return id;
    }) as any);
  }
  for (const name of ['clearInterval', 'clearTimeout'] as const) mock.method(globalThis, name, ((id: number) => timers.delete(id)) as any);
  mock.method(console, 'log', () => {}); mock.method(console, 'error', () => {});
  let avatar: any, started = 0, selects = 0;
  const home = createHomeWindow({ dev: homeDev, preloadPath: 'C:\\fixture\\homePreload.js', onEnabledChanged: () => changed++,
    ...(docking ? {
      onActivate: () => avatar.requestDocking(home.getDockingBounds()),
      onUnavailable: () => avatar?.cancelDocking('home-unavailable'),
      raiseAvatar: (source: string) => avatar?.moveAboveHome(source) ?? false,
    } : {}),
  });
  const gates = { chatOpen: false, listening: false, speaking: false, generating: false };
  avatar = createOverlayWindow({ dev: true, preloadPath: 'C:\\fixture\\preload.js', onFirstFrame() {},
    getTravelBlock: () => gates, onVisibilityChanged: (visible: boolean) => home.setAppVisible(visible),
    ...(docking ? { getDockPlatform: () => home.getDockingBounds(), onDockingStart: () => started++,
      onDockingChanged: (phase: string) => home.feedback(phase === 'undocked' ? 'idle' : phase === 'docked' ? 'docked' : 'busy') } : {}),
    onDesktopCursor: (sample: any) => { if (home.isEnabled()) home.observe(sample); },
    onSelectScreen: () => { selects++; } });
  const avatarWin = windows[0]!;
  const event = (win: FakeWindow) => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  ipc.emit('overlay:frame-ready', event(avatarWin), 'm1.6');
  ipc.emit('overlay:phase', event(avatarWin), 'IDLE');
  const advance = (ms: number) => {
    const until = clock + ms;
    while (clock < until) {
      clock += 16;
      for (const [id, timer] of [...timers]) {
        if (timers.has(id) && clock >= timer.next) {
          if (timer.repeat) timer.next += timer.ms; else timers.delete(id);
          timer.fn();
        }
      }
    }
  };
  const ready = (win: FakeWindow) => { win.emit('ready-to-show'); ipc.emit('home:ready', event(win), 'home-m3.3a'); };
  const enable = () => { home.setEnabled(true); const win = windows.at(-1)!; ready(win); return win; };
  const point = (win: FakeWindow, x = 56, y = 50) => { cursor = { x: win.bounds.x + x, y: win.bounds.y + y }; advance(16); };
  const click = (win: FakeWindow) => ipc.emit('home:click', event(win));
  const feedback = (win: FakeWindow) => win.webContents.sent.filter(s => s.channel === 'home:feedback');
  t.after(() => {
    home.destroy(); avatar.destroy();
    assert.equal(timers.size, 0); assert.equal(ipc.listenerCount('home:ready'), 0);
    assert.equal(ipc.listenerCount('home:click'), 0); assert.equal(screen.listenerCount('display-metrics-changed'), 0);
    mock.restoreAll();
  });
  return { home, avatar, avatarWin, gates, timers, advance, enable, point, click, ready, feedback, event, changed: () => changed,
    phase: (phase: string) => ipc.emit('overlay:phase', event(avatarWin), phase), started: () => started,
    selects: () => selects,
    sleeps: () => avatarWin.webContents.sent.filter(s => s.channel === 'overlay:behavior' && s.payload === 'sleep').length };
}

test('awake robot screen control is one owned click and sleep cannot start it', t => {
  const f = fixture(t);
  f.phase('SLEEPING');
  ipc.emit('overlay:select-screen', f.event(f.avatarWin));
  assert.equal(f.selects(), 0);
  f.phase('IDLE');
  ipc.emit('overlay:select-screen', f.event(f.avatarWin));
  ipc.emit('overlay:select-screen', f.event(f.avatarWin), { image: 'renderer' });
  ipc.emit('overlay:select-screen', { sender: {}, senderFrame: f.avatarWin.webContents.mainFrame });
  assert.equal(f.selects(), 1);
  f.phase('WAKING');
  ipc.emit('overlay:select-screen', f.event(f.avatarWin));
  f.phase('TRACKING');
  ipc.emit('overlay:select-screen', f.event(f.avatarWin));
  f.phase('RETURNING_TO_SLEEP');
  ipc.emit('overlay:select-screen', f.event(f.avatarWin));
  ipc.emit('overlay:circle-click', f.event(f.avatarWin));
  assert.equal(f.selects(), 3);
  f.avatar.destroy();
  ipc.emit('overlay:select-screen', f.event(f.avatarWin));
  assert.equal(f.selects(), 3);
  assert.equal(ipc.listenerCount('overlay:select-screen'), 0);
});

test('Home is OFF at startup, with no extra window, IPC listeners, cursor sampler or watchdog', t => {
  const f = fixture(t); f.advance(2000);
  assert.equal(f.home.isEnabled(), false); assert.equal(f.home.getBounds(), null);
  assert.equal(windows.length, 1); assert.equal(ipc.listenerCount('home:click'), 0);
  assert.deepEqual([...f.timers.values()].map(t => t.ms), [16]);
});

test('production Home loads the packaged page and never the dev server', t => {
  const f = fixture(t, false); f.home.setEnabled(true); f.advance(1000);
  assert.equal(f.home.isEnabled(), true); assert.equal(windows.length, 2);
  const page = windows[1]!.webContents.mainFrame.url;
  assert.equal(page, 'app://companion/home.html');
  assert.equal(page.includes('127.0.0.1'), false);
});

for (const order of ['page-first', 'paint-first']) test(`one lazy Home window waits for ready + first paint (${order}) without focus`, t => {
  const f = fixture(t); f.home.setEnabled(true); f.home.setEnabled(true);
  assert.equal(windows.length, 2); const win = windows[1]!;
  assert.equal(win.visible, false); assert.equal(win.ignore, true);
  if (order === 'page-first') ipc.emit('home:ready', f.event(win), 'home-m3.3a'); else win.emit('ready-to-show');
  assert.equal(win.visible, false);
  f.ready(win); assert.equal(win.visible, true); assert.equal(win.focuses, 0);
  assert.deepEqual(win.bounds, { x: 1756, y: 932, width: 112, height: 88 });
  assert.deepEqual([...f.timers.values()].map(t => t.ms), [16]);
  for (const [name, value] of Object.entries({ frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, focusable: false, resizable: false })) assert.equal(win.options[name], value);
  for (const [name, value] of Object.entries({ sandbox: true, contextIsolation: true, nodeIntegration: false,
    webSecurity: true, allowRunningInsecureContent: false, devTools: false })) assert.equal(win.options.webPreferences[name], value);
});

test('explicit hide destroys Home; global Hide/Show preserves only its session intent and shares the sampler', t => {
  const f = fixture(t), first = f.enable(); f.point(first);
  assert.equal(first.ignore, false);
  f.avatar.hide(); assert.equal(first.destroyed, true); assert.equal(f.home.isEnabled(), true);
  assert.equal(f.timers.size, 0);
  f.avatar.show(); assert.equal(windows.length, 3); const next = windows[2]!; f.ready(next);
  assert.equal(next.visible, true); assert.equal(first.ignore, true);
  assert.deepEqual([...f.timers.values()].map(t => t.ms), [16]);
  f.home.setEnabled(false); assert.equal(next.destroyed, true); assert.equal(f.home.isEnabled(), false);
  assert.equal(screen.listenerCount('display-metrics-changed'), 1, 'only original avatar display listener remains');
});

test('repeated Show/Hide cycles never accumulate windows, listeners or permanent timers', t => {
  const f = fixture(t);
  for (let i = 0; i < 20; i++) {
    const win = f.enable();
    assert.equal(windows.filter(w => !w.destroyed && w !== f.avatarWin).length, 1);
    assert.equal(ipc.listenerCount('home:ready'), 1);
    f.home.setEnabled(false); assert.equal(win.destroyed, true);
    assert.equal(ipc.listenerCount('home:ready'), 0);
    assert.deepEqual([...f.timers.values()].map(t => t.ms), [16]);
  }
});

test('shared native sampling captures Home and immediately releases its transparent corners/near edges', t => {
  const f = fixture(t), win = f.enable();
  for (const [x, y] of [[0, 0], [111, 0], [0, 87], [111, 87], [56, 29], [4, 54], [56, 79], [108, 54], [56, 10]]) {
    f.point(win); assert.equal(win.ignore, false);
    f.point(win, x, y); assert.equal(win.ignore, true);
  }
  f.point(win); assert.equal(win.ignore, false, 'interaction returns without renderer mouse events');
});

test('overlapping trusted avatar input retains priority and cannot trigger Home feedback', t => {
  const f = fixture(t), win = f.enable();
  f.point(win, 56, 30); // This painted rear-rim point overlaps the approved right-arm proxy.
  assert.equal(f.avatarWin.ignore, false); assert.equal(win.ignore, true);
  f.click(win); assert.equal(f.feedback(win).length, 0);
  f.point(win); f.click(win); assert.equal(f.feedback(win).length, 1, 'exposed platform center stays available');
});

test('Home click acknowledges once, rate-limits duplicates, and never moves/sleeps the avatar or changes Follow', t => {
  const f = fixture(t), win = f.enable(); f.avatar.setFollowEnabled(true); f.point(win);
  const bounds = f.avatar.getBounds(), moves = f.avatarWin.moves.length, messages = f.avatarWin.webContents.sent.length;
  f.click(win); f.click(win);
  assert.equal(f.feedback(win).length, 1); assert.equal(f.feedback(win)[0]!.payload, 'pulse');
  assert.equal(f.avatar.isFollowing(), true); assert.deepEqual(f.avatar.getBounds(), bounds);
  assert.equal(f.avatarWin.moves.length, moves); assert.equal(f.avatarWin.webContents.sent.length, messages);
});

test('spoofed sender, child frame, different trusted page, payload and hidden state cannot invoke Home', t => {
  const f = fixture(t), win = f.enable(); f.point(win);
  const valid = f.event(win);
  for (const event of [{ ...valid, sender: f.avatarWin.webContents },
    { ...valid, senderFrame: { parent: null, url: win.webContents.mainFrame.url } },
    { ...valid, senderFrame: { parent: win.webContents.mainFrame, url: win.webContents.mainFrame.url } }]) {
    ipc.emit('home:click', event);
  }
  ipc.emit('home:click', valid, { move: true });
  const url = win.webContents.mainFrame.url; win.webContents.mainFrame.url = 'http://127.0.0.1:5173/chat.html';
  f.click(win); win.webContents.mainFrame.url = url;
  assert.equal(f.feedback(win).length, 0);
  f.home.setEnabled(false); f.click(win); assert.equal(f.feedback(win).length, 0);
});

test('stale/future/unavailable observations release input; cursor-read failure cannot strand Home capture', t => {
  const f = fixture(t), win = f.enable(); f.point(win);
  for (const at of [clock - 251, clock + 1]) {
    f.home.observe({ cursor, at, avatarOwnsPointer: false }); assert.equal(win.ignore, true);
  }
  f.point(win); assert.equal(win.ignore, false);
  mock.method(screen, 'getCursorScreenPoint', () => { throw Error('unavailable'); });
  f.advance(16); assert.equal(win.ignore, true);
});

test('display changes re-anchor only Home from the primary workArea in DIP and release stale capture', t => {
  const f = fixture(t), win = f.enable(); f.point(win);
  area = { x: -1920, y: 40, width: 1920, height: 1040 };
  screen.emit('display-metrics-changed');
  assert.deepEqual(win.bounds, { x: -164, y: 972, width: 112, height: 88 });
  assert.equal(win.ignore, true);
  f.point(win); assert.equal(win.ignore, false);
  area = { x: 20, y: 10, width: 1280, height: 680 };
  screen.emit('display-removed');
  assert.deepEqual(win.bounds, { x: 1136, y: 582, width: 112, height: 88 });
});

test('unavailable/too-small workArea leaves no Home or pending watchdog', t => {
  const f = fixture(t); area = { x: 0, y: 0, width: 100, height: 70 };
  f.home.setEnabled(true); assert.equal(f.home.isEnabled(), false);
  assert.equal(windows.length, 1); assert.equal(ipc.listenerCount('home:ready'), 0);
});

for (const fault of ['preload-error', 'render-process-gone', 'did-fail-load']) test(`${fault} destroys Home, releases capture and restores tray recovery`, t => {
  const f = fixture(t), win = f.enable(); f.point(win); const count = f.changed();
  win.webContents.emit(fault);
  assert.equal(win.destroyed, true); assert.equal(win.ignore, true); assert.equal(f.home.isEnabled(), false);
  assert.equal(f.changed(), count + 1); assert.equal(ipc.listenerCount('home:click'), 0);
  assert.equal(windows.filter(w => !w.destroyed).length, 1);
  const next = f.enable(); assert.equal(next.visible, true);
});

test('readiness watchdog is finite, disposed on hide, and old readiness cannot resurrect a window', t => {
  const f = fixture(t); f.home.setEnabled(true); const old = windows.at(-1)!;
  assert.equal([...f.timers.values()].filter(t => !t.repeat).length, 1);
  f.advance(10016); assert.equal(old.destroyed, true); assert.equal(f.home.isEnabled(), false);
  ipc.emit('home:ready', f.event(old), 'home-m3.3a'); assert.equal(old.visible, false);
  const next = f.enable(); old.emit('ready-to-show'); old.webContents.emit('render-process-gone');
  assert.equal(next.visible, true); assert.equal(f.home.isEnabled(), true);
});

test('native Home window failure disables Home without disrupting the existing avatar sampler', t => {
  const f = fixture(t), win = f.enable(); f.point(win);
  mock.method(win, 'getBounds', () => { throw Error('unavailable'); });
  f.advance(16); assert.equal(win.destroyed, true); assert.equal(f.home.isEnabled(), false);
  assert.deepEqual([...f.timers.values()].map(t => t.ms), [16]);
});

test('existing Manual Move, Return Home and chat holds retain their real controller behavior with Home enabled', t => {
  const f = fixture(t), win = f.enable(), homeBounds = win.getBounds(), parked = f.avatar.getBounds();
  f.avatar.setFollowEnabled(true); f.avatar.moveBy('left');
  assert.equal(f.avatar.isFollowing(), false);
  f.gates.chatOpen = true; f.advance(400); assert.deepEqual(f.avatar.getBounds(), parked);
  f.gates.chatOpen = false; f.advance(1200); assert.ok(f.avatar.getBounds().x < parked.x);
  f.avatar.moveHome(); f.advance(1200); assert.deepEqual(f.avatar.getBounds(), parked);
  assert.deepEqual(win.getBounds(), homeBounds); assert.equal(f.home.isEnabled(), true);
});

test('Home denies popups, other local pages, external navigation, webviews and keyboard focus', t => {
  const f = fixture(t), win = f.enable();
  assert.deepEqual(win.webContents.open({ url: 'https://example.com' }), { action: 'deny' });
  for (const url of ['https://example.com', 'app://companion/home.html', 'http://127.0.0.1:5173/chat.html']) {
    for (const name of ['will-navigate', 'will-redirect']) {
      let prevented = false; win.webContents.emit(name, { preventDefault() { prevented = true; } }, url);
      assert.equal(prevented, true);
    }
  }
  for (const name of ['will-attach-webview', 'before-input-event']) {
    let prevented = false; win.webContents.emit(name, { preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  }
});

test('Home preload exposes only fixed readiness/click sends and validated feedback with unsubscribe', () => {
  assert.deepEqual(Object.keys(bridge).sort(), ['notifyClick', 'notifyReady', 'onFeedback']);
  ipcRenderer.sent.length = 0; bridge.notifyReady(); bridge.notifyClick({ move: true });
  assert.deepEqual(ipcRenderer.sent, [{ channel: 'home:ready', args: ['home-m3.3a'] }, { channel: 'home:click', args: [] }]);
  let pulses = 0; const stop = bridge.onFeedback(() => pulses++);
  ipcRenderer.emit('home:feedback', {}, 'pulse'); ipcRenderer.emit('home:feedback', {}, { arbitrary: true });
  assert.equal(pulses, 1); stop(); ipcRenderer.emit('home:feedback', {}, 'pulse'); assert.equal(pulses, 1);
});

test('Home checkbox is default OFF in production and reflects enable/disable', () => {
  const common = { onShow() {}, onHide() {}, onWake() {}, onSleep() {}, onOpenChat() {}, onQuit() {},
    onToggleRecoveryCapture() {}, isRecoveryCapture: () => false, isWandering: () => false,
    isTrail: () => false, isStartAwake: () => false, startupAvailable: false, isStartWithWindows: () => false };
  let enabled = false;
  const production = createTray({ ...common, devMovement: false, isHome: () => enabled, onHome: (next: boolean) => { enabled = next; } });
  let item = FakeTray.last.menu.find((i: any) => i.label === 'Show Home');
  assert.equal(item.checked, false); item.click({ checked: true });
  item = FakeTray.last.menu.find((i: any) => i.label === 'Show Home'); assert.equal(item.checked, true);
  item.click({ checked: false }); assert.equal(enabled, false);
  assert.equal(FakeTray.last.menu.some((i: any) => i.label === 'Test window move'), false);
  production.destroy();
});

test('screen selection is a production action, never a preference checkbox', () => {
  let selected = 0;
  const common = { onShow() {}, onHide() {}, onWake() {}, onSleep() {}, onOpenChat() {}, onQuit() {},
    onToggleRecoveryCapture() {}, isRecoveryCapture: () => false, isWandering: () => false,
    isTrail: () => false, isStartAwake: () => false, startupAvailable: false, isStartWithWindows: () => false,
    onSelectScreenArea: () => selected++ };
  const production = createTray({ ...common, devMovement: false });
  const action = FakeTray.last.menu.find((i: any) => i.label === 'Select Screen Area');
  assert.ok(action); assert.equal(action.type, undefined); action.click(); assert.equal(selected, 1);
  assert.equal(FakeTray.last.menu.some((i: any) => i.type === 'checkbox' && i.label === 'Select Screen Area'), false);
  production.destroy();
});

test('main wiring keeps Home OFF in smoke, exposes only its narrow activation and has no persisted preference', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('home = createHomeWindow('), end = main.indexOf('overlay = createOverlayWindow(', start);
  const create = main.slice(start, end);
  assert.match(create, /dev: dev && !smoke/); assert.doesNotMatch(create, /moveHome|\.sleep\(|\.wake\(|setFollow|Wander|preferenceStore|fetch/);
  assert.match(create, /requestDocking\(bounds\)/);
  const source = readFileSync(new URL('./homeWindow.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setInterval|screen\.getCursorScreenPoint|moveHome|\.sleep\(|\.wake\(|fetch\(|requestTravel/);
  assert.doesNotMatch(readFileSync(new URL('../shared/userPreferences.ts', import.meta.url), 'utf8'), /[Hh]ome/);
  const html = readFileSync(new URL('../renderer/home.html', import.meta.url), 'utf8');
  assert.match(html, /connect-src 'none'/); assert.doesNotMatch(html, /<image|<iframe|https:\/\/|data:/);
  assert.match(html, /id="chassis-shade"[\s\S]*#f5f2ec[\s\S]*#f0ebe3[\s\S]*#e7e2d9/);
  assert.doesNotMatch(html, /#c5d0cb|#f4f7f5/);
  assert.match(html, /#7dff9a/);
  assert.match(html, /id="surface"/);
});

function dockFixture(t: any) {
  const f = fixture(t, true, true), win = f.enable();
  return { ...f, win, activate: () => { f.point(win, 56, 75); f.click(win); },
    settle: () => { f.point(win, 56, 75); f.click(win); f.advance(5000); } };
}

test('temporary private-capture hide restores a docked sleeper without undocking or waking', t => {
  const f = dockFixture(t); f.settle(); f.phase('SLEEPING');
  const bounds = f.avatarWin.getBounds(), sleeps = f.sleeps();
  const wakes = f.avatarWin.webContents.sent.filter(s => s.channel === 'overlay:behavior' && s.payload === 'wake').length;
  f.gates.chatOpen = true;
  f.avatar.setCaptureHidden(true); f.win.hide(); f.advance(250);
  assert.equal(f.avatar.dockingPhase(), 'docked'); assert.equal(f.avatarWin.isVisible(), false);
  f.win.showInactive(); f.avatar.setCaptureHidden(false); f.gates.chatOpen = false; f.advance(500);
  assert.equal(f.avatar.dockingPhase(), 'docked'); assert.deepEqual(f.avatarWin.getBounds(), bounds);
  assert.equal(f.sleeps(), sleeps); assert.equal(f.avatarWin.focuses, 0);
  assert.equal(f.avatarWin.webContents.sent.filter(s => s.channel === 'overlay:behavior' && s.payload === 'wake').length, wakes);
});

test('private-capture visibility does not reveal an already hidden avatar', t => {
  const f = fixture(t); f.avatar.hide(); f.avatar.setCaptureHidden(true); f.avatar.setCaptureHidden(false);
  assert.equal(f.avatarWin.isVisible(), false); assert.equal(f.avatarWin.focuses, 0);
});

test('capture hold preserves enabled follow intent and never enables a disabled mode', t => {
  const f = fixture(t); f.avatar.setFollowEnabled(true); f.gates.chatOpen = true; f.advance(300);
  f.avatar.setSelectionHold(true);
  assert.equal(f.avatarWin.ignore, true); assert.equal(f.timers.size, 0);
  f.avatar.setCaptureHidden(true); f.advance(500); f.avatar.setCaptureHidden(false);
  f.avatar.setSelectionHold(false);
  assert.equal(f.avatar.isFollowing(), true);
  f.avatar.setFollowEnabled(false); f.gates.chatOpen = false; f.advance(500);
  assert.equal(f.avatar.isFollowing(), false);
});

test('docking integration stays idle at startup and showing Home never starts travel or Sleep', t => {
  const f = dockFixture(t); f.advance(3000);
  assert.equal(f.avatar.dockingPhase(), 'undocked'); assert.equal(f.started(), 0);
  assert.equal(f.sleeps(), 0); assert.equal(f.avatarWin.moves.length, 0);
});

test('trusted Home click starts one eased trajectory; confirmed arrival and settling precede Sleep', t => {
  const f = dockFixture(t); f.avatarWin.bounds.x -= 400;
  const before = f.avatarWin.getBounds(); f.activate();
  assert.equal(f.avatar.dockingPhase(), 'returning'); assert.deepEqual(f.avatarWin.getBounds(), before);
  assert.equal(f.sleeps(), 0); f.advance(1000);
  assert.ok(f.avatarWin.bounds.x > before.x && f.avatarWin.bounds.x < 1704);
  assert.equal(f.sleeps(), 0); f.advance(5000);
  assert.deepEqual(f.avatarWin.getBounds(), { x: 1704, y: 816, width: 216, height: 224 });
  assert.equal(f.avatar.dockingPhase(), 'docked'); assert.equal(f.sleeps(), 1);
  assert.ok(f.avatarWin.moves.length > 10);
  assert.deepEqual([...f.timers.values()].map(t => t.ms), [16], 'no docking timer/actuator remains at rest');
});

test('mathematical travel completion cannot substitute for physical native arrival', t => {
  const f = dockFixture(t); f.avatarWin.bounds.x -= 200;
  mock.method(f.avatarWin, 'setBounds', () => {});
  f.activate(); f.advance(5000);
  assert.equal(f.avatar.dockingPhase(), 'undocked'); assert.equal(f.sleeps(), 0);
  assert.deepEqual([...f.timers.values()].map(t => t.ms), [16]);
});

test('settle requires a stationary native target; unexpected displacement cancels without Sleep', t => {
  const f = dockFixture(t); f.activate(); f.advance(304);
  assert.equal(f.avatar.dockingPhase(), 'settling'); assert.equal(f.sleeps(), 0);
  f.avatarWin.bounds.x -= 3; f.avatarWin.emit('move'); f.advance(1000);
  assert.equal(f.avatar.dockingPhase(), 'undocked'); assert.equal(f.sleeps(), 0);
});

test('repeated valid platform clicks during approach are idempotent and do not add timers', t => {
  const f = dockFixture(t); f.avatarWin.bounds.x -= 800; f.activate();
  for (let i = 0; i < 4; i++) { f.advance(192); f.activate(); }
  assert.equal(f.started(), 1); assert.equal(f.avatar.dockingPhase(), 'returning');
  assert.deepEqual([...f.timers.values()].map(t => t.ms).sort((a,b)=>a-b), [16,32,20000]);
  f.advance(6000); assert.equal(f.sleeps(), 1);
});

test('docked sleep stays static with Follow OFF, no permanent dock timer and no repeated Sleep command', t => {
  const f = dockFixture(t); f.avatar.setFollowEnabled(true); f.settle(); f.phase('SLEEPING');
  const count = f.avatarWin.moves.length; f.advance(5000);
  assert.equal(f.avatar.isFollowing(), false); assert.equal(f.avatarWin.moves.length, count);
  assert.equal(f.sleeps(), 1); assert.equal(f.avatar.dockingPhase(), 'docked');
  assert.deepEqual([...f.timers.values()].map(t => t.ms), [16]);
});

test('exposed platform front remains clickable while docked; wake completes before safe departure', t => {
  const f = dockFixture(t); f.settle(); f.phase('SLEEPING');
  const parked = f.avatarWin.getBounds(); f.point(f.win, 56, 75);
  assert.equal(f.avatarWin.ignore, true); assert.equal(f.win.ignore, false);
  f.click(f.win); assert.equal(f.avatar.dockingPhase(), 'waking');
  f.phase('WAKING'); f.advance(700); assert.deepEqual(f.avatarWin.getBounds(), parked);
  f.phase('IDLE'); assert.equal(f.avatar.dockingPhase(), 'leaving'); f.advance(3000);
  assert.deepEqual(f.avatarWin.getBounds(), { x: 1584, y: 768, width: 216, height: 224 });
  assert.equal(f.avatar.dockingPhase(), 'undocked'); assert.equal(f.avatar.isFollowing(), false);
  assert.equal(f.started(), 1); assert.equal(f.sleeps(), 1);
});

test('intentional trusted robot body click is a wake/departure fallback with avatar-over-platform priority', t => {
  const f = dockFixture(t); f.settle(); f.phase('SLEEPING');
  f.point(f.avatarWin, 108, 112); assert.equal(f.avatarWin.ignore, false);
  f.phase('WAKING'); ipc.emit('overlay:circle-click', f.event(f.avatarWin));
  assert.equal(f.avatar.dockingPhase(), 'waking'); f.phase('IDLE'); f.advance(3000);
  assert.equal(f.avatar.dockingPhase(), 'undocked'); assert.equal(f.avatarWin.bounds.x, 1584);
});

test('spoofed body sender/payload and stale body sample cannot initiate docking departure', t => {
  const f = dockFixture(t); f.settle(); f.phase('SLEEPING'); f.point(f.avatarWin, 108, 112);
  ipc.emit('overlay:circle-click', f.event(f.win));
  const wrongOwner = { sender: f.win.webContents, senderFrame: f.avatarWin.webContents.mainFrame };
  const clonedFrame = { sender: f.avatarWin.webContents, senderFrame: { parent: null, url: f.avatarWin.webContents.mainFrame.url } };
  for (const event of [wrongOwner, clonedFrame]) {
    ipc.emit('overlay:circle-click', event); ipc.emit('overlay:phase', event, 'IDLE');
  }
  assert.equal(f.avatar.wanderView().asleep,true, 'a matching URL alone cannot change robot phase');
  ipc.emit('overlay:circle-click', f.event(f.avatarWin), { destination: 'elsewhere' });
  assert.equal(f.avatar.dockingPhase(), 'docked');
  mock.method(screen, 'getCursorScreenPoint', () => { throw Error('unavailable'); }); f.advance(300);
  ipc.emit('overlay:circle-click', f.event(f.avatarWin)); assert.equal(f.avatar.dockingPhase(), 'docked');
});

test('explicit click can wake an undocked sleeping robot before beginning the return', t => {
  const f = dockFixture(t); f.phase('SLEEPING'); f.activate();
  assert.equal(f.avatar.dockingPhase(), 'waking'); assert.equal(f.avatarWin.moves.length, 0);
  f.phase('WAKING'); f.advance(700); assert.equal(f.avatarWin.moves.length, 0);
  f.phase('IDLE'); f.advance(1500); assert.equal(f.avatar.dockingPhase(), 'docked');
});

for (const gate of ['chatOpen','listening','speaking','generating'] as const) {
  test(`${gate} rejects docking and cancels active travel without a queued resume`, t => {
    const f = dockFixture(t); f.gates[gate] = true; f.activate();
    assert.equal(f.avatar.dockingPhase(), 'undocked'); assert.equal(f.started(), 0);
    assert.ok(f.feedback(f.win).some(s=>s.payload==='blocked'));
    f.gates[gate] = false; f.advance(192); f.avatarWin.bounds.x -= 400; f.activate();
    assert.equal(f.avatar.dockingPhase(), 'returning'); f.advance(200);
    f.gates[gate] = true; f.advance(32); const bounds = f.avatarWin.getBounds();
    assert.equal(f.avatar.dockingPhase(), 'undocked'); f.gates[gate] = false; f.advance(5000);
    assert.deepEqual(f.avatarWin.getBounds(), bounds); assert.equal(f.sleeps(), 0);
  });
}

test('an interaction hold during settling cancels the arrival timer', t => {
  const f = dockFixture(t); f.activate(); f.advance(304);
  assert.equal(f.avatar.dockingPhase(), 'settling'); f.gates.chatOpen = true; f.advance(1000);
  assert.equal(f.avatar.dockingPhase(), 'undocked'); assert.equal(f.sleeps(), 0);
});

for (const action of ['stop','manual','home','follow','sleep','hide'] as const) {
  test(`explicit ${action} overrides docking without competing jobs or automatic mode restoration`, t => {
    const f = dockFixture(t); f.avatarWin.bounds.x -= 400; f.activate(); f.advance(200);
    if(action==='stop') f.avatar.stopMovement();
    if(action==='manual') f.avatar.moveBy('left');
    if(action==='home') f.avatar.moveHome();
    if(action==='follow') f.avatar.setFollowEnabled(true);
    if(action==='sleep') f.avatar.sleep();
    if(action==='hide') f.avatar.hide();
    assert.equal(f.avatar.dockingPhase(), 'undocked');
    assert.equal([...f.timers.values()].filter(t=>!t.repeat).length,0);
    if(action==='sleep') assert.equal(f.sleeps(),1); else assert.equal(f.sleeps(),0);
    if(action==='home') { f.advance(5000); assert.deepEqual(f.avatarWin.getBounds(),{x:1688,y:800,width:216,height:224}); }
    if(action==='follow') { assert.equal(f.avatar.isFollowing(),true); f.avatar.setFollowEnabled(false); }
  });
}

for (const action of ['off','renderer-fault','display-change'] as const) {
  test(`platform ${action} cancels active docking and invalidates late completion`, t => {
    const f = dockFixture(t); f.avatarWin.bounds.x -= 400; f.activate(); f.advance(200);
    if(action==='off') f.home.setEnabled(false);
    if(action==='renderer-fault') f.win.webContents.emit('render-process-gone');
    if(action==='display-change') { area={x:0,y:0,width:1280,height:680}; screen.emit('display-metrics-changed'); }
    assert.equal(f.avatar.dockingPhase(),'undocked'); f.advance(25000); assert.equal(f.sleeps(),0);
    assert.equal([...f.timers.values()].filter(t=>!t.repeat).length,0);
  });
}

test('hiding an already docked platform preserves Sleep and Tray Wake remains a safe recovery', t => {
  const f = dockFixture(t); f.settle(); f.phase('SLEEPING'); const bounds=f.avatarWin.getBounds();
  f.home.setEnabled(false); assert.equal(f.avatar.dockingPhase(),'undocked');
  assert.equal(f.avatar.wanderView().asleep,true); assert.deepEqual(f.avatarWin.getBounds(),bounds);
  f.avatar.wake(); assert.equal(f.avatarWin.webContents.sent.at(-1)!.payload,'wake');
});

test('unavailable or mismatched station coordinates are rejected before movement', t => {
  const f = dockFixture(t);
  for(const bounds of [{...f.win.getBounds(),x:NaN},{...f.win.getBounds(),x:1792},{...f.win.getBounds(),width:216}]) {
    assert.equal(f.avatar.requestDocking(bounds),false);
  }
  assert.equal(f.started(),0); assert.equal(f.avatarWin.moves.length,0);
});

test('bounded wake timeout clears a renderer that never acknowledges Wake', t => {
  const f = dockFixture(t); f.phase('SLEEPING'); f.activate(); f.advance(21000);
  assert.equal(f.avatar.dockingPhase(),'undocked'); assert.equal(f.sleeps(),0);
  assert.deepEqual([...f.timers.values()].map(t=>t.ms),[16]);
});

test('event-based relative stacking keeps avatar foreground without focus or continuous reorder', t => {
  const f = dockFixture(t); const initial=f.avatarWin.above.length;
  assert.equal(initial,1); assert.equal(f.avatarWin.above[0],f.win.getMediaSourceId());
  f.settle(); assert.ok(f.avatarWin.above.length>initial);
  assert.equal(f.avatarWin.above.length, initial+2, 'one raise on click and one confirmed-arrival raise');
  const count=f.avatarWin.above.length; f.phase('SLEEPING'); f.advance(5000);
  assert.equal(f.avatarWin.above.length,count); assert.equal(f.avatarWin.focuses,0); assert.equal(f.win.focuses,0);
  f.avatar.hide(); f.avatar.show(); const fresh=windows.at(-1)!; f.ready(fresh);
  assert.equal(f.avatarWin.above.at(-1),fresh.getMediaSourceId());
});

test('relative-stack failure disables the platform before it can start docking', t => {
  const f = dockFixture(t); mock.method(f.avatarWin,'moveAbove',()=>{throw Error('unavailable');});
  f.activate(); assert.equal(f.home.isEnabled(),false); assert.equal(f.avatar.dockingPhase(),'undocked');
  assert.equal(f.started(),0); assert.equal(f.sleeps(),0);
});

test('native move failure cancels only this docking job without leaving its actuator/deadline', t => {
  const f = dockFixture(t); f.avatarWin.bounds.x-=400; f.activate();
  mock.method(f.avatarWin,'setBounds',()=>{throw Error('native failure');}); f.advance(64);
  assert.equal(f.avatar.dockingPhase(),'undocked'); assert.equal(f.sleeps(),0);
  assert.deepEqual([...f.timers.values()].map(t=>t.ms),[16]);
});

test('Home and avatar shutdown during docking dispose all owned timers and late work', t => {
  const f = dockFixture(t); f.activate(); f.home.destroy(); f.avatar.destroy(); f.advance(25000);
  assert.equal(f.timers.size,0); assert.equal(f.sleeps(),0);
});

test('foreground-stack failure at confirmed arrival cancels docking before Sleep', t => {
  const f = dockFixture(t); f.activate();
  mock.method(f.avatarWin,'moveAbove',()=>{throw Error('stack unavailable');}); f.advance(1500);
  assert.equal(f.home.isEnabled(),false); assert.equal(f.avatar.dockingPhase(),'undocked'); assert.equal(f.sleeps(),0);
  assert.deepEqual([...f.timers.values()].map(t=>t.ms),[16]);
});

test('renderer Sleep during approach cancels; late Wake after Stop cannot revive the cancelled job', t => {
  const f = dockFixture(t); f.avatarWin.bounds.x-=400; f.activate(); f.phase('RETURNING_TO_SLEEP');
  assert.equal(f.avatar.dockingPhase(),'undocked'); assert.equal(f.sleeps(),0);
  f.advance(200); f.phase('SLEEPING'); f.activate(); assert.equal(f.avatar.dockingPhase(),'waking');
  f.avatar.stopMovement(); const bounds=f.avatarWin.getBounds(); f.phase('WAKING'); f.phase('IDLE'); f.advance(5000);
  assert.equal(f.avatar.dockingPhase(),'undocked'); assert.deepEqual(f.avatarWin.getBounds(),bounds);
});

test('explicit recovery capture safely cancels docking and prevents a new docking request', t => {
  const f = dockFixture(t); f.activate(); f.avatar.setRecoveryCapture(true);
  assert.equal(f.avatar.dockingPhase(),'undocked'); assert.equal(f.avatar.requestDocking(f.win.getBounds()),false);
  f.advance(2000); assert.equal(f.sleeps(),0);
});

test('multiple wake clicks do not duplicate the departure or enable a movement mode', t => {
  const f = dockFixture(t); f.settle(); f.phase('SLEEPING'); f.activate();
  for(let i=0;i<3;i++){ f.advance(192); f.activate(); }
  assert.equal(f.avatar.dockingPhase(),'waking'); assert.equal(f.started(),1);
  assert.deepEqual([...f.timers.values()].map(t=>t.ms).sort((a,b)=>a-b),[16,20000]);
  f.phase('WAKING'); f.phase('IDLE'); f.advance(3000);
  assert.equal(f.avatar.dockingPhase(),'undocked'); assert.equal(f.avatar.isFollowing(),false);
});

test('docking works on a negative-origin primary display after a topology update', t => {
  const f = dockFixture(t); area={x:-1920,y:40,width:1920,height:1040}; screen.emit('display-metrics-changed');
  f.activate(); f.advance(5000);
  assert.equal(f.avatar.dockingPhase(),'docked');
  assert.deepEqual(f.avatarWin.getBounds(),{x:-216,y:856,width:216,height:224}); assert.equal(f.sleeps(),1);
});
