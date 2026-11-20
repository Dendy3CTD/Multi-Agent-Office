import { buildDesks, createDemoEmployees } from '../../../world'
import type { FloorDesignPreset, FloorPlacementPreset } from '../../floor-presets/types'
import { baseLighting, commonAisles, commonZones, departmentWorkplaces, elevatorEntrance, loftMaterials, northWindows, referenceCamera } from './shared'

const employees = createDemoEmployees()
const workplaces = departmentWorkplaces('floor-10', 'finance-estimates', employees, buildDesks(employees), { kind: 'standard' })
const placed = (asset: FloorPlacementPreset['asset'], id: string, x: number, z: number, options: Partial<FloorPlacementPreset> = {}): FloorPlacementPreset => ({ asset, id, x, z, ...options })

export const FLOOR_10_FINANCE: FloorDesignPreset = {
  schemaVersion: 1, floorId: 'floor-09', presetId: 'office-v4-finance-estimates', specialization: 'finance-estimates',
  referenceImage: '/design-references/office-v4/floor-10.png', theme: 'custom',
  bounds: { width: 22, depth: 14, height: 5.8 },
  zones: [
    ...commonZones('finance'),
    { id: 'finance-secure-archive', kind: 'service', bounds: { x: .35, z: 7.8, width: 2.5, depth: 4.1 }, label: 'Estimates and contract archive' },
    { id: 'finance-planning-table', kind: 'meeting', bounds: { x: 6.2, z: .65, width: 5.3, depth: 3.4 }, label: 'Cost planning and calculation' },
    { id: 'finance-approval-suite', kind: 'meeting', bounds: { x: 13.6, z: .65, width: 5.4, depth: 3.7 }, label: 'Estimate approval' },
  ],
  rooms: [
    { id: 'finance-glass-approval-room', kind: 'meeting', bounds: { x: 13.7, z: .7, width: 5.45, depth: 3.65 }, capacity: 8, privacy: 'glass', material: 'bronze-glass', door: { wall: 'north', offset: 2.15, width: 1.05, kind: 'door' } },
  ],
  barriers: [], windows: northWindows('finance'), entrances: [elevatorEntrance], materials: loftMaterials,
  lighting: { ...baseLighting, ambient: '#e0e7e7', key: '#fff2df', fill: '#c8d9e0', fixtures: [
    { id: 'finance-planning-pendant', kind: 'point', x: 8.9, y: 4.2, z: 2.3, color: '#f6d5a1', intensity: 1.05, distance: 6 },
    { id: 'finance-archive-light', kind: 'point', x: 1.4, y: 3.3, z: 10, color: '#f4dda9', intensity: .7, distance: 3.5 },
    { id: 'finance-approval-wash', kind: 'spot', x: 17, y: 4.5, z: 3.5, color: '#e3c17d', intensity: 1, distance: 5, angle: .6, target: [17, 1.8, 3] },
  ] },
  furniture: [
    placed('table.meeting', 'finance-calculation-table', 8.75, 2.3),
    placed('chair.meeting', 'finance-calculation-chair-west', 6.8, 2.3),
    placed('chair.meeting', 'finance-calculation-chair-east', 10.7, 2.3),
    placed('chair.meeting', 'finance-calculation-chair-front', 8.75, 1.3),
    placed('chair.meeting', 'finance-calculation-chair-back', 8.75, 3.25),
    placed('equipment.archive-shelf', 'finance-archive-shelf-a', 1.2, 8.15),
    placed('equipment.archive-shelf', 'finance-archive-shelf-b', 1.2, 10.1),
    placed('filing.cabinet', 'finance-secure-file-cabinet', 2.15, 12.25),
    placed('equipment.analytics-display', 'finance-variance-display', 20.65, 8.2, { y: 2.15, rotationY: -Math.PI / 2, interaction: { kind: 'display', targetId: 'finance-variance-analysis' } }),
    placed('equipment.whiteboard-display', 'finance-forecast-display', 20.65, 11.15, { y: 2.15, rotationY: -Math.PI / 2, interaction: { kind: 'display', targetId: 'finance-forecast-review' } }),
    ...workplaces.filter(place => place.employeeId).map(place => placed('monitor.dual', `finance-monitor-${place.deskId}`, place.x, place.z - .18, { y: 1.18, deskId: place.deskId })),
    ...[4.7, 8, 11.3, 14.6, 17.9].map((x, index) => placed('pendant.led', `finance-work-pendant-${index + 1}`, x, 7.25, { y: 4.65 })),
  ],
  decor: [
    placed('decor.wall.sconce', 'finance-archive-sconce', .55, 13.65, { y: 2.6 }),
    placed('decor.wall.sconce', 'finance-approval-sconce', 15.7, 13.65, { y: 2.6 }),
  ],
  workplaces, aisles: commonAisles(), camera: referenceCamera,
}
