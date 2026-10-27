import { chatTriggerVisible } from '../shared/chatTrigger';
import { createCompanionScene } from './avatar/createScene';
import { applyChatBadgeLayout } from './chatBadgeLayout';

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
let currentPhase = 'SLEEPING';
let inputSuppressed = false;
const refreshTrigger = (): void => {
  if (trigger) trigger.hidden = inputSuppressed || !chatTriggerVisible(currentPhase);
};
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
    const now = performance.now();
    const awake = scene.isAwake();
    scene.wake(now);
    scene.pulse(now);
    window.companion?.notifyCircleClick();
    if (awake) {
      window.companion?.requestOpenChat();
    }
  });
}
