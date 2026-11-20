import type { FloorDesignPreset, FloorPlacementPreset, FloorPresetAsset } from './types'
import type { FloorDesignPreset as GroupPreset } from './group-01-03/schema'

const localToSharedRoomKind = {
  meeting: 'meeting',
  leadership: 'leadership',
  rest: 'lounge',
  service: 'service',
  reception: 'reception',
  kitchen: 'service',
  archive: 'service',
} as const

const localToSharedZoneKind = {
  work: 'work',
  leadership: 'reception',
  meeting: 'meeting',
  support: 'service',
  quiet: 'focus',
  circulation: 'circulation',
  lounge: 'lounge',
  'test-lab': 'work',
} as const

const roomMaterial = (privacy: string | undefined) => privacy === 'glass' ? 'bronze-glass' : 'warm-plaster'

function pointPlacement(item: GroupPreset['furniture'][number]): FloorPlacementPreset {
  return {
    id: item.id,
    asset: item.assetId as FloorPresetAsset,
    x: item.position.x,
    y: item.position.y,
    z: item.position.z,
    rotationY: item.rotationY,
    scale: item.scale ? [...item.scale] as [number, number, number] : undefined,
    footprint: item.footprint,
    deskId: item.hostDeskId,
  }
}

function sharedTheme(preset: GroupPreset): FloorDesignPreset['theme'] {
  if (preset.floor.number === 1) return 'showroom'
  if (preset.floor.number === 2) return 'studio'
  return 'industrial'
}

/**
 * Adapts the independent first-group layout format to the shared scene contract.
 * Plan points remain in the authored 22×14 m south-west coordinate system;
 * the shared renderer applies (x - 11, z - 7) when placing them in Three.js.
 */
export function adaptGroup0103Preset(source: GroupPreset): FloorDesignPreset {
  const { layout } = source
  const floorWidth = layout.size.width
  const floorDepth = layout.size.depth
  const wallById = new Map(layout.walls.map(wall => [wall.id, wall]))
  const windows = layout.windows.map(window => {
    const wall = wallById.get(window.wallId)
    const side = wall?.side === 'north' || wall?.side === 'south' || wall?.side === 'east' || wall?.side === 'west' ? wall.side : 'north'
    const horizontal = side === 'north' || side === 'south'
    const sill = 1.05
    const height = Math.min(3.3, layout.size.height ?? 5.8 - sill)
    return {
      id: window.id,
      wall: side,
      offset: horizontal ? window.bounds.x : window.bounds.z,
      width: horizontal ? window.bounds.width : window.bounds.depth,
      sill,
      height,
      frameMaterial: 'graphite-metal',
    }
  })
  const entrances = layout.doors.map(door => {
    const wall = wallById.get(door.wallId)
    const side = wall?.side === 'north' || wall?.side === 'south' || wall?.side === 'east' || wall?.side === 'west' ? wall.side : 'south'
    const horizontal = side === 'north' || side === 'south'
    return {
      id: door.id,
      wall: side,
      offset: horizontal ? door.bounds.x : door.bounds.z,
      width: horizontal ? door.bounds.width : door.bounds.depth,
      kind: 'elevator' as const,
    }
  })
  const barriers = layout.partitions.map(partition => {
    const { x, z, width, depth } = partition.bounds
    const vertical = width <= depth
    return {
      id: partition.id,
      kind: 'wall' as const,
      x: vertical ? x + width / 2 : x,
      z: vertical ? z : z + depth / 2,
      length: vertical ? depth : width,
      height: Math.min(partition.height, 3.05),
      rotationY: vertical ? Math.PI / 2 : 0,
      material: source.palette.walnut ?? source.palette.graphite ?? 'graphite-metal',
    }
  })
  const plantFurniture: FloorPlacementPreset[] = layout.plants.map(plant => ({
    id: plant.id,
    asset: 'plant.potted',
    x: plant.position.x,
    y: plant.position.y,
    z: plant.position.z,
    footprint: plant.bounds,
  }))
  const furniture = source.furniture
    .filter(item => item.mount === 'floor')
    .map(pointPlacement)
  const decor = source.furniture
    .filter(item => item.mount !== 'floor')
    .map(pointPlacement)

  return {
    schemaVersion: 1,
    floorId: source.floor.worldFloorId,
    presetId: source.id,
    theme: sharedTheme(source),
    bounds: { width: floorWidth, depth: floorDepth, height: layout.size.height ?? 5.8 },
    zones: source.zones.map(zone => ({ id: zone.id, kind: localToSharedZoneKind[zone.kind], bounds: zone.bounds, label: zone.label, material: zone.finish })),
    rooms: layout.rooms.map(room => ({
      id: room.id,
      kind: localToSharedRoomKind[room.kind],
      bounds: room.bounds,
      privacy: room.privacy,
      material: roomMaterial(room.privacy),
    })),
    barriers,
    windows,
    entrances,
    materials: {
      floor: source.palette.oak ?? source.palette.ash ?? 'oak-floor',
      wall: source.palette.plaster ?? 'warm-plaster',
      featureWall: source.palette.walnut ?? source.palette.graphite ?? 'walnut-brick',
      glazing: source.palette.teal ?? source.palette.blue ?? 'sage-glass',
      trim: source.palette.bronze ?? source.palette.graphite ?? 'graphite-metal',
      desk: source.palette.walnut ?? source.palette.ash ?? 'desk-oak',
      textile: source.palette.textile ?? source.palette.sage ?? source.palette.felt ?? 'sage-upholstery',
    },
    lighting: {
      exposure: 1.08,
      ambient: '#e4edf4',
      key: source.lighting.find(light => light.kind === 'linear')?.color ?? '#fff6e8',
      fill: source.lighting.find(light => light.kind === 'task')?.color ?? '#d8e8f2',
      keyIntensity: 2.45,
      fillIntensity: 0.85,
    },
    furniture: [...furniture, ...plantFurniture],
    decor,
    workplaces: layout.desks.map(desk => ({
      id: desk.deskId,
      x: desk.position.x,
      z: desk.position.z,
      rotationY: desk.orientation,
      width: desk.bounds.width,
      depth: desk.bounds.depth,
    })),
    aisles: layout.aisles.map(aisle => aisle.bounds),
    camera: {
      position: [layout.camera.position.x - floorWidth / 2, Math.max(layout.camera.position.y + 10, 18), layout.camera.position.z - floorDepth / 2],
      target: [layout.camera.target.x - floorWidth / 2, 1.4, layout.camera.target.z - floorDepth / 2],
      zoom: 1,
      minZoom: 0.72,
      maxZoom: 1.8,
    },
  }
}
