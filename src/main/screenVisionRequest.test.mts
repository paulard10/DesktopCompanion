import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fixture } from './visionFixtures.test-support.mts';

const require=createRequire(import.meta.url),restores:(()=>void)[]=[];
let network=0,privateAccess=0,persistence=0,capture=0;
function patch(o:any,k:string,v:any){const previous=o[k];o[k]=v;restores.push(()=>{o[k]=previous;});}
const deny=()=>{network++;throw Error('No real network/process in screen rehearsal tests');};
patch(globalThis,'fetch',deny);if('WebSocket'in globalThis)patch(globalThis,'WebSocket',deny);
for(const n of ['node:http','node:https'])for(const k of ['request','get'])patch(require(n),k,deny);
for(const k of ['connect','createConnection'])patch(require('node:net'),k,deny);
patch(require('node:net').Socket.prototype,'connect',deny);patch(require('node:tls'),'connect',deny);
for(const k of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])patch(require('node:child_process'),k,deny);
for(const k of ['writeFile','writeFileSync','appendFile','appendFileSync','createWriteStream'])patch(require('node:fs'),k,()=>{persistence++;throw Error('No persistence');});
for(const k of ['writeFile','appendFile'])patch(require('node:fs/promises'),k,()=>{persistence++;throw Error('No persistence');});
const Module=require('node:module'),load=Module._load;
patch(Module,'_load',function(name:string,...args:any[]){
  if(/safeCredentialStore|providerSettings|keyVault|qwenVisionTransport|visionPilotReceipt/.test(name)){privateAccess++;throw Error('No private/live dependency');}
  if(name==='electron')return {get safeStorage(){privateAccess++;throw Error('No native secrets');},
    desktopCapturer:{getSources(){capture++;throw Error('No real capture');}},get clipboard(){persistence++;throw Error('No clipboard');}};
  return load.call(this,name,...args);
});
const sessionModule=require('../../dist/main/offlineVisionSession.js');
const mockModule=require('../../dist/main/qwenVisionMock.js');
const wireModule=require('../../dist/main/screenVisionRequest.js');
const {SCREEN_VISION_POLICY,SCREEN_VISION_SIMULATED_LABEL}=require('../../dist/shared/offlineVision.js');
const {encodeSyntheticCrop}=require('../../dist/main/visionImage.js');
const {createVisionMock,visionMockStats}=mockModule;
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const reply=(text='Synthetic reply only')=>JSON.stringify({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]});
function setup(t:any,script:any[]=[{status:200,body:reply(),delayMs:10}],patchCrop:any={},options:any={}){
  t.mock.timers.enable({apis:['Date','setTimeout']});
  const crop={...fixture(),kind:'approved-local-crop',...patchCrop},notices:any[]=[],handle=createVisionMock(script);
  const session=sessionModule.createOfflineVisionSession({sessionId:'screen-A',crop,screenTransport:handle,publish:(n:any)=>notices.push(n),...options});
  t.after(()=>session.dispose());let revision=0,question='',scenario='success';
  const send=(a:any)=>session.dispatch({sessionId:'screen-A',...a});
  const edit=(text='  ¿Qué dice este recorte?\nTexto de prueba.  ',s='success')=>{question=text;scenario=s;send({type:'edit',question,scenario,revision:++revision});};
  const review=()=>send({type:'review-screen-dry-run',question,scenario,revision});
  const localReview=()=>send({type:'review',question,scenario,revision});
  const last=()=>notices.at(-1);
  const confirm=(token=last()?.screenToken)=>send({type:'confirm-screen-dry-run',token,revision});
  const tick=async(ms=10)=>{await flush();t.mock.timers.tick(ms);await flush();};
  return{session,crop,notices,handle,send,edit,review,localReview,last,confirm,tick};
}
after(()=>{for(const restore of restores.reverse())restore();assert.deepEqual({network,privateAccess,persistence,capture},{network:0,privateAccess:0,persistence:0,capture:0});});

test('screen live boundary is hard-disabled; construction and typing never dispatch',t=>{
  assert.equal(wireModule.SCREEN_VISION_LIVE_DISABLED,true);assert.equal(SCREEN_VISION_POLICY.liveAvailable,false);
  const f=setup(t);assert.deepEqual(visionMockStats(f.handle),{calls:0,active:0,remaining:1});assert.equal(f.notices.length,0);
  f.edit();assert.equal(f.last().phase,'editing');assert.equal(visionMockStats(f.handle).calls,0);
});
test('local capture and offline-run permissions cannot confirm a screen request',t=>{
  const f=setup(t);f.edit();f.confirm('capture-approval');f.localReview();const local=f.last().token;
  f.confirm(local);assert.equal(f.last().phase,'review');assert.equal(visionMockStats(f.handle).calls,0);
  f.review();f.send({type:'run',token:f.last().screenToken,revision:1});assert.equal(visionMockStats(f.handle).calls,0);
  f.confirm(local);assert.equal(f.last().phase,'screen-review');
});
test('screen review binds exact crop/question/provider/model and does not invoke the fake',t=>{
  const f=setup(t);f.edit();f.review();const n=f.last(),s=n.screenReview;
  assert.equal(n.phase,'screen-review');assert.equal(n.token,undefined);assert.match(n.screenToken,/^screen-review-[a-f0-9-]{36}$/);
  assert.equal(s.purpose,'screen-vision-offline-rehearsal');assert.equal(s.sessionId,'screen-A');assert.equal(s.imageId,n.imageId);
  assert.equal(s.question,n.question);assert.equal(s.model,'qwen3.7-plus');assert.equal(s.provider,'Alibaba Cloud Model Studio');
  assert.equal(s.region,'Singapore');assert.equal(s.outputTokens,160);assert.equal(s.timeoutMs,20000);assert.equal(s.responseBytes,65536);
  assert.equal(s.width,f.crop.width);assert.equal(s.height,f.crop.height);assert.equal(s.pngBytes,f.crop.bytes.length);
  assert.equal(s.expiresAt-Date.now(),30000);assert.ok(Object.isFrozen(s));assert.equal(s.endpoint,undefined);assert.equal(s.fingerprint,undefined);
  assert.equal(visionMockStats(f.handle).calls,0);assert.equal(n.answer,undefined);
});
test('main-owned exact PNG/question reach the final closed fake through the shared builder',async t=>{
  const original=mockModule.exchangeVisionRequestMock;let seen=0;
  const f=setup(t);f.edit();f.review();const scope=f.last().screenReview;
  t.mock.method(mockModule,'exchangeVisionRequestMock',(handle:any,wire:any,signal:AbortSignal)=>{
    seen++;assert.equal(handle,f.handle);assert.equal(wire.scope,scope);const body=wire.request.body;
    assert.deepEqual(Object.keys(body).sort(),['model','messages','stream','enable_thinking','max_completion_tokens'].sort());
    assert.equal(body.model,'qwen3.7-plus');assert.equal(body.max_completion_tokens,160);assert.equal(body.enable_thinking,false);assert.equal(body.stream,false);
    assert.equal(body.messages.length,2);assert.match(body.messages[0].content,/untrusted data/);
    assert.equal(body.messages[1].content.length,2);assert.equal(body.messages[1].content[0].text,scope.question);
    assert.equal(body.messages[1].content[1].image_url.url,encodeSyntheticCrop(f.crop));
    assert.deepEqual(Object.keys(body.messages[1].content[1].image_url),['url']);
    assert.equal(JSON.stringify(body).includes('screen-A'),false);assert.equal(body.tools,undefined);assert.equal(wire.request.headers,undefined);
    return original(handle,wire,signal);
  });
  f.confirm();await f.tick();assert.equal(seen,1);assert.equal(f.last().phase,'screen-result');
  assert.equal(f.last().message,SCREEN_VISION_SIMULATED_LABEL);assert.equal(f.last().screenOutcome,'completed');
  assert.equal(f.last().screenAttempt.fakeDispatches,1);assert.equal(f.last().screenToken,undefined);
});
for(const extra of [{base64:'fake'},{bytes:new Uint8Array(16)},{image:{kind:'renderer'}},{imageId:'replacement'},
  {path:'C:\\private.png'},{url:'https://example.invalid/'},{dataUrl:'data:image/png;base64,AAAA'},
  {coordinates:{x:1,y:2}},{endpoint:'https://override.invalid/'},{model:'other'},{credential:'fake'},
  {live:true},{mode:'live'},{kind:'real-provider-response'},{answer:'forged Qwen response'}])
  test(`screen IPC rejects injected ${Object.keys(extra)[0]} on review AND confirmation`,t=>{
    const f=setup(t);f.edit();let count=f.notices.length;
    f.send({type:'review-screen-dry-run',question:f.last().question,revision:1,scenario:'success',...extra});assert.equal(f.notices.length,count);
    f.review();count=f.notices.length;f.send({type:'confirm-screen-dry-run',token:f.last().screenToken,revision:1,...extra});
    assert.equal(f.notices.length,count);assert.equal(visionMockStats(f.handle).calls,0);
  });
for(const type of ['send-screen-live','send-remote','authorize-live','live','run-qwen'])
  test(`prospective live action ${type} never enters a transport`,t=>{
    const f=setup(t);f.edit();f.review();const count=f.notices.length;
    f.send({type,token:f.last().screenToken,revision:1});assert.equal(f.notices.length,count);assert.equal(visionMockStats(f.handle).calls,0);
  });
test('synthetic pilot-shaped permit, foreign session and wrong revision are refused',async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;
  f.confirm({scope:'one-synthetic-vision-request'});f.send({type:'confirm-screen-dry-run',sessionId:'foreign',token,revision:1});
  f.send({type:'confirm-screen-dry-run',token,revision:9});assert.equal(visionMockStats(f.handle).calls,0);
  f.confirm(token);await f.tick();assert.equal(visionMockStats(f.handle).calls,1);
});
test('duplicate confirmations and replay after success remain one consumed attempt',async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;f.confirm(token);f.confirm(token);f.review();await f.tick();f.confirm(token);
  assert.equal(visionMockStats(f.handle).calls,1);assert.equal(f.notices.filter(n=>n.phase==='screen-result').length,1);
  assert.equal(f.last().screenAttempt.consumed,true);
});
for(const change of ['edit','scenario','cancel','discard','close','replacement'])test(`${change} revokes unused screen permission`,async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;
  if(change==='edit')f.edit('Different question');else if(change==='scenario')f.edit(f.last().question,'unknown');
  else if(change==='cancel')f.send({type:'cancel'});else f.session.dispose();
  const count=f.notices.length;f.confirm(token);await f.tick();assert.equal(visionMockStats(f.handle).calls,0);assert.equal(f.notices.length,count);
});
test('new image session does not inherit previous scope/token',t=>{
  const a=setup(t);a.edit();a.review();const token=a.last().screenToken,imageId=a.last().imageId;a.session.dispose();
  // Same public session string in this synthetic test still cannot reuse a capability.
  const b=setupWithoutClock(t);b.edit();b.review();b.confirm(token);assert.notEqual(b.last().imageId,imageId);assert.equal(visionMockStats(b.handle).calls,0);
});
function setupWithoutClock(t:any){
  const handle=createVisionMock([{status:200,body:reply()}]),notices:any[]=[];
  const session=sessionModule.createOfflineVisionSession({sessionId:'screen-A',crop:{...fixture(),kind:'approved-local-crop'},screenTransport:handle,publish:(n:any)=>notices.push(n)});
  t.after(()=>session.dispose());const send=(a:any)=>session.dispatch({sessionId:'screen-A',...a});
  return{handle,last:()=>notices.at(-1),edit:()=>send({type:'edit',question:'New',revision:1,scenario:'success'}),
    review:()=>send({type:'review-screen-dry-run',question:'New',revision:1,scenario:'success'}),confirm:(token:any)=>send({type:'confirm-screen-dry-run',token,revision:1})};
}
test('30-second review expiry rejects confirmation without dispatch',t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;t.mock.timers.tick(30000);f.confirm(token);
  assert.equal(visionMockStats(f.handle).calls,0);assert.match(f.last().message,/expired/);
});
test('preview expiry invalidates unused consent and cannot reopen a result',async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;t.mock.timers.tick(120000);f.confirm(token);await flush();
  assert.equal(visionMockStats(f.handle).calls,0);assert.match(f.last().message,/preview expired/);const count=f.notices.length;f.edit();assert.equal(f.notices.length,count);
});
test('review expiry clips to remaining preview lifetime',t=>{
  const f=setup(t);t.mock.timers.tick(110000);f.edit();f.review();assert.equal(f.last().screenReview.expiresAt,f.last().previewExpiresAt);
});
test('canonical bytes changed after review prevent fake dispatch',t=>{
  const f=setup(t);f.edit();f.review();f.crop.bytes[50]^=1;f.confirm();assert.equal(visionMockStats(f.handle).calls,0);assert.match(f.last().message,/changed/);
});
test('cancel before dispatch prevents invocation while keeping the authorization consumed',async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;f.confirm(token);f.send({type:'cancel'});await flush();
  assert.equal(visionMockStats(f.handle).calls,0);assert.equal(f.last().screenAttempt.consumed,true);assert.equal(f.last().screenAttempt.fakeDispatches,0);
  f.confirm(token);assert.equal(visionMockStats(f.handle).calls,0);
});
test('cancel after dispatch prevents retry/stale response and cannot overlap another attempt',async t=>{
  const f=setup(t,[{failure:'pending'}]);f.edit();f.review();const token=f.last().screenToken;f.confirm(token);await flush();assert.equal(visionMockStats(f.handle).calls,1);
  f.send({type:'cancel'});f.review();f.confirm(token);await flush();t.mock.timers.tick(25000);await flush();
  assert.equal(visionMockStats(f.handle).calls,1);assert.equal(f.last().phase,'editing');assert.equal(f.last().screenAttempt.fakeDispatches,1);
  assert.match(f.last().message,/could still be processed or billed/);assert.equal(f.notices.some(n=>n.phase==='screen-result'),false);
});
for(const close of ['discard','close','edit'])test(`${close} during in-flight fake drops its late outcome`,async t=>{
  const f=setup(t);f.edit();f.review();f.confirm();await flush();
  if(close==='edit')f.edit('New question');else f.session.dispose();const count=f.notices.length;await f.tick(30000);
  assert.equal(f.notices.length,count);assert.equal(visionMockStats(f.handle).calls,1);assert.equal(f.notices.some(n=>n.phase==='screen-result'),false);
});
test('consent expiry AFTER dispatch does not grant a second attempt or discard a timely reply',async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;t.mock.timers.tick(29995);f.confirm(token);await f.tick();
  assert.equal(f.last().phase,'screen-result');f.confirm(token);assert.equal(visionMockStats(f.handle).calls,1);
});
test('preview expiration while in flight drops outcome without extending the window',async t=>{
  const f=setup(t,[{failure:'pending'}]);t.mock.timers.tick(119900);f.edit();f.review();f.confirm();await f.tick(101);
  assert.equal(visionMockStats(f.handle).calls,1);assert.equal(f.notices.some(n=>n.phase==='screen-result'),false);const count=f.notices.length;f.edit();assert.equal(f.notices.length,count);
});
test('fake timeout is UNKNOWN, finite, consumed and not retried',async t=>{
  const f=setup(t,[{failure:'pending'}]);f.edit();f.review();const token=f.last().screenToken;f.confirm();await f.tick(20000);
  assert.equal(f.last().screenOutcome,'unknown');assert.match(f.last().message,/timeout/);assert.equal(f.last().answer,undefined);
  f.confirm(token);await f.tick(20000);assert.equal(visionMockStats(f.handle).calls,1);
});
test('unknown fake transport outcome is not a success and cannot replay',async t=>{
  const f=setup(t,[{failure:'unavailable',delayMs:10}]);f.edit();f.review();const token=f.last().screenToken;f.confirm();await f.tick();
  assert.equal(f.last().phase,'screen-error');assert.equal(f.last().screenOutcome,'unknown');assert.equal(f.last().answer,undefined);f.confirm(token);assert.equal(visionMockStats(f.handle).calls,1);
});
for(const [status,code] of [[400,'invalid'],[401,'authentication'],[429,'rate-limit'],[500,'unavailable']] as const)
  test(`fake HTTP ${status} reports ${code} without retries`,async t=>{
    const f=setup(t,[{status,body:'{}',delayMs:10}]);f.edit();f.review();const token=f.last().screenToken;f.confirm();await f.tick();
    assert.equal(f.last().screenOutcome,'failed');assert.match(f.last().message,new RegExp(code));assert.equal(f.last().answer,undefined);
    f.confirm(token);await f.tick(1000);assert.equal(visionMockStats(f.handle).calls,1);
  });
test('64-KiB fake response cap is enforced before parsing',async t=>{
  const f=setup(t,[{status:200,body:'x'.repeat(65537),delayMs:10}]);f.edit();f.review();f.confirm();await f.tick();
  assert.match(f.last().message,/response-too-large/);assert.equal(f.last().answer,undefined);assert.equal(visionMockStats(f.handle).calls,1);
});
test('fake response with another request ID is UNKNOWN and its text is discarded',async t=>{
  const f=setup(t,[{status:200,body:reply('STALE TEXT'),delayMs:10,replyTo:'another-request'}]);f.edit();f.review();f.confirm();await f.tick();
  assert.equal(f.last().screenOutcome,'unknown');assert.match(f.last().message,/stale/);assert.equal(f.last().answer,undefined);
});
test('prepared request mutation is refused before fake dispatch; the attempted wire cannot replay',async t=>{
  const f=setup(t);f.edit();f.review();const scope=f.last().screenReview;
  const prepared=wireModule.prepareScreenVisionRequest(f.crop,scope,'https://offline-ux.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1');
  prepared.wire.request.body.messages[1].content[0].text='replacement';const attempt={fakeDispatches:0},signal=new AbortController().signal;
  const first=await wireModule.executeScreenVisionMock(prepared.wire,f.handle,signal,attempt);
  const replay=await wireModule.executeScreenVisionMock(prepared.wire,f.handle,signal,attempt);
  assert.equal(first.code,'invalid-request');assert.equal(replay.code,'duplicate');assert.equal(visionMockStats(f.handle).calls,0);
});
for(const [name,patch] of [['PNG',{bytes:new Uint8Array(20)}],['byte budget',{bytes:new Uint8Array(2*1024*1024+1)}],['pixel budget',{width:2048,height:2048}]] as const)
  test(`screen review rejects ${name} and retains local preview/discard`,t=>{
    const f=setup(t,undefined,patch);f.edit();f.review();assert.equal(f.last().phase,'error');assert.match(f.last().message,/Preview and Discard remain available/);
    assert.equal(f.last().screenToken,undefined);assert.equal(visionMockStats(f.handle).calls,0);
  });
for(const q of ['', ' \n ', 'x'.repeat(501), 'x\0', '\ud800'])test(`invalid screen question ${JSON.stringify(q.slice(0,8))} cannot authorize`,t=>{
  const f=setup(t);f.edit(q);f.review();assert.equal(f.last().screenToken,undefined);assert.equal(visionMockStats(f.handle).calls,0);
});
test('500-character screen question is accepted exactly',t=>{
  const f=setup(t);const q='ñ'.repeat(500);f.edit(q);f.review();assert.equal(f.last().screenReview.question,q);
});
test('non-registered fake or native callback cannot be injected as a screen transport',()=>{
  for(const screenTransport of [{mode:'offline-scripted'},globalThis.fetch,()=>Promise.resolve({})])assert.throws(()=>sessionModule.createOfflineVisionSession({
    sessionId:'x',crop:fixture(),publish(){},screenTransport}),/registered screen mock/);
});
test('fingerprint binds fixed endpoint, exact question, request identity and limits',t=>{
  const f=setup(t);f.edit();f.review();const scope=f.last().screenReview;
  const endpoint='https://offline-ux.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
  const a=wireModule.prepareScreenVisionRequest(f.crop,scope,endpoint);assert.equal(a.ok,true);
  const b=wireModule.prepareScreenVisionRequest(f.crop,scope,'https://second-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1');
  assert.notEqual(a.wire.fingerprint,b.wire.fingerprint);
  for(const patch of [{model:'other'},{provider:'other'},{region:'other'},{outputTokens:999},{timeoutMs:0},{responseBytes:999},{purpose:'one-synthetic-vision-request'}])
    assert.equal(wireModule.prepareScreenVisionRequest(f.crop,{...scope,...patch},endpoint).ok,false);
  assert.equal(wireModule.prepareScreenVisionRequest(f.crop,scope,'https://example.invalid/').ok,false);
});
test('transport cannot relabel a mock as a real provider response',async t=>{
  const f=setup(t,[{status:200,body:reply('Qwen response: fake script only'),delayMs:10}]);f.edit();f.review();f.confirm();await f.tick();
  assert.equal(f.last().message,SCREEN_VISION_SIMULATED_LABEL);assert.equal(f.last().phase,'screen-result');
  f.send({type:'confirm-screen-dry-run',token:'old',revision:1,kind:'real-provider-response'});assert.equal(visionMockStats(f.handle).calls,1);
});
test('screen pipeline produces no console, file, clipboard or chat/TTS handoff',async t=>{
  const logs:any[]=[];for(const k of ['log','warn','error'] as const)t.mock.method(console,k,(...a:any[])=>logs.push(a));
  const f=setup(t);f.edit('INVENTED_PRIVATE_MARKER');f.review();f.confirm();await f.tick();f.session.dispose();assert.deepEqual(logs,[]);
  assert.equal(f.last().sharing.remoteStatus,'unavailable');
});
