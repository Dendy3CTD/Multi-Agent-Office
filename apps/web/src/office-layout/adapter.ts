import { createFloorLayout } from './engine'
import { FloorLayoutError } from './types'
import type { EmployeeAssignment, FloorLayout, OfficeFloorSource, OfficeLayoutCollection, OfficeLayoutSource } from './types'

function assignmentsForFloor(assignments: readonly EmployeeAssignment[], floor: OfficeFloorSource): EmployeeAssignment[] {
  return assignments.filter(assignment => assignment.floorId === floor.floorId)
}

function validateSource(source: OfficeLayoutSource): void {
  const floorIds = new Set<string>()
  for (const floor of source.floors) {
    if (floorIds.has(floor.floorId)) throw new FloorLayoutError('FLOOR_ID_DUPLICATE', `Duplicate floorId: ${floor.floorId}`)
    floorIds.add(floor.floorId)
    if (floor.departmentId && !source.departmentIds.includes(floor.departmentId)) {
      throw new FloorLayoutError('DEPARTMENT_UNKNOWN', `Floor ${floor.floorId} references unknown department ${floor.departmentId}.`)
    }
  }
  const employeeIds = new Set<string>()
  for (const employee of source.employees) {
    if (employeeIds.has(employee.employeeId)) throw new FloorLayoutError('EMPLOYEE_ID_DUPLICATE', `Duplicate employeeId: ${employee.employeeId}`)
    employeeIds.add(employee.employeeId)
    if (!floorIds.has(employee.floorId)) throw new FloorLayoutError('EMPLOYEE_FLOOR_UNKNOWN', `Employee ${employee.employeeId} references unknown floor ${employee.floorId}.`)
    if (employee.departmentId && !source.departmentIds.includes(employee.departmentId)) {
      throw new FloorLayoutError('DEPARTMENT_UNKNOWN', `Employee ${employee.employeeId} references unknown department ${employee.departmentId}.`)
    }
  }
  const deskIds = new Set<string>()
  for (const desk of source.deskSlots) {
    if (deskIds.has(desk.deskId)) throw new FloorLayoutError('DESK_ID_DUPLICATE', `Duplicate deskId: ${desk.deskId}`)
    deskIds.add(desk.deskId)
    if (!floorIds.has(desk.floorId)) throw new FloorLayoutError('DESK_FLOOR_UNKNOWN', `Desk ${desk.deskId} references unknown floor ${desk.floorId}.`)
  }
}

export function createOfficeFloorLayouts(source: OfficeLayoutSource): OfficeLayoutCollection {
  validateSource(source)
  const layouts = new Map<string, FloorLayout>()
  for (const floor of source.floors) {
    const assignments = assignmentsForFloor(source.employees, floor)
    const deskSlots = source.deskSlots.filter(slot => slot.floorId === floor.floorId)
    const layout = createFloorLayout({
      floorId: floor.floorId,
      size: floor.size,
      assignments,
      deskSlots,
      room: {
        profile: floor.profile,
        meetingRooms: floor.meetingRooms,
        restAreas: floor.restAreas,
        serviceZones: floor.serviceZones,
        groupSize: floor.groupSize,
      },
      aisles: source.aisles,
    })
    layouts.set(floor.floorId, layout)
  }
  return { layouts, employees: source.employees.length, desks: source.deskSlots.length, floors: source.floors.length }
}

export function createFloorLayoutFromOfficeData(source: OfficeLayoutSource, floorId: string): FloorLayout {
  const result = createOfficeFloorLayouts(source)
  const layout = result.layouts.get(floorId)
  if (!layout) throw new FloorLayoutError('FLOOR_NOT_FOUND', `Floor ${floorId} is not present in the office source.`)
  return layout
}
