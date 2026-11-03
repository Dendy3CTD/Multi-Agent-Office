const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { URL } = require('node:url')

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function safePath(distRoot, requestPath) {
  let decoded
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const relative = decoded.replace(/^\/+/, '')
  const candidate = path.resolve(distRoot, relative)
  const root = path.resolve(distRoot)
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null
}

function sendFile(res, filePath) {
  const extension = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
  })
  fs.createReadStream(filePath).on('error', () => {
    if (!res.headersSent) res.writeHead(500)
    res.end('Internal Server Error')
  }).pipe(res)
}

function createStaticServer(distRoot, { port = 0, host = '127.0.0.1', onRequest } = {}) {
  const root = path.resolve(distRoot)
  const indexPath = path.join(root, 'index.html')
  if (!fs.existsSync(indexPath)) throw new Error(`Production frontend not found: ${indexPath}`)

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${host}`)
    const requestedPath = requestUrl.pathname
    const requestedFile = safePath(root, requestedPath)
    onRequest?.({ method: req.method, path: requestedPath, url: requestUrl.toString() })

    if (!requestedFile) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Bad Request')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end('Method Not Allowed')
      return
    }

    let filePath = requestedFile
    try {
      if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html')
    } catch {
      // The SPA fallback below handles route-like paths that are not files.
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      // A path with an extension is expected to be a real asset, not a route.
      if (path.extname(requestedPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not Found')
        return
      }
      filePath = indexPath
    }
    if (req.method === 'HEAD') {
      const extension = path.extname(filePath).toLowerCase()
      res.writeHead(200, { 'Content-Type': MIME_TYPES[extension] || 'application/octet-stream' })
      res.end()
      return
    }
    sendFile(res, filePath)
  })

  return {
    server,
    start() {
      return new Promise((resolve, reject) => {
        const onError = (error) => { server.off('listening', onListening); reject(error) }
        const onListening = () => {
          server.off('error', onError)
          const address = server.address()
          if (!address || typeof address === 'string') return reject(new Error('Could not determine static server address'))
          resolve({ host, port: address.port, origin: `http://${host}:${address.port}` })
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, host)
      })
    },
    close() {
      return new Promise((resolve) => {
        if (!server.listening) return resolve()
        server.close(() => resolve())
      })
    },
  }
}

module.exports = { createStaticServer, MIME_TYPES, safePath }
