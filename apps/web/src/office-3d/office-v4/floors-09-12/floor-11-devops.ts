import { buildDesks, createDemoEmployees } from '../../../world'
import type { FloorDesignPreset, FloorPlacementPreset } from '../../floor-presets/types'
import { baseLighting, commonAisles, commonZones, departmentWorkplaces, elevatorEntrance, loftMaterials, northWindows, referenceCamera } from './shared'

const employees = createDemoEmployees()
const workplaces = departmentWorkplaces('floor-11', 'devops', employees, buildDesks(employees), { kind: 'lab' })
const placed = (asset: FloorPlacementPreset['asset'], id: string, x: number, z: number, options: Partial<FloorPlacementPreset> = {}): FloorPlacementPreset => ({ asset, id, x, z, ...options })

export const FLOOR_11_DEVOPS: FloorDesignPreset = {
  schemaVersion: 1, floorId: 'floor-10', presetId: 'office-v4-devops-operations', specialization: 'devops',
  referenceImage: '/design-references/office-v4/floor-11.png', theme: 'industrial',
  bounds: { width: 22, depth: 14, height: 5.8 },
  zones: [
    ...commonZones('devops'),
    { id: 'devops-server-room-zone', kind: 'service', bounds: { x: .45, z: .55, width: 5.75, depth: 3.9 }, label: 'Enclosed infrastructure room' },
    { id: 'devops-incident-room-zone', kind: 'meeting', bounds: { x: 13.25, z: .55, width: 5.55, depth: 3.9 }, label: 'Incident response and diagnostics' },
    { id: 'devops-monitoring-wall-zone', kind: 'focus', bounds: { x: 19.9, z: 4.1, width: 1.8, depth: 7.3 }, label: 'Live infrastructure and delivery wall' },
    { id: 'devops-recovery-lounge-zone', kind: 'lounge', bounds: { x: 13.4, z: 11.25, width: 5.2, depth: 2.45 }, label: 'On-call recovery corner' },
  ],
  rooms: [
    { id: 'devops-enclosed-server-room', kind: 'service', bounds: { x: .55, z: .65, width: 5.45, depth: 3.65 }, capacity: 2, privacy: 'glass', material: 'bronze-glass', door: { wall: 'east', offset: 1.2, width: 1.05, kind: 'door' } },
    { id: 'devops-incident-response-room', kind: 'meeting', bounds: { x: 13.25, z: .65, width: 5.5, depth: 3.65 }, capacity: 8, privacy: 'glass', material: 'bronze-glass', door: { wall: 'north', offset: 2.2, width: 1.05, kind: 'door' } },
  ],
  barriers: [], windows: northWindows('devops'), entrances: [elevatorEntrance], materials: loftMaterials,
  lighting: { ...baseLighting, ambient: '#dbe4e9', key: '#fff0d8', fill: '#a9c9df', keyIntensity: 2.1, fixtures: [
    { id: 'devops-rack-blue-point', kind: 'point', x: 3.2, y: 2.6, z: 2.4, color: '#56a8e8', intensity: .85, distance: 4 },
    { id: 'devops-wall-wash', kind: 'spot', x: 19.4, y: 4.8, z: 8.1, color: '#68bde0', intensity: 1.55, distance: 7, angle: .62, target: [20.9, 2.3, 8.1] },
    { id: 'devops-incident-pendant', kind: 'point', x: 16, y: 4, z: 2.4, color: '#f3d49e', intensity: .8, distance: 5 },
  ] },
  furniture: [
    placed('equipment.server-rack', 'devops-server-rack-a', 1.35, 1.45),
    placed('equipment.server-rack', 'devops-server-rack-b', 2.45, 1.45),
    placed('equipment.server-rack', 'devops-server-rack-c', 3.55, 1.45),
    placed('equipment.network-rack', 'devops-network-rack-a', 4.65, 1.45),
    placed('equipment.network-rack', 'devops-network-rack-b', 1.9, 3.05),
    placed('equipment.analytics-display', 'devops-ci-delivery-wall', 20.7, 7.25, { y: 2.3, rotationY: -Math.PI / 2, interaction: { kind: 'display', targetId: 'devops-ci-cd' } }),
    placed('equipment.whiteboard-display', 'devops-health-wall', 20.7, 10.45, { y: 2.25, rotationY: -Math.PI / 2, interaction: { kind: 'display', targetId: 'devops-infrastructure-health' } }),
    placed('table.meeting', 'devops-incident-table', 15.95, 2.35),
    placed('chair.meeting', 'devops-incident-chair-west', 14, 2.35),
    placed('chair.meeting', 'devops-incident-chair-east', 17.9, 2.35),
    placed('sofa.cozy', 'devops-oncall-sofa', 16.2, 12.1),
    placed('table.coffee', 'devops-oncall-table', 14, 12.2),
    placed('plant.potted', 'devops-oncall-plant', 18.2, 12.5),
    ...workplaces.filter(place => place.employeeId).map(place => placed('monitor.dual', `devops-monitor-${place.deskId}`, place.x, place.z - .18, { y: 1.2, deskId: place.deskId })),
    ...[4.7, 8, 11.3, 14.6, 17.9].map((x, index) => placed('pendant.led', `devops-ops-pendant-${index + 1}`, x, 7.25, { y: 4.65 })),
  ],
  decor: [
    placed('decor.wall.sconce', 'devops-brick-sconce-west', 8.5, 13.65, { y: 2.65 }),
    placed('decor.wall.sconce', 'devops-brick-sconce-east', 12, 13.65, { y: 2.65 }),
  ],
  workplaces, aisles: commonAisles(), camera: referenceCamera,
}
