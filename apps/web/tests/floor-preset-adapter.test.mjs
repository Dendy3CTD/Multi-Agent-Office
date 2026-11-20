import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let registry
let source
let coordinates

before(async () => {
  vite = await createServer({ configFile: './vite.config.ts', server: { middlewareMode: true }, appType: 'custom' })
  registry = await vite.ssrLoadModule('/src/office-3d/floor-presets/index.ts')
  source = await vite.ssrLoadModule('/src/office-3d/floor-presets/group-01-03/index.ts')
  coordinates = await vite.ssrLoadModule('/src/office-3d/floor-presets/coordinates.ts')
})

after(async () => { await vite?.close() })

test('authored floors 01–03 adapt to the shared renderer without losing roster or scene coordinates', () => {
  assert.deepEqual(coordinates.floorPlanPointToWorld({ x: 0, y: 1.1, z: 0 }, { width: 22, depth: 14 }), [-11, 1.1, -7])
  assert.deepEqual(coordinates.floorPlanPointToWorld({ x: 22, z: 14 }, { width: 22, depth: 14 }), [11, 0, 7])
  const expected = [
    { ui: 'floor-01', world: 'floor-2', count: 11, seats: 12, id: 'floor-01-management-v2' },
    { ui: 'floor-02', world: 'floor-3', count: 10, seats: 11, id: 'floor-02-software-development-v2' },
    { ui: 'floor-03', world: 'floor-4', count: 9, seats: 11, id: 'floor-03-quality-assurance-v2' },
  ]
  for (const [index, item] of expected.entries()) {
    const local = source.FLOOR_DESIGN_PRESETS[index]
    const resolved = registry.resolveFloorDesignPreset(item.world)
    assert.equal(resolved.status, 'authored')
    assert.equal(resolved.missingFloorPreset, false)
    assert.equal(resolved.preset.presetId, item.id)
    assert.equal(resolved.preset.floorId, item.world)
    assert.equal(resolved.preset.workplaces.length, item.seats)
    assert.equal(new Set(resolved.preset.workplaces.map(place => place.id)).size, item.seats)
    assert.deepEqual(resolved.preset.workplaces.map(place => place.id), local.roster.deskIds)
    assert.deepEqual(local.roster.reservedDeskIds, local.layout.desks.filter(desk => desk.reserved).map(desk => desk.deskId))
    assert.equal(local.roster.employeeIds.length, item.count)
    assert.equal(resolved.preset.bounds.width, 22)
    assert.equal(resolved.preset.bounds.depth, 14)
    assert.equal(resolved.preset.workplaces[0].x, local.layout.desks[0].position.x)
    assert.equal(resolved.preset.workplaces[0].z, local.layout.desks[0].position.z)
    assert.ok(resolved.preset.rooms.length > 0)
    assert.ok(resolved.preset.barriers.length + resolved.preset.rooms.length > 0)
    assert.ok(resolved.preset.windows.length > 0)
    assert.ok(resolved.preset.entrances.length > 0)
    assert.ok(resolved.preset.furniture.length > 0)
    assert.ok(resolved.preset.aisles.length > 0)
    assert.deepEqual(registry.validateFloorDesignPreset(resolved.preset, item.count), [])
  }
})
