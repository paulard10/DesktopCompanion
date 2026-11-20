/** Prompts 107/110: real checks require a distinct, explicit single-use local scope. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn}from'node:child_process';import{fileURLToPath,pathToFileURL}from'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const diagnostics=path.join(project,'.local-vision-diagnostics');
const scopes=Object.freeze({
 '107':Object.freeze({realFlag:'--real-once-107',dryFlag:'--dummy',mode:'real107',resultMode:'LOCAL_ONLY_107',
  dryFile:'credential107-dry-run.json',launchClaim:'credential107-real-check.consumed',childClaim:'credential107-real-child.consumed',resultFile:'credential107-result.json'}),
 '110':Object.freeze({realFlag:'--real-once-110',dryFlag:'--dummy-110',mode:'real110',resultMode:'LOCAL_ONLY_110',
  dryFile:'credential110-dry-run.json',launchClaim:'credential110-real-check.consumed',childClaim:'credential110-real-child.consumed',resultFile:'credential110-result.json'}),
});
/** Non-secret invocation metadata only; not an inference permit or secret-access API. */
export function localCheckScope(task){
 if(task!=='107'&&task!=='110')throw Error('Unsupported local-check scope');
 return scopes[task];
}
const outcomes=new Set(['AVAILABLE_LOCALLY','CREDENTIAL_ENTRY_MISSING','CREDENTIAL_DECRYPTION_FAILED','SECURE_STORAGE_UNAVAILABLE',
 'CREDENTIAL_NAMESPACE_MISMATCH','APP_CONTEXT_INVALID','PROVIDER_CONFIGURATION_INCOMPLETE','CREDENTIAL_READ_ERROR','UNVERIFIED_SAFE_STOP']);
function safeResult(value){
 if(!value||!outcomes.has(value.outcome))throw Error('Invalid diagnostic output');
 const result={outcome:value.outcome,retrievalAttempted:typeof value.retrievalAttempted==='boolean'?value.retrievalAttempted:null};
 for(const field of ['contextMatched','encryptionReady','guardReady','readLocksHeld','protectedFilesUnchanged','childClosed','stderrPresent'])result[field]=typeof value[field]==='boolean'?value[field]:null;
 for(const field of ['networkAttempts','sessionRequestsBlocked','guardSelfTests'])result[field]=Number.isSafeInteger(value[field])&&value[field]>=0&&value[field]<=100?value[field]:null;
 return result;
}
function execute(file,args,env){
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{cwd:project,env,shell:false,windowsHide:true,detached:false,stdio:['ignore','pipe','pipe']});
  let out='',invalid=false;
  const deadline=setTimeout(()=>{invalid=true;if(child.pid)spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});},60000);
  child.stdout.on('data',b=>{if(Buffer.byteLength(out)+b.length>8192){invalid=true;child.kill();}else out+=b.toString();});
  child.stderr.on('data',()=>{}); // Never return or persist arbitrary native errors.
  child.once('error',()=>{clearTimeout(deadline);reject(Error('Local diagnostic launch failed'));});
  child.once('close',code=>{clearTimeout(deadline);if(code!==0||invalid)return reject(Error('Local diagnostic unavailable'));
   try{resolve(safeResult(JSON.parse(out.trim())));}catch{reject(Error('Local diagnostic result unverified'));}});
 });
}
function environment(){const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE'])if(process.env[key])env[key]=process.env[key];return env;}
function ownRoot(){
 const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'desktop-companion-local-check-'));
 for(const name of ['normal-package','profile-a','profile-b'])fs.mkdirSync(path.join(root,name));
 const manifest=JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
 if((manifest.productName??manifest.name)!=='desktop-companion')throw Error('Unapproved package identity');
 fs.writeFileSync(path.join(root,'normal-package/package.json'),JSON.stringify({name:manifest.name,version:manifest.version,main:path.join(project,'scripts/local-credential-worker.cjs')}));
 return {base,root};
}
function cleanup({base,root}){
 const resolved=fs.realpathSync(root);if(path.dirname(resolved)!==base||!path.basename(resolved).startsWith('desktop-companion-local-check-'))throw Error('Unsafe temporary cleanup refused');
 fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});return !fs.existsSync(resolved);
}
async function locked(root,mode){
 fs.writeFileSync(path.join(root,'control.json'),JSON.stringify({mode}));
 const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 return execute(powershell,['-NoProfile','-NonInteractive','-File',path.join(project,'scripts/local-credential-locks.ps1'),'-ControlRoot',root],environment());
}
export async function runDummyLocalCheck(){
 const owned=ownRoot();let result;
 try{
  const prepared=await execute(path.join(project,'node_modules/electron/dist/electron.exe'),[path.join(owned.root,'normal-package'),'--user-data-dir='+path.join(owned.root,'profile-a')],
   {...environment(),DESKTOP_COMPANION_LOCAL_CHECK_ROOT:owned.root,DESKTOP_COMPANION_LOCAL_CHECK_MODE:'prepare-dummy'});
  if(prepared.outcome!=='AVAILABLE_LOCALLY'||!prepared.guardReady)throw Error('Dummy preparation failed');
  const same=await locked(owned.root,'dummy'),wrong=await locked(owned.root,'wrong-dummy'),recovered=await locked(owned.root,'dummy');
  const pass=[same,recovered].every(r=>r.outcome==='AVAILABLE_LOCALLY'&&r.retrievalAttempted&&r.contextMatched&&r.encryptionReady&&r.guardReady&&r.guardSelfTests===7&&r.networkAttempts===0&&r.sessionRequestsBlocked===0&&r.readLocksHeld&&r.protectedFilesUnchanged&&r.childClosed)
   &&wrong.outcome==='CREDENTIAL_NAMESPACE_MISMATCH'&&wrong.retrievalAttempted===false&&wrong.protectedFilesUnchanged;
  result={mode:'DUMMY_ONLY',pass,same,wrong,recovered};
 }finally{const cleaned=cleanup(owned);if(result)result.cleanup=cleaned;}
 return result;
}
async function runRealOnce(task){
 const scope=localCheckScope(task);
 const dry=JSON.parse(fs.readFileSync(path.join(diagnostics,scope.dryFile),'utf8'));
 if(dry.mode!=='DUMMY_ONLY'||dry.pass!==true||dry.cleanup!==true)throw Error('Dummy preflight required');
 if(fs.lstatSync(diagnostics).isSymbolicLink()||fs.realpathSync(diagnostics)!==diagnostics)throw Error('Diagnostic path refused');
 // A durable LOCAL-ONLY claim; it is never a live-inference authorization.
 const claim=fs.openSync(path.join(diagnostics,scope.launchClaim),'wx',0o600);fs.closeSync(claim);
 const owned=ownRoot();let result;
 try{result=await locked(owned.root,scope.mode);}
 catch{result=safeResult({outcome:'UNVERIFIED_SAFE_STOP',retrievalAttempted:null});}
 finally{const cleaned=cleanup(owned);if(result)result.temporaryCleanup=cleaned;}
 fs.writeFileSync(path.join(diagnostics,scope.resultFile),JSON.stringify({mode:scope.resultMode,...result}),{flag:'wx',mode:0o600});
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  if(process.argv.length!==3)throw Error('Explicit mode required');
  if(process.argv[2]==='--dummy'||process.argv[2]==='--dummy-110'){
   const scope=localCheckScope(process.argv[2]==='--dummy'?'107':'110');
   const result=await runDummyLocalCheck();
   if(!result.pass||!result.cleanup)throw Error('Dummy check failed');
   fs.writeFileSync(path.join(diagnostics,scope.dryFile),JSON.stringify(result),{flag:'wx',mode:0o600});
   console.log(JSON.stringify(result));
  }else if(process.argv[2]==='--real-once-107'||process.argv[2]==='--real-once-110'){
   console.log(JSON.stringify(await runRealOnce(process.argv[2]==='--real-once-107'?'107':'110')));
  }
  else throw Error('Invalid mode');
 }catch{console.error('Local credential check stopped safely. No retry is authorized.');process.exitCode=1;}
}
