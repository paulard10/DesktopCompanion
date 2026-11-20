import { screenAskHitBoundsDip } from '../shared/screenAskTrigger.ts';

/** Applied before the first scene frame. The stylesheet does not set the box. */
export function applyScreenAskLayout(
  style: Pick<CSSStyleDeclaration, 'left' | 'top' | 'width' | 'height'>,
): void {
  const bounds = screenAskHitBoundsDip();
  style.left = `${bounds.x}px`;
  style.top = `${bounds.y}px`;
  style.width = `${bounds.width}px`;
  style.height = `${bounds.height}px`;
}
