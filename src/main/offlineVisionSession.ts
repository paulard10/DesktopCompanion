/** Main-owned temporary crop + single-use LOCAL SIMULATION approval. No I/O. */
import { createHash, randomUUID } from 'node:crypto';
import { OFFLINE_VISION_SCENARIOS, validVisionQuestion, VISION_SHARING, VISION_IMAGE_UNAVAILABLE,
  type OfflineVisionNotice, type OfflineVisionScenario, type OfflineVisionReview, type VisionImageEligibility } from '../shared/offlineVision.js';
import { SCREEN_SELECTION } from '../shared/screenSelection.js';
import { buildVisionRequest, createOfflineVisionAdapter, VISION_MODEL_ID } from './qwenVisionAdapter.js';
import { createVisionMock, type MockVisionScenario } from './qwenVisionMock.js';
import { exactKeys, record, validateVisionCrop, type ApprovedCrop } from './visionImage.js';

// Placeholder satisfying the Singapore shape, NOT saved account configuration.
// A request is constructed and discarded locally; the mock never receives it.
const ENDPOINT = 'https://offline-ux.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
export const OFFLINE_APPROVAL_MS = 30_000;
export const SIMULATED_ANSWER = 'Simulated response — no AI was called. No visual understanding was performed. '
  + 'This offline test does not describe or interpret your image. Nothing was sent outside this device.';
function script(scenario: OfflineVisionScenario): MockVisionScenario {
  if (scenario === 'timeout') return { failure: 'pending' };
  if (scenario === 'rate-limit') return { status: 429, body: '{}', delayMs: 400 };
  return { status: 200, delayMs: 400, body: JSON.stringify({ choices: [{
    message: { role: 'assistant', content: scenario === 'empty' ? '' : SIMULATED_ANSWER }, finish_reason: 'stop',
  }] }) };
}
export interface OfflineVisionSession {
  dispatch(action: unknown): void;
  dispose(): void;
}
/** Caller transfers exclusive ownership of this canonical crop; never renderer bytes. */
export function createOfflineVisionSession(options: {
  sessionId: string; crop: ApprovedCrop; expiresAt?: number; publish: (notice: OfflineVisionNotice) => void;
}): OfflineVisionSession {
  let crop: ApprovedCrop | undefined = Object.freeze({ ...options.crop });
  // Clear factory input references too; dispose must not retain a hidden owner.
  const sessionId = options.sessionId, publish = options.publish;
  const previewExpiresAt = options.expiresAt ?? Date.now() + SCREEN_SELECTION.sessionMs;
  if (!Number.isSafeInteger(previewExpiresAt) || previewExpiresAt > Date.now() + SCREEN_SELECTION.sessionMs)
    throw new Error('Invalid preview lifetime.');
  options = undefined as unknown as typeof options;
  const imageId = randomUUID();
  let digest = createHash('sha256').update(crop.bytes).digest('hex');
  let imageEligibility: VisionImageEligibility;
  try { validateVisionCrop(crop); imageEligibility = Object.freeze({ available: true, message: 'This crop fits the vision limits. Only local simulation is available.' }); }
  catch { imageEligibility = Object.freeze({ available: false, message: VISION_IMAGE_UNAVAILABLE }); }
  let question = '', revision = 0, scenario: OfflineVisionScenario = 'success';
  let disposed = false, generation = 0;
  let adapter: ReturnType<typeof createOfflineVisionAdapter> | undefined;
  let approval: Readonly<OfflineVisionReview> & { token: string; digest: string; scenario: OfflineVisionScenario } | undefined;
  const emit = (phase: OfflineVisionNotice['phase'], message: string, extra: Partial<OfflineVisionNotice> = {}): void => {
    if (!disposed) publish({ phase, question, revision, scenario, imageId, message,
      sharing: VISION_SHARING, imageEligibility, previewExpiresAt, ...extra });
  };
  const revoke = (): void => { approval = undefined; generation++; adapter?.cancel(); adapter = undefined; };
  const input = () => ({ endpoint: ENDPOINT, model: VISION_MODEL_ID, question, image: crop });
  const withinBudget = (): boolean => {
    const built = buildVisionRequest(input()); // Same strict adapter validator. Snapshot dies here.
    if (built.ok) return true;
    emit('error', built.code === 'invalid-image'
      ? VISION_IMAGE_UNAVAILABLE
      : 'Enter a non-empty question of at most 500 characters. No operation was started.');
    return false;
  };
  function dispatch(action: unknown): void {
    if (disposed || !crop || !record(action) || action.sessionId !== sessionId) return;
    // The controller still owns the 120-s timer. This also fails closed if its
    // timer is delayed or the session is exercised without a window in tests.
    if (Date.now() >= previewExpiresAt) {
      revoke(); emit('error', 'Local preview expired. Discard and start a new selection. Nothing was sent.'); dispose(); return;
    }
    if (action.type === 'cancel' && exactKeys(action, ['type','sessionId'])) {
      revoke(); emit('editing', 'Offline review or test cancelled. Review again to authorize another simulation.'); return;
    }
    if ((action.type === 'edit' || action.type === 'review') &&
        exactKeys(action, ['type','sessionId','question','revision','scenario'])) {
      if (!Number.isSafeInteger(action.revision) || (action.revision as number) < 1 ||
          typeof action.question !== 'string' ||
          !OFFLINE_VISION_SCENARIOS.includes(action.scenario as OfflineVisionScenario)) return;
      if (action.type === 'edit') {
        if ((action.revision as number) <= revision) return;
        revoke(); revision = action.revision as number; scenario = action.scenario as OfflineVisionScenario;
        if (action.question.length > 500) {
          question = ''; emit('error', 'Question exceeds 500 characters. Previous review was revoked.'); return;
        }
        question = action.question;
        emit('editing', 'Local only. Review this exact image and question before authorizing a simulation.'); return;
      }
      // No review can mutate a draft or silently reauthorize a running operation.
      if (adapter || action.revision !== revision || action.question !== question || action.scenario !== scenario) return;
      revoke();
      if (!validVisionQuestion(question)) { emit('error', 'Enter a non-empty valid question of at most 500 characters.'); return; }
      if (!imageEligibility.available) { emit('error', imageEligibility.message); return; }
      if (!withinBudget()) return;
      const binding: Readonly<OfflineVisionReview> = Object.freeze({ purpose: 'offline-simulation-only', sessionId, imageId,
        question, revision, provider: VISION_SHARING.provider, region: VISION_SHARING.region, model: VISION_MODEL_ID,
        mime: 'image/png', width: crop.width, height: crop.height, pngBytes: crop.bytes.byteLength,
        expiresAt: Math.min(Date.now() + OFFLINE_APPROVAL_MS, previewExpiresAt), previewExpiresAt });
      approval = { ...binding, token: randomUUID(), digest, scenario };
      emit('review', 'Review the image shown above and the exact question below. This approval permits one local simulation only; it never permits upload.',
        { token: approval.token, expiresAt: approval.expiresAt, review: binding }); return;
    }
    if (action.type !== 'run' || !exactKeys(action, ['type','sessionId','token','revision']) || adapter) return;
    const permit = approval;
    if (!permit || action.token !== permit.token || action.revision !== permit.revision) return;
    approval = undefined; // Consume BEFORE starting any asynchronous operation.
    if (permit.purpose !== 'offline-simulation-only' || permit.sessionId !== sessionId || permit.model !== VISION_MODEL_ID ||
        permit.provider !== VISION_SHARING.provider || permit.region !== VISION_SHARING.region ||
        Date.now() >= permit.expiresAt || permit.imageId !== imageId || permit.digest !== digest ||
        permit.question !== question || permit.revision !== revision || permit.scenario !== scenario ||
        createHash('sha256').update(crop.bytes).digest('hex') !== digest) {
      revoke(); emit('editing', 'Offline approval expired or changed. Review again.'); return;
    }
    const mine = ++generation;
    const current = createOfflineVisionAdapter({ transport: createVisionMock([script(scenario)]), timeoutMs: 1500 });
    adapter = current; emit('running', 'Running a local simulated test. No AI or network request.');
    void current.run(input()).then(result => {
      if (disposed || generation !== mine || adapter !== current) return;
      if (Date.now() >= previewExpiresAt) { dispose(); return; }
      adapter = undefined;
      if (result.ok) emit('result', 'Simulated response — no AI was called', { answer: result.text });
      else emit('error', `Simulated outcome — no AI was called. ${result.message} Review again to retry locally.`);
    }).catch(() => {
      if (disposed || generation !== mine || adapter !== current) return;
      if (Date.now() >= previewExpiresAt) { dispose(); return; }
      adapter = undefined; emit('error', 'Simulated test failed locally. No AI was called.');
    });
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true; revoke(); crop = undefined; question = ''; digest = '';
  }
  return { dispatch, dispose };
}
