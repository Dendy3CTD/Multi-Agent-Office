export type FloorDesignTheme = 'showroom' | 'studio' | 'industrial' | 'library' | 'atrium' | 'custom'
export type FloorPresetAsset = 'desk.modern' | 'chair.ergonomic' | 'partition.glass' | 'sofa.cozy' | 'table.coffee' | 'plant.potted' | 'lamp.standing' | 'bookshelf' | 'filing.cabinet' | 'monitor.single' | 'monitor.dual' | 'table.meeting' | 'chair.meeting' | 'rug.area' | 'armchair.cozy' | 'desk.lamp' | 'wall.decoration' | 'preview.workstation' | 'preview.office.group' | 'decor.wall.sconce' | 'pendant.led'
  | 'desk.reception' | 'desk.lab' | 'desk.cad' | 'desk.standing' | 'desk.focus' | 'equipment.oscilloscope' | 'equipment.test-bench' | 'equipment.3d-printer' | 'equipment.server-rack' | 'equipment.analytics-display' | 'equipment.graphics-tablet' | 'equipment.espresso-machine' | 'equipment.cafe-counter' | 'equipment.refrigerator' | 'equipment.security-console' | 'equipment.network-rack' | 'equipment.archive-shelf' | 'equipment.qa-device-wall' | 'equipment.whiteboard-display' | 'furniture.pool-table' | 'furniture.foosball' | 'furniture.acoustic-focus-pod' | 'furniture.whiteboard' | 'furniture.cafe-table' | 'furniture.banquette' | 'furniture.moodboard' | 'furniture.kiosk'

export interface FloorRect { x: number; z: number; width: number; depth: number }
export interface FloorZonePreset { id: string; kind: 'work' | 'meeting' | 'focus' | 'lounge' | 'service' | 'reception' | 'circulation'; bounds: FloorRect; label?: string; material?: string }
export interface FloorRoomPreset { id: string; kind: 'meeting' | 'leadership' | 'focus' | 'lounge' | 'service' | 'reception'; bounds: FloorRect; capacity?: number; privacy?: 'glass' | 'solid' | 'open'; material?: string; door?: { wall: 'north' | 'south' | 'east' | 'west'; offset?: number; width: number; kind?: 'door' | 'open' } }
export interface FloorBarrierPreset { id: string; kind: 'wall' | 'glass' | 'railing'; x: number; z: number; length: number; height: number; rotationY: number; material: string; doorWidth?: number }
export interface FloorWindowPreset { id: string; wall: 'north' | 'south' | 'east' | 'west'; offset: number; width: number; sill: number; height: number; frameMaterial: string }
export interface FloorEntrancePreset { id: string; wall: 'north' | 'south' | 'east' | 'west'; offset: number; width: number; kind: 'door' | 'elevator' | 'open' }
export interface FloorPlacementPreset { asset: FloorPresetAsset; id: string; x: number; z: number; y?: number; rotationY?: number; scale?: [number, number, number]; footprint?: FloorRect; employeeId?: string; deskId?: string; interaction?: { kind: 'screen' | 'door' | 'display' | 'equipment'; targetId?: string } }
export interface FloorWorkplacePreset { id: string; x: number; z: number; rotationY?: number; width?: number; depth?: number; employeeId?: string; deskId?: string; kind?: 'standard' | 'focus' | 'lab' | 'cad' | 'standing'; equipment?: readonly string[] }
export interface FloorLocalLightPreset { id: string; kind: 'point' | 'spot'; x: number; y: number; z: number; color: string; intensity: number; distance?: number; angle?: number; target?: [number, number, number] }

/** Data-only plan. Coordinates use metres, origin at the room's south-west floor corner, Y up. */
export interface FloorDesignPreset {
  schemaVersion: 1
  floorId: string
  presetId: string
  /** Stable department/use key for shared art direction and specialist asset selection. */
  specialization?: string
  /** Review-only local reference path; renderer never loads this as scene content. */
  referenceImage?: string
  theme: FloorDesignTheme
  bounds: { width: number; depth: number; height: number }
  zones: readonly FloorZonePreset[]
  rooms: readonly FloorRoomPreset[]
  barriers: readonly FloorBarrierPreset[]
  windows: readonly FloorWindowPreset[]
  entrances: readonly FloorEntrancePreset[]
  materials: Readonly<Record<string, string>>
  lighting: { exposure: number; ambient: string; key: string; fill: string; keyIntensity: number; fillIntensity: number; fixtures?: readonly FloorLocalLightPreset[] }
  furniture: readonly FloorPlacementPreset[]
  decor: readonly FloorPlacementPreset[]
  workplaces: readonly FloorWorkplacePreset[]
  aisles: readonly FloorRect[]
  camera: { position: [number, number, number]; target: [number, number, number]; zoom: number; minZoom: number; maxZoom: number }
}

export interface ResolvedFloorPreset { preset: FloorDesignPreset; status: 'authored' | 'fallback'; missingFloorPreset: boolean }
