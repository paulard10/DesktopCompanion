import fs from 'node:fs';
import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';
import {
  ageTrail,
  clearTrailState,
  createTrailState,
  resetTrail,
  setTrailReducedMotion,
  stepTrail,
  trailBounds,
  type DipRect,
  type TrailParticle,
  type TrailSample,
  type TrailState,
  type TrailStep,
} from '../shared/neonTrail.js';
import { IpcChannels } from '../shared/ipc.js';
import { OVERLAY_ALWAYS_ON_TOP_LEVEL, createOverlayChrome, createOverlayWebPreferences } from '../shared/overlayOptions.js';
import { isTrailRendererUrl } from '../shared/trustedUrl.js';

export interface TrailController {
  setEnabled: (enabled: boolean) => void;
  /** Private capture must not let the trail present itself again after it is hidden. */
  setCaptureHold: (held: boolean) => void;
  reset: () => void;
  showMarker: () => void;
  note: (sample: TrailSample) => void;
  destroy: () => void;
}

export function createTrailWindow(options: {
  dev: boolean;
  preloadPath: string;
  raiseAvatar: () => void;
  isChatOpen: () => boolean;
}): TrailController {
  let enabled = false;
  let captureHold = false;
  let destroyed = false;
  let ready = false;
  let pageFailed = false;
  let reducedLogged = false;
  let helloRejected = false;
  let drewRejected = false;
  let lastLogAt = 0;
  let lastStatusAt = 0;
  let blockedLogged = false;
  let markerUntil = 0;
  let statusSamples = 0;
  let statusSpawned = 0;
  let statusDelivered = 0;
  let win: BrowserWindow | null = null;
  let ageTimer: ReturnType<typeof setInterval> | null = null;
  let shown: DipRect | null = null;
  let work: DipRect | null = null;
  let state: TrailState = createTrailState();

  const onHello = (event: IpcMainEvent, payload: unknown): void => {
    if (!isTrailFrame(event) || (payload !== true && payload !== false)) {
      if (options.dev && !helloRejected) {
        helloRejected = true;
        console.log('desktop-companion: trail hello rejected');
      }
      return;
    }
    ready = true;
    if (options.dev) {
      console.log(`desktop-companion: trail hello ready=true reduced=${payload === true}`);
    }
    if (markerActive()) {
      presentMarker();
      return;
    }
    if (payload === true) {
      commit(setTrailReducedMotion(state, true));
      logReduced();
      return;
    }
    state = { ...state, reducedMotion: false };
    flush();
  };

  const onMotion = (event: IpcMainEvent, payload: unknown): void => {
    if (!isTrailFrame(event) || (payload !== true && payload !== false)) {
      return;
    }
    if (payload === true) {
      commit(setTrailReducedMotion(state, true));
      logReduced();
      return;
    }
    state = { ...state, reducedMotion: false };
  };

  const onIdle = (event: IpcMainEvent): void => {
    if (!isTrailFrame(event) || state.particles.length > 0) {
      return;
    }
    markerUntil = 0;
    hideWindow();
  };

  const onFault = (event: IpcMainEvent): void => {
    if (!isTrailFrame(event)) {
      return;
    }
    failClosed('trail-renderer-fault');
  };

  const onDrew = (event: IpcMainEvent, payload: unknown): void => {
    if (!isTrailFrame(event)) {
      if (options.dev && !drewRejected) {
        drewRejected = true;
        console.log('desktop-companion: trail drew rejected');
      }
      return;
    }
    const report = readDrawReport(payload);
    if (!report) {
      return;
    }
    if (options.dev) {
      console.log(
        `desktop-companion: trail drew count=${report.count} ageMs=${report.ageMs} expired=${report.expired} clipped=${report.clipped} canvas=${report.canvasW}x${report.canvasH} dip=${report.dipW}x${report.dipH}`,
      );
    }
    if (report.count <= 0 && !markerActive()) {
      hideWindow();
    }
  };

  const onFocus = (): void => {
    if (!enabled || options.isChatOpen()) {
      if (options.isChatOpen()) {
        commit(clearTrailState(state));
      }
      return;
    }
    raise();
  };

  ipcMain.on(IpcChannels.trailHello, onHello);
  ipcMain.on(IpcChannels.trailMotion, onMotion);
  ipcMain.on(IpcChannels.trailIdle, onIdle);
  ipcMain.on(IpcChannels.trailFault, onFault);
  ipcMain.on(IpcChannels.trailDrew, onDrew);
  app.on('browser-window-focus', onFocus);

  return {
    setEnabled(next: boolean): void {
      if (destroyed || next === enabled) {
        return;
      }
      enabled = next;
      if (!next) {
        state = clearTrailState(state).state;
        destroyWindow();
        console.log('desktop-companion: trail disabled');
        return;
      }
      console.log('desktop-companion: trail enabled');
      pageFailed = false;
      ensureWindow();
    },
    setCaptureHold(held: boolean): void {
      if (destroyed || captureHold === held) {
        return;
      }
      captureHold = held;
      if (held) {
        hideWindow();
      }
    },
    reset(): void {
      if (destroyed) {
        return;
      }
      markerUntil = 0;
      commit(resetTrail(state));
      console.log('desktop-companion: trail reset');
    },
    showMarker(): void {
      if (!options.dev || destroyed || pageFailed) {
        console.log('desktop-companion: trail marker blocked');
        return;
      }
      markerUntil = Date.now() + 4_500;
      console.log('desktop-companion: trail marker requested');
      ensureWindow();
      if (ready) {
        presentMarker();
      }
    },
    note(sample: TrailSample): void {
      if (destroyed || !enabled) {
        return;
      }
      work = sample.workArea;
      commit(stepTrail(state, sample, Date.now()));
    },
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      enabled = false;
      ipcMain.removeListener(IpcChannels.trailHello, onHello);
      ipcMain.removeListener(IpcChannels.trailMotion, onMotion);
      ipcMain.removeListener(IpcChannels.trailIdle, onIdle);
      ipcMain.removeListener(IpcChannels.trailFault, onFault);
      ipcMain.removeListener(IpcChannels.trailDrew, onDrew);
      app.removeListener('browser-window-focus', onFocus);
      stopAge();
      destroyWindow();
    },
  };

  function commit(step: TrailStep): void {
    state = step.state;
    if (markerActive()) {
      ensureAge();
      logStatus(step, false);
      return;
    }
    if (!ready || state.reducedMotion) {
      if (state.reducedMotion && win && !win.isDestroyed() && win.isVisible()) {
        sendClear();
        win.hide();
      }
      ensureAge();
      logStatus(step, false);
      return;
    }
    if (step.clearView) {
      sendClear();
    }
    if (!step.bounds || options.isChatOpen()) {
      hideWindow();
      stopAgeIfEmpty();
      logStatus(step, false);
      return;
    }
    const viewport = roundDip(step.bounds);
    const moved = !sameBounds(viewport, shown);
    showAt(viewport);
    let sent = false;
    if (step.spawned.length > 0) {
      sendSpawn(step.spawned, viewport);
      logDeliver(step.spawned.length);
      sent = true;
    } else if (moved) {
      sendViewport(viewport);
    }
    ensureAge();
    logStatus(step, sent);
  }

  function flush(): void {
    if (!ready || state.reducedMotion || state.particles.length === 0 || !work || options.isChatOpen()) {
      return;
    }
    const bounds = trailBounds(state.particles, work);
    if (!bounds) {
      return;
    }
    const viewport = roundDip(bounds);
    showAt(viewport);
    sendSpawn(state.particles, viewport);
    logDeliver(state.particles.length);
  }

  function ensureWindow(): void {
    if (destroyed || (win && !win.isDestroyed())) {
      return;
    }
    ready = false;
    shown = null;
    if (!fs.existsSync(options.preloadPath)) {
      failClosed('trail-preload-missing');
      return;
    }
    const created = new BrowserWindow({
      ...createOverlayChrome(),
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      title: 'Worthsi Trail',
      webPreferences: createOverlayWebPreferences(options.preloadPath, options.dev),
    });
    // Windows paints the default window color, white, through a transparent page
    // unless this is set after construction. The avatar window does the same.
    created.setBackgroundMaterial('none');
    created.setBackgroundColor('#00000000');
    created.setFocusable(false);
    created.setSkipTaskbar(true);
    created.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL);
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    lockPointer(created);
    created.on('show', () => {
      created.setBackgroundColor('#00000000');
      lockPointer(created);
      created.setSkipTaskbar(true);
      created.setFocusable(false);
    });
    created.on('close', (event) => {
      if (!destroyed) {
        event.preventDefault();
        state = clearTrailState(state).state;
        sendClear();
        created.hide();
      }
    });
    created.webContents.on('preload-error', (_event, _preloadPath, error) => {
      const message = error instanceof Error ? error.message : '';
      console.error(`desktop-companion: trail-preload-error moduleMissing=${message.includes('module not found')}`);
      failClosed('trail-preload-error');
    });
    created.webContents.on('render-process-gone', () => {
      failClosed('trail-renderer-gone');
    });
    created.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame === false) {
        return;
      }
      failClosed('trail-load-failed');
    });
    created.webContents.on('before-input-event', (event) => {
      event.preventDefault();
    });
    win = created;
    const pageUrl = options.dev ? 'http://127.0.0.1:5173/trail.html' : 'app://companion/trail.html';
    void created.loadURL(pageUrl);
  }

  function showAt(viewport: DipRect, marker = false): void {
    const created = win;
    if (captureHold || !created || created.isDestroyed() || pageFailed || (!marker && options.isChatOpen())) {
      return;
    }
    created.setBackgroundColor('#00000000');
    const wasHidden = !created.isVisible();
    const moved = !sameBounds(viewport, shown);
    if (!wasHidden && !moved) {
      return;
    }
    if (moved) {
      created.setBounds(viewport);
      shown = viewport;
    }
    lockPointer(created);
    if (wasHidden) {
      created.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL);
      created.showInactive();
      raise();
    }
  }

  function raise(): void {
    const created = win;
    if (!created || created.isDestroyed() || !created.isVisible()) {
      return;
    }
    if (options.isChatOpen()) {
      commit(clearTrailState(state));
      return;
    }
    created.moveTop();
    options.raiseAvatar();
  }

  function hideWindow(): void {
    const created = win;
    if (!created || created.isDestroyed() || !created.isVisible()) {
      shown = null;
      return;
    }
    sendClear();
    created.hide();
    shown = null;
    console.log('desktop-companion: trail hidden');
  }

  function destroyWindow(): void {
    stopAge();
    ready = false;
    shown = null;
    const created = win;
    win = null;
    if (created && !created.isDestroyed()) {
      created.destroy();
    }
  }

  function ensureAge(): void {
    if (ageTimer || state.particles.length === 0) {
      return;
    }
    ageTimer = setInterval(() => {
      commit(ageTrail(state, Date.now(), work));
      stopAgeIfEmpty();
    }, 100);
  }

  function stopAgeIfEmpty(): void {
    if (state.particles.length === 0) {
      stopAge();
    }
  }

  function stopAge(): void {
    if (!ageTimer) {
      return;
    }
    clearInterval(ageTimer);
    ageTimer = null;
  }

  function sendSpawn(particles: TrailParticle[], viewport: DipRect): void {
    send(IpcChannels.trailSpawn, { viewport, particles });
  }

  function sendViewport(viewport: DipRect): void {
    send(IpcChannels.trailViewport, viewport);
  }

  function sendClear(): void {
    send(IpcChannels.trailClear);
  }

  function send(channel: string, payload?: unknown): void {
    const created = win;
    if (!ready || !created || created.isDestroyed() || created.webContents.isDestroyed()) {
      return;
    }
    if (payload === undefined) {
      created.webContents.send(channel);
      return;
    }
    created.webContents.send(channel, payload);
  }

  function logReduced(): void {
    if (reducedLogged) {
      return;
    }
    reducedLogged = true;
    console.log('desktop-companion: trail reduced-motion');
  }

  function markerActive(): boolean {
    return Date.now() < markerUntil;
  }

  function presentMarker(): void {
    const area = screen.getPrimaryDisplay().workArea;
    const viewport = roundDip({ x: area.x + 48, y: area.y + 48, width: 200, height: 200 });
    showAt(viewport, true);
    send(IpcChannels.trailMarker, viewport);
    console.log('desktop-companion: trail marker shown w=200 h=200');
  }

  function logStatus(step: TrailStep, sent: boolean): void {
    if (!options.dev) {
      return;
    }
    statusSamples += 1;
    statusSpawned += step.spawned.length;
    if (sent) {
      statusDelivered += step.spawned.length;
    }
    const now = Date.now();
    const blocked = step.spawned.length > 0 && !sent;
    if (lastStatusAt !== 0 && now - lastStatusAt < 1_000 && !(blocked && !blockedLogged)) {
      return;
    }
    if (blocked) {
      blockedLogged = true;
    }
    lastStatusAt = now;
    const created = win;
    const visible = Boolean(created && !created.isDestroyed() && created.isVisible());
    const size = shown ? `${shown.width}x${shown.height}` : 'hidden';
    console.log(
      `desktop-companion: trail status enabled=${enabled} ready=${ready} visible=${visible} fault=${pageFailed} samples=${statusSamples} spawned=${statusSpawned} delivered=${statusDelivered} alive=${state.particles.length} hold=${step.hold ?? 'none'} size=${size}`,
    );
    statusSamples = 0;
    statusSpawned = 0;
    statusDelivered = 0;
  }

  function logDeliver(count: number): void {
    const now = Date.now();
    if (!options.dev || count <= 0 || now - lastLogAt < 1_000) {
      return;
    }
    lastLogAt = now;
    console.log(`desktop-companion: trail deliver count=${count}`);
  }

  function failClosed(reason: string): void {
    pageFailed = true;
    state = clearTrailState(state).state;
    console.error(`desktop-companion: ${reason}`);
    if (ready) {
      sendClear();
    }
    ready = false;
    shown = null;
    const created = win;
    if (created && !created.isDestroyed() && created.isVisible()) {
      created.hide();
    }
  }

  function isTrailFrame(event: IpcMainEvent): boolean {
    const frame = event.senderFrame;
    if (!frame || frame.parent !== null || !win || event.sender !== win.webContents) {
      return false;
    }
    return isTrailRendererUrl(frame.url, options.dev);
  }
}

function readDrawReport(value: unknown): {
  count: number;
  ageMs: number;
  expired: number;
  clipped: number;
  canvasW: number;
  canvasH: number;
  dipW: number;
  dipH: number;
} | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const count = readReportCount(record.count, 33);
  const ageMs = readReportCount(record.ageMs, 20_000);
  const expired = readReportCount(record.expired, 33);
  const clipped = readReportCount(record.clipped, 33);
  const canvasW = readReportCount(record.canvasW, 16_000);
  const canvasH = readReportCount(record.canvasH, 16_000);
  const dipW = readReportCount(record.dipW, 16_000);
  const dipH = readReportCount(record.dipH, 16_000);
  if (
    count === null ||
    ageMs === null ||
    expired === null ||
    clipped === null ||
    canvasW === null ||
    canvasH === null ||
    dipW === null ||
    dipH === null
  ) {
    return null;
  }
  return { count, ageMs, expired, clipped, canvasW, canvasH, dipW, dipH };
}

function readReportCount(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value) : null;
}

function lockPointer(created: BrowserWindow): void {
  created.setIgnoreMouseEvents(true);
}

function roundDip(bounds: DipRect): DipRect {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function sameBounds(left: DipRect | null, right: DipRect | null): boolean {
  if (!left || !right) {
    return false;
  }
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
