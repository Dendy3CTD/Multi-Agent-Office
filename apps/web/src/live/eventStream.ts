export interface LiveEventSource {
  addEventListener(type: string, listener: EventListener): void
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  close(): void
}

/** Same-origin event notifications only trigger a fresh authoritative snapshot. */
export function subscribeToLiveEvents(
  url: string,
  refresh: () => void,
  create: (url: string) => LiveEventSource = value => new EventSource(value),
  networkTarget: Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined = typeof window === 'undefined' ? undefined : window,
): () => void {
  let pending: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryAttempt = 0
  let closed = false
  let source: LiveEventSource
  const connect = () => {
    source = create(url)
    source.addEventListener('mao-event', () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => { pending = undefined; refresh() }, 200)
    })
    source.onopen = () => {
      retryAttempt = 0
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = undefined
    }
    // EventSource retries natively; this bounded supervisor also replaces a
    // connection that remains stuck after offline/network transitions.
    source.onerror = () => {
      if (closed || retryTimer) return
      const delay = Math.min(30_000, 2_000 * 2 ** retryAttempt++)
      retryTimer = setTimeout(() => {
        retryTimer = undefined
        source.close()
        if (!closed) connect()
      }, delay)
    }
  }
  const reconnectNow = () => {
    if (closed) return
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = undefined
    source.close()
    connect()
  }
  connect()
  networkTarget?.addEventListener('online', reconnectNow)
  return () => {
    closed = true
    if (pending) clearTimeout(pending)
    if (retryTimer) clearTimeout(retryTimer)
    source.close()
    networkTarget?.removeEventListener('online', reconnectNow)
  }
}
