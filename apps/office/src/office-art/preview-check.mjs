/** Run with node apps/office/src/integration/tower.browser-check.mjs. No added packages. */
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const profile = await mkdtemp(resolve(tmpdir(), 'mao-tower-check-'));
let serveBaseline = false;
const server = await createServer({
  root: appRoot, configFile: false, cacheDir: resolve(profile, 'vite-cache'),
  plugins: [{ name: 'real-scene-check',
    configureServer(server) {
      server.middlewares.use(async (req,res,next)=>{
        if(!serveBaseline || !req.url?.startsWith('/office-art/v1/')) return next();
        try {
          const file=req.url.split('?')[0].replace('/office-art/v1/','');
          const bytes=await readFile(resolve(appRoot,'public/office-art/studio-29/before',file));
          res.setHeader('Content-Type',file.endsWith('.json')?'application/json':file.endsWith('.svg')?'image/svg+xml':'model/gltf-binary');res.end(bytes);
        } catch(error) { next(error); }
      });
      server.middlewares.use('/__art_preview', async (_req,res,next)=>{try {
        res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__art_preview','<html><body><script type="module" src="/src/office-art/asset-preview.ts"></script></body></html>'));
      }catch(error){next(error)}});
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
  await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1360,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${origin}/__art_preview`});
  await waitFor('window.artPreview?.ready || window.artPreview?.error');
  const outcome=await evaluate('window.artPreview');
  assert.ok(outcome.ready,JSON.stringify(outcome));
  const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  const target=resolve(appRoot,'public/office-art/studio-29/premium-contact-sheet.png');
  await writeFile(target,Buffer.from(screenshot.data,'base64'));
  await writeFile(resolve(appRoot,'public/office-art/studio-29/preview-metrics.json'),JSON.stringify(outcome,null,2));
  console.log(JSON.stringify(outcome,null,2));console.log('SCREENSHOT',target);
  await call('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${origin}/?debug=1`});
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  const metrics=await evaluate(`(()=>{let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return {calls:s.renderer.info.render.calls,triangles:s.renderer.info.render.triangles,geometries:s.renderer.info.memory.geometries,textures:s.renderer.info.memory.textures,dpr:s.renderer.getPixelRatio()};})()`);
  const full=await call('Page.captureScreenshot',{format:'png'});
  await writeFile(resolve(appRoot,'public/office-art/studio-29/floor02-premium.png'),Buffer.from(full.data,'base64'));
  await writeFile(resolve(appRoot,'public/office-art/studio-29/floor02-metrics.json'),JSON.stringify(metrics,null,2));
  console.log('FLOOR02',metrics);
  serveBaseline=true;
  await call('Page.navigate',{url:`${origin}/?debug=1&baseline=1`});
  await waitFor('document.querySelector(".office-scene-3d-mount")?.dataset.sceneStatus==="ready"');
  const oldMetrics=await evaluate(`(()=>{let s;document.querySelector('.office-scene-3d-mount').dispatchEvent(new CustomEvent('mao-3d-inspect',{detail:v=>s=v}));return {calls:s.renderer.info.render.calls,triangles:s.renderer.info.render.triangles,geometries:s.renderer.info.memory.geometries,textures:s.renderer.info.memory.textures,dpr:s.renderer.getPixelRatio()};})()`);
  const oldShot=await call('Page.captureScreenshot',{format:'png'});
  await writeFile(resolve(appRoot,'public/office-art/studio-29/floor02-before.png'),Buffer.from(oldShot.data,'base64'));
  await writeFile(resolve(appRoot,'public/office-art/studio-29/floor02-before-metrics.json'),JSON.stringify(oldMetrics,null,2));
  console.log('BEFORE FLOOR02',oldMetrics);

} finally {
  ws?.close();
  browser?.kill();
  await server.close();
}
