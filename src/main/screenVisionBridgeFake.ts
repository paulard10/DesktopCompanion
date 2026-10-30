/** Closed offline collaborators. No vault, settings, native fetch or caller callbacks. */
import { exchangeVisionMock, isVisionMock, type OfflineVisionMock } from './qwenVisionMock.js';
import type { BuiltVisionRequest } from './qwenVisionAdapter.js';

const DUMMY = 'DUMMY-SCREEN-VISION-BRIDGE-ONLY';
export interface VisionBridgeDummy { readonly purpose: 'offline-bridge-dummy' }
const dummies = new WeakMap<VisionBridgeDummy, { mode: 'available' | 'missing' | 'pending'; delay: number; loads: number }>();
export function createVisionBridgeDummy(options: { mode?: 'available' | 'missing' | 'pending'; delayMs?: number } = {}): VisionBridgeDummy {
  if (!options || Object.keys(options).some(k => !['mode','delayMs'].includes(k)) ||
      !['available','missing','pending'].includes(options.mode ?? 'available') ||
      !Number.isSafeInteger(options.delayMs ?? 0) || (options.delayMs ?? 0) < 0 || (options.delayMs ?? 0) > 60000)
    throw new Error('Only closed dummy credential scenarios are accepted.');
  const handle = Object.freeze({ purpose: 'offline-bridge-dummy' as const });
  dummies.set(handle, { mode: options.mode ?? 'available', delay: options.delayMs ?? 0, loads: 0 }); return handle;
}
export const isVisionBridgeDummy = (v: unknown): v is VisionBridgeDummy => typeof v === 'object' && v !== null && dummies.has(v as VisionBridgeDummy);
export function visionBridgeDummyStats(handle: VisionBridgeDummy): { loads: number } {
  const state = dummies.get(handle); if (!state) throw new Error('Unknown dummy.'); return { loads: state.loads };
}
export function loadVisionBridgeDummy(handle: VisionBridgeDummy, signal: AbortSignal): Promise<string | null> {
  const s = dummies.get(handle); if (!s || signal.aborted) return Promise.resolve(null);
  s.loads++;
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (value: string | null): void => { if (timer) clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(value); };
    const abort = (): void => done(null); signal.addEventListener('abort', abort, { once: true });
    if (s.mode === 'pending') return;
    if (s.delay) timer = setTimeout(() => done(s.mode === 'available' ? DUMMY : null), s.delay);
    else done(s.mode === 'available' ? DUMMY : null);
  });
}
/** The existing HTTP routine receives a fetch-shaped CLOSED script, never native fetch. */
export function createVisionBridgeHttpMock(handle: OfflineVisionMock, requestId: string, expected: BuiltVisionRequest): typeof fetch {
  if (!isVisionMock(handle)) throw new Error('Registered fake transport required.');
  return (async (url: unknown, init?: RequestInit) => {
    if (url !== expected.url || init?.method !== 'POST' || init.body !== JSON.stringify(expected.body) ||
        new Headers(init.headers).get('Authorization') !== `Bearer ${DUMMY}` || init.redirect !== 'error' ||
        init.credentials !== 'omit' || !init.signal) throw new Error('Fake request contract mismatch.');
    const reply = await exchangeVisionMock(handle, requestId, init.signal);
    if ('failure' in reply || reply.requestId !== requestId) throw new Error('Unknown fake outcome.');
    const response = new Response(reply.body, { status: reply.status, headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, 'url', { value: expected.url }); return response;
  }) as typeof fetch;
}
