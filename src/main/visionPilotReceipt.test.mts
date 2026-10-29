import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createVisionPilotTestFixture, VISION_TEST_FILES } from '../../scripts/vision-pilot-test-fixture.mjs';
const require = createRequire(import.meta.url);
const fixture = createVisionPilotTestFixture();
const { createPilotReceipt, readPilotReceipt, RECEIPT_DIRECTORY, RECEIPT_BYTES } = require(fixture.modulePath('dist/main/visionPilotReceipt.js'));
const { classifyReceipt } = await import(fixture.moduleUrl('scripts/vision-pilot-collector.mjs'));
function id() { return randomUUID(); }
after(()=>fixture.dispose());
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
test('expected request scope is durable before authorization and cannot be substituted',()=>{
  const j=journal();j.bindScope('1'.repeat(64));const initial=readPilotReceipt(j.testId).receipt;
  assert.equal(initial.scopeSha256,'1'.repeat(64));assert.equal(initial.state,'NOT_STARTED');assert.equal(initial.authorizationConsumed,false);
  j.preflight();assert.throws(()=>j.consume(id(),'2'.repeat(64)));assert.equal(readPilotReceipt(j.testId).receipt.authorizationConsumed,false);
  j.consume(id(),'1'.repeat(64));assert.equal(readPilotReceipt(j.testId).receipt.authorizationConsumed,true);
});
test('safe returned model, HTTP error category and post duration survive independent receipt readback',()=>{
  const j=journal();submitted(j);j.response(diagnostics({httpStatus:400}));
  j.finish({ok:false,code:'invalid',message:'fixed'},diagnostics({httpStatus:400,responseText:null,returnedModel:'qwen3.7-plus',providerErrorCode:'InvalidParameter',providerErrorCategory:'thinking-setting'}));
  const r=readPilotReceipt(j.testId).receipt;assert.equal(r.terminal,'HTTP_ERROR');assert.equal(r.returnedModel,'qwen3.7-plus');
  assert.equal(r.providerErrorCode,'InvalidParameter');assert.equal(r.providerErrorCategory,'thinking-setting');assert.equal(r.postDurationMs,10);
});
test('historical v1 receipts remain readable without newly optional metadata',()=>{
  const j=journal(),file=path.join(RECEIPT_DIRECTORY,j.testId+'.json'),r=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const field of ['returnedModel','postDurationMs','providerErrorCode','providerErrorCategory'])delete r[field];
  fs.writeFileSync(file,JSON.stringify(r));assert.equal(readPilotReceipt(j.testId).status,'valid');
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

test('fixture uses byte-identical runtime files and never redirects the real receipt store',()=>{
  const real = require('../../dist/main/visionPilotReceipt.js');
  assert.notEqual(RECEIPT_DIRECTORY, real.RECEIPT_DIRECTORY);
  assert.equal(RECEIPT_DIRECTORY,path.join(fixture.directory,'.local-vision-diagnostics'));
  for(const file of VISION_TEST_FILES)assert.ok(fs.readFileSync(fixture.modulePath(file)).equals(fs.readFileSync(path.resolve(file))));
  assert.throws(()=>fixture.modulePath('../provider-settings.json'));
});

test('separate test namespaces cannot read or delete one another, even with the same synthetic ID',()=>{
  const a=createVisionPilotTestFixture(),b=createVisionPilotTestFixture();
  try {
    const left=require(a.modulePath('dist/main/visionPilotReceipt.js')),right=require(b.modulePath('dist/main/visionPilotReceipt.js')),sharedId=randomUUID();
    left.createPilotReceipt('offline-http-test',sharedId);
    assert.equal(right.readPilotReceipt(sharedId).status,'missing');
    right.createPilotReceipt('offline-http-test',sharedId);
    a.dispose();assert.equal(fs.existsSync(a.directory),false);
    assert.equal(right.readPilotReceipt(sharedId).status,'valid');
    assert.equal(fs.existsSync(path.join(right.RECEIPT_DIRECTORY,sharedId+'.run')),true);
  } finally {a.dispose();b.dispose();}
  assert.equal(fs.existsSync(b.directory),false);
});

test('concurrent independent processes cannot both consume one synthetic authorization',async()=>{
  const isolated=createVisionPilotTestFixture(),grant=randomUUID();
  // Fixed source, synthetic IDs only. No driver, provider configuration or secret import.
  const code=`const fs=require('node:fs'),net=require('node:net');let attempts=0;
    const deny=()=>{attempts++;throw Error('Offline only');};globalThis.fetch=deny;
    for(const m of ['node:http','node:https'])for(const k of ['get','request'])require(m)[k]=deny;
    net.connect=net.createConnection=net.Socket.prototype.connect=deny;require('node:tls').connect=deny;
    const {createPilotReceipt}=require(process.argv[1]);
    const j=createPilotReceipt('offline-http-test',process.argv[2]);j.preflight();let claimed=false,rejection=null;
    try{j.consume(process.argv[3],'a'.repeat(64));claimed=true;}catch(error){if(error.code!=='EEXIST')throw error;rejection='duplicate-claim';}
    fs.writeSync(1,JSON.stringify({claimed,rejection,networkAttempts:attempts}));`;
  const run=(testId:string)=>new Promise<any>((resolve,reject)=>{
    const env:Record<string,string>={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key]!;
    const child=spawn(process.execPath,['-e',code,isolated.modulePath('dist/main/visionPilotReceipt.js'),testId,grant],{cwd:isolated.directory,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',invalid=false;const deadline=setTimeout(()=>{invalid=true;isolated.markUnclosed();child.kill();},10000);
    child.stdout.on('data',b=>{if(output.length+b.length>1024)invalid=true;else output+=b.toString();});child.stderr.on('data',()=>{invalid=true;});
    child.once('error',()=>{clearTimeout(deadline);reject(Error('Synthetic claim child unavailable'));});
    child.once('close',exit=>{clearTimeout(deadline);if(exit!==0||invalid)return reject(Error('Synthetic claim child failed'));
      try{resolve(JSON.parse(output));}catch{reject(Error('Synthetic claim output invalid'));}});
  });
  try {
    const ids=[randomUUID(),randomUUID()],results=await Promise.allSettled(ids.map(run));
    for(const result of results)assert.equal(result.status,'fulfilled');
    const values=results.map(r=>{assert.equal(r.status,'fulfilled');return r.value;});
    assert.equal(values.filter(v=>v.claimed).length,1);assert.ok(values.every(v=>v.networkAttempts===0));
    assert.equal(values.find(v=>!v.claimed).rejection,'duplicate-claim');
    const local=require(isolated.modulePath('dist/main/visionPilotReceipt.js'));
    assert.equal(fs.existsSync(path.join(local.RECEIPT_DIRECTORY,grant+'.consumed')),true);
    const receipts=ids.map(id=>{const result=local.readPilotReceipt(id);assert.equal(result.status,'valid');return result.receipt;});
    assert.equal(receipts.filter(r=>r.authorizationConsumed).length,1);assert.ok(receipts.every(r=>r.transportInvocations===0));
  } finally {isolated.dispose();}
});
