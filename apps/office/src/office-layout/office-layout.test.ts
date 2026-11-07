import { describe, expect, it } from 'vitest'
import { createFloorLayout, FloorLayoutError, getCameraFocusTarget, getEmployeeDeskPosition, getFloorBounds, validateFloorLayout } from './index'
import { createFixtureAssignments, createFixtureInput, createFixtureSlots, createOfficeSourceFixture, DIRECTORY_DEPARTMENT_IDS } from './fixtures'
import { createOfficeFloorLayouts } from './adapter'

describe('floor layout engine', () => {
  it('keeps Directory departments and supports 113 employees on 132 desks', () => {
    expect(DIRECTORY_DEPARTMENT_IDS).toHaveLength(12)
    const floorId = 'floor-2'
    const layout = createFloorLayout(createFixtureInput({
      floorId,
      size: { width: 90, depth: 70, height: 3.2 },
      deskSlots: createFixtureSlots(floorId, 132),
      assignments: createFixtureAssignments(floorId, 113, 132),
      room: { profile: 'open-space', meetingRooms: 2, restAreas: 1, serviceZones: 1, groupSize: 6 },
    }))
    expect(layout.desks).toHaveLength(132)
    expect(layout.characterSpots).toHaveLength(113)
    expect(new Set(layout.desks.map(desk => desk.deskId)).size).toBe(132)
    expect(new Set(layout.characterSpots.map(spot => spot.employeeId)).size).toBe(113)
    expect(validateFloorLayout(layout).valid).toBe(true)
  })

  it('is deterministic and preserves explicit slot coordinates', () => {
    const input = createFixtureInput({
      deskSlots: [{ deskId: 'desk-floor-2-001', floorId: 'floor-2', position: { x: 3, y: 0, z: 4 }, orientation: Math.PI }],
      assignments: createFixtureAssignments('floor-2', 1),
    })
    const first = createFloorLayout(input)
    const second = createFloorLayout(input)
    expect(second).toEqual(first)
    expect(first.desks[0].position).toEqual({ x: 3, y: 0, z: 4 })
  })

  it('reports capacity failure instead of losing employees', () => {
    expect(() => createFloorLayout(createFixtureInput({
      deskSlots: createFixtureSlots('floor-2', 2),
      assignments: createFixtureAssignments('floor-2', 3, 2),
    }))).toThrow(FloorLayoutError)
    try {
      createFloorLayout(createFixtureInput({ deskSlots: createFixtureSlots('floor-2', 2), assignments: createFixtureAssignments('floor-2', 3, 2) }))
    } catch (error) {
      expect(error).toMatchObject({ code: 'FLOOR_CAPACITY_EXCEEDED' })
    }
  })

  it('supports floor 2, kitchen and lounge profiles with distinct rooms', () => {
    const floor = createFloorLayout(createFixtureInput({ floorId: 'floor-2', room: { profile: 'management', meetingRooms: 1, restAreas: 1, serviceZones: 1 } }))
    const kitchen = createFloorLayout(createFixtureInput({ floorId: 'floor-14', room: { profile: 'kitchen' } }))
    const lounge = createFloorLayout(createFixtureInput({ floorId: 'floor-15', room: { profile: 'lounge' } }))
    expect(floor.profile).toBe('management')
    expect(floor.rooms.some(room => room.kind === 'leadership')).toBe(true)
    expect(kitchen.rooms.some(room => room.kind === 'kitchen')).toBe(true)
    expect(lounge.rooms.some(room => room.kind === 'rest')).toBe(true)
  })

  it('exposes safe integration targets and rejects duplicate assignments', () => {
    const layout = createFloorLayout(createFixtureInput())
    expect(getEmployeeDeskPosition(layout, 'employee-001')).toBeDefined()
    expect(getFloorBounds(layout)).toEqual(layout.bounds)
    expect(getCameraFocusTarget(layout)).toEqual(layout.camera.target)
    expect(() => createFloorLayout(createFixtureInput({ assignments: [
      ...createFixtureAssignments('floor-2', 1),
      { employeeId: 'employee-001', deskId: 'desk-floor-2-002', floorId: 'floor-2' },
    ] }))).toThrow(/Duplicate employeeId/)
  })

  it('adapts 15 floors, 113 employees, and 132 existing desks without reassignment', () => {
    const source = createOfficeSourceFixture()
    const result = createOfficeFloorLayouts(source)
    expect(result.floors).toBe(15)
    expect(result.employees).toBe(113)
    expect(result.desks).toBe(132)
    expect(result.layouts.size).toBe(15)
    expect(result.layouts.get('floor-2')?.profile).toBe('management')
    expect(result.layouts.get('floor-2')?.rooms.some(room => room.kind === 'meeting')).toBe(true)
    expect(result.layouts.get('floor-14')?.profile).toBe('kitchen')
    expect(result.layouts.get('floor-15')?.profile).toBe('lounge')
    for (const layout of result.layouts.values()) expect(validateFloorLayout(layout).valid).toBe(true)
    const desks = [...result.layouts.values()].flatMap(layout => layout.desks)
    const employees = desks.flatMap(desk => desk.occupiedBy ? [desk.occupiedBy] : [])
    expect(new Set(desks.map(desk => desk.deskId)).size).toBe(132)
    expect(new Set(employees).size).toBe(113)
    expect(desks.filter(desk => desk.reserved && !desk.occupiedBy)).not.toHaveLength(0)
  })

  it('validates floor 2 spatial shell and its 11 occupied plus one reserved desk', () => {
    const source = createOfficeSourceFixture()
    const layout = createOfficeFloorLayouts(source).layouts.get('floor-2')!
    expect(layout.desks).toHaveLength(12)
    expect(layout.desks.filter(desk => desk.occupiedBy)).toHaveLength(11)
    expect(layout.desks.filter(desk => desk.reserved && !desk.occupiedBy)).toHaveLength(1)
    expect(layout.walls).toHaveLength(4)
    expect(layout.windows.every(window => layout.walls.some(wall => wall.id === window.wallId))).toBe(true)
    expect(layout.doors.every(door => layout.walls.some(wall => wall.id === door.wallId))).toBe(true)
    expect(layout.partitions.some(partition => partition.id === 'partition-leadership')).toBe(true)
    expect(layout.size).toMatchObject({ width: 22, depth: 14 })
    expect(layout.rooms.find(room => room.kind === 'meeting')?.privacy).toBe('glass')
    expect(layout.desks.every(desk => desk.bounds.x >= layout.bounds.x && desk.bounds.x + desk.bounds.width <= layout.bounds.x + layout.bounds.width)).toBe(true)
    expect(layout.chairs.every(chair => chair.bounds.z >= layout.bounds.z && chair.bounds.z + chair.bounds.depth <= layout.bounds.z + layout.bounds.depth)).toBe(true)
    expect(layout.plants.every(plant => layout.aisles.every(aisle => !plant.bounds || !(
      plant.bounds.x < aisle.bounds.x + aisle.bounds.width && plant.bounds.x + plant.bounds.width > aisle.bounds.x
      && plant.bounds.z < aisle.bounds.z + aisle.bounds.depth && plant.bounds.z + plant.bounds.depth > aisle.bounds.z
    )))).toBe(true)
    expect(validateFloorLayout(layout)).toEqual({ valid: true, issues: [] })
  })
})
