/** Development-only synthetic-pilot evidence. Never imported by application/UI code. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LiveVisionResult, VisionPilotDiagnostics } from './qwenVisionTransport.js';

export const RECEIPT_DIRECTORY = path.resolve(__dirname, '../../.local-vision-diagnostics');
export const RECEIPT_BYTES = 16_384;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const PILOT_STATES = ['NOT_STARTED','PREFLIGHT_PASSED','AUTHORIZATION_CONSUMED','TRANSPORT_INVOKED',
  'HTTP_RESPONSE_RECEIVED','RESPONSE_PARSED','RESULT_RECORDED'] as const;
type State = typeof PILOT_STATES[number];
export type PilotTerminal = 'BLOCKED' | 'FAILED_BEFORE_TRANSPORT' | 'ATTEMPTED_OUTCOME_UNKNOWN'
  | 'HTTP_ERROR' | 'SUCCEEDED' | 'CANCELLED_AFTER_ATTEMPT';
const TERMINALS: PilotTerminal[] = ['BLOCKED','FAILED_BEFORE_TRANSPORT','ATTEMPTED_OUTCOME_UNKNOWN','HTTP_ERROR','SUCCEEDED','CANCELLED_AFTER_ATTEMPT'];
const ERRORS = ['disabled','production','authorization','expired','duplicate','missing-key','invalid-endpoint','invalid-image',
  'invalid-question','unsupported-model','invalid-request','tls-policy','tls','timeout','cancelled','unavailable','forbidden',
  'redirect','response-too-large','invalid-usage','malformed','empty','refused','authentication','rate-limit','quota','invalid','collector','receipt'];
export interface PilotReceipt {
  version: 1; testId: string; domain: 'live' | 'offline-http-test';
  pilotId: 'synthetic-384x256-8275b81d'; expectedModel: 'qwen3.7-plus'; endpointId: 'singapore-workspace-chat-completions';
  authorizationConsumed: boolean; scopeSha256: string | null; transportInvocations: 0 | 1;
  state: State; states: State[]; httpStatus: number | null; providerRequestId: string | null;
  inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; reasoningTokens: number | null;
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call' | null;
  elapsedMs: number | null; errorCategory: string | null; answer: string | null;
  returnedModel?: string | null; postDurationMs?: number | null;
  providerErrorCode?: string | null; providerErrorCategory?: 'thinking-setting' | 'completion-limit' | 'other' | null;
  terminal: PilotTerminal | null; complete: boolean;
}
export interface PilotEvidence {
  preflight(): void;
  consume(id: string, scopeSha256: string): void;
  invoke<T>(dispatch: () => T): T;
  response(diagnostics: VisionPilotDiagnostics): void;
  parsed(): void;
}
const fail = (): never => { throw new Error('Invalid pilot receipt.'); };
const OPTIONAL_FIELDS = ['returnedModel','postDurationMs','providerErrorCode','providerErrorCategory'];
const safeLabel = (value: unknown): boolean => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) && !/^(?:sk-|Bearer)/i.test(value);
function directory(): void {
  fs.mkdirSync(RECEIPT_DIRECTORY, { recursive: true });
  if (!fs.lstatSync(RECEIPT_DIRECTORY).isDirectory() || fs.lstatSync(RECEIPT_DIRECTORY).isSymbolicLink() ||
      fs.realpathSync(RECEIPT_DIRECTORY) !== RECEIPT_DIRECTORY) fail();
}
function location(id: string, extension = '.json'): string {
  if (!UUID.test(id)) fail(); return path.join(RECEIPT_DIRECTORY, id + extension);
}
const count = (v: unknown): number | null => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 10_000_000 ? v as number : null;
const safeText = (v: unknown): v is string => typeof v === 'string' && v.length <= 1600 &&
  Buffer.from(v,'utf8').toString('utf8') === v &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v) && !/data:image|base64|Bearer|Authorization|\bsk-[\w-]+/i.test(v);
function validate(r: PilotReceipt): void {
  if (!r || r.version !== 1 || !UUID.test(r.testId) || !['live','offline-http-test'].includes(r.domain) ||
      r.pilotId !== 'synthetic-384x256-8275b81d' || r.expectedModel !== 'qwen3.7-plus' || r.endpointId !== 'singapore-workspace-chat-completions' ||
      typeof r.authorizationConsumed !== 'boolean' || ![0,1].includes(r.transportInvocations) ||
      !Array.isArray(r.states) || r.states.length < 1 || r.states.length > 7 || r.states[0] !== 'NOT_STARTED' ||
      r.states.at(-1) !== r.state || r.states.some((s,i) => !PILOT_STATES.includes(s) || (i > 0 && PILOT_STATES.indexOf(s) <= PILOT_STATES.indexOf(r.states[i-1]!))) ||
      r.authorizationConsumed !== r.states.includes('AUTHORIZATION_CONSUMED') ||
      (r.transportInvocations === 1) !== r.states.includes('TRANSPORT_INVOKED') ||
      (r.transportInvocations === 1 && !r.authorizationConsumed) ||
      (r.authorizationConsumed && !r.states.includes('PREFLIGHT_PASSED')) ||
      (r.states.includes('HTTP_RESPONSE_RECEIVED') && r.transportInvocations !== 1) ||
      (r.scopeSha256 !== null && !/^[a-f0-9]{64}$/.test(r.scopeSha256)) ||
      (r.authorizationConsumed && r.scopeSha256 === null) ||
      (r.httpStatus !== null && (!Number.isInteger(r.httpStatus) || r.httpStatus < 100 || r.httpStatus > 599 || !r.states.includes('HTTP_RESPONSE_RECEIVED'))) ||
      (r.providerRequestId !== null && !/^(?:chatcmpl-)?[a-f0-9-]{8,80}$/i.test(r.providerRequestId)) ||
      [r.inputTokens,r.outputTokens,r.totalTokens,r.reasoningTokens].some(v=>v !== null && count(v) === null) ||
      (r.finishReason !== null && !['stop','length','content_filter','tool_calls','function_call'].includes(r.finishReason)) ||
      (r.elapsedMs !== null && (!Number.isFinite(r.elapsedMs) || r.elapsedMs < 0 || r.elapsedMs > 120_000)) ||
      (r.errorCategory !== null && !ERRORS.includes(r.errorCategory)) || (r.answer !== null && !safeText(r.answer)) ||
      [r.returnedModel,r.providerErrorCode].some(v=>v !== undefined && v !== null && !safeLabel(v)) ||
      (r.postDurationMs !== undefined && r.postDurationMs !== null && (!Number.isFinite(r.postDurationMs) || r.postDurationMs < 0 || r.postDurationMs > 120_000)) ||
      (r.providerErrorCategory !== undefined && r.providerErrorCategory !== null && !['thinking-setting','completion-limit','other'].includes(r.providerErrorCategory)) ||
      (r.terminal !== null && !TERMINALS.includes(r.terminal)) || typeof r.complete !== 'boolean' ||
      (r.complete !== (r.state === 'RESULT_RECORDED' && r.terminal !== null)) ||
      (!r.complete && r.terminal !== null) ||
      (r.terminal === 'HTTP_ERROR' && (r.httpStatus === null || r.httpStatus < 400)) ||
      (r.terminal === 'FAILED_BEFORE_TRANSPORT' && r.transportInvocations !== 0) ||
      (r.terminal === 'BLOCKED' && (r.authorizationConsumed || r.transportInvocations !== 0)) ||
      (r.terminal === 'CANCELLED_AFTER_ATTEMPT' && r.transportInvocations !== 1) ||
      (r.terminal === 'SUCCEEDED' && (!r.states.includes('RESPONSE_PARSED') || !r.answer?.trim() || r.httpStatus === null || r.httpStatus < 200 || r.httpStatus >= 300)) ||
      (r.states.includes('RESPONSE_PARSED') && !r.states.includes('HTTP_RESPONSE_RECEIVED'))) fail();
}
function atomic(r: PilotReceipt): void {
  validate(r); const text = JSON.stringify(r);
  if (Buffer.byteLength(text) > RECEIPT_BYTES) fail();
  const temporary = location(r.testId, '.' + randomUUID() + '.tmp');
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, text); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, location(r.testId)); // Same directory; old complete snapshot survives a failed replace.
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export function readPilotReceipt(id: string): { status: 'valid'; receipt: PilotReceipt } | { status: 'missing' | 'corrupt' } {
  try {
    if (fs.lstatSync(RECEIPT_DIRECTORY).isSymbolicLink() || fs.realpathSync(RECEIPT_DIRECTORY) !== RECEIPT_DIRECTORY) return { status: 'corrupt' };
    const file = location(id), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > RECEIPT_BYTES) return { status: 'corrupt' };
    const r = JSON.parse(fs.readFileSync(file, 'utf8')) as PilotReceipt;
    validate(r); if (r.testId !== id) return { status: 'corrupt' };
    // Reject extra fields: diagnostics can never turn into a general-purpose log.
    const required = Object.keys(blank(id,r.domain)).filter(k=>!OPTIONAL_FIELDS.includes(k));
    if (required.some(k=>!Object.hasOwn(r,k)) || Object.keys(r).some(k=>!required.includes(k)&&!OPTIONAL_FIELDS.includes(k))) return { status: 'corrupt' };
    return { status: 'valid', receipt: r };
  } catch (e) { return { status: (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : 'corrupt' }; }
}
function blank(id: string, domain: PilotReceipt['domain']): PilotReceipt {
  return { version: 1, testId: id, domain, pilotId: 'synthetic-384x256-8275b81d', expectedModel: 'qwen3.7-plus',
    endpointId: 'singapore-workspace-chat-completions', authorizationConsumed: false, scopeSha256: null, transportInvocations: 0,
    state: 'NOT_STARTED', states: ['NOT_STARTED'], httpStatus: null, providerRequestId: null, inputTokens: null, outputTokens: null,
    totalTokens: null, reasoningTokens: null, finishReason: null, elapsedMs: null, errorCategory: null, answer: null, terminal: null, complete: false,
    returnedModel: null, postDurationMs: null, providerErrorCode: null, providerErrorCategory: null };
}
function claim(file: string): void {
  const fd = fs.openSync(file,'wx',0o600);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function createPilotReceipt(domain: PilotReceipt['domain'], testId = randomUUID()) {
  directory(); location(testId);
  // Creation is exclusive; an existing test ID never starts another child/run.
  claim(location(testId, '.run'));
  const r = blank(testId, domain); atomic(r);
  function advance(state: State): void {
    if (r.complete || PILOT_STATES.indexOf(state) <= PILOT_STATES.indexOf(r.state)) fail();
    r.state = state; r.states.push(state); atomic(r);
  }
  return {
    testId,
    bindScope(scope: string): void {
      if (r.state !== 'NOT_STARTED' || r.scopeSha256 !== null || !/^[a-f0-9]{64}$/.test(scope)) fail();
      r.scopeSha256 = scope; atomic(r); // Expected fingerprint before authorization, not permission.
    },
    preflight(): void { if (r.state === 'NOT_STARTED') advance('PREFLIGHT_PASSED'); },
    consume(id: string, scope: string): void {
      if (r.state !== 'PREFLIGHT_PASSED' || !UUID.test(id) || !/^[a-f0-9]{64}$/.test(scope) || (r.scopeSha256 !== null && r.scopeSha256 !== scope)) fail();
      // Exclusive durable claim across processes. Never a reusable authorization token.
      claim(location(id, '.consumed'));
      r.authorizationConsumed = true; r.scopeSha256 = scope; advance('AUTHORIZATION_CONSUMED');
    },
    invoke<T>(dispatch: () => T): T {
      if (r.state !== 'AUTHORIZATION_CONSUMED' || r.transportInvocations !== 0) fail();
      let pending: T | undefined;
      try { pending = dispatch(); return pending; }
      finally {
        // Only after actually calling dispatch, including a synchronous throw.
        r.transportInvocations = 1;
        try { advance('TRANSPORT_INVOKED'); }
        catch { void Promise.resolve(pending).catch(()=>{}); throw new Error('Pilot receipt persistence failed.'); }
      }
    },
    response(d: VisionPilotDiagnostics): void {
      if (r.state !== 'TRANSPORT_INVOKED' || d.httpStatus === null) fail();
      r.httpStatus = d.httpStatus;
      r.providerRequestId = d.providerRequestId && /^(?:chatcmpl-)?[a-f0-9-]{8,80}$/i.test(d.providerRequestId) ? d.providerRequestId : null;
      advance('HTTP_RESPONSE_RECEIVED');
    },
    parsed(): void { if (r.state !== 'HTTP_RESPONSE_RECEIVED') fail(); advance('RESPONSE_PARSED'); },
    finish(result: LiveVisionResult, d: VisionPilotDiagnostics): void {
      if (r.complete) fail();
      r.providerRequestId ??= d.providerRequestId && /^(?:chatcmpl-)?[a-f0-9-]{8,80}$/i.test(d.providerRequestId) ? d.providerRequestId : null;
      r.inputTokens = count(d.usage?.promptTokens); r.outputTokens = count(d.usage?.completionTokens); r.totalTokens = count(d.usage?.totalTokens);
      r.reasoningTokens = count(d.reasoningTokens); r.finishReason = d.finishReason as PilotReceipt['finishReason'];
      r.elapsedMs = typeof d.totalDurationMs === 'number' ? Math.min(120_000, Math.max(0, d.totalDurationMs)) : null;
      r.returnedModel = safeLabel(d.returnedModel) ? d.returnedModel : null;
      r.providerErrorCode = safeLabel(d.providerErrorCode) ? d.providerErrorCode : null;
      r.providerErrorCategory = d.providerErrorCategory;
      r.postDurationMs = typeof d.postDurationMs === 'number' ? Math.min(120_000,Math.max(0,d.postDurationMs)) : null;
      r.errorCategory = result.ok ? null : ERRORS.includes(result.code) ? result.code : 'collector';
      r.answer = safeText(d.responseText) ? d.responseText : null;
      if (result.ok && r.state === 'RESPONSE_PARSED' && r.answer?.trim()) r.terminal = 'SUCCEEDED';
      else if (r.transportInvocations === 0) r.terminal = r.authorizationConsumed ? 'FAILED_BEFORE_TRANSPORT' : 'BLOCKED';
      else if (!result.ok && result.code === 'cancelled') r.terminal = 'CANCELLED_AFTER_ATTEMPT';
      else if (r.httpStatus !== null && r.httpStatus >= 400) r.terminal = 'HTTP_ERROR';
      else r.terminal = 'ATTEMPTED_OUTCOME_UNKNOWN';
      r.complete = true; advanceFinal();
    },
  };
  function advanceFinal(): void { r.state = 'RESULT_RECORDED'; r.states.push('RESULT_RECORDED'); atomic(r); }
}
