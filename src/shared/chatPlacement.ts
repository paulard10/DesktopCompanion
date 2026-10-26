/** Places the chat window beside the robot and inside the display work area. */

export const CHAT_WIDTH_DIP = 380;
export const CHAT_HEIGHT_DIP = 520;
export const CHAT_MIN_WIDTH_DIP = 320;
export const CHAT_MIN_HEIGHT_DIP = 420;
export const CHAT_GAP_DIP = 12;

export interface ChatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function placeChat(anchor: ChatRect, workArea: ChatRect): ChatRect {
  const width = clampSize(CHAT_WIDTH_DIP, workArea.width);
  const height = clampSize(CHAT_HEIGHT_DIP, workArea.height);
  const bottom = anchor.y + anchor.height - height;
  const candidates = [
    { x: anchor.x - CHAT_GAP_DIP - width, y: bottom },
    { x: anchor.x + anchor.width + CHAT_GAP_DIP, y: bottom },
    { x: anchor.x + anchor.width - width, y: anchor.y - CHAT_GAP_DIP - height },
    { x: anchor.x, y: anchor.y + anchor.height + CHAT_GAP_DIP },
  ];
  for (const candidate of candidates) {
    const placed = { x: candidate.x, y: candidate.y, width, height };
    if (contains(workArea, placed)) {
      return placed;
    }
  }
  return clampRect({ x: candidates[0]?.x ?? workArea.x, y: candidates[0]?.y ?? workArea.y, width, height }, workArea);
}

/** Keeps a user-resized chat inside the work area without jumping back to the default size. */
export function clampChat(rect: ChatRect, workArea: ChatRect): ChatRect {
  const width = clamp(rect.width, Math.min(CHAT_MIN_WIDTH_DIP, Math.max(workArea.width, 1)), Math.max(workArea.width, 1));
  const height = clamp(
    rect.height,
    Math.min(CHAT_MIN_HEIGHT_DIP, Math.max(workArea.height, 1)),
    Math.max(workArea.height, 1),
  );
  const maxX = workArea.x + Math.max(workArea.width - width, 0);
  const maxY = workArea.y + Math.max(workArea.height - height, 0);
  return {
    x: clamp(rect.x, workArea.x, maxX),
    y: clamp(rect.y, workArea.y, maxY),
    width,
    height,
  };
}

export function rectsIntersect(a: ChatRect, b: ChatRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(outer: ChatRect, inner: ChatRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function clampRect(rect: ChatRect, workArea: ChatRect): ChatRect {
  const width = clampSize(rect.width, workArea.width);
  const height = clampSize(rect.height, workArea.height);
  const maxX = workArea.x + Math.max(workArea.width - width, 0);
  const maxY = workArea.y + Math.max(workArea.height - height, 0);
  return {
    x: clamp(rect.x, workArea.x, maxX),
    y: clamp(rect.y, workArea.y, maxY),
    width,
    height,
  };
}

function clampSize(preferred: number, available: number): number {
  if (available <= 1) {
    return 1;
  }
  return Math.min(preferred, available);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
