import { createAuditReport } from './report'
import type { AuditFinding, AuditReport, PerformanceMeasurements, RendererRuntimeMetrics } from './types'

function runtimeIssue(code: string, severity: 'WARNING' | 'FAIL', description: string, recommendation: string): AuditFinding {
  return { code, severity, description, file: 'OfficeScene3D runtime', recommendation, category: severity === 'FAIL' ? 'performance' : 'integration' }
}

export function performanceMeasurementsFromRuntime(metrics: RendererRuntimeMetrics): PerformanceMeasurements {
  return {
    meshCount: metrics.meshCount,
    triangleCount: metrics.triangleCount,
    lightCount: metrics.lightCount,
    textureCount: metrics.textureCount,
    drawCalls: metrics.drawCalls,
    dpr: metrics.dpr,
    animationLoopActive: metrics.animationLoopActive,
    pageVisible: metrics.pageVisible,
    sceneAnimating: metrics.sceneAnimating,
    loadTimeMs: metrics.loadTimeMs,
    gpuMemoryBytes: metrics.memoryEstimate?.bytes,
  }
}

export function auditRendererRuntime(metrics?: RendererRuntimeMetrics): AuditReport {
  if (!metrics) {
    return createAuditReport([runtimeIssue(
      'RUNTIME_METRICS_NOT_CONNECTED',
      'WARNING',
      'Renderer has not supplied a measured runtime snapshot; FPS, GPU usage, load latency, draw calls, and memory are not claimed.',
      'Connect the RendererRuntimeMetrics contract and capture it on the target device.',
    )])
  }
  const findings: AuditFinding[] = []
  const numeric: readonly [keyof RendererRuntimeMetrics, number][] = [
    ['sampleDurationMs', metrics.sampleDurationMs],
    ['drawCalls', metrics.drawCalls],
    ['meshCount', metrics.meshCount],
    ['triangleCount', metrics.triangleCount],
    ['geometryCount', metrics.geometryCount],
    ['textureCount', metrics.textureCount],
    ['lightCount', metrics.lightCount],
    ['dpr', metrics.dpr],
    ['pendingRequestsAfterSettle', metrics.pendingRequestsAfterSettle],
  ]
  for (const [name, value] of numeric) if (!Number.isFinite(value) || value < 0) findings.push(runtimeIssue('RUNTIME_METRIC_INVALID', 'FAIL', `${String(name)} must be a finite non-negative measured value.`, 'Fix renderer metric collection before evaluating the budget.'))
  if (metrics.webglErrors.length > 0) findings.push(runtimeIssue('WEBGL_ERRORS_REPORTED', 'FAIL', `WebGL reported: ${metrics.webglErrors.join('; ')}`, 'Resolve every WebGL error before enabling the showroom.'))
  if (metrics.consoleErrors.length > 0) findings.push(runtimeIssue('RENDERER_CONSOLE_ERRORS', 'FAIL', `Renderer console reported: ${metrics.consoleErrors.join('; ')}`, 'Fix renderer console errors and rerun the smoke test.'))
  if (metrics.assetLoadFailures.length > 0) findings.push(runtimeIssue('ASSET_LOAD_FAILURES', 'FAIL', `Asset loading failed: ${metrics.assetLoadFailures.join('; ')}`, 'Correct asset URLs, loaders, or pack contents.'))
  if (metrics.pendingRequestsAfterSettle > 0) findings.push(runtimeIssue('PENDING_REQUESTS_AFTER_SETTLE', 'WARNING', `${metrics.pendingRequestsAfterSettle} requests remain after the scene settled.`, 'Check for retries, polling loops, and duplicate asset loads.'))
  if (metrics.disposeVerified === false) findings.push(runtimeIssue('RENDERER_DISPOSE_FAILED', 'FAIL', 'Renderer resource disposal failed verification.', 'Dispose geometries, materials, textures, controls, listeners, observers, and the renderer.'))
  if (metrics.disposeVerified === undefined) findings.push(runtimeIssue('RENDERER_DISPOSE_UNVERIFIED', 'WARNING', 'Renderer disposal was not verified by the runtime smoke test.', 'Add mount/unmount resource counters or a repeatable disposal smoke test.'))
  if (metrics.showroomSwitchVerified === false) findings.push(runtimeIssue('SHOWROOM_SWITCH_FAILED', 'FAIL', 'Showroom switching failed runtime verification.', 'Fix showroom mounting and unmounting before enabling navigation.'))
  if (metrics.showroomSwitchVerified === undefined) findings.push(runtimeIssue('SHOWROOM_SWITCH_UNVERIFIED', 'WARNING', 'Showroom switching was not verified by the runtime smoke test.', 'Exercise repeated showroom enter/leave transitions in browser automation.'))
  if (!metrics.assetCache) findings.push(runtimeIssue('ASSET_CACHE_METRICS_MISSING', 'WARNING', 'Shared asset-cache diagnostics were not provided.', 'Report cache entries, shared document reuse, and eviction support.'))
  else {
    if (!Number.isFinite(metrics.assetCache.entries) || metrics.assetCache.entries < 0) findings.push(runtimeIssue('ASSET_CACHE_METRIC_INVALID', 'FAIL', 'Asset cache entry count is invalid.', 'Report a finite non-negative cache entry count.'))
    if (!metrics.assetCache.sharedDocuments) findings.push(runtimeIssue('ASSET_CACHE_NOT_SHARED', 'FAIL', 'Renderer duplicates model documents instead of sharing one loaded asset pack.', 'Share immutable source geometry/materials and clone only scene instances.'))
    if (metrics.assetCache.entries > 0 && !metrics.assetCache.evictionSupported) findings.push(runtimeIssue('ASSET_CACHE_NO_EVICTION', 'WARNING', 'Asset cache retains entries without an eviction/clear path.', 'Provide deterministic cache cleanup for floor-pack replacement and shutdown.'))
  }
  if (!metrics.lifecycle) findings.push(runtimeIssue('WEBGL_LIFECYCLE_METRICS_MISSING', 'WARNING', 'WebGL context and post-dispose counters were not provided.', 'Measure context loss, animation frames after unmount, and resource counts before/after dispose.'))
  else {
    if (metrics.lifecycle.webglContextLost) findings.push(runtimeIssue('WEBGL_CONTEXT_LOST', 'FAIL', 'WebGL context was lost during the measured run.', 'Investigate GPU memory pressure and renderer lifecycle before release.'))
    if (metrics.lifecycle.animationFramesAfterDispose > 0) findings.push(runtimeIssue('ANIMATION_AFTER_DISPOSE', 'FAIL', `${metrics.lifecycle.animationFramesAfterDispose} animation frames ran after disposal.`, 'Cancel every animation frame and stop scheduling before unmount completes.'))
    if (metrics.lifecycle.resourcesAfterDispose !== undefined && metrics.lifecycle.resourcesAfterDispose > 0) findings.push(runtimeIssue('WEBGL_RESOURCES_AFTER_DISPOSE', 'WARNING', `${metrics.lifecycle.resourcesAfterDispose} tracked resources remain after disposal.`, 'Release scene-owned geometries, materials, textures, render targets, controls, and listeners.'))
  }
  return createAuditReport(findings)
}
