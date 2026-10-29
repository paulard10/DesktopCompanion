import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { createRequire } from 'node:module';
import { createFileVault,validateApiKey } from '../shared/keyVault.ts';
const require=createRequire(import.meta.url);
const {initializePilotCredentialContext,checkPilotCredentialContext,requirePilotCredentialContext,credentialFiles,QWEN_CREDENTIAL_FILE}=require('../../dist/main/pilotCredentialContext.js');
const {checkDisposableCredentialContexts}=await import('../../scripts/credential-context-check.mjs');
const dummy='TEST_ONLY_NOT_A_REAL_API_KEY',temporary=fs.realpathSync(os.tmpdir());
const root=fs.mkdtempSync(path.join(temporary,'desktop-companion-credential-unit-'));
after(()=>{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),temporary);assert.ok(path.basename(resolved).startsWith('desktop-companion-credential-unit-'));fs.rmSync(resolved,{recursive:true,force:true});});
const approved={appName:'desktop-companion',userData:path.join(root,'profile-a'),sessionData:path.join(root,'profile-a')};
function appContext(patch:any={}){
 const state={ready:false,name:'Electron',userData:path.join(root,'profile-b'),sessionData:path.join(root,'profile-b'),...patch};
 return {state,isPackaged:false,isReady:()=>state.ready,getName:()=>state.name,getPath:(name:string)=>state[name],
  setName:(name:string)=>{state.name=name;},setPath:(name:string,value:string)=>{state[name]=value;}};
}
let sequence=0;
function file(){return path.join(root,'entry-'+sequence+++'.bin');}
function setup(patch:any={}){
 const location=file(),cipher={isAvailable:async()=>true,encrypt:async(value:string)=>Buffer.from('test-sealed:'+value),
  decrypt:async(value:Buffer)=>({result:value.toString().slice('test-sealed:'.length),shouldReEncrypt:false}),...patch};
 return {file:location,cipher,vault:createFileVault(location,cipher)};
}
test('ordinary and pilot lookup contracts use current userData and the fixed Qwen filename',()=>{
 const paths=credentialFiles(approved.userData);assert.equal(paths.key,path.join(approved.userData,'companion','qwen-key.bin'));
 assert.equal(paths.settings,path.join(approved.userData,'companion','provider-settings.json'));assert.equal(QWEN_CREDENTIAL_FILE,'qwen-key.bin');
});
test('explicit early context aligns identity, userData AND sessionData before readiness',()=>{
 const app=appContext();assert.equal(initializePilotCredentialContext(app,approved),'CONTEXT_MATCHED');
 assert.equal(app.state.name,'desktop-companion');assert.equal(app.state.userData,approved.userData);assert.equal(app.state.sessionData,approved.sessionData);
 assert.equal(checkPilotCredentialContext(app,approved,'qwen'),'APP_NOT_READY');app.state.ready=true;
 assert.equal(checkPilotCredentialContext(app,approved,'qwen'),'CONTEXT_MATCHED');
});
for(const field of ['name','userData','sessionData'])test('mismatched '+field+' is rejected before any credential acquisition',()=>{
 const app=appContext();initializePilotCredentialContext(app,approved);app.state.ready=true;app.state[field]=field==='name'?'Electron':path.join(root,'different');
 assert.equal(checkPilotCredentialContext(app,approved,'qwen'),'CREDENTIAL_NAMESPACE_MISMATCH');
});
test('initialization after ready or packaged execution is refused without rewriting context',()=>{
 const late=appContext({ready:true});assert.equal(initializePilotCredentialContext(late,approved),'CREDENTIAL_ACCESS_UNVERIFIED');assert.equal(late.state.name,'Electron');
 const packaged=appContext();packaged.isPackaged=true;assert.equal(initializePilotCredentialContext(packaged,approved),'CREDENTIAL_ACCESS_UNVERIFIED');
});
test('relative or unapproved namespaces cannot cause an automatic installed-profile redirect',()=>{
 const app=appContext();assert.equal(initializePilotCredentialContext(app,{...approved,userData:'relative'}),'CREDENTIAL_NAMESPACE_MISMATCH');
 assert.equal(initializePilotCredentialContext(app,{...approved,appName:'other'}),'CREDENTIAL_NAMESPACE_MISMATCH');assert.throws(()=>credentialFiles('relative'));
 assert.equal(app.state.name,'Electron');
});
test('provider selection and lookup ID are checked without opening a vault',()=>{
 const app=appContext();initializePilotCredentialContext(app,approved);app.state.ready=true;
 assert.equal(checkPilotCredentialContext(app,approved,'demo'),'PROVIDER_NOT_CONFIGURED');
 assert.equal(checkPilotCredentialContext(app,approved,'qwen','other-key.bin'),'CREDENTIAL_LOOKUP_ERROR');
});
test('context API failures are sanitized without paths or raw errors',()=>{
 const app=appContext();initializePilotCredentialContext(app,approved);app.state.ready=true;app.getPath=()=>{throw Error('PRIVATE path');};
 const result=checkPilotCredentialContext(app,approved,'qwen');assert.equal(result,'CREDENTIAL_LOOKUP_ERROR');assert.equal(result.includes('PRIVATE'),false);
});
for(const state of ['not-ready','wrong-profile','demo','matched'])test('context gate prevents credential/network callbacks for '+state,()=>{
 const app=appContext();initializePilotCredentialContext(app,approved);app.state.ready=state!=='not-ready';
 if(state==='wrong-profile')app.state.sessionData=path.join(root,'different');
 let credentials=0,transport=0;
 const attempt=()=>{requirePilotCredentialContext(app,approved,state==='demo'?'demo':'qwen');credentials++;transport++;};
 if(state==='matched'){attempt();assert.equal(credentials,1);assert.equal(transport,1);}
 else{assert.throws(attempt);assert.equal(credentials,0);assert.equal(transport,0);}
});
test('synthetic key roundtrip preserves existing vault return contract and explicit clear',async()=>{
 const x=setup();assert.equal(x.vault.diagnosticStatus!(),'CREDENTIAL_ACCESS_UNVERIFIED');await x.vault.prepare();assert.equal(x.vault.available(),true);
 assert.equal(await x.vault.save(dummy),'saved');assert.equal(await x.vault.load(),dummy);assert.equal(x.vault.diagnosticStatus!(),'AVAILABLE');
 x.vault.clear();assert.equal(fs.existsSync(x.file),false);
});
test('invalid dummy key is rejected before persistence',async()=>{
 const x=setup();assert.equal(validateApiKey('bad key\n'),false);assert.equal(await x.vault.save('bad key\n'),'rejected');assert.equal(fs.existsSync(x.file),false);
});
test('missing selected dummy entry is reported only after ENOENT is observed',async()=>{
 const x=setup();assert.equal(await x.vault.load(),null);assert.equal(x.vault.diagnosticStatus!(),'CREDENTIAL_ENTRY_MISSING');
});
test('unavailable encryption does not inspect/decrypt or delete an existing file',async()=>{
 let decrypts=0;const x=setup({isAvailable:async()=>false,decrypt:async()=>{decrypts++;throw Error('not called');}});fs.writeFileSync(x.file,'preserve');
 assert.equal(await x.vault.load(),null);assert.equal(x.vault.diagnosticStatus!(),'SECURE_STORAGE_UNAVAILABLE');assert.equal(decrypts,0);assert.equal(fs.readFileSync(x.file,'utf8'),'preserve');
});
test('encryption availability error is not misreported as a missing credential',async()=>{
 const x=setup({isAvailable:async()=>{throw Error('PRIVATE');}});assert.equal(await x.vault.load(),null);assert.equal(x.vault.diagnosticStatus!(),'SECURE_STORAGE_UNAVAILABLE');
});
test('regression: decrypt failure never erases ciphertext and permits later correct-context recovery',async()=>{
 const x=setup();await x.vault.save(dummy);const before=fs.readFileSync(x.file),decrypt=x.cipher.decrypt;
 x.cipher.decrypt=async()=>{throw Error('PRIVATE crypto detail');};assert.equal(await x.vault.load(),null);
 assert.equal(x.vault.diagnosticStatus!(),'CREDENTIAL_LOOKUP_ERROR');assert.ok(fs.readFileSync(x.file).equals(before));
 x.cipher.decrypt=decrypt;assert.equal(await x.vault.load(),dummy);
});
test('invalid decrypted dummy record is distinguished but preserved',async()=>{
 const x=setup({decrypt:async()=>({result:' ',shouldReEncrypt:false})});fs.writeFileSync(x.file,'opaque-dummy');
 assert.equal(await x.vault.load(),null);assert.equal(x.vault.diagnosticStatus!(),'CREDENTIAL_RECORD_INVALID');assert.equal(fs.readFileSync(x.file,'utf8'),'opaque-dummy');
});
for(const size of [0,16_385])test('bounded malformed dummy record '+size+' is rejected without deletion/decryption',async()=>{
 let decrypts=0;const x=setup({decrypt:async()=>{decrypts++;throw Error('not called');}});fs.writeFileSync(x.file,Buffer.alloc(size));
 assert.equal(await x.vault.load(),null);assert.equal(x.vault.diagnosticStatus!(),'CREDENTIAL_RECORD_INVALID');assert.equal(decrypts,0);assert.equal(fs.statSync(x.file).size,size);
});
test('metadata access error is LOOKUP_ERROR, not proof of an absent entry',async()=>{
 const x=setup(),original=fs.lstatSync;fs.lstatSync=(()=>{throw Object.assign(Error('PRIVATE access denied'),{code:'EACCES'});}) as typeof fs.lstatSync;
 try{assert.equal(await x.vault.load(),null);assert.equal(x.vault.diagnosticStatus!(),'CREDENTIAL_LOOKUP_ERROR');}finally{fs.lstatSync=original;}
});
test('read error preserves bytes and is not classified as missing',async()=>{
 const x=setup();fs.writeFileSync(x.file,'preserve');const original=fs.readFileSync;
 fs.readFileSync=((p:any,...args:any[])=>{if(p===x.file)throw Error('PRIVATE read error');return (original as any)(p,...args);}) as typeof fs.readFileSync;
 try{assert.equal(await x.vault.load(),null);assert.equal(x.vault.diagnosticStatus!(),'CREDENTIAL_LOOKUP_ERROR');}finally{fs.readFileSync=original;}
 assert.equal(fs.readFileSync(x.file,'utf8'),'preserve');
});
test('failed re-encryption does not delete the original encrypted record',async()=>{
 const x=setup({encrypt:async()=>{throw Error('PRIVATE');},decrypt:async()=>({result:dummy,shouldReEncrypt:true})});fs.writeFileSync(x.file,'original');
 assert.equal(await x.vault.load(),null);assert.equal(x.vault.diagnosticStatus!(),'CREDENTIAL_LOOKUP_ERROR');assert.equal(fs.readFileSync(x.file,'utf8'),'original');
});
test('diagnostic status is secret-free and failure writes no stdout/stderr',async()=>{
 const logs:any[]=[],old=[console.log,console.warn,console.error];console.log=console.warn=console.error=(...v:any[])=>logs.push(v);
 try{const x=setup({decrypt:async()=>{throw Error(dummy);}});fs.writeFileSync(x.file,'opaque');await x.vault.load();
  assert.equal(JSON.stringify(x.vault.diagnosticStatus!()).includes(dummy),false);assert.deepEqual(logs,[]);
 }finally{[console.log,console.warn,console.error]=old;}
});
test('normal text, renderer/preload, mock preview, motion and consent interfaces stay untouched',()=>{
 const chat=fs.readFileSync(path.resolve('src/main/chatWindow.ts'),'utf8'),preload=fs.readFileSync(path.resolve('src/preload/chatPreload.ts'),'utf8');
 assert.match(chat,/path\.join\(app\.getPath\('userData'\), 'companion'\)/);assert.equal(preload.includes('diagnosticStatus'),false);
 assert.equal(preload.includes('pilotCredentialContext'),false);assert.equal(chat.includes('initializePilotCredentialContext'),false);
});
test('context diagnostics have no network, credential export, live grant or automatic data migration',()=>{
 const source=fs.readFileSync(path.resolve('src/main/pilotCredentialContext.ts'),'utf8');
 assert.equal(/fetch\(|\.load\(|readFile|decrypt|process\.env|appData/.test(source),false);
 const transport=fs.readFileSync(path.resolve('src/main/qwenVisionTransport.ts'),'utf8');assert.match(transport,/LIVE_VISION_DISABLED = true/);
 const cli=fs.readFileSync(path.resolve('scripts/vision-live-preflight.mjs'),'utf8');assert.match(cli,/domain !== 'offline-http-test'/);
});
test('smoke starts in a disposable profile and waits for close before verified cleanup',()=>{
 const source=fs.readFileSync(path.resolve('scripts/smoke.mjs'),'utf8');
 assert.match(source,/--user-data-dir=/);assert.match(source,/child\.on\('close'/);assert.match(source,/path\.dirname\(resolved\) !== temporaryRoot/);
});
test('real Windows DPAPI dummy profiles: correct parent/child recovery, wrong profile denial, retained ciphertext and cleanup',
 {skip:process.platform!=='win32',timeout:100_000},async()=>{
 const result=await checkDisposableCredentialContexts();assert.equal(result.mode,'DUMMY_OFFLINE_ONLY');assert.equal(result.cleanup,true);assert.equal(result.realProviderRequests,0);
 const [writer,same,wrong,recovered]=result.results;assert.equal(writer.initialNameMatches,true);assert.equal(same.initialNameMatches,false);
 for(const r of result.results){assert.equal(r.childClosed,true);assert.equal(r.exitCode,0);assert.equal(r.encryptionAvailable,true);assert.equal(r.ready,true);
  assert.equal(r.startupProfileIsolated,true);
  assert.equal(r.networkAttempts,0);assert.equal(r.privateReads,0);assert.equal(r.argumentsSafe,true);assert.equal(r.cipherNotPlaintext,true);assert.equal(r.cipherPreserved,true);}
 assert.equal(writer.roundTrip,true);assert.equal(same.roundTrip,true);assert.equal(recovered.roundTrip,true);
 assert.equal(wrong.contextStatus,'CREDENTIAL_NAMESPACE_MISMATCH');assert.equal(wrong.roundTrip,false);assert.equal(wrong.loadStatus,'CREDENTIAL_LOOKUP_ERROR');
 assert.equal(wrong.lookupGuardBlocked,true);assert.equal(same.lookupGuardBlocked,false);
 assert.equal(JSON.stringify(result).includes(dummy),false);
});
