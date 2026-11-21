import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, Menu, screen } from 'electron';
import { createScreenSelectionController, SELECTION_APP_PAGE, SELECTION_PAGE, type ScreenSelectionController } from './screenSelectionWindow.js';
import { createChatController, type ChatController } from './chatWindow.js';
import { checkDisposableCredential, createSafeCredentialStore } from './safeCredentialStore.js';
import { createProviderSettings } from './providerSettings.js';
import { chatCompletionsUrl } from '../shared/qwenEndpoint.js';
import { ensureAppProtocol, registerAppProtocol, registerAppScheme } from './protocol.js';
import { installSecurityPolicy } from './security.js';
import { createOverlayWindow, preloadPath, rendererRoot, type OverlayController } from './overlayWindow.js';
import { createTrailWindow, type TrailController } from './trailWindow.js';
import { createHomeWindow, type HomeController } from './homeWindow.js';
import { createTray } from './tray.js';
import { createInstalledLoginStartup } from './windowsLoginStartup.js';
import { APP_USER_MODEL_ID } from '../shared/windowsLoginStartup.js';
import { createUserPreferencesStore, type UserPreferencesStore } from '../shared/userPreferences.js';
import { MOVE_TEST_DIP, travelBlock } from '../shared/desktopMovement.js';
import { decideBedtime, quietDelayMs } from '../shared/activity.js';
import { COMPANION_LAYOUT } from '../shared/companionLayout.js';
import {
  WANDER_EXPLORE_MS,
  createWanderState,
  disableWander,
  enableWander,
  endWanderSession,
  noteWanderInteraction,
  noteWanderWake,
  planWander,
  yieldWander,
  type WanderPlan,
  type WanderState,
} from '../shared/wander.js';

registerAppScheme();

const dev = process.env.DESKTOP_COMPANION_DEV === '1';
const smoke = process.env.DESKTOP_COMPANION_SMOKE === '1';

if (process.platform !== 'win32') {
  console.error('desktop-companion: this build supports Windows only.');
  process.exit(1);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('desktop-companion: second-instance-exit');
  app.exit(0);
}

let overlay: OverlayController | null = null;
let chat: ChatController | null = null;
let trail: TrailController | null = null;
let home: HomeController | null = null;
let selection: ScreenSelectionController | null = null;
let selectionHolding = false;
let selectionAttention = false;
let tray: { destroy: () => void; refresh: () => void } | null = null;
let trailOn = false;
let preferences: UserPreferencesStore | null = null;
let quitting = false;
let smokeTimer: NodeJS.Timeout | null = null;
let wanderTimer: ReturnType<typeof setTimeout> | null = null;
let wanderEpoch = 0;
let leaseTimer: ReturnType<typeof setTimeout> | null = null;
let leaseEpoch = 0;
let wanderClosed = false;
let quietTimer: ReturnType<typeof setTimeout> | null = null;
let bedtime = false;

function clearWanderTimer(): void {
  wanderEpoch += 1;
  if (wanderTimer) {
    clearTimeout(wanderTimer);
    wanderTimer = null;
  }
}

function clearLeaseTimer(): void {
  leaseEpoch += 1;
  if (leaseTimer) {
    clearTimeout(leaseTimer);
    leaseTimer = null;
  }
}

function clearQuietTimer(): void {
  if (quietTimer) {
    clearTimeout(quietTimer);
    quietTimer = null;
  }
}

function userBusy(): boolean {
  if (selectionHolding) {
    return true;
  }
  const activity = chat?.activity();
  return Boolean(activity && (activity.open || activity.listening || activity.speaking || activity.busy));
}

function armQuiet(): void {
  clearQuietTimer();
  if (quitting || bedtime || overlay?.wanderView()?.asleep) {
    return;
  }
  quietTimer = setTimeout(() => {
    quietTimer = null;
    beginBedtime();
  }, quietDelayMs());
}

function noteActivity(): void {
  if (quitting || bedtime) {
    return;
  }
  armQuiet();
}

function syncHold(): void {
  if (!overlay || quitting) {
    return;
  }
  if (userBusy()) {
    clearQuietTimer();
    overlay.holdActivity();
    return;
  }
  overlay.releaseActivity();
  if (!bedtime) {
    armQuiet();
  }
}

function beginBedtime(): void {
  if (quitting || bedtime || !overlay) {
    return;
  }
  const view = overlay.wanderView();
  const phase = overlay.dockingPhase();
  const decision = decideBedtime({
    busy: userBusy(),
    asleep: !view || view.asleep,
    dock: phase === 'docked' ? 'docked' : phase === 'undocked' ? 'undocked' : 'busy',
    homeAvailable: Boolean(home?.isEnabled() && home.getDockingBounds()),
  });
  if (decision === 'hold') {
    syncHold();
    return;
  }
  if (decision === 'later') {
    if (view && !view.asleep) {
      armQuiet();
    }
    return;
  }
  if (decision === 'sleep') {
    overlay.sleep();
    return;
  }
  bedtime = true;
  overlay.setFollowEnabled(false);
  overlay.setPresence('CLEAR');
  overlay.linger();
  const bounds = home?.getDockingBounds() ?? null;
  if (bounds && overlay.requestDocking(bounds, true)) {
    return;
  }
  bedtime = false;
  overlay.sleep();
}

async function shutdown(): Promise<void> {
  if (quitting) {
    return;
  }
  quitting = true;
  selection?.destroy();
  selection = null;
  wanderClosed = true;
  preferences?.close();
  clearWanderTimer();
  clearLeaseTimer();
  clearQuietTimer();
  console.log('desktop-companion: quitting');
  if (smokeTimer) {
    clearTimeout(smokeTimer);
    smokeTimer = null;
  }
  tray?.destroy();
  tray = null;
  home?.destroy();
  home = null;
  await chat?.destroy();
  chat = null;
  overlay?.setExplore(null);
  overlay?.destroy();
  overlay = null;
  trail?.destroy();
  trail = null;
  app.quit();
}

app.on('second-instance', () => {
  overlay?.show();
});

app.on('before-quit', (event) => {
  if (!quitting) {
    event.preventDefault();
    void shutdown();
  }
});

app.on('window-all-closed', () => {
  if (quitting) {
    app.quit();
  }
});

void app.whenReady().then(async () => {
  if (!gotLock) {
    return;
  }
  console.log('desktop-companion: process-started');
  const preferenceStore = createUserPreferencesStore(path.join(app.getPath('userData'), 'companion', 'user-preferences.json'));
  preferences = preferenceStore;

  Menu.setApplicationMenu(null);
  app.setAppUserModelId(APP_USER_MODEL_ID);
  const microphoneGate = installSecurityPolicy(dev);
  registerAppProtocol(rendererRoot());

  if (smoke) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-companion-smoke-'));
    const userData = path.resolve(app.getPath('userData'));
    const report =
      path.resolve(directory).startsWith(`${userData}${path.sep}`) || path.resolve(directory) === userData
        ? 'failed'
        : await checkDisposableCredential(directory);
    console.log(`desktop-companion: credential-self-check=${report}`);
    smokeTimer = setTimeout(() => {
      console.error('desktop-companion: smoke timed out before first frame');
      app.exit(2);
    }, 15_000);
  }

  chat = await createChatController({
    dev,
    preloadPath: path.join(preloadPath(), '../chatPreload.js'),
    getAnchor: () => overlay?.getBounds() ?? { x: 0, y: 0, ...COMPANION_LAYOUT.windowDip },
    getWorkArea: (anchor) => screen.getDisplayMatching(anchor).workArea,
    onActivity: () => {
      bedtime = false;
      overlay?.wake('chat');
      syncHold();
    },
    onQuiet: () => syncHold(),
    onGesture: (gesture) => overlay?.gesture(gesture),
    onPresence: (presence) => overlay?.setPresence(presence),
    onEyePreview: (cue) => {
      if (!dev) {
        return;
      }
      overlay?.setEyePreview(cue);
    },
    onMoveTest: () => runMoveTest('chat'),
    isQuitting: () => quitting,
    microphoneGate,
  });

  home = createHomeWindow({
    dev: dev && !smoke,
    preloadPath: path.join(preloadPath(), '../homePreload.js'),
    onEnabledChanged: () => tray?.refresh(),
    onActivate: () => {
      if (selectionHolding) return false;
      bedtime = false;
      noteActivity();
      const bounds = home?.getDockingBounds();
      return Boolean(bounds && overlay?.requestDocking(bounds));
    },
    onUnavailable: () => overlay?.cancelDocking('home-unavailable'),
    raiseAvatar: source => overlay?.moveAboveHome(source) ?? false,
  });
  overlay = createOverlayWindow({
    dev,
    verifyWebGL: smoke,
    onFollowActivity: () => {
      if (quitting || bedtime || userBusy()) {
        return;
      }
      overlay?.engage();
      armQuiet();
    },
    onFollowChanged: () => tray?.refresh(),
    onVisibilityChanged: (visible) => home?.setAppVisible(visible),
    onDesktopCursor: (sample) => { if (home?.isEnabled()) home.observe(sample); },
    getDockPlatform: () => home?.getDockingBounds() ?? null,
    onDockingStart: () => applyWander(disableWander(wander, overlay?.wanderView()?.travelPhase ?? 'idle')),
    onDockingChanged: phase => {
      home?.feedback(phase === 'undocked' ? 'idle' : phase === 'docked' ? 'docked' : 'busy');
      if (phase === 'docked') bedtime = false;
      if (phase === 'undocked' && bedtime) {
        bedtime = false;
        overlay?.sleep();
        return;
      }
      if (selectionHolding) return;
      if ((phase === 'returning' || phase === 'settling') && !bedtime) overlay?.setPresence('ATTENTIVE');
      if (phase === 'docked') overlay?.setPresence('CLEAR');
    },
    preloadPath: preloadPath(),
    getTravelBlock: () => {
      if (selectionHolding) return { chatOpen: true, listening: false, speaking: false, generating: false };
      const activity = chat?.activity();
      if (!activity) {
        return { chatOpen: false, listening: false, speaking: false, generating: false };
      }
      return {
        chatOpen: activity.open,
        listening: activity.listening,
        speaking: activity.speaking,
        generating: activity.busy,
      };
    },
    onTrail: (sample) => trail?.note(sample),
    onTravelSettled: () => runWander(),
    onRobotPhase: (phase) => {
      if (phase === 'WAKING') {
        wander = noteWanderWake(wander, Date.now());
        noteActivity();
      }
      if (phase === 'SLEEPING' || phase === 'RETURNING_TO_SLEEP') {
        bedtime = false;
        clearQuietTimer();
      }
      runWander();
    },
    onBodyHover: () => runWander(),
    onBodyClick: () => {
      if (bedtime) {
        bedtime = false;
        overlay?.wake();
      }
      noteActivity();
      wander = noteWanderInteraction(wander);
      runWander();
    },
    onSelectScreen: () => { selection?.start(); },
    onShown: () => runWander(),
    onDisplayChanged: () => runWander(),
    onFirstFrame: () => {
      console.log('desktop-companion: frame-ready');
      if (!quitting && preferenceStore.current().startAwake) {
        overlay?.wake();
        noteActivity();
      }
      if (!smoke) {
        return;
      }
      if (smokeTimer) {
        clearTimeout(smokeTimer);
        smokeTimer = null;
      }
      setTimeout(() => {
        void shutdown();
      }, 300);
    },
  });

  let wander: WanderState = createWanderState();
  let wanderHold = '';
  let publishedExplore: number | null = null;
  let armedLeaseUntil: number | null = null;

  const armLeaseTimer = (until: number): void => {
    clearLeaseTimer();
    const epoch = leaseEpoch;
    const delay = Math.max(0, until - Date.now());
    if (dev) {
      console.log(`desktop-companion: wander lease armed delayMs=${delay}`);
    }
    leaseTimer = setTimeout(() => {
      if (epoch !== leaseEpoch || wanderClosed) {
        return;
      }
      leaseTimer = null;
      if (dev) {
        console.log('desktop-companion: wander lease expired');
      }
      runWander();
    }, delay);
  };

  const syncLeaseTimer = (until: number | null): void => {
    if (!wander.enabled || until == null) {
      if (armedLeaseUntil !== null || leaseTimer) {
        armedLeaseUntil = null;
        clearLeaseTimer();
      }
      return;
    }
    if (until === armedLeaseUntil) {
      return;
    }
    armedLeaseUntil = until;
    armLeaseTimer(until);
  };

  const publishExplore = (until: number | null): void => {
    if (until === publishedExplore) {
      return;
    }
    const previous = publishedExplore;
    publishedExplore = until;
    if (!overlay) {
      return;
    }
    if (until == null) {
      overlay.setExplore(null);
      if (previous != null && dev) {
        console.log('desktop-companion: wander explore end');
      }
      return;
    }
    overlay.setExplore(Math.min(WANDER_EXPLORE_MS, Math.max(0, until - Date.now())));
    if (dev) {
      console.log('desktop-companion: wander explore start');
    }
  };

  const armWanderTimer = (at: number): void => {
    clearWanderTimer();
    const epoch = wanderEpoch;
    const delay = Math.min(WANDER_EXPLORE_MS, Math.max(0, at - Date.now()));
    wanderTimer = setTimeout(() => {
      if (epoch !== wanderEpoch || wanderClosed) {
        return;
      }
      wanderTimer = null;
      runWander();
    }, delay);
  };

  const applyWander = (plan: WanderPlan): void => {
    const wasEnabled = wander.enabled;
    wander = plan.state;
    clearWanderTimer();
    publishExplore(wander.enabled ? wander.exploreUntil : null);
    syncLeaseTimer(wander.enabled ? wander.exploreUntil : null);
    if (plan.hold !== wanderHold) {
      wanderHold = plan.hold ?? '';
      if (plan.hold && dev) {
        const waitMs = plan.scheduleAt == null ? -1 : Math.max(0, plan.scheduleAt - Date.now());
        const leftMs = wander.exploreUntil == null ? -1 : Math.max(0, wander.exploreUntil - Date.now());
        console.log(`desktop-companion: wander hold=${plan.hold} waitMs=${waitMs} leftMs=${leftMs}`);
      }
    }
    if (plan.command === 'stop') {
      overlay?.stopMovement();
    } else if (plan.command != null) {
      if (dev) {
        console.log(`desktop-companion: wander depart command=${plan.command}`);
      }
      if (plan.command === 'home') {
        overlay?.moveHome();
      } else {
        overlay?.moveBy(plan.command, plan.hopDip ?? undefined);
      }
    }
    if (plan.scheduleAt != null && wander.enabled && !wanderClosed) {
      armWanderTimer(plan.scheduleAt);
    }
    if (wasEnabled !== wander.enabled) {
      tray?.refresh();
    }
  };

  const runWander = (): void => {
    if (selectionHolding || wanderClosed || !wander.enabled || !overlay || overlay.isFollowing() || overlay.dockingPhase() !== 'undocked') {
      return;
    }
    const view = overlay.wanderView();
    if (!view) {
      return;
    }
    applyWander(planWander(wander, view, Date.now()));
  };

  const runMoveTest = (source: 'tray' | 'chat'): { received: boolean; block: 'chat' | 'voice' | 'busy' | 'none'; message: string } => {
    if (!dev) {
      return { received: false, block: 'none', message: 'Move test is a development control.' };
    }
    const activity = chat?.activity();
    const block = travelBlock({
      chatOpen: activity?.open ?? false,
      listening: activity?.listening ?? false,
      speaking: activity?.speaking ?? false,
      generating: activity?.busy ?? false,
    });
    const label = block ?? 'none';
    console.log(`desktop-companion: move-test received source=${source} command=up distance=${MOVE_TEST_DIP} block=${label}`);
    noteManualMove();
    overlay?.moveBy('up', MOVE_TEST_DIP);
    const message = block === 'chat'
      ? 'Movement cannot run until the chat closes. block=chat'
      : block === 'voice'
        ? 'Movement is paused while voice is active. block=voice'
        : block === 'busy'
          ? 'Movement is paused while a reply is running. block=busy'
          : `Move test accepted. block=none. The window should move ${MOVE_TEST_DIP} DIP up.`;
    console.log(`desktop-companion: move-test result source=${source} block=${label} accepted=${block == null}`);
    return { received: true, block: label, message };
  };

  const noteManualMove = (): void => {
    if (!wander.enabled) {
      return;
    }
    wander = yieldWander(wander);
    clearWanderTimer();
    runWander();
  };

  const trailWindow = createTrailWindow({
    dev,
    preloadPath: path.join(preloadPath(), '../trailPreload.js'),
    raiseAvatar: () => overlay?.moveTop(),
    isChatOpen: () => chat?.activity().open ?? false,
  });
  trail = trailWindow;
  const savedPreferences = preferenceStore.current();
  if (savedPreferences.neonTrailEnabled) {
    trailOn = true;
    trailWindow.setEnabled(true);
  }
  // Home is the robot's platform. Hide remains a tray action for this session only.
  if (!smoke) home?.setEnabled(true);
  const loginStartup = createInstalledLoginStartup(dev, smoke);
  const released = !smoke;
  selection = createScreenSelectionController({
    enabled: released,
    page: dev ? SELECTION_PAGE : SELECTION_APP_PAGE,
    bindAppProtocol: (ses) => ensureAppProtocol(ses.protocol, rendererRoot()),
    resolveOneShotEndpoint: released ? () => {
      const current = createProviderSettings(path.join(app.getPath('userData'), 'companion', 'provider-settings.json')).current();
      return current.provider === 'qwen' && current.endpoint && chatCompletionsUrl(current.endpoint) ? current.endpoint : null;
    } : undefined,
    liveSend: released ? async (admission, signal) => {
      const { executeAdmittedScreenVisionPost } = await import('./qwenVisionTransport.js');
      const vault = createSafeCredentialStore(path.join(app.getPath('userData'), 'companion', 'qwen-key.bin'));
      const exchange = await executeAdmittedScreenVisionPost(admission, { vault }, signal);
      const result = exchange.result;
      if (result.ok && result.kind !== 'real-provider-response') return { ok: false, code: 'unavailable', posted: exchange.posted };
      return { ...result, posted: exchange.posted };
    } : undefined,
    preloadPath: path.join(preloadPath(), '../screenSelectionPreload.js'),
    canStart: () => {
      const activity = chat?.activity(), view = overlay?.wanderView(), phase = overlay?.dockingPhase();
      return !quitting && Boolean(view && view.travelPhase === 'idle' &&
        (phase === 'undocked' || phase === 'docked')) &&
        !activity?.open && !activity?.listening && !activity?.speaking && !activity?.busy;
    },
    onActive: (active) => {
      if (active) bedtime = false;
      selectionHolding = active;
      overlay?.setSelectionHold(active);
      syncHold();
      if (active) {
        selectionAttention = true;
        overlay?.setPresence('ATTENTIVE');
      } else if (selectionAttention) {
        selectionAttention = false;
        overlay?.setPresence('CLEAR');
      }
      if (!active && !quitting) runWander();
    },
    conceal: () => {
      // The trail ages on a 100ms timer and would call showInactive during the
      // composition wait, failing the all-windows-hidden exclusion check.
      trail?.setCaptureHold(true);
      const visible = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed() && win.isVisible());
      const restore = (): void => {
        if (quitting) return;
        try {
          // Restore Home first; showing the avatar restarts its trusted sampler.
          for (const win of visible) if (!win.isDestroyed() && !overlay?.ownsWindow(win)) win.showInactive();
        } finally {
          overlay?.setCaptureHidden(false);
          overlay?.moveTop();
          trail?.setCaptureHold(false);
        }
      };
      try {
        overlay?.setCaptureHidden(true);
        for (const win of visible) if (!win.isDestroyed()) win.hide();
      } catch (error) { restore(); throw error; }
      return {
        verify: () => BrowserWindow.getAllWindows().every(win => win.isDestroyed() || !win.isVisible()),
        restore,
      };
    },
  });
  tray = createTray({
    onSelectScreenArea: released ? () => selection?.start() : undefined,
    onShow: () => { selection?.cancel(); overlay?.show(); },
    onHide: () => { selection?.cancel(); overlay?.hide(); },
    onWake: () => {
      bedtime = false;
      selection?.cancel();
      overlay?.show();
      overlay?.wake();
      noteActivity();
    },
    onSleep: () => {
      bedtime = false;
      clearQuietTimer();
      chat?.stopVoice();
      selection?.cancel();
      const phase = overlay?.wanderView()?.travelPhase ?? 'idle';
      applyWander(endWanderSession(wander, phase));
      overlay?.sleep();
    },
    onOpenChat: () => { selection?.cancel(); chat?.open(); },
    onToggleRecoveryCapture: (enabled) => { selection?.cancel(); overlay?.setRecoveryCapture(enabled); },
    isRecoveryCapture: () => overlay?.isRecoveryCapture() ?? false,
    isWandering: () => wander.enabled,
    isTrail: () => trailOn,
    isStartAwake: () => preferenceStore.current().startAwake,
    onStartAwake: (enabled) => {
      preferenceStore.update({ startAwake: enabled });
    },
    startupAvailable: loginStartup.available(),
    isStartWithWindows: () => loginStartup.checked(),
    onStartWithWindows: (enabled) => {
      const result = loginStartup.setEnabled(enabled);
      if (!result.ok && result.reason !== 'unavailable') {
        console.error(`desktop-companion: windows-login-startup ${result.reason}`);
      }
    },
    devMovement: dev,
    devMarker: dev,
    isFollowing: () => overlay?.isFollowing() ?? false,
    onFollow: (enabled) => {
      selection?.cancel();
      if (!overlay) return;
      if (enabled) {
        applyWander(disableWander(wander, overlay.wanderView()?.travelPhase ?? 'idle'));
      }
      overlay.setFollowEnabled(enabled);
    },
    isHome: () => home?.isEnabled() ?? false,
    onHome: (enabled) => { selection?.cancel(); home?.setEnabled(enabled); },
    onMoveTest: () => {
      selection?.cancel();
      runMoveTest('tray');
    },
    onMove: (direction) => {
      selection?.cancel();
      const activity = chat?.activity();
      const block = travelBlock({
        chatOpen: activity?.open ?? false,
        listening: activity?.listening ?? false,
        speaking: activity?.speaking ?? false,
        generating: activity?.busy ?? false,
      });
      console.log(`desktop-companion: move received direction=${direction} block=${block ?? 'none'}`);
      if (direction === 'stop') {
        noteManualMove();
        overlay?.stopMovement();
        return;
      }
      if (direction === 'home') {
        noteManualMove();
        overlay?.moveHome();
        return;
      }
      noteManualMove();
      overlay?.moveBy(direction);
    },
    onWander: (enabled) => {
      selection?.cancel();
      if (!overlay) {
        return;
      }
      if (enabled) overlay.cancelDocking('wander-override');
      const view = overlay.wanderView();
      if (!view) {
        return;
      }
      if (!enabled) {
        console.log('desktop-companion: wander disabled');
        applyWander(disableWander(wander, view.travelPhase));
        return;
      }
      overlay.setFollowEnabled(false);
      console.log('desktop-companion: wander enabled');
      applyWander(enableWander(wander, Date.now(), view));
    },
    onTrail: (action) => {
      selection?.cancel();
      if (action === 'reset' || action === 'marker') {
        if (!dev) {
          return;
        }
      }
      if (action === 'disable') {
        trailOn = preferenceStore.update({ neonTrailEnabled: false }).neonTrailEnabled;
        trail?.setEnabled(trailOn);
        return;
      }
      if (action === 'reset') {
        trail?.reset();
        return;
      }
      if (action === 'marker') {
        trail?.showMarker();
        return;
      }
      trailOn = preferenceStore.update({ neonTrailEnabled: true }).neonTrailEnabled;
      trail?.setEnabled(trailOn);
    },
    onQuit: () => { void shutdown(); },
  });

  const repositionChat = (): void => {
    chat?.reposition();
  };
  screen.on('display-added', repositionChat);
  screen.on('display-removed', repositionChat);
  screen.on('display-metrics-changed', repositionChat);
});
