import { buildDesks, createDemoEmployees } from '../../../world'
import { officeV4ToWorldFloorId } from '../floor-id-adapter'
import type { FloorDesignPreset, FloorPlacementPreset } from '../../floor-presets/types'

const worldFloorId = officeV4ToWorldFloorId('floor-12')
const allEmployees = createDemoEmployees()
const roster = allEmployees.filter(employee => employee.floorId === worldFloorId && employee.departmentId === 'security-review')
const deskRecords = buildDesks(allEmployees).filter(desk => desk.floorId === worldFloorId)
const analystPositions = [
  [4.1, 5.0], [7.3, 5.0], [10.5, 5.0], [13.7, 5.0], [17.0, 5.0],
  [4.1, 8.5], [7.3, 8.5], [10.5, 8.5], [13.7, 8.5], [17.0, 8.5],
] as const

const placed = (asset: FloorPlacementPreset['asset'], id: string, x: number, z: number, options: Partial<FloorPlacementPreset> = {}): FloorPlacementPreset => ({ asset, id, x, z, ...options })

export const FLOOR_13_SECURITY_REVIEW: FloorDesignPreset = {
  schemaVersion: 1,
  floorId: 'floor-12',
  presetId: 'office-v4-security-review',
  specialization: 'security-review',
  referenceImage: '/design-references/office-v4/floor-13.png',
  theme: 'industrial',
  bounds: { width: 22, depth: 14, height: 5.8 },
  zones: [
    { id: 'soc-analyst-banks', kind: 'work', bounds: { x: 2.8, z: 4.3, width: 16.2, depth: 5.1 }, label: 'Security analysis desks', material: 'oak-floor' },
    { id: 'threat-monitor-wall', kind: 'focus', bounds: { x: 18.9, z: 4.1, width: 2.4, depth: 5.4 }, label: 'SOC threat wall', material: '#263642' },
    { id: 'incident-spine', kind: 'circulation', bounds: { x: 6.3, z: 3.9, width: 9.4, depth: 0.8 }, label: 'Clear route between briefing and analyst floor' },
    { id: 'secure-research', kind: 'service', bounds: { x: 15.3, z: 0.7, width: 6.1, depth: 3.6 }, label: 'Restricted research room' },
    { id: 'briefing-suite', kind: 'meeting', bounds: { x: 0.7, z: 0.7, width: 6.1, depth: 3.6 }, label: 'Incident review' },
    { id: 'recovery-nook', kind: 'lounge', bounds: { x: 0.7, z: 10.1, width: 4.6, depth: 3.2 }, label: 'Quiet recovery corner' },
  ],
  rooms: [
    { id: 'incident-review-room', kind: 'meeting', bounds: { x: 0.7, z: 0.7, width: 6.1, depth: 3.6 }, capacity: 8, privacy: 'glass', material: 'bronze-glass' },
    { id: 'restricted-research-room', kind: 'focus', bounds: { x: 15.3, z: 0.7, width: 6.1, depth: 3.6 }, capacity: 4, privacy: 'glass', material: 'bronze-glass' },
  ],
  barriers: [],
  windows: [{ id: 'north-panoramic-windows', wall: 'north', offset: 1.2, width: 18.8, sill: 1.05, height: 3.3, frameMaterial: 'graphite-metal' }],
  entrances: [{ id: 'south-lift-entry', wall: 'south', offset: 9.7, width: 1.4, kind: 'elevator' }],
  materials: { floor: 'oak-floor', wall: 'warm-plaster', featureWall: 'terracotta-brick', glazing: 'glass-tint', trim: 'graphite-metal', desk: 'desk-oak', textile: 'forest-upholstery' },
  lighting: {
    exposure: 1.06, ambient: '#dfe8ed', key: '#fff0d5', fill: '#9fc9e7', keyIntensity: 2.25, fillIntensity: 0.82,
    fixtures: [
      { id: 'soc-amber-wash', kind: 'spot', x: 19.9, y: 4.8, z: 7.0, color: '#f2b76d', intensity: 2.0, distance: 8, angle: 0.7, target: [19.9, 1.5, 7.0] },
      { id: 'secure-room-blue-glow', kind: 'point', x: 18.1, y: 2.8, z: 2.4, color: '#4a9be8', intensity: 0.9, distance: 4 },
      { id: 'review-pendant', kind: 'point', x: 3.7, y: 4.3, z: 2.5, color: '#f0c98e', intensity: 1.1, distance: 6 },
    ],
  },
  furniture: [
    placed('equipment.security-console', 'soc-operations-console', 20.0, 6.8, { y: 2.3, rotationY: Math.PI / 2, interaction: { kind: 'display', targetId: 'security-review-soc' } }),
    placed('equipment.analytics-display', 'threat-analytics-display', 19.9, 9.4, { y: 2.65, rotationY: Math.PI / 2, interaction: { kind: 'display', targetId: 'security-review-threat-analysis' } }),
    placed('equipment.whiteboard-display', 'incident-threat-board', 10.8, 12.7, { y: 2.5, interaction: { kind: 'display', targetId: 'security-review-threat-board' } }),
    placed('equipment.server-rack', 'restricted-compute-rack', 19.4, 2.7, { rotationY: Math.PI / 2 }),
    placed('equipment.network-rack', 'restricted-network-rack', 16.6, 2.7),
    placed('table.meeting', 'incident-review-table', 3.75, 2.48),
    placed('chair.meeting', 'incident-chair-west', 1.75, 2.48),
    placed('chair.meeting', 'incident-chair-east', 5.75, 2.48),
    placed('chair.meeting', 'incident-chair-south', 3.75, 1.32),
    placed('chair.meeting', 'incident-chair-north', 3.75, 3.64),
    placed('sofa.cozy', 'analyst-recovery-sofa', 2.75, 11.75, { rotationY: Math.PI / 2 }),
    placed('table.coffee', 'recovery-coffee-table', 4.1, 11.75),
    placed('armchair.cozy', 'recovery-armchair', 4.9, 12.8),
    placed('bookshelf', 'security-reference-shelf', 1.45, 9.85, { rotationY: Math.PI / 2 }),
    placed('plant.potted', 'security-plant-west', 0.85, 5.4),
    placed('plant.potted', 'security-plant-east', 21.1, 11.9),
    ...deskRecords.map((desk, index) => placed('monitor.dual', `soc-analyst-monitor-${index + 1}`, analystPositions[index]![0], analystPositions[index]![1] + 0.25, { y: 1.08, deskId: desk.deskId })),
    placed('pendant.led', 'soc-analyst-light-rail', 10.8, 4.7, { y: 4.7 }),
    placed('decor.wall.sconce', 'brick-security-sconce', 8.2, 13.65, { y: 2.8 }),
  ],
  decor: [],
  workplaces: deskRecords.map((desk, index) => {
    const employee = roster.find(item => item.deskId === desk.deskId)
    return { id: desk.deskId, deskId: desk.deskId, ...(employee ? { employeeId: employee.employeeId } : {}), x: analystPositions[index]![0], z: analystPositions[index]![1], width: 1.5, depth: 0.8, kind: 'standard' }
  }),
  aisles: [
    { x: 9.7, z: 0.1, width: 1.4, depth: 3.8 },
    { x: 6.3, z: 3.9, width: 9.4, depth: 0.8 },
    { x: 7.1, z: 6.9, width: 7.9, depth: 0.7 },
  ],
  camera: { position: [19, 20, -23], target: [0, 1.4, 0], zoom: 1, minZoom: 0.72, maxZoom: 1.8 },
}
