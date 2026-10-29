// Used only by the windowless local diagnostic, before any credential operation.
exports.installLocalOnlyGuards = function(electron) {
 let attempts=0, sessions=0, sessionsBlocked=0, failed=false;
 const deny=()=>{attempts++;throw Error('LOCAL_ONLY_NETWORK_DENIED');};
 const replace=(object,key)=>{Object.defineProperty(object,key,{value:deny,writable:false,configurable:false});if(object[key]!==deny)throw Error('Guard unavailable');};
 replace(globalThis,'fetch');replace(globalThis,'WebSocket');
 for(const module of ['node:http','node:https'])for(const key of ['request','get'])replace(require(module),key);
 for(const key of ['connect','createConnection'])replace(require('node:net'),key);
 replace(require('node:net').Socket.prototype,'connect');replace(require('node:tls'),'connect');
 replace(require('node:http2'),'connect');replace(require('node:dgram'),'createSocket');
 const dns=require('node:dns');
 for(const key of Object.keys(dns))if(/^(lookup|resolve|reverse)/.test(key)&&typeof dns[key]==='function')replace(dns,key);
 for(const key of Object.keys(dns.promises))if(/^(lookup|resolve|reverse)/.test(key)&&typeof dns.promises[key]==='function')replace(dns.promises,key);
 for(const key of ['fetch','request','resolveHost'])replace(electron.net,key);
 replace(electron.crashReporter,'start');replace(require('node:inspector'),'open');replace(process.report,'writeReport');
 electron.app.on('session-created',session=>{
  sessions++;
  try {
   session.webRequest.onBeforeRequest({urls:['<all_urls>']},(_details,callback)=>{sessionsBlocked++;callback({cancel:true});});
   session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
   session.setPermissionCheckHandler(()=>false);
  } catch {failed=true;}
 });
 electron.app.on('web-contents-created',()=>{failed=true;electron.app.exit(2);});
 // These invoke the replacement functions only, not sockets, DNS or a provider.
 const probes=[()=>fetch('https://invalid.invalid'),()=>require('node:https').request('https://invalid.invalid'),
  ()=>require('node:net').connect(443,'invalid.invalid'),()=>dns.lookup('invalid.invalid'),
  ()=>electron.net.fetch('https://invalid.invalid'),()=>electron.net.request('https://invalid.invalid'),
  ()=>electron.net.resolveHost('invalid.invalid')];
 for(const probe of probes){let blocked=false;try{probe();}catch{blocked=true;}if(!blocked)throw Error('Guard self-test failed');}
 const selfTests=attempts;attempts=0;
 return {status:()=>({networkAttempts:attempts,sessionRequestsBlocked:sessionsBlocked,guardSelfTests:selfTests,guardReady:!failed&&attempts===0&&sessionsBlocked===0,sessions})};
};
