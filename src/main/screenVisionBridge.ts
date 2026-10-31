/** UNREGISTERED main-only offline bridge; normal UI never imports this module. */
import { executeOfflineScreenVisionExchange } from './qwenVisionTransport.js';
import { isVisionMock, type OfflineVisionMock } from './qwenVisionMock.js';
import { isVisionBridgeDummy, type VisionBridgeDummy } from './screenVisionBridgeFake.js';
import { claimScreenVisionBridgeAttempt, readScreenVisionBridgeLease, releaseScreenVisionBridgeLease,
  screenVisionBridgeAttemptConsumed, type ScreenVisionResult, type ScreenVisionWireRequest } from './screenVisionRequest.js';
import { exactKeys } from './visionImage.js';
import { isOfflineVisionAttempt, commitOfflineVisionAttempt, finishOfflineVisionAttempt, closeOfflineVisionAttempt,
  type OfflineVisionAttempt } from './screenVisionAttempt.js';

export const SCREEN_VISION_BRIDGE_LIVE_DISABLED = true;
/** Gate B has no issuer/native adapter here; test collaborators cannot activate it. */
export function createOfflineScreenVisionBridge(options: { transport: OfflineVisionMock; dummy: VisionBridgeDummy; attempt?: OfflineVisionAttempt }) {
  if (!options || !exactKeys(options, Object.hasOwn(options, 'attempt') ? ['transport','dummy','attempt'] : ['transport','dummy']) ||
      (Object.hasOwn(options, 'attempt') && !isOfflineVisionAttempt(options.attempt)) || !isVisionMock(options.transport) || !isVisionBridgeDummy(options.dummy))
    throw new Error('Only registered fake HTTP and dummy credential collaborators are allowed.');
  const { transport, dummy, attempt } = options;
  let active: AbortController | undefined, disposed = false;
  const failure = (code: Extract<ScreenVisionResult, { ok: false }>['code'], consumed = false, calls: 0 | 1 | null = 0,
    httpStatus: number | null = null): ScreenVisionResult => Object.freeze({ ok: false, code,
    outcome: calls === null ? 'unknown' : code === 'cancelled' ? 'cancelled' : (calls &&
      (['timeout','stale','session-expired'].includes(code) || (code === 'unavailable' && httpStatus === null)) ? 'unknown' : 'failed'),
    evidence: Object.freeze({ transport: 'closed-fake', attemptConsumed: consumed, fakeDispatches: calls, httpStatus }) });
  return Object.freeze({
    async run(wire: ScreenVisionWireRequest, signal?: AbortSignal): Promise<ScreenVisionResult> {
      if (arguments.length > 2 || (signal !== undefined && !(signal instanceof AbortSignal)) || disposed)
        return failure('authorization', screenVisionBridgeAttemptConsumed(wire));
      if (active) return failure('busy', screenVisionBridgeAttemptConsumed(wire));
      const controller = new AbortController(), abort = (): void => controller.abort();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener('abort', abort, { once: true }); active = controller;
      const admitted = claimScreenVisionBridgeAttempt(wire, controller.signal);
      if (!admitted.ok) { active = undefined; signal?.removeEventListener('abort', abort); return failure(admitted.code, admitted.consumed); }
      const { lease } = admitted;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const current = readScreenVisionBridgeLease(lease); if (!current) return failure('authorization', true);
        timeout = setTimeout(abort, Math.max(0, current.scope.previewExpiresAt - Date.now()));
        if (attempt) {
          try { await commitOfflineVisionAttempt(attempt, controller.signal); }
          catch { return failure('unavailable', true); } // no dummy load until OS flush + readback ACK.
        }
        const execute = async (): Promise<ScreenVisionResult> => {
        // Cancellation between admission and HTTP preparation prevents dummy load too.
        await Promise.resolve();
        if (controller.signal.aborted) return failure('cancelled', true);
        const reply = await executeOfflineScreenVisionExchange(lease, transport, dummy, controller.signal);
        if (Date.now() >= current.scope.previewExpiresAt) return failure('session-expired', true, reply.invocations, reply.httpStatus);
        if (controller.signal.aborted) return failure('cancelled', true, reply.invocations, reply.httpStatus);
        if (disposed || !readScreenVisionBridgeLease(lease, 'response')) return failure('cancelled', true, reply.invocations, reply.httpStatus);
        if (!reply.result.ok) return failure(reply.result.code, true, reply.invocations, reply.httpStatus);
        if (reply.result.kind !== 'offline-http-test-response') return failure('unavailable', true, reply.invocations);
        return Object.freeze({ ok: true, kind: 'simulated-qwen-response', text: `Simulated Qwen response — no external AI request was made. ${reply.result.text}`,
          evidence: Object.freeze({ transport: 'closed-fake', attemptConsumed: true, fakeDispatches: reply.invocations, httpStatus: reply.httpStatus }) });
        };
        let result: ScreenVisionResult;
        try { result = await execute(); } catch { result = failure('unavailable', true, null); }
        if (attempt) {
          const terminal = result.ok ? 'COMPLETED' : result.outcome === 'failed' || result.evidence.fakeDispatches === 0 ? 'FAILED' : 'UNKNOWN';
          if (!await finishOfflineVisionAttempt(attempt, terminal))
            return Object.freeze({ ...failure('unavailable', true, result.evidence.fakeDispatches, result.evidence.httpStatus), outcome: 'unknown' });
        }
        if (result.ok && (controller.signal.aborted || disposed || !readScreenVisionBridgeLease(lease, 'response')))
          return failure('cancelled', true, result.evidence.fakeDispatches, result.evidence.httpStatus);
        return result;
      } catch { return failure('unavailable', true, null); }
      finally {
        if (attempt) await closeOfflineVisionAttempt(attempt);
        if (timeout) clearTimeout(timeout); controller.abort(); signal?.removeEventListener('abort', abort);
        releaseScreenVisionBridgeLease(lease); if (active === controller) active = undefined;
      }
    },
    cancel(): void { active?.abort(); },
    dispose(): void { disposed = true; active?.abort(); },
  });
}
