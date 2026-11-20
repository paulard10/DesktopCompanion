import { randomUUID } from 'node:crypto';
import { BrowserWindow, desktopCapturer, dialog, ipcMain, screen, session, type IpcMainEvent, type Session } from 'electron';
import { captureSize, pixelCrop, sameSelectionDisplay, selectionViewportMatches, validSelection, SCREEN_SELECTION,
  type SelectionDisplay, type SelectionNotice, type SelectionRect, type SelectionPhase } from '../shared/screenSelection.js';
import { waitForWindowsComposition } from './windowsComposition.js';
import { createOfflineVisionSession, type OfflineVisionSession, type ScreenVisionLiveReply } from './offlineVisionSession.js';
import type { ScreenVisionSendAdmission } from './screenVisionRequest.js';

export const SELECTION_PAGE = 'http://127.0.0.1:5173/screen-selection.html';
export const SELECTION_APP_PAGE = 'app://companion/screen-selection.html';
export const SELECTION_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src blob:; connect-src 'none'; object-src 'none'";
const channels = { ready: 'selection:ready', select: 'selection:select', confirm: 'selection:confirm', cancel: 'selection:cancel', vision: 'selection:vision' } as const;
export interface ScreenSelectionController { start: () => void; cancel: () => void; active: () => boolean; destroy: () => void }

export function selectionRequestAllowed(requestUrl: string, page: string): boolean {
  let request: URL;
  let expected: URL;
  try {
    request = new URL(requestUrl);
    expected = new URL(page);
  } catch {
    return false;
  }
  // The crop preview is a same-document blob. Node reports every app:// origin as "null",
  // so an origin compare would also admit a different app host.
  if (request.protocol === 'blob:') return true;
  if (expected.protocol === 'http:' || expected.protocol === 'https:') return request.origin === expected.origin;
  return expected.protocol === 'app:' && request.protocol === 'app:' &&
    request.hostname === 'companion' && request.hostname === expected.hostname;
}

export function createScreenSelectionController(options: {
  enabled: boolean; preloadPath: string; page?: string;
  /** Packaged pages load app://. That handler exists on the default session only until bound here. */
  bindAppProtocol?: (ses: Session) => void;
  canStart: () => boolean;
  onActive: (active: boolean) => void;
  conceal: () => { verify: () => boolean; restore: () => void };
  compositionReady?: (signal: AbortSignal) => Promise<void>;
  resolveOneShotEndpoint?: () => string | null;
  liveSend?: (admission: ScreenVisionSendAdmission, signal: AbortSignal) => Promise<ScreenVisionLiveReply>;
}): ScreenSelectionController {
  type Live = { id: string; display: SelectionDisplay; phase: SelectionPhase; win: BrowserWindow;
    rect?: SelectionRect; timeout: ReturnType<typeof setTimeout>; abort: AbortController;
    visibility?: ReturnType<typeof options.conceal>; ready: boolean; expiresAt: number; vision?: OfflineVisionSession };
  const page = options.page ?? SELECTION_PAGE;
  let live: Live | null = null, disposed = false, acquiring = false;
  const report = (message: string): void => {
    if (!disposed) void dialog.showMessageBox({ type: 'info', title: 'Private screen selection', message });
  };
  const owned = (event: IpcMainEvent): Live | null => {
    const s = live;
    return s && !disposed && !s.win.isDestroyed() && event.sender === s.win.webContents &&
      event.senderFrame === s.win.webContents.mainFrame && event.senderFrame?.parent === null &&
      event.senderFrame.url === page ? s : null;
  };
  const notice = (s: Live, extra: Partial<SelectionNotice> = {}): void => {
    if (s !== live || s.win.isDestroyed()) return;
    s.win.webContents.send('selection:notice', { sessionId: s.id, displayId: s.display.id,
      phase: s.phase, width: s.display.bounds.width, height: s.display.bounds.height, rect: s.rect, ...extra } satisfies SelectionNotice);
  };
  const displayValid = (s: Live): boolean => {
    const displays = screen.getAllDisplays();
    return displays.length === 1 && sameSelectionDisplay(s.display, displays[0]!);
  };
  const surfaceValid = (s: Live): boolean => {
    const content = s.win.getContentBounds(), expected = s.display.bounds;
    return (['x', 'y', 'width', 'height'] as const).every(key => content[key] === expected[key]);
  };
  const geometryFailure = (s: Live, stage: string, reason: string, viewport?: unknown): void => {
    // Dimensions/deltas only, never selected rectangles, pixels or input history.
    const expected = s.display.bounds, content = s.win.getContentBounds(), outer = s.win.getBounds();
    const delta = (rect: SelectionRect) => Object.fromEntries((['x','y','width','height'] as const).map(k => [k, rect[k] - expected[k]]));
    const displays = screen.getAllDisplays(), work = displays.find(d => d.id === s.display.id)?.workArea;
    const view = viewport && typeof viewport === 'object' ? viewport as Record<string, unknown> : {};
    const safeView = Object.fromEntries(['width', 'height', 'dpr'].map(k => [k, typeof view[k] === 'number' && Number.isFinite(view[k]) ? view[k] : null]));
    console.log('desktop-companion: selection-geometry ' + JSON.stringify({ stage, reason, displayCount: displays.length,
      expectedSize: { width: expected.width, height: expected.height }, scaleFactor: s.display.scaleFactor,
      workAreaSize: work ? { width: work.width, height: work.height } : null, viewport: safeView,
      contentSize: { width: content.width, height: content.height }, outerSize: { width: outer.width, height: outer.height },
      contentDelta: delta(content), outerDelta: delta(outer) }));
  };
  function restore(s: Live): void {
    const visibility = s.visibility; s.visibility = undefined;
    visibility?.restore();
  }
  function finish(): void {
    const s = live; if (!s) return;
    live = null; clearTimeout(s.timeout); s.abort.abort(); s.vision?.dispose(); s.vision = undefined;
    try { if (!s.win.isDestroyed()) s.win.destroy(); }
    finally {
      try { restore(s); } catch { report('Some companion windows could not be restored. Use Tray Show or restart.'); }
      finally { options.onActive(false); }
    }
  }
  const onReady = (event: IpcMainEvent, ...args: unknown[]): void => {
    const s = owned(event); if (!s || s.ready) return;
    if (args.length !== 1 || !selectionViewportMatches(args[0], s.display) || !surfaceValid(s)) {
      geometryFailure(s, 'renderer-ready', 'viewport-or-content-mismatch', args[0]);
      finish(); report('Selection viewport did not match the display. Nothing was captured.'); return;
    }
    s.ready = true; notice(s);
  };
  const onSelect = (event: IpcMainEvent, ...args: unknown[]): void => {
    const s = owned(event);
    if (!s || !s.ready || args.length !== 3 || args[0] !== s.id || args[1] !== s.display.id ||
        !['SELECTING', 'AWAITING_CAPTURE_CONFIRMATION'].includes(s.phase)) return;
    if (!displayValid(s) || !surfaceValid(s)) { finish(); return; }
    s.rect = undefined; s.phase = 'SELECTING';
    if (!validSelection(args[2], s.display)) { notice(s, { message: 'Select a rectangle at least 16 × 16 DIP inside this display.' }); return; }
    try { pixelCrop(args[2], s.display, captureSize(s.display)); }
    catch { notice(s, { message: 'Selected area exceeds the native-resolution crop budget. Select a smaller area.' }); return; }
    s.rect = { ...args[2] }; s.phase = 'AWAITING_CAPTURE_CONFIRMATION'; notice(s);
  };
  const onConfirm = (event: IpcMainEvent, ...args: unknown[]): void => {
    const s = owned(event);
    if (!s || args.length !== 2 || args[0] !== s.id || args[1] !== s.display.id ||
        s.phase !== 'AWAITING_CAPTURE_CONFIRMATION' || !s.rect || acquiring) return;
    // Trusted selection window + exact token/display/phase; no generic capture IPC.
    s.phase = 'CAPTURING'; acquiring = true; notice(s);
    void capture(s).finally(() => { acquiring = false; });
  };
  const onCancel = (event: IpcMainEvent, ...args: unknown[]): void => {
    const s = owned(event); if (s && args.length === 1 && args[0] === s.id) finish();
  };
  const onVision = (event: IpcMainEvent, ...args: unknown[]): void => {
    const s = owned(event);
    if (!options.enabled || !s || s.phase !== 'PREVIEWING' || args.length !== 1) return;
    s.vision?.dispatch(args[0]);
  };
  const exclusionSettled = async (s: Live): Promise<boolean> => {
    const hidden = (): boolean => s === live && !s.win.isDestroyed() && !s.win.isVisible() && s.visibility?.verify() === true;
    if (hidden()) return true;
    // Hide is normally synchronous. A short poll covers a show that was already
    // in flight; it does not replace the exclusion check.
    const deadline = performance.now() + 320;
    while (performance.now() < deadline) {
      if (s !== live) return false;
      await new Promise(resolve => setTimeout(resolve, 16));
      if (hidden()) return true;
    }
    return hidden();
  };
  async function capture(s: Live): Promise<void> {
    const started = performance.now();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let stage = 'precheck';
    let sourceCount: number | null = null;
    let sourceMatched: boolean | null = null;
    try {
      if (!displayValid(s) || !surfaceValid(s) || !options.canStart()) throw new Error('Capture is no longer safe.');
      const expected = captureSize(s.display);
      // A bounded watchdog disposes UI/refs; desktopCapturer itself has no abort API.
      deadline = setTimeout(() => { if (s === live) { finish(); report('Capture timed out. No image was retained.'); } }, 12_000);
      stage = 'hide';
      s.win.hide(); s.visibility = options.conceal();
      stage = 'exclusion';
      const excludedNow = s === live && !s.win.isDestroyed() && !s.win.isVisible() && s.visibility?.verify() === true;
      if (!excludedNow && !await exclusionSettled(s)) throw new Error('Window exclusion could not be verified.');
      stage = 'composition';
      await (options.compositionReady ?? waitForWindowsComposition)(s.abort.signal);
      if (s !== live) return;
      stage = 'exclusion';
      if (!displayValid(s) || s.win.isVisible() || !s.visibility.verify()) throw new Error('Window exclusion could not be verified.');
      stage = 'acquire';
      let sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: expected, fetchWindowIcons: false });
      if (s !== live) { sources = []; return; }
      sourceCount = sources.length;
      sourceMatched = sources.length === 1 && sources[0]?.display_id === String(s.display.id);
      stage = 'source';
      if (!displayValid(s) || s.win.isVisible() || !s.visibility.verify() || !sourceMatched)
        throw new Error('Capture source or visibility changed.');
      stage = 'image';
      const source = sources[0];
      if (!source) throw new Error('Capture source or visibility changed.');
      let full = source.thumbnail;
      sources = [];
      if (full.isEmpty()) throw new Error('Empty capture.');
      if (full.getScaleFactors().length !== 1 || full.getScaleFactors()[0] !== 1) throw new Error('Unverified image density.');
      // NativeImage density is explicit: crop rectangles refer to the scale-1 bitmap.
      const actual = full.getSize(1);
      stage = 'crop';
      const crop = pixelCrop(s.rect!, s.display, actual);
      let cropped = full.crop(crop);
      // Release full-display references before serialization or renderer delivery.
      full = null as unknown as typeof full;
      if (cropped.isEmpty()) throw new Error('Empty crop.');
      const size = cropped.getSize(1);
      if (size.width !== crop.width || size.height !== crop.height) throw new Error('Crop dimensions changed.');
      stage = 'budget';
      const png = cropped.toPNG({ scaleFactor: 1 });
      cropped = null as unknown as typeof cropped;
      if (png.byteLength === 0 || png.byteLength > SCREEN_SELECTION.maxPngBytes) throw new Error('Image payload exceeds budget.');
      if (s !== live) return;
      restore(s); options.onActive(false);
      s.phase = 'PREVIEWING';
      const work = screen.getDisplayNearestPoint(s.display.bounds).workArea;
      const width = Math.min(work.width, Math.max(420, Math.min(520, size.width + 72)));
      const imageBand = Math.min(240, Math.max(96, Math.round(size.height * ((width - 48) / Math.max(1, size.width)))));
      const height = Math.min(work.height, imageBand + 400);
      s.win.setAlwaysOnTop(false);
      s.win.setBounds({ x: work.x + Math.round((work.width - width) / 2), y: work.y + Math.round((work.height - height) / 2), width, height });
      s.win.setResizable(true);
      let initialImage: SelectionNotice['image'] = { png, ...size };
      // Only the trusted acquisition supplies canonical pixels and geometry.
      // Renderer actions contain IDs/question/token, never image bytes or paths.
      s.vision = createOfflineVisionSession({ sessionId: s.id, expiresAt: s.expiresAt,
        ...(options.resolveOneShotEndpoint ? { resolveOneShotEndpoint: options.resolveOneShotEndpoint } : {}),
        ...(options.liveSend ? { liveSend: options.liveSend } : {}),
        crop: { kind: 'approved-local-crop', mime: 'image/png', bytes: png, ...crop,
          sourceWidth: actual.width, sourceHeight: actual.height },
        publish: vision => {
          const image = initialImage; initialImage = undefined;
          notice(s, { vision, ...(image ? { image } : {}) });
        },
      });
      s.vision.dispatch({ type: 'edit', sessionId: s.id, question: '', revision: 1, scenario: 'success' });
      s.win.show();
      // Aggregate only: no origins, pixels, source names, paths or image contents.
      console.log(`desktop-companion: local-preview durationMs=${Math.round(performance.now() - started)} dipSize=${s.rect!.width}x${s.rect!.height} pixels=${size.width}x${size.height} bytes=${png.byteLength}`);
    } catch (error) {
      if (s === live) {
        const known = new Set(['Capture is no longer safe.', 'Window exclusion could not be verified.',
          'Windows composition could not be verified. Nothing was captured.', 'Windows x64 composition verification required.',
          'Capture source or visibility changed.', 'Empty capture.', 'Unverified image density.',
          'Capture dimensions or region do not match the selected display.',
          'Selected area exceeds the crop budget. Select a smaller area.', 'Empty crop.', 'Crop dimensions changed.',
          'Image payload exceeds budget.']);
        const category = error instanceof Error && known.has(error.message) ? error.message : 'native';
        let visibleCount: number | null = null;
        try { visibleCount = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed() && win.isVisible()).length; }
        catch { visibleCount = null; }
        // Phase, category and sizes only. No pixels, questions, credentials or paths.
        console.log('desktop-companion: capture-failed ' + JSON.stringify({
          phase: s.phase, stage, category, dipWidth: s.rect?.width ?? null, dipHeight: s.rect?.height ?? null,
          displayWidth: s.display.bounds.width, displayHeight: s.display.bounds.height, scaleFactor: s.display.scaleFactor,
          selectionVisible: !s.win.isDestroyed() && s.win.isVisible(), selectionDestroyed: s.win.isDestroyed(),
          visibleCount, sourceCount, sourceMatched,
        }));
        finish(); report('Capture could not be safely completed (display, image budget or window exclusion). Nothing was retained. Try again with one display and a smaller area.');
      }
    } finally { if (deadline) clearTimeout(deadline); }
  }
  const onDisplayChange = (): void => { if (live) { finish(); report('Display configuration changed. Selection was cancelled.'); } };
  const handlers = { ready: onReady, select: onSelect, confirm: onConfirm, cancel: onCancel, vision: onVision };
  if (options.enabled) {
    for (const key of Object.keys(channels) as Array<keyof typeof channels>) ipcMain.on(channels[key], handlers[key]);
    screen.on('display-added', onDisplayChange);
    screen.on('display-removed', onDisplayChange);
    screen.on('display-metrics-changed', onDisplayChange);
  }
  return {
    active: () => live !== null,
    start() {
      if (!options.enabled || disposed || live || acquiring) return;
      try {
      if (!options.canStart()) { report('Finish movement/docking, close chat and stop voice or replies before selecting.'); return; }
      const displays = screen.getAllDisplays();
      // getSources cannot filter a monitor before generating screen thumbnails.
      if (displays.length !== 1) { report('This private one-shot prototype requires one connected display. No screen was captured.'); return; }
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      try {
        const expected = captureSize(display);
        const physical = screen.dipToScreenRect(null, display.bounds);
        if (physical.width !== expected.width || physical.height !== expected.height) throw new Error('Unverified DPI mapping.');
      } catch { report('Display exceeds the native-resolution capture budget or DPI mapping cannot be verified. Nothing was captured.'); return; }
      const isolated = session.fromPartition('screen-selection'); // In-memory; no persist: prefix.
      isolated.setPermissionRequestHandler((_wc, _p, callback) => callback(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: {
        ...details.responseHeaders, 'Content-Security-Policy': [SELECTION_CSP], 'Cache-Control': ['no-store'] } }));
      if (page.startsWith('app:')) options.bindAppProtocol?.(isolated);
      isolated.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !selectionRequestAllowed(details.url, page) });
      });
      const win = new BrowserWindow({ ...display.bounds, show: false, frame: false, transparent: true,
        backgroundColor: '#00000000', skipTaskbar: true, alwaysOnTop: true, resizable: false, movable: false,
        title: 'Private local preview', webPreferences: { preload: options.preloadPath, session: isolated,
          sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false, zoomFactor: 1 } });
      const s: Live = { id: randomUUID(), display: { id: display.id, bounds: { ...display.bounds }, scaleFactor: display.scaleFactor },
        phase: 'SELECTING', win, ready: false, expiresAt: Date.now() + SCREEN_SELECTION.sessionMs,
        abort: new AbortController(), timeout: setTimeout(finish, SCREEN_SELECTION.sessionMs) };
      live = s; options.onActive(true);
      win.setBackgroundMaterial('none'); win.setMenuBarVisibility(false);
      // Windows constrains the initial non-fullscreen constructor rectangle to
      // workArea. Explicit content bounds establish our full-display DIP scope
      // before loading; exact native and viewport checks remain mandatory.
      win.setContentBounds(s.display.bounds);
      // Constructor backgroundColor alone left the native surface opaque in
      // the Windows A/B test. Explicitly clear after placement, before loading.
      win.setBackgroundColor('#00000000');
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, url) => { if (url !== page) event.preventDefault(); });
      win.webContents.on('will-redirect', event => event.preventDefault());
      win.webContents.on('will-attach-webview', event => event.preventDefault());
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); if (live === s) finish(); }
        if ((input.control || input.meta) && ['+', '-', '=', '0'].includes(input.key)) event.preventDefault();
      });
      win.webContents.on('render-process-gone', () => { if (live === s) finish(); });
      win.webContents.on('preload-error', () => { if (live === s) finish(); });
      win.on('closed', () => { if (live === s) finish(); });
      win.once('ready-to-show', () => {
        if (live !== s) return;
        if (!displayValid(s) || !surfaceValid(s)) {
          geometryFailure(s, 'ready-to-show', 'display-or-content-mismatch');
          finish(); report('Selection surface did not match the display. Nothing was captured.'); return;
        }
        win.show();
      });
      void win.loadURL(page).catch(() => {
        if (live !== s) return;
        finish();
        report('Selection could not be opened. Nothing was captured.');
      });
      } catch { finish(); report('Selection window could not be opened safely. Nothing was captured.'); }
    },
    cancel: finish,
    destroy() {
      disposed = true; finish();
      if (options.enabled) {
        for (const key of Object.keys(channels) as Array<keyof typeof channels>) ipcMain.removeListener(channels[key], handlers[key]);
        screen.removeListener('display-added', onDisplayChange);
        screen.removeListener('display-removed', onDisplayChange);
        screen.removeListener('display-metrics-changed', onDisplayChange);
      }
    },
  };
}
