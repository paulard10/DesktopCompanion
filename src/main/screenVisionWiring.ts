/** Explicit trusted-main OFFLINE composition. No real issuer, store, HTTP or IPC. */
import { createScreenVisionGateOfflineTest } from './screenVisionGate.js';
import { screenVisionRemoteTestPrepared, screenVisionBridgeAttemptConsumed,
  type ScreenVisionResult, type ScreenVisionWireRequest } from './screenVisionRequest.js';
import type { OfflineVisionMock } from './qwenVisionMock.js';
import type { VisionBridgeDummy } from './screenVisionBridgeFake.js';
import type { OfflineVisionAttempt } from './screenVisionAttempt.js';
import { exactKeys } from './visionImage.js';

export interface PrivilegedVisionWiringTest {
  readonly purpose: 'test-only-privileged-screen-wiring';
  /** Trusted main only, after exact review, BEFORE separate test Gate A confirmation. */
  authorizeTestOperation(): boolean;
  dispose(): void;
}
type Gate = ReturnType<typeof createScreenVisionGateOfflineTest>;
const bindings = new WeakMap<PrivilegedVisionWiringTest, {
  gate: Gate; attached: boolean; disposed: boolean; pending?: ScreenVisionWireRequest; approved: boolean;
}>();
const failure = (wire: ScreenVisionWireRequest): ScreenVisionResult => Object.freeze({
  ok: false, code: 'authorization', outcome: 'failed', evidence: Object.freeze({
    transport: 'closed-fake', attemptConsumed: screenVisionBridgeAttemptConsumed(wire), fakeDispatches: 0, httpStatus: null,
  }),
});

/** Closed collaborators only. No generic executor, callback, URL, vault or live flag. */
export function createPrivilegedVisionWiringOfflineTest(options: {
  scope: 'privileged-screen-vision-wiring-test'; transport: OfflineVisionMock; dummy: VisionBridgeDummy; attempt?: OfflineVisionAttempt;
}): PrivilegedVisionWiringTest {
  if (!options || options.scope !== 'privileged-screen-vision-wiring-test' ||
      !exactKeys(options, Object.hasOwn(options, 'attempt') ? ['scope','transport','dummy','attempt'] : ['scope','transport','dummy']))
    throw new Error('Explicit closed offline wiring scope required.');
  const gate = createScreenVisionGateOfflineTest(options);
  const s = { gate, attached: false, disposed: false, pending: undefined as ScreenVisionWireRequest | undefined, approved: false };
  const handle: PrivilegedVisionWiringTest = Object.freeze({
    purpose: 'test-only-privileged-screen-wiring' as const,
    authorizeTestOperation(): boolean {
      if (arguments.length || s.disposed || s.approved || !s.pending || !screenVisionRemoteTestPrepared(s.pending)) return false;
      // This intent can only mint fake B for the SAME reviewed original object,
      // after the session separately confirms test A. It is not a native permit.
      s.approved = true; return true;
    },
    dispose(): void { s.disposed = true; s.pending = undefined; s.approved = false; gate.dispose(); },
  });
  bindings.set(handle, s); return handle;
}

/** Called only by an explicitly supplied session constructor option, never IPC. */
export function attachPrivilegedVisionWiringTest(handle: PrivilegedVisionWiringTest) {
  const s = bindings.get(handle);
  if (!s || s.attached || s.disposed) throw new Error('Original unused offline wiring handle required.');
  s.attached = true;
  return Object.freeze({
    review(wire: ScreenVisionWireRequest): void {
      s.pending = undefined; s.approved = false; s.gate.cancel();
      if (!s.disposed && screenVisionRemoteTestPrepared(wire)) s.pending = wire;
    },
    run(wire: ScreenVisionWireRequest, signal: AbortSignal, evidence: { fakeDispatches: 0 | 1 }): Promise<ScreenVisionResult> {
      const allowed = !s.disposed && s.approved && s.pending === wire && screenVisionRemoteTestPrepared(wire);
      s.pending = undefined; s.approved = false; // Synchronous consumption, no queued continuation.
      if (!allowed) return Promise.resolve(failure(wire));
      const issued = s.gate.issue(wire);
      if (!issued.ok) return Promise.resolve(issued);
      return s.gate.run(wire, issued.capability, signal).then(result => {
        if (result.evidence.fakeDispatches !== null) evidence.fakeDispatches = result.evidence.fakeDispatches;
        return result;
      });
    },
    cancel(): void { s.pending = undefined; s.approved = false; s.gate.cancel(); },
    dispose(): void { handle.dispose(); },
  });
}
