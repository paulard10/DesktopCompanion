/** First-party hidden renderer proof, not a desktop screenshot or Home opt-in.
 * Requires npm run build. Run with: node scripts/home-render-check.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.versions.electron) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempRoot, 'desktop-companion-home-render-'));
  const env = { ...process.env, DESKTOP_COMPANION_HOME_RENDER_PROFILE: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DESKTOP_COMPANION_DEV;
  delete env.DESKTOP_COMPANION_SMOKE;
  const child = spawn(process.execPath, [path.join(root, 'node_modules/electron/cli.js'), fileURLToPath(import.meta.url)], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  const deadline = setTimeout(() => { console.error('home-render-check: timed out'); child.kill(); }, 30_000);
  child.on('error', () => { console.error('home-render-check: launch failed'); });
  child.on('close', code => {
    clearTimeout(deadline);
    // Delete only this run's own, resolved temporary profile after Electron exits.
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith('desktop-companion-home-render-'));
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { console.error('home-render-check: temporary profile cleanup failed'); process.exitCode = 1; }
    if (code !== 0) process.exitCode = code ?? 1;
  });
} else {
  const { app, BrowserWindow, ipcMain } = await import('electron');
  const require = createRequire(import.meta.url);
  const { registerAppScheme, registerAppProtocol } = require('../dist/main/protocol.js');
  const { installSecurityPolicy } = require('../dist/main/security.js');
  const { createOverlayChrome, createOverlayWebPreferences } = require('../dist/shared/overlayOptions.js');
  const directory = process.env.DESKTOP_COMPANION_HOME_RENDER_PROFILE;
  assert.ok(directory && path.basename(directory).startsWith('desktop-companion-home-render-'));
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
  registerAppScheme();
  let win = null, painted = false, ready = false, checking = false, finished = false;
  const deadline = setTimeout(() => { console.error(`home-render-check: deadline painted=${painted} ready=${ready}`); finish(false); }, 15_000);
  function finish(ok) {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    ipcMain.removeAllListeners('home:ready');
    if (win && !win.isDestroyed()) win.destroy();
    if (ok) { console.log('home-render-check: PASS hidden app:// page, sandbox preload, SVG geometry, transparent CSS, first paint, no idle animation'); app.quit(); }
    else { console.error('home-render-check: FAIL'); app.exit(1); }
  }
  async function check() {
    if (!painted || !ready || checking) return;
    checking = true;
    try {
      const view = await win.webContents.executeJavaScript(`(() => ({
        keys: Object.keys(window.home).sort(), viewBox: document.querySelector('#platform').getAttribute('viewBox'),
        background: getComputedStyle(document.body).backgroundColor,
        chassis: document.querySelector('#chassis').getAttribute('d'),
        deck: ['cx','cy','rx','ry'].map(k => document.querySelector('#deck').getAttribute(k)),
        surface: ['cx','cy','rx','ry'].map(k => document.querySelector('#surface').getAttribute(k)),
        fillSamples: [[56,50],[6,54],[106,54],[30.5,32.5],[30.5,32],[56,29],[56,79],[56,10],[0,0],[111,87]]
          .map(([x,y]) => document.querySelector('#chassis').isPointInFill(new DOMPoint(x,y))),
        animations: document.getAnimations().length, canvases: document.querySelectorAll('canvas').length,
        networkDenied: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("connect-src 'none'")
      }))()`);
      assert.deepEqual(view.keys, ['notifyClick', 'notifyReady', 'onFeedback']);
      assert.equal(view.viewBox, '0 0 112 88'); assert.equal(view.background, 'rgba(0, 0, 0, 0)');
      assert.equal(view.chassis, 'M 5 48 A 51 18 0 0 1 107 48 V 60 A 51 18 0 0 1 5 60 Z');
      assert.deepEqual(view.deck, ['56', '48', '51', '18']);
      assert.deepEqual(view.surface, ['56', '46', '42', '13']);
      assert.deepEqual(view.fillSamples, [true,true,true,true,false,false,false,false,false,false]);
      assert.equal(view.animations, 0); assert.equal(view.canvases, 0); assert.equal(view.networkDenied, true);
      win.webContents.send('home:feedback', 'docked');
      const resting = await win.webContents.executeJavaScript(`({
        docked: document.querySelector('#home').classList.contains('docked'),
        animations: document.getAnimations().length
      })`);
      assert.equal(resting.docked, true); assert.equal(resting.animations, 0);
      assert.equal(win.isVisible(), false);
      finish(true);
    } catch (error) { console.error('home-render-check: assertion', error.message); finish(false); }
  }
  // Do not top-level-await app readiness while Electron is evaluating its ESM
  // entry point: finish module initialization before the ready event can fire.
  void app.whenReady().then(() => {
  installSecurityPolicy(false);
  registerAppProtocol(path.join(root, 'dist/renderer'));
  win = new BrowserWindow({ ...createOverlayChrome(), width: 112, height: 88,
    webPreferences: createOverlayWebPreferences(path.join(root, 'dist/preload/homePreload.js'), false) });
  win.setBackgroundMaterial('none'); win.setBackgroundColor('#00000000'); win.setIgnoreMouseEvents(true);
  win.on('ready-to-show', () => { painted = true; void check(); });
  win.webContents.on('preload-error', (_event, _file, error) => { console.error('home-render-check: preload', error.message); finish(false); });
  win.webContents.on('render-process-gone', (_event, detail) => { console.error('home-render-check: renderer', detail.reason); finish(false); });
  win.webContents.on('did-fail-load', (_event, code, description, _url, main) => {
    if (main !== false) { console.error('home-render-check: load', code, description); finish(false); }
  });
  win.webContents.on('console-message', event => {
    if (event.level === 'error') console.error('home-render-check: page', event.message);
  });
  ipcMain.on('home:ready', (event, marker) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || marker !== 'home-m3.3a') {
      console.error('home-render-check: rejected readiness'); return;
    }
    ready = true; void check();
  });
  void win.loadURL('app://companion/home.html').catch(() => finish(false));
  }).catch(error => { console.error('home-render-check: setup', error.message); finish(false); });
}
