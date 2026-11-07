import { useCallback, useEffect, useRef, useState } from 'react'
import { adaptBudgetStatus, adaptLiveEmployees, adaptLiveEvents, adaptLiveFloors, adaptLiveTasks, adaptRuntimeStatus, completeLiveFloors, safeLiveError } from './adapter'
import type { LiveDepartmentDTO, LiveOfficeData, LiveOfficeState, LiveProfessionDTO, LiveRuntimeDTO, LiveStatusDTO, LiveTaskDTO, LiveTransport, LoadLiveOfficeOptions, OfficeDataMode } from './types'

interface Envelope {
  departments?: LiveDepartmentDTO[]
  professions?: LiveProfessionDTO[]
  employees?: Record<string, unknown>[]
  projects?: Record<string, unknown>[]
  runtimes?: LiveRuntimeDTO[]
  events?: Record<string, unknown>[]
  tasks?: LiveTaskDTO[]
}

const emptyData: LiveOfficeData = {
  departments: [], professions: [], employees: [], floors: [], projects: [], tasks: [], events: [],
  runtimeStatus: { available: false, label: 'Runtime недоступен', blockers: ['live_data_unavailable'] },
  budgetStatus: { label: 'Budget status unavailable' },
}

function projectsFrom(records: readonly Record<string, unknown>[]) {
  return records.filter(record => typeof record.id === 'string').map(record => ({ id: String(record.id), name: typeof record.name === 'string' ? record.name : String(record.title ?? record.id), status: typeof record.status === 'string' ? record.status : undefined, activeTaskCount: typeof record.activeTaskCount === 'number' ? record.activeTaskCount : undefined, taskCount: typeof record.taskCount === 'number' ? record.taskCount : undefined }))
}

export async function loadLiveOfficeData(transport: LiveTransport, signal: AbortSignal, options: LoadLiveOfficeOptions = {}): Promise<LiveOfficeData> {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError')
  const [departmentResponse, professionResponse, employeeResponse, projectResponse, statusResponse, runtimeResponse, eventResponse] = await Promise.all([
    transport.get<{ departments: LiveDepartmentDTO[] }>('/v1/departments', signal),
    transport.get<{ professions: LiveProfessionDTO[] }>('/v1/professions', signal),
    transport.get<Envelope>('/v1/employees', signal),
    transport.get<Envelope>('/v1/projects', signal),
    transport.get<LiveStatusDTO>('/v1/status', signal),
    transport.get<{ runtimes: LiveRuntimeDTO[] }>('/v1/runtimes', signal),
    transport.get<Envelope>('/v1/events?limit=100', signal),
  ])
  const departments = departmentResponse.departments ?? []
  const professions = professionResponse.professions ?? []
  const employees = adaptLiveEmployees((employeeResponse.employees ?? []) as never[], professions)
  const floors = completeLiveFloors(departments, employees, options.seatsPerFloor)
  const taskResponses = await Promise.all((options.taskIds ?? []).map(async taskId => {
    try { return await transport.get<{ task: LiveTaskDTO }>(`/v1/tasks/${encodeURIComponent(taskId)}`, signal) } catch { return undefined }
  }))
  const tasks = adaptLiveTasks(taskResponses.flatMap(response => response?.task ? [response.task] : []).concat((employeeResponse as Envelope).tasks ?? []))
  let budgetSnapshot: Record<string, unknown> | undefined
  try { budgetSnapshot = await transport.get<Record<string, unknown>>('/v1/budget/snapshot', signal) } catch { /* status projection remains authoritative */ }
  return {
    departments,
    professions,
    employees,
    floors,
    projects: projectsFrom(projectResponse.projects ?? []),
    tasks,
    events: adaptLiveEvents(eventResponse.events ?? []),
    runtimeStatus: adaptRuntimeStatus(runtimeResponse.runtimes ?? []),
    budgetStatus: adaptBudgetStatus(statusResponse, budgetSnapshot),
  }
}

export interface UseLiveOfficeDataOptions extends LoadLiveOfficeOptions {
  transport?: LiveTransport
  demoData?: LiveOfficeData
  refreshIntervalMs?: number
}

function initialState(options: UseLiveOfficeDataOptions): LiveOfficeState {
  return { ...(options.demoData ?? emptyData), dataMode: options.transport ? 'loading' : 'demo', loading: Boolean(options.transport), refresh: async () => undefined }
}

/** Read-only live data lifecycle. No implicit polling unless explicitly requested. */
export function useLiveOfficeData(options: UseLiveOfficeDataOptions): LiveOfficeState {
  const [state, setState] = useState<LiveOfficeState>(() => initialState(options))
  const controllerRef = useRef<AbortController>()
  const sequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const refresh = useCallback(async () => {
    if (!options.transport) return
    const sequence = ++sequenceRef.current
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState(previous => ({ ...previous, dataMode: previous.employees.length ? 'stale' : 'loading', loading: true, error: undefined }))
    try {
      const data = await loadLiveOfficeData(options.transport, controller.signal, options)
      if (!mountedRef.current || sequence !== sequenceRef.current) return
      setState({ ...data, dataMode: 'live', loading: false, lastUpdatedAt: new Date().toISOString(), refresh })
    } catch (error) {
      if (!mountedRef.current || sequence !== sequenceRef.current || controller.signal.aborted) return
      const message = safeLiveError(error)
      setState(previous => ({ ...previous, dataMode: previous.employees.length ? 'stale' : message === 'server_unavailable' ? 'disconnected' : 'error', loading: false, error: message, refresh }))
    }
  }, [options])

  useEffect(() => {
    mountedRef.current = true
    if (options.transport) void refresh()
    const interval = options.transport && options.refreshIntervalMs && options.refreshIntervalMs >= 15_000 ? window.setInterval(() => void refresh(), options.refreshIntervalMs) : undefined
    return () => { mountedRef.current = false; controllerRef.current?.abort(); if (interval !== undefined) window.clearInterval(interval) }
  }, [refresh, options.transport, options.refreshIntervalMs])

  return { ...state, refresh }
}
