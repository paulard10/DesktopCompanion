export interface SelectionRect { x: number; y: number; width: number; height: number }
export interface SelectionDisplay { id: number; bounds: SelectionRect; scaleFactor: number }
export interface SelectionViewport { width: number; height: number; dpr: number }
export const SCREEN_SELECTION = Object.freeze({ minDip: 16, maxSide: 4096, maxDisplayPixels: 8_388_608,
  maxCropPixels: 4_194_304, maxPngBytes: 16 * 1024 * 1024, sessionMs: 120_000 });
export type SelectionPhase = 'SELECTING' | 'AWAITING_CAPTURE_CONFIRMATION' | 'CAPTURING' | 'PREVIEWING';
export type SelectionNotice = { sessionId: string; displayId: number; phase: SelectionPhase;
  width: number; height: number; rect?: SelectionRect; message?: string;
  image?: { png: Uint8Array; width: number; height: number } };
export interface ScreenSelectionBridge {
  ready: () => void;
  select: (sessionId: string, displayId: number, rect: SelectionRect) => void;
  confirm: (sessionId: string, displayId: number) => void;
  cancel: (sessionId: string) => void;
  onNotice: (listener: (notice: SelectionNotice) => void) => () => void;
}
/** Viewport is a consistency check, never authority to change the trusted area. */
export function selectionViewportMatches(value: unknown, display: SelectionDisplay): value is SelectionViewport {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== 'dpr,height,width') return false;
  const view = value as SelectionViewport;
  return Number.isFinite(view.width) && Number.isFinite(view.height) && Number.isFinite(view.dpr) &&
    view.width === display.bounds.width && view.height === display.bounds.height && view.dpr === display.scaleFactor;
}
export function normalizeSelection(a: { x: number; y: number }, b: { x: number; y: number }): SelectionRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
export function validSelection(value: unknown, display: SelectionDisplay): value is SelectionRect {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== 'height,width,x,y') return false;
  const r = value as SelectionRect;
  return [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 &&
    r.width >= SCREEN_SELECTION.minDip && r.height >= SCREEN_SELECTION.minDip &&
    r.x + r.width <= display.bounds.width && r.y + r.height <= display.bounds.height;
}
export function captureSize(display: SelectionDisplay): { width: number; height: number } {
  const { width, height } = display.bounds, scale = display.scaleFactor;
  if (![display.bounds.x, display.bounds.y, width, height, scale].every(Number.isFinite) ||
      width <= 0 || height <= 0 || scale < 1 || scale > 3) throw new Error('Unsupported display geometry.');
  const size = { width: Math.round(width * scale), height: Math.round(height * scale) };
  if (size.width > SCREEN_SELECTION.maxSide || size.height > SCREEN_SELECTION.maxSide ||
      size.width * size.height > SCREEN_SELECTION.maxDisplayPixels) throw new Error('Display exceeds the native-resolution capture budget.');
  return size;
}
/** Local DIP -> actual bitmap pixels. Global origin is intentionally not scaled. */
export function pixelCrop(rect: SelectionRect, display: SelectionDisplay, actual: { width: number; height: number }): SelectionRect {
  const expected = captureSize(display);
  if (!validSelection(rect, display) || actual.width !== expected.width || actual.height !== expected.height)
    throw new Error('Capture dimensions or region do not match the selected display.');
  const sx = actual.width / display.bounds.width, sy = actual.height / display.bounds.height;
  const x = Math.floor(rect.x * sx), y = Math.floor(rect.y * sy);
  const right = Math.min(actual.width, Math.ceil((rect.x + rect.width) * sx));
  const bottom = Math.min(actual.height, Math.ceil((rect.y + rect.height) * sy));
  const crop = { x, y, width: right - x, height: bottom - y };
  if (crop.width * crop.height > SCREEN_SELECTION.maxCropPixels) throw new Error('Selected area exceeds the crop budget. Select a smaller area.');
  return crop;
}
export function sameSelectionDisplay(a: SelectionDisplay, b: SelectionDisplay): boolean {
  return a.id === b.id && a.scaleFactor === b.scaleFactor &&
    (['x', 'y', 'width', 'height'] as const).every(k => a.bounds[k] === b.bounds[k]);
}
