import { attachHome } from './homeInteraction';
import type { HomeBridge } from '../shared/ipc';

const bridge = (window as Window & { home?: HomeBridge }).home;
const button = document.querySelector<HTMLButtonElement>('#home');
const svg = document.querySelector<SVGSVGElement>('#platform');
const chassis = document.querySelector<SVGPathElement>('#chassis');
const deck = document.querySelector<SVGEllipseElement>('#deck');
const surface = document.querySelector<SVGEllipseElement>('#surface');
if (bridge && button && svg && chassis && deck && surface) {
  const dispose = attachHome({ button, svg, chassis, deck, surface }, bridge);
  window.addEventListener('pagehide', dispose, { once: true });
}
