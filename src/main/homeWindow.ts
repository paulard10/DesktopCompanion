import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';
import { HOME, homeCaptures, type HomeCursorObservation, type HomeRect } from '../shared/homeGeometry.js';
import { placeDockableHome } from '../shared/dockingGeometry.js';
import { IpcChannels, type HomeFeedback } from '../shared/ipc.js';
import { createOverlayChrome, createOverlayWebPreferences, OVERLAY_ALWAYS_ON_TOP_LEVEL } from '../shared/overlayOptions.js';
import { isHomeRendererUrl } from '../shared/trustedUrl.js';

export interface HomeController {
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  setAppVisible: (visible: boolean) => void;
  observe: (sample: HomeCursorObservation | null) => void;
  getBounds: () => HomeRect | null;
  getDockingBounds: () => HomeRect | null;
  feedback: (feedback: HomeFeedback) => void;
  destroy: () => void;
}

/** Optional static surface. No cursor/travel interval and no avatar commands. */
export function createHomeWindow(options: {
  dev: boolean;
  preloadPath: string;
  onEnabledChanged?: () => void;
  onActivate?: () => boolean;
  onUnavailable?: () => void;
  raiseAvatar?: (source: string) => boolean;
}): HomeController {
  let enabled = false, appVisible = false, disposed = false;
  let win: BrowserWindow | null = null;
  let ready = false, painted = false, capturing = false;
  let last: HomeCursorObservation | null = null;
  let sampledBounds: HomeRect | null = null;
  let lastClickAt = -Infinity;
  let loadDeadline: ReturnType<typeof setTimeout> | null = null;
  const page = options.dev ? 'http://127.0.0.1:5173/home.html' : 'app://companion/home.html';

  const trusted = (event: IpcMainEvent): boolean => Boolean(enabled && win && !win.isDestroyed() &&
    !win.webContents.isDestroyed() &&
    event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
    event.senderFrame?.parent === null && isHomeRendererUrl(event.senderFrame.url, options.dev));
  const onReady = (event: IpcMainEvent, ...args: unknown[]): void => {
    if (!trusted(event) || args.length !== 1 || args[0] !== 'home-m3.3a') return;
    ready = true;
    present();
  };
  const onClick = (event: IpcMainEvent, ...args: unknown[]): void => {
    if (!trusted(event) || args.length !== 0 || !ready || !painted || !appVisible || !win?.isVisible()) return;
    try {
      const now = performance.now(), bounds = win.getBounds();
      if (!sameBounds(bounds, sampledBounds) || !homeCaptures(last, bounds, now, true) ||
          now - lastClickAt < HOME.clickGapMs) return;
      lastClickAt = now;
      if (!raiseAvatar()) { failClosed(); return; }
      const accepted = options.onActivate?.() ?? true;
      feedback(accepted ? 'pulse' : 'blocked');
    } catch { failClosed(); }
  };
  const reposition = (): void => {
    if (!win || win.isDestroyed()) return;
    try {
      release();
      options.onUnavailable?.();
      const bounds = placeDockableHome(screen.getPrimaryDisplay().workArea);
      if (!bounds) { failClosed(); return; }
      if (!sameBounds(bounds, win.getBounds())) win.setBounds(bounds);
    } catch { failClosed(); }
  };

  function release(): void {
    last = null; sampledBounds = null;
    if (win && !win.isDestroyed() && capturing) win.setIgnoreMouseEvents(true);
    capturing = false;
  }
  function clearDeadline(): void {
    if (loadDeadline) clearTimeout(loadDeadline);
    loadDeadline = null;
  }
  function destroyWindow(): void {
    clearDeadline();
    ipcMain.removeListener(IpcChannels.homeReady, onReady);
    ipcMain.removeListener(IpcChannels.homeClick, onClick);
    screen.removeListener('display-added', reposition);
    screen.removeListener('display-removed', reposition);
    screen.removeListener('display-metrics-changed', reposition);
    const previous = win;
    win = null; ready = false; painted = false; capturing = false;
    last = null; sampledBounds = null; lastClickAt = -Infinity;
    if (previous) options.onUnavailable?.();
    if (previous && !previous.isDestroyed()) {
      try { previous.setIgnoreMouseEvents(true); } catch { /* Destruction still releases input. */ }
      try { previous.destroy(); } catch { console.error('desktop-companion: home-window-disposal-failed'); }
    }
  }
  function failClosed(): void {
    const changed = enabled;
    enabled = false;
    destroyWindow();
    if (changed) options.onEnabledChanged?.();
  }
  function present(): void {
    if (!enabled || !appVisible || !win || win.isDestroyed() || !ready || !painted || win.isVisible()) return;
    clearDeadline();
    try {
      release();
      win.setBackgroundColor('#00000000');
      win.showInactive();
      if (!raiseAvatar()) failClosed();
    } catch { failClosed(); }
  }
  function ensureWindow(): void {
    if (disposed || !enabled || !appVisible || win) return;
    try {
      const bounds = placeDockableHome(screen.getPrimaryDisplay().workArea);
      if (!bounds) { failClosed(); return; }
      const created = new BrowserWindow({ ...createOverlayChrome(), ...bounds,
        title: 'Desktop Companion Home', webPreferences: createOverlayWebPreferences(options.preloadPath, false) });
      win = created;
      created.setBackgroundMaterial('none');
      created.setBackgroundColor('#00000000');
      created.setSkipTaskbar(true);
      created.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL);
      created.setIgnoreMouseEvents(true);
      created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const blockNavigation = (event: { preventDefault: () => void }, url: string): void => {
        if (!isHomeRendererUrl(url, options.dev)) event.preventDefault();
      };
      created.webContents.on('will-navigate', blockNavigation);
      created.webContents.on('will-redirect', blockNavigation);
      created.webContents.on('will-attach-webview', event => event.preventDefault());
      created.webContents.on('before-input-event', event => event.preventDefault());
      const fault = (): void => { if (win === created) failClosed(); };
      created.webContents.on('preload-error', fault);
      created.webContents.on('render-process-gone', fault);
      created.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
        if (isMainFrame !== false) fault();
      });
      created.on('ready-to-show', () => { if (win === created) { painted = true; present(); } });
      created.on('closed', () => { if (win === created) failClosed(); });
      ipcMain.on(IpcChannels.homeReady, onReady);
      ipcMain.on(IpcChannels.homeClick, onClick);
      screen.on('display-added', reposition);
      screen.on('display-removed', reposition);
      screen.on('display-metrics-changed', reposition);
      // One bounded load watchdog only; no timer survives a successful show.
      loadDeadline = setTimeout(fault, 10_000);
      void created.loadURL(page).catch(fault);
    } catch { failClosed(); }
  }

  function raiseAvatar(): boolean {
    if (!options.raiseAvatar) return true;
    return Boolean(win && !win.isDestroyed() && options.raiseAvatar(win.getMediaSourceId()));
  }
  function feedback(value: HomeFeedback): void {
    if (!win || win.isDestroyed() || !ready || !painted || !win.isVisible()) return;
    try {
      if (value === 'docked' && !raiseAvatar()) { failClosed(); return; }
      win.webContents.send(IpcChannels.homeFeedback, value);
    }
    catch { failClosed(); }
  }

  return {
    setEnabled(next) {
      if (disposed || next === enabled) return;
      enabled = next;
      if (next) ensureWindow(); else destroyWindow();
      if (enabled === next) options.onEnabledChanged?.();
    },
    isEnabled: () => enabled,
    setAppVisible(visible) {
      if (disposed || appVisible === visible) return;
      appVisible = visible;
      if (visible) ensureWindow(); else destroyWindow();
    },
    observe(sample) {
      if (!ready || !painted || !enabled || !appVisible || !win || win.isDestroyed()) return;
      try {
        const bounds = win.getBounds();
        const next = homeCaptures(sample, bounds, performance.now(), win.isVisible());
        last = sample; sampledBounds = bounds;
        if (next !== capturing) { win.setIgnoreMouseEvents(!next); capturing = next; }
      } catch { failClosed(); }
    },
    getBounds: () => win && !win.isDestroyed() ? win.getBounds() : null,
    getDockingBounds: () => enabled && appVisible && ready && painted && win && !win.isDestroyed() && win.isVisible() ? win.getBounds() : null,
    feedback,
    destroy() {
      if (disposed) return;
      disposed = true; enabled = false; destroyWindow();
    },
  };
}

function sameBounds(a: HomeRect, b: HomeRect | null): boolean {
  return Boolean(b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}
