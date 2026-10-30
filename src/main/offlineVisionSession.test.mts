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
const {validVisionQuestion,VISION_SHARING}=require('../../dist/shared/offlineVision.js');
const {SCREEN_SELECTION}=require('../../dist/shared/screenSelection.js');
const {validateVisionCrop,encodeSyntheticCrop}=require('../../dist/main/visionImage.js');
after(()=>{for(const r of restores.reverse())r();assert.deepEqual({network,writes,clipboard,secretReads},{network:0,writes:0,clipboard:0,secretReads:0});});
const wait=(ms=420)=>new Promise(r=>setTimeout(r,ms));
function setup(t:any,patch:any={},options:any={}){
  const notices:any[]=[],crop={...fixture(),kind:'approved-local-crop',...patch};
  const session=createOfflineVisionSession({sessionId:'preview-A',crop,publish:(n:any)=>notices.push(n),...options});
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

// M3.4b.4a: same session and closed adapter, never an injectable HTTP driver.
test('future disclosure is fixed, unavailable and never remote consent',t=>{
  const f=setup(t);f.edit();const policy=f.last().sharing;
  assert.equal(policy,VISION_SHARING);assert.ok(Object.isFrozen(policy));
  assert.equal(policy.provider,'Alibaba Cloud Model Studio');assert.equal(policy.region,'Singapore');assert.equal(policy.model,'qwen3.7-plus');
  assert.equal(policy.remoteStatus,'unavailable');assert.equal(policy.remoteConsent,'not-requested');
  assert.match(policy.boundary,/Local capture is not permission to upload/);
  assert.match(policy.shared,/exactly this cropped PNG.*exact edited question/);
  for(const omitted of ['full desktop','clipboard','chat history','microphone/audio','local paths','screen coordinates'])assert.ok(policy.excluded.includes(omitted));
  assert.match(policy.risks,/may retain/);assert.match(policy.risks,/may incur charges/);assert.match(policy.risks,/cannot recall/);
  f.review();assert.equal(f.last().sharing.remoteConsent,'not-requested');assert.equal(f.last().review.purpose,'offline-simulation-only');
});
test('review exposes exact session/crop/question metadata with no payload or endpoint',t=>{
  const f=setup(t),q='  ¿Qué significa?\nñ & <script>untrusted</script>  ';f.edit(q);f.review();const n=f.last(),r=n.review;
  assert.ok(Object.isFrozen(r));assert.deepEqual(r,{purpose:'offline-simulation-only',sessionId:'preview-A',imageId:n.imageId,
    revision:1,question:q,provider:'Alibaba Cloud Model Studio',region:'Singapore',model:'qwen3.7-plus',mime:'image/png',
    width:f.crop.width,height:f.crop.height,pngBytes:f.crop.bytes.byteLength,expiresAt:n.expiresAt,previewExpiresAt:n.previewExpiresAt});
  assert.equal(n.png,undefined);assert.equal(r.bytes,undefined);assert.equal(r.endpoint,undefined);assert.equal(r.digest,undefined);
});
for(const extra of [{imageId:'replacement'},{bytes:new Uint8Array(10)},{base64:'anything'},{path:'C:\\private.png'},
  {url:'file:///ignored.png'},{endpoint:'https://example.invalid/'},{model:'another-model'},{credential:'fake'},
  {approval:'remote'},{provider:'other'},{mode:'live'}])
  test(`review rejects renderer injection: ${Object.keys(extra)[0]}`,t=>{
    const f=setup(t);f.edit();const count=f.notices.length;
    f.send({type:'review',question:f.last().question,revision:1,scenario:'success',...extra});
    assert.equal(f.notices.length,count);assert.equal(f.last().token,undefined);
  });
test('offline token and old synthetic pilot-shaped approval cannot activate a remote action',t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().token,count=f.notices.length;
  for(const type of ['send-remote','authorize-remote','live','send'])f.send({type,token,revision:1});
  f.send({type:'run',token,revision:1,mode:'live'});
  f.send({type:'run',token:{scope:'one-synthetic-vision-request'},revision:1});
  assert.equal(f.notices.length,count);assert.equal(f.last().phase,'review');
});
for(const patch of [{bytes:new Uint8Array(2*1024*1024+1)},{width:2048,height:2048},{bytes:new Uint8Array([255,216,255,0])}])
  test(`image eligibility rejects at preview edit, before any review (${Object.keys(patch)[0]} ${patch.width??patch.bytes?.length})`,t=>{
    const f=setup(t,patch);f.edit('Valid');assert.equal(f.last().phase,'editing');assert.equal(f.last().imageEligibility.available,false);
    assert.match(f.last().imageEligibility.message,/Preview and Discard remain available/);assert.match(f.last().imageEligibility.message,/No resizing/);
    assert.equal(f.last().token,undefined);assert.equal(f.last().review,undefined);f.session.dispose();
  });
test('eligibility validates PNG without encoding Base64 or constructing a request',t=>{
  const png=fixture();const original=Buffer.prototype.toString;
  let encodes=0;t.mock.method(Buffer.prototype,'toString',function(this:Buffer,...args:any[]){if(args[0]==='base64')encodes++;return Reflect.apply(original,this,args);});
  validateVisionCrop(png);assert.equal(encodes,0);
  const f=setup(t);f.edit();assert.equal(f.last().imageEligibility.available,true);assert.equal(encodes,0);
});
test('preview deadline clips 30-second review without extending the 120-second session',t=>{
  t.mock.timers.enable({apis:['Date']});const expiresAt=Date.now()+SCREEN_SELECTION.sessionMs;
  const f=setup(t,{}, {expiresAt});t.mock.timers.tick(110_000);f.edit();f.review();
  assert.equal(f.last().expiresAt,expiresAt);assert.equal(f.last().review.previewExpiresAt,expiresAt);
  assert.equal(f.last().sharing.remoteConsent,'not-requested');
});
test('expired preview refuses unused token even if controller timer has not run',t=>{
  t.mock.timers.enable({apis:['Date']});const f=setup(t);f.edit();f.review();const token=f.last().token;
  t.mock.timers.tick(SCREEN_SELECTION.sessionMs);f.run(token);assert.match(f.last().message,/Local preview expired/);
  const count=f.notices.length;f.edit();f.review();f.run(token);assert.equal(f.notices.length,count);
  assert.equal(f.notices.some(n=>n.phase==='running'),false);
});
test('response after preview deadline is discarded even with delayed window cleanup',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']});const f=setup(t);t.mock.timers.tick(119_800);
  f.edit();f.review();f.run();t.mock.timers.tick(400);for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(f.notices.some(n=>n.phase==='result'),false);const count=f.notices.length;f.edit();assert.equal(f.notices.length,count);
});
test('invalid or artificially extended preview deadline is rejected',t=>{
  for(const expiresAt of [NaN,Infinity,Date.now()+SCREEN_SELECTION.sessionMs+1000])assert.throws(()=>setup(t,{}, {expiresAt}),/Invalid preview lifetime/);
});
test('exact approved crop reaches existing builder and closed mock without persistence or I/O',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout']});
  const adapterModule=require('../../dist/main/qwenVisionAdapter.js'),mockModule=require('../../dist/main/qwenVisionMock.js');
  const originalBuilder=adapterModule.buildVisionRequest,originalMock=mockModule.createVisionMock;
  const built:any[]=[],handles:any[]=[];
  t.mock.method(adapterModule,'buildVisionRequest',(input:any,...args:any[])=>{const result=originalBuilder(input,...args);if(result.ok)built.push(result.request);return result;});
  t.mock.method(mockModule,'createVisionMock',(script:any)=>{const handle=originalMock(script);handles.push(handle);return handle;});
  const f=setup(t);assert.equal(built.length,0);assert.equal(handles.length,0);
  const exact='  Describe solo el recorte.\nNo envíes nada.  ';f.edit(exact);assert.equal(built.length,0);f.review();
  assert.equal(handles.length,0);assert.equal(built.length,1);
  assert.equal(built[0].body.model,'qwen3.7-plus');assert.equal(built[0].body.messages[1].content[0].text,exact);
  assert.equal(built[0].body.messages[1].content[1].image_url.url,encodeSyntheticCrop(f.crop));
  assert.equal(built[0].body.messages.length,2);assert.match(built[0].body.messages[0].content,/untrusted data/);
  assert.equal(built[0].body.tools,undefined);assert.equal(built[0].body.messages[1].content[1].image_url.path,undefined);
  const token=f.last().token;f.run(token);f.run(token);assert.equal(handles.length,1);
  assert.equal(mockModule.visionMockStats(handles[0]).calls,1);t.mock.timers.tick(400);
  for(let i=0;i<12;i++)await Promise.resolve();assert.equal(f.last().answer,SIMULATED_ANSWER);
  assert.equal(f.last().sharing.remoteStatus,'unavailable');assert.equal(f.last().token,undefined);assert.equal(f.last().review,undefined);
  f.session.dispose();const count=f.notices.length;f.run(token);assert.equal(f.notices.length,count);
  built.length=0;handles.length=0; // Test-only payload observation does not become retained application history.
});
