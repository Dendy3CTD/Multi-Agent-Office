import { buildDesks, createDemoEmployees } from '../../../world'
import type { FloorDesignPreset, FloorPlacementPreset } from '../../floor-presets/types'
import { baseLighting, commonAisles, commonZones, departmentWorkplaces, deskColumns, elevatorEntrance, loftMaterials, northWindows, referenceCamera } from './shared'

const employees = createDemoEmployees()
const floorId = 'floor-08'
const worldFloorId = 'floor-9'
const workplaces = departmentWorkplaces(worldFloorId, 'design', employees, buildDesks(employees), { kind: 'cad', equipment: ['equipment.graphics-tablet'] })
const placed = (asset: FloorPlacementPreset['asset'], id: string, x: number, z: number, options: Partial<FloorPlacementPreset> = {}): FloorPlacementPreset => ({ asset, id, x, z, ...options })

export const FLOOR_09_DESIGN: FloorDesignPreset = {
  schemaVersion: 1, floorId, presetId: 'office-v4-design-studio', specialization: 'design',
  referenceImage: '/design-references/office-v4/floor-09.png', theme: 'studio',
  bounds: { width: 22, depth: 14, height: 5.8 },
  zones: [
    ...commonZones('design'),
    { id: 'design-material-library', kind: 'service', bounds: { x: .3, z: 7.6, width: 2.6, depth: 4.3 }, label: 'Material and finish library' },
    { id: 'design-critique-table', kind: 'meeting', bounds: { x: 6.2, z: .7, width: 5.5, depth: 3.3 }, label: 'Central design review' },
    { id: 'design-review-lounge', kind: 'lounge', bounds: { x: 13.4, z: .7, width: 4.6, depth: 3.3 }, label: 'Informal critique and review' },
  ],
  rooms: [
    { id: 'design-glass-collaboration-room', kind: 'meeting', bounds: { x: .65, z: .65, width: 5.4, depth: 3.75 }, capacity: 8, privacy: 'glass', material: 'bronze-glass', door: { wall: 'east', offset: 1.1, width: 1.05, kind: 'door' } },
  ],
  barriers: [], windows: northWindows('design'), entrances: [elevatorEntrance], materials: loftMaterials,
  lighting: { ...baseLighting, fixtures: [
    { id: 'design-table-pendant', kind: 'point', x: 8.8, y: 4.25, z: 2.3, color: '#f6d7a3', intensity: 1.2, distance: 6 },
    { id: 'design-moodboard-wash', kind: 'spot', x: 19.5, y: 4.7, z: 9.5, color: '#f0b86c', intensity: 1.35, distance: 6, angle: .55, target: [20.8, 2.1, 9.5] },
    { id: 'design-library-point', kind: 'point', x: 1.4, y: 3.5, z: 10.2, color: '#d8e7f2', intensity: .55, distance: 3.5 },
  ] },
  furniture: [
    placed('table.meeting', 'design-critique-table-furniture', 8.9, 2.25),
    placed('chair.meeting', 'design-critique-chair-west', 6.95, 2.25),
    placed('chair.meeting', 'design-critique-chair-east', 10.85, 2.25),
    placed('chair.meeting', 'design-critique-chair-south', 8.9, 1.3),
    placed('chair.meeting', 'design-critique-chair-north', 8.9, 3.2),
    placed('equipment.archive-shelf', 'design-material-shelf-west', 1.3, 8.1),
    placed('equipment.archive-shelf', 'design-material-shelf-mid', 1.3, 10.2),
    placed('equipment.archive-shelf', 'design-material-swatch-rack', 1.3, 12.05),
    placed('sofa.cozy', 'design-review-sofa', 14.1, 1.55),
    placed('table.coffee', 'design-review-coffee-table', 14.35, 3.05),
    placed('armchair.cozy', 'design-review-armchair', 16.45, 2.75, { rotationY: -.4 }),
    placed('plant.potted', 'design-review-plant', 17.55, 1.55),
    placed('furniture.moodboard', 'design-material-moodboard', 20.7, 8.4, { y: 2.15, rotationY: -Math.PI / 2 }),
    placed('equipment.whiteboard-display', 'design-presentation-display', 20.7, 11.15, { y: 2.1, rotationY: -Math.PI / 2 }),
    ...workplaces.filter(place => place.employeeId).map(place => placed('monitor.dual', `design-monitor-${place.deskId}`, place.x, place.z - .18, { y: 1.2, deskId: place.deskId })),
    ...workplaces.filter(place => place.employeeId).map(place => placed('equipment.graphics-tablet', `design-tablet-${place.deskId}`, place.x + .25, place.z + .42, { y: 1.02, deskId: place.deskId })),
    ...deskColumns.map((x, index) => placed('pendant.led', `design-studio-pendant-${index + 1}`, x, 7.25, { y: 4.65 })),
  ],
  decor: [
    placed('decor.wall.sconce', 'design-gallery-light-west', 18.2, 13.65, { y: 2.6 }),
    placed('decor.wall.sconce', 'design-gallery-light-east', 20.5, 13.65, { y: 2.6 }),
  ],
  workplaces, aisles: commonAisles(), camera: referenceCamera,
}
