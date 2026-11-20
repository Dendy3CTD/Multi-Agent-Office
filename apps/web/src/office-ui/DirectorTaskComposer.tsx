import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { OfficeBudgetStatus, OfficeProject } from './types'
import { isProjectSelectionUnavailable, projectTaskRequest, type DirectorTaskDraft } from './taskComposer'
import { confirmTaskSubmission, createIdempotencyKey, requestTaskPreflight, taskWritesEnabled, type AcceptedTaskResponse, type TaskPreview } from '../live/taskSubmission'

const localDrafts = [
  { id: 'local-draft:seedsort', name: 'SeedSort' },
  { id: 'local-draft:steivo', name: 'Steivo' },
  { id: 'local-draft:smartirrigation', name: 'SmartIrrigation' },
] as const

function projectKey(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, '') }

export interface DirectorTaskComposerProps {
  projects: readonly OfficeProject[]
  projectsConfirmed: boolean
  budgetStatus: OfficeBudgetStatus
  onClose: () => void
  onAccepted?: () => Promise<void>
  writesEnabled?: boolean
}

export default function DirectorTaskComposer({ projects, projectsConfirmed, budgetStatus, onClose, onAccepted, writesEnabled = taskWritesEnabled }: DirectorTaskComposerProps) {
  const availableProjects = useMemo(() => projectsConfirmed ? projects : [], [projects, projectsConfirmed])
  const drafts = useMemo(() => localDrafts.filter(draft => !availableProjects.some(project => projectKey(project.id) === projectKey(draft.name) || projectKey(project.name) === projectKey(draft.name))), [availableProjects])
  const firstProjectId = availableProjects[0]?.id ?? drafts[0]?.id ?? ''
  const [projectId, setProjectId] = useState(firstProjectId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [criteriaText, setCriteriaText] = useState('')
  const [priority, setPriority] = useState<'normal' | 'interactive'>('normal')
  const [preview, setPreview] = useState<TaskPreview>()
  const [confirmed, setConfirmed] = useState(false)
  const [accepted, setAccepted] = useState<AcceptedTaskResponse['task']>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const idempotencyKey = useRef<string>()
  const selectedProject = availableProjects.find(project => project.id === projectId)
  const selectedDraft = drafts.find(project => project.id === projectId)
  const unavailableProjectSelection = isProjectSelectionUnavailable(projectId, availableProjects.map(project => project.id), drafts.map(project => project.id))
  const criteria = criteriaText.split('\n').map(value => value.trim()).filter(Boolean)
  const draft: DirectorTaskDraft | undefined = selectedProject
    ? { projectId: selectedProject.id, projectName: selectedProject.name, projectSource: 'api', title, description, acceptanceCriteria: criteria, priority }
    : selectedDraft
      ? { projectId: selectedDraft.id, projectName: selectedDraft.name, projectSource: 'local-draft', title, description, acceptanceCriteria: criteria, priority }
      : undefined
  const projection = (() => {
    if (!draft || draft.projectSource !== 'api') return undefined
    try { return projectTaskRequest(draft) } catch { return undefined }
  })()
  const criteriaValid = criteria.length >= 1 && criteria.length <= 12 && criteria.every(item => item.length >= 3 && item.length <= 500)
  const canPreview = Boolean(selectedProject && projection && criteriaValid)
  const previewExpired = Boolean(preview && Date.parse(preview.expiresAt) <= Date.now())
  const budgetSummary = budgetStatus.used !== undefined && budgetStatus.limit !== undefined
    ? `${budgetStatus.used} / ${budgetStatus.limit}${budgetStatus.currency ? ` ${budgetStatus.currency}` : ''} использовано`
    : budgetStatus.allowanceStatus === 'unknown' || budgetStatus.status === 'unknown' ? 'Данные о стоимости и остатке allowance недоступны' : budgetStatus.label ?? 'Точная оценка сервером не передана'

  const invalidatePreview = () => { setPreview(undefined); setConfirmed(false); setAccepted(undefined); setError(undefined) }
  const preventSubmit = (event: FormEvent) => event.preventDefault()

  const runPreflight = async () => {
    if (!writesEnabled || !projection || busy) return
    setBusy(true); setError(undefined); setAccepted(undefined); setPreview(undefined); setConfirmed(false)
    try { setPreview(await requestTaskPreflight(projection.body)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Предварительная проверка не выполнена.') }
    finally { setBusy(false) }
  }

  const submitConfirmed = async () => {
    if (!writesEnabled || !projection || !preview || !confirmed || busy || previewExpired) return
    setBusy(true); setError(undefined)
    try {
      const key = idempotencyKey.current ?? (idempotencyKey.current = createIdempotencyKey())
      const response = await confirmTaskSubmission(projection.body, preview, key, true)
      setAccepted(response.task)
      try { await onAccepted?.() }
      catch { setError('Задание принято в очередь; обновление списка задач пока не подтвердилось.') }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Задание не принято сервером.')
      if (reason && typeof reason === 'object' && 'code' in reason && (reason as { code?: unknown }).code === 'preview_expired') {
        setPreview(undefined); setConfirmed(false)
      }
    } finally { setBusy(false) }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  return <div className="mao-composer-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose() }}>
    <section className="mao-task-composer" role="dialog" aria-modal="true" aria-labelledby="mao-composer-title">
      <header className="mao-composer-head"><div><span className="mao-composer-kicker">ПОДГОТОВКА ЗАДАНИЯ</span><h2 id="mao-composer-title">Новое задание</h2><p>Соберите запрос, проверьте условия backend и подтвердите отправку.</p></div><button type="button" className="mao-icon-button" aria-label="Закрыть подготовку задания" onClick={onClose} disabled={busy}>×</button></header>

      <div className="mao-composer-grid">
        <form className="mao-composer-fields" onSubmit={preventSubmit}>
          <label>Проект
            <select value={projectId} onChange={event => { setProjectId(event.target.value); invalidatePreview() }} aria-label="Проект задания" disabled={busy || Boolean(accepted)}>
              {unavailableProjectSelection && <option value={projectId}>Недоступен: {projectId}</option>}
              {availableProjects.length > 0 && <optgroup label="Подтверждено backend API">{availableProjects.map(project => <option key={project.id} value={project.id}>{project.name}{project.status ? ` · ${project.status}` : ''}</option>)}</optgroup>}
              {drafts.length > 0 && <optgroup label="Локальные черновики · отсутствуют в API">{drafts.map(project => <option key={project.id} value={project.id}>Черновик · {project.name}</option>)}</optgroup>}
            </select>
          </label>
          {unavailableProjectSelection && <p className="mao-composer-draft-note" role="alert">Выбранный backend-проект «{projectId}» отсутствует в актуальном подтверждённом списке. Предварительная проверка и отправка заблокированы; выберите доступный проект после обновления данных.</p>}
          {selectedDraft && <p className="mao-composer-draft-note" role="status">{selectedDraft.name} — локальный черновик. Такой проект не подтверждён сервером и не может быть отправлен.</p>}
          {!availableProjects.length && !selectedDraft && <p className="mao-composer-draft-note">Backend не передал проекты. Обновите данные или выберите локальный черновик.</p>}

          <label>Название задания <span className="mao-composer-label-hint">3–160 символов</span>
            <input autoFocus value={title} onChange={event => { setTitle(event.target.value); invalidatePreview() }} minLength={3} maxLength={160} placeholder="Например: проверить новую схему лотка" aria-label="Название задания" disabled={busy || Boolean(accepted)} />
          </label>
          <label>Описание <span className="mao-composer-label-hint">10–8000 символов</span>
            <textarea value={description} onChange={event => { setDescription(event.target.value); invalidatePreview() }} minLength={10} maxLength={8000} rows={5} placeholder="Что нужно сделать и какой контекст учитывать?" aria-label="Описание задания" disabled={busy || Boolean(accepted)} />
          </label>
          <label>Критерии приёмки <span className="mao-composer-label-hint">от 1 до 12, каждый — с новой строки</span>
            <textarea value={criteriaText} onChange={event => { setCriteriaText(event.target.value); invalidatePreview() }} maxLength={6000} rows={4} placeholder={'Размеры сверены с исходными данными\nРезультат содержит ссылки на доказательства'} aria-label="Критерии приёмки" disabled={busy || Boolean(accepted)} />
          </label>
          <label>Приоритет
            <select value={priority} onChange={event => { setPriority(event.target.value as typeof priority); invalidatePreview() }} aria-label="Приоритет задания" disabled={busy || Boolean(accepted)}><option value="normal">Обычный</option><option value="interactive">Срочный</option></select>
          </label>
        </form>

        <aside className="mao-composer-preview" aria-label="Предпросмотр задания">
          <div className="mao-preview-title"><span>ПРЕДПРОСМОТР</span><strong>{accepted ? 'Принято в очередь' : preview ? 'Проверка backend пройдена' : 'Заполните обязательные поля'}</strong></div>
          <dl><dt>Проект</dt><dd>{draft?.projectName ?? 'Не выбран'}<small className={selectedProject ? 'is-confirmed' : 'is-draft'}>{selectedProject ? 'Подтверждён backend' : 'Локальный черновик'}</small></dd><dt>Название</dt><dd>{title.trim() || 'Название задания'}</dd><dt>Описание</dt><dd className="mao-preview-description">{description.trim() || 'Здесь появится описание задачи.'}</dd><dt>Приоритет</dt><dd>{priority === 'interactive' ? 'Срочный' : 'Обычный'}</dd></dl>
          <div className="mao-preview-criteria"><strong>Критерии приёмки</strong>{criteria.length ? <ul>{criteria.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>Добавьте от 1 до 12 критериев.</p>}{(criteria.length > 12 || criteria.some(item => item.length < 3 || item.length > 500)) && <p role="alert">Каждый критерий должен содержать 3–500 символов; всего нужно от 1 до 12.</p>}</div>
          {projection && <details className="mao-api-brief"><summary>Поля preflight API</summary><pre>{JSON.stringify(projection.body, null, 2)}</pre></details>}
          {preview && <div className="mao-api-projection" role="status"><strong>Preview backend действителен до</strong><small>{new Date(preview.expiresAt).toLocaleString()}</small>{preview.resolved?.runtimeId && <small>Runtime: {preview.resolved.runtimeId}</small>}{preview.resolved?.modelId && <small>Модель: {preview.resolved.modelId}</small>}<p>Проверки backend завершены. Принятие в очередь не означает выполнение.</p></div>}
          {accepted && <p className="mao-composer-accepted" role="status">Задача {accepted.id ? `${accepted.id} ` : ''}принята в очередь ({accepted.status ?? 'queued'}). Статус будет обновлён существующими GET/SSE.</p>}
          {error && <p className="mao-director-error" role="alert">{error}</p>}
          <div className="mao-limit-warning"><span aria-hidden="true">!</span><div><strong>Расход модели заранее не подтверждён</strong><p>Предварительная проверка может остановить отправку при UNKNOWN allowance. {budgetSummary}. Нулевой cost без подтверждённого поля costUsdKnown не означает бесплатный запуск.</p></div></div>
          {!writesEnabled && <p className="mao-composer-disabled-note" role="status">Запись выключена. Для локального включения требуются MAO_CORE_TASK_SUBMISSION_ACCEPTED=true и MAO_ENABLE_TASK_WRITES=true после приёмки Core.</p>}
          {selectedDraft && <p className="mao-composer-disabled-note">Локальный проект нельзя отправить: выберите проект, подтверждённый backend.</p>}
          {preview && !accepted && <label className="mao-composer-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={!writesEnabled || busy || previewExpired} />Подтверждаю отправку проверенного задания в очередь</label>}
          <div className="mao-composer-actions">
            {!preview && !accepted && <button type="button" className="mao-composer-launch" disabled={!writesEnabled || !canPreview || busy} onClick={() => void runPreflight()}>{busy ? 'Проверка…' : 'Проверить и подготовить отправку'}</button>}
            {preview && !accepted && <button type="button" className="mao-composer-launch" disabled={!writesEnabled || !confirmed || busy || previewExpired} onClick={() => void submitConfirmed()}>{busy ? 'Отправка…' : 'Подтвердить и отправить'}</button>}
            {accepted && <button type="button" className="mao-composer-launch" disabled>Принято в очередь</button>}
            {previewExpired && !accepted && <button type="button" className="mao-composer-close" onClick={invalidatePreview}>Preview истёк · перепроверить</button>}
            <button type="button" className="mao-composer-close" onClick={onClose} disabled={busy}>Закрыть</button>
          </div>
        </aside>
      </div>
    </section>
  </div>
}
