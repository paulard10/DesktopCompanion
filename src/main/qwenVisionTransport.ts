/** Main-only synthetic one-shot HTTPS pilot. No application entry point imports this. */
import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { buildVisionRequest, normalizeVisionReply, VISION_MODEL_ID, type VisionFailure } from './qwenVisionAdapter.js';
import { createVisionPilotFixture, VISION_PILOT_QUESTION } from './visionPilotFixture.js';
import { chatCompletionsUrl } from '../shared/qwenEndpoint.js';
import type { ProviderSettings } from './providerSettings.js';
import type { KeyVault } from '../shared/keyVault.js';
import type { PilotEvidence } from './visionPilotReceipt.js';
import { readScreenVisionBridgeLease, takeScreenVisionSendAdmission, type ScreenVisionBridgeLease, type ScreenVisionSendAdmission } from './screenVisionRequest.js';
import { createVisionBridgeHttpMock, isVisionBridgeDummy, loadVisionBridgeDummy, type VisionBridgeDummy } from './screenVisionBridgeFake.js';
import { isVisionMock, type OfflineVisionMock } from './qwenVisionMock.js';

export const LIVE_VISION_DISABLED = true;
export const LIVE_TEST_FLAG = '--desktop-companion-synthetic-vision-test';
export const LIVE_TEST_LIMITS = Object.freeze({ outputTokens: 160, timeoutMs: 20_000, responseBytes: 64 * 1024, approvalMs: 30_000 });
type Code = VisionFailure | 'disabled' | 'production' | 'authorization' | 'expired' | 'duplicate'
  | 'missing-key' | 'forbidden' | 'redirect' | 'response-too-large' | 'invalid-usage' | 'tls-policy' | 'tls';
export type LiveVisionResult = { ok: false; code: Code; message: string } | {
  ok: true; kind: 'real-provider-response' | 'offline-http-test-response'; text: string; truncated: boolean;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
};
function fail(code: Code): Extract<LiveVisionResult, { ok: false }> {
  return { ok: false, code, message: `Synthetic vision test stopped (${code}). No retry or fallback. A dispatched request may still be processed or billed.` };
}
function gate(): Code | null {
  if (app.isPackaged) return 'production';
  if (process.type !== 'browser' || process.env.DESKTOP_COMPANION_DEV !== '1' || !process.argv.includes(LIVE_TEST_FLAG)) return 'disabled';
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return 'tls-policy';
  return null;
}
export interface VisionTestApproval { readonly scope: 'one-synthetic-vision-request' }
export interface VisionTestReview { id: string; statement: string; expiresAt: number; imageSha256: string;
  question: string; model: string; maxTokens: number; domain: 'live' | 'offline-http-test' }
export interface VisionPilotDiagnostics {
  postAttempts: number; httpStatus: number | null; providerRequestId: string | null;
  returnedModel: string | null; finishReason: string | null; reasoningTokens: number | null;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null;
  providerErrorCode: string | null; providerErrorCategory: 'thinking-setting' | 'completion-limit' | 'other' | null;
  responseBytes: number; totalDurationMs: number | null; postDurationMs: number | null;
  responseText: string | null;
}
const liveBudget = { claimed: false };
const offlineBudgets = new WeakMap<typeof fetch, { claimed: boolean }>();
/** Always race potentially stalled credential/HTTP/body promises against the same absolute timeout. */
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = (): void => { signal.removeEventListener('abort', aborted); reject(new Error('Stopped')); };
    if (signal.aborted) { pending.catch(() => {}); aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    pending.then(value => { signal.removeEventListener('abort', aborted); resolve(value); },
      error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}
export function createSyntheticVisionPilot(options: {
  settings: () => ProviderSettings; vault: Pick<KeyVault, 'load'>; fetchImpl?: typeof fetch; evidence?: PilotEvidence;
}) {
  const offline = options.fetchImpl !== undefined, fetcher = options.fetchImpl ?? globalThis.fetch;
  if (offline && fetcher === globalThis.fetch) throw new Error('Native fetch cannot be labeled an offline test.');
  const domain = offline ? 'offline-http-test' : 'live';
  // Prompt 101 is consumed. No native/live approval can be minted by diagnostics.
  const blocked = (): Code | null => gate() ?? (!offline && LIVE_VISION_DISABLED ? 'disabled' : null);
  let budget = liveBudget;
  if (offline) { budget = offlineBudgets.get(fetcher) ?? { claimed: false }; offlineBudgets.set(fetcher, budget); }
  const approvals = new WeakMap<VisionTestApproval, { id: string; snapshot: string; expiresAt: number; generation: number }>();
  let generation = 0;
  let reviewed: { info: VisionTestReview; snapshot: string } | undefined;
  let active: AbortController | undefined;
  const diagnostics: VisionPilotDiagnostics = { postAttempts: 0, httpStatus: null, providerRequestId: null,
    returnedModel: null, finishReason: null, reasoningTokens: null, usage: null, providerErrorCode: null,
    providerErrorCategory: null, responseBytes: 0, totalDurationMs: null, postDurationMs: null, responseText: null };
  const request = () => {
    const settings = options.settings();
    if (settings.provider !== 'qwen' || !settings.endpoint || !chatCompletionsUrl(settings.endpoint)) return null;
    return buildVisionRequest({ endpoint: settings.endpoint, model: VISION_MODEL_ID,
      question: VISION_PILOT_QUESTION, image: createVisionPilotFixture() }, 'synthetic-live-test');
  };
  const fingerprint = (url: string, body: unknown): string => createHash('sha256').update(url).update('\0').update(JSON.stringify(body)).digest('hex');
  return {
    diagnostics(): VisionPilotDiagnostics { return { ...diagnostics, usage: diagnostics.usage ? { ...diagnostics.usage } : null }; },
    review(): { ok: true; review: VisionTestReview } | Extract<LiveVisionResult, { ok: false }> {
      const denied = blocked(); if (denied) return fail(denied);
      if (budget.claimed) return fail('duplicate');
      try {
        const built = request(); if (!built) return fail('invalid-endpoint'); if (!built.ok) return built;
        const image = createVisionPilotFixture(), id = randomUUID();
        const info: VisionTestReview = { id, statement: `AUTHORIZE ONE ${domain === 'live' ? 'BILLABLE LIVE' : 'OFFLINE FAKE HTTP'} SYNTHETIC VISION REQUEST ${id}; I accept remote-data retention and possible charges`,
          expiresAt: Date.now() + LIVE_TEST_LIMITS.approvalMs, imageSha256: createHash('sha256').update(image.bytes).digest('hex'),
          question: VISION_PILOT_QUESTION, model: VISION_MODEL_ID, maxTokens: LIVE_TEST_LIMITS.outputTokens, domain };
        options.evidence?.preflight();
        generation++; reviewed = { info, snapshot: fingerprint(built.request.url, built.request.body) };
        return { ok: true, review: { ...info } };
      } catch { return fail('invalid-request'); }
    },
    authorize(id: unknown, statement: unknown): VisionTestApproval | null {
      if (blocked() || budget.claimed || !reviewed || id !== reviewed.info.id || statement !== reviewed.info.statement ||
          Date.now() >= reviewed.info.expiresAt) return null;
      const permit: VisionTestApproval = Object.freeze({ scope: 'one-synthetic-vision-request' });
      approvals.set(permit, { id: reviewed.info.id, snapshot: reviewed.snapshot, expiresAt: reviewed.info.expiresAt, generation });
      reviewed = undefined; return permit;
    },
    cancel(): void { generation++; reviewed = undefined; active?.abort(); },
    async run(permit: unknown, signal?: AbortSignal): Promise<LiveVisionResult> {
      const denied = blocked(); if (denied) return fail(denied);
      if (budget.claimed) return fail('duplicate');
      if (!permit || typeof permit !== 'object' || !approvals.has(permit as VisionTestApproval)) return fail('authorization');
      const authorized = approvals.get(permit as VisionTestApproval)!; approvals.delete(permit as VisionTestApproval);
      if (authorized.generation !== generation) return fail('authorization');
      if (Date.now() >= authorized.expiresAt) return fail('expired');
      if (signal?.aborted) return fail('cancelled');
      budget.claimed = true; // One attempt/process (or fake-driver identity), including terminal failures.
      return runQwenVisionExchange({ request, fingerprint, authorized, options, blocked, diagnostics, offline, fetcher, signal,
        setActive(value, expected) { if (!expected || active === expected) active = value; } });
    },
  };
}

/** Isolated FAKE-only adapter. No pilot permit/settings/vault/receipt and no native driver. */
export async function executeOfflineScreenVisionExchange(lease: ScreenVisionBridgeLease, transport: OfflineVisionMock,
  dummy: VisionBridgeDummy, signal: AbortSignal): Promise<{ result: LiveVisionResult; invocations: 0 | 1; httpStatus: number | null }> {
  const stopped = (code: Code) => ({ result: fail(code), invocations: 0 as const, httpStatus: null });
  if (app.isPackaged) return stopped('production');
  if (process.type !== 'browser') return stopped('disabled');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') return stopped('tls-policy');
  if (!isVisionMock(transport) || !isVisionBridgeDummy(dummy)) return stopped('authorization');
  const wire = readScreenVisionBridgeLease(lease); if (!wire) return stopped('authorization');
  const fingerprint = (url: string, body: unknown): string => createHash('sha256').update(url).update('\0').update(JSON.stringify(body)).digest('hex');
  const authorized = { id: wire.scope.requestId, snapshot: fingerprint(wire.request.url, wire.request.body), expiresAt: wire.scope.expiresAt };
  const diagnostics: VisionPilotDiagnostics = { postAttempts: 0, httpStatus: null, providerRequestId: null, returnedModel: null,
    finishReason: null, reasoningTokens: null, usage: null, providerErrorCode: null, providerErrorCategory: null,
    responseBytes: 0, totalDurationMs: null, postDurationMs: null, responseText: null };
  let controller: AbortController | undefined;
  const fetcher = createVisionBridgeHttpMock(transport, wire.scope.requestId, wire.request);
  const result = await runQwenVisionExchange({
    request: () => { const current = readScreenVisionBridgeLease(lease); return current ? { ok: true, request: current.request } : null; },
    fingerprint, authorized, diagnostics, offline: true, fetcher, signal,
    options: { vault: { load: () => loadVisionBridgeDummy(dummy, controller!.signal) } },
    blocked: () => readScreenVisionBridgeLease(lease) ? null : 'authorization',
    setActive(value) { controller = value; },
  });
  diagnostics.responseText = null; // No pilot diagnostic/answer cache for screen content.
  return { result, invocations: diagnostics.postAttempts ? 1 : 0, httpStatus: diagnostics.httpStatus };
}

/**
 * One admitted screen POST. LIVE_VISION_DISABLED still blocks the synthetic pilot.
 * The admission ticket is the only way in: no renderer bytes, URL, key, or body are accepted.
 * The credential is loaded only after that ticket is taken, and only one POST is attempted.
 */
export async function executeAdmittedScreenVisionPost(admission: ScreenVisionSendAdmission, options: {
  vault: Pick<KeyVault, 'load'>; fetchImpl?: typeof fetch;
}, signal?: AbortSignal): Promise<{ result: LiveVisionResult; posted: 0 | 1 }> {
  const stopped = (code: Code): { result: LiveVisionResult; posted: 0 | 1 } => ({ result: fail(code), posted: 0 });
  // Packaged release is allowed. The admission ticket, main process, and TLS policy remain mandatory.
  // LIVE_VISION_DISABLED still blocks the separate synthetic pilot, including when packaged.
  const denied = (): Code | null => process.type !== 'browser' ? 'disabled'
    : process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? 'tls-policy' : null;
  const closed = denied(); if (closed) return stopped(closed);
  const offline = options.fetchImpl !== undefined;
  const fetcher = options.fetchImpl ?? globalThis.fetch;
  if (!options || (offline && fetcher === globalThis.fetch)) return stopped('authorization');
  const wire = takeScreenVisionSendAdmission(admission);
  if (!wire) return stopped('authorization');
  const fingerprint = (url: string, body: unknown): string => createHash('sha256').update(url).update('\0').update(JSON.stringify(body)).digest('hex');
  const diagnostics: VisionPilotDiagnostics = { postAttempts: 0, httpStatus: null, providerRequestId: null, returnedModel: null,
    finishReason: null, reasoningTokens: null, usage: null, providerErrorCode: null, providerErrorCategory: null,
    responseBytes: 0, totalDurationMs: null, postDurationMs: null, responseText: null };
  const result = await runQwenVisionExchange({
    request: () => ({ ok: true, request: wire.request }),
    fingerprint,
    authorized: { id: wire.scope.requestId, snapshot: fingerprint(wire.request.url, wire.request.body), expiresAt: wire.scope.expiresAt },
    options: { vault: options.vault },
    blocked: denied,
    diagnostics, offline, fetcher, signal,
    setActive() { /* The caller's signal owns cancellation. */ },
  });
  const posted: 0 | 1 = diagnostics.postAttempts > 0 ? 1 : 0;
  diagnostics.responseText = null;
  return { result, posted };
}

/** Shared original bounded Qwen execution; only the gated factories in this module call it. */
async function runQwenVisionExchange(context: {
  request: () => ReturnType<typeof buildVisionRequest> | null;
  fingerprint: (url: string, body: unknown) => string;
  authorized: { id: string; snapshot: string; expiresAt: number };
  options: { vault: Pick<KeyVault, 'load'>; evidence?: PilotEvidence };
  blocked: () => Code | null; diagnostics: VisionPilotDiagnostics; offline: boolean; fetcher: typeof fetch;
  signal?: AbortSignal; setActive: (value: AbortController | undefined, expected?: AbortController) => void;
}): Promise<LiveVisionResult> {
  const { request, fingerprint, authorized, options, blocked, diagnostics, offline, fetcher, signal, setActive } = context;
      const started = performance.now(); let postStarted: number | undefined;
      let key: string | null = null, body: string | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let responseBody: ReadableStream<Uint8Array> | null = null;
      const controller = new AbortController(); setActive(controller); let timedOut = false;
      const cancel = (): void => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, LIVE_TEST_LIMITS.timeoutMs);
      try {
        options.evidence?.consume(authorized.id, authorized.snapshot);
        const built = request(); if (!built) return fail('invalid-endpoint'); if (!built.ok) return built;
        if (fingerprint(built.request.url, built.request.body) !== authorized.snapshot) return fail('authorization');
        body = JSON.stringify(built.request.body);
        key = await abortable(Promise.resolve().then(() => options.vault.load()), controller.signal);
        if (typeof key !== 'string' || !/^[A-Za-z0-9_.-]{8,200}$/.test(key)) return fail('missing-key');
        if (controller.signal.aborted) return fail(timedOut ? 'timeout' : 'cancelled');
        if (Date.now() >= authorized.expiresAt) return fail('expired');
        const refreshed = request();
        if (blocked() || !refreshed?.ok || fingerprint(refreshed.request.url, refreshed.request.body) !== authorized.snapshot) return fail('authorization');
        diagnostics.postAttempts++; postStarted = performance.now();
        const dispatch = () => fetcher(built.request.url, { method: 'POST', redirect: 'error', credentials: 'omit',
          cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body });
        const response = await abortable(options.evidence ? options.evidence.invoke(dispatch) : dispatch(), controller.signal);
        body = undefined;
        responseBody = response.body;
        diagnostics.httpStatus = response.status;
        const safeLabel = (value: unknown): string | null => typeof value === 'string' &&
          /^[A-Za-z0-9_.:-]{1,128}$/.test(value) && !value.includes(key!) && !/^(?:sk-|Bearer)/i.test(value) ? value : null;
        diagnostics.providerRequestId = safeLabel(response.headers.get('x-request-id'));
        options.evidence?.response(diagnostics);
        if (response.redirected || (response.status >= 300 && response.status < 400) || response.url !== built.request.url) return fail('redirect');
        if (response.status === 403) return fail('forbidden');
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > LIVE_TEST_LIMITS.responseBytes)) return fail('response-too-large');
        if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) return fail('malformed');
        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true }); let raw = '', bytes = 0;
        while (true) {
          const step = await abortable(reader.read(), controller.signal); if (step.done) break;
          bytes += step.value.byteLength; diagnostics.responseBytes = bytes;
          if (bytes > LIVE_TEST_LIMITS.responseBytes) return fail('response-too-large');
          raw += decoder.decode(step.value, { stream: true });
        }
        raw += decoder.decode();
        // Project only bounded labels/counts; never retain reasoning or raw JSON.
        try {
          const metadata = JSON.parse(raw);
          const number = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000_000 ? value as number : null;
          diagnostics.providerRequestId ??= safeLabel(metadata.request_id) ?? safeLabel(metadata.id);
          diagnostics.returnedModel = safeLabel(metadata.model);
          const finish = metadata.choices?.[0]?.finish_reason;
          diagnostics.finishReason = ['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(finish) ? finish : null;
          if (metadata.usage && typeof metadata.usage === 'object') {
            diagnostics.usage = { promptTokens: number(metadata.usage.prompt_tokens), completionTokens: number(metadata.usage.completion_tokens), totalTokens: number(metadata.usage.total_tokens) };
            diagnostics.reasoningTokens = number(metadata.usage.completion_tokens_details?.reasoning_tokens);
          }
          if (!response.ok) {
            diagnostics.providerErrorCode = safeLabel(metadata.error?.code) ?? safeLabel(metadata.code);
            diagnostics.providerErrorCategory = /enable_thinking/i.test(raw) ? 'thinking-setting'
              : /max_completion_tokens/i.test(raw) ? 'completion-limit' : 'other';
          }
        } catch { /* Missing/malformed metadata stays unknown. */ }
        const result = normalizeVisionReply(response.status, raw); if (!result.ok) return fail(result.code);
        if (result.text.includes(key) || /data:image\/|Bearer\s/i.test(result.text)) return fail('malformed');
        diagnostics.responseText = result.text;
        const parsed = JSON.parse(raw) as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } };
        let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;
        if (parsed.usage !== undefined) {
          const u = parsed.usage;
          if (!u || ![u.prompt_tokens, u.completion_tokens, u.total_tokens].every(n => Number.isSafeInteger(n) && (n as number) >= 0) ||
              (u.prompt_tokens as number) > 1_000_000 || (u.completion_tokens as number) > LIVE_TEST_LIMITS.outputTokens ||
              u.total_tokens !== (u.prompt_tokens as number) + (u.completion_tokens as number)) return fail('invalid-usage');
          usage = { promptTokens: u.prompt_tokens as number, completionTokens: u.completion_tokens as number, totalTokens: u.total_tokens as number };
        }
        options.evidence?.parsed();
        return { ...result, kind: offline ? 'offline-http-test-response' : 'real-provider-response', usage };
      } catch (error) {
        if (controller.signal.aborted) return fail(timedOut ? 'timeout' : 'cancelled');
        const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
        return fail(typeof code === 'string' && /^(CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS_)/.test(code) ? 'tls' : 'unavailable');
      }
      finally {
        diagnostics.totalDurationMs = performance.now() - started;
        if (postStarted !== undefined) diagnostics.postDurationMs = performance.now() - postStarted;
        key = null; body = undefined; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        controller.abort();
        if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
        else if (responseBody) void responseBody.cancel().catch(() => {});
        setActive(undefined, controller);
      }
}
