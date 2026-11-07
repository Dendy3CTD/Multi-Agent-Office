import type { FloorLayout, FloorLayoutValidation, LayoutRect } from './types'

function overlap(a: LayoutRect, b: LayoutRect, clearance = 0): boolean {
  return a.x - clearance < b.x + b.width && a.x + a.width + clearance > b.x
    && a.z - clearance < b.z + b.depth && a.z + a.depth + clearance > b.z
}

function inside(rect: LayoutRect, bounds: LayoutRect): boolean {
  return rect.x >= bounds.x && rect.z >= bounds.z
    && rect.x + rect.width <= bounds.x + bounds.width
    && rect.z + rect.depth <= bounds.z + bounds.depth
}

export function validateFloorLayout(layout: FloorLayout): FloorLayoutValidation {
  const issues: FloorLayoutValidation['issues'][number][] = []
  const deskIds = new Set<string>()
  const employeeIds = new Set<string>()
  for (const desk of layout.desks) {
    if (deskIds.has(desk.deskId)) issues.push({ code: 'DESK_ID_DUPLICATE', message: `Duplicate desk ${desk.deskId}.`, subject: desk.deskId })
    deskIds.add(desk.deskId)
    if (desk.bounds.x < layout.bounds.x || desk.bounds.z < layout.bounds.z || desk.bounds.x + desk.bounds.width > layout.bounds.x + layout.bounds.width || desk.bounds.z + desk.bounds.depth > layout.bounds.z + layout.bounds.depth) {
      issues.push({ code: 'DESK_OUT_OF_BOUNDS', message: `Desk ${desk.deskId} is outside the floor.`, subject: desk.deskId })
    }
    if (desk.occupiedBy && employeeIds.has(desk.occupiedBy)) issues.push({ code: 'EMPLOYEE_DUPLICATE', message: `Employee ${desk.occupiedBy} occupies multiple desks.`, subject: desk.occupiedBy })
    if (desk.occupiedBy) employeeIds.add(desk.occupiedBy)
  }
  for (let i = 0; i < layout.desks.length; i += 1) {
    for (let j = i + 1; j < layout.desks.length; j += 1) {
      if (overlap(layout.desks[i].bounds, layout.desks[j].bounds, 0.001)) issues.push({ code: 'DESK_OVERLAP', message: `Desks ${layout.desks[i].deskId} and ${layout.desks[j].deskId} overlap.`, subject: layout.desks[i].deskId })
    }
  }
  for (const chair of layout.chairs) {
    if (!inside(chair.bounds, layout.bounds)) issues.push({ code: 'CHAIR_OUT_OF_BOUNDS', message: `Chair ${chair.deskId} is outside the floor.`, subject: chair.deskId })
    const desk = layout.desks.find(item => item.deskId === chair.deskId)
    if (!desk) issues.push({ code: 'CHAIR_DESK_MISSING', message: `Chair ${chair.deskId} has no desk.`, subject: chair.deskId })
    else if (overlap(chair.bounds, desk.bounds, 0.001)) issues.push({ code: 'CHAIR_OVERLAP', message: `Chair ${chair.deskId} intersects its desk.`, subject: chair.deskId })
  }
  for (const plant of layout.plants) if (!inside(plant.bounds, layout.bounds)) issues.push({ code: 'PLANT_OUT_OF_BOUNDS', message: `Plant ${plant.id} is outside the floor.`, subject: plant.id })
  for (const plant of layout.plants) for (const aisle of layout.aisles) if (overlap(plant.bounds, aisle.bounds)) issues.push({ code: 'PLANT_IN_AISLE', message: `Plant ${plant.id} blocks aisle ${aisle.id}.`, subject: plant.id })
  for (const aisle of layout.aisles) if (!inside(aisle.bounds, layout.bounds)) issues.push({ code: 'AISLE_OUT_OF_BOUNDS', message: `Aisle ${aisle.id} is outside the floor.`, subject: aisle.id })
  const wallIds = new Set(layout.walls.map(wall => wall.id))
  for (const wall of [...layout.walls, ...layout.partitions]) if (!inside(wall.bounds, layout.bounds)) issues.push({ code: 'WALL_OUT_OF_BOUNDS', message: `Wall ${wall.id} is outside the floor.`, subject: wall.id })
  for (const window of layout.windows) {
    if (!wallIds.has(window.wallId)) issues.push({ code: 'WINDOW_WALL_MISSING', message: `Window ${window.id} does not reference a wall.`, subject: window.id })
    if (!inside(window.bounds, layout.bounds)) issues.push({ code: 'WINDOW_OUT_OF_BOUNDS', message: `Window ${window.id} is outside the floor.`, subject: window.id })
  }
  for (const door of layout.doors) if (!wallIds.has(door.wallId)) issues.push({ code: 'DOOR_WALL_MISSING', message: `Door ${door.id} does not reference a wall.`, subject: door.id })
  for (const room of layout.rooms) {
    for (const desk of layout.desks) if (overlap(room.bounds, desk.bounds, 0.001)) issues.push({ code: 'ROOM_DESK_OVERLAP', message: `Room ${room.id} intersects desk ${desk.deskId}.`, subject: room.id })
  }
  for (const aisle of layout.aisles) {
    for (const desk of layout.desks) if (overlap(aisle.bounds, desk.bounds)) issues.push({ code: 'AISLE_DESK_OVERLAP', message: `Aisle ${aisle.id} intersects desk ${desk.deskId}.`, subject: aisle.id })
  }
  for (const entry of layout.entryPoints) {
    if (entry.x < layout.bounds.x || entry.x > layout.bounds.x + layout.bounds.width || entry.z < layout.bounds.z || entry.z > layout.bounds.z + layout.bounds.depth) issues.push({ code: 'ENTRY_OUT_OF_BOUNDS', message: 'Entry point is outside floor bounds.', subject: 'entry' })
  }
  if (layout.camera.target.x < layout.bounds.x || layout.camera.target.x > layout.bounds.x + layout.bounds.width || layout.camera.target.z < layout.bounds.z || layout.camera.target.z > layout.bounds.z + layout.bounds.depth) issues.push({ code: 'CAMERA_TARGET_OUT_OF_BOUNDS', message: 'Camera target is outside floor bounds.', subject: 'camera.target' })
  return { valid: issues.length === 0, issues }
}

export function getEmployeeDeskPosition(layout: FloorLayout, employeeId: string) {
  const spot = layout.characterSpots.find(item => item.employeeId === employeeId)
  return spot?.position
}

export function getFloorBounds(layout: FloorLayout) {
  return layout.bounds
}

export function getCameraFocusTarget(layout: FloorLayout) {
  return layout.camera.target
}
