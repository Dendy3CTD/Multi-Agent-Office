import type { FloorDesignPreset, FloorRect } from './types'
import { PROCEDURAL_OFFICE_ASSET_IDS } from '../../office-art/procedural-asset-ids'

export interface FloorPresetIssue { code: string; path: string; message: string }
const inside = (rect: FloorRect, width: number, depth: number) => rect.x >= 0 && rect.z >= 0 && rect.x + rect.width <= width && rect.z + rect.depth <= depth
const overlap = (a: FloorRect, b: FloorRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.z < b.z + b.depth && a.z + a.depth > b.z
const ASSET_FOOTPRINT: Record<string, [number, number]> = {
  'desk.modern': [1.52, .74], 'chair.ergonomic': [.63, .68], 'partition.glass': [2.48, .13],
  'sofa.cozy': [2.25, .81], 'table.coffee': [1.16, 1.16], 'plant.potted': [.91, .78],
  'lamp.standing': [.56, .56], bookshelf: [1.31, .35], 'filing.cabinet': [.75, .70],
  'monitor.single': [.64, .22], 'monitor.dual': [1.28, .22], keyboard: [.65, .2],
  'table.meeting': [2.8, 1.2], 'chair.meeting': [.48, .59], 'rug.area': [2.8, 1.92],
  'armchair.cozy': [.92, .75], 'desk.lamp': [.24, .32], 'wall.decoration': [.9, .12],
  'desk.reception': [3.1, .98], 'desk.lab': [1.8, .82], 'desk.cad': [1.65, .82], 'desk.standing': [1.65, .82], 'desk.focus': [1.65, .82],
  'equipment.oscilloscope': [.52, .38], 'equipment.test-bench': [1.85, .82], 'equipment.3d-printer': [.9, .78],
  'equipment.server-rack': [.82, .8], 'equipment.network-rack': [.82, .8], 'equipment.analytics-display': [2.8, .18],
  'equipment.security-console': [3.4, .48], 'equipment.whiteboard-display': [2.8, .48], 'equipment.graphics-tablet': [.62, .42],
  'equipment.espresso-machine': [.92, .6], 'equipment.cafe-counter': [3.22, .96], 'equipment.refrigerator': [.92, .82], 'equipment.archive-shelf': [1.52, .43],
  'equipment.qa-device-wall': [2.65, .72], 'furniture.pool-table': [2.25, 1.28], 'furniture.foosball': [1.35, .78],
  'furniture.acoustic-focus-pod': [1.55, 1.35], 'furniture.whiteboard': [1.55, .12], 'furniture.moodboard': [1.55, .12],
  'furniture.cafe-table': [1.12, .78], 'furniture.banquette': [2.3, .76], 'furniture.kiosk': [.72, .48],
}

export function validateFloorDesignPreset(preset: FloorDesignPreset, employeeCount = 0): FloorPresetIssue[] {
  const issues: FloorPresetIssue[] = []
  const issue = (code: string, path: string, message: string) => issues.push({ code, path, message })
  const { width, depth, height } = preset.bounds
  const knownAssets = new Set([...Object.keys(ASSET_FOOTPRINT), ...PROCEDURAL_OFFICE_ASSET_IDS, 'preview.workstation', 'preview.office.group', 'decor.wall.sconce', 'pendant.led'])
  if (![width, depth, height].every(value => Number.isFinite(value) && value > 0)) issue('invalid_bounds', 'bounds', 'Room dimensions must be positive finite metres.')
  if (!preset.floorId.trim() || !preset.presetId.trim()) issue('invalid_identity', 'presetId', 'Floor and preset identifiers must be non-empty.')
  if (preset.lighting.keyIntensity < 0 || preset.lighting.fillIntensity < 0 || preset.lighting.exposure <= 0 || ![preset.lighting.keyIntensity, preset.lighting.fillIntensity, preset.lighting.exposure].every(Number.isFinite)) issue('invalid_lighting', 'lighting', 'Exposure must be positive and light intensities must be finite and non-negative.')
  if (preset.camera.minZoom <= 0 || preset.camera.maxZoom < preset.camera.minZoom || preset.camera.zoom < preset.camera.minZoom || preset.camera.zoom > preset.camera.maxZoom || [...preset.camera.position, ...preset.camera.target].some(value => !Number.isFinite(value))) issue('invalid_camera', 'camera', 'Camera vectors and zoom range must be finite and valid.')
  if (preset.workplaces.length < employeeCount) issue('capacity_exceeded', 'workplaces', `Preset has ${preset.workplaces.length} desks for ${employeeCount} employees.`)
  if (preset.specialization !== undefined && !preset.specialization.trim()) issue('invalid_specialization', 'specialization', 'Specialization must be a non-empty key when provided.')
  if (preset.referenceImage !== undefined && (!preset.referenceImage.startsWith('/design-references/office-v4/') || preset.referenceImage.includes('..'))) issue('invalid_reference', 'referenceImage', 'Reference image is review metadata and must point inside the local Office V4 reference folder.')
  if ((preset.lighting.fixtures?.length ?? 0) > 8) issue('too_many_local_lights', 'lighting.fixtures', 'Use at most eight local fixtures per floor; global lighting remains shared.')
  for (const [index, fixture] of (preset.lighting.fixtures ?? []).entries()) {
    if (!fixture.id.trim() || ![fixture.x, fixture.y, fixture.z, fixture.intensity].every(Number.isFinite) || fixture.y < 0 || fixture.y > height || fixture.intensity < 0 || (fixture.distance !== undefined && (!Number.isFinite(fixture.distance) || fixture.distance <= 0)) || (fixture.angle !== undefined && (!Number.isFinite(fixture.angle) || fixture.angle <= 0 || fixture.angle > Math.PI / 2)) || (fixture.target && fixture.target.some(value => !Number.isFinite(value)))) issue('invalid_light_fixture', `lighting.fixtures[${index}]`, 'Light fixture coordinates and options must be finite and within the floor volume.')
  }
  const ids = new Set<string>()
  for (const [group, entries] of [['workplaces', preset.workplaces], ['furniture', preset.furniture], ['decor', preset.decor], ['zones', preset.zones], ['rooms', preset.rooms], ['barriers', preset.barriers], ['windows', preset.windows], ['entrances', preset.entrances]] as const) {
    for (const [index, entry] of entries.entries()) {
      if (ids.has(entry.id)) issue('duplicate_id', `${group}[${index}].id`, `Duplicate object id ${entry.id}.`)
      ids.add(entry.id)
    }
  }
  // Workplace coordinates are the desk centre/front edge; reserve a real desk
  // footprint plus its chair clearance extending into the room (+Z).
  const workplaceRects = preset.workplaces.map((seat, index) => ({ seat, index, rect: { x: seat.x - (seat.width ?? 1.5) / 2, z: seat.z, width: seat.width ?? 1.5, depth: (seat.depth ?? .8) + .18 + .7 } }))
  for (const item of workplaceRects) if (![item.seat.x, item.seat.z, item.seat.rotationY ?? 0, item.rect.width, item.rect.depth].every(Number.isFinite) || item.rect.width <= 0 || item.rect.depth <= 0) issue('invalid_workplace', `workplaces[${item.index}]`, 'Workplace position, rotation and footprint must be finite and positive.')
  for (const item of workplaceRects) if (!inside(item.rect, width, depth)) issue('workplace_out_of_bounds', `workplaces[${item.index}]`, 'Workplace and chair clearance must fit inside room bounds.')
  for (let i = 0; i < workplaceRects.length; i++) for (let j = i + 1; j < workplaceRects.length; j++) {
    if (overlap(workplaceRects[i]!.rect, workplaceRects[j]!.rect)) issue('workplace_overlap', `workplaces[${i}]`, `Workplace ${workplaceRects[i]!.seat.id} overlaps ${workplaceRects[j]!.seat.id}.`)
  }
  for (const [group, entries] of [['zones', preset.zones], ['rooms', preset.rooms], ['aisles', preset.aisles]] as const) {
    for (const [index, rect] of entries.entries()) {
      const bounds = 'bounds' in rect ? rect.bounds : rect
      if (bounds.width <= 0 || bounds.depth <= 0 || !inside(bounds, width, depth)) issue('bounds_overflow', `${group}[${index}]`, 'Rectangle dimensions must be positive and fit inside room bounds.')
    }
  }
  for (let i = 0; i < preset.rooms.length; i++) for (let j = i + 1; j < preset.rooms.length; j++) if (overlap(preset.rooms[i]!.bounds, preset.rooms[j]!.bounds)) issue('room_overlap', `rooms[${j}]`, `Room ${preset.rooms[j]!.id} overlaps ${preset.rooms[i]!.id}.`)
  for (const [index, room] of preset.rooms.entries()) if (room.door) {
    const span = room.door.wall === 'north' || room.door.wall === 'south' ? room.bounds.width : room.bounds.depth
    const offset = room.door.offset ?? (span - room.door.width) / 2
    if (!Number.isFinite(room.door.width) || room.door.width < .75 || offset < 0 || offset + room.door.width > span) issue('invalid_room_door', `rooms[${index}].door`, 'Room door opening must be at least 0.75 m and fit along its selected wall.')
  }
  const linkedDeskIds = new Set<string>()
  const linkedEmployeeIds = new Set<string>()
  for (const [index, workplace] of preset.workplaces.entries()) {
    const deskId = workplace.deskId ?? workplace.id
    if (linkedDeskIds.has(deskId)) issue('duplicate_workplace_desk', `workplaces[${index}].deskId`, `Desk ID ${deskId} is assigned more than once.`)
    linkedDeskIds.add(deskId)
    if (workplace.employeeId) {
      if (linkedEmployeeIds.has(workplace.employeeId)) issue('duplicate_workplace_employee', `workplaces[${index}].employeeId`, `Employee ${workplace.employeeId} is assigned more than once.`)
      linkedEmployeeIds.add(workplace.employeeId)
      if (!workplace.deskId) issue('workplace_employee_without_desk', `workplaces[${index}].deskId`, 'An explicit employee binding must include its directory deskId.')
    }
    for (const [equipmentIndex, equipment] of (workplace.equipment ?? []).entries()) if (!knownAssets.has(equipment)) issue('unsupported_workplace_equipment', `workplaces[${index}].equipment[${equipmentIndex}]`, `Equipment asset ${equipment} is not registered in the shared art library.`)
  }
  for (const [index, barrier] of preset.barriers.entries()) {
    const endX = barrier.x + Math.cos(barrier.rotationY) * barrier.length
    const endZ = barrier.z + Math.sin(barrier.rotationY) * barrier.length
    const thicknessX = Math.abs(Math.sin(barrier.rotationY)) * .14
    const thicknessZ = Math.abs(Math.cos(barrier.rotationY)) * .14
    const bounds = { x: Math.min(barrier.x, endX) - thicknessX / 2, z: Math.min(barrier.z, endZ) - thicknessZ / 2, width: Math.abs(endX - barrier.x) + thicknessX, depth: Math.abs(endZ - barrier.z) + thicknessZ }
    if (barrier.length <= 0 || barrier.height <= 0 || barrier.height > height || (barrier.kind === 'railing' && barrier.height < .7) || !inside(bounds, width, depth) || (barrier.doorWidth !== undefined && (barrier.doorWidth <= 0 || barrier.doorWidth >= barrier.length * .58))) issue('barrier_out_of_bounds', `barriers[${index}]`, 'Barrier dimensions, centered doorway and extents must fit inside room bounds.')
    for (const seat of workplaceRects) if (overlap(bounds, seat.rect)) issue('barrier_workplace_overlap', `barriers[${index}]`, `Barrier ${barrier.id} intersects workplace ${seat.seat.id}.`)
  }
  const wallLength = (wall: 'north' | 'south' | 'east' | 'west') => wall === 'north' || wall === 'south' ? width : depth
  const openings = [...preset.windows.map((opening, index) => ({ ...opening, kind: 'window' as const, index })), ...preset.entrances.map((opening, index) => ({ ...opening, kind: 'entrance' as const, index }))]
  for (const [index, window] of preset.windows.entries()) {
    if (window.width <= 0 || window.offset < 0 || window.offset + window.width > wallLength(window.wall) || window.height <= 0 || window.sill < 0 || window.sill + window.height > height) issue('invalid_window', `windows[${index}]`, 'Window offset, width, sill and height must fit the selected wall.')
  }
  for (const [index, entrance] of preset.entrances.entries()) if (entrance.width < .75 || entrance.offset < 0 || entrance.offset + entrance.width > wallLength(entrance.wall)) issue('invalid_entrance', `entrances[${index}]`, 'Entrance must leave at least a 0.75 m clear opening inside the selected wall.')
  for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) {
    const a = openings[i]!, b = openings[j]!
    if (a.wall === b.wall && a.offset < b.offset + b.width && a.offset + a.width > b.offset) issue('wall_opening_overlap', `${a.kind === 'window' ? 'windows' : 'entrances'}[${a.index}]`, 'Windows and entrances on a wall must not overlap.')
  }
  for (const [index, aisle] of preset.aisles.entries()) if (workplaceRects.some(workplace => overlap(aisle, workplace.rect))) issue('aisle_blocked', `aisles[${index}]`, 'Aisles must remain clear of desks and chair clearance.')
  const placementRects: { path: string; id: string; rect: FloorRect; deskId?: string; asset: string }[] = []
  for (const [group, placements] of [['furniture', preset.furniture], ['decor', preset.decor]] as const) for (const [index, item] of placements.entries()) {
    if (!knownAssets.has(item.asset)) issue('unsupported_asset', `${group}[${index}].asset`, `Asset ${item.asset} is not registered in the shared art library.`)
    if (![item.x, item.z, item.rotationY ?? 0].every(Number.isFinite)) { issue('placement_out_of_bounds', `${group}[${index}]`, 'Placement coordinates and rotation must be finite.'); continue }
    if (item.y !== undefined && (!Number.isFinite(item.y) || item.y < 0 || item.y > height)) issue('placement_height_out_of_bounds', `${group}[${index}].y`, 'Placement height must fit inside the floor volume.')
    if (item.scale?.some(value => !Number.isFinite(value) || value <= 0)) issue('invalid_placement_scale', `${group}[${index}].scale`, 'Placement scale values must be positive and finite.')
    const workstationAttachment = Boolean(item.deskId && preset.workplaces.some(seat => seat.id === item.deskId) && ['desk.modern', 'chair.ergonomic', 'monitor.single', 'monitor.dual'].includes(item.asset))
    if (workstationAttachment) continue
    // Wall, ceiling, and desktop objects carry Y above the floor and do not
    // occupy a walkable floor footprint.
    if ((item.y ?? 0) > .9) continue
    const [baseWidth, baseDepth] = ASSET_FOOTPRINT[item.asset] ?? [.6, .6]
    const [scaleX, , scaleZ] = item.scale ?? [1, 1, 1]
    const cos = Math.abs(Math.cos(item.rotationY ?? 0)), sin = Math.abs(Math.sin(item.rotationY ?? 0))
    const footprint = item.footprint ?? { x: item.x - (baseWidth * scaleX * cos + baseDepth * scaleZ * sin) / 2, z: item.z - (baseWidth * scaleX * sin + baseDepth * scaleZ * cos) / 2, width: baseWidth * scaleX * cos + baseDepth * scaleZ * sin, depth: baseWidth * scaleX * sin + baseDepth * scaleZ * cos }
    if (!inside(footprint, width, depth)) issue('placement_out_of_bounds', `${group}[${index}]`, `Placement ${item.id} footprint must fit inside floor bounds.`)
    for (const seat of workplaceRects) if (overlap(footprint, seat.rect)) issue('furniture_workplace_overlap', `${group}[${index}]`, `Placement ${item.id} intersects workplace ${seat.seat.id}.`)
    for (const [aisleIndex, aisle] of preset.aisles.entries()) if (overlap(footprint, aisle)) issue('aisle_obstructed', `${group}[${index}]`, `Placement ${item.id} obstructs aisle ${aisleIndex}.`)
    for (const [barrierIndex, barrier] of preset.barriers.entries()) {
      const endX = barrier.x + Math.cos(barrier.rotationY) * barrier.length, endZ = barrier.z + Math.sin(barrier.rotationY) * barrier.length
      const thicknessX = Math.abs(Math.sin(barrier.rotationY)) * .14, thicknessZ = Math.abs(Math.cos(barrier.rotationY)) * .14
      const barrierBounds = { x: Math.min(barrier.x, endX) - thicknessX / 2, z: Math.min(barrier.z, endZ) - thicknessZ / 2, width: Math.abs(endX - barrier.x) + thicknessX, depth: Math.abs(endZ - barrier.z) + thicknessZ }
      if (overlap(footprint, barrierBounds)) issue('furniture_barrier_overlap', `${group}[${index}]`, `Placement ${item.id} intersects barrier ${barrier.id} (${barrierIndex}).`)
    }
    placementRects.push({ path: `${group}[${index}]`, id: item.id, rect: footprint, deskId: item.deskId, asset: item.asset })
  }
  for (let i = 0; i < placementRects.length; i++) for (let j = i + 1; j < placementRects.length; j++) if (overlap(placementRects[i]!.rect, placementRects[j]!.rect)) issue('placement_overlap', placementRects[j]!.path, `Placement ${placementRects[j]!.id} intersects ${placementRects[i]!.id}.`)
  return issues
}
