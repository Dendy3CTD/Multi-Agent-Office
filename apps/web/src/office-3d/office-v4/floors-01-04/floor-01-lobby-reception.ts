import type { FloorDesignPreset } from '../../floor-presets/types'
import { FLOOR_BOUNDS, LOFT_MATERIALS, prop } from './shared'

const lobbyAisles = [
  { x: 10.0, z: 0, width: 1.2, depth: 6.5 },
  { x: 1.0, z: 6.5, width: 21.0, depth: 1.05 },
  { x: 7.2, z: 0, width: 1.05, depth: 7.55 },
  { x: 20.6, z: 0, width: 1.4, depth: 12.8 },
]

export const FLOOR_01_LOBBY_RECEPTION: FloorDesignPreset = {
  schemaVersion: 1,
  floorId: 'floor-00',
  presetId: 'office-v4-floor-01-lobby-reception-v1',
  specialization: 'lobby-reception',
  referenceImage: '/design-references/office-v4/floor-01.png',
  theme: 'showroom',
  bounds: FLOOR_BOUNDS,
  zones: [
    { id: 'lobby-glass-meeting', kind: 'meeting', bounds: { x: 0.6, z: 0.65, width: 6.6, depth: 3.9 }, label: 'Guest meeting room', material: 'bronze-glass' },
    { id: 'lobby-coffee-point', kind: 'service', bounds: { x: 1.0, z: 8.5, width: 5.5, depth: 4.0 }, label: 'Coffee point by the windows', material: 'sage-ceramic' },
    { id: 'lobby-check-in-approach', kind: 'reception', bounds: { x: 8.5, z: 2.0, width: 6.8, depth: 4.2 }, label: 'Guest check-in', material: 'bronze' },
    { id: 'lobby-reception-suite', kind: 'reception', bounds: { x: 15.8, z: 8.2, width: 3.4, depth: 4.3 }, label: 'Reception desk', material: 'walnut' },
    { id: 'lobby-guest-lounge', kind: 'lounge', bounds: { x: 14.0, z: 1.2, width: 4.8, depth: 4.4 }, label: 'Guest waiting lounge', material: 'sage-fabric' },
    { id: 'lobby-entry-route', kind: 'circulation', bounds: { x: 10.0, z: 0, width: 1.2, depth: 6.5 }, label: 'Main entrance route' },
    { id: 'lobby-public-crossing', kind: 'circulation', bounds: lobbyAisles[1], label: 'Accessible lobby route' },
  ],
  rooms: [
    { id: 'lobby-glass-meeting-room', kind: 'meeting', bounds: { x: 0.6, z: 0.65, width: 6.6, depth: 3.9 }, capacity: 6, privacy: 'glass', material: 'bronze-glass', door: { wall: 'north', offset: 2.55, width: 1.3, kind: 'door' } },
  ],
  barriers: [],
  windows: [
    { id: 'lobby-west-window', wall: 'north', offset: 1.1, width: 5.7, sill: 1.05, height: 3.15, frameMaterial: 'graphite-metal' },
    { id: 'lobby-center-window', wall: 'north', offset: 7.2, width: 5.7, sill: 1.05, height: 3.15, frameMaterial: 'graphite-metal' },
    { id: 'lobby-east-window', wall: 'north', offset: 13.3, width: 7.5, sill: 1.05, height: 3.15, frameMaterial: 'graphite-metal' },
  ],
  entrances: [
    { id: 'public-south-entry', wall: 'south', offset: 9.5, width: 2.2, kind: 'door' },
    { id: 'east-elevator', wall: 'east', offset: 6.0, width: 1.4, kind: 'elevator' },
  ],
  materials: { ...LOFT_MATERIALS, featureWall: '#A94E35', desk: '#4D3529', textile: '#75877B', receptionStone: '#D7C7AE' },
  lighting: {
    exposure: 1.08, ambient: '#E8EDF1', key: '#FFF0D9', fill: '#DDE8E6', keyIntensity: 2.45, fillIntensity: 0.85,
    fixtures: [
      { id: 'reception-counter-glow', kind: 'spot', x: 18.0, y: 4.8, z: 10.3, color: '#FFD58A', intensity: 20, distance: 8, angle: 0.55, target: [18.0, 0.9, 10.3] },
      { id: 'guest-lounge-pendant', kind: 'point', x: 16.5, y: 4.2, z: 3.2, color: '#F6D5A5', intensity: 13, distance: 7 },
      { id: 'coffee-task-light', kind: 'spot', x: 3.2, y: 3.8, z: 10.1, color: '#FFE5BE', intensity: 15, distance: 7, angle: 0.65, target: [3.2, 1.0, 10.1] },
    ],
  },
  furniture: [
    prop('lobby-reception-counter', 'desk.reception', 18.0, 10.2, { rotationY: Math.PI / 2 }),
    prop('lobby-check-in-kiosk', 'furniture.kiosk', 12.1, 5.2, { interaction: { kind: 'display', targetId: 'lobby-check-in' } }),
    prop('lobby-glass-room-table', 'table.meeting', 3.9, 2.55),
    prop('lobby-glass-room-chair-west', 'chair.meeting', 2.05, 2.55),
    prop('lobby-glass-room-chair-east', 'chair.meeting', 5.75, 2.55),
    prop('lobby-glass-room-chair-south', 'chair.meeting', 3.9, 1.55),
    prop('lobby-glass-room-chair-north', 'chair.meeting', 3.9, 3.55),
    prop('lobby-coffee-counter', 'equipment.cafe-counter', 3.0, 10.35),
    prop('lobby-coffee-table', 'furniture.cafe-table', 3.0, 8.55),
    prop('lobby-coffee-stool-west', 'chair.meeting', 2.0, 8.55),
    prop('lobby-coffee-stool-east', 'chair.meeting', 4.0, 8.55),
    prop('lobby-waiting-sofa', 'sofa.cozy', 16.8, 2.75),
    prop('lobby-waiting-coffee-table', 'table.coffee', 16.8, 4.0),
    prop('lobby-waiting-chair-west', 'armchair.cozy', 14.3, 3.35),
    prop('lobby-waiting-chair-east', 'armchair.cozy', 18.6, 4.4),
    prop('lobby-reserved-station-01-monitor', 'monitor.single', 18.3, 7.46, { y: 1.08, deskId: 'desk-floor-1-01' }),
    prop('lobby-reserved-station-02-monitor', 'monitor.single', 18.3, 10.26, { y: 1.08, deskId: 'desk-floor-1-02' }),
  ],
  decor: [
    prop('lobby-coffee-machine', 'equipment.espresso-machine', 3.0, 10.35, { y: 1.25 }),
    prop('lobby-brand-wall-display', 'equipment.whiteboard-display', 21.2, 10.1, { y: 2.4 }),
    prop('lobby-brand-mark', 'wall.decoration', 21.1, 8.2, { y: 2.7 }),
    prop('lobby-window-plant', 'plant.potted', 1.0, 12.5),
    prop('lobby-waiting-plant', 'plant.potted', 18.5, 1.15),
    prop('lobby-warm-wall-sconce', 'decor.wall.sconce', 20.9, 12.8, { y: 2.6 }),
  ],
  workplaces: [
    { id: 'desk-floor-1-01', deskId: 'desk-floor-1-01', x: 14.0, z: 8.0, width: 1.5, depth: 1.25, kind: 'standing' },
    { id: 'desk-floor-1-02', deskId: 'desk-floor-1-02', x: 16.2, z: 8.0, width: 1.5, depth: 1.25, kind: 'standing' },
  ],
  aisles: lobbyAisles,
  camera: { position: [19, 18, -23], target: [0, 1.45, 0], zoom: 1, minZoom: 0.72, maxZoom: 1.8 },
}
