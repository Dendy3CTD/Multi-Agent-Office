/** Run with node apps/office/src/integration/tower.browser-check.mjs. No added packages. */
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const profile = await mkdtemp(resolve(tmpdir(), 'mao-tower-check-'));
const sceneSource = `
import { useEffect } from 'react';
import './office-scene-3d.css';
export default function OfficeScene3D(props) {
  window.__towerScene = props;
  useEffect(() => {
    window.__towerMounts = (window.__towerMounts || 0) + 1;
    return () => { window.__towerUnmounts = (window.__towerUnmounts || 0) + 1; };
  }, []);
  return <section className="office-scene-3d" aria-label="3D showroom: floor 2">
    <div className="office-scene-3d-heading"><div><span>3D SHOWROOM · FLOOR 02</span><h1>Руководство и управление проектами</h1></div></div>
    <div className="office-scene-3d-mount"><canvas /></div>
  </section>;
}`;
const server = await createServer({
  root: appRoot, configFile: false, cacheDir: resolve(profile, 'vite-cache'),
  plugins: [{ name: 'tower-test-scene', enforce: 'pre',
    load(id) { if (id.split('?')[0] === resolve(appRoot, 'src/office-3d/OfficeScene3D.tsx')) return sceneSource; },
    configureServer(server) {
      server.middlewares.use('/__tower_check', async (_req, res, next) => {
        try {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/__tower_check', '<!doctype html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0d12;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/src/integration/tower.browser-fixture.tsx"></script></body></html>'));
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
  browser = spawn('chromium', ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  await call('Page.navigate', { url: `${origin}/?debug=1` });
  await waitFor('!!document.querySelector(".mao-office-ui")');
  assert.equal(await evaluate('document.querySelector("#root").dataset.startupRoute'), 'tower');
  assert.equal(await evaluate('!!document.querySelector(".office-root")'), false);
  assert.equal(await evaluate('window.__MAO_STARTUP_TRACE__.some(e => e.stage === "startup-route" && e.detail.mode === "tower")'), true);
  console.log('PASS actual / startup route, no legacy tree, opt-in diagnostics');
  await call('Page.navigate', { url: `${origin}/__tower_check` });
  await waitFor('!!document.body.dataset.checks');
  const outcome = await evaluate('({checks: window.__towerChecks, error: window.__towerError})');
  if (outcome.error) throw new Error(outcome.error);
  for (const check of outcome.checks) console.log(`PASS ${check}`);
  for (const [width, height] of [[1366, 768], [1920, 1080], [390, 844], [720, 768]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const layout = await evaluate(`(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; };
      const title = box('.mao-floor-plaque'), elevator = box('.mao-elevator-handle');
      return { title, elevator, headingHidden: getComputedStyle(document.querySelector('.office-scene-3d-heading')).display === 'none', hudHeight: document.querySelector('.mao-hud').getBoundingClientRect().height };
    })()`);
    assert.ok(layout.title.right <= layout.elevator.left || layout.title.bottom <= layout.elevator.top || layout.elevator.bottom <= layout.title.top, JSON.stringify(layout));
    assert.ok(layout.headingHidden);
    assert.ok(layout.hudHeight <= 74);
    console.log(`PASS title/elevator separation and compact HUD ${width}x${height}`);
  }
  console.log(`Browser checks passed (${outcome.checks.length + 5}). Scene is instrumented; physical WebGL interaction is outside this test.`);
} finally {
  ws?.close();
  browser?.kill();
  await server.close();
}
