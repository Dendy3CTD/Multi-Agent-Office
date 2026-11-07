import type { ReactNode } from 'react'

export type OfficeFloorState = 'active' | 'quiet' | 'busy' | 'paused'
export type OfficeEmployeeStatus = 'active' | 'working' | 'idle' | 'waiting' | 'blocked' | 'disabled' | 'offline' | 'unknown'
export type OfficeTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

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
  modelId?: string
  runtimeId?: string
  currentTask?: string
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
}

export interface OfficeEvent {
  id?: string
  type: string
  timestamp: string
  message?: string
  employeeId?: string
  taskId?: string
  projectId?: string
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
  projects?: readonly OfficeProject[]
  notifications?: readonly OfficeNotification[]
  events?: readonly OfficeEvent[]
  scene?: ReactNode
  /** Diagnostic and layout contract for the active floor renderer. */
  sceneKind?: 'three' | 'svg' | 'connection'
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
}
