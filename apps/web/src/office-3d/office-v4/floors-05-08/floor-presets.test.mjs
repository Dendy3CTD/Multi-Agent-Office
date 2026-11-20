import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  const [presetsModule, floorIdModule, worldModule, validatorModule, proceduralAssetModule, proceduralLibraryModule] = await Promise.all([
    vite.ssrLoadModule('/src/office-3d/office-v4/floors-05-08/index.ts'),
    vite.ssrLoadModule('/src/office-3d/office-v4/floor-id-adapter.ts'),
    vite.ssrLoadModule('/src/world/floorData.ts'),
    vite.ssrLoadModule('/src/office-3d/floor-presets/validate.ts'),
    vite.ssrLoadModule('/src/office-art/procedural-asset-ids.ts'),
    vite.ssrLoadModule('/src/office-art/procedural-library.ts'),
  ])
  const seededEmployees = worldModule.createDemoEmployees()
  const companyIdBySeedId = new Map([['employee-engineer', 'engineer'], ['employee-analyst', 'analyst']])
  const employeeId = id => companyIdBySeedId.get(id) ?? id
  const employees = seededEmployees.map(employee => ({ ...employee, employeeId: employeeId(employee.employeeId) }))
  const desks = worldModule.buildDesks(seededEmployees).map(desk => ({ ...desk, ...(desk.occupiedBy ? { occupiedBy: employeeId(desk.occupiedBy) } : {}) }))
  const presets = presetsModule.createOfficeV4Presets(employees, desks)
  const expected = [
    { floorId: 'floor-04', worldFloorId: 'floor-5', specialization: 'engineering-electronics', count: 10 },
    { floorId: 'floor-05', worldFloorId: 'floor-6', specialization: 'cad-3d', count: 9 },
    { floorId: 'floor-06', worldFloorId: 'floor-7', specialization: 'research-analytics', count: 10 },
    { floorId: 'floor-07', worldFloorId: 'floor-8', specialization: 'documentation', count: 9 },
  ]

  test('creates the four logical V4 floors with the correct department and world mapping', () => {
    assert.equal(presets.length, 4)
    for (const item of expected) {
      const preset = presets.find(candidate => candidate.floorId === item.floorId)
      assert.ok(preset, `missing ${item.floorId}`)
      assert.equal(preset.specialization, item.specialization)
      assert.equal(floorIdModule.officeV4ToWorldFloorId(preset.floorId), item.worldFloorId)
      assert.equal(preset.workplaces.filter(place => place.employeeId).length, item.count)
      assert.equal(preset.workplaces.length, 10, 'each floor has ten directory-backed desk slots')
    }
  })

  test('preserves each employee and desk identity from the supplied directory layout', () => {
    for (const item of expected) {
      const preset = presets.find(candidate => candidate.floorId === item.floorId)
      const floorEmployees = employees.filter(employee => employee.departmentId === item.specialization)
      const floorDesks = desks.filter(desk => desk.floorId === item.worldFloorId)
      assert.deepEqual(
        preset.workplaces.filter(place => place.employeeId).map(({ employeeId, deskId }) => ({ employeeId, deskId })),
        floorEmployees.map(employee => ({ employeeId: employee.employeeId, deskId: employee.deskId })),
      )
      assert.deepEqual(preset.workplaces.map(place => place.deskId), floorDesks.map(desk => desk.deskId))
      assert.equal(new Set(preset.workplaces.map(place => place.deskId)).size, 10)
    }
    const allEmployeeIds = presets.flatMap(preset => preset.workplaces.flatMap(place => place.employeeId ? [place.employeeId] : []))
    assert.equal(new Set(allEmployeeIds).size, allEmployeeIds.length)
  })

  test('does not invent or omit employees from the Company catalog for these departments', async () => {
    const company = JSON.parse(await readFile(join(projectRoot, 'packages/company/src/catalog.json'), 'utf8'))
    const departmentByProfession = new Map(company.professions.map(profession => [profession.id, profession.departmentId]))
    for (const item of expected) {
      const preset = presets.find(candidate => candidate.floorId === item.floorId)
      const catalogEmployeeIds = company.employees
        .filter(employee => departmentByProfession.get(employee.profile.professionId) === item.specialization)
        .map(employee => employee.profile.id)
        .sort()
      const authoredEmployeeIds = preset.workplaces.flatMap(place => place.employeeId ? [place.employeeId] : []).sort()
      assert.deepEqual(authoredEmployeeIds, catalogEmployeeIds, item.specialization)
    }
  })

  test('binds non-default directory desk IDs only through an explicit slot map', () => {
    const deskSlotById = new Map()
    const remapDeskId = deskId => deskId.replace(/^desk-floor-(\d+)-(\d+)$/, 'directory-seat-$1-$2')
    const remappedDesks = desks.map(desk => {
      const deskId = remapDeskId(desk.deskId)
      deskSlotById.set(deskId, Number(desk.deskId.slice(-2)))
      return { ...desk, deskId }
    })
    const remappedEmployees = employees.map(employee => ({ ...employee, deskId: remapDeskId(employee.deskId) }))
    const remappedPresets = presetsModule.createOfficeV4Presets(remappedEmployees, remappedDesks, { deskSlotById })
    for (const preset of remappedPresets) {
      const worldFloorId = floorIdModule.officeV4ToWorldFloorId(preset.floorId)
      const expectedDeskIds = remappedDesks.filter(desk => desk.floorId === worldFloorId).map(desk => desk.deskId)
      assert.deepEqual(preset.workplaces.map(place => place.deskId).sort(), expectedDeskIds.sort())
    }
  })

  test('passes floor geometry, aisle, capacity, and shared-asset validation', async () => {
    const manifest = JSON.parse(await readFile(join(webRoot, 'public/office-art/v1/manifest.json'), 'utf8'))
    const assetIds = new Set([...manifest.assets.map(asset => asset.id), ...proceduralAssetModule.PROCEDURAL_OFFICE_ASSET_IDS])
    const proceduralLibrary = proceduralLibraryModule.createProceduralOfficeAssetLibrary()
    const usedProceduralAssets = new Set()
    for (const preset of presets) {
      const employeeCount = preset.workplaces.filter(place => place.employeeId).length
      const issues = validatorModule.validateFloorDesignPreset(preset, employeeCount)
      assert.deepEqual(issues, [], `${preset.floorId}: ${JSON.stringify(issues)}`)
      const usedAssets = new Set([...preset.furniture, ...preset.decor].map(placement => placement.asset))
      for (const workplace of preset.workplaces) {
        const deskAsset = workplace.kind === 'lab' ? 'desk.lab' : workplace.kind === 'cad' ? 'desk.cad' : workplace.kind === 'focus' ? 'desk.focus' : 'desk.modern'
        usedAssets.add(deskAsset)
        for (const equipment of workplace.equipment ?? []) usedAssets.add(equipment)
      }
      for (const assetId of usedAssets) {
        assert.ok(assetIds.has(assetId), `${preset.floorId}: unknown asset ${assetId}`)
        if (!proceduralAssetModule.isProceduralOfficeAsset(assetId)) {
          const asset = manifest.assets.find(candidate => candidate.id === assetId && candidate.type === 'model')
          assert.ok(asset, `${preset.floorId}: manifest model missing for ${assetId}`)
          await readFile(join(webRoot, 'public', asset.url.replace(/^\/+/, '')))
        }
        if (proceduralAssetModule.isProceduralOfficeAsset(assetId)) usedProceduralAssets.add(assetId)
      }
    }
    for (const assetId of usedProceduralAssets) {
      const model = proceduralLibrary.create(assetId)
      assert.ok(model.children.length > 0, `procedural model ${assetId} is registered but empty`)
    }
    proceduralLibrary.dispose()
  })

  test('uses distinct floor programs, layout, material, and lighting', () => {
    assert.equal(new Set(presets.map(preset => preset.specialization)).size, 4)
    assert.equal(new Set(presets.map(preset => preset.theme)).size, 4)
    assert.equal(new Set(presets.map(preset => preset.materials.featureWall)).size, 4)
    assert.equal(new Set(presets.map(preset => preset.zones.map(zone => zone.id).join('|'))).size, 4)
    assert.equal(new Set(presets.map(preset => preset.workplaces.map(place => `${place.x},${place.z}`).join('|'))).size, 4)
  })

  test('keeps the south elevator connected to the desk-bank cross aisles', () => {
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.z < b.z + b.depth && a.z + a.depth > b.z
    for (const preset of presets) {
      const elevator = preset.entrances.find(entrance => entrance.kind === 'elevator')
      const eastSpine = preset.aisles[1]
      const entryCrossAisle = preset.aisles[0]
      const centralSpine = preset.aisles[4]
      assert.ok(elevator && eastSpine && entryCrossAisle && centralSpine)
      const elevatorApproach = { x: elevator.offset, z: 0, width: elevator.width, depth: .8 }
      assert.ok(overlaps(elevatorApproach, eastSpine), `${preset.floorId}: elevator is disconnected from the east aisle`)
      assert.ok(overlaps(eastSpine, entryCrossAisle), `${preset.floorId}: south aisle is disconnected from the entry route`)
      for (const crossAisle of preset.aisles.slice(2, 4)) {
        assert.ok(overlaps(crossAisle, centralSpine), `${preset.floorId}: desk bank cross aisle is disconnected`)
      }
      assert.ok(overlaps(entryCrossAisle, centralSpine), `${preset.floorId}: central aisle is disconnected from the entrance`)
    }
  })
} finally {
  await vite.close()
}
