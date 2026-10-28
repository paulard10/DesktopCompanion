// Samples ONLY this page's offscreen renderer output, never desktop pixels.
// No capture API/controller, capturePage, real input, image file or upload.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verify = process.argv.includes('--verify');
const visual = process.argv.includes('--visual');
if (!process.versions.electron) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, 'companion-alpha-proof-'));
  const env = { ...process.env, COMPANION_ALPHA_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DESKTOP_COMPANION_DEV; delete env.DESKTOP_COMPANION_SMOKE;
  const child = spawn(process.execPath, [path.join(root, 'node_modules/electron/cli.js'), fileURLToPath(import.meta.url), ...(verify ? ['--verify'] : []), ...(visual ? ['--visual'] : [])],
    { cwd: root, env, stdio: 'inherit', windowsHide: true });
  child.on('error', () => { console.error('alpha-proof: launch failed'); process.exitCode = 1; });
  child.on('close', code => {
    const resolved = fs.realpathSync(profile);
    assert.equal(path.dirname(resolved), tempRoot); assert.ok(path.basename(resolved).startsWith('companion-alpha-proof-'));
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { console.error('alpha-proof: profile cleanup failed'); process.exitCode = 1; }
    if (code !== 0) process.exitCode = code ?? 1;
  });
} else {
  const { app, BrowserWindow, ipcMain, screen, session } = await import('electron');
  // Process-local CSS paint probe only; production GPU settings are untouched.
  if (!visual) app.disableHardwareAcceleration();
  const require = createRequire(import.meta.url);
  const { registerAppScheme, registerAppProtocol } = require('../dist/main/protocol.js');
  const { contentSecurityPolicy } = require('../dist/shared/csp.js');
  const profile = process.env.COMPANION_ALPHA_PROFILE;
  assert.ok(profile && path.basename(profile).startsWith('companion-alpha-proof-'));
  app.setPath('userData', profile); app.setPath('sessionData', profile); registerAppScheme();
  let win, finished = false;
  const deadline = setTimeout(() => finish(false, 'deadline'), visual ? 180_000 : 20_000);
  function finish(ok, detail) {
    if (finished) return; finished = true; clearTimeout(deadline);
    ipcMain.removeAllListeners('selection:ready');
    ipcMain.removeAllListeners('selection:cancel');
    ipcMain.removeAllListeners('selection:select');
    ipcMain.removeAllListeners('selection:confirm');
    if (win && !win.isDestroyed()) { if (!visual) win.webContents.stopPainting(); win.destroy(); }
    console.log(`alpha-proof: ${ok ? 'PASS' : 'FAIL'} ${detail}`);
    if (ok) app.quit(); else app.exit(1);
  }
  async function measure(label, change = '') {
    if (change) await win.webContents.executeJavaScript(change);
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const { size, buffer } = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { win.webContents.removeListener('paint', onPaint); reject(new Error('Own renderer paint timeout')); }, 3000);
      function onPaint(_event, _dirty, rendered) {
        if (rendered.isEmpty()) return;
        clearTimeout(timeout); win.webContents.removeListener('paint', onPaint);
        resolve({ size: rendered.getSize(), buffer: rendered.toBitmap() });
      }
      win.webContents.on('paint', onPaint); win.webContents.invalidate();
    });
    const alpha = (x,y) => buffer[(y * size.width + x) * 4 + 3];
    const styles = await win.webContents.executeJavaScript(`(() => {
      const read = element => { const s = getComputedStyle(element); return {
        background: s.backgroundColor, backgroundImage: s.backgroundImage, colorScheme: s.colorScheme,
        opacity: s.opacity, filter: s.filter, backdropFilter: s.backdropFilter,
        mixBlendMode: s.mixBlendMode, isolation: s.isolation, position: s.position, zIndex: s.zIndex } };
      return { root: read(document.documentElement), body: read(document.body),
        surface: read(document.querySelector('#surface')), controls: read(document.querySelector('#controls')),
        before: getComputedStyle(document.querySelector('#surface'),'::before').content,
        after: getComputedStyle(document.querySelector('#surface'),'::after').content,
        viewport: {width:innerWidth,height:innerHeight,dpr:devicePixelRatio} };
    })()`);
    const result = { label, bitmap: size, backgroundAlpha: alpha(size.width-40,size.height-40),
      controlsAlpha: alpha(40,40), interiorAlpha: alpha(750,350), borderAlpha: alpha(700,320), styles };
    console.log('alpha-proof: ' + JSON.stringify(result));
    return result;
  }
  void app.whenReady().then(async () => {
    try {
      registerAppProtocol(path.join(root, 'dist/renderer'));
      session.defaultSession.setPermissionRequestHandler((_wc,_p,cb) => cb(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onBeforeRequest((d,cb) => cb({cancel:!d.url.startsWith('app://companion/')}));
      session.defaultSession.webRequest.onHeadersReceived((d,cb) => cb({responseHeaders:{...d.responseHeaders,'Content-Security-Policy':[contentSecurityPolicy(false)]}}));
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      assert.equal(display.scaleFactor,1,'This pixel-position proof uses the existing 100% display; do not change Windows settings');
      win = new BrowserWindow({ ...display.bounds, show:false, frame:false, transparent:true,
        backgroundColor:'#00000000', skipTaskbar:true, alwaysOnTop:true, resizable:false, movable:false,
        webPreferences:{ preload:path.join(root,'dist/preload/screenSelectionPreload.js'), sandbox:true,
          contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:false,
          zoomFactor:1,backgroundThrottling:false,...(!visual ? {offscreen:{useSharedTexture:false}} : {}) } });
      win.setBackgroundMaterial('none'); win.setMenuBarVisibility(false); win.setContentBounds(display.bounds);
      if (verify) win.setBackgroundColor('#00000000');
      if (!visual) win.webContents.setFrameRate(10);
      win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
      win.webContents.on('will-navigate', e => e.preventDefault());
      console.log('alpha-proof: '+JSON.stringify({electron:process.versions.electron,offscreen:!visual,
        backgroundApi:win.getBackgroundColor(),opacity:win.getOpacity(),devToolsOpen:win.webContents.isDevToolsOpened(),
        frame:false,transparent:true,resizable:win.isResizable(),fullscreen:win.isFullScreen(),kiosk:win.isKiosk(),
        hasShadow:win.hasShadow(),focusable:win.isFocusable(),show:win.isVisible(),
        content:win.getContentBounds(),expected:display.bounds}));
      const initiallyReady = new Promise(resolve => ipcMain.once('selection:ready', event => {
        assert.equal(event.sender,win.webContents); assert.equal(event.senderFrame,win.webContents.mainFrame); resolve();
      }));
      await win.loadURL('app://companion/screen-selection.html');
      await initiallyReady;
      if (visual) {
        let cleared = false;
        // This diagnostic never loads the capture controller or registers
        // select/confirm handlers. Approval cannot acquire an image here.
        win.webContents.send('selection:notice',{sessionId:'geometry-and-alpha-only',displayId:display.id,phase:'SELECTING',width:display.bounds.width,height:display.bounds.height});
        await win.webContents.executeJavaScript(`document.querySelector('#heading').textContent='SONDA A — fondo original'; document.querySelector('#status').textContent='Observa el fondo. Pulsa Aplicar B y comprueba si se ve el escritorio; luego Cerrar sonda. No hay captura.'; document.querySelector('#confirm').hidden=true; document.querySelector('#cancel').textContent='Cerrar sonda'; const b=document.createElement('button'); b.id='apply-background'; b.textContent='Aplicar B'; b.addEventListener('click',()=>window.screenSelection.ready()); document.querySelector('#controls').append(b);`);
        const applyBackground = () => {
          if (cleared) return;
          cleared = true; win.setBackgroundColor('#00000000');
          console.log('alpha-proof: '+JSON.stringify({stage:'B-explicit-background',backgroundApi:win.getBackgroundColor(),content:win.getContentBounds(),opacity:win.getOpacity(),devToolsOpen:win.webContents.isDevToolsOpened()}));
          void win.webContents.executeJavaScript(`document.querySelector('#heading').textContent='SONDA B — fondo nativo transparente aplicado'; document.querySelector('#status').textContent='Comprueba la visibilidad y pulsa Cerrar sonda. Nada se captura.'; document.querySelector('#apply-background').disabled=true;`);
        };
        ipcMain.on('selection:ready', event => { if (event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame) applyBackground(); });
        ipcMain.on('selection:cancel', event => { if (event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame) finish(true,'visual comparison closed; user verdict collected separately'); });
        win.webContents.on('before-input-event', (event,input) => {
          if (input.type !== 'keyDown') return;
          if (input.key === 'Escape') { event.preventDefault(); finish(true,'visual comparison closed; user verdict collected separately'); }
          if (input.key === 'Enter' && !cleared) {
            event.preventDefault(); applyBackground();
          }
        });
        win.show(); return;
      }
      const shipped = await measure('shipped');
      if (verify) assert.equal(shipped.backgroundAlpha,53,'Fixed page should paint only the existing 0x35 tint');
      const explicit = await measure('explicit-root-body-background',`document.documentElement.style.background='transparent'; document.body.style.background='transparent';`);
      const normal = await measure('root-normal',`document.documentElement.style.background=''; document.body.style.background=''; document.documentElement.style.colorScheme='normal';`);
      const clear = await measure('root-normal-no-scrim',`document.querySelector('#surface').style.background='transparent';`);
      const dark = await measure('root-dark-restored',`document.querySelector('#surface').style.background=''; document.documentElement.style.colorScheme='dark';`);
      assert.equal(normal.backgroundAlpha,53); assert.equal(clear.backgroundAlpha,0);
      assert.equal(dark.backgroundAlpha,53); assert.equal(normal.controlsAlpha,255);
      assert.equal(shipped.backgroundAlpha,53); assert.equal(explicit.backgroundAlpha,53);
      if (verify) {
        assert.equal(win.getBackgroundColor(),'#000000');
        const id='synthetic-drag-only', selected=[]; let confirms=0,cancels=0;
        ipcMain.on('selection:select', (event, token, displayId, rect) => {
          assert.equal(event.sender,win.webContents); assert.equal(token,id); assert.equal(displayId,display.id);
          selected.push(rect);
          win.webContents.send('selection:notice',{sessionId:id,displayId:display.id,phase:'AWAITING_CAPTURE_CONFIRMATION',width:display.bounds.width,height:display.bounds.height,rect});
        });
        ipcMain.on('selection:confirm',()=>confirms++);
        ipcMain.on('selection:cancel',()=>cancels++);
        win.webContents.send('selection:notice',{sessionId:id,displayId:display.id,phase:'SELECTING',width:display.bounds.width,height:display.bounds.height});
        await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(resolve))');
        win.webContents.focus(); // The hidden offscreen content only; no desktop input.
        const input=event=>win.webContents.sendInputEvent(event);
        input({type:'mouseMove',x:700,y:300});
        input({type:'mouseDown',button:'left',clickCount:1,x:700,y:300});
        input({type:'mouseMove',x:900,y:460});
        input({type:'mouseUp',button:'left',clickCount:1,x:900,y:460});
        const dragged=await measure('fixture-drag');
        assert.deepEqual(selected,[{x:700,y:300,width:200,height:160}]);
        assert.equal(dragged.interiorAlpha,53);assert.equal(dragged.borderAlpha,255);
        assert.equal(dragged.controlsAlpha,255);
        assert.equal(await win.webContents.executeJavaScript('document.querySelector("#confirm").disabled'),false);
        assert.equal(confirms,0);
        const cancel=await win.webContents.executeJavaScript('(()=>{const r=document.querySelector("#cancel").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
        input({type:'mouseDown',button:'left',clickCount:1,...cancel});
        input({type:'mouseUp',button:'left',clickCount:1,...cancel});
        await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(resolve))');
        assert.equal(cancels,1);assert.equal(confirms,0);
        console.log('alpha-proof: own offscreen drag/outline/interior/controls/cancel PASS; zero confirm requests');
      }
      assert.deepEqual(win.getContentBounds(),display.bounds);
      assert.equal(win.getOpacity(),1); assert.equal(win.webContents.isDevToolsOpened(),false); assert.equal(win.isVisible(),false);
      finish(true,'own-page alpha comparison only; no desktop pixels, image files, capture handlers or real input');
    } catch(error) { finish(false,error.message); }
  });
}
