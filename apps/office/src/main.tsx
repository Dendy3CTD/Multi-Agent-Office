import React from 'react'
import ReactDOM from 'react-dom/client'
import { lazy, Suspense } from 'react'
import { loadRuntimeConfig } from './config'
import { MAOTower } from './integration'
import { startupMode } from './integration/route'
import { traceTower } from './integration/diagnostics'

const LegacyApp = lazy(() => import('./App'))
const OfficeScene3D = lazy(() => import('./office-3d/OfficeScene3D'))
const root = ReactDOM.createRoot(document.getElementById('root')!)

function StartupFallback() {
  return <main className="mao-startup-fallback" data-startup-fallback="mao-tower" aria-busy="true"><span>MA</span><strong>Multi-Agent Office</strong><small>Загрузка башни управления…</small></main>
}

function render(mode: ReturnType<typeof startupMode>) {
  root.render(
    <React.StrictMode>
      {mode === 'showroom' ? <Suspense fallback={<StartupFallback />}><OfficeScene3D /></Suspense> : mode === 'legacy' ? <Suspense fallback={<StartupFallback />}><LegacyApp /></Suspense> : <MAOTower />}
    </React.StrictMode>,
  )
}

// The boss's name, sprite and colour come from the server's office.config.json
// (GET /config) and are applied before the first render, so nothing captures
// the bundled name first. ?sim and ?video have no server, and the Vite dev
// server may run without one: those render at once, and a server that does
// not answer within loadRuntimeConfig's timeout leaves the build-time boss
// in place. A promise chain rather than top-level await: the build target
// rejects the latter.
const params = new URLSearchParams(window.location.search)
const mode = startupMode(window.location.search)
traceTower('startup-route', { mode })
document.getElementById('root')!.dataset.startupRoute = mode
const legacy = mode === 'legacy'
const standalone = params.has('sim') || params.has('video')
if (legacy) {
  // Explicit legacy routes retain their token/config handshake, but the user
  // sees a stable MAO Tower loading surface while that lazy branch is fetched.
  root.render(<StartupFallback />)
  void import('./officeToken')
    .then(({ captureOfficeToken }) => captureOfficeToken())
    .then(() => standalone ? null : loadRuntimeConfig())
    .then(() => render(mode), () => render(mode))
} else {
  // The default tower must mount synchronously. There is no intermediate
  // legacy tree and no second createRoot during reload or HMR.
  render(mode)
}
