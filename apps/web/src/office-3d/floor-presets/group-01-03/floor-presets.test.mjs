import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.MAO_HYBRID_ROOT ?? resolve(testDirectory, '../../../../../..');
const webRoot = join(projectRoot, 'apps/web');
const vite = await createServer({
  root: webRoot,
  configFile: join(webRoot, 'vite.config.ts'),
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const [presetsModule, worldModule, layoutModule] = await Promise.all([
    vite.ssrLoadModule('/src/office-3d/floor-presets/group-01-03/index.ts'),
    vite.ssrLoadModule('/src/world/floorData.ts'),
    vite.ssrLoadModule('/src/office-layout/validation.ts'),
  ]);
  const { FLOOR_DESIGN_PRESETS, validateFloorDesignPreset } = presetsModule;

  test('maps tower floors 01–03 to the current departments and preserves roster identities', async () => {
    const employees = worldModule.createDemoEmployees();
    const expected = [
      { id: 'floor-01', worldId: 'floor-2', department: 'management', count: 11, desks: 12 },
      { id: 'floor-02', worldId: 'floor-3', department: 'software-development', count: 10, desks: 11 },
      { id: 'floor-03', worldId: 'floor-4', department: 'quality-assurance', count: 9, desks: 11 },
    ];
    assert.equal(FLOOR_DESIGN_PRESETS.length, 3);
    for (const item of expected) {
      const preset = FLOOR_DESIGN_PRESETS.find(value => value.floor.uiFloorId === item.id);
      assert.ok(preset, `missing preset ${item.id}`);
      assert.equal(preset.floor.worldFloorId, item.worldId);
      assert.equal(preset.floor.departmentId, item.department);
      const floorEmployees = employees.filter(employee => employee.floorId === item.worldId);
      assert.equal(preset.roster.employeeCount, item.count);
      assert.equal(preset.layout.desks.length, item.desks);
      assert.deepEqual(preset.roster.employeeIds, floorEmployees.map(employee => employee.employeeId));
      assert.deepEqual(preset.roster.deskIds, worldModule.buildDesks(employees).filter(desk => desk.floorId === item.worldId).map(desk => desk.deskId));
    }
  });

  test('each layout and its furniture pass bounds, aisle, collision and asset checks', async () => {
    const manifest = JSON.parse(await readFile(join(webRoot, 'public/office-art/v1/manifest.json'), 'utf8'));
    const assetIds = new Set(manifest.assets.map(asset => asset.id));
    for (const preset of FLOOR_DESIGN_PRESETS) {
      const layoutResult = layoutModule.validateFloorLayout(preset.layout);
      assert.equal(layoutResult.valid, true, `${preset.floor.uiFloorId}: ${JSON.stringify(layoutResult.issues)}`);
      const geometryResult = validateFloorDesignPreset(preset);
      assert.equal(geometryResult.valid, true, `${preset.floor.uiFloorId}: ${JSON.stringify(geometryResult.issues)}`);
      for (const item of preset.furniture) assert.ok(assetIds.has(item.assetId), `unknown asset ${item.assetId}`);
    }
  });

  test('three floors use distinct room programs, furniture sets and circulation routes', () => {
    const [management, development, qa] = FLOOR_DESIGN_PRESETS;
    assert.notEqual(management.layout.profile, development.layout.profile);
    assert.notEqual(development.layout.profile, qa.layout.profile);
    assert.notDeepEqual(management.zones.map(zone => zone.id), development.zones.map(zone => zone.id));
    assert.notDeepEqual(development.zones.map(zone => zone.id), qa.zones.map(zone => zone.id));
    assert.notDeepEqual(management.layout.desks.map(desk => desk.position), development.layout.desks.map(desk => desk.position));
    assert.notDeepEqual(development.layout.desks.map(desk => desk.position), qa.layout.desks.map(desk => desk.position));
  });
} finally {
  await vite.close();
}
