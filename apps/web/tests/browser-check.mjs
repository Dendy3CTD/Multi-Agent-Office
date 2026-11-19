import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';

const root = new URL('..', import.meta.url).pathname;
const screenshotPath = join(root, 'screenshots', 'mao-hybrid-fixture.png');
const profile = await mkdtemp(join(tmpdir(), 'mao-hybrid-chromium-'));
let vite;
let chromium;
let socket;
let nextId = 0;
const pending = new Map();
const browserErrors = [];
const networkFailures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`BROWSER_ACCEPTANCE_FAILED: ${message}`);
  console.log(`PASS ${message}`);
}

async function waitFor(url, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await delay(250);
  }
  const diagnostic = await evaluate("JSON.stringify({status: document.querySelector('[data-scene-status]')?.dataset.sceneStatus, loading: document.querySelector('[data-scene-status]')?.innerText, canvas: document.querySelector('canvas')?.getBoundingClientRect().toJSON(), artError: document.querySelector('.office-scene-3d-mount')?.dataset.artLoadError, webgl: Boolean(document.querySelector('canvas')?.getContext('webgl2'))})").catch(() => 'unavailable');
  throw new Error(`Timed out waiting for ${label}; browser state: ${diagnostic}`);
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15_000);
    pending.set(id, { resolve, reject, timeout, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Browser evaluation failed');
  return result.result?.value;
}

async function waitForExpression(expression, label) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await delay(250);
  }
  const diagnostic = await evaluate("JSON.stringify({status: document.querySelector('[data-scene-status]')?.dataset.sceneStatus, message: document.querySelector('[data-scene-status]')?.innerText, mounts: [...document.querySelectorAll('[data-scene-status]')].map(x=>x.outerHTML), canvas: [...document.querySelectorAll('canvas')].map(x=>({width:x.width,height:x.height,rect:x.getBoundingClientRect().toJSON(),webgl:Boolean(x.getContext('webgl2'))})), artError: document.querySelector('[data-art-load-error]')?.dataset.artLoadError, artResources: performance.getEntriesByType('resource').filter(x=>/office-art/.test(x.name)).map(x=>({name:x.name,duration:x.duration,bytes:x.transferSize}))})").catch(() => 'unavailable');
  throw new Error(`Timed out waiting for ${label}; browser state: ${diagnostic}; request failures: ${JSON.stringify(networkFailures)}`);
}

try {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, CI: '1' },
  });
  await waitFor('http://127.0.0.1:3333/', 'Vite dev server');

  const debugPort = await reservePort();
  chromium = spawn('/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
    '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars', '--window-size=1440,1000',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`,
    '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  const version = await (await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 'Chromium CDP')).json();
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?http://127.0.0.1:3333/`, { method: 'PUT' }).then(response => response.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text);
    if (message.method === 'Network.loadingFailed') networkFailures.push({ requestId: message.params.requestId, error: message.params.errorText, blocked: message.params.blockedReason });
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
    else entry.resolve(message.result);
  });

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await cdp('Page.bringToFront');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:3333/' });
  await waitForExpression("Boolean(document.querySelector('.mao-office-ui') && document.querySelector('.task-desk'))", 'MAO office and task panel mount');

  const offline = await evaluate(`JSON.stringify({
    count: document.querySelector('.mao-office-ui')?.dataset.employeeCount,
    floorCount: document.querySelector('.mao-office-ui')?.dataset.floorCount,
    error: document.querySelector('[role=alert]')?.innerText,
    rows: document.querySelectorAll('.mao-employee-row').length,
    runtime: document.querySelector('.mao-hud-metrics')?.innerText,
    apiRequests: performance.getEntriesByType('resource').map(x => x.name).filter(x => new URL(x).pathname.startsWith('/mao-api/')),
  })`);
  const offlineState = JSON.parse(offline);
  assert(offlineState.count === '0' && offlineState.rows === 0, 'unconnected backend shows no fixture employees');
  assert(offlineState.floorCount === '15' && !/contract.*pending|bootstrap/i.test(offlineState.error ?? ''), 'offline state does not show the obsolete bootstrap error');
  assert(offlineState.apiRequests.some(url => new URL(url).pathname === '/mao-api/api/employees'), 'office probes the documented Hybrid API through the Vite proxy');

  await evaluate("document.querySelector('.mao-mode-switch').click()");
  await waitForExpression("Boolean(document.querySelector('.mao-office-ui[data-connection=demo][data-employee-count=\\\"113\\\"]'))", 'explicit fixture with 113 employees');
  await waitForExpression("Boolean(document.querySelector('.mao-scene-viewport canvas'))", '3D renderer canvas');
  await waitForExpression("document.querySelector('.office-scene-3d-mount')?.dataset.sceneStatus === 'ready'", '3D renderer to finish loading');
  const fixture = JSON.parse(await evaluate(`JSON.stringify({
    count: document.querySelector('.mao-office-ui')?.dataset.employeeCount,
    floorCount: document.querySelector('.mao-office-ui')?.dataset.floorCount,
    renderer: document.querySelector('.mao-office-ui')?.dataset.sceneRenderer,
    fixtureLabel: document.querySelector('.mao-bottom-strip')?.innerText,
    canvas: Boolean(document.querySelector('.mao-scene-viewport canvas')),
    sceneStatus: document.querySelector('.office-scene-3d-mount')?.dataset.sceneStatus,
  })`));
  assert(fixture.count === '113' && fixture.floorCount === '15', 'fixture contains 113 staff across the preserved 15-floor model');
  assert(fixture.renderer === 'three' && fixture.canvas && fixture.sceneStatus === 'ready', 'department floor renders through the ready Three.js office scene');
  assert(/DEVELOPMENT FIXTURE/.test(fixture.fixtureLabel), 'fixture state is visibly marked as development data');

  await evaluate("document.querySelector('.mao-elevator-handle').click()");
  await waitForExpression("Boolean(document.querySelector('.mao-floor-menu'))", 'floor selector');
  assert(await evaluate("[...document.querySelectorAll('.mao-floor-row[data-floor-id]')].filter(row => /^floor-(?:0[1-9]|1[0-2])$/.test(row.dataset.floorId)).length === 12"), 'office directory exposes twelve department floors plus special floors');
  await evaluate("document.querySelector('[data-floor-id=\\\"floor-12\\\"]').click()");
  await waitForExpression("document.querySelector('.mao-office-ui')?.dataset.activeFloor === 'floor-12'", 'department floor navigation');
  await waitForExpression("document.querySelector('.office-scene-3d-mount')?.dataset.sceneStatus === 'ready'", 'selected department floor scene');
  assert(await evaluate("document.querySelector('.mao-office-ui')?.dataset.sceneRenderer === 'three'"), 'floor selection switches to the 3D department floor');
  await evaluate("document.querySelector('.mao-employee-row')?.click()");
  await waitForExpression("Boolean(document.querySelector('.mao-employee-panel'))", 'employee selection panel');
  assert(await evaluate("Boolean(document.querySelector('.mao-employee-row.is-selected'))"), 'staff selection opens the corresponding employee profile');
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");

  await evaluate("document.querySelector('.mao-director-open').click()");
  await waitForExpression("Boolean(document.querySelector('.mao-director-panel'))", 'Director panel');
  const director = await evaluate("document.querySelector('.mao-director-panel').innerText");
  assert(director.includes('Чат и задачи Director'), 'Director task workspace is reachable from the office');
  assert(director.includes('Development fixture: отправка отключена.'), 'fixture task submission is explicitly disabled');
  await evaluate("document.querySelector('.mao-composer-launcher > button').click()");
  await waitForExpression("Boolean(document.querySelector('.mao-task-composer'))", 'Director task composer');
  assert(await evaluate("document.querySelector('.mao-task-composer .mao-composer-launch')?.disabled === true"), 'task preview and submission action remains disabled without live backend');
  await evaluate("document.querySelector('[aria-label=\\\"Закрыть подготовку задания\\\"]').click()");
  assert(!browserErrors.length, `browser has no uncaught exceptions${browserErrors.length ? `: ${browserErrors.join('; ')}` : ''}`);

  await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then(result => writeFile(screenshotPath, Buffer.from(result.data, 'base64')));
  console.log(`SCREENSHOT ${screenshotPath}`);
  console.log(`CHROMIUM ${version.Browser}`);
} finally {
  try { socket?.close(); } catch {}
  for (const child of [vite, chromium]) {
    if (child && child.exitCode === null) child.kill('SIGTERM');
  }
  await delay(300);
  await rm(profile, { recursive: true, force: true });
}
