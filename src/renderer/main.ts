import { chatTriggerVisible } from '../shared/chatTrigger';
import { createCompanionScene } from './avatar/createScene';

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

if (!canvas) {
  console.error('desktop-companion: view canvas missing');
  signalFirstFrame();
} else {
  const scene = createCompanionScene(canvas, signalFirstFrame);
  scene.onPhase((phase) => {
    if (trigger) {
      trigger.hidden = !chatTriggerVisible(phase);
    }
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
