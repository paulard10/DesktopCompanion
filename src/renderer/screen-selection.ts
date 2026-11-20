import { normalizeSelection, type ScreenSelectionBridge, type SelectionNotice } from '../shared/screenSelection';
import { validVisionQuestion, VISION_SHARING, type OfflineVisionNotice } from '../shared/offlineVision';

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
const ask = document.querySelector<HTMLButtonElement>('#ask-qwen')!;
const pending = document.querySelector<HTMLElement>('#pending')!;
const visionStatus = document.querySelector<HTMLElement>('#vision-status')!;
const answerCard = document.querySelector<HTMLElement>('#answer-card')!;
const answer = document.querySelector<HTMLElement>('#vision-answer')!;
const copyAnswer = document.querySelector<HTMLButtonElement>('#copy-answer')!;
const questionCount = document.querySelector<HTMLElement>('#question-count')!;
for (const [id, text] of Object.entries({
  'remote-shared': VISION_SHARING.shared, 'remote-excluded': VISION_SHARING.excluded, 'remote-risks': VISION_SHARING.risks,
  'remote-processing': VISION_SHARING.processing, 'remote-retention': VISION_SHARING.retention })) {
  document.querySelector<HTMLElement>(`#${id}`)!.textContent = text;
}
let visionState: OfflineVisionNotice | undefined;
let revision = 1;
const canAsk = (notice = visionState): boolean => Boolean(notice?.imageEligibility.available && validVisionQuestion(question.value) &&
  !['running', 'screen-running'].includes(notice?.phase ?? ''));
const release = (): void => {
  image.removeAttribute('src'); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
  visionState = undefined; question.value = ''; answer.textContent = ''; visionStatus.textContent = '';
  ask.disabled = true; pending.hidden = true; answerCard.hidden = true; questionCount.hidden = true; vision.hidden = true;
  if (state) state = { ...state, image: undefined, vision: undefined };
};
function editQuestion(): void {
  if (!state || state.phase !== 'PREVIEWING' || !visionState || question.disabled) return;
  revision++;
  visionState = { ...visionState, phase: 'editing', token: undefined, screenToken: undefined, screenReview: undefined, answer: undefined };
  answerCard.hidden = true; answer.textContent = ''; pending.hidden = true;
  ask.disabled = !canAsk();
  questionCount.hidden = question.value.length < 400;
  questionCount.textContent = `${question.value.length} / 500`;
  window.screenSelection.vision({ type: 'edit', sessionId: state.sessionId, question: question.value, revision, scenario: 'success' });
}
function askQwen(): void {
  if (!state || !visionState || ask.disabled || !canAsk()) return;
  ask.disabled = true; question.disabled = true; pending.hidden = false; answerCard.hidden = true;
  visionStatus.textContent = 'Qwen is analyzing your image...';
  window.screenSelection.vision({ type: 'ask-qwen', sessionId: state.sessionId, question: question.value, revision });
}
question.addEventListener('input', editQuestion);
question.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  if (event.ctrlKey || event.metaKey) { event.preventDefault(); askQwen(); }
});
ask.addEventListener('click', askQwen);
copyAnswer.addEventListener('click', () => {
  const text = answer.textContent ?? '';
  if (!text) return;
  void navigator.clipboard.writeText(text).then(() => { visionStatus.textContent = 'Answer copied.'; },
    () => { visionStatus.textContent = 'The answer could not be copied.'; });
});
function showVision(next: OfflineVisionNotice): void {
  if (!objectUrl || next.revision < revision) return;
  visionState = next; revision = next.revision; vision.hidden = false;
  const running = ['running', 'screen-running'].includes(next.phase);
  if (document.activeElement !== question) question.value = next.question;
  question.disabled = running;
  ask.disabled = !canAsk(next);
  pending.hidden = !running;
  questionCount.hidden = question.value.length < 400;
  questionCount.textContent = `${question.value.length} / 500`;
  const realAnswer = next.phase === 'screen-result' && next.message === 'Qwen answered.' && Boolean(next.answer);
  answer.textContent = realAnswer ? next.answer ?? '' : '';
  answerCard.hidden = !realAnswer;
  visionStatus.textContent = running ? 'Qwen is analyzing your image...' : (realAnswer ? '' : next.message);
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
    document.querySelector('#heading')!.textContent = 'Ask Qwen about this image';
    status.textContent = 'Close discards this image from memory.';
    cancel.textContent = 'Close'; document.querySelector<HTMLButtonElement>('#fit')!.hidden = true;
    question.focus();
  }
  // No controls without a main-owned preview capability (even on the dev page).
  if (notice.vision) showVision(notice.vision);
});
window.screenSelection.ready();
