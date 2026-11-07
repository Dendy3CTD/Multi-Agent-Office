import { describe, expect, it } from 'vitest'
import { adaptLiveEmployees, adaptRuntimeStatus, completeLiveFloors, normalizeEmployeeStatus } from './adapter'
import { loadLiveOfficeData } from './useLiveOfficeData'
import type { LiveTransport } from './types'

class FakeTransport implements LiveTransport {
  calls: string[] = []
  constructor(private readonly responses: Record<string, unknown>) {}
  async get<T>(path: string, signal: AbortSignal): Promise<T> {
    this.calls.push(path)
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const value = this.responses[path]
    if (value instanceof Error) throw value
    if (value === undefined) throw new Error('endpoint_unavailable')
    return value as T
  }
}

const departments = Array.from({ length: 12 }, (_, index) => ({ id: `department-${index + 1}`, name: `Отдел ${index + 1}`, status: 'active' }))
const professions = [{ id: 'developer', name: 'Разработчик', departmentId: 'department-1' }]
const employees = Array.from({ length: 113 }, (_, index) => ({ id: `employee-${index}`, displayName: `Сотрудник ${index}`, professionId: 'developer', departmentId: 'department-1', status: 'active', modelDefault: 'model-demo' }))

describe('live office adapter', () => {
  it('normalizes real Directory records, deduplicates ids and does not infer work from active', () => {
    const result = adaptLiveEmployees([...employees.slice(0, 113), employees[0], { ...employees[1], status: 'working' }], professions)

    expect(result).toHaveLength(113)
    expect(result[0]).toMatchObject({ departmentId: 'department-1', floorId: 'department-department-1', status: 'unknown' })
    expect(normalizeEmployeeStatus('working')).toBe('working')
    expect(normalizeEmployeeStatus('blocked')).toBe('blocked')
  })

  it('maps departments to stable department-based floors and preserves live counts', () => {
    const adapted = adaptLiveEmployees(employees, professions)
    const floors = completeLiveFloors(departments, adapted)

    expect(floors).toHaveLength(15)
    expect(floors.find(floor => floor.departmentId === 'department-1')).toMatchObject({ id: 'department-department-1', employeeCount: 113 })
    expect(floors.find(floor => floor.kind === 'cafe')?.employeeCount).toBe(0)
  })

  it('keeps runtime readiness honest', () => {
    expect(adaptRuntimeStatus([])).toMatchObject({ available: false, authenticationVerified: false })
    expect(adaptRuntimeStatus([{ runtimeId: 'fake', kind: 'fake', available: true, authentication: { verified: false }, readiness: { ready: false, restrictions: ['authentication_unverified'] } }])).toMatchObject({ available: false, kind: 'fake', authenticationVerified: false })
  })

  it('loads live data through the injected transport without credentials in the data model', async () => {
    const transport = new FakeTransport({
      '/v1/departments': { departments },
      '/v1/professions': { professions },
      '/v1/employees': { employees },
      '/v1/projects': { projects: [{ id: 'project-1', name: 'Demo' }] },
      '/v1/status': { status: 'ok', budget: { status: 'available', allowanceStatus: 'unknown' } },
      '/v1/runtimes': { runtimes: [{ runtimeId: 'fake', kind: 'fake', available: true, authentication: { verified: false } }] },
      '/v1/events?limit=100': { events: [{ type: 'task_queued', timestamp: '2026-01-01T00:00:00Z' }] },
      '/v1/budget/snapshot': { status: 'available' },
    })

    const data = await loadLiveOfficeData(transport, new AbortController().signal)

    expect(data.employees).toHaveLength(113)
    expect(data.projects[0].id).toBe('project-1')
    expect(data.events).toHaveLength(1)
    expect(data.runtimeStatus.authenticationVerified).toBe(false)
    expect(JSON.stringify(data)).not.toMatch(/Bearer|secret|token|password/i)
    expect(transport.calls).toContain('/v1/departments')
  })

  it('honors cancellation before issuing a second request', async () => {
    const controller = new AbortController()
    controller.abort()
    const transport = new FakeTransport({})

    await expect(loadLiveOfficeData(transport, controller.signal)).rejects.toThrow('aborted')
    expect(transport.calls).toHaveLength(0)
  })
})
