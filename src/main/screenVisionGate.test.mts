import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire, Module } from 'node:module';
import { fixture as png } from './visionFixtures.test-support.mts';
const require = createRequire(import.meta.url), restores: (() => void)[] = [];
const counters = { network: 0, privateAccess: 0, writes: 0, capture: 0 };
function patch(o: any, k: string, v: any) { const old = o[k]; o[k] = v; restores.push(() => o[k] = old); }
const deny = () => { counters.network++; throw Error('Real network/process denied'); };
patch(globalThis, 'fetch', deny); if ('WebSocket' in globalThis) patch(globalThis, 'WebSocket', deny);
for (const n of ['node:http', 'node:https', 'node:http2']) for (const k of ['request', 'get', 'connect'])
  if (k in require(n)) patch(require(n), k, deny);
for (const k of ['connect', 'createConnection']) patch(require('node:net'), k, deny);
patch(require('node:net').Socket.prototype, 'connect', deny); patch(require('node:tls'), 'connect', deny);
for (const k of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) patch(require('node:child_process'), k, deny);
for (const k of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream'])
  patch(require('node:fs'), k, () => { counters.writes++; throw Error('Persistence denied'); });
for (const k of ['writeFile', 'appendFile']) patch(require('node:fs/promises'), k, () => { counters.writes++; throw Error('Persistence denied'); });
const app = { isPackaged: false }, load = (Module as any)._load, oldType = (process as any).type;
patch(Module, '_load', function (this: any, id: string, ...args: any[]) {
  if (/safeCredentialStore|providerSettings|keyVault|visionPilotReceipt/.test(id)) { counters.privateAccess++; throw Error('Real credentials/settings/receipts denied'); }
  if (id === 'electron') return { app, get safeStorage() { counters.privateAccess++; throw Error('No secrets'); },
    get clipboard() { counters.writes++; throw Error('No clipboard'); }, desktopCapturer: { getSources() { counters.capture++; throw Error('No capture'); } } };
  return load.call(this, id, ...args);
});
(process as any).type = 'browser';
const request = require('../../dist/main/screenVisionRequest.js');
const { createOfflineVisionSession } = require('../../dist/main/offlineVisionSession.js');
const { createScreenVisionGateOfflineTest: createGate, FAKE_CAPABILITY_MS } = require('../../dist/main/screenVisionGate.js');
const native = require('../../dist/main/qwenVisionTransport.js');
const { createVisionMock, visionMockStats } = require('../../dist/main/qwenVisionMock.js');
const { createVisionBridgeDummy, visionBridgeDummyStats } = require('../../dist/main/screenVisionBridgeFake.js');
const scope = 'privileged-screen-vision-offline-test';
const body = (text = 'Synthetic gate test only. No visual understanding.') => JSON.stringify({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
after(() => { for (const r of restores.reverse()) r(); (process as any).type = oldType;
  assert.deepEqual(counters, { network: 0, privateAccess: 0, writes: 0, capture: 0 }); });
function setup(t: any, opts: any = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const fake = createVisionMock(opts.script ?? [{ status: 200, body: body(), delayMs: 10 }]);
  const dummy = createVisionBridgeDummy(opts.dummy ?? {}), gate = createGate({ scope, transport: fake, dummy });
  const crop = { ...png(), kind: 'approved-local-crop' }, notices: any[] = [];
  let wire: any, cap: any, result: any, finish: any, revision = 0;
  const publish = (n: any) => notices.push(n);
  const session = createOfflineVisionSession({ sessionId: 'gate-session', crop, publish });
  if (!opts.normal) t.mock.method(request, 'executeScreenVisionMock', (w: any, _: any, signal: AbortSignal, attempt: any) => {
    wire = w;
    const retain = (r: any) => { result = r; attempt.fakeDispatches = r.evidence.fakeDispatches ?? 0; return r; };
    if (opts.manual) return new Promise(resolve => { finish = (r: any) => resolve(retain(r)); });
    const issued = gate.issue(w); assert.equal(issued.ok, true); cap = issued.capability;
    return gate.run(w, cap, signal).then(retain);
  });
  const send = (a: any) => session.dispatch({ sessionId: 'gate-session', ...a });
  const start = () => { send({ type: 'edit', question: '  ¿Qué muestra este recorte?  ', revision: ++revision, scenario: 'success' });
    send({ type: 'review-screen-dry-run', question: '  ¿Qué muestra este recorte?  ', revision, scenario: 'success' });
    const token = notices.at(-1)?.screenToken; send({ type: 'confirm-screen-dry-run', token, revision }); return token; };
  const tick = async (ms = 10) => { await flush(); t.mock.timers.tick(ms); await flush(); };
  const issue = () => { const r = gate.issue(wire); if (r.ok) cap = r.capability; return r; };
  const run = (w = wire, c = cap, signal?: AbortSignal) => gate.run(w, c, signal).then((r: any) => { result = r; finish?.(r); return r; });
  t.after(() => { session.dispose(); gate.dispose(); if (finish) finish({ ok: false, outcome: 'cancelled', code: 'cancelled', evidence: { fakeDispatches: 0 } }); });
  return { gate, fake, dummy, crop, session, send, start, tick, issue, run, notices,
    wire: () => wire, cap: () => cap, result: () => result,
    calls: () => visionMockStats(fake).calls, loads: () => visionBridgeDummyStats(dummy).loads };
}
test('A: valid confirmed Gate A with missing Gate B never loads dummy or dispatches', async t => {
  const f = setup(t, { manual: true }); f.start(); const r = await f.run();
  assert.equal(r.code, 'authorization'); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
});
test('issuance without confirmed Gate A fails, even for an original prepared request', async t => {
  const f = setup(t, { manual: true }); f.start();
  const prepared = request.prepareScreenVisionRequest(f.crop, f.wire().scope, f.wire().request.url);
  assert.equal(f.gate.issue(prepared.wire).code, 'authorization'); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
});
for (const action of ['cancel', 'discard', 'close', 'edit']) test(`B/V/W/X: issued fake Gate B with Gate A revoked by ${action} cannot dispatch`, async t => {
  const f = setup(t, { manual: true }); f.start(); assert.equal(f.issue().ok, true);
  if (action === 'edit') f.send({ type: 'edit', question: 'changed', revision: 2, scenario: 'success' });
  else if (action === 'cancel') f.send({ type: 'cancel' }); else f.session.dispose();
  const r = await f.run(); assert.equal(r.code, 'authorization'); assert.equal(f.loads(), 0); assert.equal(f.calls(), 0);
  assert.equal((await f.run()).code, 'duplicate');
});
test('C/AA/AK/AV: independent fake Gate B admits exact confirmed request once with dummy and simulated answer', async t => {
  const f = setup(t, { manual: true }); f.start(); assert.equal(f.loads(), 0); assert.equal(f.calls(), 0);
  assert.equal(f.issue().ok, true); assert.equal(f.loads(), 0); assert.equal(f.calls(), 0);
  const pending = f.run(); await f.tick(); const r = await pending;
  assert.equal(r.ok, true); assert.equal(r.kind, 'simulated-qwen-response'); assert.match(r.text, /Simulated Qwen response/);
  assert.equal(r.evidence.fakeDispatches, 1); assert.equal(r.evidence.httpStatus, 200); assert.equal(r.evidence.transport, 'closed-fake');
  assert.equal(f.loads(), 1); assert.equal(f.calls(), 1); assert.equal(f.notices.at(-1).phase, 'screen-result');
  assert.equal(r.usage, undefined); assert.equal(r.key, undefined);
});
for (const field of ['sessionId', 'imageId', 'question', 'provider', 'endpointPolicy', 'model', 'region'])
  test(`E–J: changed ${field} after issuance rejects before dummy acquisition`, async t => {
    const f = setup(t, { manual: true }); f.start(); f.issue(); f.wire().scope = { ...f.wire().scope, [field]: 'changed' };
    assert.equal((await f.run()).ok, false); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
  });
for (const change of ['url', 'body', 'checksum']) test(`R: tampered prepared ${change} is not repaired by a capability`, async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue(); const w = f.wire();
  if (change === 'url') w.request.url = 'https://foreign.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions';
  else if (change === 'body') w.request.body.messages[1].content[0].text = 'changed';
  else w.fingerprint = '0'.repeat(64);
  assert.equal((await f.run()).ok, false); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
});
test('D: copied original request cannot use a valid capability, original identity can still run once', async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue();
  assert.equal((await f.gate.run({ ...f.wire() }, f.cap())).code, 'authorization'); assert.equal(f.loads(), 0);
  const pending = f.run(); await f.tick(); assert.equal((await pending).ok, true); assert.equal(f.calls(), 1);
});
for (const kind of ['copy', 'json', 'fabricated', 'old-pilot', 'boolean']) test(`O/P/Q: ${kind} capability is rejected by runtime identity`, async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue();
  const cap = kind === 'copy' ? { ...f.cap() } : kind === 'json' ? JSON.parse('{"purpose":"fake-screen-vision-gate"}')
    : kind === 'old-pilot' ? { scope: 'one-synthetic-vision-request' } : kind === 'boolean' ? { authorized: true } : Object.freeze({});
  assert.equal((await f.gate.run(f.wire(), cap)).code, 'authorization'); assert.equal(f.loads(), 0); assert.equal(f.calls(), 0);
});
test('AP: capability cannot be JSON serialized or structured cloned, and contains no image/question', t => {
  const f = setup(t, { manual: true }); f.start(); f.issue();
  assert.throws(() => JSON.stringify(f.cap())); assert.throws(() => structuredClone(f.cap()));
  assert.equal(f.cap().question, undefined); assert.equal(f.cap().wire, undefined); assert.equal(f.cap().image, undefined);
});
for (const delay of [5000, 30000, 120000]) test(`K/L/M: expired fake capability/consent/session (${delay} ms) cannot dispatch or reissue`, async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue(); await f.tick(delay);
  assert.equal((await f.run()).code, 'expired'); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
  assert.equal(f.issue().ok, false);
});
test('expired earlier capability cannot revoke a newer different request in the same scope', async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue(); const oldCap = f.cap(), oldWire = f.wire();
  await f.tick(FAKE_CAPABILITY_MS); await f.run(); await flush(); f.start(); assert.equal(f.issue().ok, true);
  assert.equal((await f.gate.run(oldWire, oldCap)).code, 'expired');
  const pending = f.run(); await f.tick(); assert.equal((await pending).ok, true); assert.equal(f.calls(), 1);
});
test('S/T/U/N: concurrent runs consume both gates atomically and replay never restores them', async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue(); const one = f.run(), two = f.gate.run(f.wire(), f.cap());
  assert.equal((await two).code, 'duplicate'); await f.tick(); assert.equal((await one).ok, true);
  assert.equal((await f.run()).code, 'duplicate'); assert.equal(f.loads(), 1); assert.equal(f.calls(), 1);
  assert.equal(request.screenVisionBridgeAttemptConsumed(f.wire()), true);
});
test('two trusted scopes cannot issue capabilities for the same prepared attempt', async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue();
  const other = createGate({ scope, transport: f.fake, dummy: f.dummy }); t.after(() => other.dispose());
  assert.equal(other.issue(f.wire()).code, 'duplicate'); assert.equal((await other.run(f.wire(), f.cap())).code, 'authorization');
  assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
});
test('pending and active ownership reject conflicting issuance without another dummy load', async t => {
  const f = setup(t, { manual: true, script: [{ failure: 'pending' }] }); f.start(); f.issue();
  assert.equal(f.issue().code, 'busy'); const pending = f.run(); await flush(); assert.equal(f.issue().code, 'busy');
  f.gate.cancel(); await flush(); assert.equal((await pending).code, 'cancelled'); assert.equal(f.calls(), 1); assert.equal(f.loads(), 1);
});
for (const [status, code] of [[400, 'invalid'], [401, 'authentication'], [429, 'rate-limit'], [500, 'unavailable']] as const)
  test(`AB–AE: fake HTTP ${status} is a consumed error, never success or retry`, async t => {
    const f = setup(t, { script: [{ status, body: '{}', delayMs: 10 }] }); f.start(); await f.tick();
    assert.equal(f.result().code, code); assert.equal(f.result().outcome, 'failed'); assert.equal(f.result().evidence.httpStatus, status);
    assert.equal((await f.gate.run(f.wire(), f.cap())).code, 'duplicate'); assert.equal(f.calls(), 1); assert.equal(f.loads(), 1);
  });
for (const [raw, code] of [['{', 'malformed'], [body(' '), 'empty']] as const) test(`AG/AH: fake ${code} never becomes success`, async t => {
  const f = setup(t, { script: [{ status: 200, body: raw, delayMs: 10 }] }); f.start(); await f.tick();
  assert.equal(f.result().code, code); assert.equal(f.result().ok, false); assert.equal(f.calls(), 1);
});
test('AI: unknown fake outcome remains unknown, both gates spent and no retry', async t => {
  const f = setup(t, { script: [{ failure: 'unavailable', delayMs: 10 }] }); f.start(); await f.tick();
  assert.equal(f.result().outcome, 'unknown'); assert.equal(f.result().evidence.fakeDispatches, 1);
  assert.equal((await f.gate.run(f.wire(), f.cap())).code, 'duplicate'); assert.equal(f.calls(), 1);
});
test('AF: fake HTTP timeout preserves UNKNOWN and consumed capability', async t => {
  const f = setup(t, { script: [{ failure: 'pending' }] }); f.start(); await f.tick(20000);
  assert.equal(f.result().code, 'timeout'); assert.equal(f.result().outcome, 'unknown'); assert.equal(f.calls(), 1);
  assert.equal((await f.gate.run(f.wire(), f.cap())).code, 'duplicate');
});
test('AJ: missing dummy fails after both admissions with no fake dispatch', async t => {
  const f = setup(t, { dummy: { mode: 'missing' } }); f.start(); await f.tick();
  assert.equal(f.result().code, 'missing-key'); assert.equal(f.result().evidence.attemptConsumed, true);
  assert.equal(f.loads(), 1); assert.equal(f.calls(), 0);
});
for (const action of ['cancel', 'discard', 'close']) test(`V–X: ${action} in the admission microtask prevents even dummy acquisition`, async t => {
  const f = setup(t); f.start(); if (action === 'cancel') f.gate.cancel(); else f.session.dispose();
  await f.tick(); assert.equal(f.loads(), 0); assert.equal(f.calls(), 0); assert.equal((await f.gate.run(f.wire(), f.cap())).code, 'duplicate');
});
for (const action of ['cancel', 'discard', 'close', 'edit']) test(`Y/Z/AU: ${action} after fake dispatch cannot publish late success or reopen preview`, async t => {
  const f = setup(t, { script: [{ status: 200, body: body('late'), delayMs: 50 }] }); f.start(); await flush(); assert.equal(f.calls(), 1);
  if (action === 'cancel') f.send({ type: 'cancel' }); else if (action === 'edit') f.send({ type: 'edit', question: 'new', revision: 2, scenario: 'success' }); else f.session.dispose();
  const count = f.notices.length; await f.tick(100); assert.equal(f.notices.length, count);
  assert.equal(f.notices.some(n => n.phase === 'screen-result'), false); assert.equal(f.calls(), 1);
});
test('AT: closed session cannot transfer its capability into a new session or authority', async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue(); const oldWire = f.wire(), cap = f.cap(); f.session.dispose();
  assert.equal((await f.gate.run(oldWire, cap)).ok, false); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
});
test('AR: renderer-like actions cannot issue a gate, inject images, endpoints or claim authorization', async t => {
  const f = setup(t, { normal: true });
  for (const action of [{ type: 'issue-capability' }, { type: 'send-real', authorized: true }, { type: 'confirm-screen-dry-run', authorized: true, capability: {} },
    { type: 'review-screen-dry-run', image: 'data:image/png;base64,FAKE', endpoint: 'https://example.invalid', model: 'other' }]) f.send(action);
  await f.tick(); assert.equal(f.loads(), 0); assert.equal(f.calls(), 0); assert.equal(f.notices.length, 0);
});
test('AW: ordinary offline coordinator remains usable without ever creating Gate B', async t => {
  const f = setup(t, { normal: true }); f.start(); await f.tick(400);
  assert.equal(f.notices.at(-1).phase, 'screen-result'); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
});
test('AS/AN: old flags and even a fake capability cannot enable the native synthetic pilot', async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue(); const oldArgv = process.argv, oldDev = process.env.DESKTOP_COMPANION_DEV;
  try { process.argv = [...oldArgv, native.LIVE_TEST_FLAG]; process.env.DESKTOP_COMPANION_DEV = '1';
    const pilot = native.createSyntheticVisionPilot({ settings() { throw Error('No real settings'); }, vault: { load() { throw Error('No real key'); } } });
    assert.equal(pilot.review().code, 'disabled'); assert.equal((await pilot.run(f.cap())).code, 'disabled');
  } finally { process.argv = oldArgv; if (oldDev === undefined) delete process.env.DESKTOP_COMPANION_DEV; else process.env.DESKTOP_COMPANION_DEV = oldDev; }
  assert.equal(f.loads(), 0); assert.equal(f.calls(), 0);
});
test('explicit scope rejects callbacks, live flags, fake-looking credentials and transport impostors', t => {
  const f = setup(t);
  for (const extra of [{ fetchImpl: globalThis.fetch }, { vault: {} }, { live: true }, { authorized: true }, { endpoint: 'https://example.invalid' }, { model: 'other' }])
    assert.throws(() => createGate({ scope, transport: f.fake, dummy: f.dummy, ...extra }));
  assert.throws(() => createGate({ scope: 'live', transport: f.fake, dummy: f.dummy }));
  assert.throws(() => createGate({ scope, transport: {}, dummy: f.dummy }));
  assert.throws(() => createGate({ scope, transport: f.fake, dummy: { purpose: 'offline-bridge-dummy' } }));
});
for (const setting of ['packaged', 'not-main', 'insecure-tls']) test(`BA/BB: ${setting} cannot create or use fake privileged authority`, async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue(); const oldTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try { if (setting === 'packaged') app.isPackaged = true; else if (setting === 'not-main') (process as any).type = 'renderer'; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    assert.throws(() => createGate({ scope, transport: f.fake, dummy: f.dummy }));
    assert.equal((await f.run()).code, 'authorization'); assert.equal(f.calls(), 0); assert.equal(f.loads(), 0);
  } finally { app.isPackaged = false; (process as any).type = 'browser'; if (oldTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = oldTls; }
});
test('cancel/dispose while capability is unused revokes it permanently', async t => {
  const f = setup(t, { manual: true }); f.start(); f.issue(); f.gate.cancel();
  assert.equal((await f.run()).code, 'duplicate'); assert.equal(f.issue().ok, false); f.gate.dispose();
  assert.equal((await f.run()).code, 'authorization'); assert.equal(f.loads(), 0); assert.equal(f.calls(), 0);
});
