import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire, Module } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture as png } from './visionFixtures.test-support.mts';
const require = createRequire(import.meta.url), restores: (() => void)[] = [];
let network = 0, privateAccess = 0;
function patch(o: any, k: string, v: any) { const previous = o[k]; o[k] = v; restores.push(() => o[k] = previous); }
const deny = () => { network++; throw Error('Actual network denied'); };
patch(globalThis, 'fetch', deny); if ('WebSocket' in globalThis) patch(globalThis, 'WebSocket', deny);
for (const n of ['node:http','node:https','node:http2']) for (const k of ['request','get','connect']) if (k in require(n)) patch(require(n), k, deny);
for (const k of ['connect','createConnection']) patch(require('node:net'), k, deny);
patch(require('node:net').Socket.prototype, 'connect', deny); patch(require('node:tls'), 'connect', deny);
const app = { isPackaged: false }, load = (Module as any)._load, oldType = (process as any).type;
patch(Module, '_load', function(this: any, id: string, ...args: any[]) {
  if (/safeCredentialStore|providerSettings|keyVault|visionPilotReceipt/.test(id)) { privateAccess++; throw Error('No actual credentials/settings/receipts'); }
  if (id === 'electron') return { app, get safeStorage() { privateAccess++; throw Error('No native secrets'); },
    get desktopCapturer() { throw Error('No desktop capture'); }, get clipboard() { throw Error('No clipboard'); } };
  return load.call(this, id, ...args);
});
(process as any).type = 'browser';
const { createOfflineVisionSession } = require('../../dist/main/offlineVisionSession.js');
const wiringModule = require('../../dist/main/screenVisionWiring.js');
const request = require('../../dist/main/screenVisionRequest.js');
const { createScreenVisionGateOfflineTest, SCREEN_VISION_NATIVE_GATE_CLOSED } = require('../../dist/main/screenVisionGate.js');
const { createVisionMock, visionMockStats } = require('../../dist/main/qwenVisionMock.js');
const { createVisionBridgeDummy, visionBridgeDummyStats } = require('../../dist/main/screenVisionBridgeFake.js');
const native = require('../../dist/main/qwenVisionTransport.js');
const body = (text = 'Synthetic wiring only. No visual understanding.') => JSON.stringify({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };
after(() => { for (const r of restores.reverse()) r(); (process as any).type = oldType; assert.equal(network, 0); assert.equal(privateAccess, 0); });

function setup(t: any, opts: any = {}) {
  t.mock.timers.enable({ apis: ['Date','setTimeout'] });
  const fake = createVisionMock(opts.script ?? [{ status: 200, body: body(), delayMs: 10 }]);
  const dummy = createVisionBridgeDummy(opts.dummy ?? {});
  const wiring = wiringModule.createPrivilegedVisionWiringOfflineTest({
    scope: opts.oneShot ? 'one-shot-screen-vision-wiring-test' : 'privileged-screen-vision-wiring-test', transport: fake, dummy });
  let wire: any, revision = 0, question = '', scenario = 'success';
  const prepare = request.prepareScreenVisionRemoteConsentTest;
  t.mock.method(request, 'prepareScreenVisionRemoteConsentTest', (...args: any[]) => { const r = prepare(...args); if (r.ok) wire = r.wire; return r; });
  const notices: any[] = [], crop = { ...png(), kind: 'approved-local-crop' };
  const session = createOfflineVisionSession({ sessionId: 'wiring-session', crop, publish: (n: any) => notices.push(n), ...(opts.normal ? {} : { testWiring: wiring }) });
  const send = (a: any) => session.dispatch({ sessionId: 'wiring-session', ...a });
  const edit = (text = '  ¿Qué muestra esta imagen?  ') => { question = text; send({ type: 'edit', question, revision: ++revision, scenario }); };
  const review = (type = 'review-remote-consent-test') => send({ type, question, revision, scenario });
  const confirm = (token = notices.at(-1)?.screenToken, type = 'confirm-remote-consent-test') => send({ type, token, revision });
  const approve = () => opts.oneShot ? wiring.authorizeTestOperation(wire?.scope.requestId) : wiring.authorizeTestOperation();
  const begin = () => { edit(); review(); assert.equal(approve(), true); confirm(); };
  const tick = async (ms = 10) => { await flush(); t.mock.timers.tick(ms); await flush(); };
  t.after(() => { session.dispose(); wiring.dispose(); });
  return { wiring, session, crop, fake, dummy, notices, send, edit, review, confirm, approve, begin, tick,
    wire: () => wire, calls: () => visionMockStats(fake).calls, loads: () => visionBridgeDummyStats(dummy).loads, last: () => notices.at(-1) };
}

test('dedicated remote TEST consent and independent main approval reuse the shared HTTP path once', async t => {
  const f = setup(t); assert.equal(f.wiring.authorizeTestOperation(), false); f.edit(); f.review();
  assert.match(f.last().message, /TEST-ONLY remote-consent/); assert.equal(request.screenVisionRemoteTestPrepared(f.wire()), true);
  assert.equal(f.wire().request.body.model, 'qwen3.7-plus'); assert.equal(f.wire().request.body.max_completion_tokens, 160);
  assert.equal(f.wire().request.body.messages[1].content[0].text, '  ¿Qué muestra esta imagen?  ');
  assert.equal(f.wire().request.body.messages[1].content[1].image_url.url, `data:image/png;base64,${Buffer.from(f.crop.bytes).toString('base64')}`);
  assert.equal(f.calls(), 0); assert.equal(f.loads(), 0); assert.equal(f.wiring.authorizeTestOperation(), true);
  assert.equal(f.wiring.authorizeTestOperation(), false); assert.equal(f.calls(), 0); f.confirm(); await f.tick();
  assert.equal(f.calls(), 1); assert.equal(f.loads(), 1); assert.equal(f.last().phase, 'screen-result');
  assert.match(f.last().answer, /^Simulated Qwen response/); assert.equal(request.screenVisionBridgeAttemptConsumed(f.wire()), true);
});
test('Gate A alone does not acquire credentials or invoke fake transport', async t => {
  const f = setup(t); f.edit(); f.review(); const token = f.last().screenToken; f.confirm(); await f.tick();
  assert.equal(f.last().phase, 'screen-error'); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
  assert.equal(f.wiring.authorizeTestOperation(), false); f.confirm(token); await f.tick(); assert.equal(f.calls(), 0);
});
test('main approval alone cannot start work, and legacy confirmation cannot consume TEST A', async t => {
  const f = setup(t); f.edit(); f.review(); assert.equal(f.wiring.authorizeTestOperation(), true);
  f.confirm(f.last().screenToken, 'confirm-screen-dry-run'); await f.tick(); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
  f.confirm(); await f.tick(); assert.equal(f.calls(), 1);
});
test('ordinary offline consent cannot arm the new wiring; normal sessions reject test-only actions', async t => {
  const f = setup(t); f.edit(); f.review('review-screen-dry-run'); assert.equal(f.wiring.authorizeTestOperation(), false);
  f.confirm(f.last().screenToken, 'confirm-screen-dry-run'); await f.tick(); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
  const notices: any[] = [], normal = createOfflineVisionSession({ sessionId: 'normal', crop: f.crop, publish: (n: any) => notices.push(n) });
  normal.dispatch({ type: 'edit', sessionId: 'normal', question: 'Test', revision: 1, scenario: 'success' });
  normal.dispatch({ type: 'review-remote-consent-test', sessionId: 'normal', question: 'Test', revision: 1, scenario: 'success' });
  normal.dispatch({ type: 'confirm-remote-consent-test', sessionId: 'normal', token: 'forged', revision: 1 });
  assert.equal(notices.at(-1).phase, 'editing'); assert.equal(f.calls(), 0); normal.dispose();
});
test('dedicated test provenance is rejected by the old fake issuer and no fake can enable native HTTPS', async t => {
  const f = setup(t); f.edit(); f.review();
  request.confirmScreenVisionBridgeConsent(f.wire(), () => true);
  const old = createScreenVisionGateOfflineTest({ scope: 'privileged-screen-vision-offline-test', transport: f.fake, dummy: f.dummy });
  assert.equal(old.issue(f.wire()).code, 'authorization'); old.dispose();
  assert.equal(SCREEN_VISION_NATIVE_GATE_CLOSED, true); assert.equal(native.LIVE_VISION_DISABLED, true);
  const pilot = native.createSyntheticVisionPilot({ settings: () => { throw Error('No configuration'); }, vault: { load: () => { throw Error('No vault'); } } });
  assert.equal(pilot.review().code, 'disabled'); assert.equal((await pilot.run(f.wiring)).code, 'disabled');
  assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
});
for (const change of ['question','png','request','fingerprint']) test(`changed ${change} invalidates the exact test review before lookup`, async t => {
  const f = setup(t); f.edit(); f.review(); assert.equal(f.wiring.authorizeTestOperation(), true);
  if (change === 'question') f.edit('Changed question');
  if (change === 'png') f.crop.bytes[40] ^= 1;
  if (change === 'request') f.wire().request.body.messages[1].content[0].text = 'Changed request';
  if (change === 'fingerprint') f.wire().fingerprint = 'copied';
  f.confirm(); await f.tick(); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
});
test('duplicate simultaneous confirmations and delayed token replay cannot cause a second dispatch', async t => {
  const f = setup(t); f.edit(); f.review(); const token = f.last().screenToken;
  assert.equal(f.wiring.authorizeTestOperation(), true); f.confirm(token); f.confirm(token); await f.tick();
  f.confirm(token); await f.tick(); assert.equal(f.calls(), 1); assert.equal(f.loads(), 1);
});
for (const delay of [30000,120000]) test(`expired ${delay}-ms consent/session cannot dispatch or renew main approval`, async t => {
  const f = setup(t); f.edit(); f.review(); assert.equal(f.wiring.authorizeTestOperation(), true);
  await f.tick(delay); f.confirm(); await f.tick(); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
  assert.equal(f.wiring.authorizeTestOperation(), false);
});
for (const status of [400,401,429,500]) test(`fake HTTP ${status} is a single consumed error, not success or a retry`, async t => {
  const f = setup(t, { script: [{ status, body: '{}' }] }); f.begin(); await f.tick(20001);
  assert.equal(f.last().phase, 'screen-error'); assert.equal(f.last().screenOutcome, 'failed'); assert.equal(f.calls(), 1); assert.equal(f.loads(), 1);
});
for (const [label, script, expected] of [
  ['timeout', { failure: 'pending' }, 'unknown'], ['exception/unknown', { failure: 'unavailable' }, 'unknown'],
  ['empty', { status: 200, body: '' }, 'failed'], ['malformed', { status: 200, body: '{' }, 'failed'],
] as const) test(`${label} remains honest and never automatically dispatches again`, async t => {
  const f = setup(t, { script: [script] }); f.begin(); await f.tick(20001);
  assert.equal(f.last().phase, 'screen-error'); assert.equal(f.last().screenOutcome, expected); assert.equal(f.calls(), 1);
  await f.tick(20001); assert.equal(f.calls(), 1); assert.equal(f.loads(), 1);
});
test('missing dummy fails after admission with zero fake calls', async t => {
  const f = setup(t, { dummy: { mode: 'missing' } }); f.begin(); await f.tick();
  assert.equal(f.loads(), 1); assert.equal(f.calls(), 0); assert.equal(f.last().phase, 'screen-error');
});
test('cancellation before admission microtask prevents even dummy acquisition', async t => {
  const f = setup(t); f.begin(); f.send({ type: 'cancel' }); await f.tick(); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
  assert.equal(f.wiring.authorizeTestOperation(), false);
});
for (const action of ['cancel','discard','replace']) test(`${action} after fake entry suppresses late results without restoring authority`, async t => {
  const f = setup(t, { script: [{ status: 200, body: body('late'), delayMs: 100 }] }); f.begin(); await flush(); assert.equal(f.calls(), 1);
  if (action === 'cancel') f.send({ type: 'cancel' }); else f.session.dispose();
  if (action === 'cancel') assert.equal(f.last().screenAttempt, undefined);
  const count = f.notices.length; await f.tick(20001); assert.equal(f.notices.length, count);
  assert.equal(f.notices.some((n: any) => n.phase === 'screen-result'), false); assert.equal(f.calls(), 1);
  assert.equal(f.wiring.authorizeTestOperation(), false);
  if (action === 'replace') assert.throws(() => createOfflineVisionSession({ sessionId: 'replacement', crop: f.crop, publish() {}, testWiring: f.wiring }));
});
test('new deliberate operation needs another exact review AND main approval', async t => {
  const f = setup(t, { script: [{ status: 200, body: body() }, { status: 200, body: body() }] }); f.begin(); const first = f.wire(); await f.tick();
  f.review(); const second = f.wire(); assert.notEqual(first.scope.requestId, second.scope.requestId);
  f.confirm(); await f.tick(); assert.equal(f.calls(), 1);
  f.review(); assert.equal(f.wiring.authorizeTestOperation(), true); f.confirm(); await f.tick(); assert.equal(f.calls(), 2);
});
test('factory rejects forged/reused handles and arbitrary native collaborators', t => {
  const f = setup(t);
  for (const extra of [{ live: true }, { fetchImpl: globalThis.fetch }, { vault: {} }, { endpoint: 'https://example.invalid' }])
    assert.throws(() => wiringModule.createPrivilegedVisionWiringOfflineTest({ scope: 'privileged-screen-vision-wiring-test', transport: f.fake, dummy: f.dummy, ...extra }));
  assert.throws(() => createOfflineVisionSession({ sessionId: 'foreign', crop: f.crop, publish() {}, testWiring: { purpose: f.wiring.purpose } }));
  assert.throws(() => createOfflineVisionSession({ sessionId: 'reuse', crop: f.crop, publish() {}, testWiring: f.wiring }));
});

test('one-shot activation requires the exact reviewed ID AND separate test A; IDs alone confer no authority', async t => {
  const f = setup(t, { oneShot: true }); f.edit(); f.review();
  assert.equal(f.wiring.authorizeTestOperation(), false);
  assert.equal(f.wiring.authorizeTestOperation('foreign-review'), false);
  assert.equal(f.loads(), 0); assert.equal(f.calls(), 0);
  assert.equal(f.approve(), true); assert.equal(f.approve(), false);
  assert.equal(f.loads(), 0); assert.equal(f.calls(), 0); f.confirm(); await f.tick();
  assert.equal(f.calls(), 1); assert.equal(f.loads(), 1); assert.match(f.last().answer, /^Simulated Qwen response/);
});
test('one-shot main approval cannot silently target a newer review while approving an old request ID', async t => {
  const f = setup(t, { oneShot: true }); f.edit(); f.review(); const old = f.wire().scope.requestId;
  f.edit('A newly reviewed question'); f.review(); assert.notEqual(f.wire().scope.requestId, old);
  assert.equal(f.wiring.authorizeTestOperation(old), false); assert.equal(f.approve(), true);
  f.confirm(); await f.tick(); assert.equal(f.calls(), 1);
});
test('one-shot activation is not serializable, transferable to another session or acceptable to native HTTPS', async t => {
  const f = setup(t, { oneShot: true });
  assert.throws(() => JSON.stringify(f.wiring)); assert.throws(() => structuredClone(f.wiring));
  assert.throws(() => createOfflineVisionSession({ sessionId: 'other', crop: f.crop, publish() {}, testWiring: { purpose: f.wiring.purpose } }));
  assert.throws(() => createOfflineVisionSession({ sessionId: 'other', crop: f.crop, publish() {}, testWiring: f.wiring }));
  const pilot = native.createSyntheticVisionPilot({ settings: () => { throw Error('No actual configuration'); }, vault: { load: () => { throw Error('No actual vault'); } } });
  assert.equal((await pilot.run(f.wiring)).code, 'disabled'); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
});
for (const [label, script, dummy] of [
  ['success', { status: 200, body: body() }, {}],
  ...[400,401,429,500].map(status => [`HTTP ${status}`, { status, body: '{}' }, {}]),
  ['timeout', { failure: 'pending' }, {}], ['UNKNOWN', { failure: 'unavailable' }, {}],
  ['empty', { status: 200, body: '' }, {}], ['malformed', { status: 200, body: '{' }, {}],
  ['foreign result', { status: 200, body: body(), replyTo: 'other-operation' }, {}],
  ['missing dummy', { status: 200, body: body() }, { mode: 'missing' }],
] as any[]) test(`one-shot ${label} consumes the activation; new review cannot automatically renew it`, async t => {
  const f = setup(t, { oneShot: true, script: [script, { status: 200, body: body() }], dummy });
  f.begin(); await f.tick(20001); const first = f.last();
  assert.equal(first.phase, label === 'success' ? 'screen-result' : 'screen-error');
  if (['timeout','UNKNOWN','foreign result'].includes(label)) assert.equal(first.screenOutcome, 'unknown');
  const calls = f.calls(); assert.equal(calls, label === 'missing dummy' ? 0 : 1);
  f.review(); assert.equal(f.approve(), false); f.confirm(); await f.tick(20001);
  assert.equal(f.calls(), calls); assert.equal(f.loads(), 1); assert.equal(f.last().phase, 'screen-error');
});
for (const action of ['cancel','edit','expiry']) test(`one-shot approval revoked by ${action} before confirmation cannot be recycled`, async t => {
  const f = setup(t, { oneShot: true }); f.edit(); f.review(); assert.equal(f.approve(), true);
  if (action === 'cancel') f.send({ type: 'cancel' });
  if (action === 'edit') f.edit('Changed after main approval');
  if (action === 'expiry') { await f.tick(30000); f.confirm(); }
  f.review(); assert.equal(f.approve(), false); f.confirm(); await f.tick();
  assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
});
test('one-shot cancellation after fake entry suppresses output and never re-arms the consumed activation', async t => {
  const f = setup(t, { oneShot: true, script: [{ failure: 'pending' }] }); f.begin(); await flush(); assert.equal(f.calls(), 1);
  f.send({ type: 'cancel' }); await f.tick(); f.review(); assert.equal(f.approve(), false); f.confirm(); await f.tick();
  assert.equal(f.calls(), 1); assert.equal(f.notices.some((n: any) => n.phase === 'screen-result'), false);
});

const execute = promisify(execFile), worker = path.resolve('scripts/vision-wiring-offline-worker.mjs');
async function temporary(t: any) {
  const root = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(root, 'companion-vision-attempt-'));
  t.after(async () => { const resolved = await fs.realpath(dir); assert.equal(path.dirname(resolved), root);
    assert.ok(path.basename(resolved).startsWith('companion-vision-attempt-')); await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });
  return dir;
}
async function probe(mode: string, directory: string) {
  try { const r = await execute(process.execPath, [worker, mode, directory], { windowsHide: true, timeout: 12000, maxBuffer: 8192 }); return { exit: 0, result: JSON.parse(r.stdout.trim()) }; }
  catch (e: any) { if (e.killed || e.signal || ![73,74,75].includes(e.code)) throw e; return { exit: e.code, result: null }; }
}
test('normal startup/session loads no isolated authority or native transport and rejects TEST actions', async t => {
  const r = (await probe('normal-startup', await temporary(t))).result;
  assert.equal(r.isolatedLoaded, false); assert.equal(r.privateAccess, 0); assert.equal(r.network, 0);
});
for (const [mode, exit] of [['before-commit',73],['after-commit',74],['during-fake',75]] as const)
  test(`actual owned process exits ${mode}; a fresh lifetime restores neither gate nor work`, async t => {
    const dir = await temporary(t); assert.equal((await probe(mode, dir)).exit, exit);
    const r = (await probe('recover', dir)).result; assert.equal(r.calls, 0); assert.equal(r.loads, 0); assert.equal(r.notices, 0); assert.equal(r.armed, false);
  });
for (const lost of ['missing','corrupt']) test(`${lost} known committed evidence restores no old approval; fresh approval is independent`, async t => {
  const dir = await temporary(t); assert.equal((await probe('after-commit', dir)).exit, 74);
  const file = path.join(dir, 'attempt.jsonl'); // Only this test's owned disposable fixture.
  if (lost === 'missing') await fs.unlink(file); else await fs.writeFile(file, '{');
  const recovered = (await probe('recover', dir)).result; assert.equal(recovered.calls, 0); assert.equal(recovered.loads, 0); assert.equal(recovered.armed, false);
  const fresh = (await probe('new-session', dir)).result; assert.equal(fresh.calls, lost === 'missing' ? 1 : 0);
});
for (const mode of ['write-denied','write-failure','flush-failure','terminal-failure'])
  test(`${mode} in composed wiring fails closed without retransmission or private payload persistence`, async t => {
    const dir = await temporary(t), r = (await probe(mode, dir)).result;
    assert.equal(r.calls, mode === 'terminal-failure' ? 1 : 0); assert.equal(r.loads, mode === 'terminal-failure' ? 1 : 0);
    assert.equal(r.resultPhase, 'screen-error'); assert.equal(r.privateAccess, 0); assert.equal(r.network, 0);
    if (mode === 'terminal-failure') assert.equal(r.outcome, 'unknown');
  });
test('one-shot process exit and missing evidence cannot restore authority; a new explicit operation is independent', async t => {
  const dir = await temporary(t); assert.equal((await probe('one-shot-after-commit', dir)).exit, 74);
  await fs.unlink(path.join(dir, 'attempt.jsonl')); // Only this test's known disposable metadata.
  const recovered = (await probe('one-shot-recover', dir)).result;
  assert.equal(recovered.calls, 0); assert.equal(recovered.loads, 0); assert.equal(recovered.armed, false);
  const fresh = (await probe('one-shot-new-session', dir)).result;
  assert.equal(fresh.calls, 1); assert.equal(fresh.rearmAfterAttempt, false);
});
test('one-shot ledger admission denial prevents lookup and cannot renew the privileged activation', async t => {
  const r = (await probe('one-shot-write-denied', await temporary(t))).result;
  assert.equal(r.calls, 0); assert.equal(r.loads, 0); assert.equal(r.resultPhase, 'screen-error');
  assert.equal(r.rearmAfterAttempt, false); assert.equal(r.network, 0); assert.equal(r.privateAccess, 0);
});
