import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = process.env.MAO_HYBRID_ROOT ?? resolve(testDirectory, '../../../../../..')
const webRoot = join(projectRoot, 'apps/web')
const vite = await createServer({ root: webRoot, configFile: join(webRoot, 'vite.config.ts'), logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' })

try {
  const [floorModule, worldModule, mappingModule, validatorModule, assetIdsModule] = await Promise.all([
    vite.ssrLoadModule('/src/office-3d/office-v4/floors-09-12/index.ts'),
    vite.ssrLoadModule('/src/world/floorData.ts'),
    vite.ssrLoadModule('/src/office-3d/office-v4/floor-id-adapter.ts'),
    vite.ssrLoadModule('/src/office-3d/floor-presets/validate.ts'),
    vite.ssrLoadModule('/src/office-art/procedural-asset-ids.ts'),
  ])
  const { FLOOR_09_TO_12_PRESETS } = floorModule
  const employees = worldModule.createDemoEmployees()
  const allDesks = worldModule.buildDesks(employees)
  const references = [
    { floorId: 'floor-08', worldFloorId: 'floor-9', specialization: 'design', departmentId: 'design', referenceImage: '/design-references/office-v4/floor-09.png' },
    { floorId: 'floor-09', worldFloorId: 'floor-10', specialization: 'finance-estimates', departmentId: 'finance-estimates', referenceImage: '/design-references/office-v4/floor-10.png' },
    { floorId: 'floor-10', worldFloorId: 'floor-11', specialization: 'devops', departmentId: 'devops', referenceImage: '/design-references/office-v4/floor-11.png' },
    { floorId: 'floor-11', worldFloorId: 'floor-12', specialization: 'automation-integrations', departmentId: 'automation-integrations', referenceImage: '/design-references/office-v4/floor-12.png' },
  ]

  test('exports the four logical V4 floors with exact world routes and references', () => {
    assert.equal(FLOOR_09_TO_12_PRESETS.length, 4)
    for (const expected of references) {
      const preset = FLOOR_09_TO_12_PRESETS.find(item => item.floorId === expected.floorId)
      assert.ok(preset, `missing ${expected.floorId}`)
      assert.equal(preset.specialization, expected.specialization)
      assert.equal(mappingModule.officeV4ToWorldFloorId(preset.floorId), expected.worldFloorId)
      assert.equal(preset.referenceImage, expected.referenceImage)
    }
  })

  test('binds each real employee and reserve desk by directory identity', () => {
    const seenEmployees = new Set()
    const seenDesks = new Set()
    for (const expected of references) {
      const preset = FLOOR_09_TO_12_PRESETS.find(item => item.floorId === expected.floorId)
      const floorEmployees = employees.filter(employee => employee.floorId === expected.worldFloorId)
      const floorDesks = allDesks.filter(desk => desk.floorId === expected.worldFloorId)
      assert.equal(preset.workplaces.length, floorDesks.length, `${expected.floorId} keeps every directory desk`)
      assert.equal(preset.workplaces.filter(place => place.employeeId).length, floorEmployees.length)
      for (const employee of floorEmployees) {
        const binding = preset.workplaces.find(place => place.deskId === employee.deskId)
        assert.ok(binding, `missing desk ${employee.deskId}`)
        assert.equal(binding.employeeId, employee.employeeId)
        assert.equal(employee.departmentId, expected.departmentId)
        assert.ok(!seenEmployees.has(employee.employeeId), `duplicate employee ${employee.employeeId}`)
        seenEmployees.add(employee.employeeId)
      }
      assert.deepEqual(new Set(preset.workplaces.map(place => place.deskId)), new Set(floorDesks.map(desk => desk.deskId)))
      for (const workplace of preset.workplaces) {
        assert.ok(!seenDesks.has(workplace.deskId), `duplicate desk ${workplace.deskId}`)
        seenDesks.add(workplace.deskId)
      }
    }
  })

  test('passes shared geometry, capacity, circulation, and asset validation', async () => {
    const manifest = JSON.parse(await readFile(join(webRoot, 'public/office-art/v1/manifest.json'), 'utf8'))
    const knownAssets = new Set([
      ...assetIdsModule.PROCEDURAL_OFFICE_ASSET_IDS,
      ...manifest.assets.map(asset => asset.id),
      'keyboard', 'decor.wall.sconce', 'pendant.led',
    ])
    for (const preset of FLOOR_09_TO_12_PRESETS) {
      const worldFloorId = mappingModule.officeV4ToWorldFloorId(preset.floorId)
      const count = employees.filter(employee => employee.floorId === worldFloorId).length
      const issues = validatorModule.validateFloorDesignPreset(preset, count)
      assert.deepEqual(issues, [], `${preset.floorId}: ${JSON.stringify(issues)}`)
      for (const placement of [...preset.furniture, ...preset.decor]) assert.ok(knownAssets.has(placement.asset), `${preset.floorId}: unknown asset ${placement.asset}`)
      for (const workplace of preset.workplaces) for (const asset of workplace.equipment ?? []) assert.ok(knownAssets.has(asset), `${preset.floorId}: unknown workplace equipment ${asset}`)
    }
  })

  test('each department has a distinct specialized 3D program', () => {
    const bySpecialization = new Map(FLOOR_09_TO_12_PRESETS.map(preset => [preset.specialization, preset]))
    assert.ok(bySpecialization.get('design').workplaces.some(place => place.equipment?.includes('equipment.graphics-tablet')))
    assert.ok(bySpecialization.get('design').furniture.some(item => item.asset === 'furniture.moodboard'))
    assert.ok(bySpecialization.get('finance-estimates').furniture.some(item => item.asset === 'equipment.archive-shelf'))
    assert.ok(bySpecialization.get('finance-estimates').furniture.some(item => item.asset === 'equipment.analytics-display'))
    assert.ok(bySpecialization.get('devops').furniture.some(item => item.asset === 'equipment.server-rack'))
    assert.ok(bySpecialization.get('devops').furniture.some(item => item.asset === 'equipment.network-rack'))
    assert.ok(bySpecialization.get('automation-integrations').furniture.some(item => item.asset === 'equipment.whiteboard-display'))
    assert.ok(bySpecialization.get('automation-integrations').furniture.some(item => item.asset === 'furniture.whiteboard'))
    assert.equal(new Set(FLOOR_09_TO_12_PRESETS.map(preset => preset.presetId)).size, 4)
  })
} finally {
  await vite.close()
}
