import { COMPANION_LAYOUT, type CompanionLayout } from './companionLayout.ts';

export const OVERLAY_WIDTH_DIP = COMPANION_LAYOUT.windowDip.width;
export const OVERLAY_HEIGHT_DIP = COMPANION_LAYOUT.windowDip.height;
export const OVERLAY_MARGIN_DIP = COMPANION_LAYOUT.placementMarginDip;

export interface DipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function placeOverlay(workArea: DipRect, margin = OVERLAY_MARGIN_DIP, layout: CompanionLayout = COMPANION_LAYOUT): DipRect {
  const width = clampSize(layout.windowDip.width, workArea.width);
  const height = clampSize(layout.windowDip.height, workArea.height);
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
