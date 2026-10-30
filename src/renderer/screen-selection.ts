import { normalizeSelection, type ScreenSelectionBridge, type SelectionNotice } from '../shared/screenSelection';
import { validVisionQuestion, VISION_SHARING, type OfflineVisionNotice, type OfflineVisionScenario } from '../shared/offlineVision';

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
const vision = document.querySelector<HTMLElement>('#vision')!;
const question = document.querySelector<HTMLTextAreaElement>('#question')!;
const scenario = document.querySelector<HTMLSelectElement>('#scenario')!;
const review = document.querySelector<HTMLButtonElement>('#review-question')!;
const run = document.querySelector<HTMLButtonElement>('#run-offline')!;
const cancelVision = document.querySelector<HTMLButtonElement>('#cancel-vision')!;
const reviewPanel = document.querySelector<HTMLElement>('#vision-review')!;
const visionStatus = document.querySelector<HTMLElement>('#vision-status')!;
const answer = document.querySelector<HTMLElement>('#vision-answer')!;
const remoteSend = document.querySelector<HTMLButtonElement>('#send-remote')!;
const availability = document.querySelector<HTMLElement>('#vision-availability')!;
const reviewScreen = document.querySelector<HTMLButtonElement>('#review-screen-send')!;
const confirmScreen = document.querySelector<HTMLButtonElement>('#confirm-screen-send')!;
// Noninteractive disclosure; there is deliberately no remote click listener/IPC.
for (const [id, text] of Object.entries({ 'remote-identity': VISION_SHARING.identity, 'remote-boundary': VISION_SHARING.boundary,
  'remote-shared': VISION_SHARING.shared, 'remote-excluded': VISION_SHARING.excluded, 'remote-risks': VISION_SHARING.risks })) {
  document.querySelector<HTMLElement>(`#${id}`)!.textContent = text;
}
let visionState: OfflineVisionNotice | undefined;
let revision = 1;
const release = (): void => {
  image.removeAttribute('src'); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
  visionState = undefined; question.value = ''; answer.textContent = ''; visionStatus.textContent = '';
  availability.textContent = ''; remoteSend.disabled = true;
  reviewScreen.disabled = confirmScreen.disabled = true; confirmScreen.hidden = true;
  if (state) state = { ...state, image: undefined, vision: undefined };
  document.querySelector('#review-text')!.textContent = ''; reviewPanel.hidden = true; vision.hidden = true;
  document.querySelector('#review-image')!.textContent = '';
};
function editQuestion(): void {
  if (!state || state.phase !== 'PREVIEWING' || !visionState) return;
  revision++; visionState = { ...visionState, phase: 'editing', token: undefined, screenToken: undefined, screenReview: undefined, answer: undefined };
  reviewPanel.hidden = true; run.disabled = confirmScreen.disabled = true; answer.hidden = true; answer.textContent = '';
  reviewScreen.disabled = review.disabled = !visionState.imageEligibility.available || !validVisionQuestion(question.value);
  document.querySelector('#question-count')!.textContent = `${question.value.length} / 500`;
  window.screenSelection.vision({ type: 'edit', sessionId: state.sessionId, question: question.value,
    revision, scenario: scenario.value as OfflineVisionScenario });
}
question.addEventListener('input', editQuestion);
scenario.addEventListener('change', editQuestion);
review.addEventListener('click', () => {
  if (!state || !visionState || !visionState.imageEligibility.available || !validVisionQuestion(question.value) || ['running','screen-running'].includes(visionState.phase)) return;
  review.disabled = true;
  window.screenSelection.vision({ type: 'review', sessionId: state.sessionId, question: question.value,
    revision, scenario: scenario.value as OfflineVisionScenario });
});
reviewScreen.addEventListener('click', () => {
  if (!state || !visionState || reviewScreen.disabled || !visionState.imageEligibility.available || !validVisionQuestion(question.value)) return;
  reviewScreen.disabled = true;
  window.screenSelection.vision({ type: 'review-screen-dry-run', sessionId: state.sessionId, question: question.value,
    revision, scenario: scenario.value as OfflineVisionScenario });
});
confirmScreen.addEventListener('click', () => {
  if (!state || confirmScreen.disabled || visionState?.phase !== 'screen-review' || !visionState.screenToken ||
      visionState.screenReview?.question !== question.value || visionState.revision !== revision || visionState.scenario !== scenario.value) return;
  confirmScreen.disabled = true;
  const token = visionState.screenToken; visionState = { ...visionState, screenToken: undefined };
  window.screenSelection.vision({ type: 'confirm-screen-dry-run', sessionId: state.sessionId, token, revision });
});
run.addEventListener('click', () => {
  if (!state || visionState?.phase !== 'review' || !visionState.token || visionState.question !== question.value ||
      visionState.revision !== revision || visionState.scenario !== scenario.value || run.disabled) return;
  run.disabled = true;
  const token = visionState.token; visionState = { ...visionState, token: undefined };
  window.screenSelection.vision({ type: 'run', sessionId: state.sessionId, token, revision });
});
cancelVision.addEventListener('click', () => {
  if (!state) return;
  reviewPanel.hidden = true; run.disabled = confirmScreen.disabled = true;
  if (visionState) visionState = { ...visionState, token: undefined, screenToken: undefined };
  window.screenSelection.vision({ type: 'cancel', sessionId: state.sessionId });
});
function showVision(next: OfflineVisionNotice): void {
  if (!objectUrl || next.revision < revision) return;
  visionState = next; revision = next.revision; vision.hidden = false;
  // Main echoes the validated draft; never insert image/model text as HTML.
  question.value = next.question; scenario.value = next.scenario;
  const running = ['running','screen-running'].includes(next.phase);
  question.disabled = scenario.disabled = running;
  reviewScreen.disabled = review.disabled = !next.imageEligibility.available || !validVisionQuestion(next.question) || running;
  remoteSend.disabled = true;
  availability.textContent = next.imageEligibility.message;
  document.querySelector('#question-count')!.textContent = `${next.question.length} / 500`;
  const reviewing = next.phase === 'review' || next.phase === 'screen-review';
  const binding = next.phase === 'screen-review' ? next.screenReview : next.review;
  reviewPanel.hidden = !reviewing;
  document.querySelector('#review-text')!.textContent = reviewing ? binding?.question ?? '' : '';
  document.querySelector('#review-image')!.textContent = reviewing && binding
    ? `Same selected PNG: ${binding.width} × ${binding.height} pixels, ${binding.pngBytes} bytes. Approval: one local simulation only.` : '';
  run.disabled = next.phase !== 'review' || !next.token;
  run.hidden = next.phase === 'screen-review';
  confirmScreen.hidden = next.phase !== 'screen-review';
  confirmScreen.disabled = next.phase !== 'screen-review' || !next.screenToken;
  cancelVision.hidden = !['review', 'running', 'screen-review', 'screen-running'].includes(next.phase);
  visionStatus.textContent = next.message;
  answer.textContent = next.answer ?? ''; answer.hidden = !next.answer;
}
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
  if (notice.phase !== 'PREVIEWING') status.textContent = notice.message ?? (notice.rect
    ? `Selected bounds (local DIP): ${notice.rect.x.toFixed(1)}, ${notice.rect.y.toFixed(1)} — ${notice.rect.width.toFixed(1)} × ${notice.rect.height.toFixed(1)}`
    : 'Drag a rectangle. No screenshot has been taken. Escape cancels.');
  if (notice.rect && !start) draw(notice.rect);
  if (notice.phase === 'CAPTURING') status.textContent = 'Verifying hidden windows and acquiring one local crop…';
  if (notice.image) {
    release(); revision = 1;
    objectUrl = URL.createObjectURL(new Blob([new Uint8Array(notice.image.png)], { type: 'image/png' }));
    image.src = objectUrl; state = { ...notice, image: undefined };
    surface.hidden = true; preview.hidden = false; confirm.hidden = true;
    document.body.classList.add('preview');
    document.querySelector('#heading')!.textContent = 'Local preview — nothing sent to AI';
    status.textContent = `${notice.image.width} × ${notice.image.height} pixels. Close or discard to release this preview.`;
    cancel.textContent = 'Discard image / Close'; document.querySelector<HTMLButtonElement>('#fit')!.hidden = false;
  }
  // No controls without a main-owned preview capability (even on the dev page).
  if (notice.vision) showVision(notice.vision);
});
window.screenSelection.ready();
