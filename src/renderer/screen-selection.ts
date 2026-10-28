import { normalizeSelection, type ScreenSelectionBridge, type SelectionNotice } from '../shared/screenSelection';

declare global { interface Window { screenSelection: ScreenSelectionBridge } }
const surface = document.querySelector<HTMLDivElement>('#surface')!;
const outline = document.querySelector<HTMLDivElement>('#outline')!;
const confirm = document.querySelector<HTMLButtonElement>('#confirm')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const preview = document.querySelector<HTMLElement>('#preview')!;
const image = document.querySelector<HTMLImageElement>('#crop')!;
const status = document.querySelector<HTMLElement>('#status')!;
let state: SelectionNotice | null = null;
let start: { x: number; y: number } | null = null;
let objectUrl: string | null = null;
const release = (): void => { image.removeAttribute('src'); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; };
const local = (event: PointerEvent): { x: number; y: number } => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
function draw(rect: { x: number; y: number; width: number; height: number }): void {
  outline.hidden = false; Object.assign(outline.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
}
surface.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !state || state.phase === 'CAPTURING' || state.phase === 'PREVIEWING') return;
  start = local(event); surface.setPointerCapture(event.pointerId); confirm.disabled = true;
  draw(normalizeSelection(start, start));
});
surface.addEventListener('pointermove', event => { if (start) draw(normalizeSelection(start, local(event))); });
surface.addEventListener('pointerup', event => {
  if (!start || !state) return;
  const rect = normalizeSelection(start, local(event)); start = null;
  surface.releasePointerCapture(event.pointerId);
  window.screenSelection.select(state.sessionId, state.displayId, rect);
});
surface.addEventListener('pointercancel', () => { start = null; });
document.addEventListener('wheel', event => { if (event.ctrlKey) event.preventDefault(); }, { passive: false });
confirm.addEventListener('click', () => {
  if (state?.phase !== 'AWAITING_CAPTURE_CONFIRMATION') return;
  confirm.disabled = true; window.screenSelection.confirm(state.sessionId, state.displayId);
});
cancel.addEventListener('click', () => { release(); if (state) window.screenSelection.cancel(state.sessionId); });
document.querySelector('#fit')!.addEventListener('click', () => preview.classList.toggle('actual'));
window.addEventListener('pagehide', release);
window.screenSelection.onNotice(notice => {
  state = notice; confirm.disabled = notice.phase !== 'AWAITING_CAPTURE_CONFIRMATION';
  status.textContent = notice.message ?? (notice.rect
    ? `Selected bounds (local DIP): ${notice.rect.x.toFixed(1)}, ${notice.rect.y.toFixed(1)} — ${notice.rect.width.toFixed(1)} × ${notice.rect.height.toFixed(1)}`
    : 'Drag a rectangle. No screenshot has been taken. Escape cancels.');
  if (notice.rect && !start) draw(notice.rect);
  if (notice.phase === 'CAPTURING') status.textContent = 'Verifying hidden windows and acquiring one local crop…';
  if (!notice.image) return;
  release(); objectUrl = URL.createObjectURL(new Blob([new Uint8Array(notice.image.png)], { type: 'image/png' }));
  image.src = objectUrl; state = { ...notice, image: undefined };
  surface.hidden = true; preview.hidden = false; confirm.hidden = true;
  document.body.classList.add('preview');
  document.querySelector('#heading')!.textContent = 'Local preview — nothing sent to AI';
  status.textContent = `${notice.image.width} × ${notice.image.height} pixels. Close or discard to release this preview.`;
  cancel.textContent = 'Discard / Close'; document.querySelector<HTMLButtonElement>('#fit')!.hidden = false;
});
window.screenSelection.ready();
