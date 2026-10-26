import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, Menu, screen } from 'electron';
import { createChatController, type ChatController } from './chatWindow.js';
import { checkDisposableCredential } from './safeCredentialStore.js';
import { registerAppProtocol, registerAppScheme } from './protocol.js';
import { installSecurityPolicy } from './security.js';
import { createOverlayWindow, preloadPath, rendererRoot, type OverlayController } from './overlayWindow.js';
import { createTrailWindow, type TrailController } from './trailWindow.js';
import { createTray } from './tray.js';
import { createUserPreferencesStore, type UserPreferencesStore } from '../shared/userPreferences.js';
import { MOVE_TEST_DIP, travelBlock } from '../shared/desktopMovement.js';
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

async function shutdown(): Promise<void> {
  if (quitting) {
    return;
  }
  quitting = true;
  wanderClosed = true;
  preferences?.close();
  clearWanderTimer();
  clearLeaseTimer();
  console.log('desktop-companion: quitting');
  if (smokeTimer) {
    clearTimeout(smokeTimer);
    smokeTimer = null;
  }
  tray?.destroy();
  tray = null;
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
  app.setAppUserModelId('com.desktopcompanion.shell');
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
    getAnchor: () => overlay?.getBounds() ?? { x: 0, y: 0, width: 300, height: 400 },
    getWorkArea: (anchor) => screen.getDisplayMatching(anchor).workArea,
    onActivity: () => overlay?.wake('chat'),
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

  overlay = createOverlayWindow({
    dev,
    preloadPath: preloadPath(),
    getTravelBlock: () => {
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
      }
      runWander();
    },
    onBodyHover: () => runWander(),
    onBodyClick: () => {
      wander = noteWanderInteraction(wander);
      runWander();
    },
    onShown: () => runWander(),
    onDisplayChanged: () => runWander(),
    onFirstFrame: () => {
      console.log('desktop-companion: frame-ready');
      if (!quitting && preferenceStore.current().startAwake) {
        overlay?.wake();
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
    if (wanderClosed || !wander.enabled || !overlay) {
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
  tray = createTray({
    onShow: () => overlay?.show(),
    onHide: () => overlay?.hide(),
    onWake: () => {
      overlay?.show();
      overlay?.wake();
    },
    onSleep: () => {
      const phase = overlay?.wanderView()?.travelPhase ?? 'idle';
      applyWander(endWanderSession(wander, phase));
      overlay?.sleep();
    },
    onOpenChat: () => chat?.open(),
    onToggleRecoveryCapture: (enabled) => overlay?.setRecoveryCapture(enabled),
    isRecoveryCapture: () => overlay?.isRecoveryCapture() ?? false,
    isWandering: () => wander.enabled,
    isTrail: () => trailOn,
    isStartAwake: () => preferenceStore.current().startAwake,
    onStartAwake: (enabled) => {
      preferenceStore.update({ startAwake: enabled });
    },
    devMovement: dev,
    devMarker: dev,
    onMoveTest: () => {
      runMoveTest('tray');
    },
    onMove: (direction) => {
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
      if (!overlay) {
        return;
      }
      const view = overlay.wanderView();
      if (!view) {
        return;
      }
      if (!enabled) {
        console.log('desktop-companion: wander disabled');
        applyWander(disableWander(wander, view.travelPhase));
        return;
      }
      console.log('desktop-companion: wander enabled');
      applyWander(enableWander(wander, Date.now(), view));
    },
    onTrail: (action) => {
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
