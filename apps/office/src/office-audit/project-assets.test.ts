import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { showroomLayout, showroomSeats } from '../office-3d/scene-data'
import { formatProjectQualityGate, inspectGlbNodeBounds, runProjectQualityGate, serializeProjectQualityGate } from './index'
import type { SpatialAxis } from './types'
import type { AssetManifest, AuditableAssetFile, OfficeCompatibilitySnapshot } from './types'

const publicRoot = resolve(process.cwd(), 'public')
const sourceRoot = resolve(process.cwd(), 'src')
const manifestPath = 'office-art/v1/manifest.json'
const materialsPath = 'office-art/v1/materials.json'
const glbPath = 'office-art/v1/office-pack.glb'

function loadFile(path: string): AuditableAssetFile {
  return { path, bytes: readFileSync(resolve(publicRoot, path)) }
}

function actualCompatibility(manifest: AssetManifest, geometryUpAxis?: SpatialAxis): OfficeCompatibilitySnapshot {
  const rendererFile = 'apps/office/src/office-3d/OfficeScene3D.tsx'
  const layoutFile = 'apps/office/src/office-layout/types.ts'
  const rendererSource = readFileSync(resolve(sourceRoot, 'office-3d/OfficeScene3D.tsx'), 'utf8')
  const sceneDataSource = readFileSync(resolve(sourceRoot, 'office-3d/scene-data.ts'), 'utf8')
  const layout = showroomLayout()
  const rendererSeats = showroomSeats()
  const width = layout.size.width
  const depth = layout.size.depth
  const usedAssetIds = manifest.assets.filter(asset => asset.type === 'model').map(asset => asset.id)
  const hasEmployeeRaycast = rendererSource.includes('userData.employeeId') && rendererSource.includes('intersectObjects')
  const coordinate = { unit: 'metre', upAxis: 'Y' as const, horizontalAxes: ['X', 'Z'] as const, handedness: 'right' as const }
  return {
    asset: {
      file: 'apps/office/public/office-art/v1/manifest.json',
      coordinate: { ...coordinate, originConvention: 'center' },
      defaultScale: typeof manifest.defaultScale === 'number' ? manifest.defaultScale : Number.NaN,
      assetIds: manifest.assets.map(asset => asset.id),
      geometryUpAxis,
    },
    layout: {
      file: layoutFile,
      coordinate: { ...coordinate, originConvention: 'lower-left' },
      bounds: layout.bounds,
      seats: layout.desks.map(desk => ({ employeeId: desk.occupiedBy, deskId: desk.deskId, x: desk.position.x, z: desk.position.z })),
      hasOrientations: layout.desks.some(desk => Number.isFinite(desk.orientation)),
    },
    renderer: {
      file: rendererFile,
      coordinate: { ...coordinate, originConvention: 'center' },
      bounds: { x: -width / 2, z: -depth / 2, width, depth },
      seats: rendererSeats,
      usedAssetIds,
      clickTargetEmployeeIds: hasEmployeeRaycast ? rendererSeats.flatMap(seat => seat.employeeId ? [seat.employeeId] : []) : [],
      // The public OfficeArtRuntime is the manifest boundary; do not require
      // the renderer to duplicate its internal loader calls.
      consumesAssetManifest: rendererSource.includes('createOfficeArtRuntime') && rendererSource.includes('loadManifest') && rendererSource.includes('createInstance'),
      consumesLayout: sceneDataSource.includes('createFloorLayout'),
      appliesModelOrientation: rendererSource.includes('rotation: [0, options.rotationY'),
      appliesAssetScale: rendererSource.includes('createInstance') && rendererSource.includes('fitScale'),
      adaptsLayoutOrigin: /desk\.position\.x\s*-\s*layout\.size\.width\s*\/\s*2/.test(sceneDataSource) && /desk\.position\.z\s*-\s*layout\.size\.depth\s*\/\s*2/.test(sceneDataSource),
      assetUpAxisAssumption: rendererSource.includes('detectArtSourceRotationX') ? (geometryUpAxis ?? 'Y') : rendererSource.includes('authored Z-up') ? 'Z' : 'Y',
      retainsFallbackAfterAssetLoad: false,
      fallbackVisibleWithAssetPack: rendererSource.includes('fallbackRoot.visible = true') && rendererSource.includes('artRoot.visible = placedAssets > 0'),
      configuredDprCap: Number(rendererSource.match(/const MAX_DPR = ([\d.]+)/)?.[1] ?? Number.NaN),
      pausesAnimationWhenHidden: rendererSource.includes('visibilitychange'),
      axisConversionCount: (rendererSource.match(/clone\.rotation\.x\s*=\s*ART_SOURCE_ROTATION_X/g) ?? []).length,
      manifestScaleApplicationCount: rendererSource.includes('artPlacementScale(record.scale') ? 1 : 0,
      usesSharedArtRuntime: rendererSource.includes('createOfficeArtRuntime'),
      loadsMaterialLibrary: rendererSource.includes('applyMaterials'),
      disposesLoadedArt: rendererSource.includes('disposeInstance') && rendererSource.includes('disposeSharedResources'),
      reusesPlacedMaterials: rendererSource.includes('createOfficeArtRuntime'),
    },
  }
}

describe('actual office art quality gate', () => {
  it('audits manifest.json, materials.json, office-pack.glb, and current integration contracts', () => {
    const manifestFile = loadFile(manifestPath)
    const materialsFile = loadFile(materialsPath)
    const glbFile = loadFile(glbPath)
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes)) as AssetManifest
    const materials = JSON.parse(new TextDecoder().decode(materialsFile.bytes)) as unknown
    const referencedFiles = [...new Set(manifest.assets.map(asset => asset.url.replace(/^\//, '')))]
      .map(loadFile)
    const files = [manifestFile, materialsFile, glbFile, ...referencedFiles]
      .filter((file, index, all) => all.findIndex(candidate => candidate.path === file.path) === index)
    const spatial = inspectGlbNodeBounds(glbFile.bytes, glbPath)
    const result = runProjectQualityGate({
      assetPack: { manifestPath, manifest, materialsPath, materials, glbPath, files },
      compatibility: actualCompatibility(manifest, spatial.inferredUpAxis),
      tier: 'low',
    })

    expect(result.sections.assets.status).toBe('PASS')
    expect(result.evidence.glb).toMatchObject({ lightCount: 0 })
    expect(result.evidence.glb?.byteLength).toBeGreaterThan(0)
    expect(result.evidence.glb?.meshCount).toBeGreaterThan(0)
    expect(result.evidence.glb?.triangleCount).toBeGreaterThan(0)
    expect(result.evidence.runtimeMeasured).toBe(false)
    expect(result.status).toBe('WARNING')
    expect(result.report.findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
      'MODEL_FORWARD_AXIS_UNDECLARED',
      'RUNTIME_METRICS_NOT_CONNECTED',
    ]))
    expect(result.report.findings.map(finding => finding.code)).not.toContain('MATERIAL_MAPPING_UNRESOLVED')
    expect(result.report.findings.map(finding => finding.code)).not.toContain('SHARED_ART_RUNTIME_BYPASSED')
    expect(result.report.findings.map(finding => finding.code)).not.toContain('LOADED_ART_DISPOSAL_MISSING')
    expect(result.report.findings.map(finding => finding.code)).not.toContain('PLACED_MATERIALS_NOT_SHARED')
    expect(result.report.findings.map(finding => finding.code)).not.toContain('ANIMATION_VISIBILITY_PAUSE_MISSING')
    expect(JSON.parse(serializeProjectQualityGate(result)).status).toBe('WARNING')
    expect(formatProjectQualityGate(result)).toContain(`GLB ${result.evidence.glb?.byteLength} bytes`)
  })
})
