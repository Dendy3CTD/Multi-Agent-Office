// ===== ROOM DEFINITIONS =====
// Each room is an empty shell with positions for furniture placement
// Furniture items are placed on a grid within each room

export type RoomId =
  | 'main-office'
  | 'manager-office'
  | 'ceo-office'
  | 'meeting-room'
  | 'kitchen'
  | 'server-room'
  | 'lobby'
  | 'nap-room'
  | 'rooftop'
  | 'gym'
  | 'parking'

import type { ScenePoint, SceneRect } from './sceneGeometry'
import { scenePoint, sceneRect } from './sceneGeometry'

export interface Waypoint {
  id: string
  x: number  // percentage
  y: number
  connections: string[]  // ids of connected waypoints
}

export interface FurnitureItem {
  id: string
  type: string        // e.g. 'desk-dual', 'chair-aeron', 'plant-monstera'
  sprite: string      // sprite sheet + frame reference
  x: number           // percentage position within room (0-100)
  y: number
  zIndex?: number
  state?: string      // e.g. 'empty', 'occupied', 'brewing'
  interactive?: boolean
  label?: string
  /** Separate hit area; never reuse the visual anchor for interaction geometry. */
  interactionArea?: SceneRect
  approachPoint?: ScenePoint
  interactionPoint?: ScenePoint
}

export interface CollisionRect {
  id: string
  x: number
  y: number
  width: number
  height: number
  kind: 'desk' | 'chair' | 'sofa' | 'table' | 'cabinet' | 'plant' | 'appliance' | 'wall'
}

export type SpriteFacing = 'front-left' | 'front-right' | 'rear-left' | 'rear-right'

export interface RoomConnection {
  toRoom: RoomId
  position: { x: number; y: number }  // door/exit position in current room (%)
  label?: string
  exitFacing?: SpriteFacing   // agent direction when leaving through this door
  entryFacing?: SpriteFacing  // agent direction when arriving through this door
}

export interface AgentSpot {
  id: string
  type: 'desk' | 'meeting-seat' | 'lounge' | 'standing' | 'water' | 'coffee' | 'filing' | 'printer' | 'door'
  x: number
  y: number
  facing?: 'up' | 'down' | 'left' | 'right'
  spriteFacing?: SpriteFacing  // which direction the agent faces when at this spot
  zIndex?: number  // explicit z-index override (for agents behind desks)
  workstationId?: string
}

/**
 * A workstation has independent visual, physical, interaction and character
 * anchors. `standingPoint` is the character's foot anchor: it is deliberately
 * outside the chair and desk rectangles, so a standing pose never sits inside
 * the baked furniture.
 */
export interface WorkstationDefinition {
  id: string
  role: 'director' | 'developer' | 'engineer' | 'analyst'
  deskCenter: ScenePoint
  deskBounds: SceneRect
  chairBounds: SceneRect
  standingPoint: ScenePoint
  approachPoint: ScenePoint
  interactionPoint: ScenePoint
  interactionArea: SceneRect
}

export interface Room {
  id: RoomId
  name: string
  description: string
  background: {
    day: string       // path to empty room background
    night: string
  }
  width: number       // room dimensions in px (rendered)
  height: number
  furniture: FurnitureItem[]
  connections: RoomConnection[]
  agentSpots: AgentSpot[]       // where agents can sit/stand/work
  entryPoint: { x: number; y: number }  // where agents appear when entering
  walkableArea?: { x: number; y: number }[]  // polygon defining where agents can walk
  ambience?: string   // ambient sound loop
  waypoints?: Waypoint[]  // named walkable nodes for pathfinding
  /** Collision geometry in the same percentage coordinate system as spots. */
  obstacles?: CollisionRect[]
  /** Radius of a walking character, used to inflate obstacles during routing. */
  agentRadius?: number
}

/** Hitboxes measured against office-four-person.png, not against the browser. */
export const MAIN_OFFICE_INTERACTION_AREAS: Record<string, SceneRect> = {
  'coffee': sceneRect(1280, 245, 125, 125),
  'filing-1': sceneRect(90, 650, 125, 145),
  'plant-1': sceneRect(1340, 650, 160, 165),
  'plant-2': sceneRect(565, 90, 150, 175),
  'plant-3': sceneRect(75, 420, 135, 170),
  'printer-1': sceneRect(1360, 235, 125, 135),
  'fire-extinguisher': sceneRect(72, 185, 75, 105),
  'water-cooler': sceneRect(690, 95, 85, 125),
  'bell': sceneRect(1110, 75, 65, 75),
  'kanban-board': sceneRect(790, 75, 180, 150),
  'ship-it-poster': sceneRect(105, 175, 95, 100),
  'tv-monitor': sceneRect(1260, 90, 160, 155),
}

export const MAIN_OFFICE_WORKSTATIONS: WorkstationDefinition[] = [
  {
    id: 'workstation-director', role: 'director', deskCenter: scenePoint(640, 342),
    deskBounds: sceneRect(505, 278, 270, 130), chairBounds: sceneRect(570, 375, 135, 92),
    standingPoint: scenePoint(640, 500), approachPoint: scenePoint(640, 490), interactionPoint: scenePoint(640, 438),
    interactionArea: sceneRect(500, 275, 280, 145),
  },
  {
    id: 'workstation-developer', role: 'developer', deskCenter: scenePoint(1050, 342),
    deskBounds: sceneRect(920, 278, 270, 130), chairBounds: sceneRect(975, 375, 135, 92),
    standingPoint: scenePoint(1050, 500), approachPoint: scenePoint(1050, 490), interactionPoint: scenePoint(1050, 438),
    interactionArea: sceneRect(920, 275, 280, 145),
  },
  {
    id: 'workstation-engineer', role: 'engineer', deskCenter: scenePoint(640, 595),
    deskBounds: sceneRect(505, 535, 270, 140), chairBounds: sceneRect(570, 625, 135, 95),
    standingPoint: scenePoint(640, 760), approachPoint: scenePoint(640, 750), interactionPoint: scenePoint(640, 690),
    interactionArea: sceneRect(500, 530, 280, 155),
  },
  {
    id: 'workstation-analyst', role: 'analyst', deskCenter: scenePoint(1050, 595),
    deskBounds: sceneRect(920, 535, 270, 140), chairBounds: sceneRect(975, 625, 135, 95),
    standingPoint: scenePoint(1050, 760), approachPoint: scenePoint(1050, 750), interactionPoint: scenePoint(1050, 690),
    interactionArea: sceneRect(920, 530, 280, 155),
  },
]

export function workstationForRole(role: string): WorkstationDefinition | undefined {
  return MAIN_OFFICE_WORKSTATIONS.find(workstation => workstation.role === role)
}

export function workstationForId(id: string): WorkstationDefinition | undefined {
  return MAIN_OFFICE_WORKSTATIONS.find(workstation => workstation.id === id)
}

// ===== ROOM DEFINITIONS =====

export const ROOMS: Record<RoomId, Room> = {
  'main-office': {
    id: 'main-office',
    name: 'Four-person Office',
    description: 'Warm open-plan office with four baked-in workstations',
    background: {
      day: '/rooms/office-four-person.png',
      night: '/rooms/office-four-person.png',
    },
    width: 1672,
    height: 941,
    furniture: [
      // All desks and chairs are baked into office-four-person.png. These
      // records are semantic anchors only; App renders no furniture sprites.
      { id: 'desk-director', type: 'desk-standing', sprite: 'baked', ...scenePoint(640, 342), interactionArea: workstationForRole('director')!.interactionArea, interactive: true, label: 'Director desk' },
      { id: 'chair-director', type: 'chair', sprite: 'baked', ...scenePoint(640, 438), interactionArea: sceneRect(570, 378, 130, 95), interactive: true, label: 'Director chair' },
      { id: 'desk-developer', type: 'desk-standing', sprite: 'baked', ...scenePoint(1050, 342), interactionArea: workstationForRole('developer')!.interactionArea, interactive: true, label: 'Developer desk' },
      { id: 'chair-developer', type: 'chair', sprite: 'baked', ...scenePoint(1050, 438), interactionArea: sceneRect(975, 378, 130, 95), interactive: true, label: 'Developer chair' },
      { id: 'desk-engineer', type: 'desk-standing', sprite: 'baked', ...scenePoint(640, 595), interactionArea: workstationForRole('engineer')!.interactionArea, interactive: true, label: 'Engineer desk' },
      { id: 'chair-engineer', type: 'chair', sprite: 'baked', ...scenePoint(640, 690), interactionArea: sceneRect(570, 625, 130, 95), interactive: true, label: 'Engineer chair' },
      { id: 'desk-analyst', type: 'desk-standing', sprite: 'baked', ...scenePoint(1050, 595), interactionArea: workstationForRole('analyst')!.interactionArea, interactive: true, label: 'Analyst desk' },
      { id: 'chair-analyst', type: 'chair', sprite: 'baked', ...scenePoint(1050, 690), interactionArea: sceneRect(975, 625, 130, 95), interactive: true, label: 'Analyst chair' },
      { id: 'coffee', type: 'coffee-machine', sprite: 'baked', x: 86, y: 28, interactive: true, state: 'off', label: 'Coffee machine' },
      { id: 'filing-1', type: 'filing-cabinet', sprite: 'baked', x: 10, y: 72, state: 'closed', label: 'Filing cabinet' },
      { id: 'plant-1', type: 'plant-monstera', sprite: 'baked', x: 91, y: 67, interactive: true, label: 'Monstera' },
      { id: 'plant-2', type: 'plant-snake', sprite: 'baked', x: 36, y: 20, interactive: true, label: 'Snake plant' },
      { id: 'plant-3', type: 'plant-money', sprite: 'baked', x: 10, y: 75, interactive: true, label: 'Money tree' },
      { id: 'printer-1', type: 'printer', sprite: 'baked', x: 84, y: 28, interactive: true, state: 'working', label: 'Printer' },
      { id: 'fire-extinguisher', type: 'hotspot', sprite: 'baked', x: 5, y: 31, interactive: true, label: 'Fire extinguisher' },
      { id: 'water-cooler', type: 'hotspot', sprite: 'baked', x: 45, y: 22, interactive: true, label: 'Water cooler' },
      { id: 'bell', type: 'hotspot', sprite: 'baked', x: 69, y: 17, interactive: true, label: 'Bell' },
      { id: 'kanban-board', type: 'hotspot', sprite: 'baked', x: 51, y: 16, interactive: true, label: 'Task board' },
      { id: 'ship-it-poster', type: 'hotspot', sprite: 'baked', x: 8, y: 26, interactive: true, label: 'Ship it poster' },
      { id: 'tv-monitor', type: 'hotspot', sprite: 'baked', x: 87, y: 31, interactive: true, label: 'Dashboard' },
    ],
    connections: [
      { toRoom: 'manager-office', position: { x: 50, y: 91 }, label: "Manager's Office", exitFacing: 'rear-right', entryFacing: 'front-right' },
    ],
    agentSpots: [
      // Preserve the semantic `desk` kind used by assignment/reducer logic;
      // these coordinates are safe standing points in front of each desk.
      { id: 'spot-director', type: 'desk', ...workstationForRole('director')!.standingPoint, facing: 'up', spriteFacing: 'front-left', zIndex: 56, workstationId: 'workstation-director' },
      { id: 'spot-developer', type: 'desk', ...workstationForRole('developer')!.standingPoint, facing: 'up', spriteFacing: 'front-right', zIndex: 56, workstationId: 'workstation-developer' },
      { id: 'spot-engineer', type: 'desk', ...workstationForRole('engineer')!.standingPoint, facing: 'up', spriteFacing: 'front-left', zIndex: 83, workstationId: 'workstation-engineer' },
      { id: 'spot-analyst', type: 'desk', ...workstationForRole('analyst')!.standingPoint, facing: 'up', spriteFacing: 'front-right', zIndex: 83, workstationId: 'workstation-analyst' },
      // Activity spots
      { id: 'spot-coffee-1', type: 'coffee', x: 84, y: 32, facing: 'down', spriteFacing: 'rear-left' },
      { id: 'spot-coffee-2', type: 'coffee', x: 88, y: 32, facing: 'down', spriteFacing: 'front-right' },
      { id: 'spot-water-1', type: 'water', x: 45, y: 27, facing: 'down', spriteFacing: 'rear-left' },
      { id: 'spot-water-2', type: 'water', x: 48, y: 27, facing: 'down', spriteFacing: 'front-right' },
      { id: 'spot-filing', type: 'filing', x: 12, y: 75, facing: 'down', spriteFacing: 'front-right', zIndex: 70 },
      { id: 'spot-printer', type: 'printer', x: 84, y: 34, facing: 'down', spriteFacing: 'rear-left' },
      { id: 'spot-door-2', type: 'door', x: 47, y: 87, facing: 'down', spriteFacing: 'rear-right' },
      { id: 'spot-door-3', type: 'door', x: 53, y: 87, facing: 'down', spriteFacing: 'front-right' },
    ],
    entryPoint: scenePoint(836, 805),
    walkableArea: [scenePoint(82, 82), scenePoint(1590, 82), scenePoint(1590, 810), scenePoint(82, 810)],
    agentRadius: 1.15,
    obstacles: [
      { id: 'obstacle-director-desk', ...workstationForRole('director')!.deskBounds, kind: 'desk' },
      { id: 'obstacle-developer-desk', ...workstationForRole('developer')!.deskBounds, kind: 'desk' },
      { id: 'obstacle-engineer-desk', ...workstationForRole('engineer')!.deskBounds, kind: 'desk' },
      { id: 'obstacle-analyst-desk', ...workstationForRole('analyst')!.deskBounds, kind: 'desk' },
      { id: 'obstacle-director-chair', ...workstationForRole('director')!.chairBounds, kind: 'chair' },
      { id: 'obstacle-developer-chair', ...workstationForRole('developer')!.chairBounds, kind: 'chair' },
      { id: 'obstacle-engineer-chair', ...workstationForRole('engineer')!.chairBounds, kind: 'chair' },
      { id: 'obstacle-analyst-chair', ...workstationForRole('analyst')!.chairBounds, kind: 'chair' },
      { id: 'obstacle-sofa', ...sceneRect(170, 215, 260, 110), kind: 'sofa' },
      { id: 'obstacle-coffee-table', ...sceneRect(220, 338, 155, 88), kind: 'table' },
      { id: 'obstacle-kitchen', ...sceneRect(1230, 250, 305, 155), kind: 'appliance' },
      { id: 'obstacle-right-cabinets', ...sceneRect(1410, 305, 150, 495), kind: 'cabinet' },
      { id: 'obstacle-left-cabinets', ...sceneRect(78, 430, 90, 365), kind: 'cabinet' },
      { id: 'obstacle-plant-top-left', ...sceneRect(135, 78, 130, 155), kind: 'plant' },
      { id: 'obstacle-plant-top-center', ...sceneRect(580, 105, 125, 150), kind: 'plant' },
      { id: 'obstacle-plant-top-right', ...sceneRect(1100, 105, 100, 150), kind: 'plant' },
      { id: 'obstacle-plant-bottom-left', ...sceneRect(420, 670, 145, 150), kind: 'plant' },
      { id: 'obstacle-plant-bottom-right', ...sceneRect(1360, 650, 135, 155), kind: 'plant' },
    ],
    waypoints: [], // Legacy helper data is intentionally disabled; navigation.ts owns collision-aware routing.
    /*
      // User-mapped routes from /?helper — spots + aisle junctions
      { id: 'W-door',      x: 67.5, y: 48.9, connections: ['W-door-2', 'W-door-3'] },
      { id: 'W-door-2',    x: 64,   y: 46.6, connections: ['W-door', 'W-water-1', 'W-new-6'] },
      { id: 'W-door-3',    x: 69.9, y: 50.8, connections: ['W-door', 'W-coffee-1', 'W-spot-10', 'W-new-7'] },
      { id: 'W-water-1',   x: 53.3, y: 46.6, connections: ['W-door-2', 'W-water-2', 'W-spot-5'] },
      { id: 'W-water-2',   x: 56,   y: 47.7, connections: ['W-water-1', 'W-door-2', 'W-new-10'] },
      { id: 'W-spot-6',    x: 38.8, y: 43.6, connections: ['W-spot-4', 'W-water-1'] },
      { id: 'W-spot-4',    x: 38.5, y: 55.2, connections: ['W-spot-6', 'W-spot-5', 'W-spot-3', 'W-filing', 'W-new-19'] },
      { id: 'W-spot-5',    x: 48.9, y: 52.9, connections: ['W-spot-4', 'W-water-1', 'W-filing', 'W-spot-9'] },
      { id: 'W-filing',    x: 47.8, y: 57.6, connections: ['W-spot-4', 'W-spot-5', 'W-spot-9', 'W-new-4'] },
      { id: 'W-spot-3',    x: 26.9, y: 59.2, connections: ['W-spot-4', 'W-spot-1'] },
      { id: 'W-spot-1',    x: 25.8, y: 71,   connections: ['W-spot-3', 'W-spot-2', 'W-new-12'] },
      { id: 'W-spot-2',    x: 37.9, y: 68.2, connections: ['W-spot-1', 'W-spot-4', 'W-spot-7', 'W-new-2'] },
      { id: 'W-spot-9',    x: 55.2, y: 66.8, connections: ['W-filing', 'W-spot-5', 'W-spot-7', 'W-spot-10'] },
      { id: 'W-spot-10',   x: 68.7, y: 66.2, connections: ['W-spot-9', 'W-spot-8', 'W-door-3', 'W-coffee-1'] },
      { id: 'W-spot-7',    x: 52.7, y: 78.8, connections: ['W-spot-9', 'W-spot-2', 'W-spot-8'] },
      { id: 'W-spot-8',    x: 65.9, y: 75.8, connections: ['W-spot-7', 'W-spot-10', 'W-new-22'] },
      { id: 'W-coffee-1',  x: 73.5, y: 56.7, connections: ['W-door-3', 'W-coffee-2', 'W-spot-10'] },
      { id: 'W-coffee-2',  x: 76.2, y: 58.4, connections: ['W-coffee-1', 'W-printer'] },
      { id: 'W-printer',   x: 81,   y: 63,   connections: ['W-coffee-2', 'W-new-23'] },
      // Aisle junctions
      { id: 'W-new-1',     x: 44.8, y: 63.1, connections: ['W-new-3'] },
      { id: 'W-new-2',     x: 57.5, y: 51.6, connections: ['W-spot-2', 'W-new-5'] },
      { id: 'W-new-3',     x: 37.5, y: 67.6, connections: ['W-new-1'] },
      { id: 'W-new-4',     x: 44.3, y: 63.3, connections: ['W-filing', 'W-new-14'] },
      { id: 'W-new-5',     x: 47.4, y: 58.3, connections: ['W-new-2'] },
      { id: 'W-new-6',     x: 57,   y: 52.2, connections: ['W-door-2', 'W-new-8'] },
      { id: 'W-new-7',     x: 63.9, y: 46.8, connections: ['W-door-3'] },
      { id: 'W-new-8',     x: 68.5, y: 49.9, connections: ['W-new-6'] },
      { id: 'W-new-10',    x: 55.6, y: 49.2, connections: ['W-water-2'] },
      { id: 'W-new-12',    x: 36.3, y: 76.8, connections: ['W-spot-1', 'W-new-13'] },
      { id: 'W-new-13',    x: 25.8, y: 72.2, connections: ['W-new-12', 'W-new-16'] },
      { id: 'W-new-14',    x: 36.9, y: 76.7, connections: ['W-new-4'] },
      { id: 'W-new-16',    x: 18.5, y: 59.5, connections: ['W-new-13', 'W-new-18'] },
      { id: 'W-new-18',    x: 29.9, y: 47.1, connections: ['W-new-16', 'W-new-20'] },
      { id: 'W-new-19',    x: 18.3, y: 57.7, connections: ['W-spot-4'] },
      { id: 'W-new-20',    x: 38.8, y: 54.2, connections: ['W-new-18'] },
      { id: 'W-new-22',    x: 76.3, y: 70.5, connections: ['W-spot-8', 'W-new-24'] },
      { id: 'W-new-23',    x: 66.8, y: 75.6, connections: ['W-printer'] },
      { id: 'W-new-24',    x: 81.3, y: 62.5, connections: ['W-new-22'] },
    ], */
  },

  'manager-office': {
    id: 'manager-office',
    name: "Manager's Office",
    description: 'Where the manager briefs agents and reviews work. Connected to main Claude terminal.',
    background: {
      day: '/rooms/ceo-office.png',
      night: '/rooms/ceo-office.png',
    },
    width: 600,
    height: 450,
    furniture: [],
    connections: [
      { toRoom: 'main-office', position: { x: 50, y: 95 }, label: 'Main Office' },
    ],
    agentSpots: [
      { id: 'mgr-spot', type: 'desk', x: 50, y: 40, facing: 'down' },
      { id: 'visitor-1', type: 'standing', x: 35, y: 65, facing: 'up' },
      { id: 'visitor-2', type: 'standing', x: 65, y: 65, facing: 'up' },
    ],
    entryPoint: { x: 50, y: 90 },
  },

  'ceo-office': {
    id: 'ceo-office',
    name: 'CEO Office',
    description: 'Corner office with city views. Bloomberg terminal and whiskey shelf.',
    background: {
      day: '/rooms/ceo-office.png',
      night: '/rooms/ceo-office.png',
    },
    width: 600,
    height: 450,
    furniture: [
    ],
    connections: [
      { toRoom: 'main-office', position: { x: 50, y: 95 }, label: 'Main Office' },
    ],
    agentSpots: [
      { id: 'ceo-spot', type: 'desk', x: 50, y: 45, facing: 'down' },
    ],
    entryPoint: { x: 50, y: 90 },
  },

  'meeting-room': {
    id: 'meeting-room',
    name: 'Meeting Room',
    description: 'Glass-walled room for standups, planning, and heated architecture debates.',
    background: {
      day: '/rooms/meeting-room.png',
      night: '/rooms/meeting-room.png',
    },
    width: 600,
    height: 450,
    furniture: [
    ],
    connections: [
      { toRoom: 'main-office', position: { x: 95, y: 50 }, label: 'Main Office' },
    ],
    agentSpots: [
      { id: 'seat-1', type: 'meeting-seat', x: 30, y: 40, facing: 'right' },
      { id: 'seat-2', type: 'meeting-seat', x: 30, y: 55, facing: 'right' },
      { id: 'seat-3', type: 'meeting-seat', x: 70, y: 40, facing: 'left' },
      { id: 'seat-4', type: 'meeting-seat', x: 70, y: 55, facing: 'left' },
      { id: 'presenter', type: 'standing', x: 50, y: 25, facing: 'down' },
    ],
    entryPoint: { x: 90, y: 50 },
  },

  'kitchen': {
    id: 'kitchen',
    name: 'Kitchen',
    description: 'Espresso machine, kombucha on tap, and a fridge full of La Croix.',
    background: {
      day: '/rooms/kitchen-cafeteria.png',
      night: '/rooms/kitchen-cafeteria.png',
    },
    width: 600,
    height: 450,
    furniture: [
    ],
    connections: [
      { toRoom: 'main-office', position: { x: 5, y: 50 }, label: 'Main Office' },
      { toRoom: 'rooftop', position: { x: 50, y: 5 }, label: 'Rooftop' },
    ],
    agentSpots: [
      { id: 'coffee-spot', type: 'standing', x: 30, y: 35, facing: 'up' },
      { id: 'lunch-1', type: 'meeting-seat', x: 35, y: 65, facing: 'right' },
      { id: 'lunch-2', type: 'meeting-seat', x: 65, y: 65, facing: 'left' },
      { id: 'snack-spot', type: 'standing', x: 15, y: 35, facing: 'up' },
    ],
    entryPoint: { x: 10, y: 50 },
  },

  'server-room': {
    id: 'server-room',
    name: 'Server Room',
    description: 'Cold. Loud. Blinking lights. Where deployments happen.',
    background: {
      day: '/rooms/server-room.png',
      night: '/rooms/server-room.png',
    },
    width: 500,
    height: 400,
    furniture: [
    ],
    connections: [
      { toRoom: 'main-office', position: { x: 50, y: 95 }, label: 'Main Office' },
    ],
    agentSpots: [
      { id: 'server-spot-1', type: 'standing', x: 35, y: 60, facing: 'up' },
      { id: 'server-spot-2', type: 'standing', x: 65, y: 60, facing: 'up' },
    ],
    entryPoint: { x: 50, y: 90 },
    ambience: 'server-hum',
  },

  'lobby': {
    id: 'lobby',
    name: 'Lobby',
    description: 'Where new hires arrive. Swag wall. Pile of Amazon packages.',
    background: {
      day: '/rooms/lobby-reception.png',
      night: '/rooms/lobby-reception.png',
    },
    width: 600,
    height: 450,
    furniture: [
    ],
    connections: [
      { toRoom: 'main-office', position: { x: 50, y: 5 }, label: 'Main Office' },
      { toRoom: 'parking', position: { x: 50, y: 95 }, label: 'Parking' },
    ],
    agentSpots: [
      { id: 'reception-spot', type: 'desk', x: 50, y: 40, facing: 'down' },
      { id: 'waiting-1', type: 'lounge', x: 25, y: 70, facing: 'right' },
      { id: 'waiting-2', type: 'lounge', x: 35, y: 70, facing: 'right' },
    ],
    entryPoint: { x: 50, y: 90 },
  },

  'nap-room': {
    id: 'nap-room',
    name: 'Wellness Room',
    description: 'Sleep pods, meditation cushions, and a Himalayan salt lamp.',
    background: {
      day: '/rooms/nap-wellness-room.png',
      night: '/rooms/nap-wellness-room.png',
    },
    width: 500,
    height: 400,
    furniture: [
    ],
    connections: [
      { toRoom: 'main-office', position: { x: 50, y: 95 }, label: 'Main Office' },
    ],
    agentSpots: [
      { id: 'nap-1', type: 'lounge', x: 25, y: 40, facing: 'down' },
      { id: 'nap-2', type: 'lounge', x: 50, y: 40, facing: 'down' },
      { id: 'nap-3', type: 'lounge', x: 75, y: 40, facing: 'down' },
    ],
    entryPoint: { x: 50, y: 90 },
  },

  'rooftop': {
    id: 'rooftop',
    name: 'Rooftop Terrace',
    description: 'Friday drinks, BBQ, and pretending to have work-life balance.',
    background: {
      day: '/rooms/rooftop-terrace.png',
      night: '/rooms/rooftop-terrace.png',
    },
    width: 700,
    height: 500,
    furniture: [
    ],
    connections: [
      { toRoom: 'kitchen', position: { x: 50, y: 95 }, label: 'Kitchen' },
    ],
    agentSpots: [
      { id: 'roof-1', type: 'lounge', x: 25, y: 50, facing: 'down' },
      { id: 'roof-2', type: 'lounge', x: 65, y: 50, facing: 'down' },
      { id: 'roof-3', type: 'lounge', x: 40, y: 75, facing: 'right' },
    ],
    entryPoint: { x: 50, y: 90 },
  },

  'gym': {
    id: 'gym',
    name: 'Gym',
    description: 'A Peloton, some dumbbells, and a mirror for flexing your PRs.',
    background: {
      day: '/rooms/gym-fitness-room.png',
      night: '/rooms/gym-fitness-room.png',
    },
    width: 500,
    height: 400,
    furniture: [
    ],
    connections: [
      { toRoom: 'main-office', position: { x: 50, y: 95 }, label: 'Main Office' },
    ],
    agentSpots: [
      { id: 'gym-1', type: 'standing', x: 25, y: 45, facing: 'down' },
      { id: 'gym-2', type: 'standing', x: 75, y: 45, facing: 'down' },
    ],
    entryPoint: { x: 50, y: 90 },
  },

  'parking': {
    id: 'parking',
    name: 'Parking Garage',
    description: 'Teslas, e-scooters, and reserved spots nobody respects.',
    background: {
      day: '/rooms/parking-garage.png',
      night: '/rooms/parking-garage.png',
    },
    width: 700,
    height: 500,
    furniture: [
    ],
    connections: [
      { toRoom: 'lobby', position: { x: 50, y: 5 }, label: 'Lobby' },
    ],
    agentSpots: [],
    entryPoint: { x: 50, y: 10 },
  },
}

// ===== ROOM NAVIGATION =====
// Find path between rooms using BFS
export function findRoomPath(from: RoomId, to: RoomId): RoomId[] {
  if (from === to) return [from]

  const visited = new Set<RoomId>()
  const queue: { room: RoomId; path: RoomId[] }[] = [{ room: from, path: [from] }]
  visited.add(from)

  while (queue.length > 0) {
    const { room, path } = queue.shift()!
    const connections = ROOMS[room].connections

    for (const conn of connections) {
      if (conn.toRoom === to) return [...path, to]
      if (!visited.has(conn.toRoom)) {
        visited.add(conn.toRoom)
        queue.push({ room: conn.toRoom, path: [...path, conn.toRoom] })
      }
    }
  }

  return [from] // no path found, stay put
}

// Get all rooms connected to a given room
export function getConnectedRooms(roomId: RoomId): RoomId[] {
  return ROOMS[roomId].connections.map(c => c.toRoom)
}

// Get a free agent spot in a room
export function getFreeSpot(
  roomId: RoomId,
  occupiedSpotIds: Set<string>,
  type?: AgentSpot['type'],
): AgentSpot | null {
  const room = ROOMS[roomId]
  const spots = type
    ? room.agentSpots.filter(s => s.type === type)
    : room.agentSpots

  for (const spot of spots) {
    if (!occupiedSpotIds.has(spot.id)) return spot
  }
  return null
}
