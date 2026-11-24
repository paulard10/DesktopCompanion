import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy } from './csp.ts';
import { NUDGE_DIP } from './desktopMovement.ts';
import { createOverlayWebPreferences } from './overlayOptions.ts';
import { BODY_TILT_MAX } from './secondaryMotion.ts';
import { parseUserPreferences, serializeUserPreferences } from './userPreferences.ts';
import { createWanderState } from './wander.ts';
import {
  APP_USER_MODEL_ID,
  LOGIN_STARTUP_ARGS,
  createLoginStartupController,
  expectedInstalledExecutable,
  isVerifiedInstalledExecutable,
  loginStartupAvailable,
  loginStartupMenuItem,
  inspectOwnLoginStartup,
  startupWillLaunch,
  uninstallRemovesLoginValue,
  type LoginLaunchItem,
  type LoginStartupAdapter,
  type LoginStartupEnvironment,
  type LoginStartupQuery,
  type LoginStartupSnapshot,
  type LoginStartupWrite,
} from './windowsLoginStartup.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');
const localAppData = 'C:\\Users\\Usuario\\AppData\\Local';
const execPath = 'C:\\Users\\Usuario\\AppData\\Local\\Programs\\DesktopCompanion\\DesktopCompanion.exe';
const installDir = 'C:\\Users\\Usuario\\AppData\\Local\\Programs\\DesktopCompanion';

function installedEnv(patch: Partial<LoginStartupEnvironment> = {}): LoginStartupEnvironment {
  return {
    platform: 'win32',
    execPath,
    localAppData,
    dev: false,
    smoke: false,
    exists: () => true,
    ...patch,
  };
}

function ownItem(patch: Partial<LoginLaunchItem> = {}): LoginLaunchItem {
  return {
    name: APP_USER_MODEL_ID,
    path: execPath,
    args: [],
    scope: 'user',
    enabled: true,
    ...patch,
  };
}

function registeredSnapshot(patch: Partial<LoginStartupSnapshot> = {}): LoginStartupSnapshot {
  return {
    openAtLogin: true,
    executableWillLaunchAtLogin: true,
    launchItems: [ownItem()],
    ...patch,
  };
}

interface MemoryOptions {
  failWrite?: () => boolean;
  failRead?: () => boolean;
  extraItems?: readonly LoginLaunchItem[];
}

function memoryAdapter(options: MemoryOptions = {}): LoginStartupAdapter & {
  writes: LoginStartupWrite[];
  reads: LoginStartupQuery[];
} {
  let stored: LoginStartupWrite | null = null;
  const writes: LoginStartupWrite[] = [];
  const reads: LoginStartupQuery[] = [];
  return {
    writes,
    reads,
    read: (query) => {
      reads.push(query);
      if (options.failRead?.() === true) {
        throw new Error('read failed');
      }
      const items: LoginLaunchItem[] = [];
      let openAtLogin = false;
      let executableWillLaunchAtLogin = false;
      if (stored && samePath(stored.path, query.path)) {
        openAtLogin = stored.name === APP_USER_MODEL_ID && sameList(stored.args, query.args);
        items.push(ownItem({ path: stored.path, args: stored.args, enabled: stored.openAtLogin }));
        executableWillLaunchAtLogin = stored.openAtLogin;
      }
      for (const extra of options.extraItems ?? []) {
        if (samePath(extra.path, query.path)) {
          items.push(extra);
          executableWillLaunchAtLogin = executableWillLaunchAtLogin || extra.enabled;
        }
      }
      return { openAtLogin, executableWillLaunchAtLogin, launchItems: items };
    },
    write: (settings) => {
      writes.push(settings);
      if (options.failWrite?.() === true) {
        throw new Error('write failed');
      }
      stored = settings.openAtLogin
        ? { ...settings, args: [...settings.args] }
        : null;
    },
  };
}

function samePath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

test('Windows login startup defaults off', () => {
  const adapter = memoryAdapter();
  const controller = createLoginStartupController(installedEnv(), adapter);
  assert.equal(controller.available(), true);
  assert.equal(controller.checked(), false);
  assert.equal(adapter.writes.length, 0);
  assert.equal(LOGIN_STARTUP_ARGS.length, 0);
  assert.deepEqual(loginStartupMenuItem(true, false), {
    label: 'Start with Windows',
    type: 'checkbox',
    checked: false,
    enabled: true,
  });
});

test('an explicit enable registers only the current user executable and args', () => {
  const adapter = memoryAdapter();
  const controller = createLoginStartupController(installedEnv(), adapter);
  const result = controller.setEnabled(true);
  assert.deepEqual(result, { ok: true, checked: true, reason: 'ok' });
  assert.equal(adapter.writes.length, 1);
  assert.equal(adapter.writes[0]?.path, execPath);
  assert.equal(adapter.writes[0]?.path.startsWith('"'), false);
  assert.deepEqual(adapter.writes[0], {
    openAtLogin: true,
    path: execPath,
    args: [],
    name: APP_USER_MODEL_ID,
    enabled: true,
  });
  assert.deepEqual(adapter.reads[0], { path: execPath, args: [] });
  assert.equal(controller.checked(), true);
});

test('a user path containing spaces stays unquoted for Electron and quoted in the registry command', () => {
  const spacedRoot = 'C:\\Users\\Some User\\AppData\\Local';
  const spacedExe = 'C:\\Users\\Some User\\AppData\\Local\\Programs\\DesktopCompanion\\DesktopCompanion.exe';
  const spacedDir = 'C:\\Users\\Some User\\AppData\\Local\\Programs\\DesktopCompanion';
  assert.equal(spacedExe.includes(' '), true);
  const adapter = memoryAdapter();
  const controller = createLoginStartupController(installedEnv({
    execPath: spacedExe,
    localAppData: spacedRoot,
  }), adapter);
  assert.equal(controller.setEnabled(true).reason, 'ok');
  assert.equal(adapter.writes[0]?.path, spacedExe);
  assert.equal(adapter.writes[0]?.path.includes('"'), false);
  assert.deepEqual(adapter.reads.at(-1), { path: spacedExe, args: [] });
  assert.equal(uninstallRemovesLoginValue(`"${spacedExe}"`, spacedDir), true);
  assert.equal(startupWillLaunch(registeredSnapshot({
    launchItems: [ownItem({ path: `"${spacedExe}"` })],
  }), spacedExe), true);
});

test('an explicit disable removes the registration', () => {
  const adapter = memoryAdapter();
  const controller = createLoginStartupController(installedEnv(), adapter);
  assert.equal(controller.setEnabled(true).ok, true);
  const removed = controller.setEnabled(false);
  assert.deepEqual(removed, { ok: true, checked: false, reason: 'ok' });
  assert.equal(adapter.writes.at(-1)?.openAtLogin, false);
  assert.equal(adapter.writes.at(-1)?.name, APP_USER_MODEL_ID);
  assert.equal(adapter.writes.at(-1)?.enabled, true);
  assert.equal(controller.checked(), false);
});

test('the checkbox follows the login-item snapshot for this executable', () => {
  const unrelated: LoginLaunchItem = {
    name: 'Some Other App',
    path: execPath,
    args: [],
    scope: 'user',
    enabled: true,
  };
  assert.equal(startupWillLaunch(registeredSnapshot({ launchItems: [unrelated, ownItem()] }), execPath), true);
  assert.equal(startupWillLaunch(registeredSnapshot({
    executableWillLaunchAtLogin: true,
    launchItems: [unrelated],
  }), execPath), false);
  assert.equal(startupWillLaunch(registeredSnapshot({
    openAtLogin: false,
    launchItems: [ownItem({ path: 'C:\\Old\\DesktopCompanion.exe' })],
    executableWillLaunchAtLogin: false,
  }), execPath), false);
  const extraArgs = registeredSnapshot({
    openAtLogin: false,
    executableWillLaunchAtLogin: true,
    launchItems: [ownItem({ args: ['--hidden'] })],
  });
  assert.equal(startupWillLaunch(extraArgs, execPath), true);
  assert.deepEqual(inspectOwnLoginStartup(extraArgs, execPath), {
    registered: true,
    effectivelyEnabled: true,
    canonical: false,
  });
  assert.equal(startupWillLaunch(registeredSnapshot({
    openAtLogin: false,
    executableWillLaunchAtLogin: true,
    launchItems: [ownItem({ scope: 'machine' })],
  }), execPath), false);
  assert.equal(startupWillLaunch(registeredSnapshot({
    executableWillLaunchAtLogin: true,
    launchItems: [ownItem({ name: 'desktop-companion' })],
  }), execPath), false);
  assert.equal(startupWillLaunch(registeredSnapshot({
    launchItems: [ownItem({ path: execPath.toUpperCase() })],
  }), execPath), true);
  assert.equal(startupWillLaunch(registeredSnapshot({
    launchItems: [ownItem({ path: `"${execPath}"` })],
  }), execPath), true);
});

test('a Windows external disable is shown unchecked and is not rewritten by a read', () => {
  let enabled = true;
  const adapter: LoginStartupAdapter & { writes: number } = {
    writes: 0,
    read: () => registeredSnapshot({
      executableWillLaunchAtLogin: enabled,
      launchItems: [ownItem({ enabled })],
    }),
    write: () => {
      adapter.writes += 1;
    },
  };
  const controller = createLoginStartupController(installedEnv(), adapter);
  assert.equal(controller.checked(), true);
  enabled = false;
  const disabled = adapter.read({ path: execPath, args: [] });
  assert.deepEqual(inspectOwnLoginStartup(disabled, execPath), {
    registered: true,
    effectivelyEnabled: false,
    canonical: true,
  });
  assert.equal(controller.checked(), false);
  assert.equal(adapter.writes, 0);
});

test('a failed registration does not report success', () => {
  const adapter = memoryAdapter({ failWrite: () => true });
  const controller = createLoginStartupController(installedEnv(), adapter);
  assert.deepEqual(controller.setEnabled(true), { ok: false, checked: false, reason: 'write-failed' });
  assert.equal(controller.checked(), false);
  const removal = memoryAdapter();
  const enabled = createLoginStartupController(installedEnv(), removal);
  assert.equal(enabled.setEnabled(true).ok, true);
  removal.write = () => {
    throw new Error('removal failed');
  };
  assert.deepEqual(enabled.setEnabled(false), { ok: false, checked: true, reason: 'write-failed' });
  assert.equal(enabled.checked(), true);
  let failRead = false;
  const reread = memoryAdapter({ failRead: () => failRead });
  const reading = createLoginStartupController(installedEnv(), reread);
  failRead = true;
  assert.deepEqual(reading.setEnabled(true), { ok: false, checked: false, reason: 'read-failed' });
  const mismatch: LoginStartupAdapter = {
    read: () => registeredSnapshot({ openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] }),
    write: () => undefined,
  };
  assert.deepEqual(createLoginStartupController(installedEnv(), mismatch).setEnabled(true), {
    ok: false,
    checked: false,
    reason: 'mismatch',
  });
  const stillDisabled: LoginStartupAdapter = {
    read: () => registeredSnapshot({
      openAtLogin: true,
      executableWillLaunchAtLogin: false,
      launchItems: [ownItem({ enabled: false })],
    }),
    write: () => undefined,
  };
  assert.deepEqual(createLoginStartupController(installedEnv(), stillDisabled).setEnabled(true), {
    ok: false,
    checked: false,
    reason: 'mismatch',
  });
  const unrelated = new Set(['Some Other App']);
  const preserved: LoginStartupAdapter = {
    read: () => ({
      openAtLogin: unrelated.has(APP_USER_MODEL_ID),
      executableWillLaunchAtLogin: true,
      launchItems: [...unrelated].map((name) => ownItem({
        name,
        enabled: true,
        path: name === APP_USER_MODEL_ID ? execPath : 'C:\\Other\\app.exe',
      })),
    }),
    write: (settings) => {
      assert.equal(settings.name, APP_USER_MODEL_ID);
      if (settings.openAtLogin) {
        unrelated.add(settings.name);
      } else {
        unrelated.delete(settings.name);
      }
    },
  };
  assert.equal(createLoginStartupController(installedEnv(), preserved).setEnabled(false).ok, true);
  assert.equal(unrelated.has('Some Other App'), true);
  assert.equal(unrelated.has(APP_USER_MODEL_ID), false);
});

test('repeated enable and disable follow the latest operating-system read', () => {
  const adapter = memoryAdapter();
  const controller = createLoginStartupController(installedEnv(), adapter);
  assert.equal(controller.setEnabled(true).checked, true);
  assert.equal(controller.setEnabled(false).checked, false);
  assert.equal(controller.setEnabled(true).checked, true);
  assert.equal(controller.setEnabled(true).reason, 'ok');
  assert.equal(adapter.writes.length, 4);
  assert.equal(controller.checked(), true);
});

test('development mode cannot register startup', () => {
  let existsCalls = 0;
  const adapter = memoryAdapter();
  const env = installedEnv({
    dev: true,
    exists: () => {
      existsCalls += 1;
      return true;
    },
  });
  const controller = createLoginStartupController(env, adapter);
  assert.equal(loginStartupAvailable(env), false);
  assert.equal(controller.setEnabled(true).reason, 'unavailable');
  assert.equal(adapter.writes.length, 0);
  assert.equal(adapter.reads.length, 0);
  assert.equal(existsCalls, 0);
  assert.deepEqual(loginStartupMenuItem(false, true), {
    label: 'Start with Windows',
    type: 'checkbox',
    checked: false,
    enabled: false,
  });
});

test('an unpacked test build cannot register startup', () => {
  const unpacked = 'C:\\repo\\release\\win-unpacked\\DesktopCompanion.exe';
  const poisonedRoot = 'C:\\repo\\release\\win-unpacked';
  const poisonedExe = 'C:\\repo\\release\\win-unpacked\\Programs\\DesktopCompanion\\DesktopCompanion.exe';
  assert.equal(isVerifiedInstalledExecutable(unpacked, localAppData), false);
  assert.equal(isVerifiedInstalledExecutable(poisonedExe, poisonedRoot), false);
  const adapter = memoryAdapter();
  const controller = createLoginStartupController(installedEnv({ execPath: unpacked }), adapter);
  assert.equal(controller.setEnabled(true).reason, 'unavailable');
  assert.equal(adapter.writes.length, 0);
});

test('only the per-user installed executable can be registered', () => {
  assert.equal(expectedInstalledExecutable(localAppData), execPath);
  assert.equal(isVerifiedInstalledExecutable(execPath, localAppData), true);
  assert.equal(isVerifiedInstalledExecutable(execPath, undefined), false);
  assert.equal(isVerifiedInstalledExecutable(execPath, '   '), false);
  const rejected = [
    'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
    'C:\\Users\\Usuario\\AppData\\Local\\Programs\\cursor\\Cursor.exe',
    'C:\\Program Files\\nodejs\\npm.cmd',
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\repo\\node_modules\\vite\\bin\\vite.cmd',
    'C:\\Program Files\\DesktopCompanion\\DesktopCompanion.exe',
    'C:\\repo\\release\\win-unpacked\\DesktopCompanion.exe',
  ];
  for (const candidate of rejected) {
    assert.equal(isVerifiedInstalledExecutable(candidate, localAppData), false, candidate);
  }
  let existsCalls = 0;
  const missing = createLoginStartupController(installedEnv({
    exists: () => {
      existsCalls += 1;
      return false;
    },
  }), memoryAdapter());
  assert.equal(missing.setEnabled(true).reason, 'unavailable');
  assert.equal(existsCalls, 1);
  const brokenDisk = createLoginStartupController(installedEnv({
    exists: () => {
      throw new Error('disk');
    },
  }), memoryAdapter());
  assert.equal(brokenDisk.available(), false);
  assert.equal(createLoginStartupController(installedEnv({ platform: 'darwin' }), memoryAdapter()).available(), false);
  assert.equal(createLoginStartupController(installedEnv({ smoke: true }), memoryAdapter()).setEnabled(true).reason, 'unavailable');
});

test('startup registration does not bypass the single-instance lock', () => {
  const main = read('src/main/main.ts');
  const shared = read('src/shared/windowsLoginStartup.ts');
  const bridge = read('src/main/windowsLoginStartup.ts');
  assert.ok(main.indexOf('requestSingleInstanceLock') < main.indexOf('app.whenReady'));
  assert.match(main, /second-instance-exit/);
  assert.equal(shared.includes('requestSingleInstanceLock'), false);
  assert.equal(bridge.includes('requestSingleInstanceLock'), false);
  assert.equal(shared.includes('child_process'), false);
  assert.equal(bridge.includes('child_process'), false);
  assert.equal((main.match(/loginStartup\.setEnabled/g) ?? []).length, 1);
});

test('Start with Windows does not change Start Awake', () => {
  const main = read('src/main/main.ts');
  const awake = main.slice(main.indexOf('onStartAwake:'), main.indexOf('startupAvailable:'));
  const startup = main.slice(main.indexOf('onStartWithWindows:'), main.indexOf('devMovement:'));
  assert.match(awake, /preferenceStore\.update\(\{ startAwake: enabled \}\)/);
  assert.equal(awake.includes('loginStartup'), false);
  assert.equal(startup.includes('preferenceStore'), false);
  assert.equal(startup.includes('startAwake'), false);
  const adapter = memoryAdapter();
  const controller = createLoginStartupController(installedEnv(), adapter);
  assert.equal(controller.setEnabled(true).ok, true);
  assert.equal(read('src/shared/userPreferences.ts').includes('startWithWindows'), false);
});

test('wandering still starts off when login startup is available', () => {
  assert.equal(createWanderState().enabled, false);
  const main = read('src/main/main.ts');
  assert.match(main, /let wander: WanderState = createWanderState\(\)/);
  const shared = read('src/shared/windowsLoginStartup.ts');
  const bridge = read('src/main/windowsLoginStartup.ts');
  assert.equal(shared.toLowerCase().includes('wander'), false);
  assert.equal(bridge.toLowerCase().includes('wander'), false);
  assert.equal(main.slice(main.indexOf('onStartWithWindows:'), main.indexOf('devMovement:')).includes('enableWander'), false);
});

test('login startup does not arm the microphone', () => {
  const shared = read('src/shared/windowsLoginStartup.ts');
  const bridge = read('src/main/windowsLoginStartup.ts');
  const handler = read('src/main/main.ts').slice(
    read('src/main/main.ts').indexOf('onStartWithWindows:'),
    read('src/main/main.ts').indexOf('devMovement:'),
  );
  for (const source of [shared, bridge, handler]) {
    assert.equal(source.includes('getUserMedia'), false);
    assert.equal(source.includes('desktopCapturer'), false);
    assert.equal(source.includes('localSpeech'), false);
    assert.equal(source.includes('whisper'), false);
    assert.equal(source.includes('speech:arm'), false);
  }
});

test('login startup does not send a Qwen request', () => {
  const shared = read('src/shared/windowsLoginStartup.ts');
  const bridge = read('src/main/windowsLoginStartup.ts');
  const handler = read('src/main/main.ts').slice(
    read('src/main/main.ts').indexOf('onStartWithWindows:'),
    read('src/main/main.ts').indexOf('devMovement:'),
  );
  for (const source of [shared, bridge, handler]) {
    assert.equal(source.includes('qwen'), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('chat?.open'), false);
    assert.equal(source.includes('net.request'), false);
  }
});

test('the tray checkbox is rebuilt from the operating-system read', () => {
  const tray = read('src/main/tray.ts');
  const startup = tray.slice(tray.indexOf('const startup = loginStartupMenuItem'), tray.indexOf("label: 'Recovery:"));
  assert.match(startup, /options\.startupAvailable \? options\.isStartWithWindows\(\) : false/);
  assert.match(startup, /if \(!startup\.enabled\)/);
  assert.ok(startup.indexOf('onStartWithWindows') < startup.lastIndexOf('refresh()'));
  const main = read('src/main/main.ts');
  assert.ok(main.indexOf('setAppUserModelId(APP_USER_MODEL_ID)') < main.indexOf('createInstalledLoginStartup(dev, smoke)'));
  assert.match(main, /isStartWithWindows: \(\) => loginStartup\.checked\(\)/);
  assert.match(tray, /tray\.on\('right-click'/);
  let enabled = false;
  const adapter: LoginStartupAdapter = {
    read: () => registeredSnapshot({
      openAtLogin: enabled,
      executableWillLaunchAtLogin: enabled,
      launchItems: [ownItem({ enabled })],
    }),
    write: (settings) => {
      if (settings.openAtLogin) {
        throw new Error('registry rejected the write');
      }
      enabled = false;
    },
  };
  const controller = createLoginStartupController(installedEnv(), adapter);
  assert.equal(controller.setEnabled(true).ok, false);
  assert.equal(controller.checked(), false);
  assert.equal(loginStartupMenuItem(true, controller.checked()).checked, false);
});

test('uninstall cleanup owns only this app per-user startup value', () => {
  const quoted = `"${execPath}"`;
  assert.equal(uninstallRemovesLoginValue(quoted, installDir), true);
  assert.equal(uninstallRemovesLoginValue(quoted.toUpperCase(), installDir), true);
  assert.equal(uninstallRemovesLoginValue(`${quoted} --updated`, installDir), true);
  assert.equal(uninstallRemovesLoginValue(execPath, installDir), true);
  assert.equal(uninstallRemovesLoginValue(null, installDir), false);
  assert.equal(uninstallRemovesLoginValue('', installDir), false);
  assert.equal(uninstallRemovesLoginValue(quoted, ''), false);
  assert.equal(uninstallRemovesLoginValue('"C:\\Program Files\\DesktopCompanion\\DesktopCompanion.exe"', installDir), false);
  assert.equal(uninstallRemovesLoginValue(`notepad.exe ${quoted}`, installDir), false);
  assert.equal(uninstallRemovesLoginValue(`"${installDir}\\DesktopCompanion.exe.bak"`, installDir), false);
  const nsh = read('build/installer.nsh');
  const uninstall = nsh.slice(nsh.indexOf('!macro customUnInstall'), nsh.indexOf('!macroend', nsh.indexOf('!macro customUnInstall')));
  const installMode = nsh.slice(nsh.indexOf('!macro customInstallMode'), nsh.indexOf('!macroend'));
  assert.match(installMode, /StrCpy \$isForceCurrentInstall "1"/);
  assert.equal(installMode.includes('DeleteRegValue'), false);
  assert.equal(nsh.includes('WriteReg'), false);
  assert.equal(nsh.includes('HKLM'), false);
  assert.equal(nsh.includes('HKEY_LOCAL_MACHINE'), false);
  assert.equal(nsh.includes('user-preferences'), false);
  assert.equal(nsh.includes('qwen'), false);
  assert.equal(/!macro customInstall\s/.test(nsh), false);
  assert.ok(uninstall.indexOf('${If} ${isUpdated}') < uninstall.indexOf('DeleteRegValue'));
  const deletes = [...uninstall.matchAll(/DeleteRegValue HKCU "([^"]+)" "([^"]+)"/g)];
  assert.deepEqual(deletes.map((match) => [match[1], match[2]]), [
    ['Software\\Microsoft\\Windows\\CurrentVersion\\Run', APP_USER_MODEL_ID],
    ['Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run', APP_USER_MODEL_ID],
  ]);
  assert.match(uninstall, /ReadRegStr \$R0 HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "com\.desktopcompanion\.shell"/);
});

test('login startup stays in the main process and keeps the sandbox', () => {
  const shared = read('src/shared/windowsLoginStartup.ts');
  const bridge = read('src/main/windowsLoginStartup.ts');
  assert.equal(shared.includes('setLoginItemSettings'), false);
  assert.equal(shared.includes("from 'electron'"), false);
  assert.equal(shared.includes('ipcMain'), false);
  assert.match(bridge, /setLoginItemSettings/);
  assert.match(bridge, /enabled: true/);
  assert.equal(read('src/main/main.ts').includes('setLoginItemSettings'), false);
  assert.equal(read('src/preload/preload.ts').includes('windowsLoginStartup'), false);
  assert.equal(read('src/preload/chatPreload.ts').includes('setLoginItemSettings'), false);
  assert.equal(read('src/renderer/main.ts').includes('setLoginItemSettings'), false);
  assert.equal(read('src/shared/ipc.ts').includes('setLoginItemSettings'), false);
  const preferences = createOverlayWebPreferences('C:\\app\\preload.js', false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.webSecurity, true);
  assert.match(contentSecurityPolicy(false), /connect-src 'none'/);
  assert.equal(read('src/main/localSpeech.ts').includes('MINIMUM_ASR_AVAILABLE_BYTES = 1024 * 1048576'), true);
});

test('existing preference documents do not gain a startup field', () => {
  const parsed = parseUserPreferences('{"version":1,"neonTrailEnabled":true,"startAwake":false,"startWithWindows":true}');
  assert.equal(parsed.preferences.startAwake, false);
  assert.equal(parsed.preferences.manualSleep, false);
  assert.equal(parsed.preferences.followCursor, true);
  assert.equal(serializeUserPreferences(parsed.preferences).includes('startWithWindows'), false);
  assert.equal(read('src/shared/userPreferences.ts').includes('setLoginItemSettings'), false);
});

test('movement and animation sources stay independent of login startup', () => {
  assert.equal(NUDGE_DIP, 120);
  assert.equal(BODY_TILT_MAX, 0.08);
  assert.equal(createWanderState().enabled, false);
  const shared = read('src/shared/windowsLoginStartup.ts');
  const bridge = read('src/main/windowsLoginStartup.ts');
  for (const source of [shared, bridge]) {
    assert.equal(source.includes('desktopMovement'), false);
    assert.equal(source.includes('neonTrail'), false);
    assert.equal(source.includes('gesturePose'), false);
    assert.equal(source.includes('TorusGeometry'), false);
    assert.equal(source.includes('WebGLRenderer'), false);
  }
  assert.match(read('src/renderer/avatar/proceduralRobot.ts'), /TorusGeometry\(0\.15, 0\.06/);
  assert.match(read('src/main/main.ts'), /preferenceStore\.current\(\)\.startAwake/);
});
