// Development-only bounded process collector. No network/credential imports.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readPilotReceipt } = require('../dist/main/visionPilotReceipt.js');
export const OUTPUT_BYTES = 8192;
function streamBuffer() {
  let bytes = 0, kept = Buffer.alloc(0), available = true;
  return {
    add(chunk) { const b = Buffer.from(chunk); bytes += b.length; if (kept.length < OUTPUT_BYTES) kept = Buffer.concat([kept, b.subarray(0, OUTPUT_BYTES-kept.length)]); },
    lost() { available = false; kept = Buffer.alloc(0); },
    summary() { return { available, bytes, capturedBytes: kept.length, truncated: bytes > OUTPUT_BYTES }; },
  };
}
/** Save a complete, serializable snapshot BEFORE optional session handling.
 * Raw stdout/errors stay out of artifacts; the independent receipt owns answers. */
export function preserveToolResult(result, save) {
  const output = streamBuffer(); if (typeof result?.output === 'string') output.add(result.output); else output.lost();
  const snapshot = { exitCode: Number.isInteger(result?.exit_code) ? result.exit_code : null,
    sessionId: typeof result?.session_id === 'number' || typeof result?.session_id === 'string' ? result.session_id : null,
    output: output.summary() };
  save(snapshot); return snapshot;
}
export function classifyReceipt(evidence, launchError = false) {
  if (evidence.status !== 'valid') return launchError ? 'FAILED_BEFORE_TRANSPORT' : 'ATTEMPTED_OUTCOME_UNKNOWN';
  const r = evidence.receipt;
  if (r.complete) return r.terminal;
  if (r.authorizationConsumed || r.transportInvocations > 0) return 'ATTEMPTED_OUTCOME_UNKNOWN';
  return 'FAILED_BEFORE_TRANSPORT';
}
/** Await close (stdio drained), not just exit. No retry/fallback/spawn loop. */
export async function collectPilotProcess({ testId, spawnChild, readReceipt = readPilotReceipt, signal, timeoutMs = 30_000 }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Invalid collector timeout.');
  const stdout = streamBuffer(), stderr = streamBuffer();
  let exitCode = null, exitSignal = null, collectorError = null, child, timer;
  let stopped = false, childClosed = false, grace, completeWait = () => {};
  const stop = () => {
    stopped = true; collectorError = 'collector-cancelled';
    try { child?.kill(); } catch { collectorError = 'collector-termination'; }
    grace = setTimeout(completeWait, 1000);
  };
  try {
    if (signal?.aborted) { collectorError = 'collector-cancelled'; stopped = true; }
    else await new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      completeWait = finish;
      try { child = spawnChild(); } catch { collectorError = 'launch'; finish(); return; }
      // EventEmitter errors are sanitized, never serialized with request details.
      for (const [stream, buffer] of [[child.stdout, stdout],[child.stderr, stderr]]) {
        if (!stream) buffer.lost();
        else { stream.on('data', c => buffer.add(c)); stream.once('error', () => { buffer.lost(); collectorError = 'output-unavailable'; }); }
      }
      child.once('error', () => { collectorError = 'launch'; finish(); });
      child.once('close', (code, sig) => { childClosed = true; exitCode = Number.isInteger(code) ? code : null; exitSignal = ['SIGTERM','SIGINT','SIGKILL'].includes(sig) ? sig : null; finish(); });
      signal?.addEventListener('abort', stop, { once: true });
      timer = setTimeout(() => { stop(); if (collectorError === 'collector-cancelled') collectorError = 'collector-timeout'; }, timeoutMs);
    });
  } finally { clearTimeout(timer); clearTimeout(grace); signal?.removeEventListener('abort', stop); }
  let evidence;
  try { evidence = readReceipt(testId); } catch { evidence = { status: 'corrupt' }; collectorError ??= 'receipt-read'; }
  if (evidence.status === 'valid' && evidence.receipt.testId !== testId) { evidence = { status: 'corrupt' }; collectorError ??= 'receipt-mismatch'; }
  if (exitCode !== null && exitCode !== 0) collectorError ??= 'nonzero-exit';
  return { testId, exitCode, exitSignal, collectorError, stopped, childClosed, stdout: stdout.summary(), stderr: stderr.summary(),
    collectionComplete: childClosed && exitCode === 0 && collectorError === null && evidence.status === 'valid' && evidence.receipt.complete,
    evidence, terminal: classifyReceipt(evidence, collectorError === 'launch') };
}
