import type { OfficeEmployee, OfficeEmployeeStatus, OfficeTask } from '../office-ui/types'
import type { LiveQueueTaskDTO } from './types'

export type EmployeeLiveStatus = 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'UNVERIFIED' | 'IDLE'
export type EmployeeLiveSource = 'REAL' | 'LOCAL_IDLE'

export interface EmployeeLiveState {
  employeeId: string
  taskId?: string
  subtaskId?: string
  status: EmployeeLiveStatus
  runtimeId?: string
  modelId?: string
  timestamp?: string
  taskTitle?: string
  errorCode?: string
  source: EmployeeLiveSource
}

/** Structural payload for OfficeScene3D.confirmedEmployeeStates. */
export interface SceneEmployeeTaskState {
  employeeId: string
  status: Exclude<EmployeeLiveStatus, 'IDLE'> | 'NOT_RUN'
  confirmed: boolean
}

type RootTask = Pick<OfficeTask, 'id' | 'title' | 'status' | 'employeeId' | 'runtimeId' | 'modelId' | 'startedAt' | 'updatedAt' | 'errorCode'>

function statusFor(value: unknown): EmployeeLiveStatus {
  if (value === 'running' || value === 'working' || value === 'active') return 'RUNNING'
  if (value === 'queued' || value === 'waiting' || value === 'pending') return 'WAITING'
  if (value === 'completed' || value === 'done') return 'COMPLETED'
  if (value === 'failed' || value === 'error') return 'FAILED'
  if (value === 'blocked') return 'BLOCKED'
  return 'UNVERIFIED'
}

function state(employeeId: string, status: EmployeeLiveStatus, source: EmployeeLiveSource, details: Partial<EmployeeLiveState> = {}): EmployeeLiveState {
  return { employeeId, status, source, ...details }
}

/**
 * Projects only explicit server assignments. IDs are opaque: the caller's
 * durable queue/root endpoint establishes entity type, never an ID prefix.
 */
export function projectEmployeeLiveStates(
  employeeIds: readonly string[],
  subtasks: readonly LiveQueueTaskDTO[],
  rootTasks: readonly RootTask[],
  queueSnapshotComplete: boolean,
): Map<string, EmployeeLiveState> {
  const known = new Set(employeeIds)
  const candidates = new Map<string, EmployeeLiveState[]>()
  const conflicts = new Set<string>()
  const add = (candidate: EmployeeLiveState) => {
    const list = candidates.get(candidate.employeeId) ?? []
    list.push(candidate)
    candidates.set(candidate.employeeId, list)
  }

  for (const subtask of subtasks) {
    const explicitEmployee = subtask.subtaskEmployeeId ?? subtask.employeeId
    const assignmentEmployee = subtask.assignmentEmployeeId
    const activeEmployee = subtask.activeWorkerEmployeeId
    const assignments = [explicitEmployee, assignmentEmployee, activeEmployee].filter((id): id is string => Boolean(id))
    if (new Set(assignments).size > 1) {
      for (const employeeId of assignments) if (known.has(employeeId)) conflicts.add(employeeId)
      continue
    }
    const employeeId = explicitEmployee ?? assignmentEmployee
    if (!employeeId || !known.has(employeeId)) continue
    add(state(employeeId, statusFor(subtask.status), 'REAL', {
      taskId: subtask.taskId,
      subtaskId: subtask.id,
      ...(subtask.runtimeId ? { runtimeId: subtask.runtimeId } : {}),
      ...(subtask.modelId ? { modelId: subtask.modelId } : {}),
      ...(subtask.timestamp ? { timestamp: subtask.timestamp } : subtask.startedAt ? { timestamp: subtask.startedAt } : subtask.completedAt ? { timestamp: subtask.completedAt } : {}),
      ...(subtask.title ? { taskTitle: subtask.title } : {}),
      ...(subtask.errorCode ? { errorCode: subtask.errorCode } : {}),
    }))
  }

  for (const task of rootTasks) {
    if (!task.employeeId || !known.has(task.employeeId)) continue
    add(state(task.employeeId, statusFor(task.status), 'REAL', {
      taskId: task.id,
      ...(task.runtimeId ? { runtimeId: task.runtimeId } : {}),
      ...(task.modelId ? { modelId: task.modelId } : {}),
      ...(task.startedAt ? { timestamp: task.startedAt } : task.updatedAt ? { timestamp: task.updatedAt } : {}),
      ...(task.title ? { taskTitle: task.title } : {}),
      ...(task.errorCode ? { errorCode: task.errorCode } : {}),
    }))
  }

  const output = new Map<string, EmployeeLiveState>()
  for (const employeeId of employeeIds) {
    const matches = candidates.get(employeeId) ?? []
    if (conflicts.has(employeeId)) {
      output.set(employeeId, state(employeeId, 'UNVERIFIED', 'REAL'))
      continue
    }
    if (!matches.length) {
      output.set(employeeId, queueSnapshotComplete ? state(employeeId, 'IDLE', 'LOCAL_IDLE') : state(employeeId, 'UNVERIFIED', 'REAL'))
      continue
    }
    const activity = matches.filter(item => item.status === 'RUNNING' || item.status === 'WAITING')
    if (activity.length) {
      const selected = [...activity].sort((a, b) => Number(b.status === 'RUNNING') - Number(a.status === 'RUNNING'))[0]
      output.set(employeeId, selected)
      continue
    }
    if (matches.length === 1) {
      output.set(employeeId, matches[0])
      continue
    }
    const timestamped = matches.filter(item => item.timestamp && Number.isFinite(Date.parse(item.timestamp))).sort((a, b) => Date.parse(b.timestamp!) - Date.parse(a.timestamp!))
    const latest = timestamped[0]
    const tied = latest && timestamped[1] && Date.parse(latest.timestamp!) === Date.parse(timestamped[1].timestamp!)
    output.set(employeeId, latest && !tied ? latest : state(employeeId, 'UNVERIFIED', 'REAL'))
  }
  return output
}

/** Safe coarse status for the existing world adapter, which owns animation. */
export function sceneStatusForEmployeeLiveState(liveState: EmployeeLiveState): 'working' | 'blocked' | 'idle' {
  if (liveState.status === 'RUNNING') return 'working'
  if (liveState.status === 'FAILED' || liveState.status === 'BLOCKED') return 'blocked'
  return 'idle'
}

/** Adapter for the current GFX public prop; consumers still own scene wiring. */
export function confirmedEmployeeStatesForScene(employees: readonly Pick<OfficeEmployee, 'id' | 'employeeLiveState'>[]): SceneEmployeeTaskState[] {
  return employees.map(employee => {
    const liveState = employee.employeeLiveState
    if (!liveState || liveState.source !== 'REAL') return { employeeId: employee.id, status: 'NOT_RUN', confirmed: false }
    if (liveState.status === 'IDLE') return { employeeId: employee.id, status: 'NOT_RUN', confirmed: false }
    return { employeeId: employee.id, status: liveState.status, confirmed: liveState.status !== 'UNVERIFIED' }
  })
}

export function confirmedSceneStatesForConnection(
  employees: readonly Pick<OfficeEmployee, 'id' | 'employeeLiveState'>[],
  connection: 'live' | 'loading' | 'stale' | 'disconnected' | 'error' | 'demo',
): SceneEmployeeTaskState[] {
  return connection === 'live' ? confirmedEmployeeStatesForScene(employees) : []
}

/** Clears current execution claims while a newer authoritative snapshot is unavailable. */
export function markEmployeeLiveStatesStale(employees: readonly OfficeEmployee[]): OfficeEmployee[] {
  return employees.map(employee => {
    if (!employee.employeeLiveState) return employee
    return {
      ...employee,
      employeeLiveState: { employeeId: employee.id, status: 'UNVERIFIED', source: employee.employeeLiveState.source },
      currentTask: undefined,
      currentTaskId: undefined,
      startedAt: undefined,
      runtimeId: undefined,
      modelId: undefined,
      error: undefined,
      artifact: undefined,
      resultSummary: undefined,
      taskCount: 0,
    }
  })
}

export function officeStatusForEmployeeLiveState(liveState: EmployeeLiveState): OfficeEmployeeStatus {
  switch (liveState.status) {
    case 'RUNNING': return 'working'
    case 'WAITING': return 'waiting'
    case 'COMPLETED': return 'completed'
    case 'FAILED': return 'error'
    case 'BLOCKED': return 'blocked'
    case 'UNVERIFIED': return 'unknown'
    case 'IDLE': return 'idle'
  }
}

export function applyEmployeeLiveStates(employees: readonly OfficeEmployee[], states: ReadonlyMap<string, EmployeeLiveState>, tasks: readonly OfficeTask[]): OfficeEmployee[] {
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  return employees.map(employee => {
    const liveState = states.get(employee.id)
    if (!liveState) return employee
    const rootTask = liveState.taskId ? tasksById.get(liveState.taskId) : undefined
    const liveTaskTitle = liveState.subtaskId ? liveState.taskTitle : rootTask?.title ?? liveState.taskTitle
    const isActive = liveState.status === 'RUNNING' || liveState.status === 'WAITING'
    return {
      ...employee,
      employeeLiveState: liveState,
      currentTask: isActive ? liveTaskTitle : undefined,
      currentTaskId: isActive ? liveState.taskId : undefined,
      startedAt: liveState.status === 'RUNNING' ? liveState.timestamp : undefined,
      runtimeId: liveState.runtimeId,
      modelId: liveState.modelId,
      error: liveState.status === 'FAILED' || liveState.status === 'BLOCKED' ? liveState.errorCode : undefined,
      taskCount: tasks.filter(task => task.employeeId === employee.id).length,
      queue: tasks.filter(task => task.employeeId === employee.id),
    }
  })
}
