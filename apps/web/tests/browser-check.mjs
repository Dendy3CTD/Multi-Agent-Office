import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';

const root = new URL('..', import.meta.url).pathname;
const screenshotRoot = process.env.MAO_BROWSER_SCREENSHOT_DIR ?? join(root, 'screenshots');
const officeV4Check = process.env.MAO_BROWSER_CHECK_FLOORS === 'office-v4';
const screenshotPath = join(screenshotRoot, officeV4Check ? 'mao-hybrid-live.png' : 'mao-hybrid-fixture.png');
await mkdir(screenshotRoot, { recursive: true });
const appPort = process.env.MAO_BROWSER_PORT ? Number(process.env.MAO_BROWSER_PORT) : await reservePort();
const appUrl = `http://127.0.0.1:${appPort}`;
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
  const diagnostic = await evaluate("JSON.stringify({status: document.querySelector('[data-scene-status]')?.dataset.sceneStatus, message: document.querySelector('[data-scene-status]')?.innerText, trace:window.__MAO_STARTUP_TRACE__?.slice(-8), mounts: [...document.querySelectorAll('[data-scene-status]')].map(x=>({html:x.outerHTML,dataset:x.dataset})), canvas: [...document.querySelectorAll('canvas')].map(x=>({width:x.width,height:x.height,rect:x.getBoundingClientRect().toJSON(),webgl:Boolean(x.getContext('webgl2'))})), artError: document.querySelector('[data-art-load-error]')?.dataset.artLoadError, artResources: performance.getEntriesByType('resource').filter(x=>/office-art/.test(x.name)).map(x=>({name:x.name,duration:x.duration,bytes:x.transferSize}))})").catch(() => 'unavailable');
  throw new Error(`Timed out waiting for ${label}; browser state: ${diagnostic}; request failures: ${JSON.stringify(networkFailures)}`);
}

try {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, CI: '1' },
  });
  await waitFor(`${appUrl}/`, 'Vite dev server');

  const debugPort = await reservePort();
  chromium = spawn('/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
    '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars', '--window-size=1440,1000',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`,
    '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  const version = await (await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 'Chromium CDP')).json();
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?${appUrl}/?debug=1`, { method: 'PUT' }).then(response => response.json());
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
  await cdp('Page.navigate', { url: `${appUrl}/?debug=1` });
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
  assert(offlineState.apiRequests.every(url => !/\/v1\//.test(new URL(url).pathname)), 'office never calls the legacy MAO Server routes');
  const liveApi = JSON.parse(await evaluate(`(async () => {
    const [health, status, employees, projects, tasks] = await Promise.all([
      fetch('/mao-api/health'), fetch('/mao-api/api/status'), fetch('/mao-api/api/employees'),
      fetch('/mao-api/api/projects'), fetch('/mao-api/api/tasks')
    ]);
    const [healthBody, statusBody, employeeBody, projectBody, taskBody] = await Promise.all([health.json(), status.json(), employees.json(), projects.json(), tasks.json()]);
    return JSON.stringify({ healthStatus: health.status, health: healthBody, statusCode: status.status, status: statusBody,
      employeesCode: employees.status, employeeCount: employeeBody.employees?.length ?? 0,
      projectsCode: projects.status, projectCount: projectBody.projects?.length ?? 0,
      tasksCode: tasks.status, taskCount: taskBody.tasks?.length ?? 0 });
  })()`));
  assert(liveApi.healthStatus === 200 && liveApi.health.status === 'ok' && liveApi.statusCode === 200 && liveApi.status.runtimeAvailable === true, 'browser reaches the live MAO Hybrid API through the documented local proxy');
  assert(liveApi.employeesCode === 200 && liveApi.employeeCount === 113 && liveApi.projectsCode === 200 && liveApi.tasksCode === 200, `live API supplies the 113-person directory, projects, and durable task history (${JSON.stringify({employees:liveApi.employeeCount,projects:liveApi.projectCount,tasks:liveApi.taskCount})}`);

  if (officeV4Check) {
    await waitForExpression("document.querySelector('.mao-office-ui')?.dataset.connection === 'live' && document.querySelector('.mao-office-ui')?.dataset.employeeCount === '113'", 'live directory with all 113 employees');
    await waitForExpression("Boolean(document.querySelector('.task-desk [data-api-status=connected]'))", 'Director API connection status');
    assert(await evaluate("document.querySelector('.mao-office-ui')?.dataset.employeeIdCount === '113'"), 'live MAO snapshot contains 113 unique employee identities');
  } else {
    await evaluate("document.querySelector('.mao-mode-switch').click()");
    await waitForExpression("Boolean(document.querySelector('.mao-office-ui[data-connection=demo][data-employee-count=\\\"113\\\"]'))", 'explicit fixture with 113 employees');
  }
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
  if (!officeV4Check) assert(fixture.count === '113' && fixture.floorCount === '15', 'fixture contains 113 staff across the preserved 15-floor model');
  assert(fixture.renderer === 'three' && fixture.canvas && fixture.sceneStatus === 'ready', 'department floor renders through the ready Three.js office scene');
  assert(await evaluate("getComputedStyle(document.querySelector('.mao-scene-viewport canvas')).transitionDuration === '0.24s'"), 'floor content fades in smoothly without mounting a second renderer');
  if (!officeV4Check) assert(/DEVELOPMENT FIXTURE/.test(fixture.fixtureLabel), 'fixture state is visibly marked as development data');
  assert(await evaluate("document.querySelector('.office-scene-3d-mount')?.dataset.renderQuality === 'balanced'"), 'balanced rendering quality is the default profile');
  assert(await evaluate("Number(document.querySelector('.office-scene-3d-mount')?.dataset.floorPresetMaterialRoleCount) > 0 && Boolean(document.querySelector('.office-scene-3d-mount')?.dataset.floorPresetCamera)"), 'real scene applies preset material roles and camera settings');
  const officeV4Map = JSON.parse(await evaluate(`(async () => {
    const { OFFICE_V4_FLOOR_REFERENCES, officeV4ToWorldFloorId, worldToOfficeV4FloorId } = await import('/src/office-3d/office-v4/floor-id-adapter.ts');
    return JSON.stringify({ count: OFFICE_V4_FLOOR_REFERENCES.length, first: officeV4ToWorldFloorId('floor-00'), last: officeV4ToWorldFloorId('floor-14'), logical: worldToOfficeV4FloorId('floor-15'), refs: OFFICE_V4_FLOOR_REFERENCES.map(item => item.referenceFile) });
  })()`));
  assert(officeV4Map.count === 15 && officeV4Map.first === 'floor-1' && officeV4Map.last === 'floor-15' && officeV4Map.logical === 'floor-14' && new Set(officeV4Map.refs).size === 15, 'Office V4 logical IDs and all fifteen references map onto the current MAO floor routes');

  const presetGeometry = JSON.parse(await evaluate(`(async () => {
    const [{ FLOOR_PRESET_GEOMETRY_FIXTURES, rasterizeFloorPresetFixture }, { validateFloorDesignPreset }] = await Promise.all([
      import('/src/office-3d/floor-presets/fixtures.ts'),
      import('/src/office-3d/floor-presets/validate.ts'),
    ]);
    const result = await Promise.all(FLOOR_PRESET_GEOMETRY_FIXTURES.map(async preset => {
      const rendered = await rasterizeFloorPresetFixture(preset);
      const result = { id: preset.presetId, fixtureOnly: preset.presetId.startsWith('fixture:'), elements: rendered.elementCounts,
        bounds: preset.bounds, meshes: rendered.meshCount, boundsValid: rendered.bounds.min[0] >= -preset.bounds.width/2-.2 && rendered.bounds.max[0] <= preset.bounds.width/2+.2 && rendered.bounds.min[2] >= -preset.bounds.depth/2-.2 && rendered.bounds.max[2] <= preset.bounds.depth/2+.2,
        openings: rendered.openings, camera: rendered.camera, lighting: rendered.lighting,
        specialization: rendered.specialization, referenceImage: rendered.referenceImage, localLights: rendered.localLights,
        workplaceProfiles: rendered.workplaceProfiles, interactions: rendered.interactions,
        placementCounts: rendered.placementCounts, textureUrls: rendered.textureUrls, textureFailures: rendered.textureFailures,
        drawCalls: rendered.drawCalls, validationIssues: validateFloorDesignPreset(preset) };
      return result;
    }));
    return JSON.stringify(result);
  })()`));
  assert(presetGeometry.length === 2 && presetGeometry.every(item => item.fixtureOnly && item.meshes >= 12 && item.drawCalls > 0), 'temporary browser fixtures build and rasterize complete geometric preset layers');
  assert(presetGeometry[0].bounds.width !== presetGeometry[1].bounds.width && presetGeometry.every(item => Object.values(item.elements).every(count => count > 0) && item.boundsValid && item.validationIssues.length === 0), `fixture geometries differ, stay in bounds, and pass geometry validation: ${JSON.stringify(presetGeometry.map(item => ({id:item.id,boundsValid:item.boundsValid,issues:item.validationIssues})))}`);
  assert(presetGeometry.every(item => item.openings.windows.length && item.openings.entrances.length && item.camera.position.length === 3 && item.lighting.exposure > 0 && item.placementCounts.furniture > 0 && item.placementCounts.decor > 0 && item.placementCounts.workplaces > 0 && item.textureUrls.length > 0 && item.textureFailures.length === 0), 'window, doorway, camera, lighting, shared textures, materials and placement fields bind to the fixture renderer');
  assert(presetGeometry[0].specialization === 'v4-contract-probe' && presetGeometry[0].referenceImage === '/design-references/office-v4/floor-01.png' && presetGeometry[0].localLights.length === 1, `V4 specialization, review-only reference metadata and local light fixture fields reach the shared scene geometry: ${JSON.stringify({specialization:presetGeometry[0].specialization,referenceImage:presetGeometry[0].referenceImage,localLights:presetGeometry[0].localLights})}`);
  assert(presetGeometry[0].openings.roomDoors.some(door => door.roomId === 'fixture-a-room' && door.wall === 'east' && door.width === 1.25), 'custom room door is rendered on its authored wall with its clear width');
  assert(presetGeometry[0].workplaceProfiles[0].kind === 'lab' && presetGeometry[0].workplaceProfiles[0].equipment[0] === 'equipment.oscilloscope' && presetGeometry[0].interactions[0].kind === 'display', 'workstation type, assigned equipment and interactive placement fields are preserved');
  const specialistAssets = JSON.parse(await evaluate(`(async () => {
    const { rasterizeProceduralAssetFixtures } = await import('/src/office-3d/floor-presets/fixtures.ts');
    return JSON.stringify(await rasterizeProceduralAssetFixtures());
  })()`));
  assert(specialistAssets.assets.length >= 26 && specialistAssets.assets.some(asset => asset.id === 'equipment.refrigerator') && specialistAssets.assets.every(asset => asset.meshCount >= 2 && asset.triangles > 20 && asset.bounds.every(value => value > 0)), `shared specialist assets, including the cafe refrigerator, are assembled models with valid bounds: ${JSON.stringify(specialistAssets.assets.filter(asset => asset.meshCount < 2 || asset.triangles <= 20 || asset.bounds.some(value => value <= 0)))}`);
  assert(specialistAssets.drawCalls <= specialistAssets.assets.length * 10 && specialistAssets.triangleCount > 1000 && specialistAssets.nonBackgroundPixels > 1000, 'specialist asset library rasterizes visibly with bounded draw calls');
  console.log(`SPECIALIST ASSETS ${specialistAssets.assets.length} DRAW CALLS ${specialistAssets.drawCalls} TRIANGLES ${specialistAssets.triangleCount}`);
  for (const item of presetGeometry) console.log(`PRESET FIXTURE ${item.id} DRAW CALLS ${item.drawCalls}`);

  await evaluate("document.querySelector('.mao-elevator-handle').click()");
  await waitForExpression("Boolean(document.querySelector('.mao-floor-menu'))", 'floor selector');
  assert(await evaluate("[...document.querySelectorAll('.mao-floor-row[data-floor-id]')].filter(row => /^floor-(?:0[1-9]|1[0-2])$/.test(row.dataset.floorId)).length === 12"), 'office directory exposes twelve department floors plus special floors');
  await evaluate("document.querySelector('[data-floor-id=\\\"floor-12\\\"]').click()");
  await waitForExpression("document.querySelector('.mao-office-ui')?.dataset.activeFloor === 'floor-12'", 'department floor navigation');
  await waitForExpression("document.querySelector('.office-scene-3d-mount')?.dataset.sceneStatus === 'ready'", 'selected department floor scene');
  assert(await evaluate("document.querySelector('.mao-office-ui')?.dataset.sceneRenderer === 'three'"), 'floor selection switches to the 3D department floor');
  await evaluate("document.querySelector('.mao-elevator-handle').click()");
  const allFloorIds = ['floor-00', ...Array.from({length: 12}, (_,i)=>`floor-${String(i+1).padStart(2,'0')}`), 'floor-14', 'floor-15'];
  // Keep the browser captures useful for visual review. TaskDesk is a fixed
  // product overlay outside the Three.js canvas; API/Director checks still run
  // before and after floor capture in this same browser session.
  if (officeV4Check) await evaluate("(() => { const taskDesk=document.querySelector('.task-desk'); if(taskDesk) taskDesk.style.visibility='hidden'; return true; })()");
  const floorIds = process.env.MAO_BROWSER_CHECK_FLOORS === 'group-01-03' ? ['floor-01', 'floor-02', 'floor-03'] : allFloorIds;
  const screenshotFloors = officeV4Check
    ? new Map(allFloorIds.map(floorId => {
      const routeNumber = Number(floorId.replace('floor-', ''));
      const referenceNumber = routeNumber <= 12 ? routeNumber + 1 : routeNumber;
      return [floorId, `floor-${String(referenceNumber).padStart(2, '0')}.png`];
    }))
    : new Map([['floor-00','floor-01.png'],['floor-01','floor-01-integrated.png'],['floor-02','floor-02-integrated.png'],['floor-03','floor-03-integrated.png'],['floor-04','floor-05.png'],['floor-09','floor-10.png'],['floor-15','floor-15.png']]);
  for (const floorId of floorIds) {
    await evaluate(`document.querySelector('[data-floor-id=\\\"${floorId}\\\"]').click()`);
    await waitForExpression(`document.querySelector('.mao-office-ui')?.dataset.activeFloor === '${floorId}'`, `${floorId} navigation`);
    assert(await evaluate("document.querySelector('.mao-office-ui')?.dataset.sceneRenderer === 'three'"), `${floorId} uses the shared 3D showroom profile`);
    await waitForExpression("document.querySelectorAll('.mao-scene-viewport canvas').length === 1", `${floorId} single active viewport transition`);
    assert(await evaluate("document.querySelectorAll('.mao-scene-viewport canvas').length === 1"), `${floorId} keeps a single active Three.js viewport`);
    const isIntegrated = officeV4Check || ['floor-01', 'floor-02', 'floor-03'].includes(floorId);
    assert(await evaluate(`document.querySelector('.mao-scene-viewport')?.dataset.floorPresetStatus === '${isIntegrated ? 'authored' : 'fallback'}'`), `${floorId} reports authored or missing preset status honestly`);
    await waitForExpression("document.querySelector('.office-scene-3d-mount')?.dataset.sceneStatus === 'ready'", `${floorId} scene ready`);
    if (officeV4Check && floorId === 'floor-01') {
      const initialZoom = Number(await evaluate("document.querySelector('.office-scene-3d-mount')?.dataset.cameraZoom"));
      await evaluate("document.querySelector('.mao-camera-hud button[title=\\\"Увеличить масштаб\\\"]').click()");
      await waitForExpression(`Number(document.querySelector('.office-scene-3d-mount')?.dataset.cameraZoom) > ${initialZoom}`, 'camera zoom control');
      await evaluate("document.querySelector('.mao-camera-hud button[title=\\\"Показать весь этаж\\\"]').click()");
      await waitForExpression(`Math.abs(Number(document.querySelector('.office-scene-3d-mount')?.dataset.cameraZoom) - ${initialZoom}) < 0.001`, 'camera fit control');
      const cameraStart = JSON.parse(await evaluate("document.querySelector('.office-scene-3d-mount')?.dataset.cameraTarget"));
      const rect = JSON.parse(await evaluate("JSON.stringify(document.querySelector('.mao-scene-viewport canvas').getBoundingClientRect().toJSON())"));
      const x = Math.round(rect.left + rect.width * .48), y = Math.round(rect.top + rect.height * .52);
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 70, y: y + 26, button: 'left', buttons: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 70, y: y + 26, button: 'left', buttons: 0 });
      await waitForExpression(`JSON.stringify(JSON.parse(document.querySelector('.office-scene-3d-mount')?.dataset.cameraTarget ?? '[]')) !== ${JSON.stringify(JSON.stringify(cameraStart))}`, 'camera drag pan');
      await evaluate("document.querySelector('.mao-camera-hud button[title=\\\"Показать весь этаж\\\"]').click()");
      await waitForExpression(`JSON.stringify(JSON.parse(document.querySelector('.office-scene-3d-mount')?.dataset.cameraTarget ?? '[]')) === ${JSON.stringify(JSON.stringify(cameraStart))}`, 'camera fit after pan');
      assert(true, 'camera zoom, fit, and drag-pan controls change and restore the live scene camera');
    }
    if (officeV4Check) {
      const audit = JSON.parse(await evaluate(`(async () => {
        const { resolveFloorDesignPreset } = await import('/src/office-3d/floor-presets/index.ts');
        const mount = document.querySelector('.office-scene-3d-mount');
        const routeNumber = Number('${floorId}'.replace('floor-', ''));
        const worldFloorId = routeNumber <= 12 ? 'floor-' + (routeNumber + 1) : '${floorId}';
        const preset = resolveFloorDesignPreset(worldFloorId).preset;
        return JSON.stringify({
          id: preset.presetId, specialization: preset.specialization,
          referenceImage: preset.referenceImage,
          expectedPlacementIds: [...preset.furniture, ...preset.decor].map(item => item.id),
          status: document.querySelector('.mao-scene-viewport')?.dataset.floorPresetStatus,
          geometry: JSON.parse(mount.dataset.floorPresetGeometry ?? '{}'),
          cutawayWalls: JSON.parse(mount.dataset.floorPresetCutawayWalls ?? '[]'),
          windowAudit: JSON.parse(mount.dataset.floorPresetWindowAudit ?? '{}'),
          renderedPlacementIds: JSON.parse(mount.dataset.floorPresetRenderedPlacementIds ?? '[]'),
          expectedDesks: preset.workplaces.length,
          desks: JSON.parse(mount.dataset.floorPresetWorkplaceIds ?? '[]'),
          rendered: JSON.parse(mount.dataset.renderedEmployeeIds ?? '[]'),
          renderedBindings: JSON.parse(mount.dataset.renderedEmployeeDeskBindings ?? '[]'),
          bindings: JSON.parse(mount.dataset.floorPresetEmployeeBindings ?? '[]'),
          bindingsMatchRoster: mount.dataset.floorPresetBindingsMatchRoster === 'true',
          employeeRows: document.querySelectorAll('.mao-employee-row').length,
          sceneStatus: mount.dataset.sceneStatus,
          drawCalls: mount.dataset.drawCalls, triangles: mount.dataset.triangles, dpr: mount.dataset.dpr,
          rendererError: mount.dataset.artLoadError ?? mount.dataset.floorLayoutError ?? ''
        });
      })()`));
      const refNumber = Number(screenshotFloors.get(floorId).slice(6, 8));
      assert(audit.status === 'authored' && audit.id.startsWith('office-v4-'), `${floorId} uses its registered Office V4 preset (${audit.id})`);
      assert(audit.referenceImage === `/design-references/office-v4/floor-${String(refNumber).padStart(2, '0')}.png`, `${floorId} resolves to its approved reference image metadata`);
      assert(audit.sceneStatus === 'ready' && !audit.rendererError, `${floorId} renders without layout, WebGL asset, or scene errors`);
      assert(audit.rendered.length === audit.employeeRows && new Set(audit.rendered).size === audit.rendered.length, `${floorId} renders each directory employee once (${audit.rendered.length})`);
      assert(audit.renderedBindings.length === audit.employeeRows && new Set(audit.renderedBindings.map(binding => binding.employeeId)).size === audit.renderedBindings.length && audit.renderedBindings.every(binding => audit.desks.includes(binding.deskId)), `${floorId} preserves unique directory employee and desk assignments`);
      if (audit.bindingsMatchRoster) assert(audit.bindings.every(binding => audit.renderedBindings.some(actual => actual.employeeId === binding.employeeId && actual.deskId === binding.deskId)), `${floorId} matches authored employee bindings to the active directory`);
      assert(audit.desks.length === audit.expectedDesks && new Set(audit.desks).size === audit.desks.length, `${floorId} has unique registered desk slots (${audit.desks.length})`);
      assert(Object.values(audit.geometry).some(value => value > 0), `${floorId} displays actual preset geometry (${JSON.stringify(audit.geometry)})`);
      const camera = JSON.parse(await evaluate(`(async () => { const { resolveFloorDesignPreset } = await import('/src/office-3d/floor-presets/index.ts'); const routeNumber=Number('${floorId}'.replace('floor-','')); const worldFloorId=routeNumber<=12?'floor-'+(routeNumber+1):'${floorId}'; return JSON.stringify(resolveFloorDesignPreset(worldFloorId).preset.camera); })()`));
      const cameraDx = camera.position[0] - camera.target[0], cameraDz = camera.position[2] - camera.target[2];
      const expectedCutaway = [Math.abs(cameraDx) > 0.25 ? (cameraDx > 0 ? 'east' : 'west') : undefined, Math.abs(cameraDz) > 0.25 ? (cameraDz > 0 ? 'north' : 'south') : undefined].filter(Boolean).sort();
      assert(JSON.stringify([...audit.cutawayWalls].sort()) === JSON.stringify(expectedCutaway), `${floorId} omits only camera-facing exterior walls (${audit.cutawayWalls.join(',')})`);
      assert(audit.windowAudit.count > 0 && audit.windowAudit.clearGlass === true && audit.windowAudit.cityOutside === true, `${floorId} has clear windows with exterior city geometry (${JSON.stringify(audit.windowAudit)})`);
      assert(audit.expectedPlacementIds.every(id => audit.renderedPlacementIds.includes(id)), `${floorId} renders all authored furniture and decor placements (${audit.renderedPlacementIds.length}/${audit.expectedPlacementIds.length})`);
      console.log(`OFFICE V4 FLOOR ${String(refNumber).padStart(2, '0')} ${JSON.stringify({specialization:audit.specialization,employees:audit.rendered.length,desks:audit.desks.length,geometry:audit.geometry,drawCalls:audit.drawCalls,triangles:audit.triangles,dpr:audit.dpr})}`);
    } else if (isIntegrated) {
      const expectedEmployees = { 'floor-01': 11, 'floor-02': 10, 'floor-03': 9 }[floorId];
      const audit = JSON.parse(await evaluate(`(async () => {
        const [{ FLOOR_DESIGN_PRESETS }, { resolveFloorDesignPreset }] = await Promise.all([
          import('/src/office-3d/floor-presets/group-01-03/index.ts'),
          import('/src/office-3d/floor-presets/index.ts'),
        ]);
        const source = FLOOR_DESIGN_PRESETS.find(preset => preset.floor.uiFloorId === '${floorId}');
        const resolved = resolveFloorDesignPreset(source.floor.worldFloorId);
        const mount = document.querySelector('.office-scene-3d-mount');
        return JSON.stringify({
          id: resolved.preset.presetId,
          status: resolved.status,
          geometry: JSON.parse(mount.dataset.floorPresetGeometry ?? '{}'),
          workplaces: JSON.parse(mount.dataset.floorPresetWorkplaceIds ?? '[]'),
          renderedEmployees: JSON.parse(mount.dataset.renderedEmployeeIds ?? '[]'),
          sourceEmployees: source.roster.employeeIds,
          sourceDesks: source.roster.deskIds,
          visibleRows: document.querySelectorAll('.mao-employee-row').length,
          rendererEmployees: mount.dataset.employeeCount,
        });
      })()`));
      assert(audit.status === 'authored' && audit.id.startsWith(floorId), `${floorId} resolves its authored preset without fallback`);
      assert(audit.visibleRows === expectedEmployees && audit.renderedEmployees.length === expectedEmployees && new Set(audit.renderedEmployees).size === expectedEmployees, `${floorId} renders the full employee roster exactly once`);
      assert(JSON.stringify([...audit.renderedEmployees].sort()) === JSON.stringify([...audit.sourceEmployees].sort()), `${floorId} retains authored employee IDs in the 3D scene`);
      assert(JSON.stringify(audit.workplaces) === JSON.stringify(audit.sourceDesks), `${floorId} retains occupied and reserved desk IDs`);
      assert(audit.geometry.rooms > 0 && audit.geometry.windows === 2 && audit.geometry.entrances === 1 && audit.geometry.aisles > 0, `${floorId} displays authored rooms, windows, entrance and aisles`);
      assert(floorId === 'floor-01' ? audit.geometry.barriers > 0 : audit.geometry.barriers === 0, `${floorId} displays the authored partition count`);
    }
    if (screenshotFloors.has(floorId)) {
      await delay(300);
      const name = screenshotFloors.get(floorId);
      const outputName = officeV4Check ? name : name.endsWith('-integrated.png') ? name : `unified-${name}`;
      await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).then(result => writeFile(join(screenshotRoot, outputName), Buffer.from(result.data, 'base64')));
      if (floorId === 'floor-01') {
        const runtimeMetrics = await evaluate("JSON.stringify(Object.fromEntries(['drawCalls','triangles','dpr','frameActivity'].map(key => [key, document.querySelector('.office-scene-3d-mount')?.dataset[key]])))");
        console.log(`FLOOR 02 RUNTIME ${runtimeMetrics}`);
      }
    }
    if (floorId !== floorIds.at(-1)) await evaluate("document.querySelector('.mao-elevator-handle').click()");
  }
  if (officeV4Check) await evaluate("(() => { const taskDesk=document.querySelector('.task-desk'); if(taskDesk) taskDesk.style.removeProperty('visibility'); return true; })()");
  assert(await evaluate("document.querySelector('.mao-office-ui')?.dataset.employeeCount === '113' && document.querySelector('.mao-office-ui')?.dataset.employeeIdCount === '113'"), 'office retains 113 unique employee IDs across floor switches');
  await evaluate("document.querySelector('.mao-elevator-handle').click()");
  await evaluate("document.querySelector('[data-floor-id=\\\"floor-01\\\"]').click()");
  await waitForExpression("document.querySelector('.mao-office-ui')?.dataset.activeFloor === 'floor-01'", 'return to an occupied floor');
  await evaluate("document.querySelector('.mao-employee-row')?.click()");
  await waitForExpression("Boolean(document.querySelector('.mao-employee-panel'))", 'employee selection panel');
  assert(await evaluate("Boolean(document.querySelector('.mao-employee-row.is-selected'))"), 'staff selection opens the corresponding employee profile');
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");

  await evaluate("document.querySelector('.mao-director-open').click()");
  await waitForExpression("Boolean(document.querySelector('.mao-director-panel'))", 'Director panel');
  const director = await evaluate("document.querySelector('.mao-director-panel').innerText");
  assert(director.includes('Чат и задачи Director'), 'Director task workspace is reachable from the office');
  if (officeV4Check) {
    assert(director.includes('MAO · LIVE') && await evaluate("document.querySelectorAll('.mao-director-task').length > 0"), 'Director shows the live connection and persisted Task Store history');
    assert(await evaluate("document.querySelector('.task-desk [data-api-status=connected]') && document.querySelectorAll('.task-history article').length > 0"), 'Director task desk reads registered projects and durable task history from the API');
  } else {
    assert(director.includes('Development fixture: отправка отключена.'), 'fixture task submission is explicitly disabled');
  }
  await evaluate("document.querySelector('.mao-composer-launcher > button').click()");
  await waitForExpression("Boolean(document.querySelector('.mao-task-composer'))", 'Director task composer');
  if (!officeV4Check) assert(await evaluate("document.querySelector('.mao-task-composer .mao-composer-launch')?.disabled === true"), 'task preview and submission action remains disabled without live backend');
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
