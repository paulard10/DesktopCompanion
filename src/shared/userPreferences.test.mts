import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy } from './csp.ts';
import { NUDGE_DIP } from './desktopMovement.ts';
import { createTrailState, stepTrail } from './neonTrail.ts';
import { createOverlayWebPreferences } from './overlayOptions.ts';
import { ARM_LIFT_MAX, BODY_TILT_MAX, SECONDARY_GESTURES } from './secondaryMotion.ts';
import {
  DEFAULT_USER_PREFERENCES,
  createUserPreferencesStore,
  parseUserPreferences,
  serializeUserPreferences,
} from './userPreferences.ts';
import { WANDER_EXPLORE_MS, WANDER_FIRST_MIN_MS, createWanderState } from './wander.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');

function temporaryDirectory(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'desktop-companion-prefs-'));
}

function preferencesFile(directory: string): string {
  return path.join(directory, 'companion', 'user-preferences.json');
}

test('safe defaults reject a missing, corrupt, or unsupported preferences file', () => {
  assert.deepEqual(DEFAULT_USER_PREFERENCES, { version: 1, neonTrailEnabled: false, startAwake: false });
  assert.equal(parseUserPreferences('{"version":1,"neonTrailEnabled":false,"startAwake":false}').ok, true);
  const valid = parseUserPreferences('{"version":1,"neonTrailEnabled":true,"startAwake":true,"extra":"ignored"}');
  assert.deepEqual(valid.preferences, { version: 1, neonTrailEnabled: true, startAwake: true });
  assert.equal(Object.hasOwn(valid.preferences, 'extra'), false);
  const missingFields = parseUserPreferences('{"version":1}');
  assert.equal(missingFields.ok, true);
  assert.deepEqual(missingFields.preferences, DEFAULT_USER_PREFERENCES);
  const invalidBooleans = parseUserPreferences('{"version":1,"neonTrailEnabled":"yes","startAwake":1}');
  assert.equal(invalidBooleans.ok, true);
  assert.deepEqual(invalidBooleans.preferences, DEFAULT_USER_PREFERENCES);
  for (const raw of ['{', '', 'null', '[]', '42']) {
    const parsed = parseUserPreferences(raw);
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.preferences, DEFAULT_USER_PREFERENCES);
  }
  const unsupported = parseUserPreferences('{"version":2,"neonTrailEnabled":true,"startAwake":true}');
  assert.equal(unsupported.reason, 'unsupported-version');
  assert.deepEqual(unsupported.preferences, DEFAULT_USER_PREFERENCES);
  const wandered = parseUserPreferences('{"version":1,"neonTrailEnabled":false,"startAwake":false,"wanderingEnabled":true}');
  assert.equal(Object.hasOwn(wandered.preferences, 'wanderingEnabled'), false);
  assert.equal(createWanderState().enabled, false);
});

test('the preferences file survives a restart and a failed write', () => {
  const directory = temporaryDirectory();
  try {
    const filePath = preferencesFile(directory);
    const decoy = path.join(directory, 'companion', 'tts-settings.json');
    const provider = path.join(directory, 'companion', 'provider-settings.json');
    const key = path.join(directory, 'companion', 'qwen-key.bin');
    const first = createUserPreferencesStore(filePath);
    assert.deepEqual(first.current(), DEFAULT_USER_PREFERENCES);
    assert.equal(existsSync(filePath), false);
    assert.deepEqual(first.update({ neonTrailEnabled: true }), {
      version: 1,
      neonTrailEnabled: true,
      startAwake: false,
    });
    writeFileSync(decoy, '{"enabled":true,"autoRead":false}');
    writeFileSync(provider, '{"provider":"demo","endpoint":null}');
    writeFileSync(key, Buffer.from('sealed'));
    const restarted = createUserPreferencesStore(filePath);
    assert.equal(restarted.current().neonTrailEnabled, true);
    assert.equal(restarted.current().startAwake, false);
    assert.deepEqual(restarted.update({ neonTrailEnabled: false, startAwake: true }), {
      version: 1,
      neonTrailEnabled: false,
      startAwake: true,
    });
    const again = createUserPreferencesStore(filePath);
    assert.equal(again.current().neonTrailEnabled, false);
    assert.equal(again.current().startAwake, true);
    const unchanged = again.update({ startAwake: true });
    assert.equal(unchanged.startAwake, true);
    let latest = again.current();
    for (let step = 0; step < 12; step += 1) {
      latest = again.update({ neonTrailEnabled: step % 2 === 0 });
    }
    assert.equal(latest.neonTrailEnabled, false);
    const saved = parseUserPreferences(readFileSync(filePath, 'utf8'));
    assert.deepEqual(saved.preferences, { version: 1, neonTrailEnabled: false, startAwake: true });
    assert.equal(readFileSync(decoy, 'utf8'), '{"enabled":true,"autoRead":false}');
    assert.equal(readFileSync(provider, 'utf8'), '{"provider":"demo","endpoint":null}');
    assert.equal(readFileSync(key, 'utf8'), 'sealed');
    const names = readdirSync(path.dirname(filePath));
    assert.equal(names.some((name) => name.endsWith('.tmp') || name.endsWith('.bak')), false);
    const before = readFileSync(filePath, 'utf8');
    const interrupted = createUserPreferencesStore(filePath, { failBeforeReplace: true });
    assert.equal(interrupted.update({ neonTrailEnabled: true }).neonTrailEnabled, false);
    assert.equal(readFileSync(filePath, 'utf8'), before);
    interrupted.close();
    assert.equal(interrupted.update({ startAwake: false }).startAwake, true);
    assert.equal(readFileSync(filePath, 'utf8'), before);
    writeFileSync(filePath, '{');
    assert.deepEqual(createUserPreferencesStore(filePath).current(), DEFAULT_USER_PREFERENCES);
    writeFileSync(filePath, '{"version":9,"neonTrailEnabled":true}');
    assert.deepEqual(createUserPreferencesStore(filePath).current(), DEFAULT_USER_PREFERENCES);
    const unreadable = createUserPreferencesStore(directory);
    assert.deepEqual(unreadable.current(), DEFAULT_USER_PREFERENCES);
    const blocker = path.join(directory, 'not-a-directory');
    writeFileSync(blocker, 'x');
    const blocked = createUserPreferencesStore(path.join(blocker, 'user-preferences.json'));
    assert.equal(blocked.update({ startAwake: true }).startAwake, false);
    assert.equal(statSync(blocker).isFile(), true);
    assert.equal(filePath.startsWith(os.tmpdir()), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('startup restores the trail and start-awake choices without restoring wandering', () => {
  const main = read('src/main/main.ts');
  const tray = read('src/main/tray.ts');
  const ready = main.indexOf('createUserPreferencesStore(');
  const overlay = main.indexOf('createOverlayWindow(');
  const wander = main.indexOf('let wander: WanderState = createWanderState()');
  const trail = main.indexOf('const trailWindow = createTrailWindow(');
  const restore = main.indexOf('if (savedPreferences.neonTrailEnabled)');
  const menu = main.indexOf('tray = createTray(');
  assert.ok(ready >= 0 && ready < overlay && overlay < wander && wander < trail && trail < restore && restore < menu);
  const firstFrame = main.slice(main.indexOf('onFirstFrame:'), main.indexOf('let wander: WanderState'));
  assert.match(firstFrame, /preferenceStore\.current\(\)\.startAwake/);
  assert.match(firstFrame, /overlay\?\.wake\(\)/);
  assert.equal(firstFrame.includes('enableWander'), false);
  assert.equal(firstFrame.includes('chat?.open'), false);
  assert.equal(firstFrame.includes('setEnabled'), false);
  const wake = main.slice(main.indexOf('onWander: (enabled)'), main.indexOf('onTrail: (action)'));
  assert.equal(wake.includes('preferenceStore'), false);
  assert.equal(wake.includes('user-preferences'), false);
  const sleep = main.slice(main.indexOf('onSleep:'), main.indexOf('onOpenChat:'));
  assert.match(sleep, /endWanderSession/);
  assert.match(sleep, /overlay\?\.sleep\(\)/);
  assert.equal(sleep.includes('neonTrailEnabled'), false);
  const shutdown = main.slice(main.indexOf('async function shutdown'), main.indexOf("app.on('second-instance'"));
  const closeAt = shutdown.indexOf('preferences?.close()');
  const timerAt = shutdown.indexOf('clearWanderTimer()');
  const destroyAt = shutdown.indexOf('trail?.destroy()');
  const quitAt = shutdown.indexOf('app.quit()');
  assert.ok(closeAt >= 0 && closeAt < timerAt && timerAt < destroyAt && destroyAt < quitAt);
  const gate = tray.indexOf('options.devMovement');
  const product = tray.slice(0, gate);
  const preferences = product.slice(product.indexOf("label: 'Preferences'"));
  assert.match(product, /label: 'Movement'/);
  assert.match(product, /label: 'Wandering'/);
  assert.match(product, /label: 'Neon Trail'/);
  assert.match(product, /checked: options\.isTrail\(\)/);
  assert.match(product, /checked: options\.isWandering\(\)/);
  assert.match(preferences, /label: 'Start Awake'/);
  assert.match(preferences, /checked: options\.isStartAwake\(\)/);
  assert.equal(preferences.includes('Neon Trail'), false);
  assert.equal(preferences.includes('Wandering'), false);
  assert.equal(product.includes('Test window move'), false);
  const refresh = tray.slice(tray.indexOf('const refresh'), tray.indexOf('const buildMenu'));
  assert.equal(refresh.includes('onStartAwake'), false);
  assert.equal(refresh.includes('update('), false);
  assert.equal(createWanderState().enabled, false);
  assert.equal(WANDER_FIRST_MIN_MS, 30_000);
  assert.equal(WANDER_EXPLORE_MS, 360_000);
});

test('preferences stay local and leave the validated product boundaries alone', () => {
  const store = read('src/shared/userPreferences.ts');
  const schema = store;
  const chat = read('src/main/chatWindow.ts');
  const provider = read('src/main/providerSettings.ts');
  const tts = read('src/main/ttsSettings.ts');
  const vault = read('src/shared/keyVault.ts');
  for (const line of store.split('\n').filter((entry) => entry.includes('console.log'))) {
    assert.equal(line.includes('filePath'), false);
    assert.equal(line.includes('userData'), false);
  }
  assert.equal(schema.includes('apiKey'), false);
  assert.equal(schema.includes('safeStorage'), false);
  assert.equal(store.includes('getUserMedia'), false);
  assert.equal(store.includes('fetch('), false);
  assert.equal(read('src/shared/ipc.ts').includes('user-preferences'), false);
  assert.equal(read('src/preload/preload.ts').includes('readFile'), false);
  assert.equal(read('src/preload/preload.ts').includes('user-preferences'), false);
  assert.equal(read('src/renderer/main.ts').includes('user-preferences'), false);
  assert.match(chat, /qwen-key\.bin/);
  assert.match(chat, /provider-settings\.json/);
  assert.match(chat, /tts-settings\.json/);
  assert.equal(chat.includes('user-preferences.json'), false);
  assert.match(provider, /provider-settings|sanitizeStoredSettings/);
  assert.match(tts, /autoRead/);
  assert.match(tts, /conversation/);
  assert.match(vault, /encrypt/);
  assert.equal(provider.includes('neonTrailEnabled'), false);
  assert.equal(tts.includes('startAwake'), false);
  const policy = contentSecurityPolicy(false);
  assert.equal(policy, "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'");
  const preferences = createOverlayWebPreferences('C:\\app\\preload.js', false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.webSecurity, true);
  assert.match(read('src/renderer/avatar/proceduralRobot.ts'), /TorusGeometry\(0\.15, 0\.06/);
  assert.equal(BODY_TILT_MAX, 0.08);
  assert.equal(ARM_LIFT_MAX, 0.36);
  assert.deepEqual(SECONDARY_GESTURES, ['none', 'nod', 'bounce', 'concern']);
  assert.equal(NUDGE_DIP, 120);
  assert.match(read('src/main/overlayWindow.ts'), /setIgnoreMouseEvents\(true\)/);
  assert.equal(read('src/shared/wander.ts').includes('setInterval'), false);
  assert.match(read('src/renderer/trail.ts'), /rgba\(57, 255, 46/);
  const idle = stepTrail(createTrailState(), {
    window: { x: 0, y: 0, width: 300, height: 400 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    travelPhase: 'idle',
    asleep: false,
    chatOpen: false,
    forceClear: false,
  }, 1_000);
  assert.equal(idle.spawned.length, 0);
  const page = read('src/renderer/chat.ts');
  const devTools = page.slice(page.indexOf('if (import.meta.env.DEV)'), page.indexOf("composer.addEventListener('input'"));
  assert.match(devTools, /Test window move/);
  assert.equal(page.slice(0, page.indexOf('if (import.meta.env.DEV)')).includes('Test body tilt'), false);
  const tray = read('src/main/tray.ts');
  assert.equal(tray.slice(0, tray.indexOf('options.devMovement')).includes('Test window move'), false);
  assert.match(tray.slice(tray.indexOf('options.devMovement')), /Test window move/);
  assert.equal(serializeUserPreferences(DEFAULT_USER_PREFERENCES).includes('wandering'), false);
});
