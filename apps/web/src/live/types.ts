import type { OfficeBudgetStatus, OfficeEmployee, OfficeEvent, OfficeFloor, OfficeProject, OfficeRuntimeStatus, OfficeTask } from '../office-ui/types'
import type { ResourceProjection } from './resourceProjection'

export type OfficeDataMode = 'demo' | 'loading' | 'live' | 'stale' | 'disconnected' | 'error'

export interface LiveTransport {
  get<T>(path: string, signal: AbortSignal): Promise<T>
  post?<T>(path: string, body: unknown, options: { signal: AbortSignal; headers?: Readonly<Record<string, string>> }): Promise<T>
}

export interface LiveTransportOptions {
  baseUrl: string
  /** Injected by a trusted host only; never read from localStorage or Vite env. */
  getAuthorizationHeader?: () => string | undefined
}

export interface LiveDepartmentDTO { id: string; name: string; description?: string; status?: string }
export interface LiveProfessionDTO { id: string; name: string; departmentId: string; status?: string }
export interface LiveProjectDTO { id: string; name: string; rootDir: string; status: 'active' | 'paused' | 'archived'; portfolio: { priority: 'low' | 'normal' | 'high' | 'critical'; budgetShare: number; maxConcurrentExecutions: number }; gitRemote?: string; memoryFile?: string }
export interface LiveEmployeeDTO { id: string; displayName: string; professionId: string; departmentId?: string; status?: string; modelDefault?: string; runtimeId?: string; skillReferences?: readonly string[]; skills?: readonly string[]; currentTask?: string; seatId?: string }
export interface LiveTaskDTO { id: string; projectId: string; title: string; status?: string; updatedAt?: string; createdAt?: string; startedAt?: string; error?: { code?: string; message?: string }; employeeId?: string; runtimeId?: string; modelId?: string; result?: unknown; subtasks?: readonly LiveTaskDTO[]; dependencies?: readonly string[]; attempts?: number }
export interface LiveRuntimeDTO { runtimeId?: string; kind?: string; available?: boolean; registered?: boolean; authentication?: { verified?: boolean }; readiness?: { ready?: boolean; restrictions?: readonly string[] }; blockers?: readonly string[]; supportedModels?: readonly string[] | '*'; capabilities?: Record<string, unknown> }
export interface LiveStatusDTO { status?: string; budget?: { status?: string; allowanceStatus?: string; used?: number; limit?: number; currency?: string }; runtimes?: number }
export type RoleExecutionStatus = 'READY' | 'UNVERIFIED' | 'NOT_RUN' | 'BLOCKED'
export interface LiveAgentRoleDTO { id: string; name?: string; specialization?: string; execution?: { status?: string; available?: boolean; blockers?: readonly string[] }; status?: string }
export interface LiveQueueTaskDTO { id: string; taskId?: string; roleId?: string; title?: string; status?: string; attempts?: number; maxAttempts?: number; dependsOn?: readonly string[]; employeeId?: string; subtaskEmployeeId?: string; assignmentEmployeeId?: string; activeWorkerEmployeeId?: string; runtimeId?: string; modelId?: string; timestamp?: string; startedAt?: string; completedAt?: string; errorCode?: string; verification?: 'PASS' | 'FAIL' | 'UNVERIFIED'; artifacts?: readonly { id: string; mediaType?: string; sha256?: string }[] }
export interface LiveActiveWorkerDTO { runtimeId?: string; taskId?: string; subtaskId?: string; roleId?: string; employeeId?: string }
export interface LiveQueuePlanDTO { taskId: string; title?: string; status?: string; subtaskCount: number; completedSubtaskCount: number; artifactCount: number; eventCount: number; verificationStatus: 'PASS' | 'FAIL' | 'NOT_RUN' | 'UNKNOWN'; reviewVerdict?: 'PASS' | 'BLOCKED' }
export type QueueAvailability = 'available' | 'unavailable'

export interface LiveOfficeData {
  departments: readonly LiveDepartmentDTO[]
  professions: readonly LiveProfessionDTO[]
  employees: readonly OfficeEmployee[]
  floors: readonly OfficeFloor[]
  projects: readonly OfficeProject[]
  tasks: readonly OfficeTask[]
  events: readonly OfficeEvent[]
  runtimeStatus: OfficeRuntimeStatus
  budgetStatus: OfficeBudgetStatus
  agentRoles: readonly { id: string; name: string; specialization?: string; executionStatus: RoleExecutionStatus; executable: boolean; blockers: readonly string[] }[]
  queueTasks: readonly LiveQueueTaskDTO[]
  activeWorkers: readonly LiveActiveWorkerDTO[]
  queuePlans: readonly LiveQueuePlanDTO[]
  queueAvailability: QueueAvailability
  resourceData: ResourceProjection
}

export interface LiveOfficeState extends LiveOfficeData {
  dataMode: OfficeDataMode
  loading: boolean
  error?: string
  lastUpdatedAt?: string
  refresh: () => Promise<void>
}

export interface LoadLiveOfficeOptions {
  taskIds?: readonly string[]
  seatsPerFloor?: number
}
