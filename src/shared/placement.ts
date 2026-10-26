export const OVERLAY_WIDTH_DIP = 300;
export const OVERLAY_HEIGHT_DIP = 400;
export const OVERLAY_MARGIN_DIP = 16;

export interface DipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function placeOverlay(workArea: DipRect, margin = OVERLAY_MARGIN_DIP): DipRect {
  const width = clampSize(OVERLAY_WIDTH_DIP, workArea.width);
  const height = clampSize(OVERLAY_HEIGHT_DIP, workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: clamp(maxX - margin, workArea.x, maxX),
    y: clamp(maxY - margin, workArea.y, maxY),
    width,
    height,
  };
}

function clampSize(preferred: number, available: number): number {
  if (available <= 0) {
    return 1;
  }
  return Math.min(preferred, available);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
