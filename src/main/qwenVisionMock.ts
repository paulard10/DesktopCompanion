/** Closed scripted transport: no fetch, credentials, sockets, callbacks or URLs. */
export type MockVisionScenario = {
  status: number; body: string; delayMs?: number; replyTo?: string;
} | { failure: 'unavailable' | 'pending'; delayMs?: number };
export interface OfflineVisionMock { readonly mode: 'offline-scripted' }
export type MockVisionReply = { requestId: string; status: number; body: string } | { failure: 'unavailable' | 'cancelled' };
type State = { script: MockVisionScenario[]; calls: number; active: number };
const mocks = new WeakMap<OfflineVisionMock, State>();

export function createVisionMock(script: readonly MockVisionScenario[]): OfflineVisionMock {
  if (!Array.isArray(script) || script.length > 32) throw new Error('Invalid offline script.');
  const copied = script.map(item => {
    if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.delayMs ?? 0) ||
        (item.delayMs ?? 0) < 0 || (item.delayMs ?? 0) > 60_000) throw new Error('Invalid offline script.');
    if ('failure' in item) {
      if (item.failure !== 'unavailable' && item.failure !== 'pending') throw new Error('Invalid offline script.');
      return { failure: item.failure, delayMs: item.delayMs };
    }
    if (!Number.isInteger(item.status) || item.status < 100 || item.status > 599 ||
        typeof item.body !== 'string' || item.body.length > 1024 * 1024 ||
        (item.replyTo !== undefined && (typeof item.replyTo !== 'string' || item.replyTo.length > 64))) {
      throw new Error('Invalid offline script.');
    }
    return { status: item.status, body: item.body, delayMs: item.delayMs, replyTo: item.replyTo };
  });
  const handle: OfflineVisionMock = Object.freeze({ mode: 'offline-scripted' });
  mocks.set(handle, { script: copied, calls: 0, active: 0 });
  return handle;
}
export function isVisionMock(value: unknown): value is OfflineVisionMock {
  return typeof value === 'object' && value !== null && mocks.has(value as OfflineVisionMock);
}
export function visionMockStats(handle: OfflineVisionMock): { calls: number; active: number; remaining: number } {
  const state = mocks.get(handle);
  if (!state) throw new Error('Invalid offline transport.');
  return { calls: state.calls, active: state.active, remaining: state.script.length };
}

/** No request body retained or routed anywhere; only a correlation ID is needed. */
export function exchangeVisionMock(handle: OfflineVisionMock, requestId: string, signal: AbortSignal): Promise<MockVisionReply> {
  const state = mocks.get(handle);
  if (!state) return Promise.resolve({ failure: 'unavailable' });
  if (signal.aborted) return Promise.resolve({ failure: 'cancelled' });
  state.calls++; state.active++;
  let scenario: MockVisionScenario | undefined = state.script.shift() ?? { failure: 'unavailable' };
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const finish = (reply: MockVisionReply): void => {
      if (finished) return; finished = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', aborted); scenario = undefined; state.active--;
      resolve(reply);
    };
    const aborted = (): void => finish({ failure: 'cancelled' });
    signal.addEventListener('abort', aborted, { once: true });
    if (scenario && 'failure' in scenario && scenario.failure === 'pending') return;
    const deliver = (): void => {
      if (!scenario || 'failure' in scenario) finish({ failure: 'unavailable' });
      else finish({ requestId: scenario.replyTo ?? requestId, status: scenario.status, body: scenario.body });
    };
    const delayMs = scenario?.delayMs ?? 0;
    if (delayMs) timer = setTimeout(deliver, delayMs);
    else queueMicrotask(deliver);
  });
}
