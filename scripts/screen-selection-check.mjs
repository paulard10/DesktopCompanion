// Hidden, synthetic-only NativeImage, sandbox preview and offline consent proof. Never captures
// the desktop, opens the selector, reads credentials, or invokes the main app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const attemptProof = process.argv.includes('--offline-attempt');
const gateProof = attemptProof || process.argv.includes('--offline-gate');
const bridgeProof = gateProof || process.argv.includes('--offline-bridge'); // Standalone fake proofs only; never app activation flags.
if (!process.versions.electron) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempRoot, 'companion-selection-proof-'));
  const env = { COMPANION_SELECTION_PROFILE: directory };
  for (const name of ['SystemRoot','WINDIR','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','PATH'])
    if (process.env[name] !== undefined) env[name] = process.env[name];
  // Own Electron directly: killing the Node CLI wrapper can leave its Electron
  // child alive after a timeout and prevent disposable-profile cleanup.
  const executable = fs.realpathSync(path.join(root, 'node_modules/electron/dist/electron.exe'));
  assert.equal(path.dirname(executable), fs.realpathSync(path.join(root, 'node_modules/electron/dist')));
  assert.match(path.basename(executable), /^electron(?:\.exe)?$/i);
  const child = spawn(executable, [fileURLToPath(import.meta.url), ...(attemptProof ? ['--offline-attempt'] : gateProof ? ['--offline-gate'] : bridgeProof ? ['--offline-bridge'] : [])], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  const deadline = setTimeout(() => { console.error('selection-proof: timeout'); child.kill(); }, 30_000);
  child.on('close', code => {
    clearTimeout(deadline);
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), tempRoot); assert.ok(path.basename(resolved).startsWith('companion-selection-proof-'));
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch { console.error('selection-proof: profile cleanup failed'); process.exitCode = 1; }
    if (code !== 0) process.exitCode = code ?? 1;
  });
} else {
  console.log('selection-proof: stage=electron-entry');
  const { app, BrowserWindow, ipcMain, nativeImage, desktopCapturer, screen, session, net, safeStorage } = await import('electron');
  console.log('selection-proof: stage=electron-module-ready');
  const require = createRequire(import.meta.url);
  let externalAttempts = 0, credentialAttempts = 0, captureAttempts = 0;
  const denyNetwork = () => { externalAttempts++; throw new Error('No network in offline proof'); };
  globalThis.fetch = denyNetwork; if ('WebSocket' in globalThis) globalThis.WebSocket = denyNetwork;
  net.fetch = denyNetwork; net.request = denyNetwork;
  for (const name of ['node:http','node:https']) for (const key of ['request','get']) require(name)[key] = denyNetwork;
  for (const key of ['connect','createConnection']) require('node:net')[key] = denyNetwork;
  require('node:net').Socket.prototype.connect = denyNetwork; require('node:tls').connect = denyNetwork;
  const denyCredential = () => { credentialAttempts++; throw new Error('No credentials in offline proof'); };
  safeStorage.decryptString = denyCredential; safeStorage.decryptStringAsync = denyCredential;
  const Module = require('node:module'), load = Module._load;
  Module._load = function (name, ...args) {
    if (/safeCredentialStore|providerSettings|keyVault|visionPilotReceipt/.test(name) || (!bridgeProof && /qwenVisionTransport/.test(name))) return denyCredential();
    return load.call(this, name, ...args);
  };
  const { registerAppScheme, registerAppProtocol } = require('../dist/main/protocol.js');
  const { SELECTION_CSP } = require('../dist/main/screenSelectionWindow.js');
  const { pixelCrop, captureSize } = require('../dist/shared/screenSelection.js');
  const { createOfflineVisionSession } = require('../dist/main/offlineVisionSession.js');
  console.log('selection-proof: stage=modules-ready');
  let bridgeScenario = 'success', bridgeChecks = 0;
  let prepareAttempts = async () => {};
  if (bridgeProof) {
    const requestModule = require('../dist/main/screenVisionRequest.js');
    const { createOfflineScreenVisionBridge } = require('../dist/main/screenVisionBridge.js');
    const createGate = gateProof ? require('../dist/main/screenVisionGate.js').createScreenVisionGateOfflineTest : undefined;
    const attemptModule = attemptProof ? require('../dist/main/screenVisionAttempt.js') : undefined;
    const attemptContexts = [];
    if (attemptProof) prepareAttempts = async () => {
      // Allocate metadata handles before confirmation, not permissions or records.
      // Avoid introducing a filesystem await between confirmed A and fake B issuance.
      for (let i = 0; i < 2; i++) {
        const attemptDirectory = fs.mkdtempSync(path.join(directory, 'companion-vision-attempt-'));
        attemptContexts.push({ directory: attemptDirectory, handle: await attemptModule.createOfflineVisionAttempt({ directory: attemptDirectory }) });
      }
    };
    const { createVisionBridgeDummy, visionBridgeDummyStats } = require('../dist/main/screenVisionBridgeFake.js');
    const { createVisionMock, visionMockStats } = require('../dist/main/qwenVisionMock.js');
    requestModule.executeScreenVisionMock = async (wire, _legacy, signal, attempt) => {
      if (attemptProof) console.log('selection-proof: stage=attempt-hook');
      const fake = createVisionMock([bridgeScenario === 'timeout' ? { failure: 'pending' } : { status: 200, delayMs: 400,
        body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Offline bridge only. No visual understanding.' }, finish_reason: 'stop' }] }) }]);
      const attemptContext = attemptProof ? attemptContexts.shift() : undefined;
      if (attemptProof) assert.ok(attemptContext);
      const attemptDirectory = attemptContext?.directory, durableAttempt = attemptContext?.handle;
      if (attemptProof) console.log('selection-proof: stage=attempt-handle-ready');
      const dummy = createVisionBridgeDummy(), bridge = gateProof
        ? createGate({ scope: 'privileged-screen-vision-offline-test', transport: fake, dummy, ...(durableAttempt ? { attempt: durableAttempt } : {}) })
        : createOfflineScreenVisionBridge({ transport: fake, dummy });
      try {
        let result;
        if (gateProof) {
          assert.equal((await bridge.run(wire, undefined, signal)).code, 'authorization');
          assert.equal(visionBridgeDummyStats(dummy).loads, 0); assert.equal(visionMockStats(fake).calls, 0);
          const issued = bridge.issue(wire); assert.equal(issued.ok, true);
          if (attemptProof) console.log('selection-proof: stage=fake-capability-issued');
          assert.equal(visionBridgeDummyStats(dummy).loads, 0); assert.equal(visionMockStats(fake).calls, 0);
          const pending = bridge.run(wire, issued.capability, signal);
          assert.equal((await bridge.run(wire, issued.capability, signal)).code, 'duplicate');
          result = await pending;
          if (attemptProof) console.log('selection-proof: stage=attempt-result');
        } else result = await bridge.run(wire, signal);
        assert.ok(visionBridgeDummyStats(dummy).loads <= 1); assert.ok(visionMockStats(fake).calls <= 1);
        if (result.ok) { assert.equal(visionBridgeDummyStats(dummy).loads, 1); assert.equal(visionMockStats(fake).calls, 1); }
        assert.equal(result.evidence.transport, 'closed-fake');
        if (attemptProof) {
          const durable = await attemptModule.readOfflineVisionAttempt(attemptDirectory);
          if (result.ok) assert.equal(durable.state, 'COMPLETED');
          else assert.ok(['NOT_STARTED','FAILED','UNKNOWN'].includes(durable.state));
        }
        attempt.fakeDispatches = result.evidence.fakeDispatches ?? 0; bridgeChecks++; return result;
      } finally { bridge.dispose(); }
    };
  }
  const directory = process.env.COMPANION_SELECTION_PROFILE;
  assert.ok(directory && path.basename(directory).startsWith('companion-selection-proof-'));
  app.setPath('userData', directory); app.setPath('sessionData', directory); registerAppScheme();
  console.log('selection-proof: stage=profile-set');
  // Make any accidental real desktop request an immediate test failure.
  desktopCapturer.getSources = () => { captureAttempts++; throw new Error('Real desktop capture forbidden in synthetic proof'); };
  let win, visualSession, finished = false, processCountBeforeWindow = 0;
  let visionOperations = 0, screenOperations = 0, lastRun;
  const deadline = setTimeout(() => finish(false, 'deadline'), 15_000);
  function finish(ok, detail = '') {
    if (finished) return; finished = true; clearTimeout(deadline);
    ipcMain.removeAllListeners('selection:ready');
    ipcMain.removeAllListeners('selection:vision');
    visualSession?.dispose(); visualSession = undefined; lastRun = undefined;
    const processCountWithWindow = app.getAppMetrics().length;
    console.log(`selection-proof: stage=closing-${ok ? 'pass' : 'fail'}`);
    if (win && !win.isDestroyed()) win.destroy();
    console.log(`selection-proof: ${ok ? 'PASS' : 'FAIL'} ${detail}`);
    console.log(`selection-proof: aggregate processes beforeWindow=${processCountBeforeWindow} withHiddenWindow=${processCountWithWindow}; all proof processes exit with the disposable app`);
    if (ok) app.quit(); else app.exit(1);
  }
  void app.whenReady().then(() => {
    console.log('selection-proof: stage=app-ready');
    registerAppProtocol(path.join(root, 'dist/renderer'));
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((d, cb) => cb({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': [SELECTION_CSP] } }));
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
      const external = !d.url.startsWith('app://companion/');
      if (external && !d.url.startsWith('blob:')) externalAttempts++;
      cb({ cancel: external });
    });
    processCountBeforeWindow = app.getAppMetrics().length;
    win = new BrowserWindow({ show: false, frame: false, autoHideMenuBar: true, width: 640, height: 480,
      webPreferences: { preload: path.join(root, 'dist/preload/screenSelectionPreload.js'), sandbox: true,
        contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('preload-error', () => finish(false, 'preload'));
    win.webContents.on('render-process-gone', () => finish(false, 'renderer'));
    ipcMain.once('selection:ready', async (event, viewport) => {
      console.log('selection-proof: stage=renderer-ready');
      try {
        await prepareAttempts();
        assert.equal(event.sender, win.webContents);
        const content = win.getContentBounds();
        assert.deepEqual(viewport, { width: content.width, height: content.height,
          dpr: screen.getDisplayMatching(content).scaleFactor });
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('#vision').hidden && !document.querySelector('#crop').hasAttribute('src')`), true);
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
            label: document.querySelector('#heading').textContent, visionHidden: document.querySelector('#vision').hidden };
        })()`);
        assert.deepEqual(view.keys, ['cancel', 'confirm', 'onNotice', 'ready', 'select', 'vision']);
        assert.equal(view.width, output.width); assert.equal(view.height, output.height);
        assert.equal(view.blob, true); assert.equal(view.preview, true); assert.equal(view.visionHidden, true);
        assert.match(view.label, /nothing sent to AI/); assert.equal(win.isVisible(), false);
        const payload = { sessionId: 'synthetic-only', displayId: 5, phase: 'PREVIEWING', width: 160, height: 120 };
        visualSession = createOfflineVisionSession({ sessionId: payload.sessionId,
          crop: { kind: 'approved-local-crop', mime: 'image/png', bytes: png, ...output,
            x: 30, y: 45, sourceWidth: 240, sourceHeight: 180 },
          publish(vision) {
            bridgeScenario = vision.scenario;
            if (vision.phase === 'running') visionOperations++;
            if (vision.phase === 'screen-running') screenOperations++;
            win.webContents.send('selection:notice', { ...payload, vision });
          },
        });
        ipcMain.on('selection:vision', (e, action) => {
          if (e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame ||
              e.senderFrame.parent !== null || e.senderFrame.url !== 'app://companion/screen-selection.html') return;
          if (action.type === 'run') lastRun = action;
          visualSession?.dispatch(action);
        });
        visualSession.dispatch({ type: 'edit', sessionId: payload.sessionId, question: '', revision: 1, scenario: 'success' });
        const evaluate = code => win.webContents.executeJavaScript(code);
        const previewBlob = await evaluate(`document.querySelector('#crop').src`);
        const until = async expression => {
          for (let i = 0; i < 60; i++) {
            if (await evaluate(expression)) return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Synthetic renderer state deadline');
        };
        await until(`!document.querySelector('#vision').hidden`);
        assert.equal(await evaluate(`document.querySelector('#send-remote').disabled`), true);
        const disclosure = await evaluate(`document.querySelector('#remote-sharing').textContent`);
        for (const text of ['Alibaba Cloud Model Studio','Singapore','qwen3.7-plus','Local capture is not permission to upload',
          'may retain','may incur charges','cannot recall','chat history','screen coordinates']) assert.ok(disclosure.includes(text), text);
        // A disabled control has no live handler even if devtools-style code enables it.
        await evaluate(`document.querySelector('#send-remote').disabled=false;document.querySelector('#send-remote').click()`);
        assert.equal(visionOperations, 0); assert.equal(externalAttempts, 0); assert.equal(credentialAttempts, 0);
        assert.equal(await evaluate(`document.querySelector('#review-question').disabled`), true);
        await evaluate(`{
          const q=document.querySelector('#question'); q.value='¿Qué significa este error?';
          q.dispatchEvent(new Event('input',{bubbles:true}));
          q.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        }`);
        await until(`!document.querySelector('#review-question').disabled`);
        assert.equal(visionOperations, 0);
        await evaluate(`document.querySelector('#review-question').click()`);
        await until(`!document.querySelector('#vision-review').hidden`);
        assert.equal(await evaluate(`document.querySelector('#review-text').textContent`), '¿Qué significa este error?');
        assert.equal(await evaluate(`document.querySelector('#remote-sharing').getBoundingClientRect().height > 0 && document.querySelector('#crop').getBoundingClientRect().height >= 1`), true);
        assert.match(await evaluate(`document.querySelector('#review-image').textContent`), /Same selected PNG: 60 × 30 pixels.*one local simulation only/);
        assert.equal(await evaluate(`document.querySelector('#send-remote').disabled`), true);
        assert.equal(await evaluate(`document.querySelector('#crop').src`), previewBlob);
        assert.equal(visionOperations, 0);
        await evaluate(`{
          const q=document.querySelector('#question');q.value='Pregunta editada';q.dispatchEvent(new Event('input',{bubbles:true}));
        }`);
        await until(`document.querySelector('#vision-review').hidden`);
        await evaluate(`document.querySelector('#review-question').click()`);
        await until(`!document.querySelector('#vision-review').hidden`);
        assert.equal(await evaluate(`document.querySelector('#review-text').textContent`), 'Pregunta editada');
        await evaluate(`document.querySelector('#run-offline').click();document.querySelector('#run-offline').click()`);
        await until(`!document.querySelector('#vision-answer').hidden`);
        console.log('selection-proof: stage=legacy-result');
        assert.equal(visionOperations, 1);
        assert.match(await evaluate(`document.querySelector('#vision-answer').textContent`), /No visual understanding was performed/);
        assert.match(await evaluate(`document.querySelector('#vision-status').textContent`), /Simulated response — no AI was called/);
        visualSession.dispatch(lastRun); assert.equal(visionOperations, 1);
        // A pending simulated timeout can be cancelled through the actual preload.
        await evaluate(`{
          const s=document.querySelector('#scenario');s.value='timeout';s.dispatchEvent(new Event('change',{bubbles:true}));
        }`);
        await until(`!document.querySelector('#review-question').disabled`);
        await evaluate(`document.querySelector('#review-question').click()`);
        await until(`!document.querySelector('#vision-review').hidden`);
        await evaluate(`document.querySelector('#run-offline').click()`);
        await until(`document.querySelector('#question').disabled`);
        await evaluate(`document.querySelector('#cancel-vision').click()`);
        await until(`!document.querySelector('#question').disabled`);
        assert.equal(await evaluate(`document.querySelector('#vision-answer').hidden`), true);
        // Separate screen-rehearsal review/confirmation through the unchanged bridge.
        await evaluate(`{
          const s=document.querySelector('#scenario');s.value='success';s.dispatchEvent(new Event('change',{bubbles:true}));
        }`);
        await until(`!document.querySelector('#review-screen-send').disabled`);
        await evaluate(`document.querySelector('#review-screen-send').click()`);
        await until(`!document.querySelector('#confirm-screen-send').hidden && !document.querySelector('#confirm-screen-send').disabled`);
        assert.equal(await evaluate(`document.querySelector('#review-text').textContent`), 'Pregunta editada');
        assert.equal(await evaluate(`document.querySelector('#crop').src`), previewBlob);
        assert.equal(await evaluate(`document.querySelector('#run-offline').hidden && document.querySelector('#send-remote').disabled`), true);
        assert.equal(screenOperations, 0);
        await evaluate(`document.querySelector('#confirm-screen-send').click();document.querySelector('#confirm-screen-send').click()`);
        await until(`!document.querySelector('#vision-answer').hidden`);
        assert.equal(screenOperations, 1);
        assert.match(await evaluate(`document.querySelector('#vision-status').textContent`), /Simulated Qwen response — no external AI request was made/);
        assert.match(await evaluate(`document.querySelector('#vision-answer').textContent`), /No visual understanding/);
        // A newly reviewed fake pending call can be cancelled; nothing is retried.
        await evaluate(`{
          const s=document.querySelector('#scenario');s.value='timeout';s.dispatchEvent(new Event('change',{bubbles:true}));
        }`);
        await until(`!document.querySelector('#review-screen-send').disabled`);
        await evaluate(`document.querySelector('#review-screen-send').click()`);
        await until(`!document.querySelector('#confirm-screen-send').disabled`);
        await evaluate(`document.querySelector('#confirm-screen-send').click()`);
        await until(`document.querySelector('#question').disabled`);
        await evaluate(`document.querySelector('#cancel-vision').click()`);
        await until(`!document.querySelector('#question').disabled`);
        assert.equal(screenOperations, 2);assert.equal(await evaluate(`document.querySelector('#vision-answer').hidden`), true);
        assert.equal(externalAttempts, 0); assert.equal(credentialAttempts, 0); assert.equal(captureAttempts, 0); assert.equal(win.isVisible(), false);
        assert.equal(await evaluate(`document.querySelector('#send-remote').disabled`), true);
        // Real discard button -> preload -> owned main handler, no actual capture.
        ipcMain.once('selection:cancel', (e, id) => {
          assert.equal(e.sender, win.webContents); assert.equal(id, payload.sessionId);
          visualSession.dispose();
          if (bridgeProof) assert.equal(bridgeChecks, 2);
          finish(true, `native crop at 100/125/150%; separate screen review/confirmation, ${attemptProof ? 'OS-flushed offline attempt/independent fake Gate B/shared bridge' : gateProof ? 'independent fake Gate B/shared bridge/dummy credentials' : bridgeProof ? 'shared HTTP bridge/dummy credentials' : 'shared builder/closed fake'}, duplicate/cancel/discard; real-send disabled; zero external/credential/capture attempts`);
        });
        await evaluate(`document.querySelector('#cancel').click()`);
      } catch (error) { finish(false, error.message); }
    });
    void win.loadURL('app://companion/screen-selection.html').catch(() => finish(false, 'load'));
  }).catch(() => finish(false, 'setup'));
}
