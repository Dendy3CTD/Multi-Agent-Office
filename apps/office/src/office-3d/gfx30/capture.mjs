import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const [file='baseline.png',w='1366',h='768']=process.argv.slice(2);
const profile=await mkdtemp(join(tmpdir(),'gfx30-capture-'));
const browser=spawn('chromium',['--headless','--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-dev-shm-usage','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let ws;try {
 const endpoint=await new Promise((resolve,reject)=>{let s='';const timeout=setTimeout(()=>reject(Error('browser timeout')),20000);browser.stderr.on('data',b=>{s+=b;const m=s.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});browser.on('error',reject);});
 ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});let seq=0;const pending=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(!m.id)return;const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});const c=(method,params)=>call(method,params,sessionId);
 await c('Page.enable');await c('Emulation.setDeviceMetricsOverride',{width:+w,height:+h,deviceScaleFactor:1,mobile:false});await c('Page.navigate',{url:'http://127.0.0.1:31878/?debug=1'});
 let ready=false;for(let i=0;i<500;i++){const r=await c('Runtime.evaluate',{expression:'document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus',returnByValue:true});if(r.result.value==='error')throw Error('scene error');if(r.result.value==='ready'){ready=true;break;}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('scene ready timeout');
 await new Promise(r=>setTimeout(r,1200));const shot=await c('Page.captureScreenshot',{format:'png'});await writeFile(file,Buffer.from(shot.data,'base64'));console.log('saved',file);
}finally{ws?.close();browser.kill();}
