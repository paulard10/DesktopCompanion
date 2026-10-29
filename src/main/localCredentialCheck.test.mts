import assert from 'node:assert/strict';import test,{after}from'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{createRequire}from'node:module';
import{checkCredentialReadOnly}from'../shared/keyVault.ts';
const require=createRequire(import.meta.url);
const {createLocalCredentialCheck,providerConfiguredReadOnly}=require('../../dist/main/localCredentialCheck.js');
const {runDummyLocalCheck}=await import('../../scripts/local-credential-check.mjs');
const temporary=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(temporary,'desktop-companion-local-unit-'));
after(()=>{const target=fs.realpathSync(root);assert.equal(path.dirname(target),temporary);assert.ok(path.basename(target).startsWith('desktop-companion-local-unit-'));fs.rmSync(target,{recursive:true,force:true});});
const dummy='TEST_ONLY_NOT_A_REAL_API_KEY';let sequence=0;
function sample(){const file=path.join(root,'opaque-'+sequence+++'.bin');fs.writeFileSync(file,'opaque-test-record');return file;}
function cipher(patch:any={}){return{isAvailable:async()=>true,decrypt:async()=>({result:dummy,shouldReEncrypt:false}),...patch};}
function context(){
 const profile=path.join(root,'profile-'+sequence++);fs.mkdirSync(path.join(profile,'companion'),{recursive:true});
 const expected={appName:'desktop-companion',userData:profile,sessionData:profile};
 const app={isReady:()=>true,isPackaged:false,getName:()=>expected.appName,getPath:(name:string)=>expected[name],setName:()=>{throw Error('forbidden');},setPath:()=>{throw Error('forbidden');}};
 const settings=path.join(profile,'companion/provider-settings.json');fs.writeFileSync(settings,JSON.stringify({provider:'qwen',endpoint:'https://offline-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'}));
 return{app,expected,settings};
}
test('read-only native boundary returns only availability and never a secret value',async()=>{
 const file=sample(),before=fs.readFileSync(file);let decrypts=0;
 const result=await checkCredentialReadOnly(file,cipher({decrypt:async()=>{decrypts++;return{result:dummy,shouldReEncrypt:false};}}));
 assert.equal(result,'AVAILABLE_LOCALLY');assert.equal(decrypts,1);assert.ok(fs.readFileSync(file).equals(before));assert.equal(JSON.stringify(result).includes(dummy),false);
});
test('read-only check deliberately does not re-encrypt even when native cipher requests rotation',async()=>{
 const file=sample(),before=fs.readFileSync(file);let encrypts=0;
 assert.equal(await checkCredentialReadOnly(file,cipher({encrypt:async()=>{encrypts++;throw Error('no write');},decrypt:async()=>({result:dummy,shouldReEncrypt:true})})),'AVAILABLE_LOCALLY');
 assert.equal(encrypts,0);assert.ok(fs.readFileSync(file).equals(before));
});
test('confirmed absent entry is distinguished without decrypting or creating a record',async()=>{
 let decrypts=0;const file=path.join(root,'absent.bin');assert.equal(await checkCredentialReadOnly(file,cipher({decrypt:async()=>{decrypts++;throw Error('not called');}})),'CREDENTIAL_ENTRY_MISSING');assert.equal(decrypts,0);assert.equal(fs.existsSync(file),false);
});
for(const available of [false,'throws'])test('unavailable encryption '+available+' prevents credential read/decrypt',async()=>{
 let decrypts=0;assert.equal(await checkCredentialReadOnly(sample(),cipher({isAvailable:async()=>{if(available==='throws')throw Error(dummy);return false;},decrypt:async()=>{decrypts++;throw Error('not called');}})),'SECURE_STORAGE_UNAVAILABLE');assert.equal(decrypts,0);
});
test('failed native decryption is distinct from absent entry and preserves ciphertext',async()=>{
 const file=sample(),before=fs.readFileSync(file);assert.equal(await checkCredentialReadOnly(file,cipher({decrypt:async()=>{throw Error(dummy);}})),'CREDENTIAL_DECRYPTION_FAILED');assert.ok(fs.readFileSync(file).equals(before));
});
for(const result of ['',null,'bad key\n'])test('invalid recovered value safely stops without disclosing its characteristics '+String(result),async()=>{
 assert.equal(await checkCredentialReadOnly(sample(),cipher({decrypt:async()=>({result,shouldReEncrypt:false})})),'UNVERIFIED_SAFE_STOP');
});
test('read error is not absence; no file modification or log output',async()=>{
 const file=sample(),read=fs.readFileSync,logs:any[]=[];const originalLog=[console.log,console.warn,console.error];
 fs.readFileSync=((p:any,...args:any[])=>{if(p===file)throw Error(dummy);return(read as any)(p,...args);})as typeof fs.readFileSync;
 console.log=console.warn=console.error=(...args:any[])=>logs.push(args);
 try{assert.equal(await checkCredentialReadOnly(file,cipher()),'CREDENTIAL_READ_ERROR');assert.deepEqual(logs,[]);}finally{fs.readFileSync=read;[console.log,console.warn,console.error]=originalLog;}
 assert.equal(fs.readFileSync(file,'utf8'),'opaque-test-record');
});
for(const size of [0,16385])test('invalid record bounds '+size+' stop before native decryption',async()=>{
 const file=sample();fs.writeFileSync(file,Buffer.alloc(size));let decrypts=0;
 assert.equal(await checkCredentialReadOnly(file,cipher({decrypt:async()=>{decrypts++;throw Error('not called');}})),'UNVERIFIED_SAFE_STOP');assert.equal(decrypts,0);assert.equal(fs.statSync(file).size,size);
});
test('settings diagnostic is read-only, bounded and never sanitizes a legacy secret into another file',()=>{
 const x=context();assert.equal(providerConfiguredReadOnly(x.settings),true);
 const legacy=JSON.stringify({provider:'qwen',endpoint:'https://offline-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',apiKey:dummy});
 fs.writeFileSync(x.settings,legacy);assert.equal(providerConfiguredReadOnly(x.settings),false);assert.equal(fs.readFileSync(x.settings,'utf8'),legacy);
});
test('provider incomplete prevents retrieval',async()=>{
 const x=context();fs.writeFileSync(x.settings,JSON.stringify({provider:'demo'}));let calls=0;
 const check=createLocalCredentialCheck({...x,readOnlyAvailability:async()=>{calls++;return'AVAILABLE_LOCALLY';}});
 assert.deepEqual(await check(),{outcome:'PROVIDER_CONFIGURATION_INCOMPLETE',retrievalAttempted:false});assert.equal(calls,0);
});
for(const state of ['name','userData','sessionData','not-ready','packaged'])test('incorrect context '+state+' stops without changing identity or reading a credential',async()=>{
 const x=context();if(state==='name')x.app.getName=()=> 'Electron';else if(state==='not-ready')x.app.isReady=()=>false;else if(state==='packaged')x.app.isPackaged=true;
 else x.app.getPath=(name:string)=>name===state?path.join(root,'other'):x.expected[name];
 let calls=0;const check=createLocalCredentialCheck({...x,readOnlyAvailability:async()=>{calls++;return'AVAILABLE_LOCALLY';}});
 const result=await check();assert.equal(result.retrievalAttempted,false);assert.equal(calls,0);
 assert.equal(result.outcome,['not-ready','packaged'].includes(state)?'APP_CONTEXT_INVALID':'CREDENTIAL_NAMESPACE_MISMATCH');
});
for(const outcome of ['AVAILABLE_LOCALLY','CREDENTIAL_DECRYPTION_FAILED','CREDENTIAL_ENTRY_MISSING'])test('one-shot local check has no retry after '+outcome,async()=>{
 const x=context();let calls=0;const check=createLocalCredentialCheck({...x,readOnlyAvailability:async()=>{calls++;return outcome;}});
 assert.deepEqual(await check(),{outcome,retrievalAttempted:true});assert.deepEqual(await check(),{outcome:'UNVERIFIED_SAFE_STOP',retrievalAttempted:false});assert.equal(calls,1);
});
test('exception after entering availability does not leak details or permit retry',async()=>{
 const x=context();let calls=0;const check=createLocalCredentialCheck({...x,readOnlyAvailability:async()=>{calls++;throw Error(dummy);}});
 assert.deepEqual(await check(),{outcome:'UNVERIFIED_SAFE_STOP',retrievalAttempted:true});await check();assert.equal(calls,1);
});
test('no secret API reaches renderer or normal app; diagnostic has no network/provider imports',()=>{
 const source=fs.readFileSync('src/main/localCredentialCheck.ts','utf8');assert.equal(/fetch|qwenVisionTransport|qwenProvider|\.save\(|writeFile|decryptString/.test(source),false);
 const app=fs.readFileSync('src/main/main.ts','utf8');assert.equal(app.includes('localCredentialCheck'),false);
 for(const file of ['src/preload/preload.ts','src/preload/chatPreload.ts'])assert.equal(fs.readFileSync(file,'utf8').includes('checkSafeCredentialReadOnly'),false);
 assert.match(fs.readFileSync('src/main/qwenVisionTransport.ts','utf8'),/LIVE_VISION_DISABLED = true/);
});
test('real launch is never in npm test and has exclusive separate local-only claims',()=>{
 const source=fs.readFileSync('scripts/local-credential-check.mjs','utf8'),worker=fs.readFileSync('scripts/local-credential-worker.cjs','utf8');
 assert.match(source,/credential107-real-check\.consumed/);assert.match(worker,/credential107-real-child\.consumed/);assert.match(source,/flag:'wx'/);
 const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));assert.equal(pkg.scripts.test.includes('--real-once-107'),false);
});
test('native isolated read-only rehearsal: kernel locks, readiness, recovery, wrong-profile rejection and zero network',
 {skip:process.platform!=='win32',timeout:120000},async()=>{
 const r=await runDummyLocalCheck();assert.equal(r.pass,true);assert.equal(r.cleanup,true);
 for(const result of [r.same,r.recovered]){assert.equal(result.outcome,'AVAILABLE_LOCALLY');assert.equal(result.retrievalAttempted,true);assert.equal(result.guardSelfTests,7);assert.equal(result.networkAttempts,0);assert.equal(result.readLocksHeld,true);assert.equal(result.protectedFilesUnchanged,true);assert.equal(result.childClosed,true);}
 assert.equal(r.wrong.outcome,'CREDENTIAL_NAMESPACE_MISMATCH');assert.equal(r.wrong.retrievalAttempted,false);assert.equal(JSON.stringify(r).includes(dummy),false);
});
