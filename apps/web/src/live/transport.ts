import type { LiveTransport, LiveTransportOptions } from './types'

/**
 * Browser transport. Credentials are deliberately supplied as a runtime
 * callback by a trusted host; this module never reads storage, env or URLs for
 * tokens and never includes response bodies in errors.
 */
export function createMaoFetchTransport(options: LiveTransportOptions): LiveTransport {
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const request = async <T>(method: 'GET' | 'POST', path: string, signal: AbortSignal, body?: unknown, extraHeaders?: Readonly<Record<string, string>>): Promise<T> => {
    const headers: Record<string, string> = { accept: 'application/json', ...extraHeaders }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const authorization = options.getAuthorizationHeader?.()
    if (authorization) headers.authorization = authorization
    let response: Response
    try {
      const timeout = AbortSignal.timeout(8_000)
      const requestSignal = AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal
      response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: requestSignal, cache: 'no-store' })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new Error('server_unavailable')
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('authentication_unavailable')
      if (response.status === 404) throw new Error('endpoint_unavailable')
      throw new Error(`server_http_${response.status}`)
    }
    if (response.status === 204) return undefined as T
    try { return await response.json() as T } catch { throw new Error('invalid_server_response') }
  }
  return {
    get: <T>(path: string, signal: AbortSignal) => request<T>('GET', path, signal),
    post: <T>(path: string, body: unknown, options: { signal: AbortSignal; headers?: Readonly<Record<string, string>> }) => request<T>('POST', path, options.signal, body, options.headers),
  }
}
