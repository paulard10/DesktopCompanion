import { HOME, homeHit, homeOutlinePath } from '../shared/homeGeometry.ts';
import type { HomeBridge } from '../shared/ipc.ts';

/** Event-bound presentation only. Main acknowledgment is required for feedback. */
export function attachHome(elements: {
  button: HTMLButtonElement; svg: SVGSVGElement; chassis: SVGPathElement; deck: SVGEllipseElement; surface?: SVGEllipseElement;
}, bridge: HomeBridge): () => void {
  const { button, svg, chassis, deck } = elements;
  svg.setAttribute('viewBox', `0 0 ${HOME.width} ${HOME.height}`);
  chassis.setAttribute('d', homeOutlinePath());
  for (const name of ['cx', 'cy', 'rx', 'ry'] as const) deck.setAttribute(name, String(HOME.platform[name]));
  for (const name of ['cx', 'cy', 'rx', 'ry'] as const) elements.surface?.setAttribute(name, String(HOME.surface[name]));
  const click = (event: MouseEvent): void => {
    if (event.isTrusted && event.button === 0 && homeHit(event.clientX, event.clientY)) bridge.notifyClick();
  };
  const ended = (): void => { button.classList.remove('feedback'); };
  const stop = bridge.onFeedback(value => {
    if (value === 'idle' || value === 'busy' || value === 'docked') {
      for (const state of ['busy', 'docked', 'blocked']) button.classList.remove(state);
      if (value !== 'idle') button.classList.add(value);
      button.setAttribute('title', value === 'docked' ? 'Despertar y salir de la plataforma' :
        value === 'busy' ? 'Acoplamiento en curso; Stop o Hide para cancelar' : 'Ir a la plataforma');
      return;
    }
    button.classList.remove('blocked');
    if (value === 'blocked') {
      button.classList.add('blocked');
      button.setAttribute('title', 'Movimiento no disponible: cierra el chat o detén la actividad de voz y vuelve a pulsar');
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
