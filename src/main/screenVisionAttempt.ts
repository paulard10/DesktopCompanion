/** Isolated OFFLINE attempt tombstones. Never a native grant or screen receipt. */
import fs, { type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exactKeys } from './visionImage.js';

export interface OfflineVisionAttempt { readonly purpose: 'offline-vision-attempt' }
type Fault = 'none' | 'write-failure' | 'partial-write' | 'flush-failure' | 'terminal-failure';
type Terminal = 'COMPLETED' | 'FAILED' | 'UNKNOWN';
type Entry = { version: 1; domain: 'offline-vision'; attemptId: string; state: 'DISPATCH_COMMITTED' | Terminal; at: number };
const states = new WeakMap<OfflineVisionAttempt, { directory: string; id: string; fault: Fault;
  used: boolean; committed: boolean; fd?: FileHandle; first?: string }>();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FILE = 'attempt.jsonl', MAX_BYTES = 1024;
async function root(directory: string): Promise<string> {
  const resolved = path.resolve(directory), temporary = await fs.realpath(os.tmpdir());
  if (!path.isAbsolute(directory) || !resolved.startsWith(temporary + path.sep) ||
      !path.basename(resolved).startsWith('companion-vision-attempt-')) throw new Error('Isolated offline TEMP directory required.');
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(resolved) !== resolved)
    throw new Error('Invalid offline attempt directory.');
  return resolved;
}
export async function createOfflineVisionAttempt(options: { directory: string; fault?: Fault }): Promise<OfflineVisionAttempt> {
  if (!options || !exactKeys(options, Object.hasOwn(options, 'fault') ? ['directory','fault'] : ['directory']) ||
      !['none','write-failure','partial-write','flush-failure','terminal-failure'].includes(options.fault ?? 'none'))
    throw new Error('Closed offline ledger options required.');
  const directory = await root(options.directory), handle = Object.freeze({ purpose: 'offline-vision-attempt' as const });
  states.set(handle, { directory, id: randomUUID(), fault: options.fault ?? 'none', used: false, committed: false });
  return handle;
}
export const isOfflineVisionAttempt = (v: unknown): v is OfflineVisionAttempt => typeof v === 'object' && v !== null && states.has(v as OfflineVisionAttempt);
/** Synchronous local claim, then exclusive filesystem tombstone + OS flush ACK.
 * Process-interruption safety only; physical power-loss durability is NOT asserted. */
export async function commitOfflineVisionAttempt(handle: OfflineVisionAttempt, signal: AbortSignal): Promise<void> {
  const s = states.get(handle);
  if (!s || s.used || signal.aborted) throw new Error('Offline attempt admission denied.');
  s.used = true; // before the first await; never reset, even on write/flush failure.
  try {
    await root(s.directory); if (signal.aborted) throw new Error('Stopped');
    s.fd = await fs.open(path.join(s.directory, FILE), 'wx+', 0o600); // existing/empty/torn record blocks reuse.
    const entry: Entry = { version: 1, domain: 'offline-vision', attemptId: s.id, state: 'DISPATCH_COMMITTED', at: Date.now() };
    s.first = JSON.stringify(entry) + '\n';
    if (s.fault === 'write-failure') throw new Error('Simulated write failure');
    if (s.fault === 'partial-write') { await s.fd.writeFile(s.first.slice(0, 35)); await s.fd.sync(); throw new Error('Simulated interrupted write'); }
    await s.fd.writeFile(s.first);
    if (s.fault === 'flush-failure') throw new Error('Simulated flush failure');
    await s.fd.sync();
    const check = Buffer.alloc(Buffer.byteLength(s.first));
    const read = await s.fd.read(check, 0, check.length, 0);
    if (read.bytesRead !== check.length || check.toString('utf8') !== s.first || signal.aborted) throw new Error('Unconfirmed offline commit');
    s.committed = true;
  } catch { await closeOfflineVisionAttempt(handle); throw new Error('Offline attempt commit not confirmed. No dispatch permitted.'); }
}
export async function finishOfflineVisionAttempt(handle: OfflineVisionAttempt, terminal: Terminal): Promise<boolean> {
  const s = states.get(handle);
  if (!s?.committed || !s.fd || !['COMPLETED','FAILED','UNKNOWN'].includes(terminal)) return false;
  try {
    if (s.fault === 'terminal-failure') throw new Error('Simulated terminal failure');
    const entry: Entry = { version: 1, domain: 'offline-vision', attemptId: s.id, state: terminal, at: Date.now() };
    const line = JSON.stringify(entry) + '\n', expected = s.first! + line;
    // Same open descriptor; no replace/rename and no new grant on terminal failure.
    const written = await s.fd.write(line, Buffer.byteLength(s.first!), 'utf8');
    if (written.bytesWritten !== Buffer.byteLength(line)) return false;
    await s.fd.sync();
    const check = Buffer.alloc(Buffer.byteLength(expected));
    const read = await s.fd.read(check, 0, check.length, 0);
    return read.bytesRead === check.length && check.toString('utf8') === expected;
  } catch { return false; }
  finally { await closeOfflineVisionAttempt(handle); }
}
export async function closeOfflineVisionAttempt(handle: OfflineVisionAttempt): Promise<void> {
  const s = states.get(handle); if (!s) return;
  const fd = s.fd; s.fd = undefined; s.first = undefined;
  if (fd) try { await fd.close(); } catch { /* No retry or tombstone deletion. */ }
}
/** Observation only: absence is NOT consent; any committed/incomplete file is consumed. */
export async function readOfflineVisionAttempt(directory: string): Promise<{ state: 'NOT_STARTED' | Terminal; consumed: boolean; attemptId: string | null }> {
  const unknown = { state: 'UNKNOWN' as const, consumed: true, attemptId: null };
  try {
    const file = path.join(await root(directory), FILE);
    let stat; try { stat = await fs.lstat(file); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'NOT_STARTED', consumed: false, attemptId: null };
      return unknown;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return unknown;
    const fd = await fs.open(file, 'r');
    let text: string;
    try {
      const current = await fd.stat();
      if (current.ino !== stat.ino || current.dev !== stat.dev || current.nlink !== 1) return unknown;
      const bytes = Buffer.alloc(MAX_BYTES + 1), read = await fd.read(bytes, 0, bytes.length, 0);
      if (read.bytesRead > MAX_BYTES) return unknown;
      text = bytes.subarray(0, read.bytesRead).toString('utf8');
    } finally { await fd.close(); }
    if (!text.endsWith('\n')) return unknown;
    const lines = text.trimEnd().split('\n'); if (lines.length < 1 || lines.length > 2) return unknown;
    const entries = lines.map(line => JSON.parse(line) as Entry);
    if (entries.some(e => !e || !exactKeys(e, ['version','domain','attemptId','state','at']) || e.version !== 1 ||
        e.domain !== 'offline-vision' || !UUID.test(e.attemptId) || !Number.isSafeInteger(e.at) || e.at < 0) ||
        entries[0]!.state !== 'DISPATCH_COMMITTED') return unknown;
    const first = entries[0]!, last = entries[1];
    if (last && (last.attemptId !== first.attemptId || last.at < first.at || !['COMPLETED','FAILED','UNKNOWN'].includes(last.state))) return unknown;
    return { state: last ? last.state as Terminal : 'UNKNOWN', consumed: true, attemptId: first.attemptId };
  } catch { return unknown; }
}
