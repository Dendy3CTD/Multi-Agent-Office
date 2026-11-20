import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './agent-terminal.css'

const API = '/mao-api'
const TASK_REFRESH_MS = 12_000

type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'needs_review' | string
interface Project { id: string; name: string; status?: string }
interface Employee { id: string; displayName: string; professionId?: string; status?: string }
interface Step {
  id: string; title: string; roleId?: string; employeeId?: string; status: TaskStatus
  dependsOn?: string[]; result?: unknown; error?: string; executionId?: string; attempts?: number
  startedAt?: string; completedAt?: string; createdAt?: string
}
interface Task {
  id: string; projectId: string; title: string; brief?: string; status: TaskStatus; createdAt?: string; updatedAt?: string
  startedAt?: string; completedAt?: string; employeeId?: string; result?: unknown; error?: string
  steps: Step[]; events?: RuntimeEvent[]
}
interface RuntimeEvent {
  id: number | string; taskId: string; executionId?: string; occurredAt?: string; timestamp?: string; type: string
  data?: Record<string, unknown>
}
interface ApiStatus { status?: string; runtimeAvailable?: boolean; projectCount?: number; taskCount?: number; activeExecutions?: number; maxConcurrent?: number }
interface Tool { id: string; name?: string; description?: string; capabilities?: string[] }
interface Snapshot { status?: ApiStatus; projects: Project[]; employees: Employee[]; tasks: Task[]; tools: Tool[]; loadedAt?: number }

const EMPTY: Snapshot = { projects: [], employees: [], tasks: [], tools: [] }

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { accept: 'application/json' }, cache: 'no-store', signal })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: { code?: string } } | undefined
    throw new Error(body?.error?.code || `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

function asTask(value: unknown): Task | undefined {
  if (!value || typeof value !== 'object') return undefined
  const outer = value as Record<string, unknown>
  const raw = outer.task && typeof outer.task === 'object' ? outer.task as Record<string, unknown> : outer
  if (typeof raw.id !== 'string' || typeof raw.projectId !== 'string' || typeof raw.title !== 'string') return undefined
  const steps = Array.isArray(outer.steps) ? outer.steps.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const step = value as Record<string, unknown>
    if (typeof step.id !== 'string') return []
    return [{
      id: step.id, title: typeof step.title === 'string' ? step.title : step.id,
      roleId: stringOrUndefined(step.roleId), employeeId: stringOrUndefined(step.employeeId),
      status: typeof step.status === 'string' ? step.status : 'unknown',
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.filter((item): item is string => typeof item === 'string') : [],
      result: step.result, error: stringOrUndefined(step.error), executionId: stringOrUndefined(step.executionId),
      attempts: typeof step.attempts === 'number' ? step.attempts : undefined,
      startedAt: stringOrUndefined(step.startedAt), completedAt: stringOrUndefined(step.completedAt), createdAt: stringOrUndefined(step.createdAt),
    }]
  }) : []
  const events = Array.isArray(outer.events) ? outer.events.flatMap((event, index) => normalizeEvent(event, raw.id as string, index)) : []
  return {
    id: raw.id, projectId: raw.projectId, title: raw.title,
    brief: stringOrUndefined(raw.brief), status: typeof raw.status === 'string' ? raw.status : 'unknown',
    createdAt: stringOrUndefined(raw.createdAt), updatedAt: stringOrUndefined(raw.updatedAt),
    startedAt: stringOrUndefined(raw.startedAt), completedAt: stringOrUndefined(raw.completedAt),
    employeeId: stringOrUndefined(raw.employeeId), result: raw.result, error: stringOrUndefined(raw.error), steps, events,
  }
}

function normalizeEvent(value: unknown, taskId: string, index: number): RuntimeEvent[] {
  if (!value || typeof value !== 'object') return []
  const event = value as Record<string, unknown>
  const rawData = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {}
  const nestedData = rawData.data && typeof rawData.data === 'object' && !Array.isArray(rawData.data) ? rawData.data as Record<string, unknown> : undefined
  const data = nestedData ? { ...rawData, ...nestedData } : rawData
  return [{
    id: typeof event.id === 'string' || typeof event.id === 'number' ? event.id : `${taskId}-${index}`,
    taskId, executionId: stringOrUndefined(event.executionId),
    occurredAt: stringOrUndefined(event.occurredAt) ?? stringOrUndefined(event.timestamp) ?? stringOrUndefined(event.createdAt),
    type: typeof event.type === 'string' ? event.type : 'unknown', data,
  }]
}

function stringOrUndefined(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }

function decodeSseBlock(block: string, fallbackTaskId: string): RuntimeEvent | undefined {
  const lines = block.split(/\r?\n/)
  const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
  if (!data) return undefined
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>
    return normalizeEvent(parsed, fallbackTaskId, 0)[0]
  } catch { return undefined }
}

function safeDisplay(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[ограниченная глубина]'
  if (Array.isArray(value)) return value.slice(0, 80).map(item => safeDisplay(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [
      key, /password|secret|token|api[_-]?key|authorization|credential/i.test(key) ? '[скрыто]' : safeDisplay(item, depth + 1),
    ]))
  }
  if (typeof value === 'string') {
    return value.replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[закрытый ключ скрыт]')
      .replace(/\b(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, 'Bearer [скрыто]')
      .replace(/\b(password|secret|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[скрыто]')
      .replace(/(?:\/home\/[^\s"']+|\/Users\/[^\s"']+|[A-Z]:\\[^\s"']+)/g, '[локальный путь скрыт]')
      .slice(0, 16_000)
  }
  return value
}

function pretty(value: unknown): string { return typeof value === 'string' ? String(safeDisplay(value)) : JSON.stringify(safeDisplay(value), null, 2) ?? String(value) }
function dateTime(value?: string): string { if (!value) return 'Время недоступно'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Время недоступно' : date.toLocaleString() }
function elapsed(value?: string): string {
  if (!value) return 'Длительность неизвестна'
  const start = Date.parse(value)
  if (!Number.isFinite(start)) return 'Длительность неизвестна'
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000))
  return seconds < 60 ? `${seconds} сек.` : `${Math.floor(seconds / 60)} мин. ${seconds % 60} сек.`
}
function taskLabel(status: string): string {
  const labels: Record<string, string> = { queued: 'В очереди', running: 'Выполняется', completed: 'Завершена', failed: 'Ошибка', needs_review: 'Нужна проверка' }
  return labels[status] ?? `Неизвестно: ${status}`
}
function eventTitle(event: RuntimeEvent): string {
  const labels: Record<string, string> = {
    'task.created': 'Задача создана', 'task.queued': 'Задача поставлена в очередь', 'step.started': 'Начался этап',
    'step.completed': 'Этап завершён', 'step.failed': 'Ошибка этапа', 'tools.available': 'Доступны инструменты',
    'tools.unavailable': 'Инструменты недоступны', 'tool.started': 'Вызов инструмента', 'tool.completed': 'Результат инструмента',
    'tool.failed': 'Ошибка инструмента', 'tool.rejected': 'Вызов отклонён', 'assistant.message': 'Сообщение агента',
  }
  return labels[event.type] ?? event.type
}
function eventDescription(event: RuntimeEvent): string {
  const data = event.data ?? {}
  const toolName = data.toolName ?? data.toolId
  if (typeof toolName === 'string') return `${typeof data.server === 'string' ? `${data.server} · ` : ''}${toolName}`
  if (typeof data.message === 'string') return String(safeDisplay(data.message))
  if (typeof data.error === 'string') return String(safeDisplay(data.error))
  return ''
}
function isTerminal(status: string): boolean { return ['completed', 'failed', 'needs_review'].includes(status) }
function artifactEntries(value: unknown, source: string): { id: string; label: string; href?: string; value: unknown }[] {
  if (!value || typeof value !== 'object' || !('artifacts' in value) || !Array.isArray((value as { artifacts?: unknown }).artifacts)) return []
  return ((value as { artifacts: unknown[] }).artifacts).slice(0, 40).map((artifact, index) => {
    const record = artifact && typeof artifact === 'object' ? artifact as Record<string, unknown> : {}
    const rawHref = [record.url, record.href, record.link].find(item => typeof item === 'string') as string | undefined
    let href: string | undefined
    try { const parsed = rawHref ? new URL(rawHref) : undefined; if (parsed && ['http:', 'https:'].includes(parsed.protocol)) href = parsed.toString() } catch { /* A non-URL artifact reference stays informational. */ }
    const label = [record.name, record.filename, record.title, record.id].find(item => typeof item === 'string') as string | undefined
    return { id: `${source}-${index}`, label: label ?? `${source} · артефакт ${index + 1}`, ...(href ? { href } : {}), value: artifact }
  })
}

export default function AgentTerminal() {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [apiError, setApiError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [taskDetail, setTaskDetail] = useState<Task>()
  const [detailError, setDetailError] = useState<string>()
  const [events, setEvents] = useState<RuntimeEvent[]>([])
  const [eventError, setEventError] = useState<string>()
  const [search, setSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [submissionError, setSubmissionError] = useState<string>()
  const [submissionMessage, setSubmissionMessage] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [idempotency, setIdempotency] = useState<{ signature: string; key: string }>()
  const eventEndRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [status, projects, employees, taskResponse, tools] = await Promise.all([
        apiGet<ApiStatus>('/api/status', signal), apiGet<{ projects: Project[] }>('/api/projects', signal),
        apiGet<{ employees: Employee[] }>('/api/employees', signal), apiGet<{ tasks: unknown[] }>('/api/tasks', signal),
        apiGet<{ tools: Tool[] }>('/api/tools', signal),
      ])
      const tasks = (taskResponse.tasks ?? []).flatMap(value => { const task = asTask(value); return task ? [task] : [] })
      setSnapshot({ status, projects: projects.projects ?? [], employees: employees.employees ?? [], tasks, tools: tools.tools ?? [], loadedAt: Date.now() })
      setApiError(undefined)
      setLoading(false)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setApiError(error instanceof Error ? error.message : 'API недоступен')
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const poll = window.setInterval(() => void refresh(), TASK_REFRESH_MS)
    return () => { controller.abort(); window.clearInterval(poll) }
  }, [refresh])

  const projectTasks = useMemo(() => selectedProjectId ? snapshot.tasks.filter(task => task.projectId === selectedProjectId) : snapshot.tasks, [selectedProjectId, snapshot.tasks])
  const activeTasks = projectTasks.filter(task => ['queued', 'running'].includes(task.status))
  const historyTasks = projectTasks.filter(task => !['queued', 'running'].includes(task.status))
  const selectedTask = taskDetail?.id === selectedTaskId ? taskDetail : projectTasks.find(task => task.id === selectedTaskId)
  const selectedProject = snapshot.projects.find(project => project.id === selectedProjectId)

  useEffect(() => {
    if (!snapshot.projects.length) { setSelectedProjectId(''); return }
    if (!snapshot.projects.some(project => project.id === selectedProjectId)) setSelectedProjectId(snapshot.projects[0]!.id)
  }, [snapshot.projects, selectedProjectId])
  useEffect(() => {
    const preferred = projectTasks.find(task => task.status === 'running') ?? projectTasks.find(task => task.status === 'queued') ?? projectTasks[0]
    if (!selectedTaskId || !projectTasks.some(task => task.id === selectedTaskId)) setSelectedTaskId(preferred?.id ?? '')
  }, [projectTasks, selectedTaskId])

  useEffect(() => {
    if (!selectedTaskId) { setTaskDetail(undefined); setEvents([]); return }
    let disposed = false
    const controller = new AbortController()
    setDetailError(undefined)
    setEventError(undefined)
    setEvents([])
    const loadDetail = async () => {
      try {
        const raw = await apiGet<unknown>(`/api/tasks/${encodeURIComponent(selectedTaskId)}`, controller.signal)
        const detail = asTask(raw)
        if (!detail) throw new Error('Ответ API не содержит TaskDetail')
        if (disposed) return
        setTaskDetail(detail)
        setEvents(previous => mergeEvents(previous, detail.events ?? []))
      } catch (error) {
        if (disposed || error instanceof DOMException && error.name === 'AbortError') return
        setDetailError(error instanceof Error ? error.message : 'Подробности задачи недоступны')
      }
    }
    void loadDetail()
    const interval = window.setInterval(() => void loadDetail(), TASK_REFRESH_MS)
    return () => { disposed = true; controller.abort(); window.clearInterval(interval) }
  }, [selectedTaskId])

  useEffect(() => {
    if (!selectedTaskId) return
    let disposed = false
    let lastId = 0
    let retryTimer: number | undefined
    let activeController: AbortController | undefined
    let attempts = 0
    const connect = async () => {
      if (disposed || isTerminal(selectedTask?.status ?? '')) return
      const controller = new AbortController()
      activeController = controller
      try {
        const headers: Record<string, string> = { accept: 'text/event-stream' }
        if (lastId > 0) headers['Last-Event-ID'] = String(lastId)
        const response = await fetch(`${API}/api/tasks/${encodeURIComponent(selectedTaskId)}/events`, { headers, cache: 'no-store', signal: controller.signal })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        setEventError(undefined)
        attempts = 0
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!disposed) {
          const result = await reader.read()
          if (result.done) break
          buffer += decoder.decode(result.value, { stream: true })
          const blocks = buffer.split(/\r?\n\r?\n/)
          buffer = blocks.pop() ?? ''
          for (const block of blocks) {
            const event = decodeSseBlock(block, selectedTaskId)
            if (!event) continue
            const id = Number(event.id)
            if (Number.isFinite(id)) lastId = Math.max(lastId, id)
            setEvents(previous => mergeEvents(previous, [event]))
          }
        }
        if (!disposed && !isTerminal(selectedTask?.status ?? '')) retryTimer = window.setTimeout(connect, 1200)
      } catch (error) {
        if (disposed || error instanceof DOMException && error.name === 'AbortError') return
        setEventError('Поток временно недоступен; проверяю переподключение. История задачи остаётся доступной из Task Store.')
        attempts += 1
        retryTimer = window.setTimeout(connect, Math.min(12_000, 800 * 2 ** Math.min(attempts, 4)))
      }
    }
    void connect()
    return () => { disposed = true; activeController?.abort(); if (retryTimer !== undefined) window.clearTimeout(retryTimer) }
  }, [selectedTaskId, selectedTask?.status])

  useEffect(() => { if (autoScroll) eventEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [events, autoScroll])

  const runningExecutions = snapshot.tasks.flatMap(task => task.steps.filter(step => step.status === 'running').map(step => ({ task, step })))
  const waitingSteps = snapshot.tasks.flatMap(task => task.steps.filter(step => step.status === 'queued').map(step => ({ task, step })))
  const workingEmployeeCount = new Set(runningExecutions.map(item => item.step.employeeId).filter((id): id is string => Boolean(id))).size
  const waitingEmployeeCount = new Set(waitingSteps.map(item => item.step.employeeId).filter((id): id is string => Boolean(id))).size
  const employeeRows = snapshot.employees.map(employee => {
    const running = runningExecutions.find(item => item.step.employeeId === employee.id)
    const queued = waitingSteps.find(item => item.step.employeeId === employee.id)
    const runningStartedAt = running?.step.startedAt ?? running?.task.startedAt
    return { employee, running, queued, runningStartedAt, state: running ? 'running' : queued ? 'waiting' : employee.status === 'active' ? 'idle' : employee.status ?? 'unknown' }
  })
  const selectedEmployee = snapshot.employees.find(employee => employee.id === selectedEmployeeId)
  const currentStep = selectedTask?.steps.find(step => step.status === 'running')
  const knownStepCount = selectedTask?.steps.length ?? 0
  const completedStepCount = selectedTask?.steps.filter(step => step.status === 'completed').length ?? 0
  const employeeExecutionIds = new Set((selectedTask?.steps ?? []).filter(step => step.employeeId === selectedEmployeeId && step.executionId).map(step => step.executionId))
  const filteredEvents = events.filter(event => (!selectedEmployeeId || event.data?.employeeId === selectedEmployeeId || employeeExecutionIds.has(event.executionId ?? '')) && `${event.type} ${eventDescription(event)} ${pretty(event.data)}`.toLowerCase().includes(search.toLowerCase()))
  const projectPlanSteps = projectTasks.reduce((sum, task) => sum + task.steps.length, 0)
  const projectCompletedSteps = projectTasks.reduce((sum, task) => sum + task.steps.filter(step => step.status === 'completed').length, 0)
  const projectProgress = projectPlanSteps ? Math.round(projectCompletedSteps / projectPlanSteps * 100) : undefined
  const artifacts = selectedTask?.steps.flatMap(step => artifactEntries(step.result, step.title)) ?? []

  const submitTask = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedProjectId || !title.trim() || !brief.trim() || submitting) return
    const signature = `${selectedProjectId}\n${title.trim()}\n${brief.trim()}`
    const key = idempotency?.signature === signature ? idempotency.key : crypto.randomUUID()
    setIdempotency({ signature, key })
    setSubmissionError(undefined); setSubmissionMessage(undefined); setSubmitting(true)
    try {
      const response = await fetch(`${API}/api/tasks`, {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ projectId: selectedProjectId, title: title.trim(), brief: brief.trim() }),
      })
      const body = await response.json().catch(() => undefined) as { task?: { id?: string }; error?: { code?: string } } | undefined
      if (!response.ok) throw new Error(body?.error?.code ?? `HTTP ${response.status}`)
      const taskId = body?.task?.id
      setSubmissionMessage(taskId ? `Задача принята (${taskId}). API вернул результат синхронного вызова.` : 'Ответ получен. Обновляю Task Store.')
      setTitle(''); setBrief(''); setIdempotency(undefined)
      await refresh()
      if (taskId) setSelectedTaskId(taskId)
    } catch (error) {
      setSubmissionError(`${error instanceof Error ? error.message : 'Ошибка отправки'}. Повтор с теми же полями использует тот же Idempotency-Key.`)
    } finally { setSubmitting(false) }
  }

  const copyText = async (value: string) => { try { await navigator.clipboard.writeText(value) } catch { setSubmissionError('Буфер обмена недоступен в этом браузере.') } }
  const toggleFullscreen = async () => {
    const root = document.querySelector('.agent-terminal')
    try {
      if (!document.fullscreenElement && root instanceof HTMLElement) await root.requestFullscreen()
      else if (document.fullscreenElement) await document.exitFullscreen()
    } catch { setFullscreen(value => !value) }
  }
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  return <main className={`agent-terminal${fullscreen ? ' is-fullscreen' : ''}`}>
    <header className="at-topbar">
      <div className="at-brand"><span className="at-brand-mark">M</span><div><strong>MAO HYBRID</strong><small>AGENT TERMINAL <span>·</span> TASK CONTROL</small></div></div>
      <div className="at-top-context"><span className={`at-connection ${apiError ? 'is-offline' : loading ? 'is-checking' : 'is-connected'}`}><i />{apiError ? 'API недоступен' : loading ? 'Подключение…' : 'API подключён'}</span><span className="at-project-chip">{selectedProject?.name ?? 'Проект не выбран'}</span></div>
      <div className="at-top-actions"><a href="/" className="at-office-link">← Офис</a><button type="button" className="at-icon-button" onClick={() => void refresh()} aria-label="Обновить состояние" title="Обновить">↻</button><button type="button" className="at-icon-button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим'} title="Во весь экран">⛶</button></div>
    </header>
    <section className="at-overview" aria-label="Сводка выполнения">
      <div className="at-overview-title"><div><span className="at-eyebrow">CONTROL ROOM</span><h1>Выполнение проектов</h1></div><span className="at-updated">{snapshot.loadedAt ? `Обновлено ${new Date(snapshot.loadedAt).toLocaleTimeString()}` : 'Ожидание данных'}</span></div>
      <div className="at-metrics">
        <Metric label="Сотрудники работают" value={String(workingEmployeeCount)} note="По назначенным running steps" tone="violet" />
        <Metric label="Сотрудники ожидают" value={String(waitingEmployeeCount)} note="По назначенным queued steps" tone="amber" />
        <Metric label="Активные задачи" value={String(activeTasks.length)} note={snapshot.status?.maxConcurrent ? `Лимит API: ${snapshot.status.maxConcurrent}` : 'Лимит неизвестен'} tone="blue" />
        <Metric label="Runtime" value={snapshot.status?.runtimeAvailable === true ? 'Доступен' : snapshot.status?.runtimeAvailable === false ? 'Недоступен' : 'Неизвестно'} note={apiError ?? (snapshot.status?.runtimeAvailable ? 'По /api/status' : 'Нет подтверждения доступности')} tone={snapshot.status?.runtimeAvailable ? 'green' : 'muted'} />
      </div>
    </section>
    {apiError && <div className="at-alert" role="alert"><strong>Связь с API потеряна.</strong> Остаток экрана показывает последний успешно загруженный снимок; статусы могут устареть. <span>{apiError}</span></div>}
    <div className="at-workspace">
      <aside className="at-sidebar">
        <section className="at-panel at-project-panel"><div className="at-section-heading"><div><span className="at-eyebrow">WORKSPACE</span><h2>Проекты</h2></div><span className="at-count">{snapshot.projects.length}</span></div>
          <div className="at-project-list">{snapshot.projects.map(project => {
            const count = snapshot.tasks.filter(task => task.projectId === project.id && ['queued', 'running'].includes(task.status)).length
            return <button type="button" key={project.id} className={`at-project-row${project.id === selectedProjectId ? ' is-selected' : ''}`} onClick={() => { setSelectedProjectId(project.id); setSelectedEmployeeId('') }}><span className="at-project-icon">⌂</span><span className="at-row-copy"><strong>{project.name}</strong><small>{project.status ?? 'Статус проекта не указан'}</small></span><span className="at-row-count">{count || '—'}</span></button>
          })}{!snapshot.projects.length && <Empty text={loading ? 'Загружаю проекты…' : 'API не вернул проекты.'} />}</div>
        </section>
        <section className="at-panel at-team-panel"><div className="at-section-heading"><div><span className="at-eyebrow">TEAM STATUS</span><h2>Сотрудники <b>{workingEmployeeCount} работают</b></h2></div></div>
          <div className="at-employee-list">{employeeRows.map(row => <button type="button" key={row.employee.id} className={`at-employee-row${selectedEmployeeId === row.employee.id ? ' is-selected' : ''}`} onClick={() => { setSelectedEmployeeId(row.employee.id); if (row.running) setSelectedTaskId(row.running.task.id); else if (row.queued) setSelectedTaskId(row.queued.task.id) }}>
            <span className={`at-avatar state-${row.state}`}>{initials(row.employee.displayName)}</span><span className="at-row-copy"><strong>{row.employee.displayName}</strong><small>{row.running ? `${snapshot.projects.find(project => project.id === row.running!.task.projectId)?.name ?? 'Проект'} · ${row.running!.task.title}` : row.queued ? `${snapshot.projects.find(project => project.id === row.queued!.task.projectId)?.name ?? 'Проект'} · ${row.queued!.task.title}` : row.employee.professionId ?? 'Состояние неизвестно'}</small>{row.running ? <small>Этап: {row.running.step.title} · {row.runningStartedAt ? `с ${dateTime(row.runningStartedAt)} · ${elapsed(row.runningStartedAt)}` : 'время старта неизвестно'}</small> : row.queued ? <small>Этап: {row.queued.step.title}</small> : null}</span><span className={`at-state-pill state-${row.state}`}>{employeeStateLabel(row.state)}</span>
          </button>)}{!employeeRows.length && <Empty text="Сотрудники недоступны." />}</div>
        </section>
        <section className="at-panel at-task-panel"><div className="at-section-heading"><div><span className="at-eyebrow">TASK QUEUE</span><h2>Активные задачи</h2></div><span className="at-count">{activeTasks.length}</span></div>
          <div className="at-task-list">{activeTasks.map(task => <TaskRow key={task.id} task={task} projectName={snapshot.projects.find(project => project.id === task.projectId)?.name} selected={task.id === selectedTaskId} onSelect={() => { setSelectedTaskId(task.id); setSelectedEmployeeId('') }} />)}{!activeTasks.length && <Empty text="Активных задач нет." />}</div>
          <button type="button" className="at-history-toggle" onClick={() => setShowHistory(value => !value)} aria-expanded={showHistory}>{showHistory ? 'Скрыть историю' : 'Показать историю'} <span>{historyTasks.length}</span></button>
          {showHistory && <div className="at-task-list at-history-list">{historyTasks.map(task => <TaskRow key={task.id} task={task} projectName={snapshot.projects.find(project => project.id === task.projectId)?.name} selected={task.id === selectedTaskId} onSelect={() => { setSelectedTaskId(task.id); setSelectedEmployeeId('') }} />)}{!historyTasks.length && <Empty text="История задач пуста." />}</div>}
        </section>
      </aside>
      <section className="at-main-column">
        <section className="at-panel at-task-detail">
          {selectedTask ? <>
            <div className="at-task-heading"><div className="at-task-heading-copy"><span className="at-eyebrow">{selectedProject?.name ?? 'ПРОЕКТ'} · {selectedTask.id}</span><h2>{selectedTask.title}</h2><div className="at-task-meta"><Status status={selectedTask.status} /><span>{selectedTask.createdAt ? `Создана ${dateTime(selectedTask.createdAt)}` : 'Время создания недоступно'}</span><span>{currentStep ? `Этап: ${currentStep.title}` : selectedTask.status === 'queued' ? 'Ожидает запуска' : 'Текущий этап не указан'}</span></div></div><div className="at-task-controls"><label className="at-select-label">Фильтр журнала<select value={selectedEmployeeId} onChange={event => setSelectedEmployeeId(event.target.value)}><option value="">По всем сотрудникам</option>{snapshot.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.displayName}</option>)}</select></label><button type="button" className="at-small-button" onClick={() => void copyText(events.map(formatEvent).join('\n\n'))}>Копировать журнал</button></div></div>
            <div className="at-progress-row"><div className="at-progress-copy"><strong>{knownStepCount ? `${completedStepCount} / ${knownStepCount} этапов завершено` : 'План этапов недоступен'}</strong><span>Прогресс по этапам{projectProgress !== undefined && selectedProjectId ? ` проекта: ${projectCompletedSteps} / ${projectPlanSteps} (${projectProgress}%)` : ''}{selectedTask.status === 'running' ? ' · внутренняя готовность неизвестна' : ''}</span></div>{selectedTask.status === 'running' && <div className="at-unknown-progress">Время завершения неизвестно</div>}</div>
            {knownStepCount > 0 && <div className="at-progress-track" role="img" aria-label={`${completedStepCount} из ${knownStepCount} этапов завершены`}><span style={{ width: `${Math.round(completedStepCount / knownStepCount * 100)}%` }} /></div>}
            <div className="at-detail-grid">
              <section className="at-subpanel at-phases"><div className="at-section-heading"><div><span className="at-eyebrow">PLAN</span><h3>Этапы задачи</h3></div><span className="at-count">{knownStepCount}</span></div>
                <div className="at-phase-list">{selectedTask.steps.map((step, index) => {
                  const employee = snapshot.employees.find(item => item.id === step.employeeId)
                  const startedAt = step.startedAt ?? (step.status === 'running' ? selectedTask.startedAt : undefined)
                  const dependencies = (step.dependsOn ?? []).map(id => selectedTask.steps.find(item => item.id === id)?.title ?? id)
                  const result = step.result ?? (step.status === 'completed' ? 'Этап завершён; подробный результат не сохранён.' : undefined)
                  const next = !currentStep && step.status === 'queued' && (step.dependsOn ?? []).every(id => selectedTask.steps.find(item => item.id === id)?.status === 'completed')
                  return <article key={step.id} className={`at-phase state-${step.status}`}><span className="at-phase-index">{String(index + 1).padStart(2, '0')}</span><div className="at-phase-content"><div className="at-phase-title"><strong>{step.title}</strong><Status status={step.status} /></div><div className="at-phase-meta"><span>{employee?.displayName ?? (step.employeeId ? `Сотрудник ${step.employeeId}` : 'Ответственный не назначен')}</span>{startedAt && <span>Старт: {dateTime(startedAt)} · {elapsed(startedAt)}</span>}{step.completedAt && <span>Завершён: {dateTime(step.completedAt)}</span>}</div>{dependencies.length > 0 && <p className="at-dependencies">Зависит от: {dependencies.join(' · ')}</p>}{next && <p className="at-next">Следующий доступный этап</p>}{step.error && <pre className="at-phase-error">{step.error}</pre>}{result !== undefined && <details className="at-phase-result"><summary>Результат этапа</summary><pre>{pretty(result)}</pre></details>}</div></article>
                })}{!knownStepCount && <Empty text="План этапов отсутствует в Task Store." />}</div>
              </section>
              <section className="at-subpanel at-journal"><div className="at-journal-header"><div><span className="at-eyebrow">EXECUTION LOG</span><h3>Журнал исполнения</h3><small>{selectedEmployee ? `Фильтр сотрудника: ${selectedEmployee.displayName}` : `${events.length} событий из источников задачи`}</small></div><div className="at-journal-buttons"><button type="button" onClick={() => setAutoScroll(value => !value)} aria-pressed={autoScroll} className="at-small-button">Автопрокрутка {autoScroll ? 'вкл.' : 'выкл.'}</button><button type="button" className="at-small-button" onClick={() => void copyText(filteredEvents.map(formatEvent).join('\n\n'))}>Скопировать</button></div></div>
                <div className="at-log-toolbar"><label className="at-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Поиск по журналу" aria-label="Поиск по журналу" /></label><button type="button" className="at-tools-toggle" onClick={() => setShowTools(value => !value)} aria-expanded={showTools}>MCP инструменты <span>{snapshot.tools.length}</span></button></div>
                {showTools && <div className="at-tool-catalog">{snapshot.tools.slice(0, 24).map(tool => <span key={tool.id} title={tool.description}>{tool.name ?? tool.id}</span>)}{snapshot.tools.length > 24 && <span>+{snapshot.tools.length - 24}</span>}{!snapshot.tools.length && <span>Каталог инструментов недоступен.</span>}</div>}
                <div className="at-event-list" role="log" aria-label="События исполнения" aria-live="polite">{filteredEvents.map(event => <EventRow key={`${event.taskId}-${event.id}`} event={event} onCopy={() => void copyText(formatEvent(event))} />)}<div ref={eventEndRef} />{!filteredEvents.length && <div className="at-log-empty"><span className="at-terminal-mark">›_</span><strong>{eventError ? 'Подробный поток временно недоступен' : events.length ? 'По запросу ничего не найдено' : 'События исполнения пока недоступны'}</strong><p>{eventError ?? (events.length ? 'Измените поисковую строку.' : 'Task Store не вернул события; подробные сообщения и вывод инструментов не предполагаются.')}</p></div>}</div>
                {(eventError || detailError) && <p className="at-inline-error">{eventError ?? `Подробности задачи: ${detailError}`}</p>}
              </section>
            </div>
            {(selectedTask.error || selectedTask.result !== undefined || selectedTask.steps.some(step => step.result !== undefined)) && <section className="at-results"><div className="at-section-heading"><div><span className="at-eyebrow">OUTPUT</span><h3>Результат и артефакты</h3></div><button type="button" className="at-small-button" onClick={() => void copyText(pretty(selectedTask.result ?? selectedTask.steps.filter(step => step.result !== undefined).map(step => ({ stage: step.title, result: step.result }))))}>Копировать результат</button></div>{selectedTask.error && <p className="at-phase-error">{selectedTask.error}</p>}{selectedTask.result !== undefined && <pre>{pretty(selectedTask.result)}</pre>}{artifacts.length > 0 && <div className="at-artifact-list">{artifacts.map(artifact => <div key={artifact.id} className="at-artifact">{artifact.href ? <a href={artifact.href} target="_blank" rel="noreferrer">↗ {artifact.label}</a> : <details><summary>▧ {artifact.label}</summary><pre>{pretty(artifact.value)}</pre></details>}</div>)}</div>}{selectedTask.steps.filter(step => step.result !== undefined).map(step => <details key={step.id}><summary>{step.title} · результат</summary><pre>{pretty(step.result)}</pre></details>)}</section>}
          </> : <div className="at-empty-detail"><span className="at-terminal-mark">›_</span><h2>{loading ? 'Загружаю состояние MAO…' : 'Выберите задачу'}</h2><p>{loading ? 'Читаю проекты, сотрудников и Task Store.' : 'Здесь появятся её этапы и журнал исполнения.'}</p></div>}
        </section>
        <section className="at-panel at-submit-panel"><div className="at-submit-title"><div><span className="at-eyebrow">DIRECTOR INPUT</span><h2>Новое задание</h2><p>Agent Task Console · это не системный shell</p></div><span className="at-submit-note">Сотрудника назначает Company</span></div>
          <form className="at-task-form" onSubmit={submitTask}><label>Проект<select required value={selectedProjectId} onChange={event => setSelectedProjectId(event.target.value)}><option value="">Выберите проект</option>{snapshot.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Задание<input required maxLength={300} value={title} onChange={event => setTitle(event.target.value)} placeholder="Например, проверить схему питания" /></label><label className="at-brief-field">Контекст<textarea required maxLength={100_000} value={brief} onChange={event => setBrief(event.target.value)} placeholder="Опишите ожидаемый результат и ограничения…" /></label><div className="at-submit-footer"><span>POST /api/tasks · Idempotency-Key включён{snapshot.status?.runtimeAvailable === false ? ' · Runtime недоступен' : ''}</span><button type="submit" disabled={submitting || !selectedProjectId || snapshot.status?.runtimeAvailable === false}>{submitting ? 'Ожидание ответа API…' : 'Передать Director'} <span aria-hidden="true">↗</span></button></div></form>
          {submissionError && <p className="at-inline-error" role="alert">{submissionError}</p>}{submissionMessage && <p className="at-inline-success" role="status">{submissionMessage}</p>}
        </section>
      </section>
    </div>
    <footer className="at-footer"><span>MAO HYBRID <i>·</i> Состояние только из API и Task Store</span><span>{snapshot.status?.activeExecutions ?? '—'} runtime executions <i>·</i> обновление {TASK_REFRESH_MS / 1000} сек.</span></footer>
  </main>
}

function mergeEvents(current: RuntimeEvent[], incoming: RuntimeEvent[]): RuntimeEvent[] {
  const byId = new Map(current.map(event => [`${event.taskId}:${event.id}`, event]))
  incoming.forEach(event => byId.set(`${event.taskId}:${event.id}`, event))
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id))
}
function formatEvent(event: RuntimeEvent): string { return `[${dateTime(event.occurredAt)}] ${eventTitle(event)}${eventDescription(event) ? `\n${eventDescription(event)}` : ''}${event.data && Object.keys(event.data).length ? `\n${pretty(event.data)}` : ''}` }
function initials(name: string): string { return name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() }
function employeeStateLabel(state: string): string { return ({ running: 'Работает', waiting: 'Ожидает', idle: 'Свободен', active: 'Доступен', disabled: 'Отключён', offline: 'Офлайн', blocked: 'Заблокирован', unknown: 'Нет данных' } as Record<string, string>)[state] ?? state }
function statusClass(status: string): string { return status === 'completed' ? 'success' : status === 'running' ? 'running' : status === 'queued' ? 'queued' : status === 'failed' ? 'failed' : status === 'needs_review' ? 'review' : 'unknown' }

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <article className={`at-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}
function Status({ status }: { status: string }) { return <span className={`at-status status-${statusClass(status)}`}><i />{taskLabel(status)}</span> }
function Empty({ text }: { text: string }) { return <div className="at-empty">{text}</div> }
function TaskRow({ task, projectName, selected, onSelect }: { task: Task; projectName?: string; selected: boolean; onSelect: () => void }) {
  const completed = task.steps.filter(step => step.status === 'completed').length
  return <button type="button" className={`at-task-row${selected ? ' is-selected' : ''}`} onClick={onSelect}><span className={`at-task-dot status-${statusClass(task.status)}`} /><span className="at-row-copy"><strong>{task.title}</strong><small>{projectName ?? 'Проект неизвестен'} · {task.steps.length ? `${completed}/${task.steps.length} этапов` : 'этапы неизвестны'}</small></span><Status status={task.status} /></button>
}
const EventRow = memo(function EventRow({ event, onCopy }: { event: RuntimeEvent; onCopy: () => void }) {
  const data = event.data ?? {}
  const isTool = event.type.startsWith('tool.')
  const tone = event.type.includes('failed') || event.type.includes('rejected') ? 'failed' : event.type.includes('completed') ? 'success' : isTool ? 'tool' : 'event'
  return <article className={`at-event-row tone-${tone}`}><span className="at-event-time">{event.occurredAt ? new Date(event.occurredAt).toLocaleTimeString() : '—:—:—'}</span><span className="at-event-symbol">{isTool ? 'ƒ' : event.type.includes('failed') ? '!' : '·'}</span><div className="at-event-content"><div className="at-event-title"><strong>{eventTitle(event)}</strong><span>{event.executionId ? `execution ${event.executionId.slice(0, 10)}` : event.type}</span></div>{eventDescription(event) && <p>{eventDescription(event)}</p>}{Object.keys(data).length > 0 && <details className="at-event-details"><summary>{isTool ? 'Аргументы и результат' : 'Детали события'}</summary><pre>{pretty(data)}</pre></details>}</div><button type="button" className="at-copy-event" onClick={onCopy} aria-label="Копировать событие" title="Копировать">⧉</button></article>
})
