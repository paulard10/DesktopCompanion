// Finite native geometry experiment. No screen pixels, capture controller,
// user profile, user input injection or persistent diagnostic output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.versions.electron) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, 'companion-geometry-proof-'));
  const env = { ...process.env, COMPANION_GEOMETRY_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DESKTOP_COMPANION_DEV; delete env.DESKTOP_COMPANION_SMOKE;
  const child = spawn(process.execPath, [path.join(root, 'node_modules/electron/cli.js'), fileURLToPath(import.meta.url)], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  child.on('error', () => { console.error('geometry-proof: launch failed'); process.exitCode = 1; });
  child.on('close', code => {
    const resolved = fs.realpathSync(profile);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith('companion-geometry-proof-'));
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { console.error('geometry-proof: profile cleanup failed'); process.exitCode = 1; }
    if (code !== 0) process.exitCode = code ?? 1;
  });
} else {
  const { app, BrowserWindow, screen, session } = await import('electron');
  const require = createRequire(import.meta.url);
  const { registerAppScheme, registerAppProtocol } = require('../dist/main/protocol.js');
  const profile = process.env.COMPANION_GEOMETRY_PROFILE;
  assert.ok(profile && path.basename(profile).startsWith('companion-geometry-proof-'));
  app.setPath('userData', profile); app.setPath('sessionData', profile); registerAppScheme();
  app.on('window-all-closed', () => {}); // Keep the disposable experiment alive between variants.
  const deadline = setTimeout(() => {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    console.error('geometry-proof: deadline'); app.exit(1);
  }, 20_000);
  const same = (a, b) => ['x', 'y', 'width', 'height'].every(k => a[k] === b[k]);
  const delta = (a, b) => Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, a[k] - b[k]]));
  async function nativeBounds(win) {
    const buffer = win.getNativeWindowHandle();
    const handle = (buffer.length === 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE())).toString();
    const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class OwnWindowGeometry {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int x,y; }
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref Point p);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
}
'@
$handleValue=[IntPtr]::new([long]${handle}); [uint32]$owner=0
[void][OwnWindowGeometry]::GetWindowThreadProcessId($handleValue,[ref]$owner)
if($owner -ne ${process.pid}){throw 'Not the disposable app window'}
$oldContext=[OwnWindowGeometry]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
try {
 $outer=New-Object OwnWindowGeometry+Rect; $client=New-Object OwnWindowGeometry+Rect; $origin=New-Object OwnWindowGeometry+Point
 if(-not [OwnWindowGeometry]::GetWindowRect($handleValue,[ref]$outer) -or -not [OwnWindowGeometry]::GetClientRect($handleValue,[ref]$client) -or -not [OwnWindowGeometry]::ClientToScreen($handleValue,[ref]$origin)){throw 'Own geometry query failed'}
 $result=@{physicalWindow=@{x=$outer.left;y=$outer.top;width=($outer.right-$outer.left);height=($outer.bottom-$outer.top)};physicalClient=@{x=$origin.x;y=$origin.y;width=($client.right-$client.left);height=($client.bottom-$client.top)};dpi=[OwnWindowGeometry]::GetDpiForWindow($handleValue)}
 [Console]::Out.Write(($result|ConvertTo-Json -Compress))
} finally { [void][OwnWindowGeometry]::SetThreadDpiAwarenessContext($oldContext) }
`;
    const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const { stdout } = await promisify(execFile)(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { shell: false, windowsHide: true, timeout: 6000, maxBuffer: 4096 });
    return JSON.parse(stdout);
  }
  const record = (win, display, variant, stage, viewport) => {
    const outer = win.getBounds(), content = win.getContentBounds();
    console.log('geometry-proof: ' + JSON.stringify({ variant, stage, outer, content,
      size: win.getSize(), contentSize: win.getContentSize(), viewport,
      contentDelta: delta(content, display.bounds), outerDelta: delta(outer, display.bounds),
      fullDisplayMatch: same(content, display.bounds), workAreaMatch: same(content, display.workArea),
      matchingDisplay: screen.getDisplayMatching(content).id === display.id,
      fullscreen: win.isFullScreen(), kiosk: win.isKiosk(), resizable: win.isResizable(),
      focusable: win.isFocusable(), movable: win.isMovable(), min: win.getMinimumSize(), max: win.getMaximumSize() }));
  };
  async function run(display, variant, extra = {}, setContent = false, setImmediately = false) {
    const win = new BrowserWindow({ ...display.bounds, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', skipTaskbar: true, alwaysOnTop: true, resizable: false, movable: false,
      ...extra, webPreferences: { preload: path.join(root, 'dist/preload/screenSelectionPreload.js'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
        devTools: false, zoomFactor: 1, backgroundThrottling: false } });
    win.setBackgroundMaterial('none'); win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    record(win, display, variant, 'created');
    if (setImmediately) {
      win.setContentBounds(display.bounds);
      record(win, display, variant, 'explicit-before-load');
    }
    const painted = new Promise(resolve => win.once('ready-to-show', resolve));
    try {
      await win.loadURL('app://companion/screen-selection.html'); await painted;
      const viewport = () => win.webContents.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:visualViewport.scale})');
      record(win, display, variant, 'ready-to-show', await viewport());
      if (setImmediately) {
        assert.deepEqual(win.getContentBounds(), display.bounds, 'Fixed surface must exactly equal full-display DIP bounds');
        const view = await viewport();
        assert.equal(view.width, display.bounds.width); assert.equal(view.height, display.bounds.height);
        assert.equal(view.dpr, display.scaleFactor); assert.equal(view.zoom, 1);
      }
      if (variant === 'original' || variant === 'explicit-before-load') {
        const native = await nativeBounds(win);
        console.log('geometry-proof: ' + JSON.stringify({ variant, stage: 'native-physical', ...native }));
        if (setImmediately) assert.deepEqual(native.physicalClient, screen.dipToScreenRect(win, display.bounds));
      }
      if (setContent) {
        win.setContentBounds(display.bounds);
        record(win, display, variant, 'setContentBounds', await viewport());
      }
      win.showInactive();
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      record(win, display, variant, 'shown-two-renderer-frames', await viewport());
      if (setImmediately) assert.deepEqual(win.getContentBounds(), display.bounds, 'Showing must not change the fixed surface');
    } finally { win.destroy(); }
  }
  void app.whenReady().then(async () => {
    try {
      registerAppProtocol(path.join(root, 'dist/renderer'));
      session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith('app://companion/') }));
      const displays = screen.getAllDisplays();
      assert.equal(displays.length, 1, 'Geometry experiment requires one display');
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      console.log('geometry-proof: ' + JSON.stringify({ electron: process.versions.electron,
        displayCount: displays.length, displayId: display.id, primaryId: screen.getPrimaryDisplay().id,
        bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor,
        physicalBounds: screen.dipToScreenRect(null, display.bounds) }));
      await run(display, 'original');
      await run(display, 'thickFrame-false', { thickFrame: false });
      await run(display, 'useContentSize', { useContentSize: true });
      await run(display, 'explicit-content-bounds', {}, true);
      await run(display, 'explicit-before-load', {}, false, true);
      clearTimeout(deadline); console.log('geometry-proof: PASS; exact DIP/viewport/native client geometry; no capture API or controller loaded'); app.quit();
    } catch (error) {
      clearTimeout(deadline); for (const win of BrowserWindow.getAllWindows()) win.destroy();
      console.error('geometry-proof: FAIL ' + error.message); app.exit(1);
    }
  });
}
