/** Main-only screen request contract and closed fake execution. NO live client. */
import { createHash } from 'node:crypto';
import { SCREEN_VISION_POLICY, VISION_SHARING, type ScreenVisionReview } from '../shared/offlineVision.js';
import { buildVisionRequest, normalizeVisionReply, type BuiltVisionRequest, type VisionFailure } from './qwenVisionAdapter.js';
import { exchangeVisionRequestMock, isVisionMock, type OfflineVisionMock } from './qwenVisionMock.js';
import type { ApprovedCrop } from './visionImage.js';

export const SCREEN_VISION_LIVE_DISABLED = true;
export interface ScreenVisionWireRequest {
  scope: Readonly<ScreenVisionReview>; request: BuiltVisionRequest; fingerprint: string;
}
/** Main-only, synthetic execution evidence. Never a live permit or provider receipt. */
export interface ScreenVisionExecutionEvidence {
  readonly transport: 'closed-fake'; readonly attemptConsumed: boolean;
  readonly fakeDispatches: 0 | 1; readonly httpStatus: number | null;
}
export type ScreenVisionResult = ({ ok: true; kind: 'simulated-qwen-response'; text: string } |
  { ok: false; outcome: 'failed' | 'unknown' | 'cancelled';
    code: VisionFailure | 'authorization' | 'expired' | 'session-expired' | 'duplicate' | 'response-too-large' }) &
  { readonly evidence: Readonly<ScreenVisionExecutionEvidence> };

// Provenance and original fingerprint stay private; a copied/self-signed object
// cannot become a prepared attempt. Weak keys retain no encoded request or crop.
const prepared = new WeakMap<ScreenVisionWireRequest, {
  fingerprint: string; consumed: boolean; dispatches: 0 | 1; httpStatus: number | null;
}>();

/** Same builder as the pilot, with a distinct policy/domain, never its permit. */
export function prepareScreenVisionRequest(crop: ApprovedCrop, scope: Readonly<ScreenVisionReview>, endpoint: string):
  { ok: true; wire: ScreenVisionWireRequest } | { ok: false; code: VisionFailure } {
  if (scope.purpose !== SCREEN_VISION_POLICY.purpose || scope.provider !== VISION_SHARING.provider ||
      scope.region !== VISION_SHARING.region || scope.model !== VISION_SHARING.model || scope.mime !== 'image/png' ||
      scope.endpointPolicy !== SCREEN_VISION_POLICY.endpointPolicy || scope.outputTokens !== 160 ||
      scope.timeoutMs !== 20000 || scope.responseBytes !== 65536 || scope.width !== crop.width ||
      scope.height !== crop.height || scope.pngBytes !== crop.bytes.byteLength ||
      !Number.isSafeInteger(scope.expiresAt) || scope.expiresAt > scope.previewExpiresAt) return { ok: false, code: 'invalid-request' };
  const built = buildVisionRequest({ endpoint, model: scope.model, question: scope.question, image: crop }, 'screen-vision');
  if (!built.ok) return { ok: false, code: built.code };
  const fingerprint = createHash('sha256').update(JSON.stringify({ scope, request: built.request })).digest('hex');
  const wire = { scope, request: built.request, fingerprint };
  prepared.set(wire, { fingerprint, consumed: false, dispatches: 0, httpStatus: null });
  return { ok: true, wire };
}

/** Only registered closed mocks; no injected callbacks/fetch, credentials or disk. */
export async function executeScreenVisionMock(wire: ScreenVisionWireRequest, transport: OfflineVisionMock,
  signal: AbortSignal, attempt: { fakeDispatches: 0 | 1 }): Promise<ScreenVisionResult> {
  const state = prepared.get(wire);
  const evidence = (): Readonly<ScreenVisionExecutionEvidence> => Object.freeze({ transport: 'closed-fake',
    attemptConsumed: state?.consumed ?? false, fakeDispatches: state?.dispatches ?? 0,
    httpStatus: state?.httpStatus ?? null });
  const fail = (code: Extract<ScreenVisionResult, { ok: false }>['code'], outcome: 'failed' | 'unknown' | 'cancelled' = 'failed'):
    ScreenVisionResult => Object.freeze({ ok: false, code, outcome, evidence: evidence() });
  if (!state) return fail('authorization');
  if (!isVisionMock(transport)) return fail('invalid-request');
  if (state.consumed || attempt.fakeDispatches !== 0) return fail('duplicate');
  state.consumed = true; // BEFORE async work; failure/cancellation cannot renew it.
  if (signal.aborted) return fail('cancelled', 'cancelled');
  if (Date.now() >= wire.scope.previewExpiresAt) return fail('session-expired');
  if (Date.now() >= wire.scope.expiresAt) return fail('expired');
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); },
    Math.min(SCREEN_VISION_POLICY.timeoutMs, wire.scope.previewExpiresAt - Date.now()));
  try {
    // A cancellation between confirmation and dispatch prevents invocation.
    await Promise.resolve();
    if (signal.aborted) return fail('cancelled', 'cancelled');
    if (Date.now() >= wire.scope.previewExpiresAt) return fail('session-expired');
    if (controller.signal.aborted || Date.now() >= wire.scope.expiresAt) return fail('expired');
    const same = createHash('sha256').update(JSON.stringify({ scope: wire.scope, request: wire.request })).digest('hex');
    if (same !== state.fingerprint || wire.fingerprint !== state.fingerprint) return fail('invalid-request');
    state.dispatches = attempt.fakeDispatches = 1;
    const pending = exchangeVisionRequestMock(transport, wire, controller.signal);
    const requestId = wire.scope.requestId;
    wire = undefined as unknown as ScreenVisionWireRequest; // Release encoded request before awaiting.
    const reply = await pending;
    if (controller.signal.aborted) return fail(timedOut ? 'timeout' : 'cancelled', timedOut ? 'unknown' : 'cancelled');
    if ('failure' in reply) return fail(reply.failure, reply.failure === 'cancelled' ? 'cancelled' : 'unknown');
    if (reply.requestId !== requestId) return fail('stale', 'unknown');
    state.httpStatus = reply.status;
    if (Buffer.byteLength(reply.body, 'utf8') > SCREEN_VISION_POLICY.responseBytes) return fail('response-too-large');
    const result = normalizeVisionReply(reply.status, reply.body);
    return result.ok ? Object.freeze({ ok: true, kind: 'simulated-qwen-response', text: result.text,
      evidence: evidence() }) : fail(result.code);
  } catch { return fail('unavailable', state.dispatches ? 'unknown' : 'failed'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); wire = undefined as unknown as ScreenVisionWireRequest; }
}
