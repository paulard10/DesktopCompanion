import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ledger = require('../../dist/main/screenVisionAttempt.js');
const runFile = promisify(execFile), worker = path.resolve('scripts/vision-attempt-offline-worker.mjs');
const restore: (() => void)[] = []; let network = 0;
for (const [object, key] of [[globalThis, 'fetch'], [require('node:http'), 'request'], [require('node:https'), 'request'],
  [require('node:net').Socket.prototype, 'connect'], [require('node:tls'), 'connect']] as any[]) {
  const original = object[key]; object[key] = () => { network++; throw Error('No network'); }; restore.push(() => object[key] = original);
}
after(() => { for (const r of restore.reverse()) r(); assert.equal(network, 0); });
async function temporary(t: any) {
  const root = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(root, 'companion-vision-attempt-'));
  t.after(async () => { const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), root); assert.ok(path.basename(resolved).startsWith('companion-vision-attempt-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });
  return directory;
}
async function probe(mode: string, directory: string) {
  try { const r = await runFile(process.execPath, [worker, mode, directory], { windowsHide: true, timeout: 12000, maxBuffer: 8192 });
    return { exit: 0, result: JSON.parse(r.stdout.trim()) }; }
  catch (e: any) { if (e.killed || e.signal || ![71, 72].includes(e.code)) throw e; return { exit: e.code, result: null }; }
}
const metadata = async (directory: string) => (await fs.readFile(path.join(directory, 'attempt.jsonl'), 'utf8'));
test('ledger admits exclusive fixed metadata only after flush/readback and never reuses an attempt', async t => {
  const directory = await temporary(t), handle = await ledger.createOfflineVisionAttempt({ directory });
  assert.deepEqual(await ledger.readOfflineVisionAttempt(directory), { state: 'NOT_STARTED', consumed: false, attemptId: null });
  await ledger.commitOfflineVisionAttempt(handle, new AbortController().signal);
  assert.equal((await ledger.readOfflineVisionAttempt(directory)).state, 'UNKNOWN');
  await assert.rejects(ledger.commitOfflineVisionAttempt(handle, new AbortController().signal));
  assert.equal(await ledger.finishOfflineVisionAttempt(handle, 'COMPLETED'), true);
  assert.equal((await ledger.readOfflineVisionAttempt(directory)).state, 'COMPLETED');
  const text = await metadata(directory), rows = text.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2); assert.equal(text.length < 1024, true);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['at','attemptId','domain','state','version']);
  assert.doesNotMatch(text, /image|question|Bearer|credential|base64|path|hash|fingerprint|Synthetic|What is shown/i);
  const reopen = await ledger.createOfflineVisionAttempt({ directory });
  await assert.rejects(ledger.commitOfflineVisionAttempt(reopen, new AbortController().signal));
  assert.equal(await metadata(directory), text);
});
test('two independent handles race atomically for one filesystem claim', async t => {
  const directory = await temporary(t), one = await ledger.createOfflineVisionAttempt({ directory }), two = await ledger.createOfflineVisionAttempt({ directory });
  const r = await Promise.allSettled([one, two].map(h => ledger.commitOfflineVisionAttempt(h, new AbortController().signal)));
  assert.equal(r.filter(v => v.status === 'fulfilled').length, 1);
  for (const h of [one, two]) await ledger.closeOfflineVisionAttempt(h);
  assert.equal((await ledger.readOfflineVisionAttempt(directory)).state, 'UNKNOWN');
});
for (const fault of ['write-failure','partial-write','flush-failure']) test(`unconfirmed ${fault} leaves a blocking tombstone, not permission`, async t => {
  const directory = await temporary(t), h = await ledger.createOfflineVisionAttempt({ directory, fault });
  await assert.rejects(ledger.commitOfflineVisionAttempt(h, new AbortController().signal));
  assert.equal((await ledger.readOfflineVisionAttempt(directory)).state, 'UNKNOWN');
  const other = await ledger.createOfflineVisionAttempt({ directory });
  await assert.rejects(ledger.commitOfflineVisionAttempt(other, new AbortController().signal));
});
for (const text of ['', '{', '{}\n', 'x'.repeat(1025)]) test(`corrupt/empty/oversized record (${text.length}) recovers fail-closed`, async t => {
  const directory = await temporary(t); await fs.writeFile(path.join(directory, 'attempt.jsonl'), text);
  const r = await ledger.readOfflineVisionAttempt(directory); assert.equal(r.state, 'UNKNOWN'); assert.equal(r.consumed, true);
  const h = await ledger.createOfflineVisionAttempt({ directory }); await assert.rejects(ledger.commitOfflineVisionAttempt(h, new AbortController().signal));
});
test('ledger rejects profiles outside its disposable root and arbitrary collaborators', async t => {
  await assert.rejects(ledger.createOfflineVisionAttempt({ directory: process.cwd() }));
  const directory = await temporary(t);
  await assert.rejects(ledger.createOfflineVisionAttempt({ directory, write: () => {} }));
  assert.equal(ledger.isOfflineVisionAttempt({ purpose: 'offline-vision-attempt' }), false);
});
for (const mode of ['success','http-400','http-401','http-429','http-500','malformed','empty','unknown','missing-dummy','terminal'])
  test(`complete fake flow ${mode}: admission before lookup, no retry, minimal durable state`, async t => {
    const directory = await temporary(t), r = await probe(mode, directory), v = r.result;
    assert.equal(r.exit, 0); assert.equal(v.network, 0); assert.equal(v.privateAccess, 0); assert.equal(v.committed, true);
    assert.equal(v.loads, 1); assert.equal(v.calls, mode === 'missing-dummy' ? 0 : 1); assert.equal(v.replay, 'duplicate');
    if (mode === 'success') { assert.equal(v.ok, true); assert.equal(v.simulated, true); assert.equal(v.after, 'COMPLETED'); }
    else { assert.equal(v.ok, false); assert.equal(v.after, ['unknown','terminal'].includes(mode) ? 'UNKNOWN' : 'FAILED'); }
    if (mode === 'terminal') { assert.equal(v.outcome, 'unknown'); assert.equal(v.publishedResult, false); }
    const text = await metadata(directory); assert.doesNotMatch(text, /image|question|Bearer|base64|credential|hash|fingerprint|What is shown/i);
  });
for (const mode of ['write','partial','flush']) test(`Q/R: ${mode} failure blocks dummy lookup and fake dispatch in complete flow`, async t => {
  const directory = await temporary(t), r = (await probe(mode, directory)).result;
  assert.equal(r.ok, false); assert.equal(r.committed, false); assert.equal(r.loads, 0); assert.equal(r.calls, 0);
  assert.equal(r.after, 'UNKNOWN'); assert.equal(r.replay, 'duplicate');
});
for (const mode of ['no-capability','missing-a','tamper','cancel-before']) test(`A/B/N: ${mode} cannot enter durable/provider boundary`, async t => {
  const directory = await temporary(t), r = (await probe(mode, directory)).result;
  assert.equal(r.ok, false); assert.equal(r.loads, 0); assert.equal(r.calls, 0); assert.equal(r.after, 'NOT_STARTED');
});
test('O: cancel after fake dispatch stays consumed/UNKNOWN, no stale preview result', async t => {
  const directory = await temporary(t), r = (await probe('cancel-after', directory)).result;
  assert.equal(r.calls, 1); assert.equal(r.ok, false); assert.equal(r.after, 'UNKNOWN'); assert.equal(r.publishedResult, false);
});
test('AL: discard during terminal flush suppresses success even after fake response verification', async t => {
  const directory = await temporary(t), r = (await probe('discard-during-terminal', directory)).result;
  assert.equal(r.calls, 1); assert.equal(r.ok, false); assert.equal(r.after, 'COMPLETED'); assert.equal(r.publishedResult, false);
});
test('credential context mismatch rejects acquisition after ledger admission, without reading a real profile', async t => {
  const directory = await temporary(t), r = (await probe('wrong-context', directory)).result;
  assert.equal(r.committed, true); assert.equal(r.loads, 0); assert.equal(r.calls, 0); assert.equal(r.ok, false); assert.equal(r.after, 'FAILED');
});
for (const [mode, exit] of [['after-commit',71],['during-fake',72]] as const) test(`S/T/U/V/W: process exit ${mode} cannot resume/replay after restart`, async t => {
  const directory = await temporary(t), crashed = await probe(mode, directory); assert.equal(crashed.exit, exit);
  assert.equal((await ledger.readOfflineVisionAttempt(directory)).state, 'UNKNOWN'); const before = await metadata(directory);
  const restarted = (await probe('restart', directory)).result;
  assert.equal(restarted.before, 'UNKNOWN'); assert.equal(restarted.after, 'UNKNOWN'); assert.equal(restarted.ok, false);
  assert.equal(restarted.loads, 0); assert.equal(restarted.calls, 0); assert.equal(restarted.replay, 'duplicate');
  assert.equal(await metadata(directory), before);
});
test('M/W: competing process lifetimes produce at most one fake dispatch', async t => {
  const directory = await temporary(t), r = await Promise.all([probe('success', directory), probe('success', directory)]);
  assert.equal(r.reduce((n, v) => n + v.result.calls, 0), 1); assert.equal(r.filter(v => v.result.ok).length, 1);
});
test('X: completed attempt is not permission; a new isolated session needs new A/B and identifier', async t => {
  const first = await temporary(t), second = await temporary(t), a = (await probe('success', first)).result;
  const oldReplay = (await probe('restart', first)).result; assert.equal(oldReplay.ok, false); assert.equal(oldReplay.calls, 0);
  const b = (await probe('success', second)).result; assert.equal(a.ok, true); assert.equal(b.ok, true);
  const oldId = (await ledger.readOfflineVisionAttempt(first)).attemptId, newId = (await ledger.readOfflineVisionAttempt(second)).attemptId;
  assert.notEqual(oldId, newId);
});
