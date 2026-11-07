/** Run with node apps/office/src/integration/tower.browser-check.mjs. No added packages. */
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
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
  // A crashed software WebGL browser must fail the run, never exit with a
  // successful partial check list while an unresolved CDP promise is pending.
  ws.onclose = () => { for (const request of pending.values()) request.reject(new Error('CDP browser closed before checks completed')); pending.clear(); };
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
    for (let i = 0; i < 1000; i++) {
      if (await evaluate(expression)) return;
      await new Promise(accept => setTimeout(accept, 100));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: .5, mobile: false });
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
  check(await evaluate(`(()=>{const c=sceneTest.inspect().artRoot.children.filter(o=>o.userData.employeeId);return c.length===11 && new Set(c.map(o=>o.userData.employeeId)).size===11 && c.every(o=>o.name==='gfx32-tailored-character' && o.children.length===2);})()`),'11 unique integrated sculpted employees, two meshes each, no duplicate GLB');
  check(await evaluate(`(()=>{const c=sceneTest.inspect().artRoot.children.find(o=>o.userData.employeeId);const seed=JSON.stringify(c.userData.appearance),g=c.children[0].geometry;const before={employeeId:c.userData.employeeId,deskId:c.userData.deskId,status:c.userData.status};c.updateData({...before,status:'blocked'});const ok=seed===JSON.stringify(c.userData.appearance)&&g===c.children[0].geometry;c.updateData(before);return ok;})()`),'status changes preserve appearance and geometry');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  check(await evaluate(`(()=>{const c=sceneTest.inspect().artRoot.children.find(o=>o.userData.employeeId);c.updateAnimation(.3,{reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches});return c.children[1].rotation.y===0;})()`),'browser reduced-motion restores static head');
  await call('Emulation.setEmulatedMedia',{features:[]});
  check(await evaluate(`(()=>{const s=sceneTest.inspect(),n=s.navigation34;return n.ready&&n.routes.length===20&&n.routes.every(r=>r.reachable)&&n.seats.every(p=>{const c=s.artRoot.children.find(o=>o.userData.officeAssetId==='chair.ergonomic'&&o.userData.deskId===p.deskId);return c.position.x===p.chair.x&&c.position.z===p.chair.z;});})()`),'GFX35 snapshot matches real chair anchors and all 20 radius-aware routes');
  check(await evaluate('!!sceneTest.inspect().scene.environment && sceneTest.inspect().scene.environmentIntensity===.16'),'one static PBR environment belongs to existing lighting pipeline');
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
  check(await evaluate(`sceneTest.inspect().navigation34.seats.find(s=>s.deskId==='desk-floor-2-12').employeeId==='directory-updated'`),'navigation occupancy follows Directory reconciliation at reserve desk');
  check(await evaluate('sceneTest.inspect().renderer===originalRenderer && sceneTest.inspect().artRoot.children.find(o=>o.userData.employeeId==="directory-updated").userData.deskId==="desk-floor-2-12"'),'real Directory identity/desk update reconciles character at reserve desk without renderer teardown');
  await waitFor('Math.abs(sceneTest.inspect().visibleDoors[0].object.position.x-sceneTest.inspect().visibleDoors[0].baseX)-.95<1e-10 && Math.abs(sceneTest.inspect().visibleDoors[0].object.position.x-sceneTest.inspect().visibleDoors[0].baseX)>.94999999');
  await new Promise(r=>setTimeout(r,200)); const frames=(await snapshot()).frame; await new Promise(r=>setTimeout(r,300));
  check((await snapshot()).frame===frames,'animation stops scheduling frames after convergence');
  await evaluate('window.disposedScene=sceneTest.inspect();sceneTest.unmount()'); await waitFor('document.querySelectorAll("canvas.office-scene-3d-canvas").length===0');
  await waitFor('disposedScene.lifecycle.released');
  check(await evaluate('disposedScene.lifecycle.geometries===0 && disposedScene.lifecycle.textures===0'),'unmount releases every uploaded geometry and texture');
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
  const pinchBefore=await evaluate('sceneTest.inspect().camera.zoom');
  const touchCenter=await evaluate('(()=>{const r=sceneTest.inspect().renderer.domElement.getBoundingClientRect();return {x:r.left+r.width*.5,y:r.top+r.height*.6};})()');
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:11,x:touchCenter.x-40,y:touchCenter.y},{id:12,x:touchCenter.x+40,y:touchCenter.y}]});
  await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:11,x:touchCenter.x-65,y:touchCenter.y},{id:12,x:touchCenter.x+65,y:touchCenter.y}]});
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await waitFor(`sceneTest.inspect().camera.zoom > ${pinchBefore}`);
  check((await snapshot()).calls===5,'trusted two-finger pinch zooms without an elevator click');
  await evaluate(`window.dispatchEvent(new Event('mao-3d-reset'))`);
  await waitFor('sceneTest.inspect().camera.zoom===1');check(true,'Reset restores default framing after pinch');
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
  p=await evaluate('realPoint("display")');await click(p);await waitFor('!!document.querySelector("#mao-floor-menu")');
  check(true,'actual indicator click opens menu after floor round trip');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  check(await evaluate(`(()=>{const s=towerInspect(),employees=s.artRoot.children.filter(o=>o.userData.employeeId),desks=s.artRoot.children.filter(o=>o.userData.officeAssetId==='desk.modern');return employees.length===11&&desks.length===12&&new Set(desks.map(o=>o.userData.deskId)).size===12;})()`),'12 unique desk slots and 11 employees after remount');
  await writeFile(resolve(appRoot,'src/office-3d/gfx35/screenshots/final-navigation.json'),JSON.stringify(await evaluate('towerInspect().navigation34'),null,2));
  const screenshotDir=resolve(appRoot,'src/office-3d/gfx35/screenshots/webgl');await mkdir(screenshotDir,{recursive:true});
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
  check(await evaluate(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js');const s=towerInspect();s.scene.updateMatrixWorld(true);return [-4.3,4.3].every(x=>{const ray=new THREE.Raycaster(new THREE.Vector3(x+.65,2.6,5.5),new THREE.Vector3(0,0,1));const hit=ray.intersectObjects(s.scene.children,true).find(h=>{let o=h.object;while(o){if(!o.visible)return false;o=o.parent;}const m=h.object.material;return m&&!Array.isArray(m)&&!m.transparent;});return ['skyline','distant-skyline','sky','city-windows','city-canopies'].includes(hit?.object.name);});})()`),'real window rays reach exterior skyline without opaque masonry');
  for(const [name,center,zoom] of [['windows',[0,2.5,6.8],2.4],['meeting',[7.1,1.2,-4.1],3]]) {
    await evaluate(`(()=>{const s=towerInspect();s.camera.position.set(${center[0]+17},${center[1]+17},${center[2]-18});s.camera.lookAt(${center.join(',')});s.camera.zoom=${zoom};s.camera.updateProjectionMatrix();s.renderer.render(s.scene,s.camera);})()`);
    const shot=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve(screenshotDir,`${name}-closeup.png`),Buffer.from(shot.data,'base64'));
  }
  await evaluate(`window.dispatchEvent(new Event('mao-3d-fit'))`);
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const lighting = await evaluate(`(()=>{
    const s=towerInspect(),floor=s.artRoot.children.find(o=>o.userData.officeAssetId==='floor.oak.light');
    let material;floor.traverse(o=>{if(o.isMesh) material=Array.isArray(o.material)?o.material[0]:o.material;});
    return {floorTextured:!!material.map?.image?.width,mapColorSpace:material.map?.colorSpace,colorSpace:s.renderer.outputColorSpace,exposure:s.renderer.toneMappingExposure,calls:s.renderer.info.render.calls,triangles:s.renderer.info.render.triangles,geometries:s.renderer.info.memory.geometries,textures:s.renderer.info.memory.textures,shadowSize:s.lighting.lights.daylight.shadow.mapSize.toArray(),shadowCoversFloor:[-11,11].every(x=>[-7,7].every(z=>{const p=s.camera.position.clone().set(x,0,z).project(s.lighting.lights.daylight.shadow.camera);return Math.abs(p.x)<=1&&Math.abs(p.y)<=1;}))};
  })()`);
  check(lighting.shadowCoversFloor,'shadow projection covers all floor corners');
  check(lighting.floorTextured && lighting.mapColorSpace==='srgb', 'premium palette retains an uploaded sRGB oak texture');
  await writeFile(resolve(screenshotDir,'lighting-metrics.json'),JSON.stringify(lighting,null,2));
  console.log('LIGHTING',lighting);
  console.log('SCREENSHOTS',screenshotDir);
  await call('Page.navigate',{url:`${origin}/__scene_check?debug=1&failWebGL=1`});
  await waitFor('window.sceneTest?.state.statuses.includes("error")');
  check(await evaluate('!sceneTest.state.statuses.includes("ready")'),'WebGL creation failure reports error, never ready');
  await call('Page.navigate',{url:`${origin}/?debug=1&gfx32=legacy`});
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  await evaluate(`(async()=>{ const THREE=await import('/node_modules/three/build/three.module.js'); const inspect=()=>{ let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return s; }; window.towerInspect=inspect;window.realPoint=${pointSource};window.towerRenderer=inspect().renderer; })()`);
  check(await evaluate(`towerInspect().artRoot.children.filter(o=>o.userData.employeeId).length===11 && !towerInspect().artRoot.children.some(o=>o.name==='gfx32-tailored-character')`),'legacy GLB switch retains 11 employees');
  p=await evaluate('realPoint("doors")');await click(p);await waitFor('!!document.querySelector("#mao-floor-menu")');
  check(true,'legacy switch preserves real elevator click');

  // Interactions use DPR .5 to keep SwiftShader raster cost bounded; saved screenshots above use DPR 1.
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:.5,mobile:false});
  // Same fixture and renderer, now with real GPU-skinned local simulation.
  await call('Page.navigate',{url:`${origin}/__scene_check?debug=1&gfx35=demo&gfx35Clock=manual`});
  await waitFor('sceneTest?.inspect()?.status==="ready"');
  check(await evaluate(`(()=>{const s=sceneTest.inspect(),a=s.animation35;return a.controllers.size===11&&a.errors.length===0&&s.artRoot.children.filter(o=>o.rig35).length===11;})()`),'demo binds exactly 11 unique controllers to the existing character objects');
  await evaluate('window.demoRenderer=sceneTest.inspect().renderer;window.demoEngine=sceneTest.inspect().animation35');
  await evaluate('sceneTest.inspect().advance35(8)');
  const moving=await evaluate(`(()=>{const c=demoEngine.controllers.get('employee-001');return {state:c.state,position:c.actor.object.position.toArray()};})()`);
  check(['WALKING','TURNING'].includes(moving.state),'real browser advances from typing through stand to locomotion');
  await evaluate("window.movingObject=demoEngine.controllers.get('employee-001').actor.object;window.movingController=demoEngine.controllers.get('employee-001');sceneTest.updateEmployeeStatus('blocked')");
  await waitFor("movingObject.userData.status==='blocked'");
  check(await evaluate("demoEngine.controllers.get('employee-001')===movingController && movingController.actor.object===movingObject"),'real status reconciliation preserves a moving actor and its controller');
  // Restrict the existing geometric point finder to the moving employee itself.
  await evaluate(`window.movingPoint=${pointSource.replace("Boolean(object.userData.employeeId)","object.userData.employeeId==='employee-001'")}`);
  p=await evaluate('movingPoint("employee")');await click(p);
  await waitFor('sceneTest.state.employee==="employee-001"');
  check(true,'trusted raycast selects the same employee while the skinned model is walking');
  p=await evaluate('sceneTest.point("call-panel")');await click(p);await waitFor('sceneTest.state.elevator===1');
  await waitFor('Math.abs(sceneTest.inspect().visibleDoors[0].object.position.x-sceneTest.inspect().visibleDoors[0].baseX)>.9');
  check(await evaluate('sceneTest.inspect().renderer===demoRenderer'),'physical panel and door animation share one renderer with walking');
  await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));sceneTest.inspect().advance35(40)");
  check(await evaluate(`JSON.stringify(demoEngine.controllers.get('employee-001').actor.object.position.toArray())===${JSON.stringify(JSON.stringify(moving.position))}`),'hidden scheduler pauses world transforms');
  await evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))");
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await waitFor('demoEngine.reducedMotion');
  check(await evaluate('!demoEngine.active && [...demoEngine.controllers.values()].every(c=>!c.active)'),'reduced-motion change cancels optional demo locomotion and every idle queue');
  await evaluate('window.demoDisposed=sceneTest.inspect();sceneTest.unmount()');
  await waitFor('demoDisposed.lifecycle.released');
  check(await evaluate('demoEngine.disposed && demoEngine.controllers.size===0 && demoDisposed.lifecycle.geometries===0 && demoDisposed.lifecycle.textures===0'),'animated unmount releases joint textures, geometry, controllers and loop');
  await evaluate('sceneTest.render()');await waitFor('sceneTest.inspect()?.status==="ready"');
  check(await evaluate(`sceneTest.inspect().animation35.reducedMotion && !sceneTest.inspect().animation35.active && document.querySelectorAll('canvas').length===1`),'StrictMode remount respects already-active reduced motion');
  await call('Emulation.setEmulatedMedia',{features:[]});
  await evaluate('window.retryAnimation=sceneTest.inspect().animation35;sceneTest.changeManifest("/missing-manifest.json")');
  await waitFor('sceneTest.inspect()?.status==="error"');
  await evaluate('sceneTest.changeManifest("/office-art/v1/manifest.json")');await waitFor('sceneTest.inspect()?.status==="ready"');
  check(await evaluate('retryAnimation.disposed && retryAnimation.controllers.size===0 && sceneTest.inspect().animation35.controllers.size===11 && sceneTest.inspect().animation35.errors.length===0'),'retry reconciles animated characters without duplicated controllers');
  await call('Page.navigate',{url:`${origin}/?debug=1&gfx35=demo&gfx35Clock=manual`});
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  await evaluate(`window.towerInspect=()=>{let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return s;};window.realPoint=${pointSource};`);
  await evaluate('window.floorEngine=towerInspect().animation35;towerInspect().advance35(8)');
  p=await evaluate('realPoint("doors")');await click(p);await waitFor('!!document.querySelector("#mao-floor-menu")');
  await evaluate(`[...document.querySelectorAll('.mao-floor-row')].find(row=>row.querySelector('.mao-floor-number').textContent==='03').click()`);
  await waitFor('document.querySelector(".mao-office-ui").dataset.activeFloor==="floor-02"');
  check(await evaluate('floorEngine.disposed && floorEngine.controllers.size===0'),'leaving Floor 02 disposes its active local simulation');
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'e'}))`);await waitFor('!!document.querySelector("#mao-floor-menu")');
  await evaluate(`[...document.querySelectorAll('.mao-floor-row')].find(row=>row.querySelector('.mao-floor-number').textContent==='02').click()`);
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  check(await evaluate('towerInspect().animation35.controllers.size===11 && towerInspect().animation35!==floorEngine'),'return to Floor 02 creates fresh controllers, no duplicate employee objects');
  await call('Page.navigate',{url:`${origin}/?debug=1&gfx35=off`});await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  await evaluate(`window.towerInspect=()=>{let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return s;};`);
  check(await evaluate('!towerInspect().animation35 && !towerInspect().artRoot.children.some(o=>o.rig35)'),'gfx35=off uses unchanged static GFX32 characters without any animation engine');
  await call('Page.navigate',{url:`${origin}/?debug=1&gfx35=demo&gfx32=legacy`});await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  await evaluate(`window.towerInspect=()=>{let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return s;};`);
  check(await evaluate('towerInspect().animation35.controllers.size===0 && !towerInspect().animation35.active && towerInspect().artRoot.children.filter(o=>o.userData.employeeId).length===11'),'legacy fallback stays static and never moves an unrigged seated figure');

  await call('Page.navigate',{url:`${origin}/__scene_check?debug=1&gfx35=demo`});
  await waitFor('sceneTest?.inspect()?.status==="ready"');
  await waitFor("sceneTest.inspect().animation35.controllers.get('employee-001').time>.05");
  check(true,'normal demo advances from the existing render RAF without the manual test clock');
  await evaluate('sceneTest.inspect().advance35(100)');
  await waitFor('!sceneTest.inspect().animation35.active');
  await new Promise(r=>setTimeout(r,800));const quietFrames=await evaluate('sceneTest.inspect().frameCount');await new Promise(r=>setTimeout(r,500));
  check(await evaluate(`sceneTest.inspect().frameCount===${quietFrames}`),'finite demo stops the actual render loop after all actors finish');
  console.log(`Real WebGL checks: ${checks.length}`);

} finally {
  ws?.close();
  browser?.kill();
  await server.close();
}
