import { FLOOR_METADATA, buildDesks, createDemoEmployees } from '../../world'
import type { WorldEmployee } from '../../world'
import { SHOWROOM_FLOOR_ID, showroomLayout } from '../scene-data'
import { validateFloorDesignPreset } from './validate'
import type { FloorDesignPreset, FloorWorkplacePreset, ResolvedFloorPreset } from './types'
import { officeV4ToWorldFloorId } from '../office-v4/floor-id-adapter'
import { FLOOR_01_TO_04_PRESETS } from '../office-v4/floors-01-04'
import { createOfficeV4Presets as createFloors05To08 } from '../office-v4/floors-05-08'
import { FLOOR_09_TO_12_PRESETS } from '../office-v4/floors-09-12'
import { FLOOR_13_15_PRESETS } from '../office-v4/floors-13-15'

const showroom = showroomLayout()
const showroomWorkplaces: FloorWorkplacePreset[] = showroom.desks.map((desk, index) => ({ id: desk.deskId, x: desk.position.x, z: desk.position.z, rotationY: desk.orientation, width: 1.5, depth: 1.3 }))

/** Authored base preset mirrors floor 02's current showroom-v2 scene composition. */
export const FLOOR_02_PRESET: FloorDesignPreset = {
  schemaVersion: 1, floorId: SHOWROOM_FLOOR_ID, presetId: 'showroom-v2', theme: 'showroom',
  bounds: { width: 22, depth: 14, height: 5.8 },
  zones: [
    { id: 'work-bay', kind: 'work', bounds: { x: 4.3, z: 1.8, width: 10.6, depth: 10.8 } },
    { id: 'meeting-suite', kind: 'meeting', bounds: { x: 15.2, z: 4.5, width: 5.6, depth: 5.9 } },
    { id: 'lounge', kind: 'lounge', bounds: { x: .2, z: .15, width: 4.2, depth: 5.1 } },
    { id: 'main-aisle', kind: 'circulation', bounds: { x: .5, z: 7.2, width: 20.5, depth: .7 } },
  ],
  rooms: [
    { id: 'leadership-office', kind: 'leadership', bounds: { x: 15.2, z: 8, width: 5.6, depth: 2.4 } },
    { id: 'glass-meeting-room', kind: 'meeting', bounds: { x: 15.2, z: 4.5, width: 5.6, depth: 3.2 }, capacity: 8 },
    { id: 'rest-area', kind: 'lounge', bounds: { x: .2, z: .15, width: 4.2, depth: 5.1 } },
  ],
  barriers: [],
  windows: [{ id: 'north-daylight', wall: 'north', offset: 2.8, width: 14.8, sill: 1.1, height: 3.3, frameMaterial: 'graphite-metal' }],
  entrances: [{ id: 'south-east-elevator', wall: 'south', offset: 19.2, width: 1.2, kind: 'elevator' }, { id: 'west-entry', wall: 'west', offset: 2.3, width: 1.4, kind: 'door' }],
  materials: { floor: 'oak-floor', wall: 'warm-plaster', featureWall: 'terracotta-brick', glazing: 'glass-tint', trim: 'graphite-metal', desk: 'desk-oak', textile: 'forest-upholstery' },
  lighting: { exposure: 1.08, ambient: '#e4edf4', key: '#fff6e8', fill: '#d8e8f2', keyIntensity: 2.45, fillIntensity: .85 },
  furniture: [],
  decor: [],
  workplaces: showroomWorkplaces, aisles: [{ x: .5, z: 7.2, width: 20.5, depth: .7 }],
  camera: { position: [19, 20, -23], target: [0, 1.4, 0], zoom: 1, minZoom: .72, maxZoom: 1.8 },
}

/** All authored Office V4 layouts, registered against their explicit world route IDs. */
export const OFFICE_V4_PRESETS: readonly FloorDesignPreset[] = [
  ...FLOOR_01_TO_04_PRESETS,
  ...createFloors05To08(createDemoEmployees(), buildDesks(createDemoEmployees())),
  ...FLOOR_09_TO_12_PRESETS,
  ...FLOOR_13_15_PRESETS,
]
const authoredPresets = new Map<string, FloorDesignPreset>()

for (const preset of OFFICE_V4_PRESETS) registerFloorDesignPreset(preset)

export function registerFloorDesignPreset(preset: FloorDesignPreset): void {
  // Office V4 authored presets declare specialization and use their logical
  // floor-00…floor-14 IDs. Existing v1 presets use the public world route IDs.
  const worldFloorId = preset.specialization || preset.referenceImage ? officeV4ToWorldFloorId(preset.floorId) : preset.floorId
  const issues = validateFloorDesignPreset(preset, createDemoEmployees().filter(employee => employee.floorId === worldFloorId).length)
  if (issues.length) throw new TypeError(`invalid_floor_preset:${issues.map(item => item.code).join(',')}`)
  authoredPresets.set(worldFloorId, preset)
}

export function resolveFloorDesignPreset(floorId: string, directoryEmployees?: readonly WorldEmployee[]): ResolvedFloorPreset {
  const worldFloorId = floorId
  // Group 05–08 intentionally builds seat bindings from the active Directory
  // snapshot. Keep the authors' geometry and resolve only the employee/desk
  // associations from that snapshot; no index-order or ID rewriting is used.
  let authored = authoredPresets.get(worldFloorId)
  const directory = directoryEmployees?.length ? directoryEmployees : undefined
  if (directory && ['floor-5', 'floor-6', 'floor-7', 'floor-8'].includes(worldFloorId)) {
    const dynamic = createFloors05To08(directory, buildDesks(directory)).find(candidate => officeV4ToWorldFloorId(candidate.floorId) === worldFloorId)
    if (dynamic) authored = dynamic
  }
  if (authored) return { preset: authored, status: 'authored', missingFloorPreset: false }
  const floor = FLOOR_METADATA.find(item => item.id === worldFloorId)
  const demoEmployees = createDemoEmployees()
  const count = demoEmployees.filter(employee => employee.floorId === worldFloorId).length
  const registeredDeskIds = buildDesks(demoEmployees).filter(desk => desk.floorId === worldFloorId).map(desk => desk.deskId)
  const places = FLOOR_02_PRESET.workplaces.slice(0, floor?.seatCount ?? Math.max(count, 1)).map((place, index) => ({ ...place, id: registeredDeskIds[index] ?? `fallback-${worldFloorId}-desk-${index + 1}` }))
  const preset = { ...FLOOR_02_PRESET, floorId: worldFloorId, presetId: `fallback:${FLOOR_02_PRESET.presetId}`, workplaces: places }
  validateFloorDesignPreset(preset, count)
  return { preset, status: 'fallback', missingFloorPreset: true }
}

export type { FloorDesignPreset, ResolvedFloorPreset } from './types'
export type { FloorPresetIssue } from './validate'
export { validateFloorDesignPreset } from './validate'
export { OFFICE_V4_FLOOR_REFERENCES, officeV4ToWorldFloorId, worldToOfficeV4FloorId, officeV4ReferenceForWorldFloor } from '../office-v4/floor-id-adapter'
