import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Module, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

class Contents extends EventEmitter {
  mainFrame={parent:null as unknown,url:''}; sent:any[]=[];
  send(channel:string,payload:unknown){this.sent.push({channel,payload});}
  setWindowOpenHandler(fn:any){this.open=fn;} open:any;
}
const windows:Win[]=[];
let clampInitial=false, refuseContentBounds=false, contentInset=0;
class Win extends EventEmitter {
  webContents=new Contents(); visible=false; destroyed=false; bounds:any; resizable=false;
  options:any;
  explicitContentCalls:any[]=[];
  backgroundCalls:string[]=[]; ignoreCalls:boolean[]=[]; beforeLoadBackground:string[]=[];
  operations:string[]=[];
  constructor(options:any){super();this.options=options;this.bounds={...options};
    if(clampInitial)this.bounds={...displays[0].workArea};windows.push(this);}
  isVisible(){return this.visible;} isDestroyed(){return this.destroyed;}
  getBounds(){return this.bounds;}
  getContentBounds(){return contentInset ? {...this.bounds,x:this.bounds.x+contentInset,width:this.bounds.width-2*contentInset} : this.bounds;}
  setContentBounds(b:any){this.operations.push('content');this.explicitContentCalls.push({...b});if(!refuseContentBounds)this.bounds={...b};}
  setBackgroundColor(color:string){this.operations.push('background');this.backgroundCalls.push(color);}
  setIgnoreMouseEvents(ignore:boolean){this.ignoreCalls.push(ignore);}
  show(){this.visible=true;} hide(){this.visible=false;}
  destroy(){this.visible=false;this.destroyed=true;this.emit('closed');}
  setBounds(b:any){this.bounds=b;} setResizable(v:boolean){this.resizable=v;}
  setAlwaysOnTop(){} setBackgroundMaterial(){} setMenuBarVisibility(){}
  loadURL(url:string){this.operations.push('load');this.beforeLoadBackground=[...this.backgroundCalls];this.webContents.mainFrame.url=url;return Promise.resolve();}
}
let displays:any[]=[],allowed=true,requests:any[]=[],messages:any[]=[],held=false,restored=0,concealed=false;
let excluded=true,composition=async(_signal:AbortSignal)=>{},acquire:()=>Promise<any[]>;
const ipc=new EventEmitter();
const screen=Object.assign(new EventEmitter(),{
  getAllDisplays:()=>displays,
  getDisplayNearestPoint:()=>displays[0],getCursorScreenPoint:()=>({x:-150,y:50}),
  dipToScreenRect:(_w:any,r:any)=>({...r,width:Math.round(r.width*displays[0].scaleFactor),height:Math.round(r.height*displays[0].scaleFactor)}),
});
const isolated:any={setPermissionRequestHandler(fn:any){this.permission=fn;},setPermissionCheckHandler(fn:any){this.check=fn;},
  webRequest:{onHeadersReceived(fn:any){isolated.headers=fn;},onBeforeRequest(fn:any){isolated.network=fn;}}};
const electron={BrowserWindow:Win,ipcMain:ipc,screen,
  desktopCapturer:{getSources:async(options:any)=>{requests.push(options);return acquire();}},
  dialog:{showMessageBox:async(options:any)=>{messages.push(options);}},session:{fromPartition:()=>isolated}};
const require=createRequire(import.meta.url),originalLoad=(Module as any)._load;
let createScreenSelectionController:any,SELECTION_CSP:string;
try {
  (Module as any)._load=function(id:string,...args:any[]){return id==='electron'?electron:originalLoad.call(this,id,...args);};
  ({createScreenSelectionController,SELECTION_CSP}=require('../../dist/main/screenSelectionWindow.js'));
} finally {(Module as any)._load=originalLoad;}
const rect={x:20,y:30,width:40,height:20};
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
function image(width=250,height=150,patch:any={}):any {
  return {isEmpty:()=>false,getSize:()=>({width,height}),getScaleFactors:()=>[1],crop:(r:any)=>image(r.width,r.height),
    toPNG:()=>Buffer.from('synthetic-crop'),...patch};
}
function fixture(t:any,enabled=true){
  clampInitial=false;refuseContentBounds=false;contentInset=0;
  windows.length=0;requests=[];messages=[];allowed=true;held=false;restored=0;concealed=false;excluded=true;
  displays=[{id:7,bounds:{x:-200,y:50,width:200,height:120},workArea:{x:-200,y:50,width:200,height:110},scaleFactor:1.25}];
  composition=async()=>{};acquire=async()=>[{display_id:'7',thumbnail:image()}];
  const c=createScreenSelectionController({enabled,preloadPath:'C:\\fixture\\selection.js',canStart:()=>allowed,
    onActive:(v:boolean)=>{held=v;},compositionReady:(signal:AbortSignal)=>composition(signal),
    conceal:()=>{concealed=true;return{verify:()=>excluded,restore:()=>{restored++;concealed=false;}};}});
  t.after(()=>c.destroy());
  const win=()=>windows.at(-1)!;
  const event=()=>({sender:win().webContents,senderFrame:win().webContents.mainFrame});
  const notice=()=>win().webContents.sent.at(-1)?.payload;
  const emit=(name:string,...args:unknown[])=>{
    if(name==='ready' && !args.length)args=[{width:displays[0].bounds.width,height:displays[0].bounds.height,dpr:displays[0].scaleFactor}];
    return ipc.emit('selection:'+name,event(),...args);
  };
  const begin=()=>{c.start();win().emit('ready-to-show');emit('ready');return notice();};
  const select=()=>{const n=notice();emit('select',n.sessionId,n.displayId,rect);};
  const confirm=()=>{const n=notice();emit('confirm',n.sessionId,n.displayId);};
  return{c,win,event,notice,emit,begin,select,confirm};
}
test('production creates no window, listener or acquisition',t=>{const f=fixture(t,false);f.c.start();assert.equal(windows.length,0);assert.equal(requests.length,0);assert.equal(ipc.listenerCount('selection:confirm'),0);});
test('startup is idle and tray initiation/selection never capture',t=>{const f=fixture(t);assert.equal(f.c.active(),false);assert.equal(windows.length,0);f.begin();f.select();assert.equal(f.notice().phase,'AWAITING_CAPTURE_CONFIRMATION');assert.equal(requests.length,0);assert.equal(held,true);});
test('selector explicitly clears native background before load without fading or disabling mouse input',t=>{
  const f=fixture(t);f.begin();const w=f.win();
  assert.equal(w.options.frame,false);assert.equal(w.options.transparent,true);
  assert.equal(w.options.backgroundColor,'#00000000');assert.equal(w.options.resizable,false);
  assert.equal(w.options.webPreferences.devTools,false);
  assert.deepEqual(w.beforeLoadBackground,['#00000000']);assert.deepEqual(w.ignoreCalls,[]);
  assert.deepEqual(w.operations,['content','background','load']);
  assert.equal(w.options.opacity,undefined);assert.deepEqual(w.explicitContentCalls,[displays[0].bounds]);
  f.select();assert.equal(f.notice().phase,'AWAITING_CAPTURE_CONFIRMATION');assert.equal(requests.length,0);
  const id=f.notice().sessionId;f.emit('cancel',id);
  assert.equal(w.destroyed,true);assert.equal(held,false);assert.equal(requests.length,0);
});

for(const [name,workArea] of [
  ['bottom taskbar',{x:0,y:0,width:1536,height:976}],
  ['top taskbar',{x:0,y:48,width:1536,height:976}],
  ['left taskbar',{x:48,y:0,width:1488,height:1024}],
  ['right taskbar',{x:0,y:0,width:1488,height:1024}],
] as const) test(`explicit content bounds repair constructor workArea clamp: ${name}`,t=>{
  const f=fixture(t);clampInitial=true;
  displays[0]={id:7,bounds:{x:0,y:0,width:1536,height:1024},workArea,scaleFactor:1};
  f.begin();assert.deepEqual(f.win().explicitContentCalls,[displays[0].bounds]);
  assert.deepEqual(f.win().getContentBounds(),displays[0].bounds);assert.equal(f.win().visible,true);
  assert.equal(f.c.active(),true);assert.equal(requests.length,0);
  f.c.cancel();assert.equal(f.win().destroyed,true);assert.equal(held,false);
});
test('the observed 48-DIP clamp still fails closed if Windows refuses explicit placement',t=>{
  const f=fixture(t);clampInitial=true;refuseContentBounds=true;
  displays[0]={id:7,bounds:{x:0,y:0,width:1536,height:1024},workArea:{x:0,y:0,width:1536,height:976},scaleFactor:1};
  f.c.start();f.win().emit('ready-to-show');assert.equal(f.c.active(),false);assert.equal(f.win().destroyed,true);
  assert.equal(requests.length,0);assert.equal(held,false);assert.match(messages.at(-1).message,/Selection surface did not match/);
});
test('outer bounds matching cannot authorize a content frame-inset mismatch',t=>{
  const f=fixture(t);contentInset=8;f.c.start();assert.equal(f.win().getBounds().width,200);
  f.win().emit('ready-to-show');assert.equal(f.c.active(),false);assert.equal(requests.length,0);
});
for(const patch of [{width:199,height:120,dpr:1.25},{width:200,height:119,dpr:1.25},
  {width:200,height:120,dpr:1},{width:200,height:120,dpr:NaN}])
  test(`renderer viewport mismatch rejects readiness ${JSON.stringify(patch)}`,t=>{
    const f=fixture(t);f.c.start();f.win().emit('ready-to-show');f.emit('ready',patch);
    assert.equal(f.c.active(),false);assert.equal(f.win().destroyed,true);assert.equal(requests.length,0);
  });
test('one session/window only, repeat tray calls are harmless',t=>{const f=fixture(t);f.begin();f.c.start();f.c.start();assert.equal(windows.length,1);});
test('invalid or tiny selection cannot become confirmed',t=>{const f=fixture(t);const n=f.begin();for(const r of [{...rect,width:1},{...rect,x:-1},{...rect,x:199}]) f.emit('select',n.sessionId,n.displayId,r);assert.equal(f.notice().phase,'SELECTING');f.confirm();assert.equal(requests.length,0);});
test('capture is impossible without a selected and confirmed rectangle',t=>{const f=fixture(t);f.begin();f.confirm();assert.equal(requests.length,0);});
test('cancel before confirmation releases window and movement with no capture',t=>{const f=fixture(t);const n=f.begin();f.select();f.emit('cancel',n.sessionId);assert.equal(f.win().destroyed,true);assert.equal(held,false);assert.equal(requests.length,0);});
test('Escape cancels selection without acquisition',t=>{const f=fixture(t);f.begin();let prevented=false;f.win().webContents.emit('before-input-event',{preventDefault(){prevented=true;}},{type:'keyDown',key:'Escape'});assert.equal(prevented,true);assert.equal(f.c.active(),false);assert.equal(requests.length,0);});
test('owned top frame and exact URL required, rejecting robot/foreign frames',async t=>{const f=fixture(t);const n=f.begin();f.select();for(const event of [{sender:{},senderFrame:f.event().senderFrame},{...f.event(),senderFrame:{parent:null,url:'http://127.0.0.1:5173/screen-selection.html'}},{...f.event(),senderFrame:{parent:{},url:'http://127.0.0.1:5173/'}}]) ipc.emit('selection:confirm',event,n.sessionId,n.displayId);await settle();assert.equal(requests.length,0);});
test('stale session, wrong display and extra arguments cannot capture',async t=>{const f=fixture(t);const n=f.begin();f.select();f.emit('confirm','old',n.displayId);f.emit('confirm',n.sessionId,8);f.emit('confirm',n.sessionId,n.displayId,'extra');await settle();assert.equal(requests.length,0);});
test('confirmed capture hides UI, awaits composition, then delivers only crop bytes',async t=>{
  const f=fixture(t);f.begin();f.select();let release!:()=>void;
  composition=()=>new Promise<void>(r=>release=r);
  const crops:any[]=[];acquire=async()=>[{display_id:'7',thumbnail:image(250,150,{crop:(r:any)=>{crops.push(r);return image(r.width,r.height);}})}];
  f.confirm();assert.equal(concealed,true);assert.equal(f.win().visible,false);assert.equal(requests.length,0);
  release();await settle();assert.equal(requests.length,1);assert.deepEqual(requests[0],{types:['screen'],thumbnailSize:{width:250,height:150},fetchWindowIcons:false});
  assert.deepEqual(crops,[{x:25,y:37,width:50,height:26}]);assert.equal(f.notice().phase,'PREVIEWING');
  assert.equal(f.notice().image.width,50);assert.equal(f.notice().image.height,26);assert.equal(restored,1);assert.equal(held,false);assert.equal(f.win().visible,true);
});
test('duplicate confirms acquire once',async t=>{const f=fixture(t);f.begin();f.select();f.confirm();f.confirm();await settle();assert.equal(requests.length,1);});
test('failed composition readiness never acquires screen',async t=>{const f=fixture(t);composition=async()=>{throw Error('fixture');};f.begin();f.select();f.confirm();await settle();assert.equal(requests.length,0);assert.equal(f.c.active(),false);assert.equal(restored,1);});
test('visible companion or unknown window fails exclusion before capture',async t=>{const f=fixture(t);excluded=false;f.begin();f.select();f.confirm();await settle();assert.equal(requests.length,0);assert.equal(restored,1);});
test('display loss during selection cancels resources',t=>{const f=fixture(t);f.begin();displays=[];screen.emit('display-removed');assert.equal(f.c.active(),false);assert.equal(f.win().destroyed,true);assert.equal(requests.length,0);});
test('multiple monitors rejected without thumbnail acquisition',t=>{const f=fixture(t);displays.push({...displays[0],id:8});f.c.start();assert.equal(windows.length,0);assert.equal(requests.length,0);});
test('a shifted or resized selection surface cannot capture',async t=>{const f=fixture(t);f.begin();f.select();f.win().bounds={...f.win().bounds,x:0};f.confirm();await settle();assert.equal(requests.length,0);assert.equal(f.c.active(),false);});
test('session deadline disposes a forgotten selector without acquisition',t=>{const f=fixture(t);t.mock.timers.enable({apis:['setTimeout']});f.begin();t.mock.timers.tick(120001);assert.equal(f.c.active(),false);assert.equal(f.win().destroyed,true);assert.equal(requests.length,0);});
test('capture timeout drops late image and restores all resources',async t=>{const f=fixture(t);t.mock.timers.enable({apis:['setTimeout']});let resolve!:(v:any)=>void;acquire=()=>new Promise(r=>resolve=r);f.begin();f.select();f.confirm();await settle();t.mock.timers.tick(12001);assert.equal(f.c.active(),false);assert.equal(restored,1);resolve([{display_id:'7',thumbnail:image()}]);await settle();assert.equal(f.win().webContents.sent.some(n=>n.payload.image),false);});
test('source/display mismatch never sends any image',async t=>{const f=fixture(t);acquire=async()=>[{display_id:'8',thumbnail:image()}];f.begin();f.select();f.confirm();await settle();assert.equal(f.c.active(),false);assert.equal(f.win().webContents.sent.some(n=>n.payload.image),false);});
test('resolution or DPI changes after selection invalidate confirmation',async t=>{const f=fixture(t);f.begin();f.select();displays[0]={...displays[0],scaleFactor:1.5};f.confirm();await settle();assert.equal(requests.length,0);assert.equal(f.c.active(),false);});
for(const [label,thumbnail] of [['empty',()=>image(250,150,{isEmpty:()=>true})],['wrong size',()=>image(150,90)],['wrong density',()=>image(250,150,{getScaleFactors:()=>[2]})],['wrong crop size',()=>image(250,150,{crop:()=>image(10,10)})],['empty payload',()=>image(250,150,{crop:(r:any)=>image(r.width,r.height,{toPNG:()=>Buffer.alloc(0)})})],['oversized payload',()=>image(250,150,{crop:(r:any)=>image(r.width,r.height,{toPNG:()=>({byteLength:17*1024*1024})})})]] as const)
  test(`${label} capture fails closed and restores UI`,async t=>{const f=fixture(t);acquire=async()=>[{display_id:'7',thumbnail:thumbnail()}];f.begin();f.select();f.confirm();await settle();assert.equal(f.c.active(),false);assert.equal(restored,1);assert.equal(f.win().webContents.sent.some(n=>n.payload.image),false);});
test('cancellation during acquisition drops late pixels and prevents overlapping capture',async t=>{
  const f=fixture(t);let resolve!:(v:any)=>void;acquire=()=>new Promise(r=>resolve=r);
  f.begin();f.select();f.confirm();await settle();const old=f.win();f.c.cancel();f.c.start();assert.equal(windows.length,1);
  resolve([{display_id:'7',thumbnail:image()}]);await settle();assert.equal(old.webContents.sent.some(n=>n.payload.image),false);
  f.begin();assert.equal(windows.length,2);assert.equal(restored,1);
});
test('cancel during compositor wait aborts helper and cannot later capture',async t=>{const f=fixture(t);let signal!:AbortSignal,release!:()=>void;composition=(s)=>{signal=s;return new Promise<void>(r=>release=r);};f.begin();f.select();f.confirm();f.c.cancel();assert.equal(signal.aborted,true);release();await settle();assert.equal(requests.length,0);});
test('new session never accepts stale old-session input',t=>{const f=fixture(t);const old=f.begin();f.c.cancel();f.begin();f.emit('select',old.sessionId,old.displayId,rect);assert.equal(f.notice().phase,'SELECTING');});
test('preview close destroys temporary window and next selection works',async t=>{const f=fixture(t);f.begin();f.select();f.confirm();await settle();const w=f.win();w.destroy();assert.equal(f.c.active(),false);f.begin();assert.equal(windows.length,2);assert.equal(requests.length,1);});
test('Quit destroys selector and removes every feature listener',t=>{const f=fixture(t);f.begin();f.c.destroy();assert.equal(f.win().destroyed,true);assert.equal(held,false);assert.equal(ipc.listenerCount('selection:confirm'),0);assert.equal(screen.listenerCount('display-added'),0);});
test('active movement or chat/voice work refuses initiation',t=>{const f=fixture(t);allowed=false;f.c.start();assert.equal(windows.length,0);assert.equal(requests.length,0);});
test('permissions denied; preview-only CSP and network boundary are restrictive',t=>{
  const f=fixture(t);f.begin();assert.equal(f.win().options.webPreferences.sandbox,true);assert.equal(f.win().options.webPreferences.nodeIntegration,false);
  assert.equal(f.win().options.webPreferences.contextIsolation,true);assert.equal(f.win().options.webPreferences.webSecurity,true);
  assert.equal(isolated.check(),false);let granted=true;isolated.permission(null,'media',(v:boolean)=>granted=v);assert.equal(granted,false);
  let result:any;isolated.network({url:'https://example.com/upload'},(v:any)=>result=v);assert.equal(result.cancel,true);
  assert.match(SELECTION_CSP,/img-src blob:/);assert.match(SELECTION_CSP,/connect-src 'none'/);
  assert.equal(f.win().webContents.open().action,'deny');
});
test('no persistent, clipboard, microphone, provider or screen-stream capabilities in feature',()=>{
  const source=readFileSync(new URL('./screenSelectionWindow.ts',import.meta.url),'utf8');
  for(const forbidden of ['writeFile','clipboard','getDisplayMedia','getUserMedia','QwenProvider','qwenProvider','safeStorage','persist:screen'])assert.equal(source.includes(forbidden),false,forbidden);
  const policy=readFileSync(new URL('../shared/csp.ts',import.meta.url),'utf8');assert.equal(policy.includes('blob:'),false);
});
