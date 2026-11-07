import { describe, expect, it } from 'vitest'
import {
  auditRendererRuntime,
  evaluateOfficeCompatibility,
  formatProjectQualityGate,
  inspectGlb,
  runProjectQualityGate,
  serializeProjectQualityGate,
  validateMaterialsLibrary,
} from './index'
import { createGlb, validManifest } from './fixtures'
import type { OfficeCompatibilitySnapshot, RendererRuntimeMetrics } from './types'

function codes(report: { findings: readonly { code: string }[] }): string[] {
  return report.findings.map(finding => finding.code)
}

function compatibleSnapshot(): OfficeCompatibilitySnapshot {
  const coordinate = { unit: 'metre', upAxis: 'Y' as const, horizontalAxes: ['X', 'Z'] as const, handedness: 'right' as const, originConvention: 'center' }
  const seat = { employeeId: 'employee-1', deskId: 'desk-1', x: 0, z: 0 }
  return {
    asset: { file: 'manifest.json', coordinate, defaultScale: 1, assetIds: ['desk.fixture'] },
    layout: { file: 'layout.ts', coordinate, bounds: { x: -1, z: -1, width: 2, depth: 2 }, seats: [seat], hasOrientations: false },
    renderer: {
      file: 'renderer.ts', coordinate, bounds: { x: -1, z: -1, width: 2, depth: 2 }, seats: [seat],
      usedAssetIds: ['desk.fixture'], clickTargetEmployeeIds: ['employee-1'], consumesAssetManifest: true,
      consumesLayout: true, appliesModelOrientation: true, appliesAssetScale: true, adaptsLayoutOrigin: true,
      assetUpAxisAssumption: 'Y', retainsFallbackAfterAssetLoad: false, fallbackVisibleWithAssetPack: false,
      pausesAnimationWhenHidden: true,
    },
  }
}

function measuredRuntime(): RendererRuntimeMetrics {
  return {
    source: 'measured', capturedAt: '2026-11-05T12:00:00.000Z', renderer: 'three-webgl', sampleDurationMs: 1_000,
    drawCalls: 100, meshCount: 80, triangleCount: 100_000, geometryCount: 60, textureCount: 8,
    lightCount: 3, dpr: 1.5, animationLoopActive: true, pageVisible: true, sceneAnimating: true,
    loadTimeMs: 800, memoryEstimate: { bytes: 96 * 1024 * 1024, method: 'renderer counters' },
    webglErrors: [], consoleErrors: [], assetLoadFailures: [], pendingRequestsAfterSettle: 0,
    disposeVerified: true, showroomSwitchVerified: true,
  }
}

describe('quality gate building blocks', () => {
  it('extracts lightweight GLB statistics without claiming full geometry validation', () => {
    const inspection = inspectGlb(createGlb())
    expect(inspection.report.status).toBe('PASS')
    expect(inspection.statistics).toMatchObject({ meshCount: 0, triangleCount: 0, textureCount: 0 })
  })

  it('validates the PBR materials library', () => {
    const valid = validateMaterialsLibrary({ version: 1, units: 'linear-srgb', materials: { oak: { baseColorFactor: [0.5, 0.4, 0.3, 1], roughness: 0.8, metallic: 0 } } })
    expect(valid.report.status).toBe('PASS')
    expect(valid.materialCount).toBe(1)
    expect(codes(validateMaterialsLibrary({ version: 1, units: 'x', materials: { bad: { baseColorFactor: [2], roughness: -1, metallic: 2 } } }).report)).toContain('MATERIAL_BASE_COLOR_INVALID')
  })

  it('separates missing runtime integration from measured runtime failures', () => {
    expect(codes(auditRendererRuntime())).toContain('RUNTIME_METRICS_NOT_CONNECTED')
    const failed = auditRendererRuntime({ ...measuredRuntime(), webglErrors: ['INVALID_OPERATION'] })
    expect(failed.status).toBe('FAIL')
    expect(codes(failed)).toContain('WEBGL_ERRORS_REPORTED')
  })

  it('detects coordinate assumptions and integration performance risks', () => {
    const snapshot = compatibleSnapshot()
    const report = evaluateOfficeCompatibility({
      ...snapshot,
      renderer: { ...snapshot.renderer, assetUpAxisAssumption: 'Z', retainsFallbackAfterAssetLoad: true, fallbackVisibleWithAssetPack: true, pausesAnimationWhenHidden: false },
    })
    expect(report.status).toBe('FAIL')
    expect(codes(report)).toEqual(expect.arrayContaining(['ASSET_UP_AXIS_ASSUMPTION_MISMATCH', 'HIDDEN_FALLBACK_RETAINED', 'DUPLICATE_FALLBACK_RENDERING', 'ANIMATION_VISIBILITY_PAUSE_MISSING']))
  })

  it('produces machine-readable and human-readable project reports', () => {
    const manifest = { ...validManifest, assets: [{ ...validManifest.assets[0], node: 'desk' }] }
    const glb = createGlb({ asset: { version: '2.0' }, nodes: [{ name: 'desk' }] })
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
    const materials = { version: 1, units: 'linear-srgb', materials: {} }
    const result = runProjectQualityGate({
      assetPack: {
        manifestPath: 'manifest.json', manifest,
        materialsPath: 'materials.json', materials, glbPath: 'assets/desk.glb',
        files: [{ path: 'assets/desk.glb', bytes: glb }, { path: 'manifest.json', bytes: manifestBytes }, { path: 'materials.json', bytes: new TextEncoder().encode(JSON.stringify(materials)) }],
      },
      compatibility: compatibleSnapshot(),
      runtime: measuredRuntime(),
    })
    expect(result.sections.assets.status).toBe('PASS')
    const machine = JSON.parse(serializeProjectQualityGate(result)) as { status: string; issues: { explanation: string }[] }
    expect(machine.status).toBe(result.status)
    expect(machine.issues.every(issue => typeof issue.explanation === 'string')).toBe(true)
    expect(formatProjectQualityGate(result)).toContain('Runtime measured: yes')
  })
})
