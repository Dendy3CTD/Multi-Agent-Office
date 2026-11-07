/** Real main-page captures, character comparison, retry and repeated floor lifecycle checks. */
import { createServer, preview } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
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
  const directory=resolve(appRoot,'src/office-3d/gfx29/integration/screenshots');await mkdir(directory,{recursive:true});
  if (production) {
    await call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:origin+'/'});
    await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready" || document.querySelector(".mao-scene-status")?.dataset.sceneStatus==="error"');
    const result=await evaluate('({...document.querySelector(".office-scene-3d-mount").dataset})');
    assert.equal(result.sceneStatus,'ready');assert.equal(result.architecture,'premium-v29');assert.equal(result.characterMode,'glb');
    assert.equal(await evaluate('document.querySelectorAll("canvas.office-scene-3d-canvas").length'),1);
    const shot=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve(directory,'production-floor02-1366x768.png'),Buffer.from(shot.data,'base64'));
    await writeFile(resolve(directory,'production-result.json'),JSON.stringify({status:'PASS',...result},null,2)+'\n');
    console.log('PASS built production main page',result);
  } else {
  const label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)??'final';
  const results=[];
  for(const mode of ['glb','procedural']){
    await call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:`${origin}/?debug=1&gfx29Characters=${mode}`});
    await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready" || document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="error"');
    const status=await evaluate('({...document.querySelector(".office-scene-3d-mount").dataset})');if(status.sceneStatus!=='ready')throw Error(JSON.stringify(status));
    await evaluate(`window.towerInspect=()=>{let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return s;}`);
    for(const [width,height] of mode==='glb'?[[1366,768],[1920,1080]]:[[1920,1080]]){
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await evaluate(`window.dispatchEvent(new Event('mao-3d-fit'));new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
      const image=await call('Page.captureScreenshot',{format:'png'});
      await writeFile(resolve(directory,`${label}-${mode}-${width}x${height}.png`),Buffer.from(image.data,'base64'));
    }
    const metrics=await evaluate('(()=>{const s=towerInspect();return {characterMode:s.characterMode,calls:s.renderer.info.render.calls,triangles:s.renderer.info.render.triangles,...s.renderer.info.memory,dpr:s.renderer.getPixelRatio(),floorY:s.architecture.assetBounds.find(a=>a.key==="meeting-rug").supportY,diagnostics:s.architecture.diagnostics};})()');
    const invariants=await evaluate(`(()=>{const s=towerInspect();let lights=0,shadow=0;s.scene.traverse(n=>{if(n.isLight){lights++;if(n.castShadow)shadow++;}});return {floor:s.artRoot.children.filter(o=>o.userData.officeAssetId==='floor.oak.light').length,desks:s.artRoot.children.filter(o=>o.userData.officeAssetId==='desk.modern').length,employees:s.artRoot.children.filter(o=>o.userData.employeeId).length,architectures:s.artRoot.children.filter(o=>o.name==='premium-architecture-v29').length,legacy:s.artRoot.children.filter(o=>s.architecture.metadata.replaceLegacy.includes(o.userData.officeAssetId)).length,lights,shadow,canvases:document.querySelectorAll('canvas.office-scene-3d-canvas').length};})()`);
    assert.deepEqual(invariants,{floor:1,desks:12,employees:11,architectures:1,legacy:0,lights:7,shadow:1,canvases:1});metrics.invariants=invariants;
    assert.equal(metrics.diagnostics.valid,true);assert.equal(metrics.diagnostics.routes.filter(r=>r.reachable).length,15);
    results.push(metrics);console.log(mode,metrics.calls,metrics.triangles,metrics.geometries,metrics.textures,'collisions',metrics.diagnostics.issues.length);
    for(const [name,center,zoom] of [['meeting',[7.1,1.2,-4.1],2.6],['lounge',[-7.7,1.4,-3.8],2.9],['employees',[-.4,1.15,1],3]]){
      await evaluate(`(()=>{const s=towerInspect();s.camera.position.set(${center[0]+19},${center[1]+20},${center[2]-23});s.camera.lookAt(${center.join(',')});s.camera.zoom=${zoom};s.camera.updateProjectionMatrix();s.renderer.render(s.scene,s.camera);})()`);
      const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(directory,`${label}-${mode}-${name}.png`),Buffer.from(shot.data,'base64'));
    }
  }
  await writeFile(resolve(directory,`${label}-metrics.json`),JSON.stringify(results,null,2));
  // Failure injection in the real main page; use its actual retry button.
  await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
  let failedRequest=false;
  onEvent=message=>{if(message.method==='Fetch.requestPaused'){
    const fail=!failedRequest;failedRequest=true;
    void call(fail?'Fetch.failRequest':'Fetch.continueRequest',fail?{requestId:message.params.requestId,errorReason:'Failed'}:{requestId:message.params.requestId});
  }};
  await call('Fetch.enable',{patterns:[{urlPattern:'*office-pack.glb*',requestStage:'Request'}]});
  await call('Page.navigate',{url:`${origin}/?debug=1`});
  await waitFor('document.querySelector(".mao-scene-status")?.dataset.sceneStatus==="error"');
  assert.equal(failedRequest,true);await call('Fetch.disable');onEvent=undefined;
  await evaluate(`document.querySelector('.mao-scene-status button').click()`);
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  console.log('PASS actual main-page retry after injected GLB failure');
  await evaluate(`window.towerInspect=()=>{let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return s;};window.retiredScenes=[];`);
  const cycles=[];
  for(let cycle=0;cycle<3;cycle++){
    await evaluate(`retiredScenes.push(towerInspect());window.dispatchEvent(new KeyboardEvent('keydown',{key:'e'}))`);
    await waitFor('!!document.querySelector("#mao-floor-menu")');
    await evaluate(`[...document.querySelectorAll('.mao-floor-row')].find(row=>row.querySelector('.mao-floor-number').textContent==='03').click()`);
    await waitFor('!document.querySelector("canvas.office-scene-3d-canvas")');
    await waitFor('retiredScenes.every(s=>s.lifecycle.released)');
    const cleanup=await evaluate('retiredScenes.at(-1).lifecycle');assert.equal(cleanup.geometries,0);assert.equal(cleanup.textures,0);
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'e'}))`);
    await waitFor('!!document.querySelector("#mao-floor-menu")');
    await evaluate(`[...document.querySelectorAll('.mao-floor-row')].find(row=>row.querySelector('.mao-floor-number').textContent==='02').click()`);
    await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
    const memory=await evaluate('({...towerInspect().renderer.info.memory})');cycles.push({cycle,memory,cleanup});
  }
  assert.ok(cycles.every(c=>c.memory.geometries===cycles[0].memory.geometries&&c.memory.textures===cycles[0].memory.textures));
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:2,mobile:false});
  await call('Page.navigate',{url:`${origin}/?debug=1`});
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  assert.equal(await evaluate('Number(document.querySelector(".office-scene-3d-mount").dataset.dpr)'),1.5);
  await writeFile(resolve(directory,`${label}-lifecycle.json`),JSON.stringify({mainRetry:true,cycles,dprCap:true},null,2));
  console.log('PASS three real floor 02/03/02 cycles; stable resident resources and zero retired GPU resources');
  // Comparison sheets contain actual application screenshots and the unmodified reference.
  for(const [name,first,second] of [
    ['comparison-approved',`/@fs${resolve(appRoot,'../../references/MAO-FLOOR02-APPROVED.png')}`,`/src/office-3d/gfx29/integration/screenshots/${label}-glb-1920x1080.png`],
    ['comparison-characters',`/src/office-3d/gfx29/integration/screenshots/${label}-glb-employees.png`,`/src/office-3d/gfx29/integration/screenshots/${label}-procedural-employees.png`],
  ]){
    await call('Emulation.setDeviceMetricsOverride',{width:2400,height:800,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.body.innerHTML='<main style="display:flex;gap:12px;background:#242a30;color:#eee;width:2400px;height:800px;font:20px system-ui"><section><p>${name==='comparison-approved'?'APPROVED reference':'GLB selected'} </p><img style="width:1194px" src="${first}"/></section><section><p>${name==='comparison-approved'?'Actual MAO Tower':'Procedural C comparison'} </p><img style="width:1194px" src="${second}"/></section></main>'`);
    await waitFor('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)');
    const sheet=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(directory,`${label}-${name}.png`),Buffer.from(sheet.data,'base64'));
  }

  }
} finally {ws?.close();browser?.kill();await server.close();}
