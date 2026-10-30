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
export type ScreenVisionResult = { ok: true; kind: 'simulated-qwen-response'; text: string } |
  { ok: false; outcome: 'failed' | 'unknown' | 'cancelled'; code: VisionFailure | 'expired' | 'duplicate' | 'response-too-large' };

/** Same builder as the pilot, with a distinct policy/domain, never its permit. */
export function prepareScreenVisionRequest(crop: ApprovedCrop, scope: Readonly<ScreenVisionReview>, endpoint: string):
  { ok: true; wire: ScreenVisionWireRequest } | { ok: false } {
  if (scope.purpose !== SCREEN_VISION_POLICY.purpose || scope.provider !== VISION_SHARING.provider ||
      scope.region !== VISION_SHARING.region || scope.model !== VISION_SHARING.model || scope.mime !== 'image/png' ||
      scope.endpointPolicy !== SCREEN_VISION_POLICY.endpointPolicy || scope.outputTokens !== 160 ||
      scope.timeoutMs !== 20000 || scope.responseBytes !== 65536 || scope.width !== crop.width ||
      scope.height !== crop.height || scope.pngBytes !== crop.bytes.byteLength ||
      !Number.isSafeInteger(scope.expiresAt) || scope.expiresAt > scope.previewExpiresAt) return { ok: false };
  const built = buildVisionRequest({ endpoint, model: scope.model, question: scope.question, image: crop }, 'screen-vision');
  if (!built.ok) return { ok: false };
  const fingerprint = createHash('sha256').update(JSON.stringify({ scope, request: built.request })).digest('hex');
  return { ok: true, wire: { scope, request: built.request, fingerprint } };
}

const attempted = new WeakSet<ScreenVisionWireRequest>();
/** Only registered closed mocks; no injected callbacks/fetch, credentials or disk. */
export async function executeScreenVisionMock(wire: ScreenVisionWireRequest, transport: OfflineVisionMock,
  signal: AbortSignal, attempt: { fakeDispatches: 0 | 1 }): Promise<ScreenVisionResult> {
  const fail = (code: Extract<ScreenVisionResult, { ok: false }>['code'], outcome: 'failed' | 'unknown' | 'cancelled' = 'failed'):
    ScreenVisionResult => ({ ok: false, code, outcome });
  if (!isVisionMock(transport) || wire.scope.purpose !== SCREEN_VISION_POLICY.purpose) return fail('invalid-request');
  if (attempted.has(wire) || attempt.fakeDispatches !== 0) return fail('duplicate');
  attempted.add(wire); // A cancelled/failed attempt cannot replay this capability.
  if (signal.aborted) return fail('cancelled', 'cancelled');
  if (Date.now() >= wire.scope.expiresAt || Date.now() >= wire.scope.previewExpiresAt) return fail('expired');
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
    if (controller.signal.aborted || Date.now() >= wire.scope.expiresAt || Date.now() >= wire.scope.previewExpiresAt) return fail('expired');
    const same = createHash('sha256').update(JSON.stringify({ scope: wire.scope, request: wire.request })).digest('hex');
    if (same !== wire.fingerprint) return fail('invalid-request');
    attempt.fakeDispatches = 1;
    const pending = exchangeVisionRequestMock(transport, wire, controller.signal);
    const requestId = wire.scope.requestId;
    wire = undefined as unknown as ScreenVisionWireRequest; // Release encoded request before awaiting.
    const reply = await pending;
    if (controller.signal.aborted) return fail(timedOut ? 'timeout' : 'cancelled', timedOut ? 'unknown' : 'cancelled');
    if ('failure' in reply) return fail(reply.failure, reply.failure === 'cancelled' ? 'cancelled' : 'unknown');
    if (reply.requestId !== requestId) return fail('stale', 'unknown');
    if (Buffer.byteLength(reply.body, 'utf8') > SCREEN_VISION_POLICY.responseBytes) return fail('response-too-large');
    const result = normalizeVisionReply(reply.status, reply.body);
    return result.ok ? { ok: true, kind: 'simulated-qwen-response', text: result.text } : fail(result.code);
  } catch { return fail('unavailable', attempt.fakeDispatches ? 'unknown' : 'failed'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); wire = undefined as unknown as ScreenVisionWireRequest; }
}
