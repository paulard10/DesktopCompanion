/** Main-owned temporary crop + single-use LOCAL SIMULATION approval. No I/O. */
import { createHash, randomUUID } from 'node:crypto';
import { OFFLINE_VISION_SCENARIOS, validVisionQuestion, VISION_SHARING, VISION_IMAGE_UNAVAILABLE,
  SCREEN_VISION_POLICY, SCREEN_VISION_SIMULATED_LABEL, VISION_CONSENT, type ScreenRequestReview,
  type OfflineVisionNotice, type OfflineVisionScenario, type OfflineVisionReview, type VisionImageEligibility } from '../shared/offlineVision.js';
import { SCREEN_SELECTION } from '../shared/screenSelection.js';
import { buildVisionRequest, createOfflineVisionAdapter, VISION_MODEL_ID } from './qwenVisionAdapter.js';
import { createVisionMock, isVisionMock, type OfflineVisionMock, type MockVisionScenario } from './qwenVisionMock.js';
import { prepareScreenVisionRequest, prepareScreenVisionRemoteConsentTest, prepareScreenVisionOneShot, armOneScreenVisionSend, admitOneScreenVisionSend, screenVisionRemoteTestPrepared, executeScreenVisionMock, confirmScreenVisionBridgeConsent,
  type ScreenVisionSendAdmission, type ScreenVisionWireRequest } from './screenVisionRequest.js';
import { chatCompletionsUrl } from '../shared/qwenEndpoint.js';
import type { PrivilegedVisionWiringTest, attachPrivilegedVisionWiringTest } from './screenVisionWiring.js';
import { exactKeys, record, validateVisionCrop, type ApprovedCrop } from './visionImage.js';

// Placeholder satisfying the Singapore shape, NOT saved account configuration.
// A request is constructed and discarded locally; the mock never receives it.
const ENDPOINT = 'https://offline-ux.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
export interface ScreenVisionLiveReply { ok: boolean; kind?: string; text?: string; code?: string; posted: 0 | 1 }
function resolveConfiguredEndpoint(resolve?: () => string | null): string | null {
  if (!resolve) return ENDPOINT;
  try {
    const value = resolve();
    return typeof value === 'string' && chatCompletionsUrl(value) ? value : null;
  } catch { return null; }
}
function liveSendMessage(code: string, posted: 0 | 1): string {
  if (code === 'missing-key' || code === 'authentication') return 'Your Qwen API key is unavailable.';
  if (code === 'timeout') return 'The request timed out.';
  if (code === 'expired') return 'This preview expired. Select the image again.';
  if (posted && (code === 'cancelled' || code === 'unavailable' || code === 'stale' || code === 'tls' || code === 'tls-policy'))
    return 'The request may have reached Qwen. It was not retried.';
  if (code === 'cancelled') return 'The request was cancelled before it was sent.';
  return "Qwen couldn't analyze this image.";
}
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
  /** Absent in tests, which keep the placeholder. Production supplies the saved Singapore endpoint. */
  resolveOneShotEndpoint?: () => string | null;
  /** Main-owned one-shot POST. The renderer cannot provide this, a credential, a URL, or a body. */
  liveSend?: (admission: ScreenVisionSendAdmission, signal: AbortSignal) => Promise<ScreenVisionLiveReply>;
}): OfflineVisionSession {
  let crop: ApprovedCrop | undefined = Object.freeze({ ...options.crop });
  // Clear factory input references too; dispose must not retain a hidden owner.
  const sessionId = options.sessionId, publish = options.publish;
  const screenTransport = options.screenTransport;
  // Deliberately lazy: ordinary preview never loads gate/bridge/native transport.
  // The literal module validates a private runtime brand and single-session owner.
  const wiring: ReturnType<typeof attachPrivilegedVisionWiringTest> | undefined = options.testWiring === undefined ? undefined
    : (require('./screenVisionWiring.js') as typeof import('./screenVisionWiring.js')).attachPrivilegedVisionWiringTest(options.testWiring);
  const remoteTestWiring = options.testWiring?.purpose === 'test-only-one-shot-screen-wiring' ? wiring : undefined;
  if (screenTransport !== undefined && !isVisionMock(screenTransport)) throw new Error('Only a registered screen mock is allowed.');
  const previewExpiresAt = options.expiresAt ?? Date.now() + SCREEN_SELECTION.sessionMs;
  if (!Number.isSafeInteger(previewExpiresAt) || previewExpiresAt > Date.now() + SCREEN_SELECTION.sessionMs)
    throw new Error('Invalid preview lifetime.');
  const configuredEndpoint = resolveConfiguredEndpoint(options.resolveOneShotEndpoint);
  const liveSend = options.liveSend;
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
  let screenApproval: { token: string; scope: Readonly<ScreenRequestReview>; fingerprint: string; digest: string; scenario: OfflineVisionScenario;
    testWire?: ScreenVisionWireRequest } | undefined;
  let screenJob: { controller: AbortController; requestId: string; fakeDispatches: 0 | 1 } | undefined;
  let armedSend: { token: string; wire: ScreenVisionWireRequest; digest: string; revision: number } | undefined;
  const emit = (phase: OfflineVisionNotice['phase'], message: string, extra: Partial<OfflineVisionNotice> = {}): void => {
    if (!disposed) publish({ phase, question, revision, scenario, imageId, message,
      sharing: VISION_SHARING, imageEligibility, previewExpiresAt, ...extra });
  };
  const revoke = (): void => {
    wiring?.cancel();
    approval = undefined; screenApproval = undefined; armedSend = undefined; generation++; adapter?.cancel(); adapter = undefined;
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
  function startAdmittedSend(admitted: { ok: true; admission: ScreenVisionSendAdmission }, requestId: string): void {
    if (!liveSend) {
      emit('screen-error', 'Real sending is not connected. The credential was not read and nothing was uploaded.', { screenOutcome: 'failed' });
      return;
    }
    const mine = ++generation;
    const job = { controller: new AbortController(), requestId, fakeDispatches: 0 as const };
    screenJob = job;
    emit('screen-running', 'Qwen is analyzing your image...',
      { screenAttempt: { requestId: job.requestId, consumed: true, fakeDispatches: 0 } });
    void Promise.resolve().then(() => liveSend(admitted.admission, job.controller.signal)).then(reply => {
      if (disposed || generation !== mine || screenJob !== job) return;
      if (Date.now() >= previewExpiresAt) { dispose(); return; }
      const real = reply.ok === true && reply.kind === 'real-provider-response' && reply.posted === 1 &&
        typeof reply.text === 'string' && reply.text.trim();
      if (real) {
        emit('screen-result', 'Qwen answered.', { answer: reply.text, screenOutcome: 'completed',
          screenAttempt: { requestId: job.requestId, consumed: true, fakeDispatches: 0 } });
        return;
      }
      const code = reply.ok === true ? 'unavailable' : String(reply.code ?? 'unavailable');
      const posted: 0 | 1 = reply.posted === 1 ? 1 : 0;
      const outcome = !posted ? (code === 'cancelled' ? 'cancelled' as const : 'failed' as const)
        : (code === 'timeout' || code === 'unavailable' || code === 'stale' || code === 'cancelled' || code === 'tls' || code === 'tls-policy')
          ? 'unknown' as const : 'failed' as const;
      emit('screen-error', liveSendMessage(code, posted), { screenOutcome: outcome,
        screenAttempt: { requestId: job.requestId, consumed: true, fakeDispatches: 0 } });
    }).catch(() => {
      if (!disposed && generation === mine && screenJob === job && Date.now() < previewExpiresAt)
        emit('screen-error', 'The request may have reached Qwen. It was not retried.', { screenOutcome: 'unknown',
          screenAttempt: { requestId: job.requestId, consumed: true, fakeDispatches: 0 } });
    }).finally(() => { if (screenJob === job) screenJob = undefined; });
  }
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
    const remoteDryRun = action.type === 'review-remote-dry-run';
    const remoteSend = action.type === 'review-remote-send';
    if ((action.type === 'edit' || action.type === 'review' || action.type === 'review-screen-dry-run' || remoteReview || remoteDryRun || remoteSend) &&
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
      if (action.type === 'review-screen-dry-run' || remoteReview || remoteDryRun || remoteSend) {
        if (remoteSend && configuredEndpoint === null) {
          emit('error', 'Qwen is not configured with a Singapore endpoint. Nothing was uploaded.'); return;
        }
        const purpose = remoteDryRun ? { purpose: 'remote-transmission-consent' as const, consentKind: VISION_CONSENT.remote,
          execution: 'dry-run-only' as const, maxRequests: 1 as const }
          : remoteSend ? { purpose: 'remote-transmission-consent' as const, consentKind: VISION_CONSENT.remote,
            execution: 'one-shot-held' as const, maxRequests: 1 as const }
          : { purpose: SCREEN_VISION_POLICY.purpose };
        const oneShotEndpoint = remoteSend && configuredEndpoint ? configuredEndpoint : ENDPOINT;
        const scope: Readonly<ScreenRequestReview> = Object.freeze({ ...purpose,
          sessionId, imageId, requestId: randomUUID(), question, revision,
          provider: VISION_SHARING.provider, region: VISION_SHARING.region, model: VISION_MODEL_ID,
          endpointPolicy: SCREEN_VISION_POLICY.endpointPolicy, mime: 'image/png', width: crop.width, height: crop.height,
          pngBytes: crop.bytes.byteLength, expiresAt: Math.min(Date.now() + OFFLINE_APPROVAL_MS, previewExpiresAt),
          previewExpiresAt, outputTokens: 160, timeoutMs: 20000, responseBytes: 65536 });
        const prepared = remoteSend ? prepareScreenVisionOneShot(crop, scope, oneShotEndpoint)
          : remoteReview || remoteDryRun ? prepareScreenVisionRemoteConsentTest(crop, scope, ENDPOINT)
          : prepareScreenVisionRequest(crop, scope, ENDPOINT);
        if (!prepared.ok) { emit('error', VISION_IMAGE_UNAVAILABLE); return; }
        if (remoteReview) wiring!.review(prepared.wire);
        if (remoteDryRun) remoteTestWiring?.review(prepared.wire);
        screenApproval = { scope, fingerprint: prepared.wire.fingerprint, digest, scenario, token: `screen-review-${randomUUID()}`,
          ...(remoteReview || (remoteDryRun && remoteTestWiring) ? { testWire: prepared.wire } : {}) };
        emit('screen-review', remoteSend ? 'Review this exact crop and question. Approving does not upload. Send once to Qwen stays unavailable until you approve, and then it can run only once.'
          : remoteDryRun ? 'DRY RUN: review external sharing of this exact crop and question. Confirmation is local only; independent test Gate B is still required. No live permission is issued.'
          : remoteReview ? 'TEST-ONLY remote-consent simulation. Separate privileged test approval is required. No real transmission is authorized.'
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
    if ((action.type === 'confirm-screen-dry-run' || action.type === 'confirm-remote-dry-run' || action.type === 'confirm-remote-send' || (wiring && action.type === 'confirm-remote-consent-test')) &&
        exactKeys(action, ['type','sessionId','token','revision'])) {
      if (adapter || screenJob || !screenApproval || action.token !== screenApproval.token || action.revision !== screenApproval.scope.revision) return;
      const expectedConfirmation = screenApproval.scope.purpose === 'remote-transmission-consent'
        ? (screenApproval.scope.execution === 'one-shot-held' ? 'confirm-remote-send' : 'confirm-remote-dry-run')
        : screenApproval.testWire ? 'confirm-remote-consent-test' : 'confirm-screen-dry-run';
      if (action.type !== expectedConfirmation) return;
      const permit = screenApproval; screenApproval = undefined; // Consume before any await/dispatch, including failed attempts.
      if (Date.now() >= permit.scope.expiresAt || permit.scope.sessionId !== sessionId || permit.scope.imageId !== imageId ||
          permit.scope.question !== question || permit.scope.revision !== revision || permit.scenario !== scenario ||
          permit.digest !== createHash('sha256').update(crop.bytes).digest('hex')) {
        revoke(); emit('editing', 'Screen rehearsal review expired or changed. Review again; nothing was sent.'); return;
      }
      let prepared = permit.testWire ? { ok: true as const, wire: permit.testWire }
        : permit.scope.purpose === 'remote-transmission-consent' && permit.scope.execution === 'one-shot-held' ? prepareScreenVisionOneShot(crop, permit.scope, configuredEndpoint ?? ENDPOINT)
        : (permit.scope.purpose === 'remote-transmission-consent' ? prepareScreenVisionRemoteConsentTest : prepareScreenVisionRequest)(crop, permit.scope, ENDPOINT);
      if (!prepared.ok || prepared.wire.fingerprint !== permit.fingerprint || (permit.testWire && !screenVisionRemoteTestPrepared(permit.testWire))) {
        revoke(); emit('error', 'Screen rehearsal request changed. Nothing was sent.'); return;
      }
      if (permit.scope.purpose === 'remote-transmission-consent' && permit.scope.execution === 'one-shot-held') {
        const armed = armOneScreenVisionSend(prepared.wire);
        if (!armed.ok) {
          emit('screen-error', armed.code === 'expired'
            ? 'This approval expired. Nothing was uploaded. Review the crop and question again.'
            : 'This crop and question were not approved for sending. Nothing was uploaded.', { screenOutcome: 'failed' });
          return;
        }
        const token = `screen-send-${randomUUID()}`;
        armedSend = { token, wire: prepared.wire, digest, revision };
        emit('screen-approved', 'Approved for one send. Click Send once to Qwen to upload this exact crop and question. Nothing has been uploaded yet.',
          { screenReview: permit.scope, screenToken: token });
        return;
      }
      if (permit.scope.purpose === 'remote-transmission-consent' && !remoteTestWiring) {
        emit('screen-error', 'DRY RUN confirmation checked and consumed. Independent test Gate B is not active: no dispatch or credential lookup. Real sending remains unavailable.',
          { screenOutcome: 'failed' }); return;
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
    if (action.type === 'ask-qwen' && exactKeys(action, ['type','sessionId','question','revision'])) {
      if (adapter || screenJob) return;
      if (!Number.isSafeInteger(action.revision) || action.revision !== revision || action.question !== question) {
        emit('screen-error', 'Ask Qwen again for this question.', { screenOutcome: 'failed' }); return;
      }
      if (!validVisionQuestion(question)) { emit('screen-error', 'Write a question before asking Qwen.', { screenOutcome: 'failed' }); return; }
      if (!imageEligibility.available) { emit('screen-error', "Qwen couldn't analyze this image.", { screenOutcome: 'failed' }); return; }
      if (configuredEndpoint === null) { emit('screen-error', "Qwen couldn't analyze this image.", { screenOutcome: 'failed' }); return; }
      if (createHash('sha256').update(crop.bytes).digest('hex') !== digest) {
        emit('screen-error', "Qwen couldn't analyze this image.", { screenOutcome: 'failed' }); return;
      }
      screenApproval = undefined; armedSend = undefined;
      const scope: Readonly<ScreenRequestReview> = Object.freeze({
        purpose: 'remote-transmission-consent' as const, consentKind: VISION_CONSENT.remote,
        execution: 'one-shot-held' as const, maxRequests: 1 as const,
        sessionId, imageId, requestId: randomUUID(), question, revision,
        provider: VISION_SHARING.provider, region: VISION_SHARING.region, model: VISION_MODEL_ID,
        endpointPolicy: SCREEN_VISION_POLICY.endpointPolicy, mime: 'image/png' as const, width: crop.width, height: crop.height,
        pngBytes: crop.bytes.byteLength, expiresAt: Math.min(Date.now() + OFFLINE_APPROVAL_MS, previewExpiresAt),
        previewExpiresAt, outputTokens: 160 as const, timeoutMs: 20000 as const, responseBytes: 65536 as const });
      const prepared = prepareScreenVisionOneShot(crop, scope, configuredEndpoint ?? ENDPOINT);
      if (!prepared.ok) { emit('screen-error', "Qwen couldn't analyze this image.", { screenOutcome: 'failed' }); return; }
      const armed = armOneScreenVisionSend(prepared.wire);
      if (!armed.ok) { emit('screen-error', "Qwen couldn't analyze this image.", { screenOutcome: 'failed' }); return; }
      const admitted = admitOneScreenVisionSend(prepared.wire);
      if (!admitted.ok) {
        emit('screen-error', admitted.code === 'expired' ? 'This preview expired. Select the image again.' : "Qwen couldn't analyze this image.",
          { screenOutcome: 'failed' });
        return;
      }
      startAdmittedSend(admitted, scope.requestId);
      return;
    }
    if (action.type === 'send-once-to-qwen' && exactKeys(action, ['type','sessionId','token','revision'])) {
      if (adapter || screenJob || !armedSend || action.token !== armedSend.token || action.revision !== armedSend.revision) return;
      const armed = armedSend; armedSend = undefined;
      const cropDigest = createHash('sha256').update(crop.bytes).digest('hex');
      if (Date.now() >= previewExpiresAt || Date.now() >= armed.wire.scope.expiresAt || armed.revision !== revision ||
          armed.wire.scope.question !== question || armed.digest !== cropDigest) {
        const dropped = admitOneScreenVisionSend(armed.wire);
        void dropped;
        emit('screen-error', 'This approval expired or the crop changed. Nothing was uploaded. Review the crop and question again.',
          { screenOutcome: 'failed' });
        return;
      }
      const admitted = admitOneScreenVisionSend(armed.wire);
      if (!admitted.ok) {
        emit('screen-error', admitted.code === 'expired'
          ? 'This approval expired. Nothing was uploaded. Review the crop and question again.'
          : 'This send was not authorized. Nothing was uploaded.', { screenOutcome: 'failed' });
        return;
      }
      startAdmittedSend(admitted, armed.wire.scope.requestId);
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
