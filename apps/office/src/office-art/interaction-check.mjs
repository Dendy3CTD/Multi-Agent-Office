/** Run with node apps/office/src/integration/tower.browser-check.mjs. No added packages. */
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const profile = await mkdtemp(resolve(tmpdir(), 'mao-tower-check-'));
const server = await createServer({
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
  await server.listen();
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
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
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
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await new Promise(accept => setTimeout(accept, 100));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `${origin}/__scene_check?debug=1` });
  await waitFor('window.sceneTest?.inspect()?.status === "ready"');
  const checks = [];
  function check(condition, message) { assert.ok(condition, message); checks.push(message); console.log('PASS', message); }
  const snapshot = () => evaluate(`(() => { const s=sceneTest.inspect(); return {status:s.status, doors:s.visibleDoors.map(d=>({x:d.object.position.x,base:d.baseX,name:d.object.name,visible:d.object.visible})), calls:sceneTest.state.elevator, employee:sceneTest.state.employee, frame:s.frameCount, canvases:document.querySelectorAll('canvas.office-scene-3d-canvas').length, dpr:s.renderer.getPixelRatio()}; })()`);
  const click = async point => {
    await call('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x,y:point.y });
    await call('Input.dispatchMouseEvent', { type:'mousePressed', x:point.x,y:point.y,button:'left',clickCount:1 });
    await call('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x,y:point.y,button:'left',clickCount:1 });
  };
  await evaluate('window.originalRenderer=sceneTest.inspect().renderer;window.originalCanvas=originalRenderer.domElement');
  let p=await evaluate('sceneTest.point("doors")'); console.log('real door surface',p);
  await click(p);
  await waitFor('sceneTest.state.elevator===1');
  await waitFor('Math.abs(sceneTest.inspect().visibleDoors[0].object.position.x-sceneTest.inspect().visibleDoors[0].baseX)>.9');
  let first=await snapshot();
  check(first.calls===1 && first.doors.length===2 && first.doors.every(d=>d.visible), 'trusted canvas door click calls elevator once and moves visible GLB doors');
  p=await evaluate('sceneTest.point("call-panel")'); console.log('real panel surface',p); await click(p);
  await waitFor('sceneTest.state.elevator===2');
  await waitFor('Math.abs(sceneTest.inspect().visibleDoors[0].object.position.x-sceneTest.inspect().visibleDoors[0].baseX)<.001');
  check((await snapshot()).calls===2,'panel click once; doors restore exact base transforms');
  await evaluate('sceneTest.renderEquivalent()');
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  check(await evaluate('sceneTest.inspect().renderer===originalRenderer && originalRenderer.domElement===originalCanvas'),'equivalent employee/manifest props preserve actual WebGLRenderer and canvas');
  p=await evaluate('sceneTest.point("doors")');
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+60,y:p.y+30,button:'left',buttons:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+60,y:p.y+30,button:'left',clickCount:1});
  check((await snapshot()).calls===2,'pan drag suppresses elevator callback');
  p=await evaluate('sceneTest.point("doors")'); await click(p); await waitFor('sceneTest.state.elevator===3');
  check((await snapshot()).calls===3,'click after pan works');
  p=await evaluate('sceneTest.point("employee")'); await click(p);
  await waitFor('!!sceneTest.state.employee');
  check((await snapshot()).calls===3,'employee hit selects employee without elevator');
  p=await evaluate('sceneTest.point("deskmodern")'); await click(p);
  check((await snapshot()).calls===3,'furniture does not trigger elevator');
  p=await evaluate('sceneTest.point("armchair")');await click(p);
  check((await snapshot()).calls===3,'lounge furniture adjacent to elevator does not trigger elevator');
  await evaluate('sceneTest.updateEmployee()');
  await waitFor('sceneTest.inspect().artRoot.children.some(o=>o.userData.employeeId==="directory-updated")');
  check(await evaluate('sceneTest.inspect().renderer===originalRenderer && sceneTest.inspect().artRoot.children.find(o=>o.userData.employeeId==="directory-updated").userData.deskId==="desk-floor-2-12"'),'real Directory identity/desk update reconciles character at reserve desk without renderer teardown');
  await waitFor('Math.abs(sceneTest.inspect().visibleDoors[0].object.position.x-sceneTest.inspect().visibleDoors[0].baseX)-.95<1e-10 && Math.abs(sceneTest.inspect().visibleDoors[0].object.position.x-sceneTest.inspect().visibleDoors[0].baseX)>.94999999');
  await new Promise(r=>setTimeout(r,200)); const frames=(await snapshot()).frame; await new Promise(r=>setTimeout(r,300));
  check((await snapshot()).frame===frames,'animation stops scheduling frames after convergence');
  await evaluate('sceneTest.unmount()'); await waitFor('document.querySelectorAll("canvas.office-scene-3d-canvas").length===0');
  await evaluate('sceneTest.render()'); await waitFor('sceneTest.inspect()?.status==="ready"');
  check((await snapshot()).canvases===1,'StrictMode remount has exactly one canvas');
  p=await evaluate('sceneTest.point("doors")'); await click(p); await waitFor('sceneTest.state.elevator===4');
  check((await snapshot()).calls===4,'door click after remount works exactly once');
  await evaluate('window.retryRenderer=sceneTest.inspect().renderer;sceneTest.changeManifest("/missing-manifest.json")');
  await waitFor('sceneTest.inspect()?.status==="error"');
  check(await evaluate('sceneTest.inspect().renderer===retryRenderer'),'manifest failure reports error while preserving renderer');
  await evaluate('sceneTest.changeManifest("/office-art/v1/manifest.json")'); await waitFor('sceneTest.inspect()?.status==="ready"');
  check((await snapshot()).dpr<=1.5,'recovery loading/ready and DPR cap');
  p=await evaluate('sceneTest.point("doors")');
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});
  await waitFor('sceneTest.inspect().highlight.visible');
  await evaluate(`document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerleave'))`);
  await waitFor('!sceneTest.inspect().highlight.visible');
  check(await evaluate('!document.querySelector("canvas").classList.contains("is-elevator-hover")'),'hover highlight clears on pointerleave');
  const beforeZoom=await evaluate('sceneTest.inspect().camera.zoom');
  await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:p.x,y:p.y,deltaX:0,deltaY:80});
  await waitFor(`sceneTest.inspect().camera.zoom!==${beforeZoom}`);
  p=await evaluate('sceneTest.point("doors")');await click(p);await waitFor('sceneTest.state.elevator===5');
  check(true,'wheel zoom retains subsequent physical click');
  await evaluate(`window.dispatchEvent(new Event('mao-3d-fit'))`);
  await waitFor('sceneTest.inspect().camera.zoom===1');
  check(true,'Fit Floor resets zoom');
  await evaluate('sceneTest.changeManifest("/slow-manifest.json")');
  await waitFor('sceneTest.inspect()?.status==="loading"');
  const readyCount=await evaluate('sceneTest.state.statuses.filter(s=>s==="ready").length');
  await evaluate('sceneTest.unmount()');await new Promise(r=>setTimeout(r,1000));
  check(await evaluate(`sceneTest.state.statuses.filter(s=>s==="ready").length===${readyCount}`),'destroyed loading scene never reports ready');
  await evaluate('sceneTest.render()');await waitFor('sceneTest.inspect()?.status==="ready"');
  await evaluate('sceneTest.changeManifest("/broken-manifest.json")'); await waitFor('sceneTest.inspect()?.status==="error"');
  check(true,'failed mandatory GLB assets report error');
  const pointSource=await evaluate('sceneTest.point.toString()');
  // Full production composition, without any scene replacement.
  await call('Page.navigate',{url:`${origin}/?debug=1`});
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  await evaluate(`(async()=>{ const THREE=await import('/node_modules/three/build/three.module.js'); const inspect=()=>{ let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return s; }; window.towerInspect=inspect;window.realPoint=${pointSource};window.towerRenderer=inspect().renderer; })()`);
  p=await evaluate('realPoint("doors")'); await click(p); await waitFor('!!document.querySelector("#mao-floor-menu")');
  check(await evaluate('towerInspect().renderer===towerRenderer'),'real GLB pointer click opens actual ElevatorMenu without renderer replacement');
  await evaluate(`[...document.querySelectorAll('.mao-floor-row')].find(row=>row.querySelector('.mao-floor-number').textContent==='03').click()`);
  await waitFor('document.querySelector(".mao-office-ui").dataset.activeFloor==="floor-02"');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'e'}))`);
  await waitFor('!!document.querySelector("#mao-floor-menu")');
  await evaluate(`[...document.querySelectorAll('.mao-floor-row')].find(row=>row.querySelector('.mao-floor-number').textContent==='02').click()`);
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  p=await evaluate('realPoint("doors")'); await click(p); await waitFor('!!document.querySelector("#mao-floor-menu")');
  check(true,'actual Tower floor 02/03/02 round trip preserves physical elevator interaction');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  const screenshotDir=resolve(appRoot,'public/office-art/studio-29/interaction');await mkdir(screenshotDir,{recursive:true});
  for(const [width,height] of [[1366,768],[1920,1080]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`window.dispatchEvent(new Event('mao-3d-fit'))`);
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    check(await evaluate(`(()=>{const s=towerInspect(),r=s.renderer.domElement.getBoundingClientRect();return r.bottom<=innerHeight+1 && r.top>=73;})()`),`3D canvas fits visible ${width}x${height} viewport`);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});
    await evaluate('new Promise(r=>requestAnimationFrame(r))');
    const shot=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve(screenshotDir,`floor02-${width}x${height}.png`),Buffer.from(shot.data,'base64'));
  }
  check(await evaluate(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js');const s=towerInspect();s.scene.updateMatrixWorld(true);return [-4.4,4.4].every(x=>{const ray=new THREE.Raycaster(new THREE.Vector3(x+.65,2.6,5.5),new THREE.Vector3(0,0,1));const hit=ray.intersectObjects(s.scene.children,true).find(h=>{let o=h.object;while(o){if(!o.visible)return false;o=o.parent;}const m=h.object.material;return m&&!Array.isArray(m)&&!m.transparent;});return hit?.object.name.startsWith('skyline-')||hit?.object.name==='daylight-sky';});})()`),'real window rays reach exterior skyline without opaque masonry');
  for(const [name,center,zoom] of [['windows',[0,2.5,6.8],2.4],['meeting',[7,1.2,-.9],3]]) {
    await evaluate(`(()=>{const s=towerInspect();s.camera.position.set(${center[0]+17},${center[1]+17},${center[2]-18});s.camera.lookAt(${center.join(',')});s.camera.zoom=${zoom};s.camera.updateProjectionMatrix();s.renderer.render(s.scene,s.camera);})()`);
    const shot=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve(screenshotDir,`${name}-closeup.png`),Buffer.from(shot.data,'base64'));
  }
  await evaluate(`window.dispatchEvent(new Event('mao-3d-fit'))`);
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const lighting = await evaluate(`(()=>{
    const s=towerInspect(),floor=s.artRoot.children.find(o=>o.userData.officeAssetId==='floor.oak.light');
    let material;floor.traverse(o=>{if(o.isMesh) material=Array.isArray(o.material)?o.material[0]:o.material;});
    return {floorTextured:!!material.map?.image?.width,bumpColorSpace:material.bumpMap?.colorSpace,colorSpace:s.renderer.outputColorSpace,exposure:s.renderer.toneMappingExposure,calls:s.renderer.info.render.calls,triangles:s.renderer.info.render.triangles,geometries:s.renderer.info.memory.geometries,textures:s.renderer.info.memory.textures,shadowSize:s.scene.children.find(o=>o.isDirectionalLight).shadow.mapSize.toArray(),shadowCoversFloor:[-11,11].every(x=>[-7,7].every(z=>{const p=s.camera.position.clone().set(x,0,z).project(s.scene.children.find(o=>o.isDirectionalLight).shadow.camera);return Math.abs(p.x)<=1&&Math.abs(p.y)<=1;}))};
  })()`);
  check(lighting.shadowCoversFloor,'shadow projection covers all floor corners');
  check(lighting.floorTextured && lighting.bumpColorSpace==='', 'comfort overrides retain real oak texture and linear bump data');
  await writeFile(resolve(screenshotDir,'lighting-metrics.json'),JSON.stringify(lighting,null,2));
  console.log('LIGHTING',lighting);
  console.log('SCREENSHOTS',screenshotDir);
  await call('Page.navigate',{url:`${origin}/__scene_check?debug=1&failWebGL=1`});
  await waitFor('window.sceneTest?.state.statuses.includes("error")');
  check(await evaluate('!sceneTest.state.statuses.includes("ready")'),'WebGL creation failure reports error, never ready');
  console.log(`Real WebGL checks: ${checks.length}`);

} finally {
  ws?.close();
  browser?.kill();
  await server.close();
}
