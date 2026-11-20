import { useCallback, useEffect, useRef, useState } from 'react'
import type { OfficeTask } from '../office-ui/types'
import { adaptBudgetStatus, adaptLiveEmployees, adaptLiveEvents, adaptLiveFloors, adaptLiveTasks, adaptRuntimeStatus, completeLiveFloors, safeLiveError } from './adapter'
import type { LiveActiveWorkerDTO, LiveAgentRoleDTO, LiveDepartmentDTO, LiveOfficeData, LiveOfficeState, LiveProfessionDTO, LiveProjectDTO, LiveQueueTaskDTO, LiveRuntimeDTO, LiveStatusDTO, LiveTaskDTO, LiveTransport, LoadLiveOfficeOptions, RoleExecutionStatus } from './types'
import { subscribeToLiveEvents, type LiveEventSource } from './eventStream'
import { projectResources } from './resourceProjection'
import { applyEmployeeLiveStates, markEmployeeLiveStatesStale, projectEmployeeLiveStates } from './employeeLiveState'

interface Envelope {
  departments?: LiveDepartmentDTO[]
  professions?: LiveProfessionDTO[]
  employees?: Record<string, unknown>[]
  projects?: LiveProjectDTO[]
  runtimes?: LiveRuntimeDTO[]
  events?: Record<string, unknown>[]
  tasks?: LiveTaskDTO[]
  roles?: LiveAgentRoleDTO[]
  workers?: LiveActiveWorkerDTO[]
  queueTasks?: LiveQueueTaskDTO[]
}

const emptyData: LiveOfficeData = {
  departments: [], professions: [], employees: [], floors: [], projects: [], tasks: [], events: [],
  runtimeStatus: { available: false, label: 'Runtime недоступен', blockers: ['live_data_unavailable'] },
  budgetStatus: { label: 'Budget status unavailable' }, agentRoles: [], queueTasks: [], activeWorkers: [], queuePlans: [], queueAvailability: 'unavailable',
  resourceData: { runtimes: [], models: [], allowanceLabel: 'Нет данных', runningProcessCount: undefined, maxActiveLlm: 2 },
}

function projectsFrom(records: readonly LiveProjectDTO[]) {
  return records.filter(record => typeof record.id === 'string' && typeof record.name === 'string').map(record => ({ id: record.id, name: record.name, status: record.status }))
}

export async function loadLiveOfficeData(transport: LiveTransport, signal: AbortSignal, options: LoadLiveOfficeOptions = {}): Promise<LiveOfficeData> {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError')
  // MAO Hybrid API contract. Do not call the legacy MAO Server `/v1` routes.
  const [statusResponse, employeeResponse, projectResponse, taskResponse] = await Promise.all([
    transport.get<{ status: string; runtimeAvailable: boolean; projectCount: number; taskCount: number; activeExecutions: number; maxConcurrent: number }>('/api/status', signal),
    transport.get<{ employees: Array<{ id: string; displayName: string; professionId: string; departmentId?: string; status?: string; modelDefault?: string; specialization?: string; skills?: string[] }> }>('/api/employees', signal),
    transport.get<{ projects: Array<{ id: string; name: string; workspaceRoot?: string }> }>('/api/projects', signal),
    transport.get<{ tasks: Array<{ task: LiveTaskDTO; steps: Array<{ id: string; title: string; status: string; employeeId: string; result?: unknown; error?: string }>; events?: Array<Record<string, unknown>> }> }>('/api/tasks', signal),
  ])
  const rawEmployees = employeeResponse.employees ?? []
  const runtimeResponse = { runtimes: [{ runtimeId: 'codex', kind: 'production', available: statusResponse.runtimeAvailable }] }
  const departmentIds = [...new Set(rawEmployees.map(employee => employee.departmentId ?? 'company'))]
  const departments = departmentIds.map(id => ({ id, name: id === 'company' ? 'MAO Hybrid' : id }))
  const professions = [...new Map(rawEmployees.map(employee => [employee.professionId, { id: employee.professionId, name: employee.specialization ?? employee.professionId, departmentId: employee.departmentId ?? 'company' }])).values()]
  let employees = adaptLiveEmployees(rawEmployees as never[], professions)
  const records = taskResponse.tasks ?? []
  const rawEvents = records.flatMap(record => (record.events ?? []).map(event => ({ ...event, taskId: record.task.id })))
  const roleResponse: { roles?: LiveAgentRoleDTO[] } = { roles: [] }
  const queueResponse: { tasks?: { id: string; projectId?: string; goal?: string; status?: string }[] } = { tasks: [] }
  const activeResponse: { workers?: LiveActiveWorkerDTO[] } = { workers: [] }
  const queueRoots = (queueResponse?.tasks ?? []).slice(0, 24)
  const planDetails: { root: { id: string; projectId?: string; goal?: string; status?: string }; detail: Record<string, unknown> | undefined }[] = []
  // Event taskId values can be runtime execution IDs that have no /v1/tasks
  // detail. Only the task registry provides primary IDs; graph child IDs stay
  // sourced from durable queue details and are never sent to /v1/tasks.
  const durableSubtaskIds = new Set(planDetails.flatMap(({ detail }) => {
    const subtasks = Array.isArray(detail?.subtasks) ? detail.subtasks : []
    return subtasks.flatMap(item => item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' ? [item.id] : [])
  }))
  const taskIds = [...new Set([...(options.taskIds ?? []), ...records.map(record => record.task.id)])]
    .filter(id => !durableSubtaskIds.has(id))
    .slice(0, 24)
  const taskResponses = await Promise.all(taskIds.map(async taskId => {
    try {
      const response = records.find(record => record.task.id === taskId)
      if (!response) return undefined
      const step = response.steps?.[0]
      const stepResult = step?.result && typeof step.result === 'object' ? step.result as Record<string, unknown> : undefined
      const taskResult = response.task.result
      const result = step?.result ?? taskResult
      const toolCalls = Array.isArray(stepResult?.toolCalls) ? stepResult.toolCalls : Array.isArray(response.task.toolCalls) ? response.task.toolCalls : []
      return { ...response.task, employeeId: step?.employeeId, result, toolCalls, error: step?.error ? { message: step.error } : response.task.error }
    } catch { return undefined }
  }))
  const fetchedTasks: LiveTaskDTO[] = taskResponses.filter((task): task is NonNullable<typeof task> => task !== undefined)
  const tasks = adaptLiveTasks(fetchedTasks)
  const events = adaptLiveEvents(rawEvents)
  employees = employees.map(employee => ({ ...employee, recentEvents: events.filter(event => event.employeeId === employee.id).slice(0, 20) }))
  const budgetSnapshot: Record<string, unknown> | undefined = undefined
  const queueTasks: LiveQueueTaskDTO[] = planDetails.flatMap(({ root, detail }) => {
    const subtasks = Array.isArray(detail?.subtasks) ? detail.subtasks : []
    return subtasks.flatMap(value => {
      if (!value || typeof value !== 'object') return []
      const subtask = value as Record<string, unknown>
      if (typeof subtask.id !== 'string') return []
      const assignments = Array.isArray(detail?.assignments) ? detail.assignments as Record<string, unknown>[] : []
      const assignment = assignments.find(item => item && item.subtaskId === subtask.id)
      const activeWorker = activeResponse?.workers?.find(worker => worker.subtaskId === subtask.id && worker.taskId === root.id)
      const subtaskEmployeeId = typeof subtask.employeeId === 'string' ? subtask.employeeId : undefined
      const assignmentEmployeeId = typeof assignment?.employeeId === 'string' ? assignment.employeeId : undefined
      const queueEvents = Array.isArray(detail?.events) ? detail.events as Record<string, unknown>[] : []
      const statusEventTypes: Record<string, string[]> = {
        running: ['subtask_started', 'execution_recovered'], queued: ['retry_scheduled'], completed: ['subtask_completed'], failed: ['subtask_failed', 'execution_recovery_failed'], blocked: ['subtask_blocked'],
      }
      const expectedEventTypes = statusEventTypes[String(subtask.status)] ?? []
      const stateEvent = queueEvents.filter(item => item && item.subtaskId === subtask.id && expectedEventTypes.includes(String(item.type)) && typeof item.createdAt === 'string').slice(-1)[0]
      return [{
        id: subtask.id,
        taskId: root.id,
        roleId: typeof subtask.roleId === 'string' ? subtask.roleId : undefined,
        title: typeof subtask.title === 'string' ? subtask.title : undefined,
        status: typeof subtask.status === 'string' ? subtask.status : undefined,
        attempts: typeof subtask.attempts === 'number' ? subtask.attempts : undefined,
        maxAttempts: typeof subtask.maxAttempts === 'number' ? subtask.maxAttempts : undefined,
        dependsOn: Array.isArray(subtask.dependsOn) ? subtask.dependsOn.filter((id): id is string => typeof id === 'string').slice(0, 40) : undefined,
        employeeId: subtaskEmployeeId ?? assignmentEmployeeId,
        subtaskEmployeeId,
        assignmentEmployeeId,
        activeWorkerEmployeeId: activeWorker?.employeeId,
        runtimeId: typeof subtask.runtimeId === 'string' ? subtask.runtimeId : activeWorker?.runtimeId,
        modelId: typeof subtask.modelId === 'string' ? subtask.modelId : undefined,
        startedAt: typeof subtask.startedAt === 'string' ? subtask.startedAt : undefined,
        timestamp: typeof stateEvent?.createdAt === 'string' ? stateEvent.createdAt : undefined,
        completedAt: typeof subtask.completedAt === 'string' ? subtask.completedAt : undefined,
        errorCode: subtask.error && typeof subtask.error === 'object' && 'code' in subtask.error && typeof (subtask.error as { code?: unknown }).code === 'string' ? (subtask.error as { code: string }).code : undefined,
        verification: (() => {
          const checks = Array.isArray(detail?.verifications) ? detail.verifications as Record<string, unknown>[] : []
          const verification = checks.find(item => item && item.subtaskId === subtask.id)
          if (!verification) return undefined
          return verification.passed === true ? 'PASS' as const : verification.passed === false ? 'FAIL' as const : 'UNVERIFIED' as const
        })(),
        artifacts: (() => {
          const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts as Record<string, unknown>[] : []
          return artifacts.filter(item => item && item.subtaskId === subtask.id && (typeof item.id === 'string' || typeof item.id === 'number')).slice(0, 20).map(item => ({ id: String(item.id), ...(typeof item.mediaType === 'string' ? { mediaType: item.mediaType } : {}), ...(typeof item.sha256 === 'string' ? { sha256: item.sha256 } : {}) }))
        })(),
      }]
    })
  })
  const queueSnapshotComplete = Boolean(queueResponse && (queueResponse.tasks?.length ?? 0) <= 24 && planDetails.every(item => item.detail !== undefined))
  const fetchedRootTasks = tasks.filter(task => taskIds.includes(task.id))
  const liveStates = projectEmployeeLiveStates(employees.map(employee => employee.id), queueTasks, fetchedRootTasks, queueSnapshotComplete)
  employees = applyEmployeeLiveStates(employees, liveStates, tasks).map(employee => {
    const task = liveStates.get(employee.id)?.taskId ? tasks.find(item => item.id === liveStates.get(employee.id)?.taskId) : undefined
    return { ...employee, artifact: task?.artifactUrls?.[0], resultSummary: task?.resultSummary }
  })
  const floors = completeLiveFloors(departments, employees, options.seatsPerFloor)
  const queuePlans = planDetails.flatMap(({ root, detail }) => {
    if (!detail) return []
    const subtasks = Array.isArray(detail?.subtasks) ? detail.subtasks : []
    const artifacts = Array.isArray(detail?.artifacts) ? detail.artifacts : []
    const events = Array.isArray(detail?.events) ? detail.events : []
    const verifications = Array.isArray(detail?.verifications) ? detail.verifications : []
    const completedSubtaskCount = subtasks.filter(item => item && typeof item === 'object' && 'status' in item && item.status === 'completed').length
    const passed = verifications.length > 0 && verifications.every(item => item && typeof item === 'object' && 'passed' in item && item.passed === true)
    const failed = verifications.some(item => item && typeof item === 'object' && 'passed' in item && item.passed === false)
    const verificationStatus = passed ? 'PASS' : failed ? 'FAIL' : verifications.length ? 'UNKNOWN' : 'NOT_RUN'
    const reviewer = subtasks.find(item => item && typeof item === 'object' && 'title' in item && typeof item.title === 'string' && item.title.startsWith('Review:')) as Record<string, unknown> | undefined
    const reviewerVerification = reviewer && typeof reviewer.id === 'string'
      ? verifications.find(item => item && typeof item === 'object' && 'subtaskId' in item && item.subtaskId === reviewer.id)
      : undefined
    const reviewerChecks = reviewerVerification && typeof reviewerVerification === 'object' && 'checks' in reviewerVerification && Array.isArray(reviewerVerification.checks)
      ? reviewerVerification.checks
      : []
    const reviewCheck = reviewerChecks.find((item: unknown) => item && typeof item === 'object' && 'id' in item && item.id === 'review_verdict') as Record<string, unknown> | undefined
    const reviewVerdict: 'PASS' | 'BLOCKED' | undefined = reviewCheck?.passed === true ? 'PASS' : reviewCheck?.passed === false ? 'BLOCKED' : undefined
    const task = detail.task && typeof detail.task === 'object' ? detail.task as Record<string, unknown> : {}
    return [{ taskId: root.id, title: typeof task.title === 'string' ? task.title : undefined, status: typeof task.status === 'string' ? task.status : root.status, subtaskCount: subtasks.length, completedSubtaskCount, artifactCount: artifacts.length, eventCount: events.length, verificationStatus, ...(reviewVerdict ? { reviewVerdict } : {}) } as const]
  })
  const agentRoles = (roleResponse?.roles ?? []).map(role => {
    const rawStatus = role.execution?.status ?? role.status
    const executionStatus: RoleExecutionStatus = rawStatus === 'READY' || rawStatus === 'PASSED' ? 'READY' : rawStatus === 'NOT_RUN' ? 'NOT_RUN' : rawStatus === 'BLOCKED' || rawStatus === 'FAILED' || rawStatus === 'UNAVAILABLE' ? 'BLOCKED' : 'UNVERIFIED'
    const executable = executionStatus === 'READY'
    return { id: role.id, name: role.name ?? role.id, specialization: role.specialization, executionStatus, executable, blockers: (role.execution?.blockers ?? []).filter(item => typeof item === 'string').slice(0, 12) }
  })
  return {
    departments,
    professions,
    employees,
    floors,
    projects: (projectResponse.projects ?? []).map(project => ({ id: project.id, name: project.name, status: 'active' as const })),
    tasks,
    events,
    runtimeStatus: { available: statusResponse.runtimeAvailable, label: statusResponse.runtimeAvailable ? 'Codex Runtime готов' : 'Codex Runtime недоступен', kind: 'production', blockers: statusResponse.runtimeAvailable ? [] : ['runtime_unavailable'] },
    budgetStatus: adaptBudgetStatus(statusResponse, budgetSnapshot),
    agentRoles,
    queueTasks,
    activeWorkers: (activeResponse?.workers ?? []).map(worker => ({ runtimeId: worker.runtimeId, taskId: worker.taskId, subtaskId: worker.subtaskId, roleId: worker.roleId, employeeId: worker.employeeId })),
    queuePlans,
    queueAvailability: roleResponse && queueResponse && activeResponse && planDetails.every(item => item.detail !== undefined) ? 'available' : 'unavailable',
    resourceData: projectResources({ runtimes: runtimeResponse.runtimes }),
  }
}

export interface UseLiveOfficeDataOptions extends LoadLiveOfficeOptions {
  transport?: LiveTransport
  demoData?: LiveOfficeData
  refreshIntervalMs?: number
  eventStreamUrl?: string
}

export function startLiveOfficeSynchronization(
  refresh: () => void,
  refreshIntervalMs?: number,
  eventStreamUrl?: string,
  createEventSource?: (url: string) => LiveEventSource,
): () => void {
  const interval = refreshIntervalMs && refreshIntervalMs >= 15_000 ? setInterval(refresh, refreshIntervalMs) : undefined
  const unsubscribe = eventStreamUrl
    ? subscribeToLiveEvents(eventStreamUrl, refresh, createEventSource)
    : undefined
  return () => {
    if (interval !== undefined) clearInterval(interval)
    unsubscribe?.()
  }
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
    setState(previous => ({ ...previous, employees: markEmployeeLiveStatesStale(previous.employees), dataMode: previous.employees.length ? 'stale' : 'loading', loading: true, error: undefined }))
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
    const stopSynchronization = options.transport
      ? startLiveOfficeSynchronization(() => void refresh(), options.refreshIntervalMs, options.eventStreamUrl)
      : undefined
    return () => { mountedRef.current = false; controllerRef.current?.abort(); stopSynchronization?.() }
  }, [refresh, options.transport, options.refreshIntervalMs, options.eventStreamUrl])

  return { ...state, refresh }
}
