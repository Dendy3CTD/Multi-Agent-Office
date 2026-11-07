import { describe, expect, it } from 'vitest'
import { auditRendererRuntime, evaluateSpatialQuality, verifyGlbAxisFromReferenceBounds } from './index'
import type { AssetManifest, GlbNodeSpatialBounds, RendererRuntimeMetrics, SpatialBounds3, SpatialSceneSnapshot } from './types'

function bounds(x: number, y: number, z: number, width: number, height: number, depth: number): SpatialBounds3 {
  return { min: { x: x - width / 2, y, z: z - depth / 2 }, max: { x: x + width / 2, y: y + height, z: z + depth / 2 } }
}

function validSnapshot(): SpatialSceneSnapshot {
  return {
    file: 'fixture-scene.ts',
    manifestUpAxis: 'Z',
    geometryUpAxis: 'Z',
    rendererAssetUpAxis: 'Z',
    logicalFloorBounds: { minX: -5, maxX: 5, minZ: -4, maxZ: 4 },
    floorSurfaceY: 0,
    objects: [
      { id: 'floor', assetId: 'floor', kind: 'floor', bounds: bounds(0, -0.1, 0, 10, 0.1, 8) },
      { id: 'wall-back', assetId: 'wall', kind: 'wall', bounds: bounds(0, 0, -3.95, 10, 3, 0.1) },
      { id: 'window', assetId: 'window', kind: 'window', wallId: 'wall-back', bounds: bounds(0, 0.8, -3.9, 2, 1.4, 0.1), requiresFloorContact: false },
      { id: 'desk', assetId: 'desk', kind: 'desk', deskId: 'desk-1', bounds: bounds(0, 0, 0, 1.5, 0.8, 0.7), expectedSize: { x: 1.5, y: 0.8, z: 0.7 } },
      { id: 'chair', assetId: 'chair', kind: 'chair', deskId: 'desk-1', bounds: bounds(0, 0, 0.9, 0.6, 1.1, 0.6) },
      { id: 'character', assetId: 'character', kind: 'character', deskId: 'desk-1', employeeId: 'employee-1', bounds: bounds(0, 0, 0.8, 0.5, 1.7, 0.4) },
      { id: 'reserved-desk', assetId: 'desk', kind: 'desk', deskId: 'desk-2', bounds: bounds(2, 0, 0, 1.5, 0.8, 0.7) },
      { id: 'plant', assetId: 'plant', kind: 'plant', bounds: bounds(-3, 0, 2, 0.8, 1.7, 0.5) },
      { id: 'partition', assetId: 'partition', kind: 'partition', bounds: bounds(3.5, 0, 0, 0.08, 2.8, 4) },
    ],
    workstations: [
      { deskId: 'desk-1', employeeId: 'employee-1', reserved: false },
      { deskId: 'desk-2', reserved: true },
    ],
    visibleDeskIds: ['desk-1', 'desk-2'],
    visibleEmployeeIds: ['employee-1'],
    surfaceMaterials: { floorHasTexture: true, fallbackFloorHasTexture: true, loadedArtReplacesFallback: true, mappingsResolved: true },
  }
}

function codes(snapshot: SpatialSceneSnapshot): readonly string[] {
  return evaluateSpatialQuality(snapshot).findings.map(finding => finding.code)
}

describe('spatial quality gate', () => {
  it('passes a consistent Y-up renderer boundary and complete workstation scene', () => {
    expect(evaluateSpatialQuality(validSnapshot()).status).toBe('PASS')
  })

  it('detects GLB axis metadata and renderer conversion mismatches', () => {
    const snapshot = validSnapshot()
    snapshot.manifestUpAxis = 'Y'
    snapshot.rendererAssetUpAxis = 'Y'
    expect(codes(snapshot)).toEqual(expect.arrayContaining(['GLB_UP_AXIS_METADATA_MISMATCH', 'RENDERER_UP_AXIS_MISMATCH']))
  })

  it('detects extreme scale and model bounds drift', () => {
    const snapshot = validSnapshot()
    snapshot.objects = snapshot.objects.map(object => object.id === 'desk'
      ? { ...object, bounds: bounds(0, 0, 0, 0.3, 0.8, 0.7) }
      : object)
    expect(codes(snapshot)).toContain('OBJECT_SCALE_EXTREME')

    snapshot.objects = snapshot.objects.map(object => object.id === 'desk'
      ? { ...object, bounds: bounds(0, 0, 0, 1.05, 0.8, 0.7) }
      : object)
    expect(codes(snapshot)).toContain('MODEL_BOUNDS_MISMATCH')
  })

  it('detects floating plants and character-to-desk misalignment', () => {
    const snapshot = validSnapshot()
    snapshot.objects = snapshot.objects.map(object => object.id === 'plant'
      ? { ...object, bounds: bounds(-3, 0.5, 2, 0.8, 1.7, 0.5) }
      : object.id === 'character'
        ? { ...object, bounds: bounds(4, 0, 3, 0.5, 1.7, 0.4) }
        : object)
    expect(codes(snapshot)).toEqual(expect.arrayContaining(['OBJECT_FLOATING', 'CHARACTER_DESK_MISALIGNED']))
  })

  it('detects wall and window placement regressions', () => {
    const snapshot = validSnapshot()
    snapshot.objects = snapshot.objects.map(object => object.id === 'wall-back'
      ? { ...object, bounds: bounds(0, 0, -3.95, 4, 3, 0.1) }
      : object.id === 'window'
        ? { ...object, bounds: bounds(4.8, 2.2, -3.2, 2, 1.4, 0.1) }
        : object)
    expect(codes(snapshot)).toEqual(expect.arrayContaining(['WALL_SPAN_MISMATCH', 'WINDOW_NOT_ON_WALL', 'WINDOW_VERTICAL_MISALIGNMENT']))
  })

  it('checks full room bounds, work chairs, and vertical partitions', () => {
    const snapshot = validSnapshot()
    snapshot.objects = snapshot.objects.map(object => object.id === 'plant'
      ? { ...object, bounds: bounds(5.2, 0, 2, 0.8, 1.7, 0.5) }
      : object.id === 'chair'
        ? { ...object, bounds: bounds(4, 0, 3, 0.6, 1.1, 0.6) }
        : object.id === 'partition'
          ? { ...object, bounds: bounds(3.5, 0, 0, 2.8, 0.08, 4) }
          : object)
    expect(codes(snapshot)).toEqual(expect.arrayContaining(['OBJECT_BOUNDS_OUTSIDE_ROOM', 'CHAIR_DESK_MISALIGNED', 'PARTITION_NOT_VERTICAL']))
  })

  it('requires walls to sit on matching floor boundaries', () => {
    const snapshot = validSnapshot()
    snapshot.objects = snapshot.objects.map(object => object.id === 'wall-back'
      ? { ...object, bounds: bounds(0, 0, -2, 10, 3, 0.1) }
      : object)
    expect(codes(snapshot)).toContain('WALL_OFF_FLOOR_BOUNDARY')
  })

  it('does not drop a reserved desk and reports missing visible data', () => {
    const snapshot = validSnapshot()
    expect(codes(snapshot)).not.toContain('VISIBLE_DESK_MISSING')
    snapshot.visibleDeskIds = ['desk-1']
    snapshot.visibleEmployeeIds = []
    expect(codes(snapshot)).toEqual(expect.arrayContaining(['VISIBLE_DESK_MISSING', 'VISIBLE_EMPLOYEE_MISSING']))
  })

  it('detects material replacement and unresolved asset mapping', () => {
    const snapshot = validSnapshot()
    snapshot.surfaceMaterials = { floorHasTexture: false, fallbackFloorHasTexture: true, loadedArtReplacesFallback: true, mappingsResolved: false }
    expect(codes(snapshot)).toEqual(expect.arrayContaining(['FLOOR_MATERIAL_QUALITY_REGRESSION', 'SURFACE_MATERIAL_MAPPING_UNRESOLVED']))
  })
})

describe('reference-object GLB axis verification', () => {
  it('fails Y-up metadata when known model geometry is Z-up', () => {
    const makeNode = (node: string, size: readonly [number, number, number], minZ = 0): GlbNodeSpatialBounds => ({
      node,
      bounds: { min: { x: 0, y: 0, z: minZ }, max: { x: size[0], y: size[1], z: minZ + size[2] } },
      size: { x: size[0], y: size[1], z: size[2] },
    })
    const nodes = {
      floor: makeNode('floor', [12, 9, 0.12], -0.12),
      wall: makeNode('wall', [12, 0.22, 3.5]),
      desk: makeNode('desk', [1.5, 0.72, 0.82]),
      plant: makeNode('plant', [0.8, 0.5, 1.7]),
      window: makeNode('window', [2.4, 0.12, 1.7], 0.65),
    }
    const manifest = { assets: [
      { id: 'floor.oak.light', node: 'floor', url: 'pack.glb', type: 'model', scale: 1, origin: [0, 0, 0], anchor: 'bottom-center', bounds: [12, 9, 0.12], license: 'x', source: 'x' },
      { id: 'wall.brick.loft', node: 'wall', url: 'pack.glb', type: 'model', scale: 1, origin: [0, 0, 0], anchor: 'bottom-center', bounds: [12, 0.22, 3.5], license: 'x', source: 'x' },
      { id: 'desk.modern', node: 'desk', url: 'pack.glb', type: 'model', scale: 1, origin: [0, 0, 0], anchor: 'floor-center', bounds: [1.5, 0.72, 0.82], license: 'x', source: 'x' },
      { id: 'plant.potted', node: 'plant', url: 'pack.glb', type: 'model', scale: 1, origin: [0, 0, 0], anchor: 'floor-center', bounds: [0.8, 0.5, 1.7], license: 'x', source: 'x' },
      { id: 'window.frame', node: 'window', url: 'pack.glb', type: 'model', scale: 1, origin: [0, 0, 0], anchor: 'wall-center', bounds: [2.4, 0.12, 1.7], license: 'x', source: 'x' },
    ] } as AssetManifest
    const result = verifyGlbAxisFromReferenceBounds(nodes, manifest, 'Y')
    expect(result.inferredUpAxis).toBe('Z')
    expect(result.confidence).toBeGreaterThan(0.15)
    expect(result.report.findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
      'GLB_REFERENCE_AXIS_MISMATCH', 'ASSET_FLOOR_PIVOT_MISMATCH', 'ASSET_WALL_PIVOT_MISMATCH',
    ]))
  })
})

function runtimeMetrics(): RendererRuntimeMetrics {
  return {
    source: 'measured', capturedAt: '2026-11-05T00:00:00Z', renderer: 'test-webgl', sampleDurationMs: 1000,
    drawCalls: 30, meshCount: 25, triangleCount: 20_000, geometryCount: 20, textureCount: 4, lightCount: 2, dpr: 1.5,
    animationLoopActive: true, pageVisible: true, sceneAnimating: true, webglErrors: [], consoleErrors: [], assetLoadFailures: [],
    pendingRequestsAfterSettle: 0, disposeVerified: true, showroomSwitchVerified: true,
    assetCache: { entries: 1, sharedDocuments: true, evictionSupported: true },
    lifecycle: { webglContextLost: false, animationFramesAfterDispose: 0, resourcesBeforeDispose: 30, resourcesAfterDispose: 0 },
  }
}

describe('renderer diagnostics contract', () => {
  it('passes measured cache and WebGL lifecycle evidence', () => {
    expect(auditRendererRuntime(runtimeMetrics()).status).toBe('PASS')
  })

  it('fails duplicated assets, context loss, and animation after dispose', () => {
    const metrics = runtimeMetrics()
    metrics.assetCache = { entries: 2, sharedDocuments: false, evictionSupported: false }
    metrics.lifecycle = { webglContextLost: true, animationFramesAfterDispose: 3, resourcesAfterDispose: 2 }
    const report = auditRendererRuntime(metrics)
    expect(report.status).toBe('FAIL')
    expect(report.findings.map(finding => finding.code)).toEqual(expect.arrayContaining([
      'ASSET_CACHE_NOT_SHARED', 'WEBGL_CONTEXT_LOST', 'ANIMATION_AFTER_DISPOSE', 'WEBGL_RESOURCES_AFTER_DISPOSE',
    ]))
  })

  it('treats absent runtime measurements as a warning, never a pass', () => {
    expect(auditRendererRuntime()).toMatchObject({ status: 'WARNING' })
  })
})
