import type { DeskObject, WorldEmployee } from '../../../world/types'
import type { FloorDesignPreset, FloorPlacementPreset, FloorWorkplacePreset } from '../../floor-presets/types'
import { officeV4ToWorldFloorId } from '../floor-id-adapter'

type SeatPoint = readonly [x: number, z: number]

interface FloorDefinition {
  readonly floorId: string
  readonly specialization: string
  readonly title: string
  readonly referenceImage: string
  readonly theme: FloorDesignPreset['theme']
  readonly positions: readonly SeatPoint[]
  readonly materials: Readonly<Record<string, string>>
  readonly lighting: FloorDesignPreset['lighting']
  readonly windows: FloorDesignPreset['windows']
  readonly rooms: FloorDesignPreset['rooms']
  readonly zones: FloorDesignPreset['zones']
  readonly furniture: (workplaces: readonly FloorWorkplacePreset[]) => readonly FloorPlacementPreset[]
  readonly decor: readonly FloorPlacementPreset[]
  readonly aisles: FloorDesignPreset['aisles']
  readonly camera: FloorDesignPreset['camera']
}

export interface OfficeV4PresetOptions {
  /** Exact directory desk ID to authored slot number (1-based); never array order. */
  readonly deskSlotById?: ReadonlyMap<string, number>
}

const sharedRoomFurniture = (prefix: string, x: number, z: number): FloorPlacementPreset[] => [
  { id: `${prefix}-table`, asset: 'table.meeting', x, z },
  { id: `${prefix}-chair-a`, asset: 'chair.meeting', x: x - .78, z: z - 1.2 },
  { id: `${prefix}-chair-b`, asset: 'chair.meeting', x: x + .78, z: z - 1.2 },
  { id: `${prefix}-chair-c`, asset: 'chair.meeting', x: x - .78, z: z + 1.2 },
  { id: `${prefix}-chair-d`, asset: 'chair.meeting', x: x + .78, z: z + 1.2 },
]

const seatMonitorPlacements = (prefix: string, workplaces: readonly FloorWorkplacePreset[], asset: 'monitor.single' | 'monitor.dual') =>
  workplaces.map((workplace, index): FloorPlacementPreset => ({
    id: `${prefix}-monitor-${String(index + 1).padStart(2, '0')}`,
    asset,
    x: workplace.x,
    y: 1.12,
    z: workplace.z - .16,
    deskId: workplace.id,
  }))

const floorDefinitions: readonly FloorDefinition[] = [
  {
    floorId: 'floor-04',
    specialization: 'engineering-electronics',
    title: 'Engineering Electronics',
    referenceImage: '/design-references/office-v4/floor-05.png',
    theme: 'industrial',
    positions: [
      [3.3, 4.75], [6.2, 4.75], [9.1, 4.75], [13.1, 4.75], [16.3, 4.75],
      [3.3, 8.25], [6.2, 8.25], [9.1, 8.25], [13.1, 8.25], [16.3, 8.25],
    ],
    materials: { floor: 'oak-floor', wall: 'warm-plaster', featureWall: 'terracotta-brick', glazing: 'glass-tint', trim: 'graphite-metal', desk: 'desk-oak', textile: 'sage-fabric', zone: '#e8dfcf' },
    lighting: { exposure: 1.06, ambient: '#dfe8ed', key: '#fff0d9', fill: '#d9e9e7', keyIntensity: 2.3, fillIntensity: .78, fixtures: [
      { id: 'electronics-solder-lights', kind: 'spot', x: 4.2, y: 4.6, z: 4.3, color: '#ffe4b5', intensity: 1.05, distance: 8, angle: .72, target: [4.2, 0, 4.3] },
      { id: 'electronics-bench-lights', kind: 'spot', x: 14.9, y: 4.6, z: 4.3, color: '#ffe4b5', intensity: 1.05, distance: 8, angle: .72, target: [14.9, 0, 4.3] },
      { id: 'electronics-prototype-pendant', kind: 'point', x: 11.2, y: 4.4, z: 2.1, color: '#f2b36b', intensity: .8, distance: 7 },
    ] },
    windows: [{ id: 'electronics-panoramic-window', wall: 'north', offset: .9, width: 20, sill: 1.1, height: 3.35, frameMaterial: 'graphite-metal' }],
    rooms: [{ id: 'electronics-glass-review-room', kind: 'meeting', bounds: { x: .8, z: .55, width: 6.1, depth: 3.45 }, capacity: 6, privacy: 'glass', material: 'glass-tint', door: { wall: 'east', offset: 1.05, width: 1.2 } }],
    zones: [
      { id: 'electronics-review-room', kind: 'meeting', bounds: { x: .8, z: .55, width: 6.1, depth: 3.45 }, label: 'Glass review room', material: '#bdd0c8' },
      { id: 'electronics-esd-window-benches', kind: 'work', bounds: { x: .8, z: 11.35, width: 18.7, depth: 1.9 }, label: 'ESD test benches', material: '#b4a894' },
      { id: 'electronics-engineering-desks', kind: 'work', bounds: { x: 2.4, z: 4.6, width: 15.2, depth: 5.5 }, label: 'Engineering workstations', material: '#d3b99d' },
      { id: 'electronics-prototype-island', kind: 'service', bounds: { x: 9.3, z: 1.4, width: 4.2, depth: 1.8 }, label: 'Prototype board bench', material: '#84958b' },
      { id: 'electronics-lounge', kind: 'lounge', bounds: { x: 15.1, z: .5, width: 3.8, depth: 2.9 }, label: 'Project lounge', material: '#718477' },
      { id: 'electronics-south-route', kind: 'circulation', bounds: { x: 7.1, z: 3.55, width: 13.4, depth: .78 }, label: 'Review room access route' },
    ],
    furniture: () => [
      ...sharedRoomFurniture('electronics-review', 3.6, 2.1),
      ...[3.4, 6.7, 14.5, 17.8].map((x, i): FloorPlacementPreset => ({ id: `electronics-test-bench-${i + 1}`, asset: 'equipment.test-bench', x, z: 12.05 })),
      { id: 'electronics-prototype-table', asset: 'equipment.test-bench', x: 11.3, z: 2.25 },
      { id: 'electronics-components-west', asset: 'equipment.archive-shelf', x: 1.25, z: 5.15, rotationY: Math.PI / 2 },
      { id: 'electronics-components-east-west', asset: 'equipment.archive-shelf', x: 1.25, z: 8.55, rotationY: Math.PI / 2 },
      { id: 'electronics-project-sofa', asset: 'sofa.cozy', x: 17.15, z: 1.25 },
      { id: 'electronics-project-coffee-table', asset: 'table.coffee', x: 17.15, z: 2.65 },
      { id: 'electronics-project-armchair', asset: 'armchair.cozy', x: 15.5, z: 2.65 },
    ],
    decor: [
      { id: 'electronics-east-safety-board', asset: 'equipment.whiteboard-display', x: 21.6, y: 2.2, z: 8.5, rotationY: Math.PI / 2 },
      { id: 'electronics-component-plants', asset: 'plant.potted', x: 1.6, z: 12.5 },
    ],
    aisles: [
      { x: 6.9, z: 3.55, width: 13.7, depth: .78 },
      { x: 19.1, z: .25, width: 1.25, depth: 13.45 },
      { x: .7, z: 6.75, width: 18.3, depth: .78 },
      { x: .7, z: 10.35, width: 18.3, depth: .7 },
      { x: 10.55, z: 3.55, width: 1.25, depth: 10.1 },
    ],
    camera: { position: [19, 17, -23], target: [0, 1.45, 0], zoom: 1, minZoom: .72, maxZoom: 1.8 },
  },
  {
    floorId: 'floor-05',
    specialization: 'cad-3d',
    title: 'CAD & 3D Studio',
    referenceImage: '/design-references/office-v4/floor-06.png',
    theme: 'studio',
    positions: [
      [3.1, 4.8], [6.2, 4.8], [9.3, 4.8], [13.3, 4.8], [16.4, 4.8],
      [3.1, 8.35], [6.2, 8.35], [9.3, 8.35], [13.3, 8.35], [16.4, 8.35],
    ],
    materials: { floor: 'oak-floor', wall: 'warm-plaster', featureWall: '#756850', glazing: 'glass-tint', trim: 'graphite-metal', desk: 'desk-oak', textile: 'sage-fabric', zone: '#ddd6ca' },
    lighting: { exposure: 1.08, ambient: '#e3e8ed', key: '#fff1dc', fill: '#dce7f2', keyIntensity: 2.25, fillIntensity: .82, fixtures: [
      { id: 'cad-pod-light-west', kind: 'spot', x: 6, y: 4.65, z: 5.4, color: '#fff0d4', intensity: 1, distance: 8, angle: .78, target: [6, 0, 5.4] },
      { id: 'cad-pod-light-east', kind: 'spot', x: 15.3, y: 4.65, z: 8.9, color: '#fff0d4', intensity: 1, distance: 8, angle: .78, target: [15.3, 0, 8.9] },
      { id: 'cad-model-display-light', kind: 'point', x: 11.1, y: 4.2, z: 2.1, color: '#e0a45c', intensity: .82, distance: 7 },
    ] },
    windows: [
      { id: 'cad-north-window-west', wall: 'north', offset: .9, width: 8.9, sill: 1.2, height: 3.3, frameMaterial: 'graphite-metal' },
      { id: 'cad-north-window-east', wall: 'north', offset: 12.4, width: 8.7, sill: 1.2, height: 3.3, frameMaterial: 'graphite-metal' },
    ],
    rooms: [{ id: 'cad-glass-collaboration-room', kind: 'meeting', bounds: { x: .75, z: .5, width: 6.15, depth: 3.55 }, capacity: 6, privacy: 'glass', material: 'glass-tint', door: { wall: 'east', offset: 1.1, width: 1.2 } }],
    zones: [
      { id: 'cad-glass-collaboration', kind: 'meeting', bounds: { x: .75, z: .5, width: 6.15, depth: 3.55 }, label: 'Design review room', material: '#b8c7cb' },
      { id: 'cad-rendering-pods', kind: 'work', bounds: { x: 2.2, z: 4.5, width: 16.2, depth: 5.2 }, label: 'CAD workstations', material: '#c8b69d' },
      { id: 'cad-prototype-table-zone', kind: 'service', bounds: { x: 7.4, z: 1.25, width: 5.5, depth: 2.0 }, label: 'Modeling and review island', material: '#847968' },
      { id: 'cad-printer-island', kind: 'service', bounds: { x: 14.1, z: .7, width: 4.4, depth: 2.7 }, label: '3D printer island', material: '#a6a19b' },
      { id: 'cad-collaboration-route', kind: 'circulation', bounds: { x: 7.1, z: 3.55, width: 13.5, depth: .78 } },
    ],
    furniture: workplaces => [
      ...sharedRoomFurniture('cad-collaboration', 3.6, 2.1),
      { id: 'cad-modeling-table', asset: 'table.meeting', x: 10.05, z: 2.05 },
      { id: 'cad-modeling-chair-west', asset: 'chair.meeting', x: 8.25, z: 2.05 },
      { id: 'cad-modeling-chair-east', asset: 'chair.meeting', x: 11.85, z: 2.05 },
      { id: 'cad-printer-01', asset: 'equipment.3d-printer', x: 15.9, z: 2.0 },
      { id: 'cad-printer-02', asset: 'equipment.3d-printer', x: 17.7, z: 2.0 },
      { id: 'cad-model-library', asset: 'bookshelf', x: 1.2, z: 12.1, rotationY: Math.PI / 2 },
      ...seatMonitorPlacements('cad', workplaces, 'monitor.dual'),
    ],
    decor: [
      { id: 'cad-rendering-display', asset: 'equipment.whiteboard-display', x: 21.6, y: 2.1, z: 8.35, rotationY: Math.PI / 2 },
      { id: 'cad-model-plants', asset: 'plant.potted', x: 13.5, z: 2.6 },
      { id: 'cad-drawings-board', asset: 'furniture.moodboard', x: 21.65, y: 3.5, z: 11.1, rotationY: Math.PI / 2 },
    ],
    aisles: [
      { x: 6.9, z: 3.55, width: 13.7, depth: .78 },
      { x: 19.1, z: .25, width: 1.25, depth: 13.45 },
      { x: .7, z: 6.75, width: 18.3, depth: .78 },
      { x: .7, z: 10.35, width: 18.3, depth: .7 },
      { x: 10.55, z: 3.55, width: 1.25, depth: 10.1 },
    ],
    camera: { position: [20, 17, -23], target: [0, 1.4, 0], zoom: 1.02, minZoom: .72, maxZoom: 1.8 },
  },
  {
    floorId: 'floor-06',
    specialization: 'research-analytics',
    title: 'Research & Analytics',
    referenceImage: '/design-references/office-v4/floor-07.png',
    theme: 'atrium',
    positions: [
      [3.1, 4.6], [6.1, 4.6], [9.1, 4.6], [13.2, 4.6], [16.3, 4.6],
      [3.8, 8.0], [6.8, 8.0], [9.1, 8.0], [13.2, 8.0], [16.3, 8.0],
    ],
    materials: { floor: 'oak-floor', wall: 'warm-plaster', featureWall: '#253c4a', glazing: 'glass-tint', trim: 'graphite-metal', desk: 'desk-oak', textile: 'sage-fabric', zone: '#d7e2e3' },
    lighting: { exposure: 1.09, ambient: '#e3edf1', key: '#fff4df', fill: '#d5e8f2', keyIntensity: 2.32, fillIntensity: .88, fixtures: [
      { id: 'research-analysis-pendant-west', kind: 'spot', x: 5.6, y: 4.6, z: 5.1, color: '#e5eff2', intensity: .95, distance: 8, angle: .78, target: [5.6, 0, 5.1] },
      { id: 'research-analysis-pendant-east', kind: 'spot', x: 15.8, y: 4.6, z: 8.1, color: '#e5eff2', intensity: .95, distance: 8, angle: .78, target: [15.8, 0, 8.1] },
      { id: 'research-reading-light', kind: 'point', x: 18.3, y: 3.7, z: 2.5, color: '#f4d5a8', intensity: .72, distance: 6 },
    ] },
    windows: [
      { id: 'research-north-window-west', wall: 'north', offset: .8, width: 7.8, sill: 3.35, height: 1.3, frameMaterial: 'graphite-metal' },
      { id: 'research-north-window-east', wall: 'north', offset: 14.1, width: 7.1, sill: 3.35, height: 1.3, frameMaterial: 'graphite-metal' },
    ],
    rooms: [
      { id: 'research-glass-analysis-room', kind: 'meeting', bounds: { x: .75, z: .5, width: 6.1, depth: 3.45 }, capacity: 6, privacy: 'glass', material: 'glass-tint', door: { wall: 'east', offset: 1.05, width: 1.2 } },
      { id: 'research-quiet-library', kind: 'focus', bounds: { x: 15.4, z: .55, width: 5.8, depth: 3.25 }, capacity: 3, privacy: 'open', material: '#c8b79c', door: { wall: 'west', offset: 1.05, width: 1.2, kind: 'open' } },
    ],
    zones: [
      { id: 'research-glass-review-room', kind: 'meeting', bounds: { x: .75, z: .5, width: 6.1, depth: 3.45 }, label: 'Collective analysis room', material: '#bac9cb' },
      { id: 'research-dashboard-wall', kind: 'service', bounds: { x: 7.1, z: 11.4, width: 7.8, depth: 1.7 }, label: 'Analytics wall', material: '#263d48' },
      { id: 'research-analyst-desks', kind: 'work', bounds: { x: 3.2, z: 4.35, width: 15.2, depth: 5.5 }, label: 'Analyst workstations', material: '#c9d3cd' },
      { id: 'research-library-zone', kind: 'focus', bounds: { x: 15.4, z: .55, width: 5.8, depth: 3.25 }, label: 'Quiet investigation library', material: '#9b876e' },
      { id: 'research-data-discussion', kind: 'meeting', bounds: { x: 7.3, z: 1.05, width: 5.8, depth: 2.2 }, label: 'Data discussion table', material: '#c8d9db' },
      { id: 'research-entry-route', kind: 'circulation', bounds: { x: 6.9, z: 3.55, width: 13.7, depth: .78 } },
    ],
    furniture: workplaces => [
      ...sharedRoomFurniture('research-meeting', 3.6, 2.1),
      { id: 'research-discussion-table', asset: 'table.meeting', x: 10.0, z: 2.05 },
      { id: 'research-discussion-chair-west', asset: 'chair.meeting', x: 8.2, z: 2.05 },
      { id: 'research-discussion-chair-east', asset: 'chair.meeting', x: 11.8, z: 2.05 },
      { id: 'research-library-shelf-a', asset: 'bookshelf', x: 16.25, z: 2.4, rotationY: Math.PI / 2 },
      { id: 'research-library-shelf-b', asset: 'bookshelf', x: 18.4, z: 2.4, rotationY: Math.PI / 2 },
      { id: 'research-library-chair', asset: 'armchair.cozy', x: 17.8, z: 1.3 },
      ...seatMonitorPlacements('research', workplaces, 'monitor.dual'),
    ],
    decor: [
      { id: 'research-analytics-wall', asset: 'equipment.analytics-display', x: 11, y: 2.25, z: 13.8 },
      { id: 'research-insight-board', asset: 'equipment.whiteboard-display', x: 21.65, y: 2.3, z: 7.85, rotationY: Math.PI / 2 },
      { id: 'research-reading-plant', asset: 'plant.potted', x: 15.15, z: 1.1 },
    ],
    aisles: [
      { x: 6.9, z: 3.55, width: 13.7, depth: .78 },
      { x: 19.1, z: .25, width: 1.25, depth: 13.45 },
      { x: .7, z: 6.55, width: 18.3, depth: .78 },
      { x: .7, z: 10.35, width: 18.3, depth: .7 },
      { x: 10.55, z: 3.55, width: 1.25, depth: 10.1 },
    ],
    camera: { position: [19.5, 17.2, -23.4], target: [0, 1.48, 0], zoom: 1, minZoom: .72, maxZoom: 1.8 },
  },
  {
    floorId: 'floor-07',
    specialization: 'documentation',
    title: 'Documentation',
    referenceImage: '/design-references/office-v4/floor-08.png',
    theme: 'library',
    positions: [
      [3.1, 4.8], [6.1, 4.8], [13.3, 4.8], [16.3, 4.8], [3.1, 8.35],
      [6.1, 8.35], [9.2, 8.35], [13.3, 8.35], [16.3, 8.35], [9.2, 4.8],
    ],
    materials: { floor: 'oak-floor', wall: 'warm-plaster', featureWall: '#826348', glazing: 'glass-tint', trim: 'graphite-metal', desk: 'desk-oak', textile: 'sage-fabric', zone: '#e1d7c8' },
    lighting: { exposure: 1.07, ambient: '#e8e7e1', key: '#fff2de', fill: '#e1e9e4', keyIntensity: 2.18, fillIntensity: .76, fixtures: [
      { id: 'documentation-writing-pendant-west', kind: 'spot', x: 5.1, y: 4.6, z: 5.1, color: '#ffebc8', intensity: .92, distance: 8, angle: .78, target: [5.1, 0, 5.1] },
      { id: 'documentation-writing-pendant-east', kind: 'spot', x: 14.8, y: 4.6, z: 8.1, color: '#ffebc8', intensity: .92, distance: 8, angle: .78, target: [14.8, 0, 8.1] },
      { id: 'documentation-reading-lamp', kind: 'point', x: 17.9, y: 3.6, z: 2.25, color: '#f1d19c', intensity: .75, distance: 6 },
    ] },
    windows: [
      { id: 'documentation-north-window-west', wall: 'north', offset: .9, width: 7.7, sill: 1.2, height: 3.2, frameMaterial: 'graphite-metal' },
      { id: 'documentation-north-window-east', wall: 'north', offset: 13.2, width: 7.7, sill: 1.2, height: 3.2, frameMaterial: 'graphite-metal' },
    ],
    rooms: [
      { id: 'documentation-glass-review-room', kind: 'meeting', bounds: { x: .75, z: .5, width: 6.15, depth: 3.55 }, capacity: 6, privacy: 'glass', material: 'glass-tint', door: { wall: 'east', offset: 1.1, width: 1.2 } },
      { id: 'documentation-reading-nook', kind: 'focus', bounds: { x: 15.35, z: .55, width: 5.8, depth: 3.25 }, capacity: 4, privacy: 'open', material: '#b9a48b', door: { wall: 'west', offset: 1.05, width: 1.2, kind: 'open' } },
    ],
    zones: [
      { id: 'documentation-review-room', kind: 'meeting', bounds: { x: .75, z: .5, width: 6.15, depth: 3.55 }, label: 'Document review room', material: '#c8c3b4' },
      { id: 'documentation-writing-desks', kind: 'work', bounds: { x: 2.2, z: 4.5, width: 16.4, depth: 5.4 }, label: 'Writing and editing stations', material: '#c6b39b' },
      { id: 'documentation-archive', kind: 'service', bounds: { x: .5, z: 4.2, width: 2.2, depth: 6.5 }, label: 'Archive shelves', material: '#775a40' },
      { id: 'documentation-collaborative-table', kind: 'meeting', bounds: { x: 7.2, z: 1.0, width: 5.8, depth: 2.3 }, label: 'Collaborative documentation table', material: '#d5c4a9' },
      { id: 'documentation-reading-zone', kind: 'focus', bounds: { x: 15.35, z: .55, width: 5.8, depth: 3.25 }, label: 'Quiet reading nook', material: '#9a8068' },
      { id: 'documentation-access-route', kind: 'circulation', bounds: { x: 6.9, z: 3.55, width: 13.7, depth: .78 } },
    ],
    furniture: () => [
      ...sharedRoomFurniture('documentation-review', 3.6, 2.1),
      { id: 'documentation-shared-table', asset: 'table.meeting', x: 10.1, z: 2.05 },
      { id: 'documentation-shared-chair-west', asset: 'chair.meeting', x: 8.3, z: 2.05 },
      { id: 'documentation-shared-chair-east', asset: 'chair.meeting', x: 11.9, z: 2.05 },
      ...[4.9, 8.9, 12.2].map((z, index): FloorPlacementPreset => ({ id: `documentation-archive-shelf-${index + 1}`, asset: 'equipment.archive-shelf', x: 1.35, z, rotationY: Math.PI / 2 })),
      { id: 'documentation-reading-sofa', asset: 'sofa.cozy', x: 16.4, z: 1.3 },
      { id: 'documentation-reading-table', asset: 'table.coffee', x: 16.4, z: 2.75 },
      { id: 'documentation-reading-chair', asset: 'armchair.cozy', x: 18.45, z: 2.75 },
    ],
    decor: [
      { id: 'documentation-review-display', asset: 'equipment.whiteboard-display', x: 21.6, y: 2.2, z: 8.25, rotationY: Math.PI / 2 },
      { id: 'documentation-reading-plant', asset: 'plant.potted', x: 18, z: 1.1 },
      { id: 'documentation-reference-art', asset: 'wall.decoration', x: 21.6, y: 3.6, z: 11.4, rotationY: Math.PI / 2 },
    ],
    aisles: [
      { x: 6.9, z: 3.55, width: 13.7, depth: .78 },
      { x: 19.1, z: .25, width: 1.25, depth: 13.45 },
      { x: .7, z: 6.75, width: 18.3, depth: .78 },
      { x: .7, z: 10.35, width: 18.3, depth: .7 },
      { x: 10.55, z: 3.55, width: 1.25, depth: 10.1 },
    ],
    camera: { position: [19.2, 17.1, -23.1], target: [0, 1.45, 0], zoom: 1, minZoom: .72, maxZoom: 1.8 },
  },
]

function makeWorkplaces(definition: FloorDefinition, employees: readonly WorldEmployee[], desks: readonly DeskObject[], options: OfficeV4PresetOptions): FloorWorkplacePreset[] {
  const worldFloorId = officeV4ToWorldFloorId(definition.floorId)
  const floorDesks = desks.filter(desk => desk.floorId === worldFloorId)
  const floorEmployees = employees.filter(employee => employee.departmentId === definition.specialization)
  const employeesOnOtherFloors = employees.filter(employee => employee.departmentId === definition.specialization && employee.floorId !== worldFloorId)
  if (employeesOnOtherFloors.length) throw new Error(`office_v4_employee_floor_mismatch:${definition.specialization}`)
  if (floorDesks.length !== definition.positions.length) throw new Error(`office_v4_desk_capacity_mismatch:${definition.floorId}:${floorDesks.length}`)

  const deskById = new Map(floorDesks.map(desk => [desk.deskId, desk]))
  if (deskById.size !== floorDesks.length) throw new Error(`office_v4_duplicate_desk_id:${definition.floorId}`)
  const deskBySlot = new Map<number, DeskObject>()
  for (const desk of floorDesks) {
    const canonical = new RegExp(`^desk-${worldFloorId}-(\\d+)$`).exec(desk.deskId)
    const slot = options.deskSlotById?.get(desk.deskId) ?? (canonical ? Number(canonical[1]) : undefined)
    if (!Number.isInteger(slot) || slot! < 1 || slot! > definition.positions.length) throw new Error(`office_v4_desk_slot_unmapped:${desk.deskId}`)
    if (deskBySlot.has(slot!)) throw new Error(`office_v4_duplicate_desk_slot:${definition.floorId}:${slot}`)
    deskBySlot.set(slot!, desk)
  }
  const employeeByDesk = new Map<string, WorldEmployee>()
  for (const employee of floorEmployees) {
    if (employee.floorId !== worldFloorId) throw new Error(`office_v4_employee_floor_mismatch:${employee.employeeId}`)
    if (employeeByDesk.has(employee.deskId)) throw new Error(`office_v4_duplicate_employee_desk:${employee.deskId}`)
    const desk = deskById.get(employee.deskId)
    if (!desk || desk.occupiedBy !== employee.employeeId) throw new Error(`office_v4_directory_binding_mismatch:${employee.employeeId}:${employee.deskId}`)
    employeeByDesk.set(employee.deskId, employee)
  }

  return definition.positions.map(([x, z], index) => {
    const desk = deskBySlot.get(index + 1)
    if (!desk) throw new Error(`office_v4_directory_desk_slot_missing:${definition.floorId}:${index + 1}`)
    const deskId = desk.deskId
    const employee = employeeByDesk.get(deskId)
    return {
      id: desk.deskId,
      deskId: desk.deskId,
      x,
      z,
      width: definition.specialization === 'cad-3d' ? 1.65 : 1.5,
      depth: definition.specialization === 'cad-3d' ? .82 : .8,
      kind: definition.specialization === 'engineering-electronics' ? 'lab' : definition.specialization === 'cad-3d' ? 'cad' : definition.specialization === 'documentation' ? 'focus' : 'standard',
      ...(employee ? { employeeId: employee.employeeId } : {}),
      ...(definition.specialization === 'engineering-electronics' ? { equipment: ['equipment.oscilloscope'] } : {}),
    }
  })
}

function buildPreset(definition: FloorDefinition, employees: readonly WorldEmployee[], desks: readonly DeskObject[], options: OfficeV4PresetOptions): FloorDesignPreset {
  const workplaces = makeWorkplaces(definition, employees, desks, options)
  const entrances: FloorDesignPreset['entrances'] = [{ id: `${definition.specialization}-south-elevator`, wall: 'south', offset: 19.25, width: 1.4, kind: 'elevator' }]
  return {
    schemaVersion: 1,
    floorId: definition.floorId,
    presetId: `office-v4-${definition.specialization}`,
    specialization: definition.specialization,
    referenceImage: definition.referenceImage,
    theme: definition.theme,
    bounds: { width: 22, depth: 14, height: 5.8 },
    zones: definition.zones,
    rooms: definition.rooms,
    barriers: [],
    windows: definition.windows,
    entrances,
    materials: definition.materials,
    lighting: definition.lighting,
    furniture: definition.furniture(workplaces),
    decor: definition.decor,
    workplaces,
    aisles: definition.aisles,
    camera: definition.camera,
  }
}

/**
 * Bind authored seat geometry to the current Directory snapshot. Matching is
 * by the stable desk ID, never by display name or employee array position.
 * Unknown desk-ID schemes fail closed so the integration adapter can provide
 * an explicit mapping rather than moving employees silently.
 */
export function createOfficeV4Presets(employees: readonly WorldEmployee[], desks: readonly DeskObject[], options: OfficeV4PresetOptions = {}): readonly FloorDesignPreset[] {
  const departments = new Set(floorDefinitions.map(definition => definition.specialization))
  const assignedEmployees = employees.filter(employee => departments.has(employee.departmentId))
  if (new Set(assignedEmployees.map(employee => employee.employeeId)).size !== assignedEmployees.length) throw new Error('office_v4_duplicate_employee_id')
  return floorDefinitions.map(definition => buildPreset(definition, employees, desks, options))
}

export const OFFICE_V4_FLOOR_GROUP = Object.freeze({
  floors: Object.freeze(['floor-04', 'floor-05', 'floor-06', 'floor-07']),
  specializations: Object.freeze(floorDefinitions.map(definition => definition.specialization)),
  referenceImages: Object.freeze(floorDefinitions.map(definition => definition.referenceImage)),
})

