import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import OfficeUI from './OfficeUI'
import { DIRECTORY_FLOOR_DEFAULTS, TOWER_FLOOR_DEFAULTS, adaptEmployees, makeFloorViewModels, makeTowerFloorViewModels } from './adapter'
import { employeeTasks, filterOfficeEmployees, statusLabel } from './view-model'
import type { OfficeEmployee, OfficeTask } from './types'

function employee(index: number, status: OfficeEmployee['status'] = 'idle'): OfficeEmployee {
  const departmentIndex = index % DIRECTORY_FLOOR_DEFAULTS.length
  const department = DIRECTORY_FLOOR_DEFAULTS[departmentIndex]
  return {
    id: `employee-${index}`,
    name: `Сотрудник ${index}`,
    profession: index % 2 ? 'Инженер' : 'Аналитик',
    departmentId: department.departmentId,
    floorId: department.id,
    status,
  }
}

const tasks: OfficeTask[] = [
  { id: 'task-1', title: 'Проверить сборку', status: 'running', employeeId: 'employee-1' },
  { id: 'task-2', title: 'Подготовить отчёт', status: 'queued', employeeId: 'employee-1' },
]

describe('office-ui adapters and view models', () => {
  it('keeps the current Directory shape and supports the seeded 113 employees', () => {
    const employees = Array.from({ length: 113 }, (_, index) => employee(index))
    const floors = makeFloorViewModels(DIRECTORY_FLOOR_DEFAULTS, employees)

    expect(floors).toHaveLength(12)
    expect(employees).toHaveLength(113)
    expect(floors.reduce((total, floor) => total + floor.employeeCount, 0)).toBe(113)
    expect(floors[0].name).toBe('Руководство и управление проектами')
  })

  it('completes the elevator catalog with lobby and shared floors', () => {
    const employees = Array.from({ length: 113 }, (_, index) => employee(index))
    const floors = makeTowerFloorViewModels(makeFloorViewModels(DIRECTORY_FLOOR_DEFAULTS, employees), employees)

    expect(TOWER_FLOOR_DEFAULTS).toHaveLength(15)
    expect(floors).toHaveLength(15)
    expect(floors.map(floor => floor.id)).toEqual(expect.arrayContaining(['floor-00', 'floor-01', 'floor-14', 'floor-15']))
    expect(floors.find(floor => floor.id === 'floor-14')).toMatchObject({ name: 'Кухня и кафе', employeeCount: 0, availableSeats: 12 })
  })

  it('adapts Directory records without hardcoding employee names', () => {
    const result = adaptEmployees([{ id: 'e-1', displayName: 'Алёна', departmentId: 'design', professionName: 'Дизайнер', status: 'working', modelDefault: 'model-x' }])

    expect(result[0]).toMatchObject({ id: 'e-1', name: 'Алёна', profession: 'Дизайнер', floorId: 'floor-08', modelId: 'model-x', status: 'working' })
  })

  it('searches by name/profession and filters activity', () => {
    const employees = [employee(1, 'working'), employee(2, 'idle'), employee(3, 'disabled')]

    expect(filterOfficeEmployees(employees, 'инженер', 'all')).toHaveLength(2)
    expect(filterOfficeEmployees(employees, '', 'working').map(item => item.id)).toEqual(['employee-1'])
    expect(filterOfficeEmployees(employees, 'сотрудник 3', 'all')[0].status).toBe('disabled')
    expect(filterOfficeEmployees(employees, '', 'all', { occupancy: 'busy' }).map(item => item.id)).toEqual(['employee-1'])
  })

  it('deduplicates employee queue entries against live tasks', () => {
    const selected = { ...employee(1), queue: [tasks[0]] }

    expect(employeeTasks(selected, tasks).map(task => task.id)).toEqual(['task-1', 'task-2'])
    expect(statusLabel('cancelled')).toBe('Отменено')
  })
})

describe('OfficeUI rendering contract', () => {
  it('renders the current floor, employee panel data and honest disabled actions', () => {
    const employees = [employee(1, 'working')]
    const html = renderToStaticMarkup(<OfficeUI
      floors={makeFloorViewModels(DIRECTORY_FLOOR_DEFAULTS, employees)}
      activeFloorId="floor-02"
      onFloorSelect={() => undefined}
      employees={employees}
      selectedEmployeeId="employee-1"
      onEmployeeSelect={() => undefined}
      onCloseEmployee={() => undefined}
      currentTasks={tasks}
      runtimeStatus={{ available: true, kind: 'fake', label: 'Fake Runtime готов' }}
      budgetStatus={{ status: 'available' }}
    />)

    expect(html).toContain('Разработка ПО')
    expect(html).toContain('Сотрудник 1')
    expect(html).toContain('Fake Runtime готов')
    expect(html).toContain('Скрыть')
    expect(html).toContain('Скрыть панель')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('token')
    expect(html).not.toContain('password')
  })
})
