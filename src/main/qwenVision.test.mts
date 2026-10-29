import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import { crc32 } from 'node:zlib';
import { fixture, chunk, makePng } from './visionFixtures.test-support.mts';

// Install deny guards BEFORE loading the adapter graph. Test files run in
// separate Node test processes; existing text/provider tests keep their mocks.
const require = createRequire(import.meta.url);
let networkAttempts = 0, writeAttempts = 0;
const restores: (()=>void)[] = [];
function replace(object: any, name: string, replacement: any): void {
  const original = object[name]; object[name] = replacement;
  restores.push(()=>{object[name]=original;});
}
const denyNetwork = (): never => { networkAttempts++; throw Error('Offline network guard.'); };
replace(globalThis,'fetch',denyNetwork);
if ('WebSocket' in globalThis) replace(globalThis,'WebSocket',denyNetwork);
for (const name of ['node:http','node:https']) for(const key of ['request','get']) replace(require(name),key,denyNetwork);
for (const key of ['connect','createConnection']) replace(require('node:net'),key,denyNetwork);
replace(require('node:net').Socket.prototype,'connect',denyNetwork);
replace(require('node:tls'),'connect',denyNetwork);
for(const key of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])replace(require('node:child_process'),key,denyNetwork);
const denyWrite = (): never => { writeAttempts++; throw Error('Offline persistence guard.'); };
for(const key of ['writeFile','writeFileSync','appendFile','appendFileSync','createWriteStream'])replace(require('node:fs'),key,denyWrite);
for(const key of ['writeFile','appendFile'])replace(require('node:fs/promises'),key,denyWrite);

const { buildVisionRequest, createOfflineVisionAdapter, normalizeVisionReply, VISION_SYSTEM_PROMPT } = require('../../dist/main/qwenVisionAdapter.js');
const { VISION_LIMITS, isCanonicalPngDataUri, encodeSyntheticCrop } = require('../../dist/main/visionImage.js');
const { createVisionMock, visionMockStats } = require('../../dist/main/qwenVisionMock.js');
const endpoint='https://offline-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
const input = (patch: any={}) => ({endpoint,model:'qwen3.7-plus',question:'¿Qué significa este error?',image:fixture(),...patch});
const response = (content: unknown='Es un error de prueba.', patch: any={}) => JSON.stringify({
  choices:[{message:{role:'assistant',content},finish_reason:'stop',...patch}],
});
const success = (body=response(), patch: any={}) => ({status:200,body,...patch});
function setup(script: any[]=[success()], timeoutMs=5000){
  const transport=createVisionMock(script),adapter=createOfflineVisionAdapter({transport,timeoutMs});
  return {transport,adapter,stats:()=>visionMockStats(transport)};
}
function invalid(value: any, code: string){const result=buildVisionRequest(value);assert.equal(result.ok,false);assert.equal(result.code,code);}
after(()=>{
  for(const restore of restores.reverse())restore();
  assert.equal(networkAttempts,0,'No network/process-launch attempt is allowed.');
  assert.equal(writeAttempts,0,'No persistence attempt is allowed.');
});

test('valid procedural PNG builds one Chat Completions text-and-image message',()=>{
  const source=input(),r=buildVisionRequest(source);assert.equal(r.ok,true);
  assert.equal(r.request.url,endpoint+'/chat/completions');const b=r.request.body;
  assert.deepEqual(Object.keys(b).sort(),['enable_thinking','max_tokens','messages','model','stream']);
  assert.equal(b.model,'qwen3.7-plus');assert.equal(b.stream,false);assert.equal(b.enable_thinking,false);
  assert.equal(b.max_tokens,384);assert.equal(b.messages.length,2);
  assert.deepEqual(b.messages[0],{role:'system',content:VISION_SYSTEM_PROMPT});
  assert.equal(b.messages[1].role,'user');assert.equal(b.messages[1].content.length,2);
  assert.deepEqual(b.messages[1].content[0],{type:'text',text:source.question});
  assert.equal(b.messages[1].content[1].type,'image_url');
  assert.equal(b.messages[1].content[1].image_url.url === 'data:image/png;base64,'+source.image.bytes.toString('base64'),true);
  assert.equal(r.request.bodyBytes,Buffer.byteLength(JSON.stringify(b),'utf8'));
});
test('PNG bytes are structurally decoded, not identified by an extension',()=>{
  const r=buildVisionRequest(input());assert.equal(r.ok,true);
  assert.equal(isCanonicalPngDataUri(r.request.body.messages[1].content[1].image_url.url),true);
  assert.ok(fixture().bytes.length>100);
});
test('bounded RGB PNG is accepted alongside RGBA, without conversion',()=>{
  const image={...fixture(),width:16,height:16,bytes:makePng(16,16,Buffer.alloc(49*16),2)};
  const r=buildVisionRequest(input({image}));assert.equal(r.ok,true);
  assert.equal(r.request.body.messages[1].content[1].image_url.url.endsWith(image.bytes.toString('base64')),true);
});
test('only non-interlaced 8-bit RGB/RGBA PNG headers are accepted',()=>{
  for(const [byte,value] of [[8,16],[9,3],[12,1]]){
    const image=fixture(),header=Buffer.from(image.bytes.subarray(16,29));header[byte!]=value!;
    image.bytes=Buffer.concat([image.bytes.subarray(0,8),chunk('IHDR',header),image.bytes.subarray(33)]);
    invalid(input({image}),'invalid-image');
  }
});
test('maximum pixel budget is accepted and a one-pixel excess is rejected',()=>{
  const width=2048,height=1024,image={...fixture(),width,height,x:0,y:0,sourceWidth:2048,sourceHeight:2048,
    bytes:makePng(width,height,Buffer.alloc((width*4+1)*height))};
  assert.equal(buildVisionRequest(input({image})).ok,true);
  invalid(input({image:{...image,height:1025}}),'invalid-image');
});
test('illegal chunk names and extra compressed data cannot pass as a valid PNG',()=>{
  const image=fixture(),header=chunk('IHDR',image.bytes.subarray(16,29));
  const packed=image.bytes.subarray(41,41+image.bytes.readUInt32BE(33));
  const illegal=chunk('IDAT',packed);illegal[4]=0xc9;
  illegal.writeUInt32BE(crc32(illegal.subarray(4,illegal.length-4)),illegal.length-4);
  for(const data of [illegal,chunk('IDAT',Buffer.concat([packed,Buffer.from([0])]))])
    invalid(input({image:{...image,bytes:Buffer.concat([image.bytes.subarray(0,8),header,data,chunk('IEND',Buffer.alloc(0))])}}),'invalid-image');
});
for(const [label,patch] of [
  ['unsupported JPEG',{mime:'image/jpeg',bytes:Buffer.from([255,216,255,0])}],
  ['MIME mismatch',{mime:'text/html'}],['empty',{bytes:new Uint8Array()}],
  ['wrong signature',{bytes:Buffer.alloc(100)}],['oversized bytes',{bytes:Buffer.alloc(VISION_LIMITS.pngBytes+1)}],
  ['oversized side',{width:2049}],['oversized pixels',{width:2048,height:2048}],
  ['tiny side',{width:15}],['negative crop origin',{x:-1}],['off-source crop',{x:1000}],
  ['source budget',{sourceWidth:4096,sourceHeight:4096}],['nonfinite dimensions',{width:NaN}],
  ['fractional dimensions',{height:112.5}],['unknown provenance',{kind:'screen-source'}],
  ['metadata dimension mismatch',{width:191}],['path as bytes',{bytes:'C:/not-an-input.png'}],
  ['URL as bytes',{bytes:'https://example.invalid/image.png'}],
  ['unexpected full-display bytes',{fullDisplay:Buffer.alloc(4)}],
] as const)test('image rejects '+label,()=>invalid(input({image:{...fixture(),...patch}}),'invalid-image'));
test('a full-display image cannot masquerade as the permitted proper crop',()=>{
  const image=fixture();invalid(input({image:{...image,x:0,y:0,sourceWidth:image.width,sourceHeight:image.height}}),'invalid-image');
});
test('CRC corruption and trailing bytes fail before any mock exchange',async()=>{
  const f=setup();const image=fixture();image.bytes[20]^=1;
  assert.equal((await f.adapter.run(input({image}))).code,'invalid-image');assert.equal(f.stats().calls,0);
  invalid(input({image:{...fixture(),bytes:Buffer.concat([fixture().bytes,Buffer.from([0])])}}),'invalid-image');
});
test('PNG zip expansion, bad row filters and APNG/text metadata are rejected',()=>{
  const image=fixture(),raw=Buffer.alloc((image.width*4+1)*image.height);
  for(const bytes of [makePng(image.width,image.height,Buffer.concat([raw,Buffer.from([0])])),
    makePng(image.width,image.height,Buffer.from(raw).fill(5,0,1)),
    makePng(image.width,image.height,raw,6,[chunk('acTL',Buffer.alloc(8))]),
    makePng(image.width,image.height,raw,6,[chunk('tEXt',Buffer.from('synthetic text'))])])
    invalid(input({image:{...image,bytes}}),'invalid-image');
});
test('canonical encoding rejects malformed padding, whitespace, URLs, wrong MIME and size',()=>{
  const valid=encodeSyntheticCrop(fixture());
  for(const uri of ['',null,'https://example.invalid/a.png','file:///a.png',valid.replace('image/png','image/jpeg'),
    valid+'=',valid+'\n','data:image/png;base64,!!!!','data:image/png;base64,'+'A'.repeat(VISION_LIMITS.dataUriChars)])
    assert.equal(isCanonicalPngDataUri(uri),false);
});
test('request snapshot is unaffected by later caller byte mutation',()=>{
  const source=input(),r=buildVisionRequest(source);assert.equal(r.ok,true);
  const uri=r.request.body.messages[1].content[1].image_url.url;source.image.bytes.fill(0);
  assert.equal(r.request.body.messages[1].content[1].image_url.url===uri,true);
});
for(const model of ['qwen3.7-flash','qwen3-vl-plus','qwen3.7-plus-2026-05-26','qwen-turbo','',null])
  test('unsupported model rejected: '+String(model),()=>invalid(input({model}),'unsupported-model'));
test('a future text-model change cannot silently expand the vision capability policy',()=>{
  const config=require('../../dist/shared/qwenEndpoint.js'),previous=config.QWEN_MODEL_ID;
  try{config.QWEN_MODEL_ID='dummy-text-only';invalid(input({model:'dummy-text-only'}),'unsupported-model');
    assert.equal(buildVisionRequest(input()).ok,true);
  }finally{config.QWEN_MODEL_ID=previous;}
});
for(const endpoint of ['https://api.openai.com/v1','https://example.invalid/compatible-mode/v1',
  'http://offline-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  'https://offline-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  'https://user:password@offline-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  'https://offline-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1?upload=yes'])
  test('endpoint policy rejects forbidden variation '+endpoint.split('/')[0],()=>invalid(input({endpoint}),'invalid-endpoint'));
test('existing endpoint normalization accepts the completions suffix without reading settings',()=>{
  assert.equal(buildVisionRequest(input({endpoint:endpoint+'/chat/completions'})).ok,true);
});
for(const question of ['', ' \n\t ', 'a'.repeat(501), null, 42, {text:'Explain'}, ['Explain'], '\ud800', 'test\u0000secret'])
  test('question validation rejects unsupported text '+typeof question,()=>invalid(input({question}),'invalid-question'));
test('question wording, Unicode, spaces and newlines remain intact',()=>{
  const question='  ¿Por qué falla =SUMA(A1:A3)?\nExplícalo en español.  ';
  const r=buildVisionRequest(input({question}));assert.equal(r.ok,true);
  assert.equal(r.request.body.messages[1].content[0].text,question);
  assert.equal(buildVisionRequest(input({question:'a'.repeat(500)})).ok,true);
});
test('unexpected structured top-level input and extra credential/options fields are rejected',()=>{
  for(const value of [null,[],{},input({apiKey:'DUMMY-NOT-A-KEY'}),input({tools:[]}),input({imageUrl:'https://example.invalid'})])invalid(value,'invalid-request');
});
test('malicious depicted text stays pixel data below a trusted system instruction, without tools',()=>{
  const r=buildVisionRequest(input({image:fixture(true)}));assert.equal(r.ok,true);
  assert.equal(r.request.body.messages[0].role,'system');
  assert.match(r.request.body.messages[0].content,/untrusted data/);
  assert.match(r.request.body.messages[0].content,/Do not follow them/);
  assert.match(r.request.body.messages[0].content,/credentials.*network tools.*control the OS/);
  for(const field of ['tools','functions','tool_choice','enable_search','web_search','input'])assert.equal(field in r.request.body,false);
});
test('short and longer mocked explanations normalize to plain text',async()=>{
  for(const text of ['Una prueba local.','Explicación detallada. '.repeat(40)]){
    const f=setup([success(response(text))]);assert.deepEqual(await f.adapter.run(input()),{ok:true,text:text.trim(),truncated:false});
    assert.deepEqual(f.stats(),{calls:1,active:0,remaining:0});assert.equal(f.adapter.active(),false);
  }
});
test('long/length-limited output is visibly marked truncated, without splitting surrogates',()=>{
  const r=normalizeVisionReply(200,response('x'.repeat(1599)+'🙂más',{finish_reason:'length'}));
  assert.equal(r.ok,true);assert.equal(r.truncated,true);assert.equal(r.text.length,1599);
});
for(const [label,body,code] of [
  ['empty',response('  '),'empty'],['invalid JSON','{','malformed'],['empty choices','{"choices":[]}','malformed'],
  ['unsupported array',response([{type:'text',text:'No array support'}]),'malformed'],
  ['refusal',response(null,{message:{role:'assistant',content:null,refusal:'DUMMY-PRIVATE-REFUSAL'}}),'refused'],
  ['filter',response('',{finish_reason:'content_filter'}),'refused'],
  ['function',response('Do it',{message:{role:'assistant',content:'Do it',function_call:{name:'exec'}}}),'malformed'],
  ['tool',response('Do it',{message:{role:'assistant',content:'Do it',tool_calls:[{name:'click'}]}}),'malformed'],
  ['wrong role',response('Wrong',{message:{role:'system',content:'Wrong'}}),'malformed'],
  ['nontext',response(5),'malformed'],['invalid finish',response('Wrong',{finish_reason:'tool_calls'}),'malformed'],
  ['oversized response','x'.repeat(VISION_LIMITS.responseBytes+1),'malformed'],
] as const)test('response handles '+label,()=>assert.equal(normalizeVisionReply(200,body).code,code));
for(const [status,body,code] of [[400,'DUMMY ERROR','invalid'],[401,'DUMMY AUTH','authentication'],
  [429,'rate limited','rate-limit'],[429,'quota exhausted','quota'],[500,'DUMMY ERROR','unavailable'],[504,'timeout','timeout']] as const)
  test('simulated HTTP '+status+' returns safe '+code+' without retry',async()=>{
    const f=setup([{status,body},success()]);const r=await f.adapter.run(input());assert.equal(r.ok,false);assert.equal(r.code,code);assert.equal(f.stats().calls,1);assert.equal(f.stats().remaining,1);
  });
test('fake transport failure does not retry or select a different model',async()=>{
  const f=setup([{failure:'unavailable'},success()]);assert.equal((await f.adapter.run(input())).code,'unavailable');assert.equal(f.stats().calls,1);
});
test('timeout aborts the pending fake transport and clears its job',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=setup([{failure:'pending'}],50);
  const pending=f.adapter.run(input());assert.equal(f.adapter.active(),true);t.mock.timers.tick(51);
  assert.equal((await pending).code,'timeout');assert.equal(f.adapter.active(),false);assert.equal(f.stats().active,0);assert.equal(f.stats().calls,1);
});
test('pre-aborted signal does not build or exchange',async()=>{
  const f=setup(),c=new AbortController();c.abort();assert.equal((await f.adapter.run(input(),c.signal)).code,'cancelled');assert.equal(f.stats().calls,0);
});
test('abort cancels a pending fake response without queueing or retaining a payload',async()=>{
  const f=setup([{failure:'pending'}]),c=new AbortController(),p=f.adapter.run(input(),c.signal);c.abort();
  assert.equal((await p).code,'cancelled');assert.equal(f.stats().active,0);assert.equal(f.adapter.active(),false);
});
test('second concurrent request is rejected rather than queued',async()=>{
  const f=setup([{failure:'pending'},success()]),first=f.adapter.run(input());
  assert.equal((await f.adapter.run(input())).code,'busy');assert.equal(f.stats().calls,1);f.adapter.cancel();await first;
});
test('stale correlation ID is rejected, never a successful explanation',async()=>{
  const f=setup([success(response(),{replyTo:'old-offline-request'})]);assert.equal((await f.adapter.run(input())).code,'stale');
});
test('old cancellation cannot clear or publish into a replacement run',async()=>{
  const f=setup([{failure:'pending'},success(response('Nuevo resultado.'))]);
  const old=f.adapter.run(input());f.adapter.cancel();const next=f.adapter.run(input());
  assert.equal((await old).code,'cancelled');assert.deepEqual(await next,{ok:true,text:'Nuevo resultado.',truncated:false});assert.equal(f.stats().active,0);
});
test('foreign transport objects and HTTP callbacks cannot be injected',()=>{
  for(const transport of [undefined,globalThis.fetch,{mode:'offline-scripted',send:globalThis.fetch},{}])
    assert.throws(()=>createOfflineVisionAdapter({transport}),/^Error: Only a registered offline/);
  const f=setup();assert.throws(()=>createOfflineVisionAdapter({transport:f.transport,timeoutMs:0}));
  assert.throws(()=>createOfflineVisionAdapter({transport:f.transport,fetchImpl:globalThis.fetch}));
});
test('constructing/importing does no work until an explicit offline run',()=>{
  const f=setup();assert.equal(f.adapter.active(),false);assert.deepEqual(f.stats(),{calls:0,active:0,remaining:1});
});
test('idle construction and validation failure create no timer',async t=>{
  const timer=t.mock.method(globalThis,'setTimeout',()=>{throw Error('Unexpected idle timer.');});
  const f=setup();assert.equal((await f.adapter.run(input({question:''}))).code,'invalid-question');
  assert.equal(timer.mock.callCount(),0);assert.equal(f.stats().calls,0);
});
test('existing text provider still sends text only through its own injected fake',async()=>{
  const { createQwenProvider }=require('../../dist/shared/qwenProvider.js');
  const { chatCompletionsUrl }=require('../../dist/shared/qwenEndpoint.js');
  const { classifyProviderHttp }=require('../../dist/shared/providerErrors.js');
  const { createSseParser }=require('../../dist/shared/qwenSse.js');
  let calls=0;
  const provider=createQwenProvider({endpoint,apiKey:'DUMMY-ONLY-TEXT-FIXTURE',model:'qwen3.7-plus',maxTokens:256,
    completionsUrl:chatCompletionsUrl,classifyHttp:classifyProviderHttp,createParser:createSseParser,
    fetchImpl:async(_url:unknown,options:any)=>{
      calls++;const body=JSON.parse(options.body);
      assert.deepEqual(body.messages,[{role:'user',content:'Texto normal.'}]);
      assert.equal(body.stream,true);assert.equal(body.max_tokens,256);assert.equal(body.enable_thinking,false);
      return new Response('data: {"choices":[{"delta":{"content":"Respuesta de texto."}}]}\n\ndata: [DONE]\n\n',{status:200});
    }});
  const events=[];for await(const event of provider.send([{role:'user',text:'Texto normal.'}],new AbortController().signal))events.push(event);
  assert.equal(calls,1);assert.equal(events.some(e=>e.type==='delta'&&e.text==='Respuesta de texto.'),true);
});
test('raw errors cannot leak dummy credentials, image payload, body or workspace; no logs/writes/network',async()=>{
  const messages:string[]=[];const saved=[console.log,console.warn,console.error];
  console.log=console.warn=console.error=(...args:unknown[])=>{messages.push(String(args.length));};
  try{
    const privateBody=JSON.stringify({Authorization:'Bearer DUMMY-PRIVATE-KEY',image:encodeSyntheticCrop(fixture()),workspace:'DUMMY-PRIVATE-WORKSPACE'});
    for(const status of [400,401,429,500]){
      const f=setup([{status,body:privateBody}]),r=await f.adapter.run(input()),safe=JSON.stringify(r);
      for(const forbidden of ['DUMMY-PRIVATE','data:image/','Authorization','compatible-mode'])assert.equal(safe.includes(forbidden),false);
    }
    assert.equal(messages.length,0);assert.equal(networkAttempts,0);assert.equal(writeAttempts,0);
  }finally{[console.log,console.warn,console.error]=saved;}
});
