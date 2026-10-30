import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire, Module } from 'node:module';
import { fixture as png } from './visionFixtures.test-support.mts';
const require=createRequire(import.meta.url), restores:(()=>void)[]=[];
let network=0,privateAccess=0,writes=0,capture=0;
function patch(o:any,k:string,v:any){const old=o[k];o[k]=v;restores.push(()=>o[k]=old);}
const deny=()=>{network++;throw Error('Actual network/process forbidden');};
patch(globalThis,'fetch',deny);if('WebSocket'in globalThis)patch(globalThis,'WebSocket',deny);
for(const n of ['node:http','node:https'])for(const k of ['request','get'])patch(require(n),k,deny);
for(const k of ['connect','createConnection'])patch(require('node:net'),k,deny);
patch(require('node:net').Socket.prototype,'connect',deny);patch(require('node:tls'),'connect',deny);
for(const k of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])patch(require('node:child_process'),k,deny);
for(const k of ['writeFile','writeFileSync','appendFile','appendFileSync','createWriteStream'])patch(require('node:fs'),k,()=>{writes++;throw Error('No persistence');});
for(const k of ['writeFile','appendFile'])patch(require('node:fs/promises'),k,()=>{writes++;throw Error('No persistence');});
const app={isPackaged:false},load=(Module as any)._load,oldType=(process as any).type;
patch(Module,'_load',function(this:any,id:string,...args:any[]){
  if(/safeCredentialStore|providerSettings|keyVault|visionPilotReceipt/.test(id)){privateAccess++;throw Error('No real vault/settings/receipt');}
  if(id==='electron')return {app,get safeStorage(){privateAccess++;throw Error('No secrets');},
    get clipboard(){writes++;throw Error('No clipboard');},desktopCapturer:{getSources(){capture++;throw Error('No capture');}}};
  return load.call(this,id,...args);
});
(process as any).type='browser';
const wireModule=require('../../dist/main/screenVisionRequest.js');
const {createOfflineVisionSession}=require('../../dist/main/offlineVisionSession.js');
const transportModule=require('../../dist/main/qwenVisionTransport.js');
const bridgeModule=require('../../dist/main/screenVisionBridge.js');
const fakeModule=require('../../dist/main/screenVisionBridgeFake.js');
const {createVisionMock,visionMockStats}=require('../../dist/main/qwenVisionMock.js');
const {encodeSyntheticCrop}=require('../../dist/main/visionImage.js');
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
const body=(text='Offline bridge fixture only. No visual understanding.')=>JSON.stringify({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]});
after(()=>{for(const r of restores.reverse())r();(process as any).type=oldType;assert.deepEqual({network,privateAccess,writes,capture},{network:0,privateAccess:0,writes:0,capture:0});});
function setup(t:any,opts:any={}){
  t.mock.timers.enable({apis:['Date','setTimeout']});
  const crop={...png(),kind:'approved-local-crop',...opts.crop},notices:any[]=[];
  const fake=createVisionMock(opts.script??[{status:200,body:body(),delayMs:10}]);
  const dummy=fakeModule.createVisionBridgeDummy(opts.dummy??{});
  const bridge=bridgeModule.createOfflineScreenVisionBridge({transport:fake,dummy});
  let wire:any,result:any,delegateCalls=0,revision=0,question='',scenario='success';
  const original=wireModule.executeScreenVisionMock;
  if(!opts.normal)t.mock.method(wireModule,'executeScreenVisionMock',(w:any,_h:any,signal:AbortSignal,attempt:any)=>{
    delegateCalls++;wire=w;
    if(opts.mutate)opts.mutate(w);
    const pending=bridge.run(opts.copy?{...w}:w,signal);
    return pending.then((r:any)=>{result=r;attempt.fakeDispatches=r.evidence.fakeDispatches??0;return r;});
  });
  const session=createOfflineVisionSession({sessionId:'bridge-session',crop,publish:(n:any)=>notices.push(n)});
  t.after(()=>{session.dispose();bridge.dispose();});
  const send=(a:any)=>session.dispatch({sessionId:'bridge-session',...a});
  const edit=(q='  ¿Qué contiene este recorte?\nSolo prueba.  ')=>{question=q;send({type:'edit',question,revision:++revision,scenario});};
  const review=()=>send({type:'review-screen-dry-run',question,revision,scenario});
  const confirm=(token=notices.at(-1)?.screenToken)=>send({type:'confirm-screen-dry-run',token,revision});
  const tick=async(ms=10)=>{await flush();t.mock.timers.tick(ms);await flush();};
  return{session,send,crop,notices,edit,review,confirm,tick,fake,dummy,bridge,original,
    last:()=>notices.at(-1),wire:()=>wire,result:()=>result,delegates:()=>delegateCalls,
    calls:()=>visionMockStats(fake).calls,loads:()=>fakeModule.visionBridgeDummyStats(dummy).loads};
}
test('two-stage session confirmation reaches shared HTTP only with dummy credentials and exact crop/question',async t=>{
  const f=setup(t),make=fakeModule.createVisionBridgeHttpMock;let inspected=0;
  t.mock.method(fakeModule,'createVisionBridgeHttpMock',(handle:any,id:string,request:any)=>{
    assert.equal(handle,f.fake);assert.equal(request.body.model,'qwen3.7-plus');assert.equal(request.body.max_completion_tokens,160);
    assert.equal(request.body.stream,false);assert.equal(request.body.enable_thinking,false);
    assert.equal(request.body.messages.length,2);assert.equal(request.body.tools,undefined);
    assert.equal(request.body.messages[1].content[0].text,'  ¿Qué contiene este recorte?\nSolo prueba.  ');
    assert.equal(request.body.messages[1].content[1].image_url.url,encodeSyntheticCrop(f.crop));
    const driver=make(handle,id,request);return (u:any,i:any)=>{inspected++;assert.equal(i.redirect,'error');assert.equal(i.credentials,'omit');
      assert.equal(i.cache,'no-store');assert.equal(i.referrerPolicy,'no-referrer');assert.match(i.headers.Authorization,/^Bearer DUMMY-/);return driver(u,i);};
  });
  assert.equal(f.loads(),0);f.edit();f.review();assert.equal(f.calls(),0);assert.equal(f.loads(),0);
  f.confirm();await f.tick();assert.equal(f.calls(),1);assert.equal(f.loads(),1);assert.equal(inspected,1);
  assert.equal(f.result().kind,'simulated-qwen-response');assert.equal(f.last().phase,'screen-result');
  assert.match(f.last().answer,/Simulated Qwen response/);assert.equal(f.result().usage,undefined);
  assert.equal(f.result().evidence.transport,'closed-fake');assert.equal(f.result().evidence.httpStatus,200);
});
test('a prepared review without confirmed session consent cannot load a dummy or invoke HTTP',async t=>{
  const f=setup(t);f.edit();f.review();const p=wireModule.prepareScreenVisionRequest(f.crop,f.last().screenReview,
    'https://offline-ux.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1');
  const r=await f.bridge.run(p.wire);assert.equal(r.code,'authorization');assert.equal(f.loads(),0);assert.equal(f.calls(),0);
});
for(const copy of [true,false])test(`copied/tampered prepared request rejects (${copy?'copy':'changed body + recomputed hash'})`,async t=>{
  const f=setup(t,{copy,mutate:copy?undefined:(w:any)=>{w.request.body.messages[1].content[0].text='changed';
    w.fingerprint=require('node:crypto').createHash('sha256').update(JSON.stringify({scope:w.scope,request:w.request})).digest('hex');}});
  f.edit();f.review();const token=f.last().screenToken;f.confirm();await f.tick();f.confirm(token);
  assert.equal(f.loads(),0);assert.equal(f.calls(),0);assert.equal(f.last().phase,'screen-error');
});
for(const field of ['sessionId','imageId','question','provider','region','model','endpointPolicy'])
  test(`wrong prepared scope ${field} never reaches dummy acquisition`,async t=>{
    const f=setup(t,{mutate:(w:any)=>{w.scope={...w.scope,[field]:'foreign'};}});f.edit();f.review();f.confirm();await f.tick();
    assert.equal(f.calls(),0);assert.equal(f.loads(),0);assert.equal(f.result().ok,false);
  });
test('endpoint replacement rejects before dummy acquisition',async t=>{
  const f=setup(t,{mutate:(w:any)=>{w.request.url='https://other.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions';}});
  f.edit();f.review();f.confirm();await f.tick();assert.equal(f.calls(),0);assert.equal(f.loads(),0);
});
for(const action of ['edit','cancel','discard','close'])test(`${action} before confirmation invalidates the old authorization`,async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;
  if(action==='edit')f.edit('new');else if(action==='cancel')f.send({type:'cancel'});else f.session.dispose();
  f.confirm(token);await f.tick();assert.equal(f.loads(),0);assert.equal(f.calls(),0);
});
for(const ms of [30000,120000])test(`expired review/session (${ms}) sends and loads nothing`,async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;t.mock.timers.tick(ms);f.confirm(token);await flush();
  assert.equal(f.loads(),0);assert.equal(f.calls(),0);
});
test('simultaneous confirmations/replay and a second bridge cannot dispatch twice',async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;f.confirm(token);f.confirm(token);await f.tick();f.confirm(token);
  const second=bridgeModule.createOfflineScreenVisionBridge({transport:f.fake,dummy:f.dummy});t.after(()=>second.dispose());
  assert.equal((await second.run(f.wire())).code,'duplicate');assert.equal(f.loads(),1);assert.equal(f.calls(),1);assert.equal(f.delegates(),1);
});
for(const [status,code]of [[400,'invalid'],[401,'authentication'],[429,'rate-limit'],[500,'unavailable']]as const)
  test(`shared fake HTTP ${status} classified ${code}, one attempt, no retry`,async t=>{
    const f=setup(t,{script:[{status,body:'{}',delayMs:10}]});f.edit();f.review();const token=f.last().screenToken;f.confirm();await f.tick();f.confirm(token);
    assert.equal(f.result().code,code);assert.equal(f.result().outcome,'failed');assert.equal(f.result().evidence.httpStatus,status);
    assert.equal(f.calls(),1);assert.equal(f.loads(),1);assert.equal(f.last().answer,undefined);
  });
for(const [raw,code]of [['{','malformed'],[body(' '),'empty']]as const)test(`shared fake response ${code} is not success`,async t=>{
  const f=setup(t,{script:[{status:200,body:raw,delayMs:10}]});f.edit();f.review();f.confirm();await f.tick();
  assert.equal(f.result().code,code);assert.equal(f.result().ok,false);assert.equal(f.calls(),1);
});
test('unknown transport outcome stays UNKNOWN with one observed invocation',async t=>{
  const f=setup(t,{script:[{failure:'unavailable',delayMs:10}]});f.edit();f.review();f.confirm();await f.tick();
  assert.equal(f.result().outcome,'unknown');assert.equal(f.result().evidence.fakeDispatches,1);assert.equal(f.result().evidence.httpStatus,null);
  assert.equal(f.calls(),1);
});
test('fake absolute timeout is finite and consumed without a second invocation',async t=>{
  const f=setup(t,{script:[{failure:'pending'}]});f.edit();f.review();const token=f.last().screenToken;f.confirm();await f.tick(20000);
  assert.equal(f.result().code,'timeout');assert.equal(f.result().outcome,'unknown');f.confirm(token);await f.tick(20000);assert.equal(f.calls(),1);
});
test('missing dummy credential is a typed failure before transport',async t=>{
  const f=setup(t,{dummy:{mode:'missing'}});f.edit();f.review();const token=f.last().screenToken;f.confirm();await f.tick();f.confirm(token);
  assert.equal(f.result().code,'missing-key');assert.equal(f.result().evidence.fakeDispatches,0);assert.equal(f.loads(),1);assert.equal(f.calls(),0);
});
for(const action of ['cancel','discard','edit'])test(`${action} during dummy acquisition prevents HTTP and late publication`,async t=>{
  const f=setup(t,{dummy:{delayMs:50}});f.edit();f.review();f.confirm();await flush();assert.equal(f.loads(),1);
  if(action==='cancel')f.send({type:'cancel'});else if(action==='edit')f.edit('new draft');else f.session.dispose();
  const count=f.notices.length;await f.tick(100);assert.equal(f.calls(),0);assert.equal(f.notices.length,count);
});
test('preview expiration during dummy acquisition cannot dispatch or reopen',async t=>{
  const f=setup(t,{dummy:{delayMs:50}});t.mock.timers.tick(119990);f.edit();f.review();f.confirm();await f.tick(20);
  assert.equal(f.calls(),0);assert.equal(f.result().code,'session-expired');assert.equal(f.notices.some(n=>n.phase==='screen-result'),false);
});
test('valid dispatch may finish after review expiry without renewing permission',async t=>{
  const f=setup(t);f.edit();f.review();const token=f.last().screenToken;t.mock.timers.tick(29995);f.confirm();await f.tick(10);
  assert.equal(f.last().phase,'screen-result');f.confirm(token);assert.equal(f.calls(),1);
});
for(const action of ['cancel','discard','close'])test(`${action} during fake HTTP never retries or publishes stale success`,async t=>{
  const f=setup(t,{script:[{failure:'pending'}]});f.edit();f.review();f.confirm();await flush();assert.equal(f.calls(),1);
  if(action==='cancel')f.send({type:'cancel'});else f.session.dispose();const count=f.notices.length;await f.tick(30000);
  assert.equal(f.notices.length,count);assert.equal(f.calls(),1);assert.equal(f.notices.some(n=>n.phase==='screen-result'),false);
});
for(const change of [{bytes:new Uint8Array(2*1024*1024+1)},{width:2048,height:2048},{bytes:new Uint8Array(20)}])
  test(`invalid image ${Object.keys(change).join('/')} retains local error and never loads credentials`,async t=>{
    const f=setup(t,{crop:change});f.edit();f.review();f.confirm();await f.tick();assert.equal(f.loads(),0);assert.equal(f.calls(),0);assert.equal(f.last().phase,'error');
  });
test('overlong question is rejected before bridge admission',async t=>{
  const f=setup(t);f.edit('x'.repeat(501));f.review();f.confirm();await f.tick();assert.equal(f.calls(),0);assert.equal(f.loads(),0);
});
test('Gate B cannot be opened by callback, setting, old permit, flags or test helpers',async t=>{
  const f=setup(t);
  for(const extra of [{fetchImpl:globalThis.fetch},{load:()=>Promise.resolve('x')},{live:true},{activation:{}},{endpoint:'https://example.invalid/'},{model:'other'}])
    assert.throws(()=>bridgeModule.createOfflineScreenVisionBridge({transport:f.fake,dummy:f.dummy,...extra}));
  assert.throws(()=>bridgeModule.createOfflineScreenVisionBridge({transport:{mode:'offline-scripted'},dummy:f.dummy}));
  assert.throws(()=>bridgeModule.createOfflineScreenVisionBridge({transport:f.fake,dummy:{purpose:'offline-bridge-dummy'}}));
  assert.equal((await f.bridge.run({scope:'one-synthetic-vision-request'})).code,'authorization');
  const oldDev=process.env.DESKTOP_COMPANION_DEV,oldArgv=process.argv;
  try{process.env.DESKTOP_COMPANION_DEV='1';process.argv=[...oldArgv,transportModule.LIVE_TEST_FLAG];
    const native=transportModule.createSyntheticVisionPilot({settings:()=>{throw Error('must not read settings');},vault:{load:()=>{throw Error('must not load key');}}});
    assert.equal(native.review().code,'disabled');assert.equal((await native.run({scope:'one-synthetic-vision-request'})).code,'disabled');
  }finally{process.argv=oldArgv;if(oldDev===undefined)delete process.env.DESKTOP_COMPANION_DEV;else process.env.DESKTOP_COMPANION_DEV=oldDev;}
  assert.equal(f.loads(),0);assert.equal(f.calls(),0);
});
test('new capture session cannot use old prepared wire while original context is closed',async t=>{
  const f=setup(t,{dummy:{delayMs:50}});f.edit();f.review();f.confirm();await flush();f.session.dispose();await f.tick(100);
  const second=bridgeModule.createOfflineScreenVisionBridge({transport:f.fake,dummy:f.dummy});t.after(()=>second.dispose());
  assert.equal((await second.run(f.wire())).ok,false);assert.equal(f.calls(),0);
});
test('normal coordinator still uses its original closed mock without dummy acquisition',async t=>{
  const f=setup(t,{normal:true});f.edit();f.review();f.confirm();await f.tick(400);
  assert.equal(f.last().phase,'screen-result');assert.equal(f.loads(),0);assert.equal(f.calls(),0);assert.equal(f.delegates(),0);
});
for(const ms of [30000,120000])test(`expired admitted identity retains truthful consumed evidence (${ms})`,async t=>{
  const f=setup(t);f.edit();f.review();const p=wireModule.prepareScreenVisionRequest(f.crop,f.last().screenReview,
    'https://offline-ux.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1');
  assert.equal(wireModule.confirmScreenVisionBridgeConsent(p.wire,()=>true),true);t.mock.timers.tick(ms);
  const result=await f.bridge.run(p.wire);assert.equal(result.code,ms===30000?'expired':'session-expired');
  assert.equal(result.evidence.attemptConsumed,true);assert.equal(result.evidence.fakeDispatches,0);
  assert.equal((await f.bridge.run(p.wire)).code,'duplicate');assert.equal(f.loads(),0);assert.equal(f.calls(),0);
});
test('a pending dummy lookup times out without invoking transport',async t=>{
  const f=setup(t,{dummy:{mode:'pending'}});f.edit();f.review();f.confirm();await f.tick(20000);
  assert.equal(f.result().code,'timeout');assert.equal(f.result().evidence.fakeDispatches,0);assert.equal(f.result().outcome,'failed');
  assert.equal(f.loads(),1);assert.equal(f.calls(),0);
});
for(const setting of ['packaged','not-main','insecure-tls'])test(`${setting} is refused before dummy load`,async t=>{
  const f=setup(t),oldTls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try{if(setting==='packaged')app.isPackaged=true;if(setting==='not-main')(process as any).type='renderer';if(setting==='insecure-tls')process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
    f.edit();f.review();f.confirm();await f.tick();assert.equal(f.result().code,setting==='packaged'?'production':setting==='not-main'?'disabled':'tls-policy');
    assert.equal(f.loads(),0);assert.equal(f.calls(),0);
  }finally{app.isPackaged=false;(process as any).type='browser';if(oldTls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=oldTls;}
});
for(const scenario of [{status:302,body:'{}'}, {status:200,body:'x'.repeat(65537)}])test(`bounded HTTP policy rejects ${scenario.status===302?'redirect':'oversized response'} without retry`,async t=>{
  const f=setup(t,{script:[{...scenario,delayMs:10}]});f.edit();f.review();f.confirm();await f.tick();
  assert.equal(f.result().code,scenario.status===302?'redirect':'response-too-large');assert.equal(f.result().ok,false);assert.equal(f.calls(),1);
});
test('an incomplete adapter exception cannot fabricate a definite zero-dispatch result',async t=>{
  const f=setup(t);t.mock.method(transportModule,'executeOfflineScreenVisionExchange',async()=>{throw Error('unobserved adapter result');});
  f.edit();f.review();f.confirm();await f.tick();assert.equal(f.result().outcome,'unknown');assert.equal(f.result().evidence.fakeDispatches,null);
  assert.equal(f.result().evidence.attemptConsumed,true);assert.equal(f.last().phase,'screen-error');
  assert.equal((await f.bridge.run(f.wire())).code,'duplicate');
});
test('an in-flight bridge rejects overlapping direct invocation without another dummy load',async t=>{
  const f=setup(t,{script:[{failure:'pending'}]});f.edit();f.review();f.confirm();await flush();
  const rejected=await f.bridge.run(f.wire());assert.equal(rejected.code,'busy');assert.equal(rejected.evidence.attemptConsumed,true);
  assert.equal(f.loads(),1);assert.equal(f.calls(),1);
  f.bridge.cancel();await flush();assert.equal(f.result().code,'cancelled');assert.equal(f.calls(),1);
});
test('review expires during dummy acquisition before the HTTP boundary',async t=>{
  const f=setup(t,{dummy:{delayMs:20}});f.edit();f.review();t.mock.timers.tick(29995);f.confirm();await f.tick(20);
  assert.equal(f.result().code,'expired');assert.equal(f.result().evidence.attemptConsumed,true);
  assert.equal(f.loads(),1);assert.equal(f.calls(),0);
});
test('foreign fake correlation yields incomplete evidence, never a response for this preview',async t=>{
  const f=setup(t,{script:[{status:200,body:body('foreign answer'),replyTo:'foreign',delayMs:10}]});
  f.edit();f.review();f.confirm();await f.tick();assert.equal(f.result().outcome,'unknown');
  assert.equal(f.result().evidence.httpStatus,null);assert.equal(f.last().answer,undefined);assert.equal(f.calls(),1);
});
