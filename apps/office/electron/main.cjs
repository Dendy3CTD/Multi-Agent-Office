const { app, BrowserWindow, shell, session, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { createStaticServer } = require('./static-server.cjs')
const { initialContentSize, SCENE_ASPECT } = require('./window-layout.cjs')

const APP_ID = 'open-agent-office'
const isDev = process.argv.includes('--dev')
const officeRoot = path.resolve(__dirname, '..')
const distRoot = path.join(officeRoot, 'dist')
const iconPath = path.join(officeRoot, 'assets', 'open-agent-office.png')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow = null
  let staticServer = null
  let localOrigin = null
  let logFile = null
  let shuttingDown = false

  app.setAppUserModelId(APP_ID)

  function log(message, error) {
    const line = `[${new Date().toISOString()}] ${message}${error ? ` ${error.stack || error}` : ''}\n`
    console.log(line.trimEnd())
    if (logFile) {
      try { fs.appendFileSync(logFile, line) } catch { /* logging must not crash the app */ }
    }
  }

  function openExternal(url) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') shell.openExternal(url)
    } catch (error) { log(`Ignored unsupported external URL: ${url}`, error) }
  }

  function createWindow(loadUrl) {
    const contentSize = initialContentSize(screen.getPrimaryDisplay().workAreaSize)
    mainWindow = new BrowserWindow({
      title: 'Офис ИИ-агентов', icon: iconPath,
      width: contentSize.width, height: contentSize.height,
      minWidth: 1000, minHeight: Math.round(1000 / SCENE_ASPECT),
      useContentSize: true, center: true, resizable: true,
      backgroundColor: '#0d0d12', show: false,
      webPreferences: {
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
        preload: path.join(__dirname, 'preload.cjs'),
      },
    })
    mainWindow.once('ready-to-show', () => mainWindow.show())
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      log(`did-fail-load mainFrame=${isMainFrame} code=${errorCode} description=${errorDescription} url=${validatedURL}`)
    })
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      log(`renderer-console level=${level} ${sourceId}:${line} ${message}`)
    })
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      log(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
    })
    mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' } })
    mainWindow.webContents.on('will-navigate', (event, url) => {
      let parsed
      try { parsed = new URL(url) } catch { event.preventDefault(); return }
      if (!localOrigin || parsed.origin !== localOrigin) {
        event.preventDefault()
        openExternal(url)
      }
    })
    mainWindow.loadURL(loadUrl).catch((error) => log(`Failed to load ${loadUrl}`, error))
  }

  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() }
  })

  app.whenReady().then(async () => {
    logFile = path.join(app.getPath('logs'), 'open-agent-office.log')
    log(`Starting Open Agent Office (${isDev ? 'development' : 'production'})`)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    try {
      if (isDev) {
        localOrigin = 'http://127.0.0.1:3333'
        createWindow(`${localOrigin}/?sim`)
      } else {
        staticServer = createStaticServer(distRoot, { onRequest: ({ method, path: requestPath }) => log(`http ${method} ${requestPath}`) })
        const address = await staticServer.start()
        localOrigin = address.origin
        log(`Serving production frontend at ${localOrigin}`)
        createWindow(`${localOrigin}/?sim`)
      }
    } catch (error) {
      log('Unable to start production frontend', error)
      app.quit()
    }
  })

  app.on('before-quit', (event) => {
    if (staticServer && !shuttingDown) {
      event.preventDefault()
      shuttingDown = true
      staticServer.close().then(() => app.quit()).catch((error) => {
        log('Failed to close static server', error)
        app.quit()
      })
    }
  })
  app.on('window-all-closed', () => app.quit())
}
