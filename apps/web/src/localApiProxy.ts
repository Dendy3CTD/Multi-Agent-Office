import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Plugin } from 'vite'

const API_PREFIX = '/__mao_api'
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_TASK_WRITE_BYTES = 32 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOCAL_API_HOSTS = new Set(['127.0.0.1', '::1'])
const OFFICE_READ_ROUTES = new Set([
  '/v1/departments', '/v1/professions', '/v1/employees', '/v1/projects', '/v1/status',
  '/v1/runtimes', '/v1/agent-roles', '/v1/agent-queue/tasks', '/v1/agent-queue/active',
  '/v1/budget/snapshot', '/v1/models', '/v1/usage/models',
])

export async function readLocalApiBearerToken(path: string): Promise<string> {
  const error = () => new Error('configured_MAO_TOKEN_FILE_is_unreadable_or_insecure')
  if (!isAbsolute(path)) throw error()
  let file
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch { throw error() }
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size < 1 || info.size > 4096 || (info.mode & 0o077) !== 0) throw error()
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw error()
    const token = (await file.readFile('utf8')).trim()
    if (!token || token.length > 2048 || /[\x00-\x20\x7f]/.test(token)) throw error()
    return token
  } finally { await file.close() }
}

function isAllowedOfficeReadRoute(pathname: string, search: URLSearchParams): boolean {
  if (pathname === '/v1/events/stream') return search.size === 0
  if (pathname === '/v1/events') return search.size === 1 && search.get('limit') === '100'
  if (OFFICE_READ_ROUTES.has(pathname)) return search.size === 0
  const taskPath = /^\/v1\/(?:tasks|agent-queue\/tasks)\/([^/]+)$/.exec(pathname)
  if (!taskPath || search.size !== 0) return false
  let id: string
  try { id = decodeURIComponent(taskPath[1]) } catch { return false }
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id) && id !== '.' && id !== '..'
}

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '')
}

export function isTaskWriteOptedIn(coreAccepted: string | undefined, enableWrites: string | undefined): boolean {
  return coreAccepted === 'true' && enableWrites === 'true'
}

export type LocalProxyDecision =
  | { action: 'next' }
  | { action: 'proxy'; path: string; write?: boolean }
  | { action: 'reject'; status: 400 | 403 | 404 | 405 }

type LocalProxyRequest = {
  url?: string
  method?: string
  headers: { host?: string; origin?: string; 'content-type'?: string; 'idempotency-key'?: string }
  socket: { remoteAddress?: string }
}

/** Pure request guard shared by the Vite middleware and its security tests. */
export function inspectLocalProxyRequest(request: LocalProxyRequest, options: { enableTaskWrites?: boolean } = {}): LocalProxyDecision {
  const rawPath = (request.url ?? '/').split('?', 1)[0]
  if (rawPath.startsWith(`${API_PREFIX}/`)) {
    let decodedRawPath: string
    try { decodedRawPath = decodeURIComponent(rawPath) }
    catch { return { action: 'reject', status: 400 } }
    if (decodedRawPath.includes('\\') || decodedRawPath.split('/').some(segment => segment === '.' || segment === '..')) {
      return { action: 'reject', status: 404 }
    }
  }
  let requestUrl: URL
  try { requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1') }
  catch { return { action: 'reject', status: 400 } }
  if (!requestUrl.pathname.startsWith(`${API_PREFIX}/`)) return { action: 'next' }

  const hostHeader = request.headers.host
  let hostUrl: URL
  try {
    if (!hostHeader) return { action: 'reject', status: 403 }
    hostUrl = new URL(`http://${hostHeader}`)
  } catch { return { action: 'reject', status: 403 } }
  if (hostUrl.username || hostUrl.password || hostUrl.pathname !== '/' || !LOOPBACK_HOSTS.has(hostnameOf(hostUrl))) return { action: 'reject', status: 403 }
  if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? '')) return { action: 'reject', status: 403 }

  const originHeader = request.headers.origin
  const taskCancel = request.method === 'POST' && /^\/__mao_api\/v1\/tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,159}\/cancel$/.test(requestUrl.pathname)
  const taskWrite = request.method === 'POST' && (requestUrl.pathname === `${API_PREFIX}/v1/tasks/preflight` || requestUrl.pathname === `${API_PREFIX}/v1/tasks`)
  if (taskWrite || taskCancel) {
    if (!options.enableTaskWrites) return { action: 'reject', status: 404 }
    if (requestUrl.search || !originHeader) return { action: 'reject', status: 403 }
  }
  if (originHeader) {
    try {
      const origin = new URL(originHeader)
      if (origin.protocol !== 'http:' || origin.host !== hostUrl.host || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
        return { action: 'reject', status: 403 }
      }
    } catch { return { action: 'reject', status: 403 } }
  }

  if (request.url && request.url.length > 4096) return { action: 'reject', status: 400 }

  if (taskWrite) {
    if (!originHeader || originHeader !== `http://${hostUrl.host}`) return { action: 'reject', status: 403 }
    if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return { action: 'reject', status: 400 }
    const idempotencyKey = request.headers['idempotency-key']
    if (requestUrl.pathname.endsWith('/v1/tasks') && (!idempotencyKey || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey))) return { action: 'reject', status: 400 }
    if (requestUrl.pathname.endsWith('/preflight') && idempotencyKey !== undefined) return { action: 'reject', status: 400 }
    return { action: 'proxy', path: requestUrl.pathname.slice(API_PREFIX.length), write: true }
  }
  if (taskCancel) {
    if (!originHeader || originHeader !== `http://${hostUrl.host}` || requestUrl.search) return { action: 'reject', status: 403 }
    if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return { action: 'reject', status: 400 }
    return { action: 'proxy', path: requestUrl.pathname.slice(API_PREFIX.length), write: true }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return { action: 'reject', status: 405 }

  const upstreamUrl = new URL(`${requestUrl.pathname.slice(API_PREFIX.length)}${requestUrl.search}`, 'http://127.0.0.1')
  if (!isAllowedOfficeReadRoute(upstreamUrl.pathname, upstreamUrl.searchParams)) return { action: 'reject', status: 404 }
  return { action: 'proxy', path: `${upstreamUrl.pathname}${upstreamUrl.search}` }
}

async function readTaskWriteBody(request: AsyncIterable<Uint8Array>, path: string): Promise<string> {
  const chunks: Uint8Array[] = []
  let byteLength = 0
  for await (const chunk of request) {
    byteLength += chunk.byteLength
    if (byteLength > MAX_TASK_WRITE_BYTES) throw new Error('task_write_body_too_large')
    chunks.push(chunk)
  }
  let raw: unknown
  try { raw = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))))) }
  catch { throw new Error('task_write_invalid_json') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('task_write_invalid_body')
  const body = raw as Record<string, unknown>
  if (/^\/v1\/tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,159}\/cancel$/.test(path)) {
    if (Object.keys(body).length !== 0) throw new Error('task_write_unsupported_field')
    return '{}'
  }
  const isSubmit = path === '/v1/tasks'
  const fields = new Set(['projectId', 'title', 'brief', 'acceptanceCriteria', 'priority', 'complexity', 'runtimeId', 'modelId', ...(isSubmit ? ['previewId', 'confirmed'] : [])])
  if (Object.keys(body).some(key => !fields.has(key))) throw new Error('task_write_unsupported_field')
  if (typeof body.projectId !== 'string' || typeof body.title !== 'string' || typeof body.brief !== 'string' || !Array.isArray(body.acceptanceCriteria) || body.acceptanceCriteria.length < 1 || body.acceptanceCriteria.length > 12 || body.acceptanceCriteria.some(value => typeof value !== 'string')) throw new Error('task_write_invalid_fields')
  if (isSubmit && (body.confirmed !== true || typeof body.previewId !== 'string' || !/^preview-[a-f0-9]{36}$/.test(body.previewId))) throw new Error('task_write_confirmation_required')
  return JSON.stringify(body)
}

export function validateLocalApiUpstream(value: string): URL {
  let url: URL
  try { url = new URL(value) }
  catch { throw new Error('local_api_upstream_must_be_loopback_http') }
  const port = Number(url.port)
  if (url.protocol !== 'http:' || !LOCAL_API_HOSTS.has(hostnameOf(url)) || !Number.isInteger(port) || port < 1 || port > 65535 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('local_api_upstream_must_be_loopback_http')
  }
  return url
}

export function localApiProxy(options: { upstreamUrl: string; bearerToken?: string; enableTaskWrites?: boolean }): Plugin {
  const upstreamBase = validateLocalApiUpstream(options.upstreamUrl)
  return {
    name: 'mao-local-readonly-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const decision = inspectLocalProxyRequest(request, { enableTaskWrites: options.enableTaskWrites === true })
        if (decision.action === 'next') return next()
        if (decision.action === 'reject') {
          response.statusCode = decision.status
          if (decision.status === 405) response.setHeader('Allow', 'GET, HEAD')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify({ error: decision.status === 405 ? 'read_only_local_proxy' : 'local_proxy_request_rejected' }))
          return
        }

        const controller = new AbortController()
        let connectTimeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), 10_000)
        let clientClosed = false
        const onClientClose = () => { clientClosed = true; controller.abort() }
        response.once('close', onClientClose)
        try {
          const requestBody = decision.write ? await readTaskWriteBody(request, decision.path) : undefined
          const upstream = await fetch(new URL(decision.path, upstreamBase), {
            method: request.method,
            headers: {
              accept: decision.path === '/v1/events/stream' ? 'text/event-stream' : 'application/json',
              ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
              ...(decision.write ? { 'content-type': 'application/json' } : {}),
              ...(decision.write && decision.path === '/v1/tasks' && typeof request.headers['idempotency-key'] === 'string' ? { 'idempotency-key': request.headers['idempotency-key'] } : {}),
              ...(decision.path === '/v1/events/stream' && typeof request.headers['last-event-id'] === 'string' && request.headers['last-event-id'].length <= 160 && !/[\x00-\x20\x7f]/.test(request.headers['last-event-id']) ? { 'last-event-id': request.headers['last-event-id'] } : {}),
            },
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
            ...(requestBody ? { body: requestBody } : {}),
          })
          if (connectTimeout) clearTimeout(connectTimeout)
          connectTimeout = undefined
          if (decision.path === '/v1/events/stream' && upstream.ok && upstream.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
            response.statusCode = upstream.status
            response.setHeader('Cache-Control', 'no-store, no-transform')
            for (const name of ['content-type', 'retry-after']) {
              const value = upstream.headers.get(name)
              if (value) response.setHeader(name, value)
            }
            response.flushHeaders()
            const reader = upstream.body?.getReader()
            const decoder = new TextDecoder()
            let lineBuffer = ''
            let droppingLongLine = false
            let eventId: string | undefined
            let maoEvent = false
            const writeChunk = async (chunk: string) => {
              if (response.destroyed || response.write(chunk)) return
              await new Promise<void>(resolve => {
                const done = () => { response.off('drain', done); response.off('close', done); resolve() }
                response.once('drain', done)
                response.once('close', done)
              })
            }
            const consumeLine = async (rawLine: string) => {
              const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
              if (!line) {
                if (maoEvent) await writeChunk(`id: ${eventId ?? ''}\nevent: mao-event\ndata: {}\n\n`)
                eventId = undefined
                maoEvent = false
              } else if (line.startsWith(':')) {
                await writeChunk(': keep-alive\n\n')
              } else if (line.startsWith('id: ')) {
                const candidate = line.slice(4)
                eventId = /^[A-Za-z0-9._:-]{1,160}$/.test(candidate) ? candidate : undefined
              } else if (line === 'event: mao-event') {
                maoEvent = true
              } else if (/^retry: [0-9]{1,5}$/.test(line)) {
                await writeChunk(`${line}\n\n`)
              }
            }
            try {
              while (reader) {
                const { done, value } = await reader.read()
                if (done || response.destroyed) break
                lineBuffer += decoder.decode(value, { stream: true })
                let newline: number
                while ((newline = lineBuffer.indexOf('\n')) >= 0) {
                  const line = lineBuffer.slice(0, newline)
                  lineBuffer = lineBuffer.slice(newline + 1)
                  if (droppingLongLine) droppingLongLine = false
                  else await consumeLine(line)
                }
                if (lineBuffer.length > 2048) { lineBuffer = ''; droppingLongLine = true }
              }
              if (!response.destroyed && !response.writableEnded) response.end()
            } finally {
              await reader?.cancel().catch(() => undefined)
              response.off('close', onClientClose)
            }
            return
          }
          const body = request.method === 'HEAD' || upstream.status === 204
            ? new Uint8Array()
            : new Uint8Array(await upstream.arrayBuffer())
          if (body.byteLength > MAX_RESPONSE_BYTES) {
            response.statusCode = 502
            response.setHeader('Content-Type', 'application/json')
            response.setHeader('Cache-Control', 'no-store')
            response.end(JSON.stringify({ error: 'upstream_response_too_large' }))
            return
          }
          response.statusCode = upstream.status
          response.setHeader('Cache-Control', 'no-store')
          for (const name of ['content-type', 'www-authenticate', 'retry-after']) {
            const value = upstream.headers.get(name)
            if (value) response.setHeader(name, value)
          }
          response.end(body)
        } catch (error) {
          if (response.destroyed || clientClosed) return
          if (error instanceof Error && error.message.startsWith('task_write_')) {
            response.statusCode = error.message === 'task_write_body_too_large' ? 413 : 400
            response.setHeader('Content-Type', 'application/json')
            response.setHeader('Cache-Control', 'no-store')
            response.end(JSON.stringify({ error: 'task_write_request_rejected' }))
            return
          }
          if (connectTimeout) clearTimeout(connectTimeout)
          response.off('close', onClientClose)
          response.statusCode = 502
          response.setHeader('Content-Type', 'application/json')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify({ error: 'local_api_upstream_unavailable' }))
        } finally {
          if (connectTimeout) clearTimeout(connectTimeout)
          response.off('close', onClientClose)
        }
      })
    },
  }
}
