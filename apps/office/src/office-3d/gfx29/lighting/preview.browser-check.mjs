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
const server = await createServer({ root: appRoot, configFile: false, cacheDir: resolve(profile,'vite-cache'),
 plugins: [{ name:'lighting-preview', configureServer(s) { s.middlewares.use('/__lighting', async (_req,res,next) => {
 try { res.setHeader('Content-Type','text/html'); res.end(await s.transformIndexHtml('/__lighting', '<!doctype html><html><head><style>body{margin:0;background:#30363c}canvas{display:block}</style></head><body><script type="module" src="/src/office-3d/gfx29/lighting/preview.ts"></script></body></html>')); } catch(e) {next(e);}
 }); } }], server:{host:'127.0.0.1',port:0} });
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
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:960,deviceScaleFactor:1,mobile:false});
  const results=[];
  for (const iteration of [1,2]) {
    await call('Page.navigate',{url:`${origin}/__lighting?iteration=${iteration}`});
    await waitFor('document.documentElement.dataset.ready === "true"');
    const metrics=await evaluate('lightingPreview.metrics');
    assert.equal(metrics.framed,true); assert.equal(metrics.shadowFramed,true); assert.equal(metrics.sourceIntact,true); assert.equal(metrics.shadowCasters,1);
    assert.ok(metrics.pixels.whiteClipFraction < .005); assert.ok(metrics.pixels.blackFraction < .02);
    assert.ok(metrics.drawCalls<300);
    const image=await call('Page.captureScreenshot',{format:'png'});
    await mkdir(resolve(here,'screenshots'),{recursive:true});
    await writeFile(resolve(here,`screenshots/iteration-${iteration}.png`),Buffer.from(image.data,'base64'));
    results.push(metrics);
  }
  const lifecycle=await evaluate(`(() => {
    const p=lightingPreview, original=p.renderer.info.render.frame;
    p.cleanup();p.cleanup();p.render();
    return {lights:p.floorRoot.getObjectByName('premium-lighting-v29')===undefined,
      toneMapping:p.renderer.toneMapping, exposure:p.renderer.toneMappingExposure,
      shadowEnabled:p.renderer.shadowMap.enabled,textures:p.renderer.info.memory.textures,
      background:p.scene.background,frame:original};
  })()`);
  assert.equal(lifecycle.lights,true); assert.equal(lifecycle.toneMapping,0);
  assert.equal(lifecycle.exposure,1); assert.equal(lifecycle.shadowEnabled,false); assert.equal(lifecycle.background,null);
  const frame=await evaluate('lightingPreview.renderer.info.render.frame');
  await new Promise(r=>setTimeout(r,300));
  assert.equal(await evaluate('lightingPreview.renderer.info.render.frame'),frame);
  await writeFile(resolve(here,'screenshots/metrics.json'),JSON.stringify({results,lifecycle,noPersistentLoop:true},null,2));
  console.log(JSON.stringify({results,lifecycle,noPersistentLoop:true},null,2));
} finally { ws?.close(); browser?.kill(); await server.close(); }
