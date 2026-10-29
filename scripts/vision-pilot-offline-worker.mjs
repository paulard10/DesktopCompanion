// Offline subprocess only. Install fail-fast guards BEFORE loading any pilot code.
import { createRequire, Module } from 'node:module';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
const require = createRequire(import.meta.url);
let realNetworkAttempts = 0, credentialReads = 0;
const deny = () => { realNetworkAttempts++; throw new Error('Real network forbidden in offline pilot.'); };
globalThis.fetch = deny; if ('WebSocket' in globalThis) globalThis.WebSocket = deny;
for (const name of ['node:http','node:https']) for (const key of ['request','get']) require(name)[key] = deny;
for (const key of ['connect','createConnection']) require('node:net')[key] = deny;
require('node:net').Socket.prototype.connect = deny; require('node:tls').connect = deny;
require('node:dgram').createSocket = deny;
for (const key of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork']) require('node:child_process')[key] = deny;
const originalLoad = Module._load;
Module._load = function(id,...args) {
  if (/safeCredentialStore|providerSettings|keyVault|undici/.test(id)) { credentialReads++; throw new Error('Private/native driver module forbidden.'); }
  if (id === 'electron') return { app:{ isPackaged:false }, get safeStorage(){credentialReads++;throw new Error('No credentials');},
    get desktopCapturer(){throw new Error('No capture');},get clipboard(){throw new Error('No clipboard');} };
  return originalLoad.call(this,id,...args);
};
const [scenario,testId] = process.argv.slice(2);
const allowed = ['success','400','401','429','500','timeout','connection','before','after','empty','malformed','cancel','expired','blocked','noisy'];
if (!allowed.includes(scenario)) throw new Error('Unsupported offline scenario.');
process.type = 'browser'; process.env.DESKTOP_COMPANION_DEV = '1'; delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
process.argv.push('--desktop-companion-synthetic-vision-test');
const { createPilotReceipt } = require('../dist/main/visionPilotReceipt.js');
const { createSyntheticVisionPilot } = require('../dist/main/qwenVisionTransport.js');
const { runReviewedPilotOnce } = await import('./vision-live-preflight.mjs');
const journal = createPilotReceipt('offline-http-test',testId);
const endpoint = 'https://offline-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const controller = new AbortController();
const fakeFetch = async () => {
  if (scenario === 'connection') throw new Error('PRIVATE simulated connection detail');
  if (scenario === 'after') { queueMicrotask(()=>process.exit(22)); return new Promise(()=>{}); }
  if (scenario === 'timeout' || scenario === 'cancel') return new Promise(()=>{});
  const status = /^\d+$/.test(scenario) ? Number(scenario) : 200;
  const raw = scenario === 'malformed' ? '{' : JSON.stringify(status >= 400 ? {error:{code:'InvalidParameter',message:'PRIVATE error detail'}} : {
    id:'11111111-2222-4333-8444-555555555555',model:'qwen3.7-plus',choices:[{message:{role:'assistant',content:scenario === 'empty' ? '' : 'OFFLINE SIMULATION: 7 + 5 = 12; a green circle.'},finish_reason:'stop'}],
    usage:{prompt_tokens:248,completion_tokens:24,total_tokens:272,completion_tokens_details:{reasoning_tokens:0}} });
  const response = new Response(raw,{status,headers:{'content-type':'application/json','x-request-id':'11111111-2222-4333-8444-555555555555'}});
  Object.defineProperty(response,'url',{value:endpoint+'/chat/completions'}); return response;
};
const pilot = createSyntheticVisionPilot({ settings:()=>({provider:scenario==='blocked'?'demo':'qwen',endpoint}),
  vault:{load:async()=> 'DUMMY-OFFLINE-CREDENTIAL'}, fetchImpl:fakeFetch, evidence:journal });
if (scenario === 'timeout') mock.timers.enable({apis:['setTimeout']});
const work = runReviewedPilotOnce({ ...pilot, run: permit=>pilot.run(permit,controller.signal) },async reviewed=>{
  if (scenario === 'before') process.exit(21);
  if (scenario === 'expired') { Date.now = () => reviewed.expiresAt + 1; return reviewed.statement; }
  return reviewed.statement;
},'offline-http-test');
for(let i=0;i<32;i++) await Promise.resolve();
if (scenario === 'timeout') mock.timers.tick(20_001);
if (scenario === 'cancel') controller.abort();
const outcome = await work; journal.finish(outcome.result,outcome.diagnostics);
assert.equal(realNetworkAttempts,0); assert.equal(credentialReads,0);
pilot.cancel(); mock.timers.reset();
if (scenario === 'noisy') { process.stdout.write('x'.repeat(20_000));process.stderr.write('y'.repeat(20_000)); }
console.log(JSON.stringify({testId,mode:'OFFLINE',realNetworkAttempts,credentialReads}));
