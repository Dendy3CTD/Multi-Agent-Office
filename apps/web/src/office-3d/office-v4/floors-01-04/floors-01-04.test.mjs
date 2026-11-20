import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = process.env.MAO_HYBRID_ROOT ?? resolve(testDirectory, '../../../../../../')
const webRoot = join(projectRoot, 'apps/web')
const vite = await createServer({
  root: webRoot,
  configFile: join(webRoot, 'vite.config.ts'),
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
})

try {
  const [presetsModule, floorIdModule, liveAdapter, worldModule, validationModule, assetIdsModule] = await Promise.all([
    vite.ssrLoadModule('/src/office-3d/office-v4/floors-01-04/index.ts'),
    vite.ssrLoadModule('/src/office-3d/office-v4/floor-id-adapter.ts'),
    vite.ssrLoadModule('/src/integration/live-adapter.ts'),
    vite.ssrLoadModule('/src/world/floorData.ts'),
    vite.ssrLoadModule('/src/office-3d/floor-presets/validate.ts'),
    vite.ssrLoadModule('/src/office-art/procedural-asset-ids.ts'),
  ])
  const { FLOOR_01_TO_04_PRESETS } = presetsModule
  const { officeV4ToWorldFloorId } = floorIdModule
  const { worldEmployeesFromLive } = liveAdapter
  const { buildDesks, FLOOR_METADATA } = worldModule
  const { validateFloorDesignPreset } = validationModule
  const { createDefaultRoster } = await import(pathToFileURL(join(projectRoot, 'packages/company/src/index.js')).href)
  const roster = createDefaultRoster()
  const worldEmployees = worldEmployeesFromLive(roster.employees.map(employee => ({
    id: employee.id,
    name: employee.displayName,
    profession: employee.professionId,
    professionId: employee.professionId,
    departmentId: employee.departmentId,
    floorId: '',
    status: 'active',
  })))
  const directoryDesks = buildDesks(worldEmployees)
  const artManifest = JSON.parse(await readFile(join(webRoot, 'public/office-art/v1/manifest.json'), 'utf8'))
  const allowedAssetIds = new Set([
    ...artManifest.assets.map(asset => asset.id),
    ...assetIdsModule.PROCEDURAL_OFFICE_ASSET_IDS,
  ])

  test('authors exactly UI floors 01–04 with the required V4 logical/world mapping', () => {
    const expected = [
      { ui: 1, floorId: 'floor-00', worldId: 'floor-1', specialization: 'lobby-reception', departmentId: undefined, employees: 0 },
      { ui: 2, floorId: 'floor-01', worldId: 'floor-2', specialization: 'management', departmentId: 'management', employees: 11 },
      { ui: 3, floorId: 'floor-02', worldId: 'floor-3', specialization: 'software-development', departmentId: 'software-development', employees: 10 },
      { ui: 4, floorId: 'floor-03', worldId: 'floor-4', specialization: 'quality-assurance', departmentId: 'quality-assurance', employees: 9 },
    ]
    assert.equal(FLOOR_01_TO_04_PRESETS.length, expected.length)
    for (const item of expected) {
      const preset = FLOOR_01_TO_04_PRESETS.find(candidate => candidate.floorId === item.floorId)
      assert.ok(preset, `missing V4 UI floor ${item.ui}`)
      assert.equal(preset.specialization, item.specialization)
      assert.equal(officeV4ToWorldFloorId(preset.floorId), item.worldId)
      assert.equal(preset.referenceImage, `/design-references/office-v4/floor-${String(item.ui).padStart(2, '0')}.png`)
      const actualCount = item.departmentId ? roster.employees.filter(employee => employee.departmentId === item.departmentId).length : 0
      assert.equal(actualCount, item.employees, `catalog count for ${item.specialization}`)
    }
  })

  test('preserves current employee-to-desk assignments and unoccupied directory seats', () => {
    const seenEmployees = new Set()
    const seenDesks = new Set()
    for (const preset of FLOOR_01_TO_04_PRESETS) {
      const worldId = officeV4ToWorldFloorId(preset.floorId)
      const expectedDeskIds = directoryDesks.filter(desk => desk.floorId === worldId).map(desk => desk.deskId)
      const expectedBindings = new Map(worldEmployees
        .filter(employee => employee.floorId === worldId)
        .map(employee => [employee.deskId, employee.employeeId]))
      const actualDeskIds = preset.workplaces.map(workplace => workplace.deskId ?? workplace.id)
      const actualBindings = new Map(preset.workplaces
        .filter(workplace => workplace.employeeId)
        .map(workplace => [workplace.deskId ?? workplace.id, workplace.employeeId]))
      assert.deepEqual(actualDeskIds, expectedDeskIds, `${worldId} desk IDs differ from the office directory`)
      assert.deepEqual(actualBindings, expectedBindings, `${preset.specialization} employee bindings differ from the current live adapter`)
      assert.equal(preset.workplaces.length, FLOOR_METADATA.find(floor => floor.id === worldId).seatCount)
      for (const workplace of preset.workplaces) {
        const deskId = workplace.deskId ?? workplace.id
        assert.ok(!seenDesks.has(deskId), `duplicate desk ID ${deskId}`)
        seenDesks.add(deskId)
        if (!workplace.employeeId) continue
        assert.ok(!seenEmployees.has(workplace.employeeId), `duplicate employee ID ${workplace.employeeId}`)
        seenEmployees.add(workplace.employeeId)
        const employee = roster.employees.find(record => record.id === workplace.employeeId)
        assert.ok(employee, `employee ${workplace.employeeId} is missing from the directory`)
        assert.equal(employee.departmentId, preset.specialization)
      }
    }
    assert.equal(seenEmployees.size, 30)
  })

  test('passes shared geometry, asset, capacity, and accessible aisle checks', () => {
    for (const preset of FLOOR_01_TO_04_PRESETS) {
      const employeeCount = preset.specialization === 'lobby-reception'
        ? 0
        : roster.employees.filter(employee => employee.departmentId === preset.specialization).length
      const issues = validateFloorDesignPreset(preset, employeeCount)
      assert.deepEqual(issues, [], `${preset.specialization}: ${JSON.stringify(issues)}`)
      assert.ok(preset.workplaces.length >= employeeCount)
      for (const placement of [...preset.furniture, ...preset.decor]) {
        assert.ok(allowedAssetIds.has(placement.asset), `${preset.specialization} uses unregistered asset ${placement.asset}`)
      }
      assert.ok(preset.aisles.length >= 3)
      assert.ok(preset.aisles.every(aisle => aisle.width >= 1 && aisle.depth >= 1), `${preset.specialization} has a narrow primary route`)
      for (const entrance of preset.entrances) {
        const touchesEntrance = preset.aisles.some(aisle => {
          if (entrance.wall === 'south') {
            const center = entrance.offset + entrance.width / 2
            return aisle.z <= 0.001 && center >= aisle.x && center <= aisle.x + aisle.width
          }
          if (entrance.wall === 'east') {
            const center = entrance.offset + entrance.width / 2
            return aisle.x + aisle.width >= preset.bounds.width - 0.001 && center >= aisle.z && center <= aisle.z + aisle.depth
          }
          return false
        })
        assert.ok(touchesEntrance, `${preset.specialization} has no accessible aisle to ${entrance.id}`)
      }
      const touches = (a, b) => a.x <= b.x + b.width + 0.001 && a.x + a.width + 0.001 >= b.x
        && a.z <= b.z + b.depth + 0.001 && a.z + a.depth + 0.001 >= b.z
      const connected = new Set()
      const queue = [0]
      while (queue.length) {
        const index = queue.shift()
        if (connected.has(index)) continue
        connected.add(index)
        preset.aisles.forEach((candidate, candidateIndex) => {
          if (!connected.has(candidateIndex) && touches(preset.aisles[index], candidate)) queue.push(candidateIndex)
        })
      }
      assert.equal(connected.size, preset.aisles.length, `${preset.specialization} circulation network is disconnected`)
    }
  })

  test('keeps the four authored programmes visually distinct', () => {
    const signatures = FLOOR_01_TO_04_PRESETS.map(preset => [
      preset.zones.map(zone => zone.id).join(','),
      preset.workplaces.map(workplace => workplace.kind).join(','),
      [...preset.furniture, ...preset.decor].map(placement => placement.asset).sort().join(','),
    ].join('|'))
    assert.equal(new Set(signatures).size, FLOOR_01_TO_04_PRESETS.length)
    assert.ok(FLOOR_01_TO_04_PRESETS[0].furniture.some(item => item.asset === 'desk.reception'))
    assert.ok(FLOOR_01_TO_04_PRESETS[1].rooms.some(room => room.kind === 'leadership'))
    assert.ok(FLOOR_01_TO_04_PRESETS[2].furniture.some(item => item.asset === 'monitor.dual'))
    assert.ok([...FLOOR_01_TO_04_PRESETS[2].furniture, ...FLOOR_01_TO_04_PRESETS[2].decor].some(item => item.asset === 'furniture.acoustic-focus-pod'))
    assert.ok(FLOOR_01_TO_04_PRESETS[3].workplaces.some(workplace => workplace.kind === 'lab'))
    assert.ok(FLOOR_01_TO_04_PRESETS[3].furniture.some(item => item.asset === 'equipment.test-bench'))
  })
} finally {
  await vite.close()
}
