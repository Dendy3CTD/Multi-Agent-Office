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
  ws.onclose=()=>{for(const request of pending.values())request.reject(new Error('browser closed before motion checks completed'));pending.clear();};
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
  const directory=resolve(appRoot,'src/office-3d/gfx35/screenshots');await mkdir(directory,{recursive:true});
  const name=process.argv.find(a=>a.startsWith('--name='))?.slice(7)??'final';
  const mode=process.argv.includes('--characters')?'procedural':'glb';
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${origin}/?gfx35=demo&gfx35Clock=manual&debug=1&gfx29Characters=${mode}&gfx32=${process.argv.includes("--prototypes")?"prototypes":process.argv.includes("--legacy")?"legacy":""}`});
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready" || document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="error"');
  const status=await evaluate('({...document.querySelector(".office-scene-3d-mount").dataset})');assert.equal(status.sceneStatus,'ready',JSON.stringify(status));
  await evaluate(`window.towerInspect=()=>{let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return s;}`);
  await call('Network.enable');await call('Runtime.enable');
  const requests=[];onEvent=m=>{if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);};
  const settled=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const snapshot=()=>evaluate('towerInspect().animation35.snapshot');
  const advance=async seconds=>{await evaluate(`towerInspect().advance35(${seconds})`);await settled();};
  const until=async expression=>{for(let i=0;i<1800;i++){if(await evaluate(expression))return;await evaluate(`towerInspect().animation35.advance(.1)`);}throw Error(`simulation timeout: ${expression}`);};
  const hero=`towerInspect().animation35.controllers.get('employee-001')`;
  const trace=[],gaitTrace=[];
  const rigSnapshot=()=>evaluate(`(()=>{const c=${hero},o=c.actor.object,m=o.children[0];o.updateMatrixWorld(true);m.skeleton.update();const feet=[5,8].map(j=>{const ids=m.geometry.getAttribute('skinIndex'),pos=m.geometry.getAttribute('position');let selected=-1;for(let i=0;i<ids.count;i++)if(ids.getX(i)===j&&(selected<0||pos.getY(i)<pos.getY(selected)))selected=i;return m.localToWorld(m.getVertexPosition(selected,o.position.clone().set(0,0,0))).toArray();});return {uuid:o.uuid,feet,joints:m.skeleton.bones.map(b=>({name:b.name,world:b.position.clone().setFromMatrixPosition(b.matrixWorld).toArray(),rotation:b.quaternion.toArray()}))};})()`);
  const capture=async(name)=>{
    const state=await snapshot();trace.push({name,...state.actors[0],rig:await rigSnapshot()});
    await evaluate(`window.dispatchEvent(new Event('mao-3d-fit'))`);await settled();
    const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(directory,`${name}-floor.png`),Buffer.from(shot.data,'base64'));
    await evaluate(`(()=>{const s=towerInspect(),p=${hero}.actor.object.position;s.camera.position.set(p.x+19,p.y+17,p.z-23);s.camera.lookAt(p.x,p.y+1,p.z);s.camera.zoom=3.5;s.camera.updateProjectionMatrix();s.renderer.render(s.scene,s.camera);})()`);
    const close=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(directory,`${name}-close.png`),Buffer.from(close.data,'base64'));
    console.log('CAPTURE',name,state.actors[0].state,state.actors[0].position,'stand',state.actors[0].stand);
  };
  assert.deepEqual((await snapshot()).errors,[]);
  const statuses=await evaluate(`towerInspect().artRoot.children.filter(o=>o.userData.employeeId).map(o=>[o.userData.employeeId,o.userData.status])`);
  await advance(.7);await capture('01-typing');
  assert.equal((await snapshot()).actors[1].state,'SEATED_TYPING');assert.equal((await snapshot()).actors[2].state,'SEATED_THINKING');
  await until(`${hero}.state==='STAND_UP'`);await advance(.45);await capture('02-rising');
  await until(`${hero}.state==='STANDING_IDLE'`);await capture('03-standing');
  await until(`${hero}.snapshot.label==='to-lounge'`);await advance(.8);await capture('04-walking');
  // Twelve real WebGL frames of a gait cycle, for an actual-render GIF.
  await mkdir(resolve(directory,'gait'),{recursive:true});
  for(let i=0;i<12;i++){
    await advance(.1);gaitTrace.push(await rigSnapshot());
    await evaluate(`(()=>{const s=towerInspect(),p=${hero}.actor.object.position;s.camera.position.set(p.x+19,p.y+17,p.z-23);s.camera.lookAt(p.x,p.y+1,p.z);s.camera.zoom=3.5;s.camera.updateProjectionMatrix();s.renderer.render(s.scene,s.camera);})()`);
    const frame=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(directory,'gait',`${String(i).padStart(2,'0')}.png`),Buffer.from(frame.data,'base64'));
  }
  await until(`${hero}.state==='TURNING'`);await capture('05-lounge-approach');
  await until(`${hero}.state==='LOUNGE_IDLE'`);await advance(.3);await capture('06-lounge-seated');
  await until(`${hero}.snapshot.label==='return'`);await advance(.8);await capture('07-returning');
  await until(`${hero}.completed&&!${hero}.active`);await capture('08-desk-resumed');
  const final=await snapshot();assert.equal(final.actors[0].state,'SEATED_TYPING');assert.ok(Math.hypot(final.actors[0].position[0]+5.2,final.actors[0].position[2]+3.23)<.001);
  assert.ok(final.actors[0].history.some(s=>s.state==='LOUNGE_IDLE'));assert.equal(final.active,false);
  assert.deepEqual(await evaluate(`towerInspect().artRoot.children.filter(o=>o.userData.employeeId).map(o=>[o.userData.employeeId,o.userData.status])`),statuses);
  assert.equal(requests.length,0,`unexpected requests during simulation: ${requests}`);
  assert.equal(new Set(trace.map(t=>t.rig.uuid)).size,1,'one model for every animation state');
  assert.ok(gaitTrace.some(t=>Math.abs(t.feet[0][1]-gaitTrace[0].feet[0][1])>.02),'real foot vertices rise during gait');
  for(const t of gaitTrace)for(const foot of t.feet)assert.ok(foot[1]>=.09,`foot below floor: ${foot}`);
  await writeFile(resolve(directory,'motion-trace.json'),JSON.stringify({trace,gaitTrace,final,requests},null,2));
  await evaluate(`window.dispatchEvent(new Event('mao-3d-fit'))`);await settled();
  const metrics=await evaluate(`(()=>{const s=towerInspect(),i=s.renderer.info;return {calls:i.render.calls,triangles:i.render.triangles,geometries:i.memory.geometries,textures:i.memory.textures,dpr:s.renderer.getPixelRatio(),shadowSize:s.lighting.lights.daylight.shadow.mapSize.toArray(),controllers:s.animation35.controllers.size,active:s.animation35.active,renderer:'Chromium SwiftShader; not hardware Iris Xe'};})()`);
  await writeFile(resolve(directory,'final-demo-metrics.json'),JSON.stringify(metrics,null,2));
  console.log('METRICS',metrics);
  await call('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await evaluate(`window.dispatchEvent(new Event('mao-3d-fit'))`);await settled();
  const full=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(directory,'09-final-1920.png'),Buffer.from(full.data,'base64'));
  console.log('PASS complete real rig desk/lounge/desk, independent actors, unchanged statuses, zero network requests');
}finally{ws?.close();browser?.kill();await server.close();}
