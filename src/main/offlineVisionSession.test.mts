import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import { fixture } from './visionFixtures.test-support.mts';

const require = createRequire(import.meta.url), restores: (()=>void)[] = [];
let network=0, writes=0, clipboard=0, secretReads=0;
function patch(o:any,k:string,v:any){const old=o[k];o[k]=v;restores.push(()=>{o[k]=old;});}
const deny=()=>{network++;throw Error('Forbidden offline I/O');};
patch(globalThis,'fetch',deny);if('WebSocket'in globalThis)patch(globalThis,'WebSocket',deny);
for(const mod of ['node:http','node:https'])for(const key of ['request','get'])patch(require(mod),key,deny);
for(const key of ['connect','createConnection'])patch(require('node:net'),key,deny);
patch(require('node:net').Socket.prototype,'connect',deny);patch(require('node:tls'),'connect',deny);
for(const key of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])patch(require('node:child_process'),key,deny);
for(const key of ['writeFile','writeFileSync','appendFile','appendFileSync','createWriteStream'])
  patch(require('node:fs'),key,()=>{writes++;throw Error('Forbidden persistence');});
for(const key of ['writeFile','appendFile'])patch(require('node:fs/promises'),key,()=>{writes++;throw Error('Forbidden persistence');});
// Fail closed if a future import attempts to reach Electron clipboard/credentials.
const Module=require('node:module'), load=Module._load;
patch(Module,'_load',function(id:string,...args:any[]){
  if(id==='electron')return {clipboard:{write(){clipboard++;throw Error('Forbidden clipboard');}},
    safeStorage:{decryptString(){secretReads++;throw Error('Forbidden secrets');}}};
  if(/providerSettings|safeCredentialStore|keyVault/.test(id)){secretReads++;throw Error('Forbidden credentials');}
  return load.call(this,id,...args);
});
const {createOfflineVisionSession,OFFLINE_APPROVAL_MS,SIMULATED_ANSWER}=require('../../dist/main/offlineVisionSession.js');
const {validVisionQuestion}=require('../../dist/shared/offlineVision.js');
after(()=>{for(const r of restores.reverse())r();assert.deepEqual({network,writes,clipboard,secretReads},{network:0,writes:0,clipboard:0,secretReads:0});});
const wait=(ms=420)=>new Promise(r=>setTimeout(r,ms));
function setup(t:any,patch:any={}){
  const notices:any[]=[],crop={...fixture(),kind:'approved-local-crop',...patch};
  const session=createOfflineVisionSession({sessionId:'preview-A',crop,publish:(n:any)=>notices.push(n)});
  t.after(()=>session.dispose());
  let revision=0,question='',scenario='success';
  const send=(a:any)=>session.dispatch({sessionId:'preview-A',...a});
  const edit=(text='¿Qué significa este error?',outcome='success')=>{question=text;scenario=outcome;send({type:'edit',question,scenario,revision:++revision});};
  const review=()=>send({type:'review',question,scenario,revision});
  const last=()=>notices.at(-1);
  const run=(token=last()?.token)=>send({type:'run',token,revision});
  return{session,crop,notices,last,send,edit,review,run};
}
test('creating a preview session starts no operation or idle timer',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=setup(t);assert.equal(f.notices.length,0);
  t.mock.timers.tick(60_001);assert.equal(f.notices.length,0);
});
test('typing does not review or execute; exact Spanish wording is preserved',t=>{
  const f=setup(t),q='  ¿Qué dice?\nCon acentos: ñ.  ';f.edit(q);assert.equal(f.last().phase,'editing');
  assert.equal(f.last().question,q);assert.equal(f.last().token,undefined);assert.equal(f.last().answer,undefined);
});
for(const [name,value,valid] of [['empty','',false],['spaces','  \n ',false],['limit','a'.repeat(500),true],
  ['excess','a'.repeat(501),false],['control','x\0',false],['lone surrogate','\ud800',false],['Spanish','¿Cómo estás?',true]] as const)
  test(`question validation ${name}`,()=>assert.equal(validVisionQuestion(value),valid));
test('empty review cannot grant consent',t=>{const f=setup(t);f.edit('');f.review();assert.equal(f.last().phase,'error');assert.equal(f.last().token,undefined);});
test('review binds exact question and one opaque image identity without pixels',t=>{
  const f=setup(t);f.edit();const image=f.last().imageId;f.review();const n=f.last();
  assert.equal(n.phase,'review');assert.equal(n.imageId,image);assert.match(n.token,/^[0-9a-f-]{36}$/);
  assert.ok(n.expiresAt>Date.now());assert.equal(n.question,'¿Qué significa este error?');
  assert.equal(JSON.stringify(n).includes('base64'),false);assert.equal(n.png,undefined);
});
test('no reviewed token means no operation',t=>{const f=setup(t);f.edit();f.run('not-reviewed');assert.equal(f.last().phase,'editing');});
test('unreviewed question/scenario/revision cannot silently change review',t=>{
  const f=setup(t);f.edit();for(const p of [{question:'different'},{revision:999},{scenario:'timeout'}])
    f.send({type:'review',question:'¿Qué significa este error?',revision:1,scenario:'success',...p});
  assert.equal(f.last().phase,'editing');
});
test('foreign session, extra bytes, path and URL arguments are rejected',t=>{
  const f=setup(t);f.edit();const count=f.notices.length;
  for(const p of [{sessionId:'old'},{png:fixture().bytes},{url:'https://invalid/'},{path:'ignored'}])
    f.send({type:'review',question:'¿Qué significa este error?',revision:1,scenario:'success',...p});
  assert.equal(f.notices.length,count);
});
test('editing after review revokes old authorization and never infers a new question',t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().token;f.edit('Otra pregunta');f.run(token);
  assert.equal(f.last().phase,'editing');assert.equal(f.last().question,'Otra pregunta');assert.equal(f.last().token,undefined);
});
test('scenario change invalidates review and requires another explicit review',t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().token;f.edit('¿Qué significa este error?','empty');f.run(token);assert.equal(f.last().phase,'editing');
});
test('oversized edit revokes an earlier reviewed capability instead of keeping old consent',t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().token;f.edit('a'.repeat(501));f.run(token);
  assert.equal(f.last().phase,'error');assert.equal(f.last().token,undefined);assert.equal(f.last().question,'');
});
test('expired consent cannot execute',t=>{
  t.mock.timers.enable({apis:['Date']});const f=setup(t);f.edit();f.review();const token=f.last().token;
  t.mock.timers.tick(OFFLINE_APPROVAL_MS);f.run(token);assert.equal(f.last().phase,'editing');assert.match(f.last().message,/expired/);
});
test('wrong token or revision cannot consume the valid reviewed operation',t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().token;
  f.run('wrong');f.send({type:'run',token,revision:999});assert.equal(f.last().phase,'review');
  f.run(token);assert.equal(f.last().phase,'running');
});
test('duplicate clicks and replay after completion cannot duplicate a simulation',async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().token;f.run(token);f.run(token);f.review();await wait();f.run(token);
  assert.equal(f.notices.filter(n=>n.phase==='running').length,1);assert.equal(f.notices.filter(n=>n.phase==='result').length,1);
  assert.equal(f.last().answer,SIMULATED_ANSWER);assert.match(f.last().message,/Simulated response — no AI was called/);
});
test('static simulated answer never invents screenshot or question details',async t=>{
  const f=setup(t);f.edit('PRIVATE_FAKE_QUESTION');f.review();f.run();await wait();
  assert.equal(f.last().answer.includes('PRIVATE_FAKE_QUESTION'),false);assert.match(f.last().answer,/No visual understanding was performed/);
});
test('cancel review invalidates its capability while retaining editable preview',t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().token;f.send({type:'cancel'});f.run(token);assert.equal(f.last().phase,'editing');
  f.review();assert.notEqual(f.last().token,token);
});
test('cancel running operation drops its late response and permits explicit retry',async t=>{
  const f=setup(t);f.edit();f.review();f.run();f.send({type:'cancel'});await wait();assert.equal(f.last().phase,'editing');
  assert.equal(f.notices.some(n=>n.phase==='result'),false);f.review();f.run();await wait();assert.equal(f.last().phase,'result');
});
test('edit during operation aborts previous generation; old finally cannot erase new result',async t=>{
  const f=setup(t);f.edit();f.review();f.run();f.edit('Nueva');f.review();f.run();await wait();
  assert.equal(f.last().phase,'result');assert.equal(f.last().question,'Nueva');assert.equal(f.notices.filter(n=>n.phase==='result').length,1);
});
for(const reason of ['discard','window close','replacement','shutdown','session invalidation'])
  test(`${reason} releases operation and suppresses all later publication`,async t=>{
    const f=setup(t);f.edit();f.review();const token=f.last().token;f.run();f.session.dispose();const count=f.notices.length;
    await wait();f.run(token);f.edit();assert.equal(f.notices.length,count);
  });
test('token from old image/session cannot authorize replacement image',t=>{
  const old=setup(t);old.edit();old.review();const token=old.last().token;old.session.dispose();
  const next=setup(t);next.edit();next.review();assert.notEqual(next.last().imageId,old.last().imageId);
  next.run(token);assert.equal(next.last().phase,'review');
});
test('canonical byte mutation after review invalidates consent rather than substituting crop',t=>{
  const f=setup(t);f.edit();f.review();f.crop.bytes[50]^=1;f.run();assert.equal(f.last().phase,'editing');assert.match(f.last().message,/changed/);
});
for(const [name,patch] of [['invalid PNG',{bytes:new Uint8Array(100)}],['oversized byte buffer',{bytes:new Uint8Array(2*1024*1024+1)}],
  ['oversized pixels',{width:2048,height:2048}],['oversized side',{width:2049}],['full display',{x:0,y:0,sourceWidth:192,sourceHeight:112}]] as const)
  test(`${name} preserves preview/discard but cannot authorize adapter`,t=>{
    const f=setup(t,patch);f.edit();f.review();assert.equal(f.last().phase,'error');assert.match(f.last().message,/Preview and Discard remain available/);
    assert.equal(f.last().token,undefined);f.session.dispose();
  });
for(const outcome of ['empty','rate-limit'])test(`simulated ${outcome} is safe and clearly labeled`,async t=>{
  const f=setup(t);f.edit('Pregunta',outcome);f.review();f.run();await wait();assert.equal(f.last().phase,'error');
  assert.match(f.last().message,/Simulated outcome — no AI was called/);assert.equal(f.last().answer,undefined);
});
test('simulated timeout is finite, not retried and requires review again',async t=>{
  const f=setup(t);f.edit('Pregunta','timeout');f.review();f.run();await wait(1550);
  assert.equal(f.last().phase,'error');assert.match(f.last().message,/timed out/);assert.equal(f.notices.filter(n=>n.phase==='running').length,1);
});
test('image, question and tokens do not enter console logs',async t=>{
  const logs:any[]=[],keys=['log','warn','error'] as const,previous=keys.map(k=>console[k]);
  keys.forEach(k=>{console[k]=(...a:any[])=>logs.push(a);});
  try{const f=setup(t);f.edit('FAKE_PRIVATE_TEXT');f.review();f.run();await wait();assert.deepEqual(logs,[]);}
  finally{keys.forEach((k,i)=>{console[k]=previous[i]!;});}
});
