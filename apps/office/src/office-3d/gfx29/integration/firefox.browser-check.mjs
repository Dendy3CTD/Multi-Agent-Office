// Real Firefox ESR + WebDriver BiDi, using only installed browser / Node / Vite.
// Protocol: https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import assert from 'node:assert/strict';
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const directory = resolve(appRoot, 'src/office-3d/gfx29/integration/screenshots');
const profile = await mkdtemp(resolve(tmpdir(), 'mao-firefox-'));
const server = await createServer({root:appRoot,configFile:false,cacheDir:resolve(profile,'vite-cache'),plugins:[react()],server:{host:'127.0.0.1',port:0}});
let browser, ws;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = spawn('firefox',['--headless','--no-remote','--profile',profile,'--remote-debugging-port','0','about:blank'],{stdio:['ignore','pipe','pipe']});
  const endpoint = await new Promise((accept,reject)=>{
    let output='';const timer=setTimeout(()=>reject(Error('Firefox BiDi startup timed out')),20000);
    const collect=data=>{output+=data;const match=output.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);accept(match[1]+'/session');}};
    browser.stderr.on('data',collect);browser.stdout.on('data',collect);browser.on('error',reject);
  });
  ws = new WebSocket(endpoint);await new Promise((accept,reject)=>{ws.onopen=accept;ws.onerror=reject;});
  let serial=0;const pending=new Map();
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(!m.id)return;const p=pending.get(m.id);pending.delete(m.id);m.type==='error'?p.reject(Error(m.error+': '+m.message)):p.accept(m.result);};
  const command=(method,params={})=>new Promise((accept,reject)=>{const id=++serial;pending.set(id,{accept,reject});ws.send(JSON.stringify({id,method,params}));});
  await command('session.new',{capabilities:{}});
  const {context}=await command('browsingContext.create',{type:'tab'});
  await command('browsingContext.setViewport',{context,viewport:{width:1366,height:768}});
  await command('browsingContext.navigate',{context,url:origin+'?debug=1',wait:'complete'});
  const evaluate=async expression=>{
    const result=await command('script.evaluate',{expression:`(async()=>JSON.stringify(await (${expression})))()`,target:{context},awaitPromise:true});
    if(result.type==='exception')throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value===undefined?undefined:JSON.parse(result.result.value);
  };
  const waitFor=async expression=>{for(let i=0;i<500;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Firefox timeout: '+expression);};
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready" || document.querySelector(".mao-scene-status")?.dataset.sceneStatus==="error"');
  const status=await evaluate('({...document.querySelector(".office-scene-3d-mount")?.dataset})');
  await mkdir(directory,{recursive:true});
  if(status.sceneStatus!=='ready'){
    await writeFile(resolve(directory,'firefox-result.json'),JSON.stringify({status:'ENVIRONMENT_BLOCKED',scene:status,browser:'Firefox ESR headless'},null,2)+'\n');
    throw Error('Firefox WebGL not ready: '+JSON.stringify(status));
  }
  const fixture=ts.transpileModule(await readFile(resolve(appRoot,'src/office-3d/scene.browser-fixture.tsx'),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText;
  const point=fixture.slice(fixture.indexOf('function point(kind)'),fixture.indexOf('Object.assign(window'));
  await evaluate(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js');window.inspect=()=>{let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return s;};${point};window.firefoxPoint=point;return true;})()`);
  const zoom=await evaluate('inspect().camera.zoom');
  await command('input.performActions',{context,actions:[{type:'wheel',id:'wheel',actions:[{type:'scroll',x:600,y:420,deltaX:0,deltaY:80,duration:100,origin:'viewport'}]}]});
  await waitFor(`inspect().camera.zoom!==${zoom}`);
  await evaluate(`(()=>{window.dispatchEvent(new Event('mao-3d-fit'));return true;})()`);await waitFor('inspect().camera.zoom===1');
  const click=async point=>command('input.performActions',{context,actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',x:Math.round(point.x),y:Math.round(point.y),origin:'viewport'},{type:'pointerDown',button:0},{type:'pointerUp',button:0}]}]});
  await click(await evaluate('firefoxPoint("doors")'));await waitFor('!!document.querySelector("#mao-floor-menu")');
  await waitFor('Math.abs(inspect().visibleDoors[0].object.position.x-inspect().visibleDoors[0].baseX)>.9');
  await evaluate(`(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return true;})()`);
  await click(await evaluate('firefoxPoint("employee")'));await waitFor('!!document.querySelector(".mao-employee-panel")');
  assert.equal(await evaluate('document.querySelectorAll("canvas.office-scene-3d-canvas").length'),1);
  await evaluate(`(()=>{document.querySelector('.mao-employee-panel button[aria-label="Закрыть профиль"]').click();return true;})()`);
  const screenshot=await command('browsingContext.captureScreenshot',{context,origin:'viewport',format:{type:'image/png'}});
  await writeFile(resolve(directory,'firefox-floor02-1366x768.png'),Buffer.from(screenshot.data,'base64'));
  const metrics=await evaluate('(()=>{const s=inspect();return {calls:s.renderer.info.render.calls,triangles:s.renderer.info.render.triangles,...s.renderer.info.memory,dpr:s.renderer.getPixelRatio()};})()');
  await writeFile(resolve(directory,'firefox-result.json'),JSON.stringify({status:'PASS',browser:'Firefox 140 ESR',wheel:true,fit:true,elevator:true,employee:true,metrics},null,2)+'\n');
  console.log('PASS Firefox actual main page, wheel, Fit, physical elevator/animation and employee profile',metrics);
} finally {ws?.close();browser?.kill();await server.close();}
