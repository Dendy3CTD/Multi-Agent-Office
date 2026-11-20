import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const directory = dirname(fileURLToPath(import.meta.url));
const root = process.env.MAO_HYBRID_ROOT ?? resolve(directory, '../../../../../../');
const webRoot = join(root, 'apps/web');
const vite = await createServer({
  root: webRoot,
  configFile: join(webRoot, 'vite.config.ts'),
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const [floor13Module, floor14Module, floor15Module, worldModule, validatorModule, adapterModule] = await Promise.all([
    vite.ssrLoadModule('/src/office-3d/office-v4/floors-13-15/floor-13-security-review.ts'),
    vite.ssrLoadModule('/src/office-3d/office-v4/floors-13-15/floor-14-kitchen-cafe.ts'),
    vite.ssrLoadModule('/src/office-3d/office-v4/floors-13-15/floor-15-lounge-meeting-rooms.ts'),
    vite.ssrLoadModule('/src/world/floorData.ts'),
    vite.ssrLoadModule('/src/office-3d/floor-presets/validate.ts'),
    vite.ssrLoadModule('/src/office-3d/office-v4/floor-id-adapter.ts'),
  ]);
  const presets = [floor13Module.FLOOR_13_SECURITY_REVIEW, floor14Module.FLOOR_14_KITCHEN_CAFE, floor15Module.FLOOR_15_LOUNGE_MEETING_ROOMS];

  test('authors logical floors 12–14 with the contract specialization and correct route mapping', () => {
    assert.deepEqual(presets.map(({ floorId }) => floorId), ['floor-12', 'floor-13', 'floor-14']);
    assert.deepEqual(presets.map(({ specialization }) => specialization), ['security-review', 'kitchen-cafe', 'lounge-meeting-rooms']);
    assert.deepEqual(presets.map(({ floorId }) => adapterModule.officeV4ToWorldFloorId(floorId)), ['floor-13', 'floor-14', 'floor-15']);
    assert.deepEqual(presets.map(({ referenceImage }) => referenceImage), [
      '/design-references/office-v4/floor-13.png',
      '/design-references/office-v4/floor-14.png',
      '/design-references/office-v4/floor-15.png',
    ]);
  });

  test('passes shared geometry validation with the real assigned roster count', () => {
    const employees = worldModule.createDemoEmployees();
    for (const preset of presets) {
      const worldFloorId = adapterModule.officeV4ToWorldFloorId(preset.floorId);
      const floorEmployees = employees.filter(employee => employee.floorId === worldFloorId);
      const issues = validatorModule.validateFloorDesignPreset(preset, floorEmployees.length);
      assert.deepEqual(issues, [], `${preset.floorId}: ${JSON.stringify(issues)}`);
    }
  });

  test('keeps security employee and desk bindings and does not create cafe/lounge workstations', () => {
    const employees = worldModule.createDemoEmployees().filter(employee => employee.floorId === 'floor-13');
    const security = presets[0];
    assert.equal(security.workplaces.length, 10);
    for (const employee of employees) {
      const workplace = security.workplaces.find(({ employeeId }) => employeeId === employee.employeeId);
      assert.ok(workplace, `missing employee ${employee.employeeId}`);
      assert.equal(workplace.deskId, employee.deskId);
    }
    assert.equal(security.workplaces.filter(({ employeeId }) => !employeeId).length, 1);
    assert.equal(presets[1].workplaces.length, 0);
    assert.equal(presets[2].workplaces.length, 0);
  });

  test('uses distinct non-office programs and only registered shared asset IDs', async () => {
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(join(webRoot, 'public/office-art/v1/manifest.json'), 'utf8'));
    const knownAssets = new Set(manifest.assets.map(({ id }) => id));
    const { PROCEDURAL_OFFICE_ASSET_IDS } = await vite.ssrLoadModule('/src/office-art/procedural-asset-ids.ts');
    for (const id of PROCEDURAL_OFFICE_ASSET_IDS) knownAssets.add(id);
    for (const preset of presets) {
      for (const placement of [...preset.furniture, ...preset.decor]) assert.ok(knownAssets.has(placement.asset), `${preset.floorId}: ${placement.asset}`);
    }
    assert.notDeepEqual(presets[1].furniture.map(({ asset }) => asset), presets[2].furniture.map(({ asset }) => asset));
    assert.ok(presets[1].furniture.some(({ asset }) => asset === 'equipment.espresso-machine'));
    assert.ok(presets[1].furniture.some(({ asset }) => asset === 'equipment.cafe-counter'));
    assert.ok(presets[2].furniture.some(({ asset }) => asset === 'furniture.pool-table'));
    assert.ok(presets[2].furniture.some(({ asset }) => asset === 'furniture.foosball'));
  });
} finally {
  await vite.close();
}
