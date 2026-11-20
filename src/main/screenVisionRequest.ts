/** Main-only screen request contract and closed fake execution. NO live client. */
import { createHash } from 'node:crypto';
import { SCREEN_VISION_POLICY, VISION_SHARING, VISION_CONSENT, type ScreenRequestReview } from '../shared/offlineVision.js';
import { chatCompletionsUrl } from '../shared/qwenEndpoint.js';
import { buildVisionRequest, normalizeVisionReply, type BuiltVisionRequest, type VisionFailure } from './qwenVisionAdapter.js';
import { exchangeVisionRequestMock, isVisionMock, type OfflineVisionMock } from './qwenVisionMock.js';
import type { ApprovedCrop } from './visionImage.js';
import type { LiveVisionResult } from './qwenVisionTransport.js';

export const SCREEN_VISION_LIVE_DISABLED = true;
export interface ScreenVisionWireRequest {
  scope: Readonly<ScreenRequestReview>; request: BuiltVisionRequest; fingerprint: string;
}
/** Main-only, synthetic execution evidence. Never a live permit or provider receipt. */
export interface ScreenVisionExecutionEvidence {
  readonly transport: 'closed-fake'; readonly attemptConsumed: boolean;
  readonly fakeDispatches: 0 | 1 | null; readonly httpStatus: number | null;
}
export type ScreenVisionResult = ({ ok: true; kind: 'simulated-qwen-response'; text: string } |
  { ok: false; outcome: 'failed' | 'unknown' | 'cancelled';
    code: VisionFailure | Extract<LiveVisionResult, { ok: false }>['code'] | 'session-expired' }) &
  { readonly evidence: Readonly<ScreenVisionExecutionEvidence> };

// Provenance and original fingerprint stay private; a copied/self-signed object
// cannot become a prepared attempt. Weak keys retain no encoded request or crop.
const prepared = new WeakMap<ScreenVisionWireRequest, {
  fingerprint: string; consumed: boolean; dispatches: 0 | 1; httpStatus: number | null;
  domain: 'offline-rehearsal' | 'test-only-remote-consent' | 'one-shot-held';
  armed?: boolean; confirmed?: () => boolean;
}>();
/** Main-only single POST ticket. It cannot be built or replayed by the renderer. */
export interface ScreenVisionSendAdmission { readonly purpose: 'one-screen-vision-post' }
const admissions = new WeakMap<ScreenVisionSendAdmission, { wire: ScreenVisionWireRequest; used: boolean }>();

export interface ScreenVisionBridgeLease { readonly purpose: 'offline-screen-bridge-attempt' }
const leases = new WeakMap<ScreenVisionBridgeLease, ScreenVisionWireRequest>();
/** Read-only main evidence; never mints/resets consent or exposes the request. */
export const screenVisionBridgeAttemptConsumed = (wire: ScreenVisionWireRequest): boolean => prepared.get(wire)?.consumed ?? false;
/** Read-only Gate A check for isolated fake-capability issuance; grants no dispatch. */
export function screenVisionBridgeConsentActive(wire: ScreenVisionWireRequest): boolean {
  return !prepared.get(wire)?.consumed && currentConfirmedRequest(wire, 'before-dispatch') !== null;
}
/** Private preparer provenance, not a renderer field or transmission permission. */
export function screenVisionRemoteTestPrepared(wire: ScreenVisionWireRequest): boolean {
  const s = prepared.get(wire);
  if (!s || s.domain !== 'test-only-remote-consent' || s.consumed ||
      Date.now() >= wire.scope.expiresAt || Date.now() >= wire.scope.previewExpiresAt) return false;
  try { return wire.fingerprint === s.fingerprint &&
    createHash('sha256').update(JSON.stringify({ scope: wire.scope, request: wire.request })).digest('hex') === s.fingerprint;
  } catch { return false; }
}
/** Called ONLY after the existing owned session validated/consumed its review token. */
export function confirmScreenVisionBridgeConsent(wire: ScreenVisionWireRequest, active: () => boolean): boolean {
  const s = prepared.get(wire);
  if (!s || s.consumed || s.confirmed || typeof active !== 'function') return false;
  try { if (!active()) return false; } catch { return false; }
  s.confirmed = active; return true;
}
export function claimScreenVisionBridgeAttempt(wire: ScreenVisionWireRequest, signal: AbortSignal):
  { ok: true; lease: ScreenVisionBridgeLease } | { ok: false; code: Extract<ScreenVisionResult, { ok: false }>['code']; consumed: boolean } {
  const s = prepared.get(wire);
  if (s?.consumed) return { ok: false, code: 'duplicate', consumed: true };
  if (!s?.confirmed) return { ok: false, code: 'authorization', consumed: false };
  s.consumed = true;
  if (signal.aborted) { s.confirmed = undefined; return { ok: false, code: 'cancelled', consumed: true }; }
  if (Date.now() >= wire.scope.previewExpiresAt) { s.confirmed = undefined; return { ok: false, code: 'session-expired', consumed: true }; }
  if (Date.now() >= wire.scope.expiresAt) { s.confirmed = undefined; return { ok: false, code: 'expired', consumed: true }; }
  const lease = Object.freeze({ purpose: 'offline-screen-bridge-attempt' as const });
  leases.set(lease, wire);
  if (!readScreenVisionBridgeLease(lease)) { leases.delete(lease); s.confirmed = undefined; return { ok: false, code: 'authorization', consumed: true }; }
  return { ok: true, lease };
}
/** Rechecked before/after dummy acquisition, so disposal or mutation cannot dispatch. */
export function readScreenVisionBridgeLease(lease: ScreenVisionBridgeLease, phase: 'before-dispatch' | 'response' = 'before-dispatch'): ScreenVisionWireRequest | null {
  return currentConfirmedRequest(leases.get(lease), phase);
}
function currentConfirmedRequest(wire: ScreenVisionWireRequest | undefined, phase: 'before-dispatch' | 'response'): ScreenVisionWireRequest | null {
  const s = wire && prepared.get(wire);
  if (!wire || !s?.confirmed || Date.now() >= wire.scope.previewExpiresAt ||
      (phase === 'before-dispatch' && Date.now() >= wire.scope.expiresAt)) return null;
  try {
    if (!s.confirmed() || wire.fingerprint !== s.fingerprint ||
        createHash('sha256').update(JSON.stringify({ scope: wire.scope, request: wire.request })).digest('hex') !== s.fingerprint) return null;
    return wire;
  } catch { return null; }
}
export function releaseScreenVisionBridgeLease(lease: ScreenVisionBridgeLease): void {
  const wire = leases.get(lease), s = wire && prepared.get(wire);
  if (s) s.confirmed = undefined; leases.delete(lease);
}

/** Same builder as the pilot, with a distinct policy/domain, never its permit. */
export function prepareScreenVisionRequest(crop: ApprovedCrop, scope: Readonly<ScreenRequestReview>, endpoint: string):
  { ok: true; wire: ScreenVisionWireRequest } | { ok: false; code: VisionFailure } {
  return prepare(crop, scope, endpoint, 'offline-rehearsal');
}
/** Dedicated main-only simulation. The review metadata remains offline; no live grant. */
export function prepareScreenVisionRemoteConsentTest(crop: ApprovedCrop, scope: Readonly<ScreenRequestReview>, endpoint: string):
  { ok: true; wire: ScreenVisionWireRequest } | { ok: false; code: VisionFailure } {
  return prepare(crop, scope, endpoint, 'test-only-remote-consent');
}
/** Real one-shot body. This module still does not read a credential or call fetch. */
export function prepareScreenVisionOneShot(crop: ApprovedCrop, scope: Readonly<ScreenRequestReview>, endpoint: string):
  { ok: true; wire: ScreenVisionWireRequest } | { ok: false; code: VisionFailure } {
  return prepare(crop, scope, endpoint, 'one-shot-held');
}
/** Mark the reviewed body eligible for one later admission. Does not consume it or touch a credential. */
export function armOneScreenVisionSend(wire: ScreenVisionWireRequest):
  { ok: true } | { ok: false; code: 'authorization' | 'duplicate' | 'expired' } {
  const state = oneShotState(wire);
  if (!state) return { ok: false, code: 'authorization' };
  if (state.consumed || state.armed) return { ok: false, code: 'duplicate' };
  if (Date.now() >= wire.scope.expiresAt || Date.now() >= wire.scope.previewExpiresAt) return { ok: false, code: 'expired' };
  state.armed = true;
  return { ok: true };
}
/** Consume the armed body and mint one non-serializable POST ticket. No credential and no network. */
export function admitOneScreenVisionSend(wire: ScreenVisionWireRequest):
  { ok: true; admission: ScreenVisionSendAdmission } | { ok: false; code: 'authorization' | 'duplicate' | 'expired' } {
  const state = oneShotState(wire);
  if (!state || !state.armed) return { ok: false, code: state?.consumed ? 'duplicate' : 'authorization' };
  if (state.consumed) return { ok: false, code: 'duplicate' };
  state.armed = false;
  state.consumed = true;
  if (Date.now() >= wire.scope.expiresAt || Date.now() >= wire.scope.previewExpiresAt) return { ok: false, code: 'expired' };
  const admission = Object.freeze({ purpose: 'one-screen-vision-post' as const,
    toJSON(): never { throw new Error('A screen send admission cannot be serialized.'); } });
  admissions.set(admission, { wire, used: false });
  return { ok: true, admission };
}
/** Single read of an admission. A second read, a copy, or a changed body returns null. */
export function takeScreenVisionSendAdmission(admission: ScreenVisionSendAdmission): ScreenVisionWireRequest | null {
  const held = admission && admissions.get(admission);
  if (!held || held.used) return null;
  held.used = true;
  const wire = held.wire, state = prepared.get(wire);
  if (!state || state.domain !== 'one-shot-held' || !oneShotState(wire)) return null;
  return wire;
}
function oneShotState(wire: ScreenVisionWireRequest) {
  const state = prepared.get(wire);
  if (!state || state.domain !== 'one-shot-held' || wire.scope.purpose !== 'remote-transmission-consent' ||
      wire.scope.execution !== 'one-shot-held' || wire.scope.maxRequests !== 1 ||
      wire.request.body.model !== 'qwen3.7-plus' || wire.request.body.stream !== false ||
      wire.request.body.enable_thinking !== false || wire.request.body.max_completion_tokens !== 160 ||
      !chatCompletionsUrl(wire.request.url)) return null;
  try {
    if (wire.fingerprint !== state.fingerprint ||
        createHash('sha256').update(JSON.stringify({ scope: wire.scope, request: wire.request })).digest('hex') !== state.fingerprint)
      return null;
  } catch { return null; }
  return state;
}
/** Consume the prepared body and stop. Never reads a credential or calls fetch. */
export function holdOneScreenVisionSend(wire: ScreenVisionWireRequest):
  { ok: false; code: 'held'; message: string } | { ok: false; code: 'authorization' | 'duplicate' | 'expired' } {
  const state = prepared.get(wire);
  if (!state || state.domain !== 'one-shot-held' || wire.scope.purpose !== 'remote-transmission-consent' ||
      wire.scope.execution !== 'one-shot-held' || wire.scope.maxRequests !== 1 ||
      wire.request.body.model !== 'qwen3.7-plus' || wire.request.body.stream !== false ||
      wire.request.body.enable_thinking !== false || wire.request.body.max_completion_tokens !== 160) return { ok: false, code: 'authorization' };
  if (state.consumed) return { ok: false, code: 'duplicate' };
  if (Date.now() >= wire.scope.expiresAt || Date.now() >= wire.scope.previewExpiresAt) return { ok: false, code: 'expired' };
  try {
    if (wire.fingerprint !== state.fingerprint ||
        createHash('sha256').update(JSON.stringify({ scope: wire.scope, request: wire.request })).digest('hex') !== state.fingerprint)
      return { ok: false, code: 'authorization' };
  } catch { return { ok: false, code: 'authorization' }; }
  state.consumed = true;
  return { ok: false, code: 'held', message:
    `Stopped before the external request. Crop ${wire.scope.width}×${wire.scope.height} px, ${wire.scope.pngBytes} bytes. ` +
    `Question: ${wire.scope.question} Model qwen3.7-plus, Singapore, one POST, no retry. ` +
    'The credential was not read and nothing was uploaded. A fresh approval of this exact crop and question is required before the first real send.' };
}
function prepare(crop: ApprovedCrop, scope: Readonly<ScreenRequestReview>, endpoint: string,
  domain: 'offline-rehearsal' | 'test-only-remote-consent' | 'one-shot-held'):
  { ok: true; wire: ScreenVisionWireRequest } | { ok: false; code: VisionFailure } {
  const remote = scope.purpose === 'remote-transmission-consent';
  const remoteOk = remote && scope.consentKind === VISION_CONSENT.remote && scope.maxRequests === 1 &&
    ((scope.execution === 'dry-run-only' && domain === 'test-only-remote-consent') ||
      (scope.execution === 'one-shot-held' && domain === 'one-shot-held'));
  // The offline policy purpose can rehearse the fake consent path. It cannot mint a one-shot admission.
  const offlineOk = scope.purpose === SCREEN_VISION_POLICY.purpose &&
    (domain === 'offline-rehearsal' || domain === 'test-only-remote-consent');
  if ((remote ? !remoteOk : !offlineOk) ||
      scope.provider !== VISION_SHARING.provider ||
      scope.region !== VISION_SHARING.region || scope.model !== VISION_SHARING.model || scope.mime !== 'image/png' ||
      scope.endpointPolicy !== SCREEN_VISION_POLICY.endpointPolicy || scope.outputTokens !== 160 ||
      scope.timeoutMs !== 20000 || scope.responseBytes !== 65536 || scope.width !== crop.width ||
      scope.height !== crop.height || scope.pngBytes !== crop.bytes.byteLength ||
      !Number.isSafeInteger(scope.expiresAt) || scope.expiresAt > scope.previewExpiresAt) return { ok: false, code: 'invalid-request' };
  const built = buildVisionRequest({ endpoint, model: scope.model, question: scope.question, image: crop }, 'screen-vision');
  if (!built.ok) return { ok: false, code: built.code };
  const fingerprint = createHash('sha256').update(JSON.stringify({ scope, request: built.request })).digest('hex');
  const wire = { scope, request: built.request, fingerprint };
  prepared.set(wire, { fingerprint, consumed: false, dispatches: 0, httpStatus: null, domain });
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
  if (!state || wire.scope.purpose === 'remote-transmission-consent') return fail('authorization'); // Remote-contract rehearsals require independent fake B.
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
