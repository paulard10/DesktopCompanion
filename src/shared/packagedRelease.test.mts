import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy } from './csp.ts';
import { createOverlayWebPreferences } from './overlayOptions.ts';
import {
  companionChatPreload,
  companionPreload,
  companionRendererRoot,
  companionSpeechRoot,
  companionTrailPreload,
  resolveTrayIcon,
} from './packagedLayout.ts';
import { createWanderState } from './wander.ts';
import { DEFAULT_USER_PREFERENCES } from './userPreferences.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');

test('packaged paths stay beside the compiled main file and outside the archive for the tray icon', () => {
  const unpackaged = path.join('C:', 'app', 'dist', 'main');
  assert.equal(companionPreload(unpackaged), path.join('C:', 'app', 'dist', 'preload', 'preload.js'));
  assert.equal(companionChatPreload(unpackaged), path.join('C:', 'app', 'dist', 'preload', 'chatPreload.js'));
  assert.equal(companionTrailPreload(unpackaged), path.join('C:', 'app', 'dist', 'preload', 'trailPreload.js'));
  assert.equal(companionRendererRoot(unpackaged), path.join('C:', 'app', 'dist', 'renderer'));
  assert.equal(resolveTrayIcon(unpackaged, () => false), path.join('C:', 'app', 'assets', 'tray.png'));
  const packed = path.join('C:', 'Program', 'resources', 'app.asar', 'dist', 'main');
  const unpackedIcon = path.join('C:', 'Program', 'resources', 'app.asar.unpacked', 'assets', 'tray.png');
  assert.equal(resolveTrayIcon(packed, (candidate) => candidate === unpackedIcon), unpackedIcon);
  assert.equal(resolveTrayIcon(packed, () => false), path.join('C:', 'Program', 'resources', 'app.asar', 'assets', 'tray.png'));
  assert.equal(companionSpeechRoot(path.join('C:', 'Program', 'resources')), path.join('C:', 'Program', 'resources', 'speech'));
  assert.equal(companionSpeechRoot(path.join('C:', 'Program', 'resources')).includes('.local-asr'), false);
});

test('the Windows package allowlist keeps secrets, Whisper, and research out of the app', () => {
  const config = read('electron-builder.yml');
  const manifest = read('package.json');
  assert.match(config, /appId: com\.desktopcompanion\.shell/);
  assert.match(config, /productName: desktop-companion/);
  assert.match(config, /executableName: DesktopCompanion/);
  assert.match(config, /output: release/);
  assert.match(config, /target: dir/);
  assert.match(config, /target: nsis/);
  assert.match(config, /oneClick: false/);
  assert.match(config, /perMachine: false/);
  assert.match(config, /allowElevation: false/);
  assert.match(config, /allowToChangeInstallationDirectory: false/);
  assert.match(config, /createStartMenuShortcut: true/);
  assert.match(config, /createDesktopShortcut: false/);
  assert.match(config, /runAfterFinish: false/);
  assert.match(config, /packElevateHelper: false/);
  assert.match(config, /deleteAppDataOnUninstall: false/);
  assert.match(config, /differentialPackage: false/);
  assert.match(config, /shortcutName: DesktopCompanion/);
  assert.match(config, /uninstallDisplayName: DesktopCompanion/);
  assert.match(config, /include: installer\.nsh/);
  assert.match(config, /artifactName: DesktopCompanion-Setup-\$\{version\}-\$\{arch\}\.\$\{ext\}/);
  assert.match(config, /asar: true/);
  assert.match(config, /- assets\/tray\.png/);
  assert.match(config, /publish: null/);
  assert.match(config, /!node_modules\/\*\*/);
  assert.match(config, /!\*\*\/\*\.map/);
  assert.match(config, /extraResources: \[\]/);
  for (const forbidden of ['.local-asr', 'qwen-key.bin', 'provider-settings.json', 'tts-settings.json', 'user-preferences.json', 'ggml-tiny.bin', 'whisper-cli.exe', '.env']) {
    assert.match(config, new RegExp(`!\\*\\*/${forbidden.replaceAll('.', '\\.')}`));
  }
  assert.match(config, /!\*\*\/docs\/\*\*/);
  assert.match(config, /!\*\*\/references\/\*\*/);
  assert.match(config, /!\*\*\/graphify-out\/\*\*/);
  assert.equal(config.includes('nsis-web'), false);
  assert.equal(config.includes('publish: github'), false);
  assert.match(read('build/installer.nsh'), /StrCpy \$isForceCurrentInstall "1"/);
  assert.match(manifest, /"package:win": "npm run build && electron-builder --win --x64 --dir"/);
  assert.match(manifest, /"package:installer": "npm run build && electron-builder --win nsis --x64"/);
  assert.equal(manifest.includes('"productName"'), false);
  assert.match(manifest, /"name": "desktop-companion"/);
  assert.match(manifest, /"version": "0\.1\.2"/);
  const main = read('src/main/main.ts');
  assert.match(main, /user-preferences\.json/);
  assert.match(main, /app\.getPath\('userData'\)/);
  assert.match(main, /setAppUserModelId\(APP_USER_MODEL_ID\)/);
  assert.match(read('src/shared/windowsLoginStartup.ts'), /com\.desktopcompanion\.shell/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /second-instance-exit/);
  assert.match(main, /let wander: WanderState = createWanderState\(\)/);
  assert.equal(createWanderState().enabled, false);
  assert.equal(DEFAULT_USER_PREFERENCES.neonTrailEnabled, true);
  assert.equal(DEFAULT_USER_PREFERENCES.startAwake, false);
  assert.match(main, /const released = !smoke/);
  assert.match(main, /enabled: released/);
  assert.match(main, /page: dev \? SELECTION_PAGE : SELECTION_APP_PAGE/);
  assert.match(main, /SELECTION_APP_PAGE/);
  assert.match(read('src/main/screenSelectionWindow.ts'), /app:\/\/companion\/screen-selection\.html/);
  assert.match(read('src/renderer/main.ts'), /screenAsk\.hidden = !show \|\| !screenAskVisible\(currentPhase\)/);
  const transport = read('src/main/qwenVisionTransport.ts');
  const admittedStart = transport.indexOf('export async function executeAdmittedScreenVisionPost');
  const admittedGate = transport.slice(admittedStart, transport.indexOf('const wire = takeScreenVisionSendAdmission', admittedStart));
  assert.equal(admittedGate.includes('isPackaged'), false);
  assert.equal(admittedGate.includes('DESKTOP_COMPANION_DEV'), false);
  assert.match(transport.slice(0, admittedStart), /if \(app\.isPackaged\)/);
  assert.match(main, /if \(savedPreferences\.neonTrailEnabled\)/);
  assert.match(main, /preferenceStore\.current\(\)\.startAwake/);
  assert.match(main, /preferences\?\.close\(\)/);
  assert.match(main, /clearWanderTimer\(\)/);
  assert.match(main, /trail\?\.destroy\(\)/);
  const overlay = read('src/main/overlayWindow.ts');
  assert.match(overlay, /app:\/\/companion\/index\.html/);
  assert.match(overlay, /companionPreload\(__dirname\)/);
  assert.match(overlay, /companionRendererRoot\(__dirname\)/);
  assert.equal(overlay.includes('http://127.0.0.1:5173/') && overlay.includes('options.dev'), true);
  const chat = read('src/main/chatWindow.ts');
  assert.match(chat, /app:\/\/companion\/chat\.html/);
  assert.match(chat, /process\.resourcesPath, 'speech'/);
  assert.match(chat, /\.local-asr/);
  assert.match(chat, /app\.isPackaged/);
  assert.match(chat, /resolveTrayIcon\(__dirname\)/);
  const tray = read('src/main/tray.ts');
  assert.match(tray, /resolveTrayIcon\(__dirname\)/);
  assert.equal(tray.slice(0, tray.indexOf('options.devMovement')).includes('Test window move'), false);
  const preferences = createOverlayWebPreferences('C:\\app\\preload.js', false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.webSecurity, true);
  assert.match(contentSecurityPolicy(false), /connect-src 'none'/);
  assert.equal(read('src/main/localSpeech.ts').includes('MINIMUM_ASR_AVAILABLE_BYTES = 1024 * 1048576'), true);
});
