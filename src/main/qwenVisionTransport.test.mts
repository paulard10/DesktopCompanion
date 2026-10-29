import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Module, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require=createRequire(import.meta.url),restores:(()=>void)[]=[];
let realNetwork=0,writes=0,privateAccess=0,capture=0;
const replace=(o:any,k:string,v:any)=>{const old=o[k];o[k]=v;restores.push(()=>{o[k]=old;});};
const deny=()=>{realNetwork++;throw Error('Real HTTP/process forbidden');};
replace(globalThis,'fetch',deny);if('WebSocket'in globalThis)replace(globalThis,'WebSocket',deny);
for(const name of ['node:http','node:https'])for(const k of ['request','get'])replace(require(name),k,deny);
for(const k of ['connect','createConnection'])replace(require('node:net'),k,deny);
replace(require('node:net').Socket.prototype,'connect',deny);replace(require('node:tls'),'connect',deny);
for(const k of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])replace(require('node:child_process'),k,deny);
for(const k of ['writeFile','writeFileSync','appendFile','appendFileSync','createWriteStream'])
  replace(require('node:fs'),k,()=>{writes++;throw Error('No persistence');});
for(const k of ['writeFile','appendFile'])replace(require('node:fs/promises'),k,()=>{writes++;throw Error('No persistence');});
const app={isPackaged:false},originalLoad=(Module as any)._load;
replace(Module,'_load',function(this:any,id:string,...args:any[]){
  if(id==='electron')return {app,get clipboard(){privateAccess++;throw Error('No clipboard');},
    get safeStorage(){privateAccess++;throw Error('No actual credentials');},desktopCapturer:{getSources(){capture++;throw Error('No screen');}}};
  if(/safeCredentialStore|providerSettings|keyVault/.test(id)){privateAccess++;throw Error('No actual credential module');}
  return originalLoad.call(this,id,...args);
});
const {createSyntheticVisionPilot,LIVE_TEST_FLAG,LIVE_TEST_LIMITS,LIVE_VISION_DISABLED}=require('../../dist/main/qwenVisionTransport.js');
const fixtureModule=require('../../dist/main/visionPilotFixture.js');
const {buildVisionRequest}=require('../../dist/main/qwenVisionAdapter.js');
const {encodeSyntheticCrop,VISION_LIMITS}=require('../../dist/main/visionImage.js');
const endpoint='https://fake-http-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',url=endpoint+'/chat/completions';
const oldType=(process as any).type,oldDev=process.env.DESKTOP_COMPANION_DEV,oldTls=process.env.NODE_TLS_REJECT_UNAUTHORIZED,oldArgv=[...process.argv];
(process as any).type='browser';process.env.DESKTOP_COMPANION_DEV='1';delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;process.argv.push(LIVE_TEST_FLAG);
after(()=>{
  for(const r of restores.reverse())r();(process as any).type=oldType;process.argv=oldArgv;
  for(const [k,v] of [['DESKTOP_COMPANION_DEV',oldDev],['NODE_TLS_REJECT_UNAUTHORIZED',oldTls]])if(v===undefined)delete process.env[k!];else process.env[k!]=v;
  assert.deepEqual({realNetwork,writes,privateAccess,capture},{realNetwork:0,writes:0,privateAccess:0,capture:0});
});
const body=(patch:any={})=>JSON.stringify({choices:[{message:{role:'assistant',content:'Fixture HTTP reply; not proof of real provider acceptance.'},finish_reason:'stop'}],
  usage:{prompt_tokens:248,completion_tokens:24,total_tokens:272},...patch});
function response(raw=body(),status=200,patch:any={}):Response {
  const result=new Response(raw,{status,headers:{'content-type':'application/json'}});
  Object.defineProperty(result,'url',{value:url,configurable:true});for(const [k,v]of Object.entries(patch))Object.defineProperty(result,k,{value:v});return result;
}
function setup(patch:any={}){
  const calls:any[]=[],settings={provider:'qwen',endpoint},state={loads:0,reads:0,key:'DUMMY-PILOT-KEY-ONLY'};
  const driver=(async(u:any,init:any)=>{calls.push({url:u,init});return patch.reply?patch.reply(u,init):response();}) as typeof fetch;
  const options={settings:()=>{state.reads++;return settings;},vault:{load:async()=>{state.loads++;return patch.load?patch.load():state.key;}},fetchImpl:driver};
  const pilot=createSyntheticVisionPilot(options);
  const approve=()=>{const r=pilot.review();assert.equal(r.ok,true);assert.equal(r.review.domain,'offline-http-test');
    const permit=pilot.authorize(r.review.id,r.review.statement);assert.ok(permit);return permit;};
  return{pilot,calls,state,settings,driver,options,approve};
}
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('pilot diagnostics expose bounded answer/labels/counts without hidden reasoning',async()=>{
  const f=setup({reply:()=>response(body({id:'request-fixture-101',model:'qwen3.7-plus',
    choices:[{message:{role:'assistant',content:'Test answer',reasoning_content:'NEVER OUTPUT THIS'},finish_reason:'stop'}],
    usage:{prompt_tokens:248,completion_tokens:24,total_tokens:272,completion_tokens_details:{reasoning_tokens:3}}}))});
  assert.equal(f.pilot.diagnostics().postAttempts,0);
  assert.equal((await f.pilot.run(f.approve())).ok,true);
  const d=f.pilot.diagnostics();assert.equal(d.postAttempts,1);assert.equal(d.httpStatus,200);
  assert.equal(d.providerRequestId,'request-fixture-101');assert.equal(d.returnedModel,'qwen3.7-plus');
  assert.equal(d.finishReason,'stop');assert.equal(d.reasoningTokens,3);assert.equal(d.responseText,'Test answer');
  assert.deepEqual(d.usage,{promptTokens:248,completionTokens:24,totalTokens:272});
  assert.ok(d.totalDurationMs>=0);assert.ok(d.postDurationMs>=0);assert.ok(d.responseBytes>0);
  assert.equal(JSON.stringify(d).includes('NEVER OUTPUT THIS'),false);
  d.usage.promptTokens=999;assert.equal(f.pilot.diagnostics().usage.promptTokens,248);
  assert.equal((await f.pilot.run({})).code,'duplicate');assert.equal(f.pilot.diagnostics().postAttempts,1);
});
test('rejected thinking setting records status and safe error category, without raw error',async()=>{
  const f=setup({reply:()=>response(JSON.stringify({error:{code:'InvalidParameter',message:'enable_thinking is not supported; PRIVATE RAW ERROR'}}),400)});
  assert.equal((await f.pilot.run(f.approve())).ok,false);const d=f.pilot.diagnostics();
  assert.equal(d.postAttempts,1);assert.equal(d.httpStatus,400);assert.equal(d.providerErrorCode,'InvalidParameter');
  assert.equal(d.providerErrorCategory,'thinking-setting');assert.equal(d.responseText,null);
  assert.equal(JSON.stringify(d).includes('PRIVATE RAW ERROR'),false);assert.equal(f.calls.length,1);
});
test('diagnostic labels cannot echo a credential; unsafe answer is not retained',async()=>{
  const f=setup({reply:()=>response(body({id:'DUMMY-PILOT-KEY-ONLY',model:'sk-unsafe',
    choices:[{message:{role:'assistant',content:'DUMMY-PILOT-KEY-ONLY'},finish_reason:'stop'}]}))});
  assert.equal((await f.pilot.run(f.approve())).ok,false);const d=f.pilot.diagnostics();
  assert.equal(d.providerRequestId,null);assert.equal(d.returnedModel,null);assert.equal(d.responseText,null);
  assert.equal(JSON.stringify(d).includes(f.state.key),false);
});
test('failed dispatch is counted once; failure before dispatch remains zero',async()=>{
  const f=setup({reply:()=>{throw Error('network unavailable');}});await f.pilot.run(f.approve());
  assert.equal(f.pilot.diagnostics().postAttempts,1);assert.equal(f.pilot.diagnostics().httpStatus,null);
  assert.ok(f.pilot.diagnostics().postDurationMs>=0);
  const missing=setup({load:async()=>null});await missing.pilot.run(missing.approve());
  assert.equal(missing.pilot.diagnostics().postAttempts,0);assert.equal(missing.pilot.diagnostics().postDurationMs,null);
});
test('development invocation harness uses registered fixture and existing fake transport exactly once',async()=>{
  const {runReviewedPilotOnce}=await import('../../scripts/vision-live-preflight.mjs');const f=setup();let prompts=0;
  const out=await runReviewedPilotOnce(f.pilot,async r=>{prompts++;assert.equal(r.domain,'offline-http-test');return r.statement;},'offline-http-test');
  assert.equal(out.result.ok,true);assert.equal(out.diagnostics.postAttempts,1);assert.equal(prompts,1);assert.equal(f.calls.length,1);
  const replay=await runReviewedPilotOnce(f.pilot,async()=>{throw Error('must not authorize twice');},'offline-http-test');
  assert.equal(replay.result.code,'duplicate');assert.equal(f.calls.length,1);
});
test('invocation harness rejects wrong authorization or mismatched scope without send/key access',async()=>{
  const {runReviewedPilotOnce}=await import('../../scripts/vision-live-preflight.mjs');
  const f=setup();const out=await runReviewedPilotOnce(f.pilot,async()=> 'yes','offline-http-test');
  assert.equal(out.result.code,'authorization');assert.equal(out.diagnostics.postAttempts,0);assert.equal(f.state.loads,0);
  for(const patch of [{domain:'live'},{imageSha256:'changed'},{question:'changed'},{model:'other'},{maxTokens:161}]){
    const g=setup(),review=g.pilot.review;let cancelled=false;
    const wrapped={...g.pilot,review:()=>{const r=review();return {...r,review:{...r.review,...patch}};},cancel:()=>{cancelled=true;g.pilot.cancel();}};
    await assert.rejects(runReviewedPilotOnce(wrapped,async()=>{throw Error('must not ask');},'offline-http-test'),/authorized scope/);
    assert.equal(cancelled,true);assert.equal(g.calls.length,0);assert.equal(g.state.loads,0);
  }
});
test('live is disabled by default and construction reads no settings/key/network',()=>{
  assert.equal(LIVE_VISION_DISABLED,true);const f=setup();assert.equal(f.state.reads,0);assert.equal(f.state.loads,0);assert.equal(f.calls.length,0);
});
test('native live remains blocked even with old flags, correct process type and reconstructed review fields',async()=>{
  const f=setup(),native=createSyntheticVisionPilot({settings:f.options.settings,vault:f.options.vault});
  assert.equal(native.review().code,'disabled');assert.equal(native.authorize('old-nonce','old log statement'),null);
  assert.equal((await native.run({scope:'one-synthetic-vision-request'})).code,'disabled');
  assert.equal(f.state.loads,0);assert.equal(f.state.reads,0);
});
test('invocation helper cannot issue a new live approval during diagnostic work',async()=>{
  const {runReviewedPilotOnce}=await import('../../scripts/vision-live-preflight.mjs');const f=setup();let prompts=0;
  const result=await runReviewedPilotOnce(f.pilot,async()=>{prompts++;return 'old approval';},'live');
  assert.equal(result.result.code,'disabled');assert.equal(prompts,0);assert.equal(f.state.reads,0);assert.equal(f.state.loads,0);assert.equal(f.calls.length,0);
});
for(const mode of ['packaged','no explicit flag','no development','renderer'])test('runtime gate rejects '+mode,async()=>{
  const f=setup(),argv=[...process.argv],type=(process as any).type,dev=process.env.DESKTOP_COMPANION_DEV;
  try{
    if(mode==='packaged')app.isPackaged=true;if(mode==='no explicit flag')process.argv=process.argv.filter(x=>x!==LIVE_TEST_FLAG);
    if(mode==='no development')delete process.env.DESKTOP_COMPANION_DEV;if(mode==='renderer')(process as any).type='renderer';
    assert.equal(f.pilot.review().ok,false);assert.equal((await f.pilot.run({})).ok,false);
    assert.equal(f.state.reads,0);assert.equal(f.state.loads,0);assert.equal(f.calls.length,0);
  }finally{app.isPackaged=false;process.argv=argv;(process as any).type=type;process.env.DESKTOP_COMPANION_DEV=dev;}
});
test('insecure global TLS policy fails closed before credentials',()=>{
  const f=setup();process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';try{assert.equal(f.pilot.review().code,'tls-policy');assert.equal(f.state.loads,0);}finally{delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;}
});
test('mock-tagged native fetch cannot be injected as fake HTTP',()=>{
  const f=setup();assert.throws(()=>createSyntheticVisionPilot({...f.options,fetchImpl:globalThis.fetch}));
});
test('missing/forged/offline-UX authorizations never read credentials',async()=>{
  const f=setup();for(const p of [undefined,null,{},'token',{scope:'one-synthetic-vision-request'},{token:'offline-review'}])
    assert.equal((await f.pilot.run(p)).code,'authorization');assert.equal(f.state.loads,0);assert.equal(f.calls.length,0);
});
test('review alone has no HTTP/key effect and a wrong statement cannot authorize',()=>{
  const f=setup(),r=f.pilot.review();assert.equal(r.ok,true);assert.equal(f.pilot.authorize(r.review.id,'yes'),null);
  assert.equal(f.pilot.authorize('old',r.review.statement),null);assert.equal(f.state.loads,0);assert.equal(f.calls.length,0);
});
test('offline approval domain cannot authorize a native/live driver or another pilot',async()=>{
  const f=setup(),permit=f.approve(),other=setup();assert.equal((await other.pilot.run(permit)).code,'authorization');
  const live=createSyntheticVisionPilot({settings:f.options.settings,vault:f.options.vault});
  assert.equal((await live.run(permit)).code,'disabled');assert.equal(live.review().code,'disabled');assert.equal(f.state.loads,0);
});
test('exact predefined synthetic fixture, question, model and multimodal POST only',async()=>{
  const f=setup(),result=await f.pilot.run(f.approve());assert.equal(result.ok,true);assert.equal(result.kind,'offline-http-test-response');
  assert.equal(f.calls.length,1);const sent=f.calls[0];assert.equal(sent.url,url);
  assert.equal(sent.init.method,'POST');assert.equal(sent.init.redirect,'error');assert.equal(sent.init.credentials,'omit');assert.equal(sent.init.cache,'no-store');
  assert.equal(sent.init.referrerPolicy,'no-referrer');assert.deepEqual(Object.keys(sent.init.headers).sort(),['Accept','Authorization','Content-Type']);
  assert.equal(sent.init.headers.Authorization,'Bearer '+f.state.key);const b=JSON.parse(sent.init.body);
  assert.equal(b.model,'qwen3.7-plus');assert.equal(b.max_completion_tokens,160);assert.equal(b.max_tokens,undefined);assert.equal(b.stream,false);assert.equal(b.enable_thinking,false);
  assert.equal(b.messages.length,2);assert.equal(b.messages[1].content.length,2);
  assert.equal(b.messages[1].content[0].text,fixtureModule.VISION_PILOT_QUESTION);
  assert.equal(b.messages[1].content[1].image_url.url,encodeSyntheticCrop(fixtureModule.createVisionPilotFixture()));
  assert.equal(Object.keys(b).sort().join(),['model','messages','stream','enable_thinking','max_completion_tokens'].sort().join());
  assert.deepEqual(result.usage,{promptTokens:248,completionTokens:24,totalTokens:272});
});
test('fixture is deterministic 384x256, original RGBA PNG, comfortably below limits',()=>{
  const a=fixtureModule.createVisionPilotFixture(),b=fixtureModule.createVisionPilotFixture();assert.deepEqual(a,b);
  assert.equal(a.width,384);assert.equal(a.height,256);assert.ok(a.bytes.length<20_000);assert.ok(encodeSyntheticCrop(a));
  assert.equal(a.kind,'approved-synthetic-crop');assert.equal(fixtureModule.visionPilotSpecification().question,'Read the arithmetic expression in this image and describe the colored shape.');
});
for(const endpointValue of ['http://fake-http-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1','https://example.com/compatible-mode/v1',
  'https://fake-http-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','https://user:pass@fake-http-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  endpoint+'?key=not-valid',endpoint+'/other'])test('unapproved endpoint rejected before key '+endpointValue,()=>{
    const f=setup();f.settings.endpoint=endpointValue;assert.equal(f.pilot.review().code,'invalid-endpoint');assert.equal(f.state.loads,0);assert.equal(f.calls.length,0);
  });
test('Demo settings do not become live vision or silently fall back',()=>{const f=setup();f.settings.provider='demo';assert.equal(f.pilot.review().ok,false);assert.equal(f.state.loads,0);});
test('authorization statement and permit each have 30-second expiration',async t=>{
  t.mock.timers.enable({apis:['Date']});const f=setup(),review=f.pilot.review();t.mock.timers.tick(30_000);
  assert.equal(f.pilot.authorize(review.review.id,review.review.statement),null);
  const permit=f.approve();t.mock.timers.tick(30_000);assert.equal((await f.pilot.run(permit)).code,'expired');assert.equal(f.state.loads,0);
});
test('cancel revokes issued permission even before dispatch',async()=>{const f=setup(),p=f.approve();f.pilot.cancel();assert.equal((await f.pilot.run(p)).code,'authorization');assert.equal(f.state.loads,0);});
test('new review revokes old review/permit snapshot',async()=>{const f=setup(),p=f.approve();f.pilot.review();assert.equal((await f.pilot.run(p)).code,'authorization');});
test('duplicate concurrent/replayed calls consume one attempt and never retry',async()=>{
  const f=setup(),p=f.approve();const first=f.pilot.run(p);assert.equal((await f.pilot.run(p)).code,'duplicate');await first;
  assert.equal((await f.pilot.run(p)).code,'duplicate');assert.equal(f.calls.length,1);assert.equal(f.state.loads,1);assert.equal(f.pilot.review().code,'duplicate');
});
test('one-attempt budget is shared by pilot instances using the same fake driver',async()=>{
  const f=setup(),second=createSyntheticVisionPilot(f.options),r=second.review(),p=second.authorize(r.review.id,r.review.statement);
  await f.pilot.run(f.approve());assert.equal((await second.run(p)).code,'duplicate');assert.equal(f.calls.length,1);
});
test('configuration changed after review prevents dispatch/key access',async()=>{const f=setup(),p=f.approve();f.settings.endpoint='https://changed.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';assert.equal((await f.pilot.run(p)).code,'authorization');assert.equal(f.state.loads,0);});
test('configuration changed during key loading prevents transmission',async()=>{
  const f=setup({load:async()=>{f.settings.endpoint='https://changed.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';return 'DUMMY-KEY';}});
  assert.equal((await f.pilot.run(f.approve())).code,'authorization');assert.equal(f.calls.length,0);
});
for(const key of [null,'','bad\r\nheader','not valid key'])test('missing/unsafe credential is terminal '+JSON.stringify(key),async()=>{
  const f=setup({load:async()=>key}),p=f.approve();assert.equal((await f.pilot.run(p)).code,'missing-key');assert.equal(f.calls.length,0);assert.equal((await f.pilot.run(p)).code,'duplicate');
});
for(const [name,patch]of [['invalid PNG',{bytes:Buffer.alloc(100)}],['oversized PNG',{bytes:Buffer.alloc(VISION_LIMITS.pngBytes+1)}],['oversized geometry',{width:3000}]] as const)
  test('generated fixture validation rejects '+name,()=>{
    const original=fixtureModule.createVisionPilotFixture;fixtureModule.createVisionPilotFixture=()=>({...original(),...patch});
    try{const f=setup();assert.equal(f.pilot.review().code,'invalid-image');assert.equal(f.state.loads,0);}finally{fixtureModule.createVisionPilotFixture=original;}
  });
test('screenshots/renderer questions cannot be supplied through the run API',async()=>{
  const f=setup();assert.equal((await f.pilot.run({image:Buffer.alloc(1),question:'Unapproved',model:'other'})).code,'authorization');assert.equal(f.calls.length,0);
});
test('shared builder keeps old output cap and rejects unsupported live profile/model',()=>{
  const input={endpoint,model:'qwen3.7-plus',question:fixtureModule.VISION_PILOT_QUESTION,image:fixtureModule.createVisionPilotFixture()};
  assert.equal(buildVisionRequest(input).request.body.max_tokens,384);assert.equal(buildVisionRequest(input,'synthetic-live-test').request.body.max_completion_tokens,160);
  assert.equal(buildVisionRequest({...input,model:'qwen3.7-flash'},'synthetic-live-test').code,'unsupported-model');assert.equal(buildVisionRequest(input,'unknown').ok,false);
});
for(const status of [301,302,307,308])test('redirect '+status+' is terminal without follow-up',async()=>{
  const f=setup({reply:()=>response('{}',status)});assert.equal((await f.pilot.run(f.approve())).code,'redirect');assert.equal(f.calls.length,1);
});
test('response final URL/redirect flag cannot escape the reviewed endpoint',async()=>{
  for(const patch of [{redirected:true},{url:'https://example.invalid/'}]){const f=setup({reply:()=>response(body(),200,patch)});assert.equal((await f.pilot.run(f.approve())).code,'redirect');assert.equal(f.calls.length,1);}
});
for(const [status,code]of [[400,'invalid'],[401,'authentication'],[403,'forbidden'],[429,'rate-limit'],[500,'unavailable']] as const)
  test('HTTP '+status+' safe terminal error, one call and no fallback',async()=>{
    const f=setup({reply:()=>response('DUMMY server echo data:image/png;base64,PRIVATE',status)}),p=f.approve();
    const result=await f.pilot.run(p);assert.equal(result.code,code);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
    assert.equal((await f.pilot.run(p)).code,'duplicate');assert.equal(f.calls.length,1);
  });
test('quota errors use existing classifier without server echo',async()=>{const f=setup({reply:()=>response('{"error":"quota exhausted"}',429)});assert.equal((await f.pilot.run(f.approve())).code,'quota');});
for(const [name,error,code]of [['network',new Error('DUMMY error'),'unavailable'],['TLS',{cause:{code:'CERT_HAS_EXPIRED'}},'tls']] as const)
  test('safe '+name+' failure has no exception echo',async()=>{const f=setup({reply:()=>{throw error;}});assert.equal((await f.pilot.run(f.approve())).code,code);assert.equal(f.calls.length,1);});
for(const raw of ['not json',body({choices:[]}),body({choices:[{message:{role:'assistant',content:''},finish_reason:'stop'}]}),
  body({choices:[{message:{role:'assistant',content:'tool',tool_calls:[]},finish_reason:'stop'}]})])
  test('malformed/empty/tool response never becomes success '+raw.slice(0,18),async()=>{const f=setup({reply:()=>response(raw)});assert.equal((await f.pilot.run(f.approve())).ok,false);assert.equal(f.calls.length,1);});
for(const usage of [null,{prompt_tokens:-1,completion_tokens:1,total_tokens:0},{prompt_tokens:1,completion_tokens:161,total_tokens:162},
  {prompt_tokens:1.5,completion_tokens:1,total_tokens:2.5},{prompt_tokens:1,completion_tokens:1,total_tokens:999},'bad'])
  test('invalid usage is rejected '+JSON.stringify(usage),async()=>{const f=setup({reply:()=>response(body({usage}))});assert.equal((await f.pilot.run(f.approve())).code,'invalid-usage');});
test('missing usage is explicitly unknown, never invented zero',async()=>{const value=JSON.parse(body());delete value.usage;const f=setup({reply:()=>response(JSON.stringify(value))});assert.equal((await f.pilot.run(f.approve())).usage,null);});
test('bounded answer/truncation uses the existing normalizer',async()=>{
  const f=setup({reply:()=>response(body({choices:[{message:{role:'assistant',content:'x'.repeat(2000)},finish_reason:'length'}]}))});
  const r=await f.pilot.run(f.approve());assert.equal(r.ok,true);assert.equal(r.text.length,1600);assert.equal(r.truncated,true);
});
test('large content length rejected before parsing; stream exceeds budget also rejected',async()=>{
  const large=new Response('x',{headers:{'content-type':'application/json','content-length':'999999'}});Object.defineProperty(large,'url',{value:url});
  for(const reply of [()=>large,()=>response('x'.repeat(65*1024))]){const f=setup({reply});assert.equal((await f.pilot.run(f.approve())).code,'response-too-large');}
});
test('unexpected MIME and absent body rejected',async()=>{
  const f=setup({reply:()=>response('{}',200,{headers:new Headers({'content-type':'text/event-stream'})})});assert.equal((await f.pilot.run(f.approve())).code,'malformed');
});
test('pre-aborted operation never reads credentials or calls fake HTTP',async()=>{const f=setup(),s=new AbortController();s.abort();assert.equal((await f.pilot.run(f.approve(),s.signal)).code,'cancelled');assert.equal(f.state.loads,0);});
test('timeout covers a stalled credential source without sending',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=setup({load:()=>new Promise(()=>{})}),work=f.pilot.run(f.approve());
  await settle();t.mock.timers.tick(20_001);assert.equal((await work).code,'timeout');assert.equal(f.calls.length,0);
});
test('timeout covers uncooperative fake HTTP and never retries',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=setup({reply:()=>new Promise(()=>{})}),work=f.pilot.run(f.approve());
  await settle();t.mock.timers.tick(20_001);assert.equal((await work).code,'timeout');assert.equal(f.calls.length,1);
});
test('timeout and cancellation cover a stalled response body and cancel its reader',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let cancelled=0;
  const f=setup({reply:()=>{const r=new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}});Object.defineProperty(r,'url',{value:url});return r;}});
  const work=f.pilot.run(f.approve());await settle();t.mock.timers.tick(20_001);assert.equal((await work).code,'timeout');await settle();assert.equal(cancelled,1);
});
test('external abort/cancel stops one dispatched test without a late answer',async()=>{
  const f=setup({reply:()=>new Promise(()=>{})}),s=new AbortController(),p=f.approve(),work=f.pilot.run(p,s.signal);
  await settle();s.abort();assert.equal((await work).code,'cancelled');assert.equal(f.calls.length,1);assert.equal((await f.pilot.run(p)).code,'duplicate');
});
test('direct cancel stops pending HTTP and prevents another approval',async()=>{
  const f=setup({reply:()=>new Promise(()=>{})}),work=f.pilot.run(f.approve());await settle();f.pilot.cancel();
  assert.equal((await work).code,'cancelled');assert.equal(f.pilot.review().code,'duplicate');assert.equal(f.calls.length,1);
});
test('late credential after cancellation never reaches HTTP',async()=>{
  let finish!:(value:string)=>void;const f=setup({load:()=>new Promise(r=>finish=r)}),work=f.pilot.run(f.approve());
  await settle();f.pilot.cancel();assert.equal((await work).code,'cancelled');finish('DUMMY-LATE-KEY');await settle();assert.equal(f.calls.length,0);
});
test('approval that expires during key loading is not transmitted',async t=>{
  t.mock.timers.enable({apis:['Date']});const f=setup({load:async()=>{t.mock.timers.tick(30_001);return 'DUMMY-KEY';}});
  assert.equal((await f.pilot.run(f.approve())).code,'expired');assert.equal(f.calls.length,0);
});
test('production gate rechecked after an outstanding credential load',async()=>{
  const f=setup({load:async()=>{app.isPackaged=true;return 'DUMMY-KEY';}});
  try{assert.equal((await f.pilot.run(f.approve())).ok,false);assert.equal(f.calls.length,0);}finally{app.isPackaged=false;}
});
test('absent body and invalid UTF-8 are terminal malformed responses',async()=>{
  const none=new Response(null,{headers:{'content-type':'application/json'}});Object.defineProperty(none,'url',{value:url});
  const invalid=new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}});Object.defineProperty(invalid,'url',{value:url});
  for(const reply of [()=>none,()=>invalid]){const f=setup({reply});assert.equal((await f.pilot.run(f.approve())).ok,false);assert.equal(f.calls.length,1);}
});
test('serialization failure remains local and terminal',async()=>{
  const f=setup(),p=f.approve(),original=JSON.stringify;JSON.stringify=()=>{throw Error('PRIVATE serialization');};
  let result;try{result=await f.pilot.run(p);}finally{JSON.stringify=original;}
  assert.equal(result.ok,false);assert.equal(f.calls.length,0);assert.equal(f.state.loads,0);
});
test('no logs include key/image/body, including malicious successful echoes',async()=>{
  const logs:any[]=[],old=[console.log,console.warn,console.error];console.log=console.warn=console.error=(...a:any[])=>logs.push(a);
  try{
    for(const text of ['DUMMY-PILOT-KEY-ONLY','data:image/png;base64,not-a-real-image','Bearer DUMMY']){
      const f=setup({reply:()=>response(body({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]}))});
      assert.equal((await f.pilot.run(f.approve())).code,'malformed');
    }assert.deepEqual(logs,[]);
  }finally{[console.log,console.warn,console.error]=old;}
});
test('runtime UI/preload/chat imports never reach transport or pilot entrypoint',()=>{
  for(const name of ['main.ts','screenSelectionWindow.ts','offlineVisionSession.ts','chatWindow.ts']){
    const text=readFileSync(new URL(name,import.meta.url),'utf8');assert.equal(/qwenVisionTransport|vision-live-preflight/.test(text),false);
  }
  const script=readFileSync(new URL('../../scripts/vision-live-preflight.mjs',import.meta.url),'utf8');
  assert.match(script,/LIVE TEST BLOCKED/);assert.match(script,/NOT YET GIVEN/);assert.equal(script.includes('createSafeCredentialStore'),false);
  const config=readFileSync(new URL('../../electron-builder.yml',import.meta.url),'utf8');assert.match(config,/dist\/\*\*\/\*/);assert.equal(config.includes('scripts/'),false);
});
