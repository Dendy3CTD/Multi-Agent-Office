import type { FloorDesignPreset, FloorPlacementPreset, FloorWorkplacePreset } from '../../floor-presets/types'

export const FLOOR_BOUNDS = { width: 22, depth: 14, height: 5.8 } as const

export function northWindows(prefix: string): FloorDesignPreset['windows'] {
  return [
    { id: `${prefix}-window-west`, wall: 'north', offset: 1.1, width: 6.2, sill: 1.05, height: 3.2, frameMaterial: 'graphite-metal' },
    { id: `${prefix}-window-center`, wall: 'north', offset: 7.9, width: 6.2, sill: 1.05, height: 3.2, frameMaterial: 'graphite-metal' },
    { id: `${prefix}-window-east`, wall: 'north', offset: 14.7, width: 6.2, sill: 1.05, height: 3.2, frameMaterial: 'graphite-metal' },
  ]
}

export const elevatorEntrance: FloorDesignPreset['entrances'][number] = {
  id: 'south-east-elevator', wall: 'south', offset: 19.25, width: 1.35, kind: 'elevator',
}

export const loftMaterials: FloorDesignPreset['materials'] = {
  floor: 'oak-floor', wall: 'warm-plaster', featureWall: 'terracotta-brick',
  glazing: 'glass-tint', trim: 'graphite-metal', desk: 'desk-oak', textile: 'forest-upholstery',
}

export const baseLighting: FloorDesignPreset['lighting'] = {
  exposure: 1.08,
  ambient: '#dbe5eb',
  key: '#fff1dc',
  fill: '#d5e3ed',
  keyIntensity: 2.25,
  fillIntensity: .78,
}

export const referenceCamera: FloorDesignPreset['camera'] = {
  position: [19, 19, -23], target: [0, 1.25, 0], zoom: 1, minZoom: .72, maxZoom: 1.8,
}

export type WorkplaceSeed = { deskId: string; employeeId?: string; x: number; z: number; kind?: FloorWorkplacePreset['kind']; equipment?: readonly string[] }

export function makeWorkplace(seed: WorkplaceSeed): FloorWorkplacePreset {
  return {
    id: seed.deskId,
    deskId: seed.deskId,
    ...(seed.employeeId ? { employeeId: seed.employeeId } : {}),
    x: seed.x,
    z: seed.z,
    width: 1.5,
    depth: .8,
    rotationY: 0,
    kind: seed.kind ?? 'standard',
    ...(seed.equipment?.length ? { equipment: seed.equipment } : {}),
  }
}

export function dualMonitors(prefix: string, workplaces: readonly FloorWorkplacePreset[]): FloorPlacementPreset[] {
  return workplaces.filter(place => place.employeeId).map(place => ({
    id: `${prefix}-monitor-${place.deskId}`,
    asset: 'monitor.dual',
    x: place.x,
    y: 1.34,
    z: place.z - .18,
    deskId: place.deskId,
  }))
}

export function loungeSeeds(prefix: string, x: number, z: number): FloorPlacementPreset[] {
  return [
    { id: `${prefix}-sofa`, asset: 'sofa.cozy', x, z, footprint: { x: x - 1.125, z: z - .405, width: 2.25, depth: .81 } },
    { id: `${prefix}-coffee-table`, asset: 'table.coffee', x: x + .15, z: z + 1.05, footprint: { x: x - .43, z: z + .47, width: 1.16, depth: 1.16 } },
    { id: `${prefix}-armchair`, asset: 'armchair.cozy', x: x + 1.75, z: z + 1.05, rotationY: -.35, footprint: { x: x + 1.29, z: z + .675, width: .92, depth: .75 } },
    { id: `${prefix}-plant`, asset: 'plant.potted', x: x - 1.45, z: z + .85, footprint: { x: x - 1.8, z: z + .5, width: .7, depth: .7 } },
  ]
}

export const deskColumns = [4.7, 7.5, 10.3, 13.1, 16] as const

export function departmentWorkplaces(
  floorId: string,
  departmentId: string,
  employees: readonly { employeeId: string; departmentId: string; floorId: string; deskId: string }[],
  desks: readonly { floorId: string; deskId: string }[],
  options: { kind?: FloorWorkplacePreset['kind']; equipment?: readonly string[] } = {},
): FloorWorkplacePreset[] {
  const roster = employees.filter(employee => employee.floorId === floorId && employee.departmentId === departmentId)
  const floorDesks = desks.filter(desk => desk.floorId === floorId)
  return floorDesks.map((desk, index) => {
    const employee = roster.find(candidate => candidate.deskId === desk.deskId)
    const row = Math.floor(index / deskColumns.length)
    const column = index % deskColumns.length
    return makeWorkplace({
      deskId: desk.deskId,
      ...(employee ? { employeeId: employee.employeeId } : {}),
      x: deskColumns[column]!,
      z: row === 0 ? 4.5 : 8.8,
      kind: options.kind,
      equipment: options.equipment,
    })
  })
}

export function commonZones(prefix: string): FloorDesignPreset['zones'] {
  return [
    { id: `${prefix}-team-bay`, kind: 'work', bounds: { x: 3.7, z: 4.2, width: 14.1, depth: 6.3 }, label: 'Specialist workstations' },
    { id: `${prefix}-central-route`, kind: 'circulation', bounds: { x: 3.5, z: 6.45, width: 15.3, depth: .75 }, label: 'Clear cross-floor route' },
    { id: `${prefix}-lift-route`, kind: 'circulation', bounds: { x: 19.1, z: .1, width: 1.55, depth: 13.8 }, label: 'Elevator access' },
  ]
}

export function commonAisles(): FloorDesignPreset['aisles'] {
  return [
    { x: 3.5, z: 6.45, width: 15.3, depth: .75 },
    { x: 19.1, z: .1, width: 1.55, depth: 13.8 },
  ]
}
