import { buildDesks, createDemoEmployees } from '../../../world'
import type { FloorDesignPreset, FloorPlacementPreset } from '../../floor-presets/types'
import { baseLighting, commonAisles, commonZones, departmentWorkplaces, elevatorEntrance, loftMaterials, northWindows, referenceCamera } from './shared'

const employees = createDemoEmployees()
const workplaces = departmentWorkplaces('floor-12', 'automation-integrations', employees, buildDesks(employees), { kind: 'lab' })
const placed = (asset: FloorPlacementPreset['asset'], id: string, x: number, z: number, options: Partial<FloorPlacementPreset> = {}): FloorPlacementPreset => ({ asset, id, x, z, ...options })

export const FLOOR_12_AUTOMATION: FloorDesignPreset = {
  schemaVersion: 1, floorId: 'floor-11', presetId: 'office-v4-automation-integrations', specialization: 'automation-integrations',
  referenceImage: '/design-references/office-v4/floor-12.png', theme: 'studio',
  bounds: { width: 22, depth: 14, height: 5.8 },
  zones: [
    ...commonZones('automation'),
    { id: 'automation-api-wall', kind: 'focus', bounds: { x: 19.8, z: 4.1, width: 1.9, depth: 7.3 }, label: 'API and service integration wall' },
    { id: 'automation-flow-lab', kind: 'work', bounds: { x: 6.2, z: .65, width: 6.4, depth: 3.5 }, label: 'Workflow mapping and automation lab' },
    { id: 'automation-glass-collab-zone', kind: 'meeting', bounds: { x: .55, z: .65, width: 5.4, depth: 3.8 }, label: 'Integration planning room' },
    { id: 'automation-team-lounge', kind: 'lounge', bounds: { x: 13.7, z: .65, width: 4.6, depth: 3.5 }, label: 'Team lounge' },
  ],
  rooms: [
    { id: 'automation-glass-planning-room', kind: 'meeting', bounds: { x: .65, z: .65, width: 5.25, depth: 3.7 }, capacity: 8, privacy: 'glass', material: 'bronze-glass', door: { wall: 'east', offset: 1.1, width: 1.05, kind: 'door' } },
  ],
  barriers: [], windows: northWindows('automation'), entrances: [elevatorEntrance], materials: loftMaterials,
  lighting: { ...baseLighting, ambient: '#dce8e9', key: '#fff1da', fill: '#bfdce2', fixtures: [
    { id: 'automation-workflow-wash', kind: 'spot', x: 19.4, y: 4.8, z: 8.2, color: '#78c7bd', intensity: 1.45, distance: 7, angle: .6, target: [20.8, 2.25, 8.2] },
    { id: 'automation-mapping-pendant', kind: 'point', x: 9.2, y: 4.15, z: 2.3, color: '#f2d7a5', intensity: 1, distance: 6 },
    { id: 'automation-room-point', kind: 'point', x: 3.1, y: 3.7, z: 2.35, color: '#d1e7e5', intensity: .65, distance: 4 },
  ] },
  furniture: [
    placed('table.meeting', 'automation-mapping-table', 9.2, 2.3),
    placed('chair.meeting', 'automation-mapping-chair-west', 7.25, 2.3),
    placed('chair.meeting', 'automation-mapping-chair-east', 11.15, 2.3),
    placed('chair.meeting', 'automation-mapping-chair-south', 9.2, 1.3),
    placed('chair.meeting', 'automation-mapping-chair-north', 9.2, 3.25),
    placed('furniture.whiteboard', 'automation-mobile-workflow-board-west', 12.25, 2.15, { rotationY: .18 }),
    placed('furniture.whiteboard', 'automation-mobile-workflow-board-east', 12.25, 3.15, { rotationY: -.18 }),
    placed('sofa.cozy', 'automation-lounge-sofa', 14.2, 1.6),
    placed('table.coffee', 'automation-lounge-table', 14.45, 3.1),
    placed('armchair.cozy', 'automation-lounge-chair', 16.65, 2.8, { rotationY: -.4 }),
    placed('plant.potted', 'automation-lounge-plant', 17.8, 1.55),
    placed('equipment.whiteboard-display', 'automation-workflow-display', 20.7, 7.15, { y: 2.3, rotationY: -Math.PI / 2, interaction: { kind: 'display', targetId: 'automation-workflow-map' } }),
    placed('equipment.analytics-display', 'automation-api-map-display', 20.7, 10.45, { y: 2.3, rotationY: -Math.PI / 2, interaction: { kind: 'display', targetId: 'automation-api-map' } }),
    ...workplaces.filter(place => place.employeeId).map(place => placed('monitor.dual', `automation-monitor-${place.deskId}`, place.x, place.z - .18, { y: 1.2, deskId: place.deskId })),
    ...[4.7, 8, 11.3, 14.6, 17.9].map((x, index) => placed('pendant.led', `automation-team-pendant-${index + 1}`, x, 7.25, { y: 4.65 })),
  ],
  decor: [
    placed('decor.wall.sconce', 'automation-api-sconce-west', 18.2, 13.65, { y: 2.65 }),
    placed('decor.wall.sconce', 'automation-api-sconce-east', 20.4, 13.65, { y: 2.65 }),
  ],
  workplaces, aisles: commonAisles(), camera: referenceCamera,
}
