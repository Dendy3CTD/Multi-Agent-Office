/** Run with node apps/office/src/integration/tower.browser-check.mjs. No added packages. */
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../../..');
const profile = await mkdtemp(resolve(tmpdir(), 'mao-gfx29-lighting-'));
const server = await createServer({root:appRoot,configFile:false,cacheDir:resolve(profile,'vite-cache'),server:{host:'127.0.0.1',port:0}});
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
    for (let i = 0; i < 600; i++) {
      if (await evaluate(expression)) return;
      await new Promise(accept => setTimeout(accept, 100));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
  const results=[];
  for(const iteration of [1,2]){
    await call('Page.navigate',{url:`${origin}/src/office-3d/gfx29/architecture/preview.html?iteration=${iteration}`});
    await waitFor('window.architecturePreview?.ready || window.architecturePreview?.error');
    const error=await evaluate('architecturePreview.error');if(error)throw Error(error);
    const metrics=await evaluate('architecturePreview.metrics');results.push(metrics);
    assert.ok(metrics.probes.every(p=>p.glass&&!p.brick&&p.skyline),'40 edge/interior window rays reach glazing and environment without brick');
    assert.equal(metrics.diagnostics.valid,true);assert.equal(metrics.diagnostics.routes.filter(r=>r.reachable).length,15);assert.equal(metrics.diagnostics.workplaceCount,12);assert.equal(metrics.diagnostics.employeeCount,11);
    await mkdir(resolve(here,'screenshots'),{recursive:true});
    for(const view of ['hero','windows','meeting','lounge']){
      await evaluate(`architecturePreview.view('${view}')`);
      const image=await call('Page.captureScreenshot',{format:'png'});
      await writeFile(resolve(here,`screenshots/iteration-${iteration}-${view}.png`),Buffer.from(image.data,'base64'));
    }
    console.log('iteration',iteration,'architecture meshes',metrics.architectureMeshes,'calls',metrics.architectureCalls,'full',metrics.fullSceneCalls,'issues',JSON.stringify(metrics.diagnostics.issues));
    const before=await evaluate('architecturePreview.renderer.info.memory');
    await evaluate('architecturePreview.cleanup()');
    metrics.cleanup={before,after:await evaluate('architecturePreview.renderer.info.memory')};assert.equal(metrics.cleanup.after.geometries,0);assert.equal(metrics.cleanup.after.textures,0);
  }
  await writeFile(resolve(here,'screenshots/metrics.json'),JSON.stringify(results,null,2));
  await call('Emulation.setDeviceMetricsOverride',{width:2400,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.body.innerHTML = '<main style="display:flex;gap:12px;font:20px system-ui;color:#eee;background:#242a30;width:2400px;height:1000px"><section style="width:792px"><p>APPROVED reference</p><img style="width:792px" src="/@fs${resolve(appRoot,'../../references/MAO-FLOOR02-APPROVED.png')}" /></section><section style="width:792px"><p>Iteration 1 · actual GLB</p><img style="width:792px" src="/src/office-3d/gfx29/architecture/screenshots/iteration-1-hero.png" /></section><section style="width:792px"><p>Iteration 2 · corrected architecture</p><img style="width:792px" src="/src/office-3d/gfx29/architecture/screenshots/iteration-2-hero.png" /></section></main>'`);
  await waitFor('Array.from(document.images).every(i=>i.complete && i.naturalWidth>0)');
  const comparison=await call('Page.captureScreenshot',{format:'png'});
  await writeFile(resolve(here,'screenshots/comparison.png'),Buffer.from(comparison.data,'base64'));

} finally { ws?.close(); browser?.kill(); await server.close(); }
