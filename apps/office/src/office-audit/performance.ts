import { createAuditReport } from './report'
import type {
  AuditFinding,
  AuditReport,
  PerformanceBudget,
  PerformanceEvaluationOptions,
  PerformanceMeasurements,
  PerformanceTier,
} from './types'

const MIB = 1024 * 1024

export const RECOMMENDED_PERFORMANCE_BUDGETS: Readonly<Record<PerformanceTier, PerformanceBudget>> = {
  low: {
    maxTotalAssetBytes: 80 * MIB,
    maxTextureBytes: 48 * MIB,
    maxTextureDimension: 2048,
    maxTextureCount: 48,
    maxObjectCount: 800,
    maxMeshCount: 500,
    maxTriangleCount: 750_000,
    maxVertexCount: 650_000,
    maxLightCount: 8,
    maxDrawCalls: 250,
    maxDpr: 1.5,
    maxLoadTimeMs: 5_000,
    maxGpuMemoryBytes: 384 * MIB,
    allowAnimationWhenIdle: false,
  },
  medium: {
    maxTotalAssetBytes: 180 * MIB,
    maxTextureBytes: 120 * MIB,
    maxTextureDimension: 4096,
    maxTextureCount: 96,
    maxObjectCount: 1_600,
    maxMeshCount: 1_000,
    maxTriangleCount: 1_500_000,
    maxVertexCount: 1_250_000,
    maxLightCount: 16,
    maxDrawCalls: 500,
    maxDpr: 2,
    maxLoadTimeMs: 4_000,
    maxGpuMemoryBytes: 768 * MIB,
    allowAnimationWhenIdle: false,
  },
  high: {
    maxTotalAssetBytes: 400 * MIB,
    maxTextureBytes: 256 * MIB,
    maxTextureDimension: 8192,
    maxTextureCount: 192,
    maxObjectCount: 3_500,
    maxMeshCount: 2_000,
    maxTriangleCount: 3_000_000,
    maxVertexCount: 2_500_000,
    maxLightCount: 32,
    maxDrawCalls: 1_000,
    maxDpr: 3,
    maxLoadTimeMs: 3_000,
    maxGpuMemoryBytes: 1_536 * MIB,
    allowAnimationWhenIdle: true,
  },
}

interface NumericCheck {
  metric: keyof PerformanceMeasurements
  budget: keyof PerformanceBudget
  code: string
  label: string
  recommendation: string
}

const NUMERIC_CHECKS: readonly NumericCheck[] = [
  { metric: 'totalAssetBytes', budget: 'maxTotalAssetBytes', code: 'BUDGET_ASSET_BYTES_EXCEEDED', label: 'Total asset bytes', recommendation: 'Compress, deduplicate, or lazy-load assets.' },
  { metric: 'textureBytes', budget: 'maxTextureBytes', code: 'BUDGET_TEXTURE_BYTES_EXCEEDED', label: 'Texture bytes', recommendation: 'Reduce texture resolution and use GPU-friendly compression.' },
  { metric: 'maxTextureDimension', budget: 'maxTextureDimension', code: 'BUDGET_TEXTURE_DIMENSION_EXCEEDED', label: 'Maximum texture dimension', recommendation: 'Downscale oversized textures or provide tier-specific variants.' },
  { metric: 'textureCount', budget: 'maxTextureCount', code: 'BUDGET_TEXTURE_COUNT_EXCEEDED', label: 'Texture count', recommendation: 'Reuse materials and consider texture atlases.' },
  { metric: 'objectCount', budget: 'maxObjectCount', code: 'BUDGET_OBJECT_COUNT_EXCEEDED', label: 'Object count', recommendation: 'Merge static objects and instance repeated props.' },
  { metric: 'meshCount', budget: 'maxMeshCount', code: 'BUDGET_MESH_COUNT_EXCEEDED', label: 'Mesh count', recommendation: 'Merge static meshes and instance repeated furniture.' },
  { metric: 'triangleCount', budget: 'maxTriangleCount', code: 'BUDGET_TRIANGLES_EXCEEDED', label: 'Triangle count', recommendation: 'Use lower-detail meshes and level-of-detail variants.' },
  { metric: 'vertexCount', budget: 'maxVertexCount', code: 'BUDGET_VERTICES_EXCEEDED', label: 'Vertex count', recommendation: 'Simplify meshes and remove hidden geometry.' },
  { metric: 'lightCount', budget: 'maxLightCount', code: 'BUDGET_LIGHTS_EXCEEDED', label: 'Light count', recommendation: 'Bake static lighting and limit shadow-casting lights.' },
  { metric: 'drawCalls', budget: 'maxDrawCalls', code: 'BUDGET_DRAW_CALLS_EXCEEDED', label: 'Draw calls', recommendation: 'Batch compatible meshes, instance repeats, and consolidate materials.' },
  { metric: 'dpr', budget: 'maxDpr', code: 'BUDGET_DPR_EXCEEDED', label: 'Device pixel ratio', recommendation: 'Cap renderer DPR for this performance tier.' },
  { metric: 'loadTimeMs', budget: 'maxLoadTimeMs', code: 'BUDGET_LOAD_TIME_EXCEEDED', label: 'Load time', recommendation: 'Profile loading, defer noncritical assets, and improve compression.' },
  { metric: 'gpuMemoryBytes', budget: 'maxGpuMemoryBytes', code: 'BUDGET_GPU_MEMORY_EXCEEDED', label: 'Estimated GPU memory', recommendation: 'Reduce texture memory, render targets, and duplicated geometry.' },
]

const RUNTIME_METRICS: readonly (keyof PerformanceMeasurements)[] = [
  'drawCalls', 'dpr', 'animationLoopActive', 'loadTimeMs', 'gpuMemoryBytes',
]

export function evaluatePerformanceBudget(
  measurements: PerformanceMeasurements,
  tier: PerformanceTier = 'low',
  options: PerformanceEvaluationOptions = {},
): AuditReport {
  const budget: PerformanceBudget = { ...RECOMMENDED_PERFORMANCE_BUDGETS[tier], ...options.budget }
  const findings: AuditFinding[] = []

  for (const check of NUMERIC_CHECKS) {
    const value = measurements[check.metric]
    const limit = budget[check.budget]
    if (typeof value === 'number' && typeof limit === 'number' && value > limit) {
      findings.push({
        code: check.code,
        severity: 'FAIL',
        description: `${check.label} is ${value}, above the configured limit of ${limit}.`,
        subject: check.metric,
        metric: check.metric,
        category: 'performance',
        recommendation: check.recommendation,
      })
    }
  }

  const geometryAvailable = measurements.triangleCount !== undefined || measurements.vertexCount !== undefined
  if (!geometryAvailable) {
    findings.push({
      code: 'GEOMETRY_METRICS_MISSING',
      severity: 'WARNING',
      description: 'Triangle and vertex statistics were not provided; geometry complexity was not evaluated.',
      subject: 'geometry',
      metric: 'geometry',
      category: 'performance',
      recommendation: 'Export offline geometry statistics or pass renderer scene statistics when available.',
    })
  }

  const missingRuntime = RUNTIME_METRICS.filter(metric => measurements[metric] === undefined)
  if ((options.requireRuntimeMetrics ?? true) && missingRuntime.length > 0) {
    findings.push({
      code: 'RUNTIME_METRICS_MISSING',
      severity: 'WARNING',
      description: `Runtime measurements are incomplete: ${missingRuntime.join(', ')}. No FPS or GPU usage is inferred.`,
      subject: 'runtime',
      metric: 'runtime',
      category: 'integration',
      recommendation: 'Pass measurements captured from the real renderer and target device.',
    })
  }

  if (measurements.animationLoopActive === true && !budget.allowAnimationWhenIdle) {
    const idle = measurements.sceneAnimating === false
    const hidden = measurements.pageVisible === false
    if (idle || hidden) {
      findings.push({
        code: 'ANIMATION_LOOP_WASTEFUL',
        severity: 'WARNING',
        description: `The animation loop remains active while the scene is ${hidden ? 'hidden' : 'idle'}.`,
        subject: 'animationLoopActive',
        metric: 'animationLoopActive',
        category: 'performance',
        recommendation: 'Pause rendering when hidden and use demand rendering while the scene is idle.',
      })
    }
  }

  return createAuditReport(findings)
}
