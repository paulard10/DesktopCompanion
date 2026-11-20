import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy } from './csp.ts';
import { IpcChannels } from './ipc.ts';
import { OVERLAY_ALWAYS_ON_TOP_LEVEL, createOverlayChrome, createOverlayWebPreferences } from './overlayOptions.ts';
import { resolvePackagedRendererFile } from './packagedPath.ts';
import { OVERLAY_HEIGHT_DIP, OVERLAY_WIDTH_DIP, placeOverlay } from './placement.ts';
import { isTrustedRendererUrl } from './trustedUrl.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

test('places the compact 216x224 window inside the primary work area', () => {
  const placed = placeOverlay({ x: 0, y: 0, width: 1920, height: 1040 });
  assert.equal(placed.width, OVERLAY_WIDTH_DIP);
  assert.equal(placed.height, OVERLAY_HEIGHT_DIP);
  assert.equal(placed.x, 1688);
  assert.equal(placed.y, 800);
});

test('keeps placement on a display with negative coordinates', () => {
  const workArea = { x: -1920, y: 0, width: 1920, height: 1080 };
  const placed = placeOverlay(workArea);
  assert.equal(placed.x, -232);
  assert.equal(placed.y, 840);
  assert.ok(placed.x >= workArea.x);
  assert.ok(placed.y >= workArea.y);
  assert.ok(placed.x + placed.width <= workArea.x + workArea.width);
  assert.ok(placed.y + placed.height <= workArea.y + workArea.height);
});

test('clamps the overlay when the work area is smaller than 216x224', () => {
  const placed = placeOverlay({ x: 10, y: 20, width: 200, height: 150 });
  assert.deepEqual(placed, { x: 10, y: 20, width: 200, height: 150 });
});

test('packaged protocol rejects traversal and unknown files', () => {
  const root = path.join('C:', 'app', 'dist', 'renderer');
  assert.equal(
    resolvePackagedRendererFile(root, 'app://companion/index.html'),
    path.join(root, 'index.html'),
  );
  assert.equal(
    resolvePackagedRendererFile(root, 'app://companion/assets/index-abc.js'),
    path.join(root, 'assets', 'index-abc.js'),
  );
  assert.equal(resolvePackagedRendererFile(root, 'app://companion/'), path.join(root, 'index.html'));
  assert.equal(resolvePackagedRendererFile(root, 'app://companion/../../package.json'), null);
  assert.equal(resolvePackagedRendererFile(root, 'app://companion/%2e%2e/%2e%2e/package.json'), null);
  assert.equal(resolvePackagedRendererFile(root, 'app://evil/index.html'), null);
  assert.equal(resolvePackagedRendererFile(root, 'https://example.com/index.html'), null);
  assert.equal(resolvePackagedRendererFile(root, 'app://companion/main.ts'), null);
});

test('trusts only the dev localhost origin or the app protocol', () => {
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/', true), true);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/index.html', true), true);
  assert.equal(isTrustedRendererUrl('http://localhost:5173/', true), false);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174/', true), false);
  assert.equal(isTrustedRendererUrl('https://127.0.0.1:5173/', true), false);
  assert.equal(isTrustedRendererUrl('app://companion/index.html', false), true);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/', false), false);
  assert.equal(isTrustedRendererUrl('app://companion/index.html', true), false);
  assert.equal(isTrustedRendererUrl('not a url', false), false);
});

test('production CSP has no network, eval, or inline script exception', () => {
  const policy = contentSecurityPolicy(false);
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src 'none'/);
  assert.equal(policy.includes('unsafe-inline'), false);
  assert.equal(policy.includes('unsafe-eval'), false);
  assert.equal(policy.includes('http:'), false);
  assert.equal(policy.includes('ws:'), false);
});

test('development CSP allows only the local Vite socket', () => {
  const policy = contentSecurityPolicy(true);
  assert.match(policy, /connect-src 'self' http:\/\/127\.0\.0\.1:5173 ws:\/\/127\.0\.0\.1:5173/);
  assert.equal(policy.includes('unsafe-eval'), false);
  assert.equal(policy.includes('unsafe-inline'), false);
});

test('overlay chrome stays frameless, transparent, and above normal windows', () => {
  const chrome = createOverlayChrome();
  assert.equal(chrome.frame, false);
  assert.equal(chrome.transparent, true);
  assert.equal(chrome.hasShadow, false);
  assert.equal(chrome.show, false);
  assert.equal(chrome.focusable, false);
  assert.equal(chrome.skipTaskbar, true);
  assert.equal(chrome.backgroundColor, '#00000000');
  assert.equal(chrome.backgroundMaterial, 'none');
  assert.equal(OVERLAY_ALWAYS_ON_TOP_LEVEL, 'floating');
});

test('renderer webPreferences stay sandboxed', () => {
  const preferences = createOverlayWebPreferences('C:\\app\\preload.js', false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webSecurity, true);
  assert.equal(preferences.devTools, false);
  assert.equal(preferences.nodeIntegrationInWorker, false);
  assert.equal(preferences.nodeIntegrationInSubFrames, false);
});

test('preload exposes frame, click, cursor, and behavior channels without invoke', () => {
  const source = readFileSync(path.join(here, '../preload/preload.ts'), 'utf8');
  assert.equal(source.includes(IpcChannels.frameReady), true);
  assert.equal(source.includes(IpcChannels.circleClick), true);
  assert.equal(source.includes(IpcChannels.cursorSample), true);
  assert.equal(source.includes(IpcChannels.behavior), true);
  assert.equal(source.includes(IpcChannels.phase), true);
  assert.equal(source.includes(IpcChannels.openChat), true);
  assert.equal(source.includes(IpcChannels.gesture), true);
  assert.match(source, /contextBridge\.exposeInMainWorld\(\s*'companion'/);
  assert.equal(source.includes('ipcRenderer.invoke'), false);
  assert.equal(source.includes('setIgnoreMouseEvents'), false);
  assert.equal(source.includes(IpcChannels.selectScreen), true);
  assert.equal((source.match(/ipcRenderer\.send\(/g) ?? []).length, 5);
  assert.equal(source.includes('exposeInMainWorld(\'electron\''), false);
  assert.equal(source.includes('exposeInMainWorld("ipcRenderer"'), false);
});
