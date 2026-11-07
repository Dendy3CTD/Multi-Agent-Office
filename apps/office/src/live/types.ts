import type { OfficeBudgetStatus, OfficeEmployee, OfficeEvent, OfficeFloor, OfficeProject, OfficeRuntimeStatus, OfficeTask } from '../office-ui/types'

export type OfficeDataMode = 'demo' | 'loading' | 'live' | 'stale' | 'disconnected' | 'error'

export interface LiveTransport {
  get<T>(path: string, signal: AbortSignal): Promise<T>
}

export interface LiveTransportOptions {
  baseUrl: string
  /** Injected by a trusted host only; never read from localStorage or Vite env. */
  getAuthorizationHeader?: () => string | undefined
}

export interface LiveDepartmentDTO { id: string; name: string; description?: string; status?: string }
export interface LiveProfessionDTO { id: string; name: string; departmentId: string; status?: string }
export interface LiveEmployeeDTO { id: string; displayName: string; professionId: string; departmentId?: string; status?: string; modelDefault?: string; runtimeId?: string; skillReferences?: readonly string[]; skills?: readonly string[]; currentTask?: string; seatId?: string }
export interface LiveTaskDTO { id: string; projectId: string; title: string; status?: string; updatedAt?: string; error?: { code?: string }; employeeId?: string }
export interface LiveRuntimeDTO { runtimeId?: string; kind?: string; available?: boolean; registered?: boolean; authentication?: { verified?: boolean }; readiness?: { ready?: boolean; restrictions?: readonly string[] }; blockers?: readonly string[]; supportedModels?: readonly string[] | '*'; capabilities?: Record<string, unknown> }
export interface LiveStatusDTO { status?: string; budget?: { status?: string; allowanceStatus?: string; used?: number; limit?: number; currency?: string }; runtimes?: number }

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
