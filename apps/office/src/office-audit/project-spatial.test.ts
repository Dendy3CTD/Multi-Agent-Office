import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { showroomLayout } from '../office-3d/scene-data'
import { evaluateSpatialQuality, inspectGlb, inspectGlbNodeBounds, transformAssetBoundsToYUp } from './index'
import type { AssetManifest, AssetManifestRecord, SpatialObject, SpatialPoint3, SpatialSceneSnapshot } from './types'

const publicRoot = resolve(process.cwd(), 'public')
const glbPath = resolve(publicRoot, 'office-art/v1/office-pack.glb')
const manifestPath = resolve(publicRoot, 'office-art/v1/manifest.json')

function manifestSize(record: AssetManifestRecord): SpatialPoint3 {
  return { x: record.bounds[0], y: record.bounds[1], z: record.bounds[2] }
}

describe('current showroom spatial quality gate', () => {
  it('checks the actual Y-up layout composition and all workstation records', () => {
    const glbBytes = readFileSync(glbPath)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as AssetManifest
    const spatial = inspectGlbNodeBounds(glbBytes, 'office-art/v1/office-pack.glb')
    const glb = inspectGlb(glbBytes, 'office-art/v1/office-pack.glb')
    expect(spatial.report.status).toBe('PASS')
    expect(spatial.inferredUpAxis).toBe('Y')
    expect(glb.statistics?.triangleCount).toBeGreaterThan(0)

    const assets = new Map(manifest.assets.map(asset => [asset.id, asset]))
    const layout = showroomLayout()
    expect(layout.size).toMatchObject({ width: 22, depth: 14, height: 5.8 })
    expect(layout.desks).toHaveLength(12)
    expect(layout.chairs).toHaveLength(12)
    expect(layout.characterSpots).toHaveLength(11)
    expect(layout.desks.filter(desk => desk.occupiedBy)).toHaveLength(11)

    const world = (point: { x: number; y?: number; z: number }): SpatialPoint3 => ({ x: point.x - layout.size.width / 2, y: point.y ?? 0, z: point.z - layout.size.depth / 2 })
    const rect = (value: { x: number; z: number; width: number; depth: number }): SpatialPoint3 => world({ x: value.x + value.width / 2, z: value.z + value.depth / 2 })
    const objects: SpatialObject[] = []
    const place = (id: string, kind: SpatialObject['kind'], position: SpatialPoint3, options: { instanceId?: string; scale?: SpatialPoint3; rotationY?: number; deskId?: string; employeeId?: string; wallId?: string; expectedPosition?: SpatialPoint3; expectedSize?: SpatialPoint3 } = {}) => {
      const record = assets.get(id)
      const node = typeof record?.node === 'string' ? spatial.nodes[record.node] : undefined
      if (!record || !node) throw new Error(`spatial_fixture_asset_missing:${id}`)
      objects.push({
        id: options.instanceId ?? id,
        assetId: id,
        kind,
        bounds: transformAssetBoundsToYUp(node.bounds, position, 'Y', options.scale ?? record.scale, options.rotationY),
        position,
        expectedPosition: options.expectedPosition,
        expectedSize: options.expectedSize ?? manifestSize(record),
        deskId: options.deskId,
        employeeId: options.employeeId,
        wallId: options.wallId,
      })
    }

    place('floor.oak.light', 'floor', { x: 0, y: 0, z: 0 }, { scale: { x: 22 / 12, y: 1, z: 14 / 9 }, expectedSize: { x: 22, y: .12, z: 14 } })
    const northWall = layout.walls.find(wall => wall.side === 'north')!
    const westWall = layout.walls.find(wall => wall.side === 'west')!
    place('wall.brick.loft', 'wall', rect(northWall.bounds), { instanceId: northWall.id, scale: { x: 22 / 12, y: 5.8 / 3.5, z: 1 }, expectedSize: { x: 22, y: 5.8, z: .22 } })
    place('wall.painted', 'wall', rect(westWall.bounds), { instanceId: westWall.id, scale: { x: 14 / 12, y: 5.8 / 3.5, z: 1 }, rotationY: Math.PI / 2, expectedSize: { x: .18, y: 5.8, z: 14 } })

    const partition = layout.partitions[0]
    const partitionPosition = rect(partition.bounds)
    place('partition.glass', 'partition', { x: partitionPosition.x, y: .13, z: partitionPosition.z }, { instanceId: partition.id, scale: { x: 1, y: partition.height / 2.3, z: 1 }, rotationY: Math.PI / 2, expectedSize: { x: .08, y: partition.height, z: partition.bounds.depth } })
    for (const window of layout.windows) {
      // The current wall-center node has a measured local center at Y=1.5 m.
      place('window.frame', 'window', { x: window.position.x - layout.size.width / 2, y: window.position.y - 1.5, z: layout.size.depth / 2 - .28 }, { instanceId: window.id, wallId: window.wallId })
    }

    for (const desk of layout.desks) {
      const deskPosition = world(desk.position)
      const chair = layout.chairs.find(item => item.deskId === desk.deskId)!
      place('desk.modern', 'desk', deskPosition, { instanceId: desk.deskId, deskId: desk.deskId, expectedPosition: deskPosition })
      place('chair.ergonomic', 'chair', world(chair.position), { instanceId: `chair-${desk.deskId}`, deskId: desk.deskId, rotationY: chair.orientation, expectedPosition: world(chair.position) })
      if (desk.occupiedBy) {
        const spot = layout.characterSpots.find(item => item.employeeId === desk.occupiedBy)!
        place('character.base.idle', 'character', world(spot.position), { instanceId: `character-${desk.occupiedBy}`, deskId: desk.deskId, employeeId: desk.occupiedBy, expectedPosition: world(spot.position) })
      }
    }
    for (const plant of layout.plants) place('plant.potted', 'plant', world(plant.position), { instanceId: plant.id, expectedPosition: world(plant.position) })

    const floor = objects.find(object => object.kind === 'floor')!
    const snapshot: SpatialSceneSnapshot = {
      file: 'apps/office/src/office-3d/OfficeScene3D.tsx',
      manifestUpAxis: 'Y',
      geometryUpAxis: spatial.inferredUpAxis,
      rendererAssetUpAxis: 'Y',
      logicalFloorBounds: { minX: -11, maxX: 11, minZ: -7, maxZ: 7 },
      // The renderer's logical contact plane is Y=0; the slab's top face is
      // intentionally thicker than that plane.
      floorSurfaceY: 0,
      objects,
      workstations: layout.desks.map(desk => ({ deskId: desk.deskId, employeeId: desk.occupiedBy, reserved: !desk.occupiedBy })),
      visibleDeskIds: layout.desks.map(desk => desk.deskId),
      visibleEmployeeIds: layout.characterSpots.map(spot => spot.employeeId),
      surfaceMaterials: { floorHasTexture: true, fallbackFloorHasTexture: true, loadedArtReplacesFallback: true, mappingsResolved: true },
    }
    const report = evaluateSpatialQuality(snapshot)
    expect(report.status).toBe('WARNING')
    expect(report.findings.some(finding => finding.severity === 'FAIL')).toBe(false)
    expect(report.findings.map(finding => finding.code)).toContain('MODEL_BOUNDS_MISMATCH')
    expect(report.findings.map(finding => finding.code)).not.toContain('OBJECT_BELOW_FLOOR')
  })
})
