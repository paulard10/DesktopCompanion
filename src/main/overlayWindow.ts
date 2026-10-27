import path from 'node:path';
import { BrowserWindow, ipcMain, screen, systemPreferences, type IpcMainEvent } from 'electron';
import { FOLLOW, enableFollow, followInputSuppressed, holdFollow, initialFollow, observeFollowCursor, planFollow, stepFollow, type FollowView } from '../shared/cursorFollow.js';
import {
  CURSOR_POLL_MS,
  INITIAL_POINTER_STATE,
  decidePointerMode,
  observeCircle,
  type PointerDecisionState,
  type PointerMode,
} from '../shared/clickThrough.js';
import { chatTriggerVisible, withChatTrigger } from '../shared/chatTrigger.js';
import { readGesture } from '../shared/gesturePose.js';
import { BEHAVIOR_PHASES, IpcChannels, type BehaviorPhaseName } from '../shared/ipc.js';
import { EYE_PREVIEW_CUES, type EyePreviewCue } from '../shared/faceExpression.js';
import { isPresenceName } from '../shared/presence.js';
import {
  OVERLAY_ALWAYS_ON_TOP_LEVEL,
  createOverlayChrome,
  createOverlayWebPreferences,
} from '../shared/overlayOptions.js';
import { placeOverlay } from '../shared/placement.js';
import {
  createTravel,
  nudgeTarget,
  recoverWindow,
  rememberHome,
  requestHome,
  requestTravel,
  stepTravel,
  stopTravel,
  syncTravelBounds,
  travelBlock,
  workAreaDip,
  type TravelDirection,
  type TravelState,
} from '../shared/desktopMovement.js';
import type { TrailSample } from '../shared/neonTrail.js';
import { companionPreload, companionRendererRoot } from '../shared/packagedLayout.js';
import { WANDER_EXPLORE_MS, WANDER_HOP_MAX_DIP, WANDER_HOP_MIN_DIP, type WanderSnapshot } from '../shared/wander.js';
import { isRobotRendererUrl } from '../shared/trustedUrl.js';

export interface OverlayController {
  setFollowEnabled: (enabled: boolean) => void;
  isFollowing: () => boolean;
  show: () => void;
  hide: () => void;
  wake: (source?: 'tray' | 'chat') => void;
  sleep: () => void;
  setExplore: (durationMs: number | null) => void;
  gesture: (name: string) => void;
  setPresence: (presence: 'ATTENTIVE' | 'THINKING' | 'RESPONDING' | 'SPEAKING' | 'HAPPY' | 'ERROR' | 'IDLE' | 'CLEAR') => void;
  setEyePreview: (cue: EyePreviewCue) => void;
  getBounds: () => { x: number; y: number; width: number; height: number };
  setRecoveryCapture: (enabled: boolean) => void;
  isRecoveryCapture: () => boolean;
  moveBy: (direction: TravelDirection, distanceDip?: number) => void;
  moveHome: () => void;
  stopMovement: () => void;
  moveTop: () => void;
  wanderView: () => WanderSnapshot | null;
  destroy: () => void;
}

export function createOverlayWindow(options: {
  dev: boolean;
  verifyWebGL?: boolean;
  preloadPath: string;
  onFirstFrame: () => void;
  onFollowChanged?: () => void;
  getTravelBlock?: () => { chatOpen: boolean; listening: boolean; speaking: boolean; generating: boolean };
  onTrail?: (sample: TrailSample) => void;
  onTravelSettled?: () => void;
  onRobotPhase?: (phase: BehaviorPhaseName) => void;
  onBodyHover?: (onBody: boolean) => void;
  onBodyClick?: () => void;
  onShown?: () => void;
  onDisplayChanged?: () => void;
}): OverlayController {
  const bounds = currentPlacement();
  const win = new BrowserWindow({
    ...bounds,
    ...createOverlayChrome(),
    title: 'Desktop Companion',
    webPreferences: createOverlayWebPreferences(options.preloadPath, options.dev),
  });

  // Windows 11 defaults the system backdrop to Mica, which draws a solid rounded
  // panel behind a transparent window. 'none' leaves only the page content.
  win.setBackgroundMaterial('none');
  win.setBackgroundColor('#00000000');
  // Ordinary always-on-top. screen-saver level is intentionally not used.
  win.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setMenuBarVisibility(false);
  // Click-through until a fresh sample says the pointer is on the body proxy.
  win.setIgnoreMouseEvents(true);
  const onConsole = (event: { message: string }): void => {
    if ((options.dev && event.message.startsWith('desktop-companion: probe')) ||
        (options.verifyWebGL && event.message.startsWith('desktop-companion: webgl'))) {
      console.log(event.message);
    }
  };
  if (options.dev || options.verifyWebGL) {
    win.webContents.on('console-message', onConsole);
  }

  let recoveryCapture = false;
  let frameShown = false;
  let destroyed = false;
  let circleClicks = 0;
  let pointerOnBody = false;
  let hoverNotify = false;
  let appliedMode: PointerMode = 'passthrough';
  let pointerState: PointerDecisionState = INITIAL_POINTER_STATE;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let travelTimer: ReturnType<typeof setInterval> | null = null;
  let travel: TravelState = createTravel(bounds, { x: bounds.x, y: bounds.y });
  let travelAnnounced = false;
  let travelLog = '';
  let boundsNoted = false;
  // Initialized with the other state, before any return. A later `let` stays
  // in the temporal dead zone after the controller is returned.
  let settleQueued = false;
  let lastPointerSignature = '';
  let lastPointerLocal = '';
  let lastPointerLogAt = 0;
  let robotPhase = 'SLEEPING';
  let follow = initialFollow();
  let followSleepRequested = false;
  let animationSettingsAt = -Infinity;
  let reducedMotion = true;

  const show = (): void => {
    if (destroyed || win.isDestroyed()) {
      return;
    }
    win.setSkipTaskbar(true);
    win.showInactive();
    win.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL);
    startPolling();
    options.onShown?.();
  };

  const hide = (): void => {
    if (destroyed || win.isDestroyed()) {
      return;
    }
    win.hide();
    stopPolling();
    haltTravel('clear');
    applyMode('passthrough', 'hidden');
  };

  const reposition = (): void => {
    if (destroyed || win.isDestroyed()) {
      return;
    }
    setFollowEnabled(false);
    const current = win.getBounds();
    const matching = workAreaDip(screen.getDisplayMatching(current));
    const fallback = screen.getPrimaryDisplay().workArea;
    const next = recoverWindow(current, matching, fallback);
    travel = stopTravel(syncTravelBounds(travel, next));
    const home = placeOverlay(matching ?? fallback);
    travel = rememberHome(travel, home);
    if (next.x !== current.x || next.y !== current.y || next.width !== current.width || next.height !== current.height) {
      win.setBounds(next);
    }
    announceTravel(false);
    publishTrail({
      window: win.getBounds(),
      workArea: matching ?? fallback,
      travelPhase: 'idle',
      asleep: robotAsleep(),
      chatOpen: options.getTravelBlock?.().chatOpen ?? false,
      forceClear: true,
    });
    sampleAndApply();
    options.onDisplayChanged?.();
  };

  const onFrameReady = (event: IpcMainEvent, payload: unknown): void => {
    if (!isTrustedFrame(event, options.dev) || frameShown) {
      return;
    }
    frameShown = true;
    if (payload === 'm1.6') {
      console.log('desktop-companion: preload=m1.6');
    }
    show();
    options.onFirstFrame();
  };

  const onCircleClick = (event: IpcMainEvent): void => {
    if (!isTrustedFrame(event, options.dev)) {
      return;
    }
    circleClicks += 1;
    console.log(`desktop-companion: body-click count=${circleClicks}`);
    options.onBodyClick?.();
  };

  const onPhase = (event: IpcMainEvent, payload: unknown): void => {
    if (!isTrustedFrame(event, options.dev) || !isBehaviorPhase(payload)) {
      return;
    }
    robotPhase = payload;
    if (payload === 'WAKING') followSleepRequested = false;
    if (payload !== 'IDLE' && payload !== 'TRACKING') stopFollowMotion('phase');
    console.log(`desktop-companion: behavior ${payload}`);
    options.onRobotPhase?.(payload);
    if (payload === 'SLEEPING' || payload === 'RETURNING_TO_SLEEP') {
      publishTrail({
        window: win.getBounds(),
        workArea: readWorkArea(),
        travelPhase: travel.phase,
        asleep: true,
        chatOpen: options.getTravelBlock?.().chatOpen ?? false,
        forceClear: true,
      });
    }
  };

  ipcMain.on(IpcChannels.frameReady, onFrameReady);
  ipcMain.on(IpcChannels.circleClick, onCircleClick);
  ipcMain.on(IpcChannels.phase, onPhase);

  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);

  win.on('show', startPolling);
  win.on('hide', () => {
    stopFollowMotion('hidden');
    stopPolling();
    applyMode('passthrough', 'hidden');
  });

  win.on('close', (event) => {
    if (!destroyed) {
      event.preventDefault();
      hide();
    }
  });

  const pageUrl = options.dev ? 'http://127.0.0.1:5173/' : 'app://companion/index.html';
  void win.loadURL(pageUrl);

  return {
    setFollowEnabled,
    isFollowing: () => follow.enabled,
    show,
    hide,
    setRecoveryCapture(enabled: boolean): void {
      recoveryCapture = enabled;
      if (enabled) stopFollowMotion('recovery');
      if (!enabled) {
        pointerState = INITIAL_POINTER_STATE;
      }
      console.log(`desktop-companion: recovery-capture ${enabled ? 'on' : 'off'}`);
      sampleAndApply();
    },
    isRecoveryCapture(): boolean {
      return recoveryCapture;
    },
    wake(source: 'tray' | 'chat' = 'tray'): void {
      sendBehavior('wake', source);
    },
    sleep(): void {
      sendBehavior('sleep');
    },
    setExplore(durationMs: number | null): void {
      if (destroyed || win.isDestroyed()) {
        return;
      }
      if (durationMs === null || durationMs <= 0) {
        win.webContents.send(IpcChannels.explore, 0);
        return;
      }
      const duration = Math.min(WANDER_EXPLORE_MS, Math.max(0, Math.round(durationMs)));
      win.webContents.send(IpcChannels.explore, duration);
    },
    gesture(name: string): void {
      const gesture = readGesture(name);
      if (!gesture || destroyed || win.isDestroyed()) {
        return;
      }
      win.webContents.send(IpcChannels.gesture, gesture);
    },
    setPresence(presence: 'ATTENTIVE' | 'THINKING' | 'RESPONDING' | 'SPEAKING' | 'HAPPY' | 'ERROR' | 'IDLE' | 'CLEAR'): void {
      if (destroyed || win.isDestroyed()) {
        return;
      }
      if (presence !== 'CLEAR' && !isPresenceName(presence)) {
        return;
      }
      win.webContents.send(IpcChannels.presence, presence);
    },
    setEyePreview(cue: EyePreviewCue): void {
      if (destroyed || win.isDestroyed()) {
        return;
      }
      if (!(EYE_PREVIEW_CUES as readonly string[]).includes(cue)) {
        return;
      }
      win.webContents.send(IpcChannels.eyePreview, cue);
    },
    getBounds(): { x: number; y: number; width: number; height: number } {
      return win.getBounds();
    },
    moveBy(direction: TravelDirection, distanceDip?: number): void {
      commandTravel(direction, distanceDip);
    },
    moveHome(): void {
      commandTravel('home');
    },
    stopMovement(): void {
      setFollowEnabled(false);
      haltTravel('fade');
    },
    moveTop(): void {
      if (destroyed || win.isDestroyed()) {
        return;
      }
      win.moveTop();
    },
    wanderView(): WanderSnapshot | null {
      if (destroyed || win.isDestroyed()) {
        return null;
      }
      const area = readWorkArea();
      const gate = options.getTravelBlock?.() ?? { chatOpen: false, listening: false, speaking: false, generating: false };
      return {
        awake: robotPhase === 'IDLE' || robotPhase === 'TRACKING',
        asleep: robotAsleep(),
        tracking: pointerOnBody,
        blocked: travelBlock(gate) !== null,
        visible: win.isVisible(),
        travelPhase: travel.phase,
        workArea: area,
        window: win.getBounds(),
        home: { x: travel.homeX, y: travel.homeY },
        displayKey: area
          ? `${Math.round(area.x)}:${Math.round(area.y)}:${Math.round(area.width)}:${Math.round(area.height)}`
          : null,
      };
    },
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      follow = initialFollow();
      stopPolling();
      haltTravel('clear');
      ipcMain.removeListener(IpcChannels.frameReady, onFrameReady);
      ipcMain.removeListener(IpcChannels.circleClick, onCircleClick);
      ipcMain.removeListener(IpcChannels.phase, onPhase);
      screen.removeListener('display-added', reposition);
      screen.removeListener('display-removed', reposition);
      screen.removeListener('display-metrics-changed', reposition);
      if (!win.isDestroyed()) {
        win.webContents.removeListener('console-message', onConsole);
        win.destroy();
      }
    },
  };

  function startPolling(): void {
    if (destroyed || pollTimer) {
      return;
    }
    sampleAndApply();
    pollTimer = setInterval(sampleAndApply, CURSOR_POLL_MS);
  }

  function stopPolling(): void {
    if (!pollTimer) {
      return;
    }
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function readWorkArea() {
    if (destroyed || win.isDestroyed()) {
      return null;
    }
    try { return workAreaDip(screen.getDisplayMatching(win.getBounds())); }
    catch { return null; }
  }

  function commandTravel(command: TravelDirection | 'home', distanceDip?: number): void {
    if (destroyed || win.isDestroyed()) {
      return;
    }
    setFollowEnabled(false);
    const area = readWorkArea();
    const gate = options.getTravelBlock?.() ?? { chatOpen: false, listening: false, speaking: false, generating: false };
    const block = travelBlock(gate);
    if (!area) {
      if (options.dev) {
        console.log(`desktop-companion: travel request command=${command} block=${block ?? 'none'} result=no-work-area`);
      }
      haltTravel('clear');
      return;
    }
    const boundsNow = win.getBounds();
    travel = syncTravelBounds(travel, boundsNow);
    const home = placeOverlay(area);
    travel = rememberHome(travel, home);
    const now = Date.now();
    const step = distanceDip == null || !Number.isFinite(distanceDip)
      ? undefined
      : Math.min(WANDER_HOP_MAX_DIP, Math.max(WANDER_HOP_MIN_DIP, Math.round(distanceDip)));
    travel = command === 'home'
      ? requestHome(travel, now, area)
      : requestTravel(travel, nudgeTarget(travel, command, area, step), now, area);
    boundsNoted = false;
    if (options.dev) {
      console.log(
        `desktop-companion: travel request command=${command} block=${block ?? 'none'} asleep=${robotAsleep()} phase=${travel.phase} from=${boundsNow.x},${boundsNow.y} to=${Math.round(travel.toX)},${Math.round(travel.toY)}`,
      );
    }
    ensureTravelTimer();
    tickTravel();
  }

  function haltTravel(intent: 'fade' | 'clear'): void {
    stopFollowMotion(intent === 'clear' ? 'hidden' : 'stopped');
    travel = stopTravel(travel);
    if (travelTimer) {
      clearInterval(travelTimer);
      travelTimer = null;
    }
    announceTravel(false);
    notifySettled();
    if (win.isDestroyed()) {
      return;
    }
    const live = win.getBounds();
    publishTrail({
      window: live,
      workArea: readWorkArea(),
      travelPhase: 'idle',
      asleep: robotAsleep(),
      chatOpen: options.getTravelBlock?.().chatOpen ?? false,
      forceClear: intent === 'clear',
    });
  }

  function ensureTravelTimer(): void {
    if (travel.phase === 'idle' && follow.phase !== 'moving') {
      haltTravel('fade');
      return;
    }
    if (travelTimer) {
      return;
    }
    travelTimer = setInterval(tickTravel, 32);
  }

  function tickTravel(): void {
    if (destroyed || win.isDestroyed()) {
      haltTravel('clear');
      return;
    }
    if (follow.enabled && travel.phase === 'idle') {
      tickFollow();
      return;
    }
    const area = readWorkArea();
    const live = win.getBounds();
    travel = syncTravelBounds({ ...travel, x: travel.x, y: travel.y }, { ...live, x: travel.x, y: travel.y });
    const gate = options.getTravelBlock?.() ?? { chatOpen: false, listening: false, speaking: false, generating: false };
    const block = travelBlock(gate);
    const before = travel.phase;
    try {
      travel = stepTravel(travel, Date.now(), area, block);
    } catch {
      haltTravel('clear');
      return;
    }
    const travelSignature = `${travel.phase}:${travel.pause ?? 'none'}`;
    if (travelSignature !== travelLog) {
      travelLog = travelSignature;
      console.log(`desktop-companion: travel phase=${travel.phase} pause=${travel.pause ?? 'none'}`);
    }
    const nextX = Math.round(travel.x);
    const nextY = Math.round(travel.y);
    applyWindowPosition(nextX, nextY, live);
    publishTrail({
      window: { x: nextX, y: nextY, width: live.width, height: live.height },
      workArea: area,
      travelPhase: travel.phase,
      asleep: robotAsleep(),
      chatOpen: gate.chatOpen,
      forceClear: false,
    });
    if (travel.phase === 'idle') {
      announceTravel(false);
      if (travelTimer) {
        clearInterval(travelTimer);
        travelTimer = null;
      }
      notifySettled();
      return;
    }
    announceTravel(travel.phase === 'moving');
  }

  function notifySettled(): void {
    if (destroyed || settleQueued) {
      return;
    }
    settleQueued = true;
    queueMicrotask(() => {
      settleQueued = false;
      if (destroyed) {
        return;
      }
      options.onTravelSettled?.();
    });
  }

  function robotAsleep(): boolean {
    return robotPhase === 'SLEEPING' || robotPhase === 'RETURNING_TO_SLEEP';
  }

  function publishTrail(sample: TrailSample): void {
    try {
      options.onTrail?.(sample);
    } catch (error) {
      console.error('desktop-companion: trail-sample-failed', error instanceof Error ? error.name : 'error');
    }
  }

  function announceTravel(moving: boolean): void {
    if (destroyed || win.isDestroyed() || travelAnnounced === moving) {
      return;
    }
    travelAnnounced = moving;
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(IpcChannels.travel, moving);
    }
  }

  function sampleAndApply(): void {
    if (destroyed || win.isDestroyed()) {
      return;
    }
    const now = Date.now();
    const visible = win.isVisible();
    let cursor: { x: number; y: number };
    try { cursor = screen.getCursorScreenPoint(); }
    catch {
      stopFollowMotion('cursor-unavailable');
      applyMode('passthrough', 'cursor-unavailable');
      return;
    }
    const windowBounds = win.getBounds();
    if (follow.enabled) {
      const at = performance.now();
      if (at - animationSettingsAt >= FOLLOW.decisionMs) {
        animationSettingsAt = at;
        try { reducedMotion = systemPreferences.getAnimationSettings().prefersReducedMotion; }
        catch { reducedMotion = true; }
      }
      const before = follow.phase;
      follow = observeFollowCursor(follow, { x: cursor.x, y: cursor.y, at });
      follow = planFollow(follow, followView(windowBounds), at);
      finishFollowStep(before);
    }
    const inputSuppressed = followInputSuppressed(follow, performance.now());
    const observation = observeCircle({
      cursor,
      windowOrigin: { x: windowBounds.x, y: windowBounds.y },
      windowWidth: windowBounds.width,
      windowHeight: windowBounds.height,
      sampleAt: now,
    });
    const next = decidePointerMode(visible ? observation : null, pointerState, {
      visible,
      recoveryCapture,
      now,
    });
    pointerState = next.state;
    const local = {
      x: cursor.x - windowBounds.x,
      y: cursor.y - windowBounds.y,
    };
    const pointed =
      visible && observation.cursorInsideWindow
        ? withChatTrigger({ mode: next.mode, reason: next.reason }, local.x, local.y, chatTriggerVisible(robotPhase))
        : { mode: next.mode, reason: next.reason };
    const onBody = Boolean(
      visible &&
      observation.cursorInsideWindow &&
      observation.distanceDip != null &&
      (observation.distanceDip <= observation.captureRadiusDip || observation.onArm === true),
    );
    if (onBody !== pointerOnBody) {
      pointerOnBody = onBody;
      if (!hoverNotify) {
        hoverNotify = true;
        queueMicrotask(() => {
          hoverNotify = false;
          if (!destroyed) {
            options.onBodyHover?.(pointerOnBody);
          }
        });
      }
    }
    const effective = inputSuppressed && !recoveryCapture
      ? { mode: 'passthrough' as const, reason: 'follow-motion' } : pointed;
    applyMode(effective.mode, effective.reason);
    logPointerSample(visible ? observation : null, cursor, windowBounds, effective.mode, effective.reason, now);
    if (visible && !win.webContents.isDestroyed()) {
      win.webContents.send(IpcChannels.cursorSample, {
        x: cursor.x,
        y: cursor.y,
        originX: windowBounds.x,
        originY: windowBounds.y,
        width: windowBounds.width,
        height: windowBounds.height,
        at: now,
        inputSuppressed,
      });
    }
  }

  function sendBehavior(command: 'wake' | 'sleep', source: 'tray' | 'chat' = 'tray'): void {
    if (destroyed || win.isDestroyed()) {
      return;
    }
    if (command === 'sleep') {
      followSleepRequested = true;
      stopFollowMotion('sleep-request');
    } else {
      followSleepRequested = false;
    }
    win.webContents.send(IpcChannels.behavior, command);
    console.log(`desktop-companion: ${source}-${command}`);
  }

  function logPointerSample(
    observation: ReturnType<typeof observeCircle> | null,
    cursor: { x: number; y: number },
    windowBounds: { x: number; y: number },
    mode: PointerMode,
    reason: string,
    now: number,
  ): void {
    const localX = Math.round(cursor.x - windowBounds.x);
    const localY = Math.round(cursor.y - windowBounds.y);
    const inside = Boolean(observation?.cursorInsideWindow);
    const onTarget =
      inside &&
      observation?.distanceDip != null &&
      (observation.distanceDip <= observation.captureRadiusDip || observation.onArm === true);
    const ignore = mode === 'passthrough';
    const signature = `${inside}|${onTarget}|${mode}|${ignore}|${reason}`;
    const local = `${localX},${localY}`;
    const signatureChanged = signature !== lastPointerSignature;
    const insideMoved = inside && local !== lastPointerLocal && now - lastPointerLogAt >= 200;
    if (!signatureChanged && !insideMoved) {
      return;
    }
    lastPointerSignature = signature;
    lastPointerLocal = local;
    lastPointerLogAt = now;
    console.log(
      `desktop-companion: pointer local=${local} inside=${inside} onTarget=${onTarget} mode=${mode} ignore=${ignore} reason=${reason}`,
    );
  }

  function applyMode(mode: PointerMode, reason: string): void {
    if (destroyed || win.isDestroyed()) {
      return;
    }
    if (appliedMode === mode) {
      return;
    }
    appliedMode = mode;
    // No forward option. Cursor polling does not need forwarded mouse moves.
    win.setIgnoreMouseEvents(mode === 'passthrough');
    console.log(`desktop-companion: pointer-mode ${mode} (${reason})`);
  }

  function followView(live = win.getBounds()): FollowView {
    let display: ReturnType<typeof screen.getDisplayMatching> | null = null;
    try { display = screen.getDisplayMatching(live); } catch { /* unavailable display fails closed */ }
    const area = workAreaDip(display);
    const key = area && display ? `${display.id}:${display.scaleFactor}:${area.x}:${area.y}:${area.width}:${area.height}` : null;
    return { window: live, workArea: area, displayKey: key,
      // Conservatively protect the whole compact footprint, including arms and badge.
      visualRadiusDip: Math.hypot(live.width / 2, live.height / 2),
      visible: win.isVisible(), awake: !followSleepRequested && (robotPhase === 'IDLE' || robotPhase === 'TRACKING'),
      blocked: travelBlock(options.getTravelBlock?.() ?? { chatOpen: false, listening: false, speaking: false, generating: false }) !== null,
      recovery: recoveryCapture, reducedMotion, manual: travel.phase !== 'idle' };
  }

  function setFollowEnabled(enabled: boolean): void {
    if (destroyed || win.isDestroyed() || !options.dev || enabled === follow.enabled) return;
    const before = follow.phase;
    const live = win.getBounds();
    if (enabled) {
      // Enabling explicitly replaces any fixed-endpoint move; main disables wander first.
      haltTravel('fade');
      follow = enableFollow(live, followView(live).displayKey, performance.now());
    } else {
      follow = initialFollow();
    }
    finishFollowStep(before);
    options.onFollowChanged?.();
    sampleAndApply();
  }

  function stopFollowMotion(reason: string): void {
    if (!follow.enabled) return;
    const before = follow.phase;
    follow = holdFollow(follow, performance.now(), reason);
    finishFollowStep(before);
  }

  function finishFollowStep(before: string): void {
    if (follow.phase === 'moving') {
      ensureTravelTimer();
    } else if (before === 'moving' && travel.phase === 'idle') {
      if (travelTimer) { clearInterval(travelTimer); travelTimer = null; }
      announceTravel(false);
      const live = win.getBounds();
      travel = syncTravelBounds(travel, live);
      publishTrail({ window: live, workArea: readWorkArea(), travelPhase: 'idle', asleep: robotAsleep(),
        chatOpen: options.getTravelBlock?.().chatOpen ?? false, forceClear: false });
      notifySettled();
    }
  }

  function tickFollow(): void {
    const before = follow.phase;
    const live = win.getBounds();
    const view = followView(live);
    const at = performance.now();
    follow = stepFollow(planFollow(follow, view, at), view, at);
    const nextX = Math.round(follow.x), nextY = Math.round(follow.y);
    if (follow.phase === 'moving') {
      applyWindowPosition(nextX, nextY, live);
      announceTravel(true);
      publishTrail({ window: { ...live, x: nextX, y: nextY }, workArea: view.workArea,
        travelPhase: 'moving', asleep: robotAsleep(), chatOpen: view.blocked, forceClear: false });
    }
    finishFollowStep(before);
  }

  /** Both mutually exclusive modes share this actuator and the same travel timer. */
  function applyWindowPosition(nextX: number, nextY: number, live: { x: number; y: number; width: number; height: number }): void {
    if (nextX !== live.x || nextY !== live.y) {
      win.setBounds({ x: nextX, y: nextY, width: live.width, height: live.height });
      if (!boundsNoted) {
        boundsNoted = true;
        if (options.dev) console.log(`desktop-companion: travel bounds ${live.x},${live.y} -> ${nextX},${nextY}`);
      }
    }
  }
}

export function preloadPath(): string {
  return companionPreload(__dirname);
}

export function rendererRoot(): string {
  return companionRendererRoot(__dirname);
}

function currentPlacement() {
  return placeOverlay(screen.getPrimaryDisplay().workArea);
}

function isBehaviorPhase(value: unknown): value is BehaviorPhaseName {
  return typeof value === 'string' && (BEHAVIOR_PHASES as readonly string[]).includes(value);
}

function isTrustedFrame(event: IpcMainEvent, dev: boolean): boolean {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) {
    return false;
  }
  return isRobotRendererUrl(frame.url, dev);
}
