import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import net from 'node:net'

const projectRoot = process.env.MAO_HYBRID_ROOT ?? new URL('../../../../../../', import.meta.url).pathname
const webRoot = join(projectRoot, 'apps/web')
const screenshotRoot = process.env.MAO_OFFICE_V4_SCREENSHOTS ?? join(tmpdir(), 'mao-office-v4-floors-01-04')
const profile = await mkdtemp(join(tmpdir(), 'mao-office-v4-chromium-'))
await mkdir(screenshotRoot, { recursive: true })
const appPort = await reservePort()
const debugPort = await reservePort()
const appUrl = `http://127.0.0.1:${appPort}`
let vite
let chromium
let socket
let nextId = 0
const pending = new Map()
const browserErrors = []
const requestedFloors = process.argv.slice(2).map(Number)
const floorsToCheck = requestedFloors.length ? requestedFloors : [1, 2, 3, 4]
assert.ok(floorsToCheck.every(floor => Number.isInteger(floor) && floor >= 1 && floor <= 4), 'floor arguments must be UI floor numbers 1–4')

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

async function waitFor(url, label) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
    } catch {}
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function cdp(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 20000)
    pending.set(id, { resolve, reject, timeout, method })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'browser evaluation failed')
  return result.result?.value
}

async function waitForExpression(expression, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    if (await evaluate('window.__OFFICE_V4_PREVIEW__?.status === "error"') && browserErrors.length) {
      await delay(100)
      const state = await evaluate('JSON.stringify({preview:window.__OFFICE_V4_PREVIEW__,root:document.querySelector("#root")?.innerHTML.slice(0,500),canvas:Boolean(document.querySelector("canvas"))})')
      throw new Error(`Renderer reported ${label} failure; browser state=${state}; browser errors=${JSON.stringify(browserErrors)}`)
    }
    await delay(250)
  }
  const state = await evaluate('JSON.stringify({preview:window.__OFFICE_V4_PREVIEW__,mount:document.querySelector(".office-scene-3d-mount")?.dataset,root:document.querySelector("#root")?.innerHTML.slice(0,500),canvas:Boolean(document.querySelector("canvas"))})').catch(() => 'unavailable')
  throw new Error(`Timed out waiting for ${label}; browser state=${state}; browser errors=${JSON.stringify(browserErrors)}`)
}

try {
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], {
    cwd: webRoot,
    stdio: 'ignore',
    env: { ...process.env, CI: '1' },
  })
  await waitFor(`${appUrl}/`, 'Vite dev server')
  chromium = spawn('/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
    '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars', '--window-size=1440,1000',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`,
    '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' })
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`, 'Chromium CDP')
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(response => response.json())
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') {
      const exception = message.params.exceptionDetails
      browserErrors.push([exception.text, exception.exception?.description, exception.exception?.value].filter(Boolean).join(': '))
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      browserErrors.push(message.params.args.map(argument => argument.value ?? argument.description ?? '').join(' '))
    }
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timeout)
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`))
    else entry.resolve(message.result)
  })
  await cdp('Page.enable')
  await cdp('Runtime.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

  for (const floor of floorsToCheck) {
    const url = `${appUrl}/src/office-3d/office-v4/floors-01-04/preview.html?floor=${floor}`
    await cdp('Page.navigate', { url })
    await waitForExpression('window.__OFFICE_V4_PREVIEW__?.status === "ready"', `floor ${floor} scene ready`)
    const state = JSON.parse(await evaluate(`JSON.stringify({
      preview: window.__OFFICE_V4_PREVIEW__,
      specialization: document.querySelector('.office-scene-3d-mount')?.dataset.floorPresetSpecialization,
      reference: document.querySelector('.office-scene-3d-mount')?.dataset.floorPresetReferenceImage,
      workplaceCount: JSON.parse(document.querySelector('.office-scene-3d-mount')?.dataset.floorPresetWorkplaceIds ?? '[]').length,
      employeeBindings: JSON.parse(document.querySelector('.office-scene-3d-mount')?.dataset.floorPresetEmployeeBindings ?? '[]').length,
      drawCalls: document.querySelector('.office-scene-3d-mount')?.dataset.previewDrawCalls,
      canvas: Boolean(document.querySelector('.office-scene-3d-mount canvas')),
    })`))
    assert.equal(state.preview.status, 'ready')
    assert.equal(state.reference, `/design-references/office-v4/floor-${String(floor).padStart(2, '0')}.png`)
    assert.ok(Number(state.drawCalls) > 0, `floor ${floor} renderer did not report draw calls`)
    assert.ok(state.canvas, `floor ${floor} has no canvas`)
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(screenshotRoot, `floor-${String(floor).padStart(2, '0')}.png`), Buffer.from(screenshot.data, 'base64'))
    console.log(`PASS browser-render floor-${String(floor).padStart(2, '0')} specialization=${state.specialization} workplaces=${state.workplaceCount} employeeBindings=${state.employeeBindings} drawCalls=${state.drawCalls}`)
  }
  assert.deepEqual(browserErrors, [], `browser exceptions: ${JSON.stringify(browserErrors)}`)
  console.log(`Screenshots: ${screenshotRoot}`)
} finally {
  socket?.close()
  if (chromium && !chromium.killed) chromium.kill('SIGTERM')
  if (vite && !vite.killed) vite.kill('SIGTERM')
  await delay(250)
  await rm(profile, { recursive: true, force: true })
}
