// Fixed synthetic composition/restart probe; never the normal Electron application.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire, Module } from 'node:module';
const require = createRequire(import.meta.url), [mode, directory, ...extra] = process.argv.slice(2);
if (!['normal-startup','before-commit','after-commit','during-fake','recover','new-session','write-denied','write-failure','flush-failure','terminal-failure',
  'one-shot-after-commit','one-shot-recover','one-shot-new-session','one-shot-write-denied'].includes(mode) || !directory || extra.length)
  throw Error('Fixed offline wiring probe arguments required.');
const oneShot = mode.startsWith('one-shot-'), operation = oneShot ? mode.slice('one-shot-'.length) : mode;
let network = 0, privateAccess = 0;
const deny = () => { network++; throw Error('No actual network/process'); };
globalThis.fetch = deny; if ('WebSocket' in globalThis) globalThis.WebSocket = deny;
for (const n of ['node:http','node:https','node:http2']) for (const k of ['request','get','connect']) if (k in require(n)) require(n)[k] = deny;
for (const k of ['connect','createConnection']) require('node:net')[k] = deny;
require('node:net').Socket.prototype.connect = deny; require('node:tls').connect = deny;
for (const k of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork']) require('node:child_process')[k] = deny;
const load = Module._load;
Module._load = function(id, ...args) {
  if (/safeCredentialStore|providerSettings|keyVault|visionPilotReceipt/.test(id)) { privateAccess++; throw Error('No actual private data'); }
  if (id === 'electron') return { app: { isPackaged: false }, get safeStorage() { privateAccess++; throw Error('No native secrets'); },
    get desktopCapturer() { throw Error('No capture'); }, get clipboard() { throw Error('No clipboard'); } };
  return load.call(this, id, ...args);
};
process.type = 'browser';
if (mode === 'normal-startup') {
  const { createOfflineVisionSession } = require('../dist/main/offlineVisionSession.js');
  const { createVisionPilotFixture } = require('../dist/main/visionPilotFixture.js');
  const notices = [], normal = createOfflineVisionSession({ sessionId: 'normal', crop: { ...createVisionPilotFixture(), kind: 'approved-local-crop' }, publish: n => notices.push(n) });
  normal.dispatch({ type: 'edit', sessionId: 'normal', question: 'Test', revision: 1, scenario: 'success' });
  normal.dispatch({ type: 'review-remote-consent-test', sessionId: 'normal', question: 'Test', revision: 1, scenario: 'success' });
  normal.dispatch({ type: 'confirm-remote-consent-test', sessionId: 'normal', token: 'old-test-token', revision: 1 });
  assert.equal(notices.length, 1); assert.equal(notices[0].phase, 'editing'); normal.dispose();
  const isolatedLoaded = Object.keys(require.cache).some(p => /screenVision(?:Wiring|Gate|Bridge\.js|Attempt)|qwenVisionTransport/.test(p));
  console.log(JSON.stringify({ isolatedLoaded, network, privateAccess })); process.exit(0);
}
const ledger = require('../dist/main/screenVisionAttempt.js'), mocks = require('../dist/main/qwenVisionMock.js');
const { createVisionBridgeDummy, visionBridgeDummyStats } = require('../dist/main/screenVisionBridgeFake.js');
const { createPrivilegedVisionWiringOfflineTest } = require('../dist/main/screenVisionWiring.js');
const { createOfflineVisionSession } = require('../dist/main/offlineVisionSession.js');
const { createVisionPilotFixture } = require('../dist/main/visionPilotFixture.js');
const before = await ledger.readOfflineVisionAttempt(directory);
const fault = ['write-failure','flush-failure','terminal-failure'].includes(mode) ? mode : undefined;
const attempt = await ledger.createOfflineVisionAttempt({ directory, ...(fault ? { fault } : {}) });
const commit = ledger.commitOfflineVisionAttempt;
ledger.commitOfflineVisionAttempt = async (...args) => {
  if (mode === 'before-commit') process.exit(73);
  await commit(...args); if (operation === 'after-commit') process.exit(74);
};
const exchange = mocks.exchangeVisionMock;
mocks.exchangeVisionMock = (...args) => { const result = exchange(...args); if (mode === 'during-fake') process.exit(75); return result; };
const open = fs.open;
fs.open = async (file, flags, ...args) => {
  if (operation === 'write-denied' && file === path.join(directory, 'attempt.jsonl') && flags === 'wx+')
    throw Object.assign(Error('Simulated permission denial'), { code: 'EACCES' });
  return open(file, flags, ...args);
};
const fake = mocks.createVisionMock([{ status: 200, body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Offline only. No visual understanding.' }, finish_reason: 'stop' }] }) }]);
const dummy = createVisionBridgeDummy(), wiring = createPrivilegedVisionWiringOfflineTest({
  scope: oneShot ? 'one-shot-screen-vision-wiring-test' : 'privileged-screen-vision-wiring-test', transport: fake, dummy, attempt });
const notices = [], session = createOfflineVisionSession({ sessionId: 'owned-wiring-probe', crop: { ...createVisionPilotFixture(), kind: 'approved-local-crop' },
  testWiring: wiring, publish: n => notices.push(n) });
try {
  let armed = false;
  if (operation === 'recover') {
    // Old or fabricated messages without a NEW review cannot restore either grant.
    session.dispatch({ type: 'confirm-remote-consent-test', sessionId: 'owned-wiring-probe', revision: 1, token: 'old-test-token' });
    session.dispatch({ type: 'confirm-screen-dry-run', sessionId: 'owned-wiring-probe', revision: 1, token: 'old-test-token' });
    armed = oneShot ? wiring.authorizeTestOperation('old-test-request') : wiring.authorizeTestOperation();
    await new Promise(resolve => setTimeout(resolve, 10));
  } else {
    const question = 'Describe this synthetic test.';
    session.dispatch({ type: 'edit', sessionId: 'owned-wiring-probe', question, revision: 1, scenario: 'success' });
    session.dispatch({ type: 'review-remote-consent-test', sessionId: 'owned-wiring-probe', question, revision: 1, scenario: 'success' });
    armed = oneShot ? wiring.authorizeTestOperation(notices.at(-1).screenReview.requestId) : wiring.authorizeTestOperation(); assert.equal(armed, true);
    const action = { type: 'confirm-remote-consent-test', sessionId: 'owned-wiring-probe', revision: 1, token: notices.at(-1).screenToken };
    session.dispatch(action); session.dispatch(action);
    for (let i = 0; i < 150 && !['screen-result','screen-error'].includes(notices.at(-1)?.phase); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(['screen-result','screen-error'].includes(notices.at(-1)?.phase));
    session.dispatch(action); // No second invocation after completion/failure.
  }
  const terminal = notices.at(-1), after = await ledger.readOfflineVisionAttempt(directory);
  let rearmAfterAttempt = null;
  if (oneShot && operation !== 'recover') {
    const question = 'New independently reviewed synthetic question';
    session.dispatch({ type: 'edit', sessionId: 'owned-wiring-probe', question, revision: 2, scenario: 'success' });
    session.dispatch({ type: 'review-remote-consent-test', sessionId: 'owned-wiring-probe', question, revision: 2, scenario: 'success' });
    rearmAfterAttempt = wiring.authorizeTestOperation(notices.at(-1).screenReview.requestId);
  }
  if (after.consumed && operation !== 'recover') {
    let text; try { text = await fs.readFile(path.join(directory, 'attempt.jsonl'), 'utf8'); } catch {}
    if (text) assert.doesNotMatch(text, /image|question|Bearer|base64|credential|hash|fingerprint|Describe this/i);
  }
  assert.equal(network, 0); assert.equal(privateAccess, 0);
  console.log(JSON.stringify({ armed, notices: notices.length, calls: mocks.visionMockStats(fake).calls,
    loads: visionBridgeDummyStats(dummy).loads, before: before.state, after: after.state, network, privateAccess,
    resultPhase: terminal?.phase ?? null, outcome: terminal?.screenOutcome ?? null, rearmAfterAttempt }));
} finally { session.dispose(); wiring.dispose(); await ledger.closeOfflineVisionAttempt(attempt); }
