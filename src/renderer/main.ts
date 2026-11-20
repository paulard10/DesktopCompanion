import { chatTriggerVisible } from '../shared/chatTrigger';
import { screenAskHit, screenAskVisible } from '../shared/screenAskTrigger';
import { createCompanionScene } from './avatar/createScene';
import { applyChatBadgeLayout } from './chatBadgeLayout';
import { applyScreenAskLayout } from './screenAskLayout';

const canvas = document.querySelector<HTMLCanvasElement>('#view');

function signalFirstFrame(): void {
  const bridge = window.companion;
  if (!bridge) {
    console.error('desktop-companion: preload bridge missing');
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      bridge.notifyFrameReady();
    });
  });
}

const trigger = document.querySelector<HTMLButtonElement>('#chat-trigger');
const screenAsk = document.querySelector<HTMLButtonElement>('#screen-ask');
let currentPhase = 'SLEEPING';
let inputSuppressed = false;
const refreshTrigger = (): void => {
  const show = !inputSuppressed && chatTriggerVisible(currentPhase);
  if (trigger) trigger.hidden = !show;
  if (screenAsk) screenAsk.hidden = !show || !screenAskVisible(currentPhase);
};
function bindScreenAsk(button: HTMLButtonElement): void {
  applyScreenAskLayout(button.style);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.companion?.requestSelectScreen();
  });
}
if (screenAsk) bindScreenAsk(screenAsk);
const stopInput = window.companion?.onCursorSample((sample) => {
  const next = sample.inputSuppressed === true;
  if (next !== inputSuppressed) { inputSuppressed = next; refreshTrigger(); }
});
window.addEventListener('pagehide', () => stopInput?.(), { once: true });
if (trigger) {
  applyChatBadgeLayout(trigger.style);
}

if (!canvas) {
  console.error('desktop-companion: view canvas missing');
  signalFirstFrame();
} else {
  const scene = createCompanionScene(canvas, signalFirstFrame);
  scene.onPhase((phase) => {
    currentPhase = phase;
    refreshTrigger();
  });
  trigger?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.companion?.requestOpenChat();
  });
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const awake = scene.isAwake();
    if (awake && screenAskHit(event.offsetX, event.offsetY)) {
      window.companion?.requestSelectScreen();
      return;
    }
    const now = performance.now();
    scene.wake(now);
    scene.pulse(now);
    window.companion?.notifyCircleClick();
    if (awake) {
      window.companion?.requestOpenChat();
    }
  });
}
