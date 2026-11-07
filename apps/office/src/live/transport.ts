import type { LiveTransport, LiveTransportOptions } from './types'

/**
 * Browser transport. Credentials are deliberately supplied as a runtime
 * callback by a trusted host; this module never reads storage, env or URLs for
 * tokens and never includes response bodies in errors.
 */
export function createMaoFetchTransport(options: LiveTransportOptions): LiveTransport {
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  return {
    async get<T>(path: string, signal: AbortSignal): Promise<T> {
      const headers: Record<string, string> = { accept: 'application/json' }
      const authorization = options.getAuthorizationHeader?.()
      if (authorization) headers.authorization = authorization
      let response: Response
      try {
        response = await fetch(`${baseUrl}${path}`, { method: 'GET', headers, signal, cache: 'no-store' })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new Error('server_unavailable')
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error('authentication_unavailable')
        if (response.status === 404) throw new Error('endpoint_unavailable')
        throw new Error(`server_http_${response.status}`)
      }
      try { return await response.json() as T } catch { throw new Error('invalid_server_response') }
    },
  }
}
