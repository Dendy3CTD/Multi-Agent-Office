import type { OfficeEmployee, OfficeEvent, OfficeFloor, OfficeProject, OfficeRuntimeStatus, OfficeTask } from '../office-ui/types'
import type { LiveDepartmentDTO, LiveEmployeeDTO, LiveProfessionDTO, LiveRuntimeDTO, LiveStatusDTO, LiveTaskDTO } from './types'

export function normalizeEmployeeStatus(status: unknown): OfficeEmployee['status'] {
  if (status === 'disabled') return 'disabled'
  if (status === 'working') return 'working'
  if (status === 'blocked') return 'blocked'
  if (status === 'offline') return 'offline'
  if (status === 'idle') return 'idle'
  // Directory's active means enabled, not currently working. Do not infer work.
  return 'unknown'
}

export function adaptLiveEmployees(records: readonly LiveEmployeeDTO[], professions: readonly LiveProfessionDTO[]): OfficeEmployee[] {
  const professionById = new Map(professions.map(profession => [profession.id, profession]))
  const seen = new Set<string>()
  const result: OfficeEmployee[] = []
  for (const record of records) {
    if (!record.id || seen.has(record.id)) continue
    seen.add(record.id)
    const profession = professionById.get(record.professionId)
    const departmentId = record.departmentId ?? profession?.departmentId ?? 'unknown'
    result.push({
      id: record.id,
      name: record.displayName,
      profession: profession?.name ?? record.professionId ?? 'Сотрудник',
      professionId: record.professionId,
      departmentId,
      floorId: `department-${departmentId}`,
      status: normalizeEmployeeStatus(record.status),
      modelId: record.modelDefault,
      runtimeId: record.runtimeId,
      currentTask: record.currentTask,
      skills: record.skillReferences ?? record.skills,
      seatId: record.seatId,
    })
  }
  return result
}

export function adaptLiveFloors(departments: readonly LiveDepartmentDTO[], employees: readonly OfficeEmployee[], seatsPerFloor = 12): OfficeFloor[] {
  return departments.map((department, index) => {
    const members = employees.filter(employee => employee.departmentId === department.id)
    const occupiedSeats = members.filter(employee => ['active', 'working', 'waiting'].includes(employee.status)).length
    return {
      id: `department-${department.id}`,
      number: index + 1,
      departmentId: department.id,
      name: department.name,
      employeeCount: members.length,
      occupiedSeats,
      availableSeats: Math.max(0, seatsPerFloor - occupiedSeats),
      state: members.some(employee => employee.status === 'working') ? 'busy' : members.length ? 'active' : 'quiet',
      kind: 'department',
      icon: '·',
    }
  })
}

export function adaptLiveTasks(records: readonly LiveTaskDTO[]): OfficeTask[] {
  const seen = new Set<string>()
  return records.filter(record => record.id && !seen.has(record.id) && seen.add(record.id)).map(record => ({
    id: record.id,
    title: record.title,
    status: record.status === 'completed' ? 'completed' : record.status === 'failed' ? 'failed' : record.status === 'cancelled' ? 'cancelled' : record.status === 'running' ? 'running' : 'queued',
    projectId: record.projectId,
    employeeId: record.employeeId,
    updatedAt: record.updatedAt,
    errorCode: record.error?.code,
  }))
}

export function adaptLiveEvents(records: readonly Record<string, unknown>[]): OfficeEvent[] {
  return records.map((record, index) => ({
    id: typeof record.id === 'string' ? record.id : `${String(record.timestamp ?? 'event')}-${index}`,
    type: typeof record.type === 'string' ? record.type : 'unknown',
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : '',
    employeeId: typeof record.employeeId === 'string' ? record.employeeId : undefined,
    taskId: typeof record.taskId === 'string' ? record.taskId : undefined,
    projectId: typeof record.projectId === 'string' ? record.projectId : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  }))
}

export function adaptRuntimeStatus(records: readonly LiveRuntimeDTO[]): OfficeRuntimeStatus {
  const available = records.some(record => record.available === true && record.readiness?.ready !== false)
  const verified = records.some(record => record.authentication?.verified === true)
  const blockers = [...new Set(records.flatMap(record => [...(record.blockers ?? []), ...(record.readiness?.restrictions ?? [])]))]
  if (!records.length) blockers.push('no_registered_runtime')
  return {
    available,
    kind: records.some(record => record.kind === 'production') ? 'production' : records.length ? 'fake' : 'unknown',
    runtimeId: records.find(record => record.available)?.runtimeId,
    authenticationVerified: verified,
    blockers: [...new Set(blockers)],
    models: [...new Set(records.flatMap(record => record.supportedModels === '*' || !record.supportedModels ? [] : record.supportedModels))],
    label: available ? 'Runtime готов' : 'Runtime недоступен',
  }
}

export function adaptBudgetStatus(status?: LiveStatusDTO, snapshot?: Record<string, unknown>): { status?: string; allowanceStatus?: string; used?: number; limit?: number; currency?: string; label?: string } {
  const budget = status?.budget ?? {}
  const snapshotRecord = snapshot ?? {}
  return {
    status: typeof budget.status === 'string' ? budget.status : typeof snapshotRecord.status === 'string' ? snapshotRecord.status : undefined,
    allowanceStatus: typeof budget.allowanceStatus === 'string' ? budget.allowanceStatus : undefined,
    used: typeof budget.used === 'number' ? budget.used : undefined,
    limit: typeof budget.limit === 'number' ? budget.limit : undefined,
    currency: typeof budget.currency === 'string' ? budget.currency : undefined,
    label: budget.status ? undefined : 'Budget status unavailable',
  }
}

export function completeLiveFloors(departments: readonly LiveDepartmentDTO[], employees: readonly OfficeEmployee[], seatsPerFloor = 12): OfficeFloor[] {
  const departmentFloors = adaptLiveFloors(departments, employees, seatsPerFloor)
  const sharedFloors = [
    { id: 'floor-15', number: 15, departmentId: 'lounge', name: 'Отдых и переговорные', employeeCount: 0, occupiedSeats: 0, availableSeats: seatsPerFloor, state: 'quiet' as const, kind: 'lounge' as const, icon: '☼' },
    { id: 'floor-14', number: 14, departmentId: 'cafe', name: 'Кухня и кафе', employeeCount: 0, occupiedSeats: 0, availableSeats: seatsPerFloor, state: 'quiet' as const, kind: 'cafe' as const, icon: '◒' },
    { id: 'floor-00', number: 0, departmentId: 'lobby', name: 'Lobby · Ресепшен', employeeCount: 0, occupiedSeats: 0, availableSeats: seatsPerFloor, state: 'quiet' as const, kind: 'lobby' as const, icon: '⌂' },
  ]
  return [...sharedFloors.slice(0, 1), ...departmentFloors, ...sharedFloors.slice(1)]
}

export function safeLiveError(error: unknown): string {
  if (error instanceof Error && ['authentication_unavailable', 'server_unavailable', 'endpoint_unavailable', 'invalid_server_response'].includes(error.message)) return error.message
  return 'live_data_unavailable'
}
