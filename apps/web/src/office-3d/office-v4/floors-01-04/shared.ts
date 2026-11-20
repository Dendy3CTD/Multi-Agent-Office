import type { FloorDesignPreset, FloorPlacementPreset, FloorWorkplacePreset } from '../../floor-presets/types'

export const FLOOR_BOUNDS = { width: 22, depth: 14, height: 5.8 } as const

export const NORTH_WINDOWS = [
  { id: 'north-window-west', wall: 'north', offset: 1.1, width: 5.7, sill: 1.05, height: 3.15, frameMaterial: 'graphite-metal' },
  { id: 'north-window-center', wall: 'north', offset: 7.2, width: 5.7, sill: 1.05, height: 3.15, frameMaterial: 'graphite-metal' },
  { id: 'north-window-east', wall: 'north', offset: 13.3, width: 7.5, sill: 1.05, height: 3.15, frameMaterial: 'graphite-metal' },
] as const

export const DEPARTMENT_ELEVATOR = { id: 'south-east-elevator', wall: 'south', offset: 19.2, width: 1.4, kind: 'elevator' } as const

export const LOFT_MATERIALS = {
  floor: 'oak-floor',
  wall: 'warm-plaster',
  featureWall: 'terracotta-brick',
  glazing: 'glass-tint',
  trim: 'graphite-metal',
  desk: 'desk-oak',
  textile: 'sage-fabric',
} as const

export function workplace(
  worldFloorId: string,
  number: number,
  employeeId: string | undefined,
  x: number,
  z: number,
  kind: NonNullable<FloorWorkplacePreset['kind']> = 'standard',
  equipment: readonly string[] = [],
): FloorWorkplacePreset {
  const deskId = `desk-${worldFloorId}-${String(number).padStart(2, '0')}`
  return { id: deskId, deskId, employeeId, x, z, width: 1.5, depth: 1.25, kind, equipment }
}

export function prop(
  id: string,
  asset: FloorPlacementPreset['asset'],
  x: number,
  z: number,
  options: Partial<Pick<FloorPlacementPreset, 'y' | 'rotationY' | 'scale' | 'footprint' | 'employeeId' | 'deskId' | 'interaction'>> = {},
): FloorPlacementPreset {
  return { id, asset, ...options, x, z }
}

export function monitorPlacements(
  worldFloorId: string,
  positions: readonly { number: number; x: number; z: number; asset?: 'monitor.single' | 'monitor.dual' }[],
) {
  return positions.map(({ number, x, z, asset = 'monitor.single' }) => {
    const deskId = `desk-${worldFloorId}-${String(number).padStart(2, '0')}`
    return prop(`${worldFloorId}-monitor-${String(number).padStart(2, '0')}`, asset, x, z + 0.26, { y: 1.08, deskId })
  })
}

export function localLights(colors: { window: string; specialist: string; collaboration: string }) {
  return [
    { id: 'window-task-wash', kind: 'spot' as const, x: 5.5, y: 4.9, z: 12.8, color: colors.window, intensity: 17, distance: 9, angle: 0.6, target: [5.5, 0, 8.5] as [number, number, number] },
    { id: 'specialist-bay-wash', kind: 'spot' as const, x: 14.5, y: 4.7, z: 9.0, color: colors.specialist, intensity: 15, distance: 8, angle: 0.62, target: [14.5, 0, 7.0] as [number, number, number] },
    { id: 'collaboration-pendant', kind: 'point' as const, x: 10.5, y: 3.7, z: 2.7, color: colors.collaboration, intensity: 11, distance: 7 },
  ]
}

export const DEPARTMENT_AISLES = [
  { x: 0.7, z: 4.6, width: 19.9, depth: 1.0 },
  { x: 0.7, z: 9.2, width: 19.9, depth: 1.0 },
  { x: 0.7, z: 4.6, width: 1.0, depth: 5.6 },
  { x: 19.2, z: 0, width: 1.4, depth: 12.8 },
] as const

export const CAMERA: FloorDesignPreset['camera'] = { position: [19, 18, -23], target: [0, 1.45, 0], zoom: 1, minZoom: 0.72, maxZoom: 1.8 }
