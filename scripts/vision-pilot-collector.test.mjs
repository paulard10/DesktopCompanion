import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { collectPilotProcess, preserveToolResult, classifyReceipt, OUTPUT_BYTES } from './vision-pilot-collector.mjs';
import { launchOfflinePilot } from './vision-pilot-offline.mjs';
const require=createRequire(import.meta.url);
let realNetwork=0;const originals=[];
function deny(){realNetwork++;throw Error('Real network forbidden');}
function replace(o,k){const old=o[k];o[k]=deny;originals.push(()=>o[k]=old);}
replace(globalThis,'fetch');if('WebSocket'in globalThis)replace(globalThis,'WebSocket');
for(const name of ['node:http','node:https'])for(const k of ['request','get'])replace(require(name),k);
for(const k of ['connect','createConnection'])replace(require('node:net'),k);
replace(require('node:net').Socket.prototype,'connect');replace(require('node:tls'),'connect');
after(()=>{for(const restore of originals.reverse())restore();assert.equal(realNetwork,0);});
let successEvidence;
before(async()=>{const out=await launchOfflinePilot('success');assert.equal(out.terminal,'SUCCEEDED');successEvidence=out.evidence;});
function fakeChild({out='test output',err='test stderr',code=0,dropOut=false,dropErr=false}={}){
  const child=new EventEmitter();child.stdout=dropOut?null:new PassThrough();child.stderr=dropErr?null:new PassThrough();
  child.kill=()=>{queueMicrotask(()=>child.emit('close',null,'SIGTERM'));return true;};
  queueMicrotask(()=>{child.emit('exit',code);child.stdout?.write(out);child.stderr?.write(err);child.stdout?.end();child.stderr?.end();child.emit('close',code,null);});return child;
}
test('regression: original immediate exit without session_id is saved before optional session handling',()=>{
  const result={output:'bounded diagnostic output',exit_code:0};let saved;
  const rejectingStore=v=>{if(v===undefined)throw Error('Only plain serializable objects can be stored');saved=v;};
  assert.throws(()=>rejectingStore(result.session_id));
  const received=preserveToolResult(result,rejectingStore);assert.equal(saved,received);assert.equal(received.sessionId,null);
  assert.equal(received.exitCode,0);assert.ok(received.output.bytes>0);assert.doesNotThrow(()=>JSON.stringify(saved));
});
test('running-session tool results preserve available output and a valid optional session ID',()=>{
  let saved;const value=preserveToolResult({session_id:123,output:'pending'},v=>saved=v);
  assert.equal(saved,value);assert.equal(value.sessionId,123);assert.equal(value.exitCode,null);
});
test('collector awaits close after exit and captures late bounded stdout/stderr and exit code',async()=>{
  const value=await collectPilotProcess({testId:successEvidence.receipt.testId,spawnChild:()=>fakeChild({code:17}),readReceipt:()=>successEvidence});
  assert.equal(value.exitCode,17);assert.equal(value.childClosed,true);assert.equal(value.stdout.bytes,11);assert.equal(value.stderr.bytes,11);
  assert.equal(value.collectorError,'nonzero-exit');assert.equal(value.collectionComplete,false);
  assert.equal(value.terminal,'SUCCEEDED'); // Receipt proves parsed answer; nonzero process exit is separately retained.
});
for(const lost of ['stdout','stderr'])test('lost '+lost+' recovers provider evidence from independent receipt',async()=>{
  const value=await collectPilotProcess({testId:successEvidence.receipt.testId,spawnChild:()=>fakeChild({dropOut:lost==='stdout',dropErr:lost==='stderr'}),readReceipt:()=>successEvidence});
  assert.equal(value[lost].available,false);assert.equal(value.terminal,'SUCCEEDED');assert.equal(value.evidence.receipt.answer,'OFFLINE SIMULATION: 7 + 5 = 12; a green circle.');
});
test('truncated child output is bounded and marked, without losing the receipt or retrying',async()=>{
  let launches=0;const value=await collectPilotProcess({testId:successEvidence.receipt.testId,spawnChild:()=>{launches++;return fakeChild({out:'x'.repeat(OUTPUT_BYTES+50),err:'y'.repeat(OUTPUT_BYTES+1)});},readReceipt:()=>successEvidence});
  assert.equal(value.stdout.capturedBytes,OUTPUT_BYTES);assert.equal(value.stderr.capturedBytes,OUTPUT_BYTES);
  assert.equal(value.stdout.truncated,true);assert.equal(value.stderr.truncated,true);assert.equal(launches,1);assert.equal(value.terminal,'SUCCEEDED');
});
for(const status of ['missing','corrupt'])test('exit 0 plus '+status+' receipt is UNKNOWN, never success or resend',async()=>{
  let launches=0;const value=await collectPilotProcess({testId:randomUUID(),spawnChild:()=>{launches++;return fakeChild();},readReceipt:()=>({status})});
  assert.equal(value.exitCode,0);assert.equal(value.terminal,'ATTEMPTED_OUTCOME_UNKNOWN');assert.equal(launches,1);
});
test('launch error is sanitized, before transport, with no raw Error persistence',async()=>{
  const value=await collectPilotProcess({testId:randomUUID(),spawnChild:()=>{throw Error('PRIVATE Bearer credential');},readReceipt:()=>({status:'missing'})});
  assert.equal(value.terminal,'FAILED_BEFORE_TRANSPORT');assert.equal(value.collectorError,'launch');assert.equal(JSON.stringify(value).includes('PRIVATE'),false);
});
test('receipt reader failure cannot convert process success into inference success',async()=>{
  const value=await collectPilotProcess({testId:randomUUID(),spawnChild:()=>fakeChild(),readReceipt:()=>{throw Error('PRIVATE');}});
  assert.equal(value.terminal,'ATTEMPTED_OUTCOME_UNKNOWN');assert.equal(value.collectorError,'receipt-read');
});
test('receipt from a different local test is rejected instead of reporting stale success',async()=>{
  const value=await collectPilotProcess({testId:randomUUID(),spawnChild:()=>fakeChild(),readReceipt:()=>successEvidence});
  assert.equal(value.terminal,'ATTEMPTED_OUTCOME_UNKNOWN');assert.equal(value.collectorError,'receipt-mismatch');
});
test('bounded collector timeout stops only its child and never relaunches',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let starts=0,kills=0;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{kills++;queueMicrotask(()=>child.emit('close',null,'SIGTERM'));};
  const pending=collectPilotProcess({testId:randomUUID(),timeoutMs:50,spawnChild:()=>{starts++;return child;},readReceipt:()=>({status:'missing'})});
  t.mock.timers.tick(51);const result=await pending;
  assert.equal(result.collectorError,'collector-timeout');assert.equal(result.terminal,'ATTEMPTED_OUTCOME_UNKNOWN');assert.equal(starts,1);assert.equal(kills,1);assert.equal(result.childClosed,true);
});
test('unconfirmed child termination is bounded and explicitly reported',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const child=new EventEmitter();child.kill=()=>{};let launches=0;
  const pending=collectPilotProcess({testId:randomUUID(),timeoutMs:10,spawnChild:()=>{launches++;return child;},readReceipt:()=>({status:'missing'})});
  t.mock.timers.tick(11);t.mock.timers.tick(1001);const result=await pending;assert.equal(result.childClosed,false);assert.equal(result.terminal,'ATTEMPTED_OUTCOME_UNKNOWN');assert.equal(launches,1);
});
test('cancelled collector preserves receipt evidence independently of cancellation',async()=>{
  const controller=new AbortController(),child=new EventEmitter();child.kill=()=>queueMicrotask(()=>child.emit('close',null,'SIGTERM'));
  const pending=collectPilotProcess({testId:successEvidence.receipt.testId,signal:controller.signal,spawnChild:()=>child,readReceipt:()=>successEvidence});
  controller.abort();const result=await pending;assert.equal(result.collectorError,'collector-cancelled');assert.equal(result.childClosed,true);assert.equal(result.terminal,'SUCCEEDED');
});
test('stream errors are sanitized while receipt evidence remains readable',async()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  const pending=collectPilotProcess({testId:successEvidence.receipt.testId,spawnChild:()=>child,readReceipt:()=>successEvidence});
  child.stdout.emit('error',Error('PRIVATE Authorization detail'));child.emit('close',0,null);const result=await pending;
  assert.equal(result.collectorError,'output-unavailable');assert.equal(result.stdout.available,false);assert.equal(result.terminal,'SUCCEEDED');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});
test('collector cancellation before spawn never starts a child',async()=>{
  const signal=new AbortController();signal.abort();let starts=0;
  const value=await collectPilotProcess({testId:randomUUID(),signal:signal.signal,spawnChild:()=>{starts++;},readReceipt:()=>({status:'missing'})});
  assert.equal(starts,0);assert.equal(value.stopped,true);assert.equal(value.terminal,'ATTEMPTED_OUTCOME_UNKNOWN');
});
const expected={success:'SUCCEEDED','400':'HTTP_ERROR','401':'HTTP_ERROR','429':'HTTP_ERROR','500':'HTTP_ERROR',timeout:'ATTEMPTED_OUTCOME_UNKNOWN',
  connection:'ATTEMPTED_OUTCOME_UNKNOWN',before:'FAILED_BEFORE_TRANSPORT',after:'ATTEMPTED_OUTCOME_UNKNOWN',empty:'ATTEMPTED_OUTCOME_UNKNOWN',
  malformed:'ATTEMPTED_OUTCOME_UNKNOWN',cancel:'CANCELLED_AFTER_ATTEMPT',expired:'BLOCKED',blocked:'BLOCKED',noisy:'SUCCEEDED'};
for(const [scenario,terminal]of Object.entries(expected))test('guarded offline subprocess scenario '+scenario,async()=>{
  const result=await launchOfflinePilot(scenario);assert.equal(result.terminal,terminal);assert.equal(result.childClosed,true);
  assert.equal(result.collectorError,['before','after'].includes(scenario)?'nonzero-exit':null);assert.equal(result.evidence.status,'valid');
  const r=result.evidence.receipt;assert.equal(r.domain,'offline-http-test');
  assert.equal(r.expectedModel,'qwen3.7-plus');assert.equal(r.transportInvocations,['before','expired','blocked'].includes(scenario)?0:1);
  if(['before','after'].includes(scenario)){assert.equal(r.complete,false);assert.equal(result.exitCode,scenario==='before'?21:22);}
  else {assert.equal(r.complete,true);assert.equal(result.exitCode,0);}
  if(/^\d+$/.test(scenario))assert.equal(r.httpStatus,Number(scenario));
  if(scenario==='success'){assert.equal(r.inputTokens,248);assert.equal(r.outputTokens,24);assert.equal(r.finishReason,'stop');}
  if(scenario==='noisy'){assert.equal(result.stdout.truncated,true);assert.equal(result.stderr.truncated,true);}
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(JSON.stringify(result).includes('DUMMY-OFFLINE-CREDENTIAL'),false);
});
test('duplicate launcher ID cannot create a second subprocess or reuse an old receipt as new success',async()=>{
  const id=randomUUID(),first=await launchOfflinePilot('success',id),second=await launchOfflinePilot('success',id);
  assert.equal(first.terminal,'SUCCEEDED');assert.equal(second.terminal,'BLOCKED');assert.equal(second.collectorError,'duplicate-or-reservation');
});
test('unsupported simulation never falls through to native transport',async()=>{
  await assert.rejects(launchOfflinePilot('live'));await assert.rejects(launchOfflinePilot('https://private.invalid'));assert.equal(realNetwork,0);
});
test('unknown receipt evidence is never reinterpreted as no remote processing',()=>{
  assert.equal(classifyReceipt({status:'missing'}),'ATTEMPTED_OUTCOME_UNKNOWN');
  assert.equal(classifyReceipt({status:'corrupt'}),'ATTEMPTED_OUTCOME_UNKNOWN');
});
