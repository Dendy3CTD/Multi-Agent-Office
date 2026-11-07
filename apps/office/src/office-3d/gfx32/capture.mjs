/** Real main-page captures, character comparison, retry and repeated floor lifecycle checks. */
import { createServer, preview } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const profile = await mkdtemp(resolve(tmpdir(), 'mao-tower-check-'));
const production = process.argv.includes('--production');
const server = production ? await preview({root:appRoot,configFile:false,preview:{host:'127.0.0.1',port:0}}) : await createServer({
  root: appRoot, configFile: false, cacheDir: resolve(profile, 'vite-cache'),
  plugins: [{ name: 'real-scene-check',
    configureServer(server) {
      server.middlewares.use('/slow-manifest.json', async (_req,res) => {
        const manifest=await readFile(resolve(appRoot,'public/office-art/v1/manifest.json'),'utf8');
        setTimeout(()=>{ res.setHeader('Content-Type','application/json');res.end(manifest); },600);
      });
      server.middlewares.use('/broken-manifest.json', async (_req,res) => {
        const manifest=JSON.parse(await readFile(resolve(appRoot,'public/office-art/v1/manifest.json'),'utf8'));
        manifest.assets.forEach(asset=>{ if(asset.type==='model') asset.url='/missing.glb'; });
        res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(manifest));
      });
      server.middlewares.use('/__scene_check', async (_req, res, next) => {
        try {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/__scene_check', '<!doctype html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0d12;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/src/office-3d/scene.browser-fixture.tsx"></script></body></html>'));
        } catch (error) { next(error); }
      });
    },
  }, react()], server: { host: '127.0.0.1', port: 0 },
});
let browser;
let ws;
try {
  if (!production) await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = spawn('chromium', ['--headless', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const browserEndpoint = await new Promise((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chromium startup timeout')), 20000);
    browser.on('error', reject);
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); accept(match[1]); }
    });
  });
  ws = new WebSocket(browserEndpoint);
  await new Promise((accept, reject) => { ws.onopen = accept; ws.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  let onEvent;
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) { onEvent?.(message); return; }
    const { accept, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : accept(message.result);
  };
  function cdp(method, params = {}, sessionId) {
    const id = ++serial;
    return new Promise((accept, reject) => {
      pending.set(id, { accept, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => cdp(method, params, sessionId);
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 500; i++) {
      if (await evaluate(expression)) return;
      await new Promise(accept => setTimeout(accept, 100));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  await call('Page.enable');
  const directory=resolve(appRoot,'src/office-3d/gfx32/screenshots');await mkdir(directory,{recursive:true});
  const name=process.argv.find(a=>a.startsWith('--name='))?.slice(7)??'final';
  const mode=process.argv.includes('--characters')?'procedural':'glb';
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${origin}/?debug=1&gfx29Characters=${mode}&gfx32=${process.argv.includes("--prototypes")?"prototypes":process.argv.includes("--legacy")?"legacy":""}`});
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready" || document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="error"');
  const status=await evaluate('({...document.querySelector(".office-scene-3d-mount").dataset})');assert.equal(status.sceneStatus,'ready',JSON.stringify(status));
  await evaluate(`window.towerInspect=()=>{let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return s;}`);
  const image=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(directory,`${name}-1366.png`),Buffer.from(image.data,'base64'));
  const metrics=await evaluate(`(()=>{const s=towerInspect();s.scene.updateMatrixWorld(true);const size=o=>{const b=new s.camera.position.constructor();const box=o.geometry?.boundingBox;return null;};let lights=0;s.scene.traverse(o=>{if(o.isLight)lights++;});return {calls:s.renderer.info.render.calls,triangles:s.renderer.info.render.triangles,...s.renderer.info.memory,dpr:s.renderer.getPixelRatio(),lights,diagnostics:{valid:s.architecture.diagnostics.valid,issues:s.architecture.diagnostics.issues},assets:s.architecture.assetBounds.map(a=>({key:a.key,size:a.size})),mode:s.characterMode};})()`);
  const dimensions=await evaluate(`(async()=>{const T=await import('/node_modules/three/build/three.module.js');const s=towerInspect();return s.artRoot.children.filter(o=>o.userData.officeAssetId||o.userData.employeeId).map(o=>({id:o.userData.officeAssetId,employee:o.userData.employeeId,desk:o.userData.deskId,position:o.position.toArray(),size:new T.Box3().setFromObject(o).getSize(new T.Vector3()).toArray()}));})()`);metrics.dimensions=dimensions;
  await writeFile(resolve(directory,`${name}-metrics.json`),JSON.stringify(metrics,null,2)+'\n');console.log(name,metrics.calls,metrics.triangles,metrics.geometries,metrics.textures,'issues',metrics.diagnostics.issues.length);
  if(process.argv.includes('--full')){
    await call('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
    await evaluate(`window.dispatchEvent(new Event('mao-3d-fit'));new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(directory,`${name}-1920.png`),Buffer.from(shot.data,'base64'));
    for(const [view,target,zoom]of [['prototype-1',[-4.8,1.2,-.53],10],['prototype-2',[-2.6,1.2,-.53],10],['prototype-3',[-.4,1.2,-.53],10],['elevator',[-10.7,1.7,3],3],['employees',[-.5,1.2,1.5],3],['windows',[0,2.9,6.7],2]]){
      await evaluate(`(()=>{const s=towerInspect();s.camera.position.set(${target[0]+19},${target[1]+16},${target[2]-23});s.camera.lookAt(${target.join(',')});s.camera.zoom=${zoom};s.camera.updateProjectionMatrix();s.renderer.render(s.scene,s.camera);})()`);
      const crop=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(directory,`${name}-${view}.png`),Buffer.from(crop.data,'base64'));
    }
  }
}finally{ws?.close();browser?.kill();await server.close();}
