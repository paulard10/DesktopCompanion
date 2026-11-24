import { houseTooltip } from '../shared/houseGesture.ts';
import { HOME, homeHit, homeOutlinePath } from '../shared/homeGeometry.ts';
import type { HomeBridge } from '../shared/ipc.ts';

/** Event-bound presentation only. Main acknowledgment is required for feedback. */
export function attachHome(elements: {
  button: HTMLButtonElement; svg: SVGSVGElement; chassis: SVGPathElement; deck: SVGEllipseElement;
  surface?: SVGEllipseElement; ring?: SVGEllipseElement; halo?: SVGEllipseElement;
}, bridge: HomeBridge): () => void {
  const { button, svg, chassis, deck } = elements;
  svg.setAttribute('viewBox', `0 0 ${HOME.width} ${HOME.height}`);
  chassis.setAttribute('d', homeOutlinePath());
  for (const name of ['cx', 'cy', 'rx', 'ry'] as const) deck.setAttribute(name, String(HOME.platform[name]));
  for (const name of ['cx', 'cy', 'rx', 'ry'] as const) elements.surface?.setAttribute(name, String(HOME.surface[name]));
  const ring = HOME.surface;
  for (const node of [elements.ring, elements.halo]) {
    node?.setAttribute('cx', String(ring.cx));
    node?.setAttribute('cy', String(ring.cy));
    node?.setAttribute('rx', String(ring.rx - 7));
    node?.setAttribute('ry', String(Math.max(4, ring.ry - 3)));
  }
  const click = (event: MouseEvent): void => {
    if (event.isTrusted && event.button === 0 && homeHit(event.clientX, event.clientY)) bridge.notifyClick();
  };
  const ended = (): void => { button.classList.remove('feedback'); };
  const stop = bridge.onFeedback(value => {
    if (value === 'idle' || value === 'busy' || value === 'docked' || value === 'asleep') {
      for (const state of ['busy', 'docked', 'blocked']) button.classList.remove(state);
      if (value === 'busy' || value === 'docked') button.classList.add(value);
      const title = value === 'busy'
        ? 'Docking. Use Stop or Hide to cancel.'
        : houseTooltip(value === 'asleep' ? 'HOME_SLEEPING' : value === 'docked' ? 'HOME_AWAKE' : 'FREE_ROAM');
      button.setAttribute('title', title);
      button.setAttribute('aria-label', title);
      return;
    }
    button.classList.remove('blocked');
    if (value === 'blocked') {
      button.classList.add('blocked');
      button.setAttribute('title', 'Movement is unavailable. Close chat or stop voice activity, then try again.');
    }
    button.classList.remove('feedback');
    void button.offsetWidth; // One event-triggered style flush; no frame/idle loop.
    button.classList.add('feedback');
  });
  button.addEventListener('click', click);
  button.addEventListener('animationend', ended);
  bridge.notifyReady();
  return () => {
    stop();
    button.removeEventListener('click', click);
    button.removeEventListener('animationend', ended);
    button.classList.remove('feedback');
  };
}
