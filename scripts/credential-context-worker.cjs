// Offline, disposable credentials ONLY. No real userData/vault is read.
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=process.env.DESKTOP_COMPANION_CREDENTIAL_TEST_ROOT;
const phase=process.env.DESKTOP_COMPANION_CREDENTIAL_TEST_PHASE;
const temporary=fs.realpathSync(os.tmpdir()),project=path.resolve(__dirname,'..');
if(!root || path.dirname(fs.realpathSync(root))!==temporary || !path.basename(root).startsWith('desktop-companion-credential-dummy-') || !['write','same','wrong'].includes(phase))app.exit(1);
else {
 const a=path.join(root,'profile-a'),b=path.join(root,'profile-b'),profile=phase==='wrong'?b:a;
 let networkAttempts=0,privateReads=0;
 const deny=()=>{networkAttempts++;throw Error('Offline network forbidden');};
 globalThis.fetch=deny;if('WebSocket'in globalThis)globalThis.WebSocket=deny;
 for(const name of ['node:http','node:https'])for(const key of ['get','request'])require(name)[key]=deny;
 for(const key of ['connect','createConnection'])require('node:net')[key]=deny;
 require('node:net').Socket.prototype.connect=deny;require('node:tls').connect=deny;require('node:dgram').createSocket=deny;
 const originalRead=fs.readFileSync;
 fs.readFileSync=function(file,...args){
  if(typeof file==='string' && /(?:qwen-key\.bin|provider-settings\.json|Local State)$/i.test(file) && !path.resolve(file).startsWith(root+path.sep)){
   privateReads++;throw Error('Real credential/configuration access forbidden');
  }return originalRead.call(this,file,...args);
 };
 const initialNameMatches=app.getName()==='desktop-companion';
 const startupProfileIsolated=[app.getPath('userData'),app.getPath('sessionData')].every(value=>path.resolve(value).toLowerCase()===path.resolve(profile).toLowerCase());
 const {initializePilotCredentialContext,checkPilotCredentialContext,requirePilotCredentialContext,credentialFiles}=require(path.join(project,'dist/main/pilotCredentialContext.js'));
 const approved={appName:'desktop-companion',userData:profile,sessionData:profile};
 const earlyStatus=checkPilotCredentialContext(app,approved,'qwen');
 const setup=initializePilotCredentialContext(app,approved);
 if(setup!=='CONTEXT_MATCHED'){console.log(JSON.stringify({phase,setup,earlyStatus}));app.exit(1);}
 else app.whenReady().then(async()=>{
  try{
   const {createSafeCredentialStore}=require(path.join(project,'dist/main/safeCredentialStore.js'));
   const expectedA={appName:'desktop-companion',userData:a,sessionData:a};
   const contextStatus=checkPilotCredentialContext(app,expectedA,'qwen');
   let lookupGuardBlocked=false;
   try{requirePilotCredentialContext(app,expectedA,'qwen');}catch{lookupGuardBlocked=true;}
   if(phase!=='wrong'&&lookupGuardBlocked)throw Error('Expected dummy context rejected');
   const selected=credentialFiles(a).key;
   if(!path.resolve(selected).startsWith(root+path.sep))throw Error('Dummy namespace error');
   const dummy='TEST_ONLY_NOT_A_REAL_API_KEY';
   if(process.argv.some(value=>value.includes(dummy)))throw Error('Dummy value in process arguments');
   const store=createSafeCredentialStore(selected);await store.prepare();
   const result={phase,initialNameMatches,startupProfileIsolated,earlyStatus,setup,ready:app.isReady(),encryptionAvailable:store.available(),contextStatus,
    roundTrip:false,cipherNotPlaintext:false,cipherPreserved:false,loadStatus:null,networkAttempts:0,privateReads:0,argumentsSafe:true,lookupGuardBlocked};
   if(!store.available())throw Error('Disposable encryption unavailable');
   if(phase==='write'){
    if(await store.save(dummy)!=='saved')throw Error('Disposable encryption failed');
    result.roundTrip=await store.load()===dummy;
    result.cipherNotPlaintext=!fs.readFileSync(selected).includes(Buffer.from(dummy));
    result.cipherPreserved=fs.existsSync(selected);
   }else{
    // The wrong-profile phase deliberately exercises ONLY the known dummy blob
    // below the guard, to reproduce the former bootstrap bug. Never real data.
    const before=fs.readFileSync(selected);result.roundTrip=await store.load()===dummy;
    result.cipherNotPlaintext=!before.includes(Buffer.from(dummy));
    result.cipherPreserved=fs.existsSync(selected)&&fs.readFileSync(selected).equals(before);
   }
   result.loadStatus=store.diagnosticStatus();result.networkAttempts=networkAttempts;result.privateReads=privateReads;
   if(networkAttempts!==0||privateReads!==0)throw Error('Offline safety guard failed');
   console.log(JSON.stringify(result));app.quit();
  }catch{console.error('Disposable credential probe failed (sanitized).');app.exit(1);}
 }).catch(()=>{console.error('Disposable credential initialization failed.');app.exit(1);});
}
