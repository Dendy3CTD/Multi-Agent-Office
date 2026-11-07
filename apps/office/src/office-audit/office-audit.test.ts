import { describe, expect, it } from 'vitest'
import {
  auditAssetFiles,
  evaluatePerformanceBudget,
  formatAuditReport,
  validateAssetManifest,
  validateGlb,
  validateGltfJson,
} from './index'
import {
  completeLowTierMeasurements,
  createCorruptGlb,
  createGlb,
  validFiles,
  validManifest,
} from './fixtures'
import type { AssetManifest, AuditableAssetFile } from './types'

function manifestWith(...updates: Record<string, unknown>[]): AssetManifest {
  return {
    ...validManifest,
    assets: updates.map((update, index) => ({
      ...validManifest.assets[0],
      id: `fixture.${index}`,
      ...update,
    })),
  }
}

function codes(report: ReturnType<typeof validateAssetManifest>): string[] {
  return report.findings.map(finding => finding.code)
}

describe('asset manifest validation', () => {
  it('passes a valid manifest fixture', () => {
    expect(validateAssetManifest(validManifest).status).toBe('PASS')
    expect(auditAssetFiles(validManifest, validFiles).status).toBe('PASS')
  })

  it('rejects duplicate asset ids', () => {
    const manifest = manifestWith({ id: 'duplicate' }, { id: 'duplicate' })
    expect(codes(validateAssetManifest(manifest))).toContain('ASSET_ID_DUPLICATE')
  })

  it('reports an absent manifest and an absent asset file', () => {
    expect(codes(validateAssetManifest(undefined))).toContain('MANIFEST_MISSING')
    expect(codes(auditAssetFiles(validManifest, []))).toContain('ASSET_FILE_MISSING')
  })

  it('rejects traversal and remote paths', () => {
    const traversal = manifestWith(
      { url: '../secret.glb' },
      { url: 'https://example.test/model.glb' },
      { url: 'models/%2e%2e/secret.glb' },
    )
    expect(validateAssetManifest(traversal).findings.filter(finding => finding.code === 'ASSET_PATH_UNSAFE')).toHaveLength(3)
  })

  it('requires license metadata', () => {
    expect(codes(validateAssetManifest(manifestWith({ license: '' })))).toContain('ASSET_LICENSE_MISSING')
  })

  it('validates optional declared file size', () => {
    expect(codes(validateAssetManifest(manifestWith({ sizeBytes: -1 })))).toContain('ASSET_SIZE_INVALID')
    expect(codes(auditAssetFiles(manifestWith({ sizeBytes: 1 }), validFiles))).toContain('ASSET_FILE_SIZE_MISMATCH')
  })
})

describe('GLB and glTF structural checks', () => {
  it('accepts a structurally valid GLB', () => {
    expect(validateGlb(createGlb()).status).toBe('PASS')
  })

  it('detects a corrupt GLB chunk boundary', () => {
    expect(codes(validateGlb(createCorruptGlb()))).toContain('GLB_CHUNK_OUT_OF_BOUNDS')
  })

  it('rejects invalid glTF JSON and invalid glTF structure', () => {
    expect(codes(validateGltfJson(new TextEncoder().encode('{broken')))).toContain('GLTF_JSON_INVALID')
    expect(codes(validateGltfJson(new TextEncoder().encode('[]')))).toContain('GLTF_STRUCTURE_INVALID')
    const invalidArrays = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, buffers: {} }))
    expect(codes(validateGltfJson(invalidArrays))).toContain('GLTF_BUFFERS_INVALID')
  })

  it('checks local glTF buffer and image references', () => {
    const gltf = new TextEncoder().encode(JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: 'mesh.bin' }],
      images: [{ uri: '../outside.png' }, { uri: 'missing.png' }],
    }))
    const report = validateGltfJson(gltf, 'models/office.gltf', new Set(['models/mesh.bin']))
    expect(codes(report)).toContain('GLTF_REFERENCE_UNSAFE')
    expect(codes(report)).toContain('GLTF_REFERENCE_MISSING')
  })

  it('audits glTF files without a renderer dependency', () => {
    const manifest = manifestWith({ id: 'scene', url: 'models/office.gltf' })
    const gltf = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin' }] }))
    const files: AuditableAssetFile[] = [
      { path: 'models/office.gltf', bytes: gltf },
      { path: 'models/mesh.bin', bytes: new Uint8Array([1, 2, 3, 4]) },
    ]
    expect(auditAssetFiles(manifest, files).status).toBe('PASS')
  })

  it('rejects unsafe supplied file paths', () => {
    const report = auditAssetFiles(validManifest, [{ path: '../desk.glb', bytes: createGlb() }])
    expect(codes(report)).toContain('ASSET_FILE_PATH_UNSAFE')
  })
})

describe('asset size and performance budgets', () => {
  it('warns about a suspiciously large asset using a configurable threshold', () => {
    const report = auditAssetFiles(validManifest, validFiles, { suspiciousAssetBytes: 16 })
    expect(report.status).toBe('WARNING')
    expect(codes(report)).toContain('ASSET_FILE_SUSPICIOUSLY_LARGE')
  })

  it('fails when texture size exceeds the selected budget', () => {
    const report = evaluatePerformanceBudget(
      { ...completeLowTierMeasurements, maxTextureDimension: 4096 },
      'low',
    )
    expect(codes(report)).toContain('BUDGET_TEXTURE_DIMENSION_EXCEEDED')
  })

  it('fails when estimated GPU memory exceeds a custom budget', () => {
    const report = evaluatePerformanceBudget(
      completeLowTierMeasurements,
      'low',
      { budget: { maxGpuMemoryBytes: 32 * 1024 * 1024 } },
    )
    expect(codes(report)).toContain('BUDGET_GPU_MEMORY_EXCEEDED')
  })

  it('warns when runtime measurements are absent without inventing FPS', () => {
    const report = evaluatePerformanceBudget({ triangleCount: 1, vertexCount: 1 }, 'low')
    expect(report.status).toBe('WARNING')
    expect(codes(report)).toContain('RUNTIME_METRICS_MISSING')
    expect(formatAuditReport(report)).toContain('No FPS or GPU usage is inferred')
  })

  it('produces PASS, WARNING, and FAIL reports with formatted recommendations', () => {
    const pass = evaluatePerformanceBudget(completeLowTierMeasurements, 'low')
    const warning = evaluatePerformanceBudget({ triangleCount: 1, vertexCount: 1 }, 'low')
    const fail = evaluatePerformanceBudget({ ...completeLowTierMeasurements, drawCalls: 999 }, 'low')
    expect([pass.status, warning.status, fail.status]).toEqual(['PASS', 'WARNING', 'FAIL'])
    expect(formatAuditReport(fail)).toContain('Recommendation:')
  })

  it('operates only on supplied data and has no GPT-1, GPT-2, or Three.js dependency', () => {
    const result = auditAssetFiles(validManifest, validFiles)
    expect(result.status).toBe('PASS')
    expect(result.findings.every(finding => !/GPT|Three\.js/i.test(finding.description))).toBe(true)
  })
})
