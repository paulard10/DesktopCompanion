/** Main-owned temporary crop + single-use LOCAL SIMULATION approval. No I/O. */
import { createHash, randomUUID } from 'node:crypto';
import { OFFLINE_VISION_SCENARIOS, validVisionQuestion, VISION_SHARING, VISION_IMAGE_UNAVAILABLE,
  SCREEN_VISION_POLICY, SCREEN_VISION_SIMULATED_LABEL, type ScreenVisionReview,
  type OfflineVisionNotice, type OfflineVisionScenario, type OfflineVisionReview, type VisionImageEligibility } from '../shared/offlineVision.js';
import { SCREEN_SELECTION } from '../shared/screenSelection.js';
import { buildVisionRequest, createOfflineVisionAdapter, VISION_MODEL_ID } from './qwenVisionAdapter.js';
import { createVisionMock, isVisionMock, type OfflineVisionMock, type MockVisionScenario } from './qwenVisionMock.js';
import { prepareScreenVisionRequest, prepareScreenVisionRemoteConsentTest, executeScreenVisionMock, confirmScreenVisionBridgeConsent,
  type ScreenVisionWireRequest } from './screenVisionRequest.js';
import type { PrivilegedVisionWiringTest, attachPrivilegedVisionWiringTest } from './screenVisionWiring.js';
import { exactKeys, record, validateVisionCrop, type ApprovedCrop } from './visionImage.js';

// Placeholder satisfying the Singapore shape, NOT saved account configuration.
// A request is constructed and discarded locally; the mock never receives it.
const ENDPOINT = 'https://offline-ux.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
export const OFFLINE_APPROVAL_MS = 30_000;
export const SIMULATED_ANSWER = 'Simulated response — no AI was called. No visual understanding was performed. '
  + 'This offline test does not describe or interpret your image. Nothing was sent outside this device.';
export const SCREEN_SIMULATED_ANSWER = `${SCREEN_VISION_SIMULATED_LABEL} No visual understanding was performed. This rehearsal does not interpret your crop.`;
function script(scenario: OfflineVisionScenario, answer = SIMULATED_ANSWER): MockVisionScenario {
  if (scenario === 'timeout') return { failure: 'pending' };
  if (scenario === 'unknown') return { failure: 'unavailable', delayMs: 400 };
  const statuses: Partial<Record<OfflineVisionScenario, number>> = { 'rate-limit': 429, 'bad-request': 400, unauthorized: 401, 'server-error': 500 };
  const status = statuses[scenario];
  if (status) return { status, body: '{}', delayMs: 400 };
  return { status: 200, delayMs: 400, body: JSON.stringify({ choices: [{
    message: { role: 'assistant', content: scenario === 'empty' ? '' : answer }, finish_reason: 'stop',
  }] }) };
}
export interface OfflineVisionSession {
  dispatch(action: unknown): void;
  dispose(): void;
}
/** Caller transfers exclusive ownership of this canonical crop; never renderer bytes. */
export function createOfflineVisionSession(options: {
  sessionId: string; crop: ApprovedCrop; expiresAt?: number; publish: (notice: OfflineVisionNotice) => void;
  /** Trusted tests can supply only an opaque registered mock, never a callback. */
  screenTransport?: OfflineVisionMock;
  /** Trusted isolated composition only. No normal startup or IPC supplies this. */
  testWiring?: PrivilegedVisionWiringTest;
}): OfflineVisionSession {
  let crop: ApprovedCrop | undefined = Object.freeze({ ...options.crop });
  // Clear factory input references too; dispose must not retain a hidden owner.
  const sessionId = options.sessionId, publish = options.publish;
  const screenTransport = options.screenTransport;
  // Deliberately lazy: ordinary preview never loads gate/bridge/native transport.
  // The literal module validates a private runtime brand and single-session owner.
  const wiring: ReturnType<typeof attachPrivilegedVisionWiringTest> | undefined = options.testWiring === undefined ? undefined
    : (require('./screenVisionWiring.js') as typeof import('./screenVisionWiring.js')).attachPrivilegedVisionWiringTest(options.testWiring);
  if (screenTransport !== undefined && !isVisionMock(screenTransport)) throw new Error('Only a registered screen mock is allowed.');
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
  let screenApproval: { token: string; scope: Readonly<ScreenVisionReview>; fingerprint: string; digest: string; scenario: OfflineVisionScenario;
    testWire?: ScreenVisionWireRequest } | undefined;
  let screenJob: { controller: AbortController; requestId: string; fakeDispatches: 0 | 1 } | undefined;
  const emit = (phase: OfflineVisionNotice['phase'], message: string, extra: Partial<OfflineVisionNotice> = {}): void => {
    if (!disposed) publish({ phase, question, revision, scenario, imageId, message,
      sharing: VISION_SHARING, imageEligibility, previewExpiresAt, ...extra });
  };
  const revoke = (): void => {
    wiring?.cancel();
    approval = undefined; screenApproval = undefined; generation++; adapter?.cancel(); adapter = undefined;
    screenJob?.controller.abort(); // Keep ownership until its promise settles; never overlap attempts.
  };
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
      const attempt = screenJob;
      revoke(); emit('editing', attempt ? 'Screen rehearsal cancelled. Nothing was uploaded. A future real request already dispatched could still be processed or billed.'
        : 'Offline review or test cancelled. Review again to authorize another simulation.', attempt ? {
          screenOutcome: 'cancelled',
          // The composed bridge may still be settling; do not assert zero calls.
          ...(!wiring ? { screenAttempt: { requestId: attempt.requestId, consumed: true as const, fakeDispatches: attempt.fakeDispatches } } : {}),
        } : {}); return;
    }
    const remoteReview = Boolean(wiring) && action.type === 'review-remote-consent-test';
    if ((action.type === 'edit' || action.type === 'review' || action.type === 'review-screen-dry-run' || remoteReview) &&
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
      if (adapter || screenJob || action.revision !== revision || action.question !== question || action.scenario !== scenario) return;
      revoke();
      if (!validVisionQuestion(question)) { emit('error', 'Enter a non-empty valid question of at most 500 characters.'); return; }
      if (!imageEligibility.available) { emit('error', imageEligibility.message); return; }
      if (action.type === 'review-screen-dry-run' || remoteReview) {
        const scope: Readonly<ScreenVisionReview> = Object.freeze({ purpose: SCREEN_VISION_POLICY.purpose,
          sessionId, imageId, requestId: randomUUID(), question, revision,
          provider: VISION_SHARING.provider, region: VISION_SHARING.region, model: VISION_MODEL_ID,
          endpointPolicy: SCREEN_VISION_POLICY.endpointPolicy, mime: 'image/png', width: crop.width, height: crop.height,
          pngBytes: crop.bytes.byteLength, expiresAt: Math.min(Date.now() + OFFLINE_APPROVAL_MS, previewExpiresAt),
          previewExpiresAt, outputTokens: 160, timeoutMs: 20000, responseBytes: 65536 });
        const prepared = (remoteReview ? prepareScreenVisionRemoteConsentTest : prepareScreenVisionRequest)(crop, scope, ENDPOINT);
        if (!prepared.ok) { emit('error', VISION_IMAGE_UNAVAILABLE); return; }
        if (remoteReview) wiring!.review(prepared.wire);
        screenApproval = { scope, fingerprint: prepared.wire.fingerprint, digest, scenario, token: `screen-review-${randomUUID()}`,
          ...(remoteReview ? { testWire: prepared.wire } : {}) };
        emit('screen-review', remoteReview ? 'TEST-ONLY remote-consent simulation. Separate privileged test approval is required. No real transmission is authorized.'
          : 'Offline rehearsal: review the exact crop/question and future external-sharing notice. Confirming permits one FAKE dispatch only. Real sending remains unavailable.',
          { screenReview: scope, screenToken: screenApproval.token }); return;
      }
      if (!withinBudget()) return;
      const binding: Readonly<OfflineVisionReview> = Object.freeze({ purpose: 'offline-simulation-only', sessionId, imageId,
        question, revision, provider: VISION_SHARING.provider, region: VISION_SHARING.region, model: VISION_MODEL_ID,
        mime: 'image/png', width: crop.width, height: crop.height, pngBytes: crop.bytes.byteLength,
        expiresAt: Math.min(Date.now() + OFFLINE_APPROVAL_MS, previewExpiresAt), previewExpiresAt });
      approval = { ...binding, token: randomUUID(), digest, scenario };
      emit('review', 'Review the image shown above and the exact question below. This approval permits one local simulation only; it never permits upload.',
        { token: approval.token, expiresAt: approval.expiresAt, review: binding }); return;
    }
    if ((action.type === 'confirm-screen-dry-run' || (wiring && action.type === 'confirm-remote-consent-test')) &&
        exactKeys(action, ['type','sessionId','token','revision'])) {
      if (adapter || screenJob || !screenApproval || action.token !== screenApproval.token || action.revision !== screenApproval.scope.revision) return;
      if (Boolean(screenApproval.testWire) !== (action.type === 'confirm-remote-consent-test')) return;
      const permit = screenApproval; screenApproval = undefined; // Consume before any await/dispatch, including failed attempts.
      if (Date.now() >= permit.scope.expiresAt || permit.scope.sessionId !== sessionId || permit.scope.imageId !== imageId ||
          permit.scope.question !== question || permit.scope.revision !== revision || permit.scenario !== scenario ||
          permit.digest !== createHash('sha256').update(crop.bytes).digest('hex')) {
        revoke(); emit('editing', 'Screen rehearsal review expired or changed. Review again; nothing was sent.'); return;
      }
      let prepared = permit.testWire ? { ok: true as const, wire: permit.testWire } : prepareScreenVisionRequest(crop, permit.scope, ENDPOINT);
      if (!prepared.ok || prepared.wire.fingerprint !== permit.fingerprint) {
        revoke(); emit('error', 'Screen rehearsal request changed. Nothing was sent.'); return;
      }
      const mine = ++generation;
      const job = { controller: new AbortController(), requestId: permit.scope.requestId, fakeDispatches: 0 as 0 | 1 };
      screenJob = job;
      confirmScreenVisionBridgeConsent(prepared.wire, () => !disposed && generation === mine && screenJob === job && Date.now() < previewExpiresAt);
      emit('screen-running', 'Simulating Qwen send locally. No external request, key lookup or recapture.',
        { screenAttempt: { requestId: job.requestId, consumed: true, fakeDispatches: 0 } });
      const pending = permit.testWire ? wiring!.run(prepared.wire, job.controller.signal, job)
        : executeScreenVisionMock(prepared.wire, screenTransport ?? createVisionMock([script(scenario, SCREEN_SIMULATED_ANSWER)]), job.controller.signal, job);
      prepared = undefined as unknown as typeof prepared;
      void pending.then(result => {
        if (disposed || generation !== mine || screenJob !== job) return;
        if (Date.now() >= previewExpiresAt) { dispose(); return; }
        const extra = result.evidence.fakeDispatches === null ? {} : {
          screenAttempt: { requestId: job.requestId, consumed: true as const, fakeDispatches: result.evidence.fakeDispatches },
        };
        if (result.ok) emit('screen-result', SCREEN_VISION_SIMULATED_LABEL, { ...extra, answer: result.text, screenOutcome: 'completed' });
        else emit('screen-error', `Simulated screen outcome: ${result.outcome} (${result.code}). No real upload. No retry; fresh review is required.`,
          { ...extra, screenOutcome: result.outcome });
      }).catch(() => {
        if (!disposed && generation === mine && screenJob === job && Date.now() < previewExpiresAt)
          emit('screen-error', 'Simulated outcome UNKNOWN. No real upload or retry.', { screenOutcome: 'unknown' });
      }).finally(() => { if (screenJob === job) screenJob = undefined; });
      return;
    }
    if (action.type !== 'run' || !exactKeys(action, ['type','sessionId','token','revision']) || adapter || screenJob) return;
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
    wiring?.dispose();
  }
  return { dispatch, dispose };
}
