import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { OfficeUIProps } from './types'
import { employeeTasks, filterOfficeEmployees, floorSummary, statusLabel } from './view-model'
import ElevatorMenu from './components/ElevatorMenu'
import EmployeePanel from './components/EmployeePanel'
import FloorMiniMap from './components/FloorMiniMap'
import { makeTowerFloorViewModels } from './adapter'
import './office-ui.css'

export default function OfficeUI(props: OfficeUIProps) {
  const { floors, activeFloorId, onFloorSelect, employees, selectedEmployeeId, onEmployeeSelect, onCloseEmployee, currentTasks, runtimeStatus, budgetStatus } = props
  const [elevatorOpen, setElevatorOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [professionFilter, setProfessionFilter] = useState('all')
  const [occupancyFilter, setOccupancyFilter] = useState<'all' | 'busy' | 'available'>('all')
  const [railCollapsed, setRailCollapsed] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const towerFloors = useMemo(() => makeTowerFloorViewModels(floors, employees), [floors, employees])
  // Keep compatibility with scene adapters that use an existing floor id not
  // yet present in the normalized 15-floor catalog.
  const activeFloor = floors.find(floor => floor.id === activeFloorId) ?? towerFloors.find(floor => floor.id === activeFloorId) ?? towerFloors[0]
  const selectedEmployee = employees.find(employee => employee.id === selectedEmployeeId)
  // An empty search is scoped to the selected floor; an explicit query searches
  // the whole directory so an operator can find a person before moving the
  // camera/floor through the parent scene controller.
  const visibleEmployees = useMemo(() => {
    const scope = query.trim() ? employees : employees.filter(employee => employee.floorId === activeFloor?.id)
    return filterOfficeEmployees(scope, query, statusFilter, { departmentId: departmentFilter === 'all' ? undefined : departmentFilter, professionId: professionFilter === 'all' ? undefined : professionFilter, occupancy: occupancyFilter })
  }, [employees, activeFloor?.id, query, statusFilter, departmentFilter, professionFilter, occupancyFilter])
  const departments = useMemo(() => [...new Set(employees.map(employee => employee.departmentId))].sort().map(id => [id, towerFloors.find(floor => floor.departmentId === id)?.name ?? id] as const), [employees, towerFloors])
  const professions = useMemo(() => [...new Map(employees.map(employee => [employee.professionId ?? employee.profession, employee.profession])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru-RU')), [employees])
  const taskCounts = useMemo(() => ({ active: currentTasks.filter(task => ['queued', 'running'].includes(task.status)).length, done: currentTasks.filter(task => task.status === 'completed').length, failed: currentTasks.filter(task => task.status === 'failed').length }), [currentTasks])

  const selectEmployee = (employeeId: string) => {
    const employee = employees.find(item => item.id === employeeId)
    if (employee && employee.floorId !== activeFloor?.id) onFloorSelect(employee.floorId)
    onEmployeeSelect(employeeId)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (event.key === 'Escape') { setElevatorOpen(false); if (selectedEmployeeId) onCloseEmployee() }
      if (event.key === '/' && !typing) { event.preventDefault(); searchRef.current?.focus() }
      if (event.key.toLowerCase() === 'e' && !typing) setElevatorOpen(value => !value)
      if (event.key.toLowerCase() === 'i' && !typing) setRailCollapsed(value => !value)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCloseEmployee, selectedEmployeeId])

  useEffect(() => {
    if ((props.elevatorRequest ?? 0) > 0) setElevatorOpen(true)
  }, [props.elevatorRequest])

  return <div className={`mao-office-ui ${railCollapsed ? 'rail-collapsed' : ''}`} data-active-floor={activeFloor?.id} data-scene-renderer={props.sceneKind ?? 'connection'} data-startup-screen="mao-tower">
    <header className="mao-hud" aria-label="Панель управления офисом">
      <div className="mao-brand"><span className="mao-brand-mark">MA</span><div><strong>Multi-Agent Office</strong><small>Башня управления · этаж {activeFloor?.number ?? '—'}</small></div></div>
      <div className="mao-hud-metrics">
        <span className="mao-metric"><i className="mao-dot mao-dot-cyan" /> {employees.filter(employee => employee.status !== 'disabled').length} сотрудников</span>
        <span className="mao-metric"><i className="mao-dot mao-dot-orange" /> {taskCounts.active} задач в работе</span>
        <span className="mao-metric"><i className={`mao-dot ${runtimeStatus.available ? 'mao-dot-green' : 'mao-dot-red'}`} /> {runtimeStatus.label ?? (runtimeStatus.available ? 'Runtime готов' : 'Runtime недоступен')}</span>
      </div>
      <div className="mao-budget"><span>Бюджет</span><strong>{budgetStatus.used !== undefined && budgetStatus.limit !== undefined ? `${budgetStatus.used}/${budgetStatus.limit}` : (budgetStatus.label ?? budgetStatus.status ?? 'неизвестно')}</strong></div>
      <button className="mao-panel-toggle" type="button" aria-pressed={railCollapsed} aria-label={railCollapsed ? 'Показать панель этажа' : 'Скрыть панель этажа'} title={railCollapsed ? 'Показать панель (I)' : 'Скрыть панель (I)'} onClick={() => setRailCollapsed(value => !value)}>{railCollapsed ? '▣' : '◧'}<span>{railCollapsed ? 'Панели' : 'Скрыть'}</span></button>
    </header>

    <main className="mao-game-frame">
      <section className="mao-scene-viewport" aria-label={`Игровая сцена: ${activeFloor?.name ?? 'этаж'}`}>
        <aside className={`mao-elevator-shell ${elevatorOpen ? 'is-open' : ''}`}>
          <button className="mao-elevator-handle" type="button" aria-expanded={elevatorOpen} aria-controls="mao-floor-menu" onClick={() => setElevatorOpen(value => !value)}><span className="mao-elevator-icon">⇅</span><span><small>ЛИФТ</small><strong>{String(activeFloor?.number ?? '—').padStart(2, '0')}</strong></span><kbd>E</kbd></button>
          {elevatorOpen && <ElevatorMenu floors={towerFloors} activeFloorId={activeFloor?.id ?? activeFloorId} onFloorSelect={(floorId) => { onFloorSelect(floorId); setElevatorOpen(false) }} />}
        </aside>

        <div className="mao-scene-grid" aria-hidden="true" />
        {props.scene ?? props.children ?? <div className="mao-scene-connection"><span>SCENE LINK</span><strong>Сцена текущего этажа</strong><small>Компонент world подключается через children</small></div>}
        <div className="mao-camera-hud" aria-label="Управление камерой"><button type="button" title="Увеличить масштаб" aria-label="Увеличить масштаб" onClick={() => props.onCameraAction?.({ type: 'zoom-in', floorId: activeFloor?.id })}>＋</button><button type="button" title="Уменьшить масштаб" aria-label="Уменьшить масштаб" onClick={() => props.onCameraAction?.({ type: 'zoom-out', floorId: activeFloor?.id })}>−</button><button type="button" title="Показать весь этаж" onClick={() => props.onCameraAction?.({ type: 'fit-floor', floorId: activeFloor?.id })}>Весь этаж</button><button type="button" title="Сбросить камеру" aria-label="Сбросить камеру" onClick={() => props.onCameraAction?.({ type: 'reset', floorId: activeFloor?.id })}>↺</button></div>
        <div className="mao-floor-plaque"><span>ЭТАЖ {String(activeFloor?.number ?? 0).padStart(2, '0')}</span><strong>{activeFloor?.name ?? 'Нет данных'}</strong><small>{activeFloor ? floorSummary(activeFloor) : '—'}</small></div>
      </section>

      <aside className="mao-right-rail" aria-label="Управление этажом" aria-hidden={railCollapsed || undefined}>
        <div className="mao-panel mao-people-panel">
          <div className="mao-panel-heading"><div><span className="mao-eyebrow">ОТДЕЛ</span><h2>{activeFloor?.name ?? 'Нет данных'}</h2></div><span className="mao-count-pill">{visibleEmployees.length}</span></div>
          <label className="mao-search"><span>⌕</span><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти сотрудника…" aria-label="Поиск сотрудника" /><kbd>/</kbd></label>
          <div className="mao-filter-row" role="group" aria-label="Фильтр активности">{[['all', 'Все'], ['working', 'В работе'], ['idle', 'Свободны'], ['waiting', 'Ожидают']].map(([value, label]) => <button key={value} type="button" className={statusFilter === value ? 'is-active' : ''} onClick={() => setStatusFilter(value)}>{label}</button>)}</div>
          <div className="mao-filter-selects"><label>Отдел<select value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)}><option value="all">Все отделы</option>{departments.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Профессия<select value={professionFilter} onChange={event => setProfessionFilter(event.target.value)}><option value="all">Все профессии</option>{professions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Занятость<select value={occupancyFilter} onChange={event => setOccupancyFilter(event.target.value as typeof occupancyFilter)}><option value="all">Любая</option><option value="busy">Занятые</option><option value="available">Свободные</option></select></label></div>
          <div className="mao-employee-list" role="list">{visibleEmployees.length ? visibleEmployees.map(employee => <button type="button" role="listitem" className={`mao-employee-row ${selectedEmployeeId === employee.id ? 'is-selected' : ''}`} key={employee.id} onClick={() => selectEmployee(employee.id)}><span className="mao-avatar" style={{ '--avatar-accent': employee.avatar ?? '#e5a15d' } as CSSProperties}>{employee.name.slice(0, 1)}</span><span className="mao-employee-copy"><strong>{employee.name}</strong><small>{employee.profession}{query.trim() && employee.floorId !== activeFloor?.id ? ` · ${employee.floorId}` : ''}</small></span><span className={`mao-status-dot status-${employee.status}`} title={statusLabel(employee.status)} /></button>) : <div className="mao-empty-state">Сотрудников по фильтрам не нашли</div>}</div>
        </div>
        <FloorMiniMap floor={activeFloor} onCameraAction={props.onCameraAction} />
        <div className="mao-panel mao-events-panel"><div className="mao-panel-heading"><div><span className="mao-eyebrow">LIVE FEED</span><h2>События</h2></div><span className="mao-live-badge">LIVE</span></div>{(props.events ?? []).slice(0, 4).map((event, index) => <div className="mao-event-row" key={event.id ?? `${event.timestamp}-${index}`}><span className="mao-event-line" /><span><strong>{event.message ?? statusLabel(event.type)}</strong><small>{event.timestamp} {event.employeeId ? `· ${event.employeeId}` : ''}</small></span></div>)}{!(props.events ?? []).length && <div className="mao-empty-state">Лента пока пуста</div>}</div>
      </aside>
    </main>

    <div className="mao-bottom-strip"><span><i className="mao-dot mao-dot-green" /> Этаж активен</span><span>{taskCounts.done} завершено</span><span>{taskCounts.failed ? `${taskCounts.failed} с ошибкой` : 'Ошибок нет'}</span><span className="mao-shortcuts">E лифт · / поиск · Esc закрыть</span></div>
    {selectedEmployee && <EmployeePanel employee={selectedEmployee} tasks={employeeTasks(selectedEmployee, currentTasks)} onClose={onCloseEmployee} onFocus={() => { if (selectedEmployee.floorId !== activeFloor?.id) onFloorSelect(selectedEmployee.floorId); if (props.onLocateEmployee) props.onLocateEmployee(selectedEmployee.id, selectedEmployee.floorId); else props.onCameraAction?.({ type: 'focus-employee', employeeId: selectedEmployee.id, floorId: selectedEmployee.floorId }) }} onAssignTask={props.onAssignTask ? () => props.onAssignTask?.(selectedEmployee.id) : undefined} onOpenProfile={props.onOpenProfile ? () => props.onOpenProfile?.(selectedEmployee.id) : undefined} onOpenTask={props.onOpenTask} onShowHistory={props.onShowHistory ? () => props.onShowHistory?.(selectedEmployee.id) : undefined} />}
  </div>
}
