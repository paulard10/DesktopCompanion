import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPilotReceipt, readPilotReceipt, RECEIPT_DIRECTORY, RECEIPT_BYTES } = require('../../dist/main/visionPilotReceipt.js');
const { classifyReceipt } = await import('../../scripts/vision-pilot-collector.mjs');
// Only this test's explicitly registered IDs are deleted, never an entire directory.
const owned = new Set<string>();
function id() { const value=randomUUID();owned.add(value);return value; }
after(()=>{ for(const file of fs.existsSync(RECEIPT_DIRECTORY)?fs.readdirSync(RECEIPT_DIRECTORY):[])
  if([...owned].some(value=>file.startsWith(value+'.')))fs.unlinkSync(path.join(RECEIPT_DIRECTORY,file)); });
const journal=()=>createPilotReceipt('offline-http-test',id());
function diagnostics(patch:any={}) { return {postAttempts:1,httpStatus:200,providerRequestId:'11111111-2222-4333-8444-555555555555',returnedModel:'qwen3.7-plus',
  finishReason:'stop',reasoningTokens:0,usage:{promptTokens:248,completionTokens:24,totalTokens:272},providerErrorCode:null,providerErrorCategory:null,
  responseBytes:100,totalDurationMs:12,postDurationMs:10,responseText:'OFFLINE FIXTURE answer',...patch}; }
const success={ok:true,kind:'offline-http-test-response',text:'OFFLINE FIXTURE answer',truncated:false,usage:{promptTokens:248,completionTokens:24,totalTokens:272}};
function submitted(j:any) {j.preflight();j.consume(id(),'a'.repeat(64));j.invoke(()=>Promise.resolve());}
test('receipt records the exact causal state sequence, validated HTTP answer and usage',()=>{
  const j=journal();submitted(j);j.response(diagnostics());j.parsed();j.finish(success,diagnostics());
  const result=readPilotReceipt(j.testId);assert.equal(result.status,'valid');const r=result.receipt;
  assert.deepEqual(r.states,['NOT_STARTED','PREFLIGHT_PASSED','AUTHORIZATION_CONSUMED','TRANSPORT_INVOKED','HTTP_RESPONSE_RECEIVED','RESPONSE_PARSED','RESULT_RECORDED']);
  assert.equal(r.terminal,'SUCCEEDED');assert.equal(r.transportInvocations,1);assert.equal(r.inputTokens,248);assert.equal(r.outputTokens,24);
  assert.equal(r.answer,'OFFLINE FIXTURE answer');assert.equal(r.complete,true);assert.equal(classifyReceipt(result),'SUCCEEDED');
});
test('transport count changes only after the dispatch function was called',()=>{
  const j=journal();j.preflight();j.consume(id(),'b'.repeat(64));let calls=0;
  assert.equal(readPilotReceipt(j.testId).receipt.transportInvocations,0);
  j.invoke(()=>{assert.equal(readPilotReceipt(j.testId).receipt.transportInvocations,0);calls++;});
  assert.equal(calls,1);assert.equal(readPilotReceipt(j.testId).receipt.transportInvocations,1);
  assert.throws(()=>j.invoke(()=>calls++));assert.equal(calls,1);
});
test('synchronous dispatch exceptions count as one attempted invocation without retaining errors',()=>{
  const j=journal();j.preflight();j.consume(id(),'c'.repeat(64));assert.throws(()=>j.invoke(()=>{throw Error('PRIVATE');}));
  const r=readPilotReceipt(j.testId);assert.equal(r.receipt.transportInvocations,1);assert.equal(classifyReceipt(r),'ATTEMPTED_OUTCOME_UNKNOWN');
  assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
test('preflight alone does not consume authorization or increment HTTP count',()=>{
  const j=journal();j.preflight();const r=readPilotReceipt(j.testId);assert.equal(r.receipt.authorizationConsumed,false);assert.equal(r.receipt.transportInvocations,0);
  assert.equal(classifyReceipt(r),'FAILED_BEFORE_TRANSPORT');assert.throws(()=>j.invoke(()=>{}));
});
test('crash gap after durable consumption is honestly unknown even before transport marker',()=>{
  const j=journal();j.preflight();j.consume(id(),'d'.repeat(64));const r=readPilotReceipt(j.testId);
  assert.equal(r.receipt.transportInvocations,0);assert.equal(r.receipt.complete,false);assert.equal(classifyReceipt(r),'ATTEMPTED_OUTCOME_UNKNOWN');
});
test('consumed authorization cannot be claimed by another journal after deleting the first receipt',()=>{
  const grant=id(),a=journal(),b=journal();a.preflight();a.consume(grant,'e'.repeat(64));fs.unlinkSync(path.join(RECEIPT_DIRECTORY,a.testId+'.json'));
  b.preflight();assert.throws(()=>b.consume(grant,'e'.repeat(64)));assert.equal(readPilotReceipt(b.testId).receipt.authorizationConsumed,false);
});
test('test IDs are exclusive and old receipt/log identifiers are not grants',()=>{
  const j=journal();assert.throws(()=>createPilotReceipt('offline-http-test',j.testId));assert.throws(()=>j.consume(j.testId,'f'.repeat(64)));
});
test('atomic replace failure retains the prior snapshot and removes temporary output',()=>{
  const j=journal(),previous=fs.readFileSync(path.join(RECEIPT_DIRECTORY,j.testId+'.json'),'utf8'),rename=fs.renameSync;
  fs.renameSync=()=>{throw Error('simulated replace failure');};try{assert.throws(()=>j.preflight());}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(path.join(RECEIPT_DIRECTORY,j.testId+'.json'),'utf8'),previous);
  assert.equal(fs.readdirSync(RECEIPT_DIRECTORY).some((p:string)=>p.startsWith(j.testId+'.')&&p.endsWith('.tmp')),false);
});
for(const mutation of [ (r:any)=>r.answer='data:image/png;base64,PRIVATE', (r:any)=>r.answer='Bearer PRIVATE',
  (r:any)=>r.answer='sk-SECRET', (r:any)=>r.answer='x'.repeat(1601), (r:any)=>r.extra='Authorization: PRIVATE',
  (r:any)=>r.expectedModel='other-model',(r:any)=>r.httpStatus=200,(r:any)=>r.terminal='SUCCEEDED',
  (r:any)=>{r.state='RESULT_RECORDED';r.states.push(r.state);r.complete=true;r.terminal='SUCCEEDED';} ])
  test('corrupt or sensitive receipt cannot produce success '+mutation.toString().slice(0,65),()=>{
    const j=journal(),file=path.join(RECEIPT_DIRECTORY,j.testId+'.json'),r=JSON.parse(fs.readFileSync(file,'utf8'));mutation(r);fs.writeFileSync(file,JSON.stringify(r));
    assert.equal(readPilotReceipt(j.testId).status,'corrupt');assert.equal(classifyReceipt(readPilotReceipt(j.testId)),'ATTEMPTED_OUTCOME_UNKNOWN');
  });
test('missing, partial JSON and oversized files cannot be treated as successful',()=>{
  assert.equal(readPilotReceipt(id()).status,'missing');const j=journal(),file=path.join(RECEIPT_DIRECTORY,j.testId+'.json');
  fs.writeFileSync(file,'{');assert.equal(readPilotReceipt(j.testId).status,'corrupt');
  fs.writeFileSync(file,' '.repeat(RECEIPT_BYTES+1));assert.equal(readPilotReceipt(j.testId).status,'corrupt');
  assert.equal(readPilotReceipt('../provider-settings').status,'corrupt');
});
test('receipt only projects safe fields, never input keys, images, private errors or hidden reasoning',()=>{
  const j=journal();submitted(j);j.response(diagnostics());j.parsed();j.finish(success,diagnostics({
    Authorization:'Bearer PRIVATE',key:'PRIVATE',image:'data:image/png;base64,PRIVATE',requestBody:{private:'PRIVATE'},reasoning_content:'PRIVATE',stderr:'PRIVATE' }));
  const text=fs.readFileSync(path.join(RECEIPT_DIRECTORY,j.testId+'.json'),'utf8');assert.ok(Buffer.byteLength(text)<=RECEIPT_BYTES);
  for(const word of ['PRIVATE','Authorization','base64','requestBody','reasoning_content','stderr'])assert.equal(text.includes(word),false);
  assert.equal(readPilotReceipt(j.testId).receipt.reasoningTokens,0);
});
test('final result cannot be written twice or inferred from a success-shaped value without parse evidence',()=>{
  const j=journal();j.preflight();j.finish(success,diagnostics({httpStatus:null,responseText:null}));
  assert.equal(readPilotReceipt(j.testId).receipt.terminal,'BLOCKED');assert.throws(()=>j.finish(success,diagnostics()));
});
