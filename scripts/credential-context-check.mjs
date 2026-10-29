/** Launch only owned TEMP profiles with a fixed synthetic key, never app/vault data. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn}from'node:child_process';import{fileURLToPath,pathToFileURL}from'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DUMMY='TEST_ONLY_NOT_A_REAL_API_KEY';
export async function checkDisposableCredentialContexts(){
 const base=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(base,'desktop-companion-credential-dummy-'));
 const worker=path.join(project,'scripts/credential-context-worker.cjs'),normal=path.join(directory,'normal-package');
 for(const p of [normal,path.join(directory,'profile-a'),path.join(directory,'profile-b')])fs.mkdirSync(p);
 fs.writeFileSync(path.join(normal,'package.json'),JSON.stringify({name:'desktop-companion',version:'0.0.0',main:worker}));
 const results=[];
 async function run(phase,entry,profile){
  const env={DESKTOP_COMPANION_CREDENTIAL_TEST_ROOT:directory,DESKTOP_COMPANION_CREDENTIAL_TEST_PHASE:phase};
  for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
  if(Object.values(env).some(value=>value.includes(DUMMY)))throw Error('Dummy value in child environment');
  return new Promise((resolve,reject)=>{
   let out='',errorBytes=0,closed=false;
   const child=spawn(path.join(project,'node_modules/electron/dist/electron.exe'),[entry,'--user-data-dir='+profile],
    {cwd:project,env,shell:false,windowsHide:true,detached:false,stdio:['ignore','pipe','pipe']});
   const deadline=setTimeout(()=>{child.kill();},20000);
   child.stdout.on('data',b=>{if(Buffer.byteLength(out)+b.length<=8192)out+=b.toString();else child.kill();});
   child.stderr.on('data',b=>{errorBytes+=b.length;if(b.toString().includes(DUMMY))child.kill();});
   child.once('error',()=>{clearTimeout(deadline);reject(Error('Disposable process launch failed.'));});
   child.once('close',code=>{closed=true;clearTimeout(deadline);if(code!==0||out.includes(DUMMY))return reject(Error('Disposable process failed; no private output retained.'));
    try{const value=JSON.parse(out.trim());resolve({...value,childClosed:closed,exitCode:code,stderrBytes:errorBytes});}catch{reject(Error('Disposable output invalid.'));}});
  });
 }
 let cleanup=false;
 try{
  results.push(await run('write',normal,path.join(directory,'profile-a')));
  results.push(await run('same',worker,path.join(directory,'profile-a')));
  results.push(await run('wrong',worker,path.join(directory,'profile-b')));
  results.push(await run('same',worker,path.join(directory,'profile-a')));
 }finally{
  const resolved=fs.realpathSync(directory);
  if(path.dirname(resolved)!==base||!path.basename(resolved).startsWith('desktop-companion-credential-dummy-'))throw Error('Refuse unsafe temporary cleanup.');
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});cleanup=!fs.existsSync(resolved);
 }
 return {mode:'DUMMY_OFFLINE_ONLY',results,cleanup,realProviderRequests:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await checkDisposableCredentialContexts()));}catch{console.error('Dummy credential context check failed; no real key was inspected.');process.exitCode=1;}
}
