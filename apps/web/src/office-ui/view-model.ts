import type { OfficeEmployee, OfficeFloor, OfficeTask } from './types'
import { officeStatusForEmployeeLiveState } from '../live/employeeLiveState'

export interface OfficeEmployeeFilters {
  departmentId?: string
  professionId?: string
  occupancy?: 'all' | 'busy' | 'available'
}

export function employeeDisplayStatus(employee: OfficeEmployee): string {
  return employee.employeeLiveState ? officeStatusForEmployeeLiveState(employee.employeeLiveState) : employee.status
}

export function filterOfficeEmployees(employees: readonly OfficeEmployee[], query: string, status: string, filters: OfficeEmployeeFilters = {}): OfficeEmployee[] {
  const normalized = query.trim().toLocaleLowerCase('ru-RU')
  return employees.filter(employee => {
    const displayStatus = employeeDisplayStatus(employee)
    const matchesStatus = status === 'all' || displayStatus === status
    const matchesDepartment = !filters.departmentId || employee.departmentId === filters.departmentId
    const matchesProfession = !filters.professionId || employee.professionId === filters.professionId || employee.profession === filters.professionId
    const busy = ['working', 'review', 'waiting', 'blocked', 'error'].includes(displayStatus) || Boolean(employee.currentTask) || Boolean(employee.taskCount)
    const matchesOccupancy = !filters.occupancy || filters.occupancy === 'all' || (filters.occupancy === 'busy' ? busy : !busy)
    const haystack = `${employee.name} ${employee.profession} ${employee.departmentId}`.toLocaleLowerCase('ru-RU')
    return matchesStatus && matchesDepartment && matchesProfession && matchesOccupancy && (!normalized || haystack.includes(normalized))
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru-RU'))
}

export function floorSummary(floor: OfficeFloor): string {
  return `${floor.employeeCount} сотрудников · ${floor.occupiedSeats} занято · ${floor.availableSeats} мест свободно`
}

export function employeeTasks(employee: OfficeEmployee, currentTasks: readonly OfficeTask[]): OfficeTask[] {
  return [...(employee.queue ?? []), ...currentTasks.filter(task => task.employeeId === employee.id)]
    .filter((task, index, list) => list.findIndex(candidate => candidate.id === task.id) === index)
}

export function statusLabel(status: string): string {
  return ({ active: 'В офисе', working: 'Работает', review: 'Проверка', idle: 'Свободен', waiting: 'Ожидает', blocked: 'Заблокирован', error: 'Ошибка', completed: 'Завершено', disabled: 'Отключён', offline: 'Не в сети', unknown: 'Статус не подтверждён', queued: 'В очереди', running: 'В работе', failed: 'Ошибка', cancelled: 'Отменено', IDLE: 'Свободен', QUEUED: 'В очереди', RUNNING: 'Работает', REVIEWING: 'Проверяет результат', WAITING: 'Ожидает', UNVERIFIED: 'Статус не подтверждён', WORKING: 'Работает', REVIEW: 'Проверка', BLOCKED: 'Заблокирован', FAILED: 'Ошибка', ERROR: 'Ошибка', COMPLETED: 'Завершено' } as Record<string, string>)[status] ?? status
}
