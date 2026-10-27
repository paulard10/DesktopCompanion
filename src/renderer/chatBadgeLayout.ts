import { chatBadgeBoundsDip } from '../shared/companionLayout.ts';

/** Applied before the first scene frame, including in production. */
export function applyChatBadgeLayout(
  style: Pick<CSSStyleDeclaration, 'left' | 'top' | 'width' | 'height'>,
): void {
  const bounds = chatBadgeBoundsDip();
  style.left = `${bounds.x}px`;
  style.top = `${bounds.y}px`;
  style.width = `${bounds.width}px`;
  style.height = `${bounds.height}px`;
}
