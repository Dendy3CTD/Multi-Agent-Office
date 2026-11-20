import type { ReactNode } from 'react'
import type { LiveActiveWorkerDTO, LiveQueuePlanDTO, LiveQueueTaskDTO, QueueAvailability, RoleExecutionStatus } from '../live/types'
import type { ResourceProjection } from '../live/resourceProjection'
import type { EmployeeLiveState } from '../live/employeeLiveState'

export type OfficeFloorState = 'active' | 'quiet' | 'busy' | 'paused'
export type OfficeEmployeeStatus = 'active' | 'working' | 'review' | 'idle' | 'waiting' | 'blocked' | 'error' | 'completed' | 'disabled' | 'offline' | 'unknown'
export type OfficeExecutionStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'REVIEWING' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'UNVERIFIED'
export type OfficeTaskStatus = 'queued' | 'running' | 'review' | 'blocked' | 'completed' | 'failed' | 'cancelled'

export interface OfficeFloor {
  id: string
  number: number
  departmentId: string
  name: string
  employeeCount: number
  occupiedSeats: number
  availableSeats: number
  state: OfficeFloorState
  kind?: 'lobby' | 'department' | 'cafe' | 'lounge'
  icon?: string
  accent?: string
  /** Optional scene-only marker positions for the current floor minimap. */
  mapNodes?: readonly { id: string; x: number; y: number; label?: string }[]
  mapZones?: readonly { id: string; x: number; y: number; width: number; height: number; label?: string }[]
  camera?: { x: number; y: number; zoom: number }
  selectedEmployeePosition?: { x: number; y: number }
}

export interface OfficeEmployee {
  id: string
  name: string
  profession: string
  professionId?: string
  departmentId: string
  floorId: string
  status: OfficeEmployeeStatus
  /** Exact snapshot-backed execution state; the coarse status above stays compatible with the scene adapter. */
  employeeLiveState?: EmployeeLiveState
  /** Exact UI label derived from a fresh authoritative server snapshot. */
  executionStatus?: OfficeExecutionStatus
  modelId?: string
  runtimeId?: string
  currentTask?: string
  currentTaskId?: string
  startedAt?: string
  error?: string
  artifact?: string
  resultSummary?: string
  taskCount?: number
  queue?: readonly OfficeTask[]
  recentEvents?: readonly OfficeEvent[]
  skills?: readonly string[]
  avatar?: string
  seatId?: string
}

export interface OfficeTask {
  id: string
  title: string
  status: OfficeTaskStatus
  projectId?: string
  employeeId?: string
  updatedAt?: string
  errorCode?: string
  officeStatus?: 'IDLE' | 'WORKING' | 'REVIEW' | 'BLOCKED' | 'ERROR' | 'COMPLETED'
  runtimeId?: string
  modelId?: string
  startedAt?: string
  resultSummary?: string
  artifactUrls?: readonly string[]
  subtasks?: readonly OfficeTask[]
  dependencies?: readonly string[]
}

export interface OfficeEvent {
  id?: string
  type: string
  timestamp: string
  message?: string
  employeeId?: string
  taskId?: string
  projectId?: string
  payload?: Readonly<Record<string, unknown>>
}

export interface OfficeRuntimeStatus {
  label?: string
  runtimeId?: string
  kind?: 'fake' | 'production' | string
  available: boolean
  authenticationVerified?: boolean
  blockers?: readonly string[]
  models?: readonly string[]
}

export interface OfficeBudgetStatus {
  label?: string
  status?: string
  allowanceStatus?: string
  used?: number
  limit?: number
  currency?: string
}

export interface OfficeProject {
  id: string
  name: string
  status?: string
  activeTaskCount?: number
  taskCount?: number
}

export interface OfficeNotification {
  id: string
  tone: 'info' | 'success' | 'warning' | 'danger'
  title: string
  message?: string
  timestamp?: string
}

export interface OfficeCameraAction {
  type: 'focus-employee' | 'fit-floor' | 'zoom-in' | 'zoom-out' | 'reset'
  employeeId?: string
  floorId?: string
}

export interface OfficeUIProps {
  floors: readonly OfficeFloor[]
  activeFloorId: string
  onFloorSelect: (floorId: string) => void
  employees: readonly OfficeEmployee[]
  selectedEmployeeId?: string | null
  onEmployeeSelect: (employeeId: string) => void
  onCloseEmployee: () => void
  currentTasks: readonly OfficeTask[]
  runtimeStatus: OfficeRuntimeStatus
  budgetStatus: OfficeBudgetStatus
  resourceData?: ResourceProjection
  projects?: readonly OfficeProject[]
  notifications?: readonly OfficeNotification[]
  events?: readonly OfficeEvent[]
  scene?: ReactNode
  /** Diagnostic and layout contract for the active floor renderer. */
  sceneKind?: 'three' | 'svg' | 'connection'
  floorDesignStatus?: 'authored' | 'fallback'
  floorPresetId?: string
  children?: ReactNode
  onCameraAction?: (action: OfficeCameraAction) => void
  /** Monotonic request counter used by scene hit targets to open the menu. */
  elevatorRequest?: number
  /** Parent scene may switch floors and focus the employee in one atomic interaction. */
  onLocateEmployee?: (employeeId: string, floorId: string) => void
  onAssignTask?: (employeeId: string) => void
  onOpenProfile?: (employeeId: string) => void
  onOpenTask?: (taskId: string) => void
  onShowHistory?: (employeeId: string) => void
  connection?: 'live' | 'loading' | 'stale' | 'disconnected' | 'error' | 'demo'
  connectionError?: string
  pendingFigmaCount?: number
  agentRoles?: readonly { id: string; name: string; specialization?: string; executionStatus: RoleExecutionStatus; executable: boolean; blockers: readonly string[] }[]
  queueTasks?: readonly LiveQueueTaskDTO[]
  activeWorkers?: readonly LiveActiveWorkerDTO[]
  queuePlans?: readonly LiveQueuePlanDTO[]
  queueAvailability?: QueueAvailability
  tasksReadOnly?: boolean
  taskSubmissionEnabled?: boolean
  fixtureMode?: boolean
  onToggleFixture?: () => void
  onCreateTask?: (input: { projectId: string; title: string; brief: string; priority: 'normal' | 'interactive' }) => Promise<void>
  onCancelTask?: (taskId: string) => Promise<void>
  onRefresh?: () => Promise<void>
}
