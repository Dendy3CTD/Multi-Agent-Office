/** Opt-in Firefox diagnostics: /?debug=1, then inspect window.__MAO_STARTUP_TRACE__. */
declare global {
  interface Window {
    __MAO_STARTUP_TRACE__?: { stage: string; time: number; detail: Record<string, unknown> }[];
  }
}

export function traceTower(stage: string, detail: Record<string, unknown> = {}): void {
  if (!import.meta.env.DEV || typeof window === 'undefined' || new URLSearchParams(window.location.search).get('debug') !== '1') return;
  const entry = { stage, time: Math.round(performance.now()), detail };
  const trace = window.__MAO_STARTUP_TRACE__ ??= [];
  trace.push(entry);
  if (trace.length > 100) trace.shift();
  console.debug('[mao-startup]', entry);
}
