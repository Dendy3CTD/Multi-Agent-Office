import type { FloorDesignPreset } from '../../floor-presets/types'
import { CAMERA, FLOOR_BOUNDS, LOFT_MATERIALS, monitorPlacements, NORTH_WINDOWS, prop, workplace, localLights } from './shared'

const positions = [
  { number: 1, employeeId: 'developer', x: 4.2, z: 6.0 },
  { number: 2, employeeId: 'employee-010', x: 6.8, z: 6.0 },
  { number: 3, employeeId: 'employee-011', x: 9.4, z: 6.0 },
  { number: 4, employeeId: 'employee-012', x: 4.2, z: 10.0 },
  { number: 5, employeeId: 'employee-013', x: 6.8, z: 10.0 },
  { number: 6, employeeId: 'employee-014', x: 9.4, z: 10.0 },
  { number: 7, employeeId: 'employee-015', x: 12.9, z: 6.0 },
  { number: 8, employeeId: 'employee-016', x: 15.5, z: 6.0 },
  { number: 9, employeeId: 'employee-017', x: 18.0, z: 6.0 },
  { number: 10, employeeId: 'employee-018', x: 12.9, z: 10.0 },
  { number: 11, employeeId: undefined, x: 15.5, z: 10.0 },
]

const workplaces = positions.map(item => workplace('floor-3', item.number, item.employeeId, item.x, item.z, item.number <= 6 ? 'standard' : 'focus'))

const aisles = [
  { x: 0.7, z: 4.6, width: 19.9, depth: 1.0 },
  { x: 0.7, z: 9.0, width: 19.9, depth: 1.0 },
  { x: 0.7, z: 4.6, width: 1.0, depth: 5.4 },
  { x: 19.2, z: 0, width: 1.4, depth: 12.8 },
  { x: 10.45, z: 5.6, width: 1.1, depth: 4.4 },
]

export const FLOOR_03_SOFTWARE_DEVELOPMENT: FloorDesignPreset = {
  schemaVersion: 1,
  floorId: 'floor-02',
  presetId: 'office-v4-floor-03-software-development-v1',
  specialization: 'software-development',
  referenceImage: '/design-references/office-v4/floor-03.png',
  theme: 'studio',
  bounds: FLOOR_BOUNDS,
  zones: [
    { id: 'software-team-room-zone', kind: 'meeting', bounds: { x: 0.6, z: 0.65, width: 6.6, depth: 3.9 }, label: 'Glass team room', material: 'bronze-glass' },
    { id: 'software-pairing-pod', kind: 'work', bounds: { x: 3.3, z: 5.7, width: 6.8, depth: 2.5 }, label: 'Paired development stations', material: 'oak-floor' },
    { id: 'software-focus-stations', kind: 'work', bounds: { x: 3.3, z: 9.7, width: 6.8, depth: 2.7 }, label: 'Focused developer stations', material: 'ash-oak' },
    { id: 'software-review-bank', kind: 'work', bounds: { x: 12.0, z: 5.7, width: 6.7, depth: 2.5 }, label: 'Review and integration stations', material: 'graphite-metal' },
    { id: 'software-standup', kind: 'meeting', bounds: { x: 8.6, z: 1.1, width: 4.8, depth: 3.0 }, label: 'Stand-up and huddle area', material: 'sage-fabric' },
    { id: 'software-focus-booth', kind: 'focus', bounds: { x: 17.2, z: 2.8, width: 1.7, depth: 1.7 }, label: 'Acoustic focus pod', material: 'blue-felt' },
    { id: 'software-lounge', kind: 'lounge', bounds: { x: 15.2, z: 11.8, width: 3.5, depth: 1.8 }, label: 'Developer lounge', material: 'sage-fabric' },
    { id: 'software-pod-crossing', kind: 'circulation', bounds: aisles[1], label: 'Clear route between work pods' },
  ],
  rooms: [
    { id: 'software-glass-team-room', kind: 'meeting', bounds: { x: 0.6, z: 0.65, width: 6.6, depth: 3.9 }, capacity: 6, privacy: 'glass', material: 'bronze-glass', door: { wall: 'north', offset: 2.55, width: 1.3, kind: 'door' } },
  ],
  barriers: [
    { id: 'software-glass-pod-screen', kind: 'glass', x: 3.2, z: 8.6, length: 6.5, height: 1.75, rotationY: 0, material: 'glass-tint', doorWidth: 1.5 },
  ],
  windows: NORTH_WINDOWS,
  entrances: [{ id: 'south-east-elevator', wall: 'south', offset: 19.2, width: 1.4, kind: 'elevator' }],
  materials: { ...LOFT_MATERIALS, featureWall: '#90533D', desk: '#73513B', textile: '#75889A', focusFelt: '#4E6A80' },
  lighting: { exposure: 1.08, ambient: '#E5EDF2', key: '#FFF2E0', fill: '#D8E6F0', keyIntensity: 2.4, fillIntensity: 0.84, fixtures: localLights({ window: '#F3DFC2', specialist: '#D8E9F4', collaboration: '#F0C98C' }) },
  furniture: [
    prop('software-team-table', 'table.meeting', 3.9, 2.55),
    prop('software-team-chair-west', 'chair.meeting', 2.05, 2.55),
    prop('software-team-chair-east', 'chair.meeting', 5.75, 2.55),
    prop('software-team-chair-south', 'chair.meeting', 3.9, 1.55),
    prop('software-team-chair-north', 'chair.meeting', 3.9, 3.55),
    prop('software-standup-table', 'furniture.cafe-table', 10.8, 2.45),
    prop('software-standup-seat-west', 'chair.meeting', 9.8, 2.45),
    prop('software-standup-seat-east', 'chair.meeting', 11.8, 2.45),
    prop('software-focus-pod', 'furniture.acoustic-focus-pod', 18.0, 3.65),
    prop('software-lounge-sofa', 'sofa.cozy', 17.5, 12.5),
    prop('software-review-whiteboard', 'furniture.whiteboard', 15.0, 12.8, { y: 1.55 }),
    ...monitorPlacements('floor-3', positions.filter(item => item.employeeId).map(({ number, x, z }) => ({ number, x, z, asset: 'monitor.dual' as const }))),
  ],
  decor: [
    prop('software-code-review-display', 'equipment.analytics-display', 21.2, 8.4, { y: 1.65 }),
    prop('software-task-board', 'equipment.whiteboard-display', 7.0, 13.65, { y: 1.55 }),
    prop('software-reference-shelf', 'bookshelf', 1.0, 12.6),
    prop('software-window-plant', 'plant.potted', 1.0, 11.2),
    prop('software-focus-lamp', 'decor.wall.sconce', 18.5, 5.1, { y: 2.7 }),
  ],
  workplaces,
  aisles,
  camera: CAMERA,
}
