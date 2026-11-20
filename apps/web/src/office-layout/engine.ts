import { FloorLayoutError } from './types'
import type {
  AisleParameters,
  DeskSlot,
  EmployeeAssignment,
  FloorLayout,
  FloorLayoutInput,
  FloorProfile,
  LayoutChair,
  LayoutDesk,
  LayoutPoint,
  LayoutRect,
  LayoutRoom,
  LayoutWall,
  LayoutDoor,
  LayoutWindow,
  LayoutPlant,
  RoomConfiguration,
} from './types'

const DEFAULT_AISLES: Required<AisleParameters> = {
  deskWidth: 1.6,
  deskDepth: 0.8,
  chairWidth: 0.7,
  chairDepth: 0.7,
  rowGap: 2.8,
  columnGap: 1.1,
  roomGap: 1.2,
  clearance: 0.18,
  edgePadding: 1.2,
}

const DEFAULT_ROOM: Required<RoomConfiguration> = {
  profile: 'open-space',
  meetingRooms: 1,
  restAreas: 1,
  serviceZones: 1,
  groupSize: 6,
}

const SPECIAL_PROFILES = new Set<FloorProfile>(['lobby', 'kitchen', 'lounge'])

function rect(x: number, z: number, width: number, depth: number): LayoutRect {
  return { x, z, width, depth }
}

function point(x: number, y: number, z: number): LayoutPoint {
  return { x, y, z }
}

function validateInput(input: FloorLayoutInput, slots: readonly DeskSlot[], assignments: readonly EmployeeAssignment[]): void {
  if (!input.floorId) throw new FloorLayoutError('FLOOR_ID_MISSING', 'floorId is required.')
  if (!Number.isFinite(input.size.width) || !Number.isFinite(input.size.depth) || input.size.width <= 0 || input.size.depth <= 0) {
    throw new FloorLayoutError('FLOOR_SIZE_INVALID', 'Floor width and depth must be positive finite numbers.')
  }
  const deskIds = new Set<string>()
  for (const slot of slots) {
    if (!slot.deskId || deskIds.has(slot.deskId)) throw new FloorLayoutError('DESK_ID_DUPLICATE', `Duplicate deskId: ${slot.deskId}`)
    deskIds.add(slot.deskId)
    if (slot.floorId !== input.floorId) throw new FloorLayoutError('DESK_FLOOR_MISMATCH', `Desk ${slot.deskId} belongs to ${slot.floorId}, not ${input.floorId}.`)
  }
  const employeeIds = new Set<string>()
  const assignedDesks = new Set<string>()
  if (assignments.length > slots.length) throw new FloorLayoutError('FLOOR_CAPACITY_EXCEEDED', `${input.floorId} has ${slots.length} desks for ${assignments.length} employees.`)
  for (const assignment of assignments) {
    if (!assignment.employeeId || employeeIds.has(assignment.employeeId)) throw new FloorLayoutError('EMPLOYEE_ID_DUPLICATE', `Duplicate employeeId: ${assignment.employeeId}`)
    if (assignment.floorId !== input.floorId) throw new FloorLayoutError('EMPLOYEE_FLOOR_MISMATCH', `Employee ${assignment.employeeId} belongs to ${assignment.floorId}, not ${input.floorId}.`)
    if (assignedDesks.has(assignment.deskId)) throw new FloorLayoutError('DESK_OCCUPANCY_DUPLICATE', `Desk ${assignment.deskId} has multiple employees.`)
    if (!deskIds.has(assignment.deskId)) throw new FloorLayoutError('DESK_NOT_FOUND', `Desk ${assignment.deskId} is not available on ${input.floorId}.`)
    employeeIds.add(assignment.employeeId)
    assignedDesks.add(assignment.deskId)
  }
}

function roomDefaults(input: FloorLayoutInput): Required<RoomConfiguration> {
  return { ...DEFAULT_ROOM, ...(input.room ?? {}) }
}

function roomPlan(profile: FloorProfile, size: FloorLayoutInput['size'], config: Required<RoomConfiguration>, aisle: Required<AisleParameters>, origin: LayoutPoint): { rooms: LayoutRoom[]; deskDepth: number } {
  const rooms: LayoutRoom[] = []
  const width = Math.max(3.5, Math.min(6.5, size.width * 0.25))
  const reservedDepth = SPECIAL_PROFILES.has(profile) ? Math.min(size.depth * 0.38, 6) : Math.min(size.depth * 0.25, 4.5)
  const x = size.width - aisle.edgePadding - width
  const z = aisle.edgePadding
  if (profile === 'lobby') rooms.push({ id: 'reception', kind: 'reception', bounds: rect(x, z, width, reservedDepth) })
  if (profile === 'kitchen') rooms.push({ id: 'kitchen', kind: 'kitchen', bounds: rect(x, z, width, reservedDepth) })
  if (profile === 'lounge') rooms.push({ id: 'lounge', kind: 'rest', bounds: rect(x, z, width, reservedDepth) })
  if (profile === 'management') rooms.push({ id: 'leadership', kind: 'leadership', privacy: 'solid', bounds: rect(aisle.edgePadding, aisle.edgePadding + 2.8, Math.min(5.6, size.width * 0.28), 2.4) })
  for (let i = 0; i < config.meetingRooms; i += 1) {
    rooms.push({ id: `meeting-${i + 1}`, kind: 'meeting', privacy: 'glass', bounds: rect(x, z + (i * (reservedDepth + aisle.roomGap)), width, Math.min(3.2, reservedDepth)) })
  }
  for (let i = 0; i < config.restAreas; i += 1) {
    rooms.push({ id: `rest-${i + 1}`, kind: 'rest', bounds: rect(aisle.edgePadding, aisle.edgePadding + i * 2.6, Math.min(4.5, size.width * 0.22), 2.4) })
  }
  for (let i = 0; i < config.serviceZones; i += 1) {
    rooms.push({ id: `service-${i + 1}`, kind: profile === 'archive' ? 'archive' : 'service', bounds: rect(aisle.edgePadding, aisle.edgePadding + i * 2.2, Math.min(3, size.width * 0.16), 1.8) })
  }
  const deskAreaDepth = Math.max(0, size.depth - aisle.edgePadding * 2 - (SPECIAL_PROFILES.has(profile) ? reservedDepth + aisle.roomGap : 0))
  return {
    rooms: rooms.map(room => ({ ...room, bounds: { ...room.bounds, x: room.bounds.x + origin.x, z: room.bounds.z + origin.z } })),
    deskDepth: deskAreaDepth,
  }
}

function generatedPosition(index: number, size: FloorLayoutInput['size'], aisle: Required<AisleParameters>, deskAreaDepth: number, columns: number): LayoutPoint {
  const row = Math.floor(index / columns)
  const column = index % columns
  const gridWidth = columns * aisle.deskWidth + (columns - 1) * aisle.columnGap
  const sideMargin = Math.max(0, (size.width - aisle.edgePadding * 2 - gridWidth) / 2)
  const x = aisle.edgePadding + sideMargin + aisle.deskWidth / 2 + column * (aisle.deskWidth + aisle.columnGap)
  const z = size.depth - aisle.edgePadding - aisle.deskDepth - aisle.clearance - aisle.chairDepth - row * aisle.rowGap - aisle.deskDepth
  if (z < size.depth - aisle.edgePadding - deskAreaDepth) throw new FloorLayoutError('FLOOR_CAPACITY_EXCEEDED', 'Desk slots do not fit inside the configured floor and aisle clearances.')
  return point(x, 0, z)
}

export function createFloorLayout(input: FloorLayoutInput): FloorLayout {
  const aisle = { ...DEFAULT_AISLES, ...(input.aisles ?? {}) }
  const config = roomDefaults(input)
  const slots = [...input.deskSlots].filter(slot => slot.floorId === input.floorId).sort((a, b) => a.deskId.localeCompare(b.deskId))
  const assignments = [...input.assignments].sort((a, b) => a.employeeId.localeCompare(b.employeeId))
  validateInput(input, slots, assignments)
  const origin = input.size.origin ?? point(0, 0, 0)
  const plan = roomPlan(config.profile, input.size, config, aisle, origin)
  const columns = Math.max(1, Math.floor((input.size.width - aisle.edgePadding * 2) / (aisle.deskWidth + aisle.columnGap)))
  const assignmentByDesk = new Map(assignments.map(assignment => [assignment.deskId, assignment]))
  const desks: LayoutDesk[] = []
  const chairs: LayoutChair[] = []
  const characterSpots = [] as FloorLayout['characterSpots'][number][]
  for (const [index, slot] of slots.entries()) {
    const generated = generatedPosition(index, input.size, aisle, plan.deskDepth, columns)
    const position = slot.position ?? point(generated.x + origin.x, generated.y + origin.y, generated.z + origin.z)
    const orientation = slot.orientation ?? 0
    const bounds = rect(position.x - aisle.deskWidth / 2, position.z, aisle.deskWidth, aisle.deskDepth)
    const assignment = assignmentByDesk.get(slot.deskId)
    desks.push({ deskId: slot.deskId, floorId: input.floorId, position, orientation, bounds, groupId: `group-${Math.floor(index / config.groupSize) + 1}`, reserved: slot.reserved ?? !assignment, zone: slot.zone ?? 'desk', occupiedBy: assignment?.employeeId })
    const chairPosition = point(position.x, 0, position.z + aisle.deskDepth + aisle.clearance + aisle.chairDepth / 2)
    const chairBounds = rect(chairPosition.x - aisle.chairWidth / 2, chairPosition.z - aisle.chairDepth / 2, aisle.chairWidth, aisle.chairDepth)
    chairs.push({ deskId: slot.deskId, position: chairPosition, orientation, bounds: chairBounds })
    if (assignment) characterSpots.push({ employeeId: assignment.employeeId, deskId: slot.deskId, position: point(chairPosition.x, 0, chairPosition.z + aisle.chairDepth / 2 + 0.25), orientation })
  }
  const rowCount = Math.ceil(slots.length / columns)
  const aisles: FloorLayout['aisles'][number][] = [{ id: 'main-entry', kind: 'main', bounds: rect(origin.x, origin.z, input.size.width, aisle.edgePadding) }]
  for (let row = 0; row < rowCount; row += 1) {
    const z = input.size.depth - aisle.edgePadding - aisle.deskDepth - aisle.clearance - aisle.chairDepth - row * aisle.rowGap
    aisles.push({ id: `row-${row + 1}`, kind: 'desk-row', bounds: rect(origin.x + aisle.edgePadding, origin.z + z, input.size.width - aisle.edgePadding * 2, aisle.clearance) })
  }
  const entry = point(origin.x + input.size.width / 2, origin.y, origin.z + input.size.depth - aisle.edgePadding / 2)
  const target = point(origin.x + input.size.width / 2, origin.y, origin.z + input.size.depth / 2)
  const bounds = rect(origin.x, origin.z, input.size.width, input.size.depth)
  const serviceZones = plan.rooms.filter(room => room.kind === 'service' || room.kind === 'archive' || room.kind === 'kitchen')
  const wallThickness = 0.2
  const wallHeight = input.size.height ?? 3.2
  const walls: LayoutWall[] = [
    { id: 'wall-south', side: 'south', height: wallHeight, bounds: rect(origin.x, origin.z, input.size.width, wallThickness) },
    { id: 'wall-north', side: 'north', height: wallHeight, bounds: rect(origin.x, origin.z + input.size.depth - wallThickness, input.size.width, wallThickness) },
    { id: 'wall-west', side: 'west', height: wallHeight, bounds: rect(origin.x, origin.z, wallThickness, input.size.depth) },
    { id: 'wall-east', side: 'east', height: wallHeight, bounds: rect(origin.x + input.size.width - wallThickness, origin.z, wallThickness, input.size.depth) },
  ]
  const partitions: LayoutWall[] = config.profile === 'management'
    ? [{ id: 'partition-leadership', side: 'partition', height: wallHeight, bounds: rect(origin.x + aisle.edgePadding + 5.6, origin.z + aisle.edgePadding + 2.8, wallThickness, 2.4) }]
    : []
  const doors: LayoutDoor[] = [{ id: 'door-main', wallId: 'wall-south', position: point(origin.x + input.size.width / 2, 0, origin.z), bounds: rect(origin.x + input.size.width / 2 - 0.7, origin.z, 1.4, wallThickness) }]
  const windows: LayoutWindow[] = [
    { id: 'window-north-1', wallId: 'wall-north', position: point(origin.x + input.size.width * 0.3, wallHeight * 0.55, origin.z + input.size.depth), bounds: rect(origin.x + input.size.width * 0.22, origin.z + input.size.depth - wallThickness, 2.4, wallThickness) },
    { id: 'window-north-2', wallId: 'wall-north', position: point(origin.x + input.size.width * 0.7, wallHeight * 0.55, origin.z + input.size.depth), bounds: rect(origin.x + input.size.width * 0.62, origin.z + input.size.depth - wallThickness, 2.4, wallThickness) },
  ]
  const plants: LayoutPlant[] = [
    { id: 'plant-north-west', position: point(origin.x + 0.7, 0, origin.z + input.size.depth - 0.7), bounds: rect(origin.x + 0.35, origin.z + input.size.depth - 1.05, 0.7, 0.7) },
    { id: 'plant-south-east', position: point(origin.x + input.size.width - 0.7, 0, origin.z + 2), bounds: rect(origin.x + input.size.width - 1.05, origin.z + 1.65, 0.7, 0.7) },
  ]
  return {
    floorId: input.floorId,
    profile: config.profile,
    size: input.size,
    bounds,
    floorBounds: bounds,
    desks,
    chairs,
    characterSpots,
    rooms: plan.rooms,
    aisles,
    entryPoints: [entry],
    serviceZones,
    walls,
    doors,
    windows,
    plants,
    partitions,
    camera: { position: point(target.x, Math.max(8, input.size.height ?? 8), target.z + Math.max(8, input.size.depth * 0.65)), target },
    focusTarget: target,
    collisionBounds: [
      ...desks.map(desk => desk.bounds),
      ...chairs.map(chair => chair.bounds),
      ...plan.rooms.map(room => room.bounds),
      ...walls.map(wall => wall.bounds),
      ...partitions.map(partition => partition.bounds),
      ...plants.map(plant => plant.bounds),
    ],
  }
}
