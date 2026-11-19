import { useState, type CSSProperties } from 'react'
import type { OfficeEmployee, OfficeTask } from '../types'
import { employeeDisplayStatus, statusLabel } from '../view-model'

export default function EmployeePanel({ employee, tasks, onClose, onFocus, onAssignTask, onOpenProfile, onOpenTask, onShowHistory }: { employee: OfficeEmployee; tasks: readonly OfficeTask[]; onClose: () => void; onFocus: () => void; onAssignTask?: () => void; onOpenProfile?: () => void; onOpenTask?: (taskId: string) => void; onShowHistory?: () => void }) {
  const [tab, setTab] = useState<'overview' | 'tasks' | 'history' | 'skills'>('overview')
  const displayStatus = employeeDisplayStatus(employee)
  const exactStatus = employee.executionStatus ?? displayStatus
  return <aside className="mao-employee-panel" aria-label={`Профиль сотрудника ${employee.name}`}>
    <div className="mao-profile-top">
      <button type="button" className="mao-icon-button" aria-label="Закрыть профиль" onClick={onClose}>×</button>
      <span className="mao-profile-avatar" style={{ '--avatar-accent': employee.avatar ?? '#e5a15d' } as CSSProperties}>{employee.name.slice(0, 1)}</span>
      <span className={`mao-profile-status status-${displayStatus}`} title={exactStatus}>{statusLabel(exactStatus)}</span>
      <h2>{employee.name}</h2><p>{employee.profession}</p>
      <small>ID: {employee.id} · {employee.departmentId} · {employee.floorId}</small>
    </div>
    <div className="mao-profile-runtime"><span><small>MODEL</small><strong>{employee.modelId ?? '—'}</strong></span><span><small>RUNTIME</small><strong>{employee.runtimeId ?? '—'}</strong></span></div>
    <nav className="mao-tabs" aria-label="Профиль сотрудника">
      {([['overview', 'Обзор'], ['tasks', `Задачи ${tasks.length || ''}`], ['history', 'История'], ['skills', 'Skills']] as const).map(([value, label]) => <button type="button" key={value} className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>{label}</button>)}
    </nav>
    <div className="mao-profile-content">
      {tab === 'overview' && <>
        <div className="mao-current-task"><span className="mao-eyebrow">ТЕКУЩАЯ ЗАДАЧА</span><strong>{employee.currentTask ?? 'Сейчас свободен'}</strong>
          {employee.currentTaskId && <small>{employee.currentTaskId}</small>}{employee.startedAt && <small>Начало: {employee.startedAt}</small>}
          {employee.error && <small className="mao-profile-error">Ошибка/блокировка: {employee.error}</small>}
          {employee.currentTask && <small className="mao-profile-artifact">Артефакт: {employee.artifact ?? 'сервер не передал публичный артефакт'}</small>}
          {employee.resultSummary && <small>Результат: {employee.resultSummary}</small>}
        </div>
        <div className="mao-action-grid">
          <button type="button" onClick={onFocus}>⌖ Фокус камеры</button>
          <button type="button" onClick={onOpenProfile} disabled={!onOpenProfile} title={!onOpenProfile ? 'Действие пока недоступно' : undefined}>Профиль</button>
          <button type="button" onClick={onAssignTask} disabled={!onAssignTask} title={!onAssignTask ? 'Назначение создаёт задачу через панель директора' : undefined}>＋ Назначить</button>
          <button type="button" onClick={onShowHistory} disabled={!onShowHistory} title={!onShowHistory ? 'История показана ниже из событий сервера' : undefined}>История</button>
        </div>
      </>}
      {tab === 'tasks' && <div className="mao-task-stack">{tasks.length ? tasks.map(task => <button type="button" className="mao-task-row" key={task.id} onClick={() => onOpenTask?.(task.id)} disabled={!onOpenTask}><span className={`mao-task-status task-${task.status}`} /><span><strong>{task.title}</strong><small>{task.officeStatus ?? statusLabel(task.status)} {task.projectId ? `· ${task.projectId}` : ''}</small></span></button>) : <div className="mao-empty-state">Задач нет</div>}</div>}
      {tab === 'history' && <div className="mao-history-stack">{employee.recentEvents?.length ? employee.recentEvents.map((event, index) => <div className="mao-history-row" key={event.id ?? `${event.timestamp}-${index}`}><strong>{event.message ?? statusLabel(event.type)}</strong><small>{event.timestamp} · {event.taskId ?? event.projectId ?? ''}</small></div>) : <div className="mao-empty-state">История пока пуста</div>}</div>}
      {tab === 'skills' && <div className="mao-skills">{employee.skills?.length ? employee.skills.map(skill => <span key={skill}>{skill}</span>) : <div className="mao-empty-state">Skills не переданы Directory</div>}</div>}
    </div>
  </aside>
}
