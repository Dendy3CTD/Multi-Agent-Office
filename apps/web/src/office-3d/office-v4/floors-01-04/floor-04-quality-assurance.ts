import type { FloorDesignPreset } from '../../floor-presets/types'
import { CAMERA, DEPARTMENT_AISLES, FLOOR_BOUNDS, LOFT_MATERIALS, monitorPlacements, NORTH_WINDOWS, prop, workplace, localLights } from './shared'

const positions = [
  { number: 1, employeeId: 'employee-019', x: 3.0, z: 10.8, kind: 'lab' as const },
  { number: 2, employeeId: 'employee-020', x: 5.5, z: 10.8, kind: 'lab' as const },
  { number: 3, employeeId: 'employee-021', x: 8.0, z: 10.8, kind: 'lab' as const },
  { number: 4, employeeId: 'employee-022', x: 10.5, z: 10.8, kind: 'lab' as const },
  { number: 5, employeeId: 'employee-023', x: 13.0, z: 10.8, kind: 'lab' as const },
  { number: 6, employeeId: 'employee-024', x: 3.0, z: 6.3, kind: 'standard' as const },
  { number: 7, employeeId: 'employee-025', x: 5.5, z: 6.3, kind: 'standard' as const },
  { number: 8, employeeId: 'employee-026', x: 8.0, z: 6.3, kind: 'standard' as const },
  { number: 9, employeeId: 'employee-027', x: 10.5, z: 6.3, kind: 'standard' as const },
  { number: 10, employeeId: undefined, x: 13.0, z: 6.3, kind: 'standard' as const },
  { number: 11, employeeId: undefined, x: 15.5, z: 6.3, kind: 'standard' as const },
]

const workplaces = positions.map(item => workplace('floor-4', item.number, item.employeeId, item.x, item.z, item.kind, item.kind === 'lab' ? ['equipment.oscilloscope'] : []))

export const FLOOR_04_QUALITY_ASSURANCE: FloorDesignPreset = {
  schemaVersion: 1,
  floorId: 'floor-03',
  presetId: 'office-v4-floor-04-quality-assurance-v1',
  specialization: 'quality-assurance',
  referenceImage: '/design-references/office-v4/floor-04.png',
  theme: 'industrial',
  bounds: FLOOR_BOUNDS,
  zones: [
    { id: 'qa-glass-review', kind: 'meeting', bounds: { x: 0.6, z: 0.65, width: 6.6, depth: 3.9 }, label: 'Glass test review room', material: 'bronze-glass' },
    { id: 'qa-window-test-benches', kind: 'work', bounds: { x: 1.0, z: 10.1, width: 13.5, depth: 3.5 }, label: 'Device validation benches', material: 'sage-ceramic' },
    { id: 'qa-central-workstations', kind: 'work', bounds: { x: 1.8, z: 5.9, width: 15.0, depth: 2.6 }, label: 'QA workstation banks', material: 'oak-floor' },
    { id: 'qa-defect-triage', kind: 'meeting', bounds: { x: 8.1, z: 1.0, width: 6.3, depth: 3.0 }, label: 'Defect triage', material: 'clay-textile' },
    { id: 'qa-results-review', kind: 'service', bounds: { x: 14.0, z: 4.8, width: 4.2, depth: 3.8 }, label: 'Results verification display', material: 'graphite-metal' },
    { id: 'qa-bug-discussion', kind: 'lounge', bounds: { x: 14.5, z: 0.8, width: 4.2, depth: 3.8 }, label: 'Bug analysis discussion', material: 'sage-fabric' },
    { id: 'qa-central-route', kind: 'circulation', bounds: DEPARTMENT_AISLES[1], label: 'Clear route between test and desk banks' },
  ],
  rooms: [
    { id: 'qa-glass-review-room', kind: 'meeting', bounds: { x: 0.6, z: 0.65, width: 6.6, depth: 3.9 }, capacity: 6, privacy: 'glass', material: 'bronze-glass', door: { wall: 'north', offset: 2.55, width: 1.3, kind: 'door' } },
  ],
  barriers: [
    { id: 'qa-glass-test-screen', kind: 'glass', x: 7.6, z: 5.75, length: 5.2, height: 1.8, rotationY: 0, material: 'glass-tint', doorWidth: 1.4 },
  ],
  windows: NORTH_WINDOWS,
  entrances: [{ id: 'south-east-elevator', wall: 'south', offset: 19.2, width: 1.4, kind: 'elevator' }],
  materials: { ...LOFT_MATERIALS, featureWall: '#A84F37', textile: '#788779', testBay: '#CAD3C7' },
  lighting: { exposure: 1.08, ambient: '#E4EDF4', key: '#FFF0D8', fill: '#DCE8E0', keyIntensity: 2.4, fillIntensity: 0.82, fixtures: localLights({ window: '#FFE0B0', specialist: '#E0EADD', collaboration: '#F1CE98' }) },
  furniture: [
    prop('qa-room-review-table', 'table.meeting', 3.9, 2.55),
    prop('qa-room-chair-west', 'chair.meeting', 2.05, 2.55),
    prop('qa-room-chair-east', 'chair.meeting', 5.75, 2.55),
    prop('qa-room-chair-south', 'chair.meeting', 3.9, 1.55),
    prop('qa-room-chair-north', 'chair.meeting', 3.9, 3.55),
    prop('qa-defect-triage-table', 'table.meeting', 11.1, 2.45),
    prop('qa-triage-chair-west', 'chair.meeting', 9.2, 2.45),
    prop('qa-triage-chair-east', 'chair.meeting', 13.0, 2.45),
    prop('qa-triage-chair-south-west', 'chair.meeting', 10.3, 3.55),
    prop('qa-triage-chair-south-east', 'chair.meeting', 11.9, 3.55),
    prop('qa-discussion-sofa', 'sofa.cozy', 17.0, 1.85),
    prop('qa-discussion-coffee-table', 'table.coffee', 17.0, 3.05),
    prop('qa-discussion-chair-west', 'armchair.cozy', 14.55, 2.55),
    prop('qa-discussion-chair-east', 'armchair.cozy', 18.35, 4.05),
    prop('qa-test-bench', 'equipment.test-bench', 18.0, 7.0),
    ...monitorPlacements('floor-4', positions.slice(5, 9).map(({ number, x, z }) => ({ number, x, z, asset: 'monitor.single' as const }))),
  ],
  decor: [
    prop('qa-device-test-wall', 'equipment.qa-device-wall', 5.4, 13.65, { y: 1.55 }),
    prop('qa-results-display', 'equipment.analytics-display', 20.9, 7.4, { y: 1.65 }),
    prop('qa-triage-whiteboard', 'furniture.whiteboard', 14.0, 3.6, { y: 1.5 }),
    prop('qa-triage-checklist-display', 'equipment.whiteboard-display', 11.0, 13.65, { y: 1.55 }),
    prop('qa-north-west-plant', 'plant.potted', 1.0, 12.5),
    prop('qa-east-plant', 'plant.potted', 21.3, 12.2),
    prop('qa-review-sconce', 'decor.wall.sconce', 15.5, 13.65, { y: 2.7 }),
  ],
  workplaces,
  aisles: DEPARTMENT_AISLES,
  camera: CAMERA,
}
