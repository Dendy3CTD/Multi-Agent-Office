import type { FloorDesignPreset } from '../../floor-presets/types'
import { CAMERA, FLOOR_BOUNDS, LOFT_MATERIALS, monitorPlacements, NORTH_WINDOWS, prop, workplace, localLights } from './shared'

const positions = [
  { number: 1, employeeId: 'director', x: 19.2, z: 10.4, kind: 'standard' as const },
  { number: 2, employeeId: 'employee-001', x: 5.2, z: 5.8, kind: 'standard' as const },
  { number: 3, employeeId: 'employee-002', x: 8.0, z: 5.8, kind: 'standard' as const },
  { number: 4, employeeId: 'employee-003', x: 10.8, z: 5.8, kind: 'standard' as const },
  { number: 5, employeeId: 'employee-004', x: 13.6, z: 5.8, kind: 'standard' as const },
  { number: 6, employeeId: 'employee-005', x: 16.4, z: 5.8, kind: 'standard' as const },
  { number: 7, employeeId: 'employee-006', x: 3.5, z: 10.4, kind: 'standard' as const },
  { number: 8, employeeId: 'employee-007', x: 5.2, z: 10.4, kind: 'standard' as const },
  { number: 9, employeeId: 'employee-008', x: 8.0, z: 10.4, kind: 'standard' as const },
  { number: 10, employeeId: 'employee-009', x: 10.8, z: 10.4, kind: 'standard' as const },
  { number: 11, employeeId: 'helper', x: 13.6, z: 10.4, kind: 'standard' as const },
  { number: 12, employeeId: undefined, x: 16.4, z: 10.4, kind: 'standard' as const },
]

const workplaces = positions.map(item => workplace('floor-2', item.number, item.employeeId, item.x, item.z, item.kind))

const aisles = [
  { x: 0.7, z: 4.6, width: 19.9, depth: 1.0 },
  { x: 6.1, z: 9.2, width: 11.3, depth: 1.0 },
  { x: 6.1, z: 5.6, width: 1.0, depth: 3.6 },
  { x: 19.2, z: 0, width: 1.4, depth: 9.5 },
]

export const FLOOR_02_MANAGEMENT: FloorDesignPreset = {
  schemaVersion: 1,
  floorId: 'floor-01',
  presetId: 'office-v4-floor-02-management-v1',
  specialization: 'management',
  referenceImage: '/design-references/office-v4/floor-02.png',
  theme: 'showroom',
  bounds: FLOOR_BOUNDS,
  zones: [
    { id: 'management-boardroom', kind: 'meeting', bounds: { x: 0.6, z: 0.65, width: 6.6, depth: 3.9 }, label: 'Boardroom', material: 'bronze-glass' },
    { id: 'management-open-desk-bank', kind: 'work', bounds: { x: 3.0, z: 5.5, width: 14.3, depth: 2.0 }, label: 'Management workstations', material: 'walnut' },
    { id: 'management-planning-row', kind: 'work', bounds: { x: 2.7, z: 10.1, width: 12.5, depth: 2.4 }, label: 'Planning and project management', material: 'oak-floor' },
    { id: 'management-executive-office', kind: 'focus', bounds: { x: 17.4, z: 9.4, width: 4.2, depth: 4.0 }, label: 'Executive office', material: 'walnut' },
    { id: 'management-coffee-service', kind: 'service', bounds: { x: 0.9, z: 8.2, width: 4.3, depth: 3.4 }, label: 'Coffee and storage', material: 'graphite-metal' },
    { id: 'management-guest-lounge', kind: 'lounge', bounds: { x: 15.2, z: 0.8, width: 3.8, depth: 4.2 }, label: 'Guest discussion lounge', material: 'sage-fabric' },
    { id: 'management-boardroom-approach', kind: 'circulation', bounds: aisles[0], label: 'Boardroom and team route' },
  ],
  rooms: [
    { id: 'management-glass-boardroom', kind: 'meeting', bounds: { x: 0.6, z: 0.65, width: 6.6, depth: 3.9 }, capacity: 8, privacy: 'glass', material: 'bronze-glass', door: { wall: 'north', offset: 2.55, width: 1.3, kind: 'door' } },
    { id: 'management-executive-room', kind: 'leadership', bounds: { x: 17.4, z: 9.4, width: 4.2, depth: 4.0 }, capacity: 2, privacy: 'glass', material: 'walnut', door: { wall: 'south', offset: 2.5, width: 1.3, kind: 'door' } },
  ],
  barriers: [],
  windows: NORTH_WINDOWS,
  entrances: [{ id: 'south-east-elevator', wall: 'south', offset: 19.2, width: 1.4, kind: 'elevator' }],
  materials: { ...LOFT_MATERIALS, featureWall: '#83523D', desk: '#55392C', textile: '#9B7357', executiveWalnut: '#54392D' },
  lighting: { exposure: 1.06, ambient: '#E9EDF0', key: '#FFF0D8', fill: '#DCE5E5', keyIntensity: 2.35, fillIntensity: 0.8, fixtures: localLights({ window: '#F5DAB5', specialist: '#E9C18B', collaboration: '#F7D7A4' }) },
  furniture: [
    prop('management-boardroom-table', 'table.meeting', 3.9, 2.55),
    prop('management-boardroom-chair-west', 'chair.meeting', 2.05, 2.55),
    prop('management-boardroom-chair-east', 'chair.meeting', 5.75, 2.55),
    prop('management-boardroom-chair-south-west', 'chair.meeting', 2.7, 1.45),
    prop('management-boardroom-chair-south-east', 'chair.meeting', 5.1, 1.45),
    prop('management-boardroom-chair-north-west', 'chair.meeting', 2.7, 3.65),
    prop('management-boardroom-chair-north-east', 'chair.meeting', 5.1, 3.65),
    prop('management-executive-desk', 'desk.modern', 19.2, 10.4, { deskId: 'desk-floor-2-01' }),
    prop('management-executive-monitor', 'monitor.dual', 19.2, 10.66, { y: 1.15, deskId: 'desk-floor-2-01' }),
    prop('management-executive-guest-chair', 'armchair.cozy', 20.9, 11.5),
    prop('management-open-planning-table', 'table.meeting', 11.2, 2.3),
    prop('management-planning-chair-west', 'chair.meeting', 9.3, 2.3),
    prop('management-planning-chair-east', 'chair.meeting', 13.1, 2.3),
    prop('management-planning-chair-south', 'chair.meeting', 10.0, 3.4),
    prop('management-planning-chair-north', 'chair.meeting', 12.4, 3.4),
    prop('management-coffee-console', 'equipment.cafe-counter', 2.8, 9.6),
    prop('management-coffee-machine', 'equipment.espresso-machine', 2.8, 9.6, { y: 1.25 }),
    prop('management-guest-sofa', 'sofa.cozy', 17.0, 1.8),
    prop('management-guest-coffee-table', 'table.coffee', 17.0, 3.1),
    prop('management-guest-chair-west', 'armchair.cozy', 14.7, 2.8),
    ...monitorPlacements('floor-2', positions.filter(item => item.number > 1 && item.number < 12).map(({ number, x, z }) => ({ number, x, z, asset: 'monitor.single' as const }))),
  ],
  decor: [
    prop('management-brand-wall', 'wall.decoration', 21.15, 7.4, { y: 2.5 }),
    prop('management-boardroom-display', 'equipment.whiteboard-display', 3.9, 4.4, { y: 1.7 }),
    prop('management-document-shelf', 'bookshelf', 1.2, 12.4),
    prop('management-executive-archive', 'filing.cabinet', 21.0, 12.8),
    prop('management-window-plant', 'plant.potted', 5.0, 13.1),
    prop('management-lounge-plant', 'plant.potted', 18.5, 4.2),
    prop('management-bronze-sconce', 'decor.wall.sconce', 20.9, 7.2, { y: 2.8 }),
  ],
  workplaces,
  aisles,
  camera: CAMERA,
}
