import type { DeskSlot, EmployeeAssignment, FloorLayoutInput, OfficeLayoutSource, FloorProfile } from './types'

export const DIRECTORY_DEPARTMENT_IDS = [
  'management', 'software-development', 'quality-assurance', 'engineering-electronics',
  'cad-3d', 'research-analytics', 'documentation', 'design', 'finance-estimates',
  'devops', 'automation-integrations', 'security-review',
] as const

export function createFixtureSlots(floorId: string, count: number): DeskSlot[] {
  return Array.from({ length: count }, (_, index) => ({ deskId: `desk-${floorId}-${String(index + 1).padStart(3, '0')}`, floorId }))
}

export function createFixtureAssignments(floorId: string, count: number, deskCount = count): EmployeeAssignment[] {
  return Array.from({ length: count }, (_, index) => ({
    employeeId: `employee-${String(index + 1).padStart(3, '0')}`,
    deskId: `desk-${floorId}-${String((index % deskCount) + 1).padStart(3, '0')}`,
    floorId,
    departmentId: DIRECTORY_DEPARTMENT_IDS[index % DIRECTORY_DEPARTMENT_IDS.length],
  }))
}

export function createFixtureInput(overrides: Partial<FloorLayoutInput> = {}): FloorLayoutInput {
  const floorId = overrides.floorId ?? 'floor-2'
  const deskSlots = overrides.deskSlots ?? createFixtureSlots(floorId, 12)
  return {
    floorId,
    size: overrides.size ?? { width: 28, depth: 22, height: 3.2 },
    assignments: overrides.assignments ?? createFixtureAssignments(floorId, 12),
    deskSlots,
    room: overrides.room ?? { profile: 'open-space', meetingRooms: 1, restAreas: 1, serviceZones: 1 },
    aisles: overrides.aisles,
    seed: overrides.seed,
  }
}

export function createOfficeSourceFixture(): OfficeLayoutSource {
  const deskCounts = [4, 12, ...Array(11).fill(10), 3, 3]
  const employeeCounts = [0, 11, 10, ...Array(10).fill(9), 1, 1]
  const profiles: FloorProfile[] = ['lobby', 'management', 'engineering', 'research', 'design', 'infrastructure', 'archive', 'open-space', 'open-space', 'open-space', 'open-space', 'open-space', 'open-space', 'kitchen', 'lounge']
  const floors = deskCounts.map((_, index) => ({
    floorId: `floor-${index + 1}`,
    profile: profiles[index],
    size: index === 1 ? { width: 22, depth: 14, height: 3.2 } : { width: 30, depth: 24, height: 3.2 },
    departmentId: index >= 1 && index <= 12 ? DIRECTORY_DEPARTMENT_IDS[index - 1] : undefined,
    meetingRooms: index === 1 ? 1 : 0,
    restAreas: index === 1 || index === 14 ? 1 : 0,
    serviceZones: index === 0 || index === 13 ? 1 : 0,
    groupSize: 6,
  }))
  const deskSlots: DeskSlot[] = []
  const employees: EmployeeAssignment[] = []
  let employeeNumber = 1
  floors.forEach((floor, floorIndex) => {
    for (let index = 0; index < deskCounts[floorIndex]; index += 1) {
      const deskId = `desk-${floor.floorId}-${String(index + 1).padStart(3, '0')}`
      const occupied = index < employeeCounts[floorIndex]
      deskSlots.push({ deskId, floorId: floor.floorId, reserved: !occupied })
      if (occupied) {
        employees.push({ employeeId: `employee-${String(employeeNumber++).padStart(3, '0')}`, deskId, floorId: floor.floorId, departmentId: floor.departmentId ?? DIRECTORY_DEPARTMENT_IDS[(employeeNumber - 1) % DIRECTORY_DEPARTMENT_IDS.length] })
      }
    }
  })
  return { floors, employees, deskSlots, departmentIds: DIRECTORY_DEPARTMENT_IDS }
}
