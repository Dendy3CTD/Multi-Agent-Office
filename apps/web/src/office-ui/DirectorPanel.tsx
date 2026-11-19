import { useState } from 'react'
import type { OfficeBudgetStatus, OfficeEmployee, OfficeEvent, OfficeProject, OfficeRuntimeStatus, OfficeTask } from './types'
import type { LiveQueueTaskDTO } from '../live/types'
import type { ResourceProjection } from '../live/resourceProjection'
import DirectorTaskComposer from './DirectorTaskComposer'
import { taskWritesEnabled } from '../live/taskSubmission'

export interface DirectorPanelProps {
  open: boolean
  onClose: () => void
  projects: readonly OfficeProject[]
  employees: readonly OfficeEmployee[]
  tasks: readonly OfficeTask[]
  events: readonly OfficeEvent[]
  runtimeStatus: OfficeRuntimeStatus
  budgetStatus: OfficeBudgetStatus
  resourceData?: ResourceProjection
  connection: 'live' | 'loading' | 'stale' | 'disconnected' | 'error' | 'demo'
  error?: string
  pendingFigmaCount?: number
  agentRoles?: readonly { id: string; name: string; specialization?: string; executionStatus: 'READY' | 'UNVERIFIED' | 'NOT_RUN' | 'BLOCKED'; executable: boolean; blockers: readonly string[] }[]
  queueTasks?: readonly LiveQueueTaskDTO[]
  activeWorkers?: readonly { runtimeId?: string; taskId?: string; subtaskId?: string; roleId?: string; employeeId?: string }[]
  queuePlans?: readonly { taskId: string; title?: string; status?: string; subtaskCount: number; completedSubtaskCount: number; artifactCount: number; eventCount: number; verificationStatus: 'PASS' | 'FAIL' | 'NOT_RUN' | 'UNKNOWN'; reviewVerdict?: 'PASS' | 'BLOCKED' }[]
  queueAvailability?: 'available' | 'unavailable'
  onLocateEmployee?: (employeeId: string) => void
  tasksReadOnly?: boolean
  taskSubmissionEnabled?: boolean
  onCreateTask: (input: { projectId: string; title: string; brief: string; priority: 'normal' | 'interactive' }) => Promise<void>
  onCancelTask: (taskId: string) => Promise<void>
  onRefresh?: () => Promise<void>
}

const coreRoles: readonly (readonly [readonly string[], string])[] = [
  [['director'], 'Director'], [['reviewer'], 'Reviewer'], [['mechanical-engineer'], 'Mechanical Engineer'], [['electronics-engineer', 'embedded-developer'], 'Electronics Engineer'], [['simulation-engineer'], 'Simulation Engineer'],
  [['software-engineer', 'backend-developer', 'frontend-developer', 'python-developer'], 'Software Engineer'], [['web-researcher', 'research-analyst'], 'Web Researcher'], [['documentation-specialist', 'technical-writer'], 'Documentation Specialist'], [['figma-specialist'], 'Figma Specialist'],
] as const
const statusLabel: Record<OfficeTask['status'], string> = { queued: 'В очереди', running: 'В работе', review: 'Проверка', blocked: 'Блокировка', completed: 'Завершена', failed: 'Ошибка', cancelled: 'Остановлена' }
const readinessLabel = { verified: 'VERIFIED', registered: 'REGISTERED', unavailable: 'UNAVAILABLE' } as const
const metricLabel = (value: number | undefined) => value === undefined ? 'Нет данных' : value.toLocaleString('ru-RU')

function employeeRuntimeLabel(employee: OfficeEmployee, queueTasks: readonly LiveQueueTaskDTO[]): string {
  if (employee.executionStatus) return employee.executionStatus
  const assigned = queueTasks.filter(task => task.employeeId === employee.id)
  const reviewerRunning = assigned.some(task => task.status === 'running' && /review/i.test(`${task.roleId ?? ''} ${task.title ?? ''}`))
  if (reviewerRunning) return 'REVIEWING'
  switch (employee.employeeLiveState?.status) {
    case 'RUNNING': return 'RUNNING'
    case 'WAITING': return 'QUEUED'
    case 'COMPLETED': return 'COMPLETED'
    case 'FAILED': return 'FAILED'
    case 'BLOCKED': return 'BLOCKED'
    case 'IDLE': return 'IDLE'
    default: return 'UNVERIFIED'
  }
}

export default function DirectorPanel(props: DirectorPanelProps) {
  const [actionError, setActionError] = useState<string>()
  const [composerOpen, setComposerOpen] = useState(false)
  const [taskFilter, setTaskFilter] = useState('all')
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string>()
  if (!props.open) return null
  const submissionEnabled = props.taskSubmissionEnabled ?? taskWritesEnabled

  const active = props.tasks.filter(task => ['queued', 'running', 'review', 'blocked'].includes(task.status))
  const registeredRoles = props.agentRoles ?? []
  const executableRoles = registeredRoles.filter(role => role.executable)
  const unverifiedRoles = registeredRoles.filter(role => role.executionStatus === 'UNVERIFIED')
  const notRunRoles = registeredRoles.filter(role => role.executionStatus === 'NOT_RUN')
  const blockedRoles = registeredRoles.filter(role => role.executionStatus === 'BLOCKED')
  const visibleTasks = props.tasks.filter(task => taskFilter === 'all' || task.status === taskFilter)
  const selectedSubtask = props.queueTasks?.find(task => task.id === selectedSubtaskId)
  const selectedEmployee = selectedSubtask?.employeeId ? props.employees.find(employee => employee.id === selectedSubtask.employeeId) : undefined
  const duration = selectedSubtask?.startedAt && selectedSubtask.completedAt ? (() => {
    const start = Date.parse(selectedSubtask.startedAt!), end = Date.parse(selectedSubtask.completedAt!)
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? `${Math.round((end - start) / 1000)} с` : undefined
  })() : undefined
  return <section className="mao-director-panel" role="dialog" aria-modal="true" aria-label="Панель директора">
    <header className="mao-director-head"><div><span className="mao-eyebrow">MAO · DIRECTOR DESK</span><h2>Чат и задачи Director</h2></div><button type="button" className="mao-icon-button" aria-label="Закрыть панель директора" onClick={props.onClose}>×</button></header>
    <div className={`mao-director-connection connection-${props.connection}`} role="status"><i />{props.connection === 'live' ? 'MAO · LIVE' : props.connection === 'stale' ? 'Соединение потеряно · показан последний снимок' : props.connection === 'loading' ? 'Подключение к MAO Server…' : props.connection === 'demo' ? 'Демо-режим · сервер не подключён' : props.connection === 'error' ? 'Доступ к MAO заблокирован' : 'Нет соединения с MAO Server'}{props.error && <small>{props.error}</small>}</div>
    <section className="mao-composer-launcher"><div><h3>Поставить задачу Director</h3><p>Опишите результат и критерии. Backend проверит запуск до отправки.</p></div><button type="button" onClick={() => setComposerOpen(true)}>＋ Написать задачу</button>{props.tasksReadOnly && <small>{props.connection === 'demo' ? 'Development fixture: отправка отключена.' : submissionEnabled ? 'Перед отправкой обязательны backend preflight и подтверждение.' : 'Чтение доступно; task writes выключены до двойного dev opt-in.'}</small>}</section>
    {actionError && <p className="mao-director-error" role="alert">Операция недоступна: {actionError}</p>}
    {composerOpen && <DirectorTaskComposer projects={props.projects} projectsConfirmed={props.connection === 'live'} budgetStatus={props.budgetStatus} onClose={() => setComposerOpen(false)} onAccepted={props.onRefresh} writesEnabled={submissionEnabled} />}
    <section className="mao-director-section mao-resource-section" aria-label="Модели и ресурсы"><div className="mao-director-title"><h3>Модели и ресурсы</h3><span>{props.resourceData?.models.length ?? 0} связок runtime/model</span></div>
      <div className="mao-resource-policy"><span>Политический предел: до {props.resourceData?.maxActiveLlm ?? 2} активных LLM</span><strong>Работающие процессы: {props.resourceData?.runningProcessCount === undefined ? 'Нет подтверждённых данных' : props.resourceData.runningProcessCount}</strong></div>
      <div className="mao-resource-grid">{props.resourceData?.runtimes.map(runtime => <article className="mao-resource-card" key={`runtime:${runtime.runtimeId}`}><header><strong>{runtime.runtimeId}</strong><span className={`mao-resource-state resource-${runtime.status}`}>{readinessLabel[runtime.status]}</span></header><small>Runtime · {runtime.status === 'verified' ? 'готовность и авторизация подтверждены' : runtime.status === 'registered' ? 'зарегистрирован, но готовность не подтверждена' : 'недоступен по данным API'}</small>{runtime.blockers.length > 0 && <small>Blockers: {runtime.blockers.join(', ')}</small>}</article>)}</div>
      {props.resourceData?.models.length ? <div className="mao-model-list">{props.resourceData.models.map(model => <article className="mao-model-card" key={`${model.runtimeId}:${model.modelId}`}><header><strong>{model.modelId}</strong><span className={`mao-resource-state resource-${model.status}`}>{readinessLabel[model.status]}</span></header><small>runtimeId: {model.runtimeId} · modelId: {model.modelId}</small>{model.blockers.length > 0 && <small>Readiness blockers: {model.blockers.join(', ')}</small>}<dl><dt>Input tokens</dt><dd>{metricLabel(model.usage.input)}</dd><dt>Output tokens</dt><dd>{metricLabel(model.usage.output)}</dd><dt>Cached input</dt><dd>{metricLabel(model.usage.cachedInput)}</dd><dt>Reasoning</dt><dd>{metricLabel(model.usage.reasoning)}</dd><dt>Reported total</dt><dd>{metricLabel(model.usage.reportedTotal)}</dd><dt>Стоимость</dt><dd>{model.usage.costKnown && model.usage.costUsd !== undefined ? `${model.usage.costUsd.toLocaleString('ru-RU')} USD` : 'Нет данных'}</dd></dl></article>)}</div> : <p className="mao-director-note">Модели не переданы backend или каталог пока недоступен.</p>}
      <p className="mao-resource-allowance">Allowance: <strong>{props.resourceData?.allowanceLabel ?? 'Нет данных'}</strong>. Остаток подписки и доступное число запросов не вычисляются.</p>
      <p className="mao-director-note">Cached input показан отдельно; reported total берётся напрямую из usage API и не увеличивается повторным сложением cache.</p>
    </section>
    <section className="mao-director-section"><div className="mao-director-title"><h3>Оперативная команда</h3><span>{coreRoles.length} профилей роли</span></div><div className="mao-core-roles">{coreRoles.map(([ids, label]) => { const matches = props.employees.filter(employee => ids.includes((employee.professionId ?? '').toLowerCase().replace(/_/g, '-'))); const worker = matches.find(employee => employee.status === 'working' || employee.status === 'review' || employee.status === 'blocked' || employee.status === 'error') ?? matches[0]; return <div className={`mao-core-role ${worker ? `core-${worker.status}` : 'core-unassigned'}`} key={label}><i /><span>{label}</span><small>{worker ? `${worker.id} · ${employeeRuntimeLabel(worker, props.queueTasks ?? [])}` : 'нет серверного профиля'}</small></div> })}</div><small className="mao-director-note">Показываются только реальные профили Directory. Незарегистрированные роли требуют дополнения серверного каталога; локальные подстановки не создаются.</small></section>
    <section className="mao-director-section" aria-label="Наблюдение задач"><div className="mao-director-title"><h3>Наблюдение задач</h3><span>{visibleTasks.length} из {props.tasks.length}</span></div>
      <label className="mao-director-filter">Статус задач<select aria-label="Фильтр статуса задач" value={taskFilter} onChange={event => setTaskFilter(event.target.value)}><option value="all">Все статусы</option>{['queued', 'running', 'review', 'blocked', 'completed', 'failed', 'cancelled'].map(status => <option key={status} value={status}>{statusLabel[status as OfficeTask['status']]}</option>)}</select></label>
      {visibleTasks.length ? <div className="mao-director-task-list">{visibleTasks.map(task => {
        const subtasks = props.queueTasks?.filter(item => item.taskId === task.id) ?? []
        const plan = props.queuePlans?.find(item => item.taskId === task.id)
        return <article key={`tree-${task.id}`} className="mao-director-task"><div className="mao-director-task-head"><strong>{task.title}</strong><span className={`task-chip task-${task.status}`}>{statusLabel[task.status]}</span></div><small>Задача · {task.id}</small>
          {subtasks.length ? <ol className="mao-task-tree">{subtasks.map(subtask => {
            const assigned = subtask.employeeId ? props.employees.find(employee => employee.id === subtask.employeeId) : undefined
            const reviewer = /review/i.test(`${subtask.roleId ?? ''} ${subtask.title ?? ''}`)
            return <li key={subtask.id} className={reviewer ? 'tree-reviewer' : 'tree-engineer'}><button type="button" className="mao-tree-select" aria-pressed={selectedSubtaskId === subtask.id} onClick={() => setSelectedSubtaskId(subtask.id)}><strong>{reviewer ? 'Reviewer' : subtask.title ?? subtask.roleId ?? 'Подзадача'}</strong><span className="task-chip">{subtask.status ?? 'UNVERIFIED'}</span></button><small>{subtask.id}{subtask.roleId ? ` · ${subtask.roleId}` : ''}</small>{subtask.errorCode && <small className="mao-director-error">Код ошибки: {subtask.errorCode}</small>}{assigned && <button type="button" className="mao-employee-jump" onClick={() => props.onLocateEmployee?.(assigned.id)}>К сотруднику: {assigned.name} · {assigned.id}</button>}</li>
          })}</ol> : <p className="mao-director-note">Подзадачи не переданы сервером.</p>}
          {plan && <div className="mao-evidence-status"><span>Доказательства: {plan.verificationStatus === 'PASS' ? 'подтверждены' : plan.verificationStatus === 'FAIL' ? 'проверка не пройдена' : plan.verificationStatus === 'NOT_RUN' ? 'не запускались' : 'UNVERIFIED · данных недостаточно'}</span>{plan.reviewVerdict === 'BLOCKED' && <strong>Reviewer отказал · BLOCKED</strong>}{plan.reviewVerdict === 'PASS' && <strong>Reviewer подтвердил</strong>}</div>}
        </article>
      })}</div> : <p className="mao-director-note">Нет задач с выбранным статусом.</p>}
      {selectedSubtask && <aside className="mao-subtask-detail" aria-label="Детали выбранной подзадачи"><h4>{selectedSubtask.title ?? selectedSubtask.id}</h4><dl><dt>Исполнитель</dt><dd>{selectedSubtask.employeeId ?? 'API не передал'}</dd>{selectedSubtask.runtimeId && <><dt>Runtime</dt><dd>{selectedSubtask.runtimeId}</dd></>}{selectedSubtask.modelId && <><dt>Модель</dt><dd>{selectedSubtask.modelId}</dd></>}{selectedSubtask.startedAt && <><dt>Начало</dt><dd>{selectedSubtask.startedAt}</dd></>}{selectedSubtask.completedAt && <><dt>Завершение</dt><dd>{selectedSubtask.completedAt}</dd></>}{duration && <><dt>Длительность</dt><dd>{duration}</dd></>}{selectedSubtask.verification && <><dt>Проверка</dt><dd>{selectedSubtask.verification}</dd></>}{selectedSubtask.errorCode && <><dt>Код ошибки</dt><dd>{selectedSubtask.errorCode}</dd></>}</dl>{selectedSubtask.artifacts?.length ? <div><strong>Артефакты из API</strong>{selectedSubtask.artifacts.map(artifact => <small key={artifact.id}>{artifact.id}{artifact.mediaType ? ` · ${artifact.mediaType}` : ''}{artifact.sha256 ? ` · SHA256 ${artifact.sha256}` : ''}</small>)}</div> : null}{selectedEmployee && <button type="button" onClick={() => props.onLocateEmployee?.(selectedEmployee.id)}>Перейти к сотруднику в офисе</button>}</aside>}
    </section>
    <section className="mao-director-section"><div className="mao-director-title"><h3>Directory · реестр ролей</h3><span>{props.queueAvailability === 'available' ? `${registeredRoles.length} зарегистрировано` : 'сервер недоступен'}</span></div>{props.queueAvailability !== 'available' ? <p className="mao-director-note">API реестра ролей и очереди недоступно; статусы исполнения неизвестны.</p> : <><div className="mao-role-summary"><span>READY: <strong>{executableRoles.length}</strong></span><span>UNVERIFIED: <strong>{unverifiedRoles.length}</strong></span><span>NOT_RUN: <strong>{notRunRoles.length}</strong></span><span>BLOCKED: <strong>{blockedRoles.length}</strong></span></div><div className="mao-role-directory">{registeredRoles.map(role => { const assignment = props.queueTasks?.find(task => task.roleId === role.id && ['queued', 'running', 'leased'].includes(String(task.status).toLowerCase())); const worker = props.activeWorkers?.find(item => item.roleId === role.id); const assignedTo = assignment?.employeeId ?? worker?.employeeId ?? worker?.runtimeId; return <article key={role.id} className="mao-role-row"><div><strong>{role.name}</strong><small>{role.specialization ?? role.id}</small></div><span className={`mao-role-status ${role.executionStatus === 'READY' ? 'is-ready' : role.executionStatus === 'UNVERIFIED' || role.executionStatus === 'NOT_RUN' ? 'is-unchecked' : 'is-blocked'}`}>{role.executionStatus}</span><small>{assignedTo ? `Назначен: ${assignedTo}` : assignment ? `Задача: ${assignment.taskId ?? 'без id'}` : 'Назначение не передано'}</small>{role.blockers.length > 0 && <small>Блокеры: {role.blockers.join(', ')}</small>}</article>})}</div></>}</section>
    <section className="mao-director-section"><div className="mao-director-title"><h3>Очередь исполнителей</h3><span>{props.queueAvailability === 'available' ? `${props.queueTasks?.length ?? 0} подзадач` : 'BLOCKED'}</span></div>{props.queueAvailability !== 'available' ? <p className="mao-director-note">Реестр очереди недоступен. Статус: BLOCKED.</p> : props.queueTasks?.length ? <div className="mao-director-task-list">{props.queueTasks.map(task => <article key={task.id} className="mao-director-task"><div className="mao-director-task-head"><strong>{task.title ?? task.id}</strong><span className="task-chip">{task.status ?? 'UNKNOWN'}</span></div><small>{task.id} · роль {task.roleId ?? 'не назначена'} · задача {task.taskId ?? 'не указана'}</small><div className="mao-director-subtasks">Назначение: {task.employeeId ?? props.activeWorkers?.find(worker => worker.subtaskId === task.id)?.employeeId ?? 'API не передал'} · Попытки: {task.attempts ?? '—'} / {task.maxAttempts ?? '—'}<br />Зависимости: {task.dependsOn?.length ? task.dependsOn.join(', ') : 'нет'}</div></article>)}</div> : <p className="mao-director-note">Очередь доступна, активных подзадач нет.</p>}{props.queuePlans?.map(plan => <small key={plan.taskId} className="mao-director-note">План {plan.title ?? plan.taskId}: {plan.completedSubtaskCount} / {plan.subtaskCount} подзадач завершено · статус {plan.status ?? 'UNKNOWN'} · {plan.artifactCount} артефактов · {plan.eventCount} событий · проверка {plan.verificationStatus}{plan.reviewVerdict ? ` · REVIEW: ${plan.reviewVerdict}` : ''}</small>)}</section>
    <section className="mao-director-section"><div className="mao-director-title"><h3>План и выполнение</h3><span>{active.length} активных</span></div>
      {props.tasks.length ? <div className="mao-director-task-list">{props.tasks.slice(0, 40).map(task => <article key={task.id} className="mao-director-task"><div className="mao-director-task-head"><strong>{task.title}</strong><span className={`task-chip task-${task.status}`}>{statusLabel[task.status]}</span></div><small>{task.id} · {task.projectId ?? 'проект не указан'}</small><div className="mao-director-task-meta"><span>Исполнитель: {task.employeeId ?? 'Server API не назначил'}</span><span>Runtime: {task.runtimeId ?? 'ожидает назначения'}</span><span>Модель: {task.modelId ?? 'ожидает назначения'}</span><span>Начало: {task.startedAt ?? 'сервер не передал'}</span></div>{task.errorCode && <p className="mao-director-error">Ошибка: {task.errorCode}</p>}{task.resultSummary && <p className="mao-director-result">Результат: {task.resultSummary}</p>}{task.artifactUrls?.map(url => <a key={url} href={url} target="_blank" rel="noreferrer">Открыть артефакт</a>)}<div className="mao-director-subtasks">Подзадачи: {task.subtasks?.length ? task.subtasks.map(item => item.title).join(' · ') : 'Запланированные подзадачи появятся из серверного плана'}<br />Зависимости: {task.dependencies?.length ? task.dependencies.join(', ') : 'сервер пока не передаёт'}</div>{['queued', 'running'].includes(task.status) && <button type="button" disabled={props.tasksReadOnly} title={props.tasksReadOnly ? 'Read-only proxy не разрешает отмену' : undefined} onClick={() => void props.onCancelTask(task.id).catch(error => setActionError(error instanceof Error ? error.message : 'task_cancel_failed'))}>Остановить задачу</button>}</article>)}</div> : <p className="mao-director-note">Задачи появятся из серверного снимка и журнала событий. Запланированные подзадачи появятся из серверного плана.</p>}
    </section>
    <section className="mao-director-grid"><div><small>Runtime</small><strong>{props.runtimeStatus.label ?? (props.runtimeStatus.available ? 'Доступен' : 'Недоступен')}</strong><span>{props.runtimeStatus.blockers?.join(', ') || props.runtimeStatus.runtimeId || 'причина не передана'}</span></div><div><small>Автономность и лимит</small><strong>до {props.resourceData?.maxActiveLlm ?? 2} активных LLM</strong><span>Текущий бюджет: {props.budgetStatus.used !== undefined && props.budgetStatus.limit !== undefined ? `${props.budgetStatus.used} / ${props.budgetStatus.limit} ${props.budgetStatus.currency ?? ''}` : props.budgetStatus.label ?? props.budgetStatus.status ?? 'нет подтверждённых данных'}</span></div><div><small>Поток выполнения</small><strong>{props.connection === 'live' ? 'SSE · LIVE' : props.connection === 'demo' ? 'FIXTURE' : 'NOT CONNECTED'}</strong><span>События и результат показываются только после подтверждения backend.</span></div></section>
    <section className="mao-director-section"><div className="mao-director-title"><h3>Журнал событий</h3><span>{props.events.length} получено</span></div><div className="mao-director-event-list">{props.events.slice(-12).reverse().map((event, index) => <div key={event.id ?? `${event.timestamp}-${index}`}><strong>{event.type}</strong><small>{event.timestamp} · {event.taskId ?? event.employeeId ?? event.projectId ?? 'событие MAO'}</small></div>)}{!props.events.length && <p className="mao-director-note">Сервер ещё не передал события.</p>}</div></section>
  </section>
}
