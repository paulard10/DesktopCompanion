// Fixed, windowless diagnostic. Real mode is invoked only by Prompt 107's locked supervisor.
const {app}=require('electron'),electron=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const project=path.resolve(__dirname,'..'),root=process.env.DESKTOP_COMPANION_LOCAL_CHECK_ROOT;
const mode=process.env.DESKTOP_COMPANION_LOCAL_CHECK_MODE;
const temporary=fs.realpathSync(os.tmpdir());
let emitted=false;
const outcomes=new Set(['AVAILABLE_LOCALLY','CREDENTIAL_ENTRY_MISSING','CREDENTIAL_DECRYPTION_FAILED','SECURE_STORAGE_UNAVAILABLE',
 'CREDENTIAL_NAMESPACE_MISMATCH','APP_CONTEXT_INVALID','PROVIDER_CONFIGURATION_INCOMPLETE','CREDENTIAL_READ_ERROR','UNVERIFIED_SAFE_STOP']);
function emit(result){
 if(emitted)return;emitted=true;
 const value={outcome:outcomes.has(result.outcome)?result.outcome:'UNVERIFIED_SAFE_STOP',retrievalAttempted:typeof result.retrievalAttempted==='boolean'?result.retrievalAttempted:null,
  contextMatched:result.contextMatched===true,encryptionReady:result.encryptionReady===true,guardReady:result.guardReady===true,
  networkAttempts:result.networkAttempts??0,sessionRequestsBlocked:result.sessionRequestsBlocked??0,guardSelfTests:result.guardSelfTests??0};
 fs.writeSync(1,JSON.stringify(value)+'\n');app.quit();
}
// Raw errors and arbitrary logs must never become a diagnostic output channel.
console.log=console.warn=console.error=()=>{};
process.on('uncaughtException',()=>emit({outcome:'UNVERIFIED_SAFE_STOP'}));
process.on('unhandledRejection',()=>emit({outcome:'UNVERIFIED_SAFE_STOP'}));
if(!root||!['prepare-dummy','dummy','wrong-dummy','real107'].includes(mode)||path.dirname(fs.realpathSync(root))!==temporary||
 !path.basename(root).startsWith('desktop-companion-local-check-'))app.exit(2);
else {
 for(const flag of ['disable-background-networking','disable-component-update','disable-domain-reliability','disable-sync','no-pings','disable-crash-reporter'])app.commandLine.appendSwitch(flag);
 const guards=require('./local-credential-guards.cjs').installLocalOnlyGuards(electron);
 const expectedProfile=mode==='real107'?path.join(app.getPath('appData'),'desktop-companion'):path.join(root,'profile-a');
 const expected={appName:'desktop-companion',userData:expectedProfile,sessionData:expectedProfile};
 const {checkPilotCredentialContext,credentialFiles}=require(path.join(project,'dist/main/pilotCredentialContext.js'));
 const files=credentialFiles(expectedProfile);
 // No setName/setPath: package startup must naturally match the ordinary dev identity.
 if(mode==='real107'&&!fs.existsSync(path.join(project,'.local-vision-diagnostics/credential107-real-check.consumed')))app.exit(2);
 else app.whenReady().then(async()=>{
  let contextMatched=false,encryptionReady=false,retrievalAttempted=false;
  const finish=outcome=>emit({outcome,retrievalAttempted,contextMatched,encryptionReady,...guards.status()});
  if(process.platform!=='win32'||app.isPackaged||!guards.status().guardReady)return finish('UNVERIFIED_SAFE_STOP');
  const status=checkPilotCredentialContext(app,expected,'qwen');
  if(status!=='CONTEXT_MATCHED')return finish(status==='CREDENTIAL_NAMESPACE_MISMATCH'?status:'APP_CONTEXT_INVALID');
  contextMatched=true;
  const {createSafeCredentialStore,checkSafeCredentialReadOnly}=require(path.join(project,'dist/main/safeCredentialStore.js'));
  if(mode==='prepare-dummy'){
   const store=createSafeCredentialStore(files.key);await store.prepare();encryptionReady=store.available();
   if(!encryptionReady||await store.save('TEST_ONLY_NOT_A_REAL_API_KEY')!=='saved')return finish('UNVERIFIED_SAFE_STOP');
   fs.writeFileSync(files.settings,JSON.stringify({provider:'qwen',endpoint:'https://offline-test.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'}));
   return finish('AVAILABLE_LOCALLY'); // Preparation only; actual readonly recovery follows in another child.
  }
  // Fail closed if a selected existing protected file can be opened for writing.
  for(const file of [path.join(expectedProfile,'Local State'),files.settings,files.key]){
   if(!fs.existsSync(file)){if(file.endsWith('Local State'))return finish('UNVERIFIED_SAFE_STOP');continue;}
   let writable=false,fd;try{fd=fs.openSync(file,'r+');writable=true;}catch(error){if(error.code!=='EACCES'&&error.code!=='EPERM'&&error.code!=='EBUSY')return finish('UNVERIFIED_SAFE_STOP');}finally{if(fd!==undefined)fs.closeSync(fd);}
   if(writable)return finish('UNVERIFIED_SAFE_STOP');
  }
  encryptionReady=await electron.safeStorage.isAsyncEncryptionAvailable();
  if(!encryptionReady)return finish('SECURE_STORAGE_UNAVAILABLE');
  if(!guards.status().guardReady)return finish('UNVERIFIED_SAFE_STOP');
  if(mode==='real107'){
   // A second child cannot retrieve again even if the supervisor is accidentally rerun.
   const claim=fs.openSync(path.join(project,'.local-vision-diagnostics/credential107-real-child.consumed'),'wx',0o600);fs.closeSync(claim);
  }
  const {createLocalCredentialCheck}=require(path.join(project,'dist/main/localCredentialCheck.js'));
  const check=createLocalCredentialCheck({app,expected,readOnlyAvailability:async file=>{
   retrievalAttempted=true;return checkSafeCredentialReadOnly(file);
  }});
  const result=await check();retrievalAttempted=result.retrievalAttempted;
  finish(guards.status().guardReady?result.outcome:'UNVERIFIED_SAFE_STOP');
 }).catch(()=>emit({outcome:'UNVERIFIED_SAFE_STOP'}));
}
