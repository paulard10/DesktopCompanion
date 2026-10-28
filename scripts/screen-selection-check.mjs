// Hidden, synthetic-only NativeImage and sandbox preview proof. Never captures
// the desktop, opens the selector, reads credentials, or invokes the main app.
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
  const directory = fs.mkdtempSync(path.join(tempRoot, 'companion-selection-proof-'));
  const env = { ...process.env, COMPANION_SELECTION_PROFILE: directory };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DESKTOP_COMPANION_DEV; delete env.DESKTOP_COMPANION_SMOKE;
  const child = spawn(process.execPath, [path.join(root, 'node_modules/electron/cli.js'), fileURLToPath(import.meta.url)], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  const deadline = setTimeout(() => { console.error('selection-proof: timeout'); child.kill(); }, 30_000);
  child.on('close', code => {
    clearTimeout(deadline);
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), tempRoot); assert.ok(path.basename(resolved).startsWith('companion-selection-proof-'));
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { console.error('selection-proof: profile cleanup failed'); process.exitCode = 1; }
    if (code !== 0) process.exitCode = code ?? 1;
  });
} else {
  const { app, BrowserWindow, ipcMain, nativeImage, desktopCapturer, screen, session } = await import('electron');
  const require = createRequire(import.meta.url);
  const { registerAppScheme, registerAppProtocol } = require('../dist/main/protocol.js');
  const { SELECTION_CSP } = require('../dist/main/screenSelectionWindow.js');
  const { pixelCrop, captureSize } = require('../dist/shared/screenSelection.js');
  const directory = process.env.COMPANION_SELECTION_PROFILE;
  assert.ok(directory && path.basename(directory).startsWith('companion-selection-proof-'));
  app.setPath('userData', directory); app.setPath('sessionData', directory); registerAppScheme();
  // Make any accidental real desktop request an immediate test failure.
  desktopCapturer.getSources = () => { throw new Error('Real desktop capture forbidden in synthetic proof'); };
  let win, finished = false, processCountBeforeWindow = 0;
  const deadline = setTimeout(() => finish(false, 'deadline'), 15_000);
  function finish(ok, detail = '') {
    if (finished) return; finished = true; clearTimeout(deadline);
    ipcMain.removeAllListeners('selection:ready');
    const processCountWithWindow = app.getAppMetrics().length;
    if (win && !win.isDestroyed()) win.destroy();
    console.log(`selection-proof: ${ok ? 'PASS' : 'FAIL'} ${detail}`);
    console.log(`selection-proof: aggregate processes beforeWindow=${processCountBeforeWindow} withHiddenWindow=${processCountWithWindow}; all proof processes exit with the disposable app`);
    if (ok) app.quit(); else app.exit(1);
  }
  void app.whenReady().then(() => {
    registerAppProtocol(path.join(root, 'dist/renderer'));
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((d, cb) => cb({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': [SELECTION_CSP] } }));
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith('app://companion/') }));
    processCountBeforeWindow = app.getAppMetrics().length;
    win = new BrowserWindow({ show: false, width: 640, height: 480,
      webPreferences: { preload: path.join(root, 'dist/preload/screenSelectionPreload.js'), sandbox: true,
        contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('preload-error', () => finish(false, 'preload'));
    win.webContents.on('render-process-gone', () => finish(false, 'renderer'));
    ipcMain.once('selection:ready', async (event, viewport) => {
      try {
        assert.equal(event.sender, win.webContents);
        const content = win.getContentBounds();
        assert.deepEqual(viewport, { width: content.width, height: content.height,
          dpr: screen.getDisplayMatching(content).scaleFactor });
        // Each fixture pixel encodes its source x/y; no screenshot or fixture file.
        let png, output;
        for (const scaleFactor of [1, 1.25, 1.5]) {
          const display = { id: 5, bounds: { x: -1000, y: 50, width: 160, height: 120 }, scaleFactor };
          const size = captureSize(display), bitmap = Buffer.alloc(size.width * size.height * 4);
          for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
            const i = (y * size.width + x) * 4;
            bitmap[i] = x; bitmap[i + 1] = y; bitmap[i + 2] = 90; bitmap[i + 3] = 255;
          }
          const full = nativeImage.createFromBitmap(bitmap, { ...size, scaleFactor: 1 });
          const crop = pixelCrop({ x: 20, y: 30, width: 40, height: 20 }, display, full.getSize(1));
          const cut = full.crop(crop), pixels = cut.toBitmap({ scaleFactor: 1 });
          assert.deepEqual(cut.getSize(1), { width: crop.width, height: crop.height });
          for (let y = 0; y < crop.height; y++) for (let x = 0; x < crop.width; x++) {
            const i = (y * crop.width + x) * 4;
            assert.equal(pixels[i], x + crop.x); assert.equal(pixels[i + 1], y + crop.y);
          }
          png = cut.toPNG({ scaleFactor: 1 }); output = cut.getSize(1);
        }
        win.webContents.send('selection:notice', { sessionId: 'synthetic-only', displayId: 5, phase: 'PREVIEWING',
          width: 160, height: 120, image: { png, ...output } });
        const view = await win.webContents.executeJavaScript(`(async () => {
          const image = document.querySelector('#crop'); await image.decode();
          return { keys: Object.keys(window.screenSelection).sort(), width: image.naturalWidth, height: image.naturalHeight,
            blob: image.src.startsWith('blob:'), preview: document.body.classList.contains('preview'),
            label: document.querySelector('#heading').textContent, noAsk: !document.body.textContent.includes('Ask about this') };
        })()`);
        assert.deepEqual(view.keys, ['cancel', 'confirm', 'onNotice', 'ready', 'select']);
        assert.equal(view.width, output.width); assert.equal(view.height, output.height);
        assert.equal(view.blob, true); assert.equal(view.preview, true); assert.equal(view.noAsk, true);
        assert.match(view.label, /nothing sent to AI/); assert.equal(win.isVisible(), false);
        finish(true, 'native crop contents at 100/125/150%; sandbox preload; CSP blob preview; hidden window disposed; no desktop capture');
      } catch (error) { finish(false, error.message); }
    });
    void win.loadURL('app://companion/screen-selection.html').catch(() => finish(false, 'load'));
  }).catch(() => finish(false, 'setup'));
}
