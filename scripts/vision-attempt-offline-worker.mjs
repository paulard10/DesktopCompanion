// Fixed, synthetic-only subprocess probe. No real Electron profile, capture or provider.
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
const require = createRequire(import.meta.url);
const [mode, directory, ...extra] = process.argv.slice(2);
const modes = ['success','restart','after-commit','during-fake','write','partial','flush','terminal',
  'no-capability','missing-a','tamper','cancel-before','cancel-after','missing-dummy','unknown','malformed','empty','wrong-context','discard-during-terminal',
  'http-400','http-401','http-429','http-500'];
if (!modes.includes(mode) || !directory || extra.length) throw Error('Fixed offline probe arguments required.');
let network = 0, privateAccess = 0;
const deny = () => { network++; throw Error('No external network'); };
globalThis.fetch = deny; if ('WebSocket' in globalThis) globalThis.WebSocket = deny;
for (const n of ['node:http','node:https','node:http2']) for (const k of ['request','get','connect']) if (k in require(n)) require(n)[k] = deny;
for (const k of ['connect','createConnection']) require('node:net')[k] = deny;
require('node:net').Socket.prototype.connect = deny; require('node:tls').connect = deny;
for (const k of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork']) require('node:child_process')[k] = deny;
const load = Module._load;
Module._load = function (id, ...args) {
  if (/safeCredentialStore|providerSettings|keyVault|visionPilotReceipt/.test(id)) { privateAccess++; throw Error('No actual private context'); }
  if (id === 'electron') return { app: { isPackaged: false },
    get safeStorage() { privateAccess++; throw Error('No secrets'); },
    get desktopCapturer() { throw Error('No capture'); }, get clipboard() { throw Error('No clipboard'); } };
  return load.call(this, id, ...args);
};
process.type = 'browser';
const ledger = require('../dist/main/screenVisionAttempt.js');
const request = require('../dist/main/screenVisionRequest.js');
const fakeModule = require('../dist/main/screenVisionBridgeFake.js');
const mocks = require('../dist/main/qwenVisionMock.js');
const { createScreenVisionGateOfflineTest } = require('../dist/main/screenVisionGate.js');
const { createOfflineVisionSession } = require('../dist/main/offlineVisionSession.js');
const { createVisionPilotFixture } = require('../dist/main/visionPilotFixture.js');
const { requirePilotCredentialContext } = require('../dist/main/pilotCredentialContext.js');
const before = await ledger.readOfflineVisionAttempt(directory);
const faults = { write:'write-failure', partial:'partial-write', flush:'flush-failure', terminal:'terminal-failure' };
const attempt = await ledger.createOfflineVisionAttempt({ directory, ...(faults[mode] ? { fault: faults[mode] } : {}) });
let committed = false, wire, cap, done, result;
const commit = ledger.commitOfflineVisionAttempt;
ledger.commitOfflineVisionAttempt = async (...args) => {
  await commit(...args); committed = true;
  assert.equal(request.screenVisionBridgeAttemptConsumed(wire), true);
  if (mode === 'after-commit') process.exit(71); // abrupt exit of this owned fixture child only.
};
const dummy = fakeModule.createVisionBridgeDummy(mode === 'missing-dummy' ? { mode:'missing' } : {});
const body = text => JSON.stringify({ choices:[{ message:{role:'assistant',content:text},finish_reason:'stop' }] });
const scenario = mode === 'unknown' ? { failure:'unavailable' } : mode === 'during-fake' || mode === 'cancel-after' ? { failure:'pending' }
  : { status: mode.startsWith('http-') ? Number(mode.slice(5)) : 200,
    body: mode === 'malformed' ? '{' : mode.startsWith('http-') ? '{}' : body(mode === 'empty' ? ' ' : 'Offline synthetic result. No visual understanding.') };
const fake = mocks.createVisionMock([scenario]);
const acquire = fakeModule.loadVisionBridgeDummy;
fakeModule.loadVisionBridgeDummy = async (...args) => {
  assert.equal(committed, true);
  assert.equal((await ledger.readOfflineVisionAttempt(directory)).consumed, true);
  // Exercise the existing context contract against disposable stub paths only.
  requirePilotCredentialContext({ isPackaged:false,isReady:()=>true,getName:()=>mode === 'wrong-context' ? 'Electron' : 'desktop-companion',
    getPath:()=>directory }, {appName:'desktop-companion',userData:directory,sessionData:directory}, 'qwen');
  return acquire(...args);
};
const finish = ledger.finishOfflineVisionAttempt;
ledger.finishOfflineVisionAttempt = async (...args) => {
  if (mode === 'discard-during-terminal') session.dispose();
  return finish(...args);
};
const exchange = mocks.exchangeVisionMock;
mocks.exchangeVisionMock = (...args) => {
  assert.equal(committed, true); assert.equal(fakeModule.visionBridgeDummyStats(dummy).loads, 1);
  const pending = exchange(...args);
  if (mode === 'during-fake') process.exit(72);
  if (mode === 'cancel-after') queueMicrotask(() => session.dispatch({ type:'cancel',sessionId:'offline-attempt' }));
  return pending;
};
const gate = createScreenVisionGateOfflineTest({ scope:'privileged-screen-vision-offline-test',transport:fake,dummy,attempt });
const notices = [];
const session = createOfflineVisionSession({ sessionId:'offline-attempt',crop:{...createVisionPilotFixture(),kind:'approved-local-crop'},publish:n=>notices.push(n) });
const original = request.executeScreenVisionMock;
request.executeScreenVisionMock = (w, _fake, signal, evidence) => {
  wire = w;
  if (mode === 'missing-a') { // replace only test liveness, never issue native consent.
    session.dispatch({type:'cancel',sessionId:'offline-attempt'});
  }
  const issued = mode === 'no-capability' ? null : gate.issue(w);
  if (issued?.ok) cap = issued.capability;
  if (mode === 'tamper') wire.request.body.messages[1].content[0].text = 'changed synthetic question';
  const pending = issued && !issued.ok ? Promise.resolve(issued) : gate.run(w, cap, signal);
  if (mode === 'cancel-before') gate.cancel();
  done = pending.then(r => { result = r; evidence.fakeDispatches = r.evidence.fakeDispatches ?? 0; return r; });
  return done;
};
try {
  const question = 'What is shown in the synthetic test?';
  session.dispatch({type:'edit',sessionId:'offline-attempt',question,revision:1,scenario:'success'});
  session.dispatch({type:'review-screen-dry-run',sessionId:'offline-attempt',question,revision:1,scenario:'success'});
  session.dispatch({type:'confirm-screen-dry-run',sessionId:'offline-attempt',revision:1,token:notices.at(-1).screenToken});
  assert.ok(done); await done;
  const again = cap ? await gate.run(wire,cap) : null;
  const after = await ledger.readOfflineVisionAttempt(directory);
  assert.equal(network,0); assert.equal(privateAccess,0);
  console.log(JSON.stringify({ ok:result.ok, code:result.ok ? null : result.code, outcome:result.ok ? 'completed' : result.outcome,
    simulated:result.ok ? result.kind === 'simulated-qwen-response' && result.text.startsWith('Simulated Qwen response') : false,
    loads:fakeModule.visionBridgeDummyStats(dummy).loads,calls:mocks.visionMockStats(fake).calls,
    before:before.state,after:after.state,consumed:after.consumed,replay:again?.code ?? null,network,privateAccess,
    publishedResult:notices.some(n=>n.phase==='screen-result'),committed }));
} finally { session.dispose(); gate.dispose(); await ledger.closeOfflineVisionAttempt(attempt); request.executeScreenVisionMock = original; }
