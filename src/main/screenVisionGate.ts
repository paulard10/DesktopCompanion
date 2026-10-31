/** Unregistered, FAKE-only Gate B rehearsal. No native capability issuer exists. */
import { app } from 'electron';
import { createOfflineScreenVisionBridge } from './screenVisionBridge.js';
import { isVisionMock, type OfflineVisionMock } from './qwenVisionMock.js';
import { isVisionBridgeDummy, type VisionBridgeDummy } from './screenVisionBridgeFake.js';
import { screenVisionBridgeConsentActive, screenVisionBridgeAttemptConsumed,
  type ScreenVisionResult, type ScreenVisionWireRequest } from './screenVisionRequest.js';
import { exactKeys } from './visionImage.js';
import { isOfflineVisionAttempt, type OfflineVisionAttempt } from './screenVisionAttempt.js';

// Offline rehearsal purpose is deliberately incompatible with any future native grant.
export interface OfflineScreenVisionCapability { readonly purpose: 'fake-screen-vision-gate' }
export const SCREEN_VISION_NATIVE_GATE_CLOSED = true;
export const FAKE_CAPABILITY_MS = 5_000; // Shorter than, never extending, the existing 30-s consent.
const issuedRequests = new WeakSet<ScreenVisionWireRequest>();
type Failure = Extract<ScreenVisionResult, { ok: false }>;
type CapabilityState = { consumed: boolean; expired: boolean };

/** Trusted synthetic composition ONLY; not imported by main, preview or preload.
 * Existing confirmed OFFLINE consent rehearses Gate A; it never grants remote consent.
 * Main is trusted: this is not physical-human-click attestation. */
export function createScreenVisionGateOfflineTest(options: {
  scope: 'privileged-screen-vision-offline-test'; transport: OfflineVisionMock; dummy: VisionBridgeDummy; attempt?: OfflineVisionAttempt;
}) {
  if (app.isPackaged || process.type !== 'browser' || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
      !options || !exactKeys(options, Object.hasOwn(options, 'attempt') ? ['scope','transport','dummy','attempt'] : ['scope','transport','dummy']) ||
      (Object.hasOwn(options, 'attempt') && !isOfflineVisionAttempt(options.attempt)) || options.scope !== 'privileged-screen-vision-offline-test' ||
      !isVisionMock(options.transport) || !isVisionBridgeDummy(options.dummy))
    throw new Error('Unpackaged main process and explicit closed fake test scope required.');
  const bridge = createOfflineScreenVisionBridge({ transport: options.transport, dummy: options.dummy,
    ...(options.attempt ? { attempt: options.attempt } : {}) });
  const capabilities = new WeakMap<OfflineScreenVisionCapability, CapabilityState>();
  let pending: { capability: OfflineScreenVisionCapability; wire: ScreenVisionWireRequest; expiresAt: number } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, active: AbortController | undefined, disposed = false;
  function clearPending(): void { if (timer) clearTimeout(timer); timer = undefined; pending = undefined; }
  const fail = (code: Failure['code'], wire: ScreenVisionWireRequest): Failure => Object.freeze({ ok: false, code, outcome: 'failed',
    evidence: Object.freeze({ transport: 'closed-fake', attemptConsumed: screenVisionBridgeAttemptConsumed(wire), fakeDispatches: 0, httpStatus: null }) });
  const denied = (): boolean => disposed || app.isPackaged || process.type !== 'browser' || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
  return Object.freeze({
    issue(wire: ScreenVisionWireRequest): { ok: true; capability: OfflineScreenVisionCapability } | Failure {
      if (arguments.length !== 1 || denied()) return fail('authorization', wire);
      if (active || pending) return fail('busy', wire);
      if (!screenVisionBridgeConsentActive(wire)) return fail('authorization', wire);
      if (issuedRequests.has(wire)) return fail('duplicate', wire);
      const capability = Object.freeze({ purpose: 'fake-screen-vision-gate' as const,
        toJSON(): never { throw new Error('Offline capabilities cannot be serialized.'); } });
      const state = { consumed: false, expired: false };
      capabilities.set(capability, state); issuedRequests.add(wire);
      pending = { capability, wire, expiresAt: Math.min(Date.now() + FAKE_CAPABILITY_MS, wire.scope.expiresAt, wire.scope.previewExpiresAt) };
      timer = setTimeout(() => { state.expired = true; clearPending(); }, Math.max(0, pending.expiresAt - Date.now()));
      return { ok: true, capability };
    },
    async run(wire: ScreenVisionWireRequest, capability: OfflineScreenVisionCapability, signal?: AbortSignal): Promise<ScreenVisionResult> {
      if (arguments.length < 2 || arguments.length > 3 || (signal !== undefined && !(signal instanceof AbortSignal)) || denied())
        return fail('authorization', wire);
      const state = capabilities.get(capability);
      if (!state) return fail('authorization', wire);
      if (state.consumed) return fail('duplicate', wire);
      if (state.expired || (pending?.capability === capability && Date.now() >= pending.expiresAt)) {
        state.expired = true; if (pending?.capability === capability) clearPending(); return fail('expired', wire);
      }
      if (active) return fail('busy', wire);
      if (pending?.capability !== capability || pending.wire !== wire) return fail('authorization', wire);
      // Both runtime identities checked before admission. No await between B's
      // consumption and the existing bridge's synchronous claim of Gate A.
      state.consumed = true; clearPending();
      if (!screenVisionBridgeConsentActive(wire)) return fail('authorization', wire);
      const controller = new AbortController(), abort = (): void => controller.abort();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener('abort', abort, { once: true }); active = controller;
      try { return await bridge.run(wire, controller.signal); }
      finally { controller.abort(); signal?.removeEventListener('abort', abort); if (active === controller) active = undefined; }
    },
    cancel(): void {
      if (pending) capabilities.get(pending.capability)!.consumed = true;
      clearPending(); active?.abort(); bridge.cancel();
    },
    dispose(): void {
      disposed = true;
      if (pending) capabilities.get(pending.capability)!.consumed = true;
      clearPending(); active?.abort(); bridge.dispose();
    },
  });
}
