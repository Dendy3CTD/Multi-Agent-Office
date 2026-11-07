import type { OfficeEmployee, OfficeFloor, OfficeTask } from './types'

/**
 * Current Directory snapshot used only as a fallback until the server supplies
 * floor metadata. Employee names are never generated here: they come from the
 * API/demo adapter and may scale beyond the seeded 113 records.
 */
export const DIRECTORY_FLOOR_DEFAULTS: readonly Pick<OfficeFloor, 'id' | 'number' | 'departmentId' | 'name'>[] = [
  { id: 'floor-01', number: 1, departmentId: 'management', name: 'Руководство и управление проектами' },
  { id: 'floor-02', number: 2, departmentId: 'software-development', name: 'Разработка ПО' },
  { id: 'floor-03', number: 3, departmentId: 'quality-assurance', name: 'Тестирование и контроль качества' },
  { id: 'floor-04', number: 4, departmentId: 'engineering-electronics', name: 'Инженерия и электроника' },
  { id: 'floor-05', number: 5, departmentId: 'cad-3d', name: 'CAD и 3D' },
  { id: 'floor-06', number: 6, departmentId: 'research-analytics', name: 'Исследования и аналитика' },
  { id: 'floor-07', number: 7, departmentId: 'documentation', name: 'Документация' },
  { id: 'floor-08', number: 8, departmentId: 'design', name: 'Дизайн' },
  { id: 'floor-09', number: 9, departmentId: 'finance-estimates', name: 'Финансы и сметы' },
  { id: 'floor-10', number: 10, departmentId: 'devops', name: 'DevOps' },
  { id: 'floor-11', number: 11, departmentId: 'automation-integrations', name: 'Автоматизация и интеграции' },
  { id: 'floor-12', number: 12, departmentId: 'security-review', name: 'Безопасность и ревью' },
]

/** Complete tower catalog. Special floors deliberately have no fake employees. */
export const TOWER_FLOOR_DEFAULTS: readonly Pick<OfficeFloor, 'id' | 'number' | 'departmentId' | 'name' | 'kind' | 'icon'>[] = [
  { id: 'floor-15', number: 15, departmentId: 'lounge', name: 'Отдых и переговорные', kind: 'lounge', icon: '☼' },
  { id: 'floor-14', number: 14, departmentId: 'cafe', name: 'Кухня и кафе', kind: 'cafe', icon: '◒' },
  ...DIRECTORY_FLOOR_DEFAULTS.map(floor => ({ ...floor, kind: 'department' as const, icon: '·' })),
  { id: 'floor-00', number: 0, departmentId: 'lobby', name: 'Lobby · Ресепшен', kind: 'lobby', icon: '⌂' },
]

export function makeTowerFloorViewModels(
  floors: readonly OfficeFloor[] = DIRECTORY_FLOOR_DEFAULTS.map((floor, index) => ({ ...floor, kind: 'department' as const, icon: '·', employeeCount: 0, occupiedSeats: 0, availableSeats: 12, state: 'quiet' as const })),
  employees: readonly OfficeEmployee[] = [],
  seatsPerFloor = 12,
): OfficeFloor[] {
  const byId = new Map(floors.map(floor => [floor.id, floor]))
  const byDepartment = new Map(floors.map(floor => [floor.departmentId, floor]))
  return TOWER_FLOOR_DEFAULTS.map((definition) => {
    const existing = byId.get(definition.id) ?? byDepartment.get(definition.departmentId)
    if (existing) return { ...existing, kind: existing.kind ?? definition.kind, icon: existing.icon ?? definition.icon }
    const floorEmployees = employees.filter(employee => employee.floorId === definition.id || employee.departmentId === definition.departmentId)
    const occupiedSeats = floorEmployees.filter(employee => ['active', 'working', 'waiting'].includes(employee.status)).length
    return {
      ...definition,
      employeeCount: floorEmployees.length,
      occupiedSeats,
      availableSeats: Math.max(0, seatsPerFloor - occupiedSeats),
      state: floorEmployees.some(employee => employee.status === 'working') ? 'busy' : floorEmployees.length ? 'active' : 'quiet',
    }
  })
}

export interface DirectoryEmployeeDTO {
  id: string
  displayName: string
  professionId?: string
  professionName?: string
  departmentId: string
  status?: string
  modelDefault?: string
  runtimeId?: string
  skills?: readonly string[]
  currentTask?: string
  seatId?: string
}

export function adaptEmployees(records: readonly DirectoryEmployeeDTO[], floorForDepartment = (departmentId: string) => `floor-${String(DIRECTORY_FLOOR_DEFAULTS.find(floor => floor.departmentId === departmentId)?.number ?? 1).padStart(2, '0')}`): OfficeEmployee[] {
  return records.map(record => ({
    id: record.id,
    name: record.displayName,
    profession: record.professionName ?? record.professionId ?? 'Сотрудник',
    professionId: record.professionId,
    departmentId: record.departmentId,
    floorId: floorForDepartment(record.departmentId),
    status: record.status === 'disabled' ? 'disabled' : record.status === 'active' ? 'active' : record.status === 'working' ? 'working' : 'idle',
    modelId: record.modelDefault,
    runtimeId: record.runtimeId,
    skills: record.skills,
    currentTask: record.currentTask,
    seatId: record.seatId,
  }))
}

export function makeFloorViewModels(
  departments: readonly { id: string; name: string; departmentId?: string }[] = DIRECTORY_FLOOR_DEFAULTS,
  employees: readonly OfficeEmployee[] = [],
  seatsPerFloor = 12,
): OfficeFloor[] {
  return departments.map((department, index) => {
    const departmentId = department.departmentId ?? department.id
    const floorEmployees = employees.filter(employee => employee.departmentId === departmentId)
    const occupiedSeats = floorEmployees.filter(employee => ['active', 'working', 'waiting'].includes(employee.status)).length
    return {
      id: `floor-${String(index + 1).padStart(2, '0')}`,
      number: index + 1,
      departmentId,
      name: department.name,
      employeeCount: floorEmployees.length,
      occupiedSeats,
      availableSeats: Math.max(0, seatsPerFloor - occupiedSeats),
      state: floorEmployees.some(employee => employee.status === 'working') ? 'busy' : floorEmployees.length ? 'active' : 'quiet',
    }
  })
}

export function tasksForEmployee(employeeId: string, tasks: readonly OfficeTask[]): OfficeTask[] {
  return tasks.filter(task => task.employeeId === employeeId)
}
