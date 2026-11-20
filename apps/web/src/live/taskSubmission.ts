import type { TaskSubmissionPayload } from '../office-ui/taskComposer'
export type { TaskSubmissionPayload } from '../office-ui/taskComposer'

declare global {
  interface ImportMetaEnv { readonly VITE_MAO_TASK_WRITES_ENABLED?: boolean }
}

export const taskWritesEnabled = import.meta.env.VITE_MAO_TASK_WRITES_ENABLED === true

export interface TaskPreview {
  previewId: string
  expiresAt: string
  checks?: Record<string, unknown>
  resolved?: { runtimeId?: string; modelId?: string }
}

export interface AcceptedTaskResponse {
  task?: { id?: string; status?: string; title?: string }
}

export class TaskSubmissionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'TaskSubmissionError'
  }
}

const acceptedKeys = new Set<string>()
const activeKeys = new Set<string>()

const statusCopy: Record<number, { code: string; message: string }> = {
  401: { code: 'authentication_required', message: 'Backend не авторизовал запрос.' },
  403: { code: 'access_denied', message: 'Backend отклонил доступ.' },
  409: { code: 'conflict', message: 'Предварительная проверка не пройдена. Проверьте allowance или обновите preview.' },
  422: { code: 'validation_error', message: 'Backend отклонил поля задания. Проверьте проект, название, brief и критерии.' },
  428: { code: 'confirmation_required', message: 'Требуется действующий preview и явное подтверждение.' },
  429: { code: 'concurrency_limit', message: 'Достигнут лимит одновременных LLM-запусков. Повторите preview позже.' },
  503: { code: 'submission_unavailable', message: 'Серверная очередь или хранилище сейчас недоступны.' },
}

async function requestJson(path: string, init: RequestInit, fetcher: typeof fetch): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: Response
  try { response = await fetcher(path, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }) }
  catch { throw new TaskSubmissionError(0, 'network_error', 'Нет ответа от локального API proxy. Попробуйте повторить запрос с тем же ключом.') }
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await response.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
  } catch { /* response details are intentionally not copied into errors */ }
  if (!response.ok) {
    const mapped = statusCopy[response.status] ?? { code: 'request_failed', message: `Запрос отклонён сервером (HTTP ${response.status}).` }
    const rawError = body.error && typeof body.error === 'object' ? body.error as Record<string, unknown> : undefined
    const rawCode = typeof rawError?.code === 'string' ? rawError.code : undefined
    if (response.status === 409 && rawCode === 'budget_allowance_unknown') throw new TaskSubmissionError(409, rawCode, 'Публикация остановлена: backend не подтвердил allowance. Данные об остатке недоступны.')
    if (response.status === 409 && rawCode === 'preview_expired') throw new TaskSubmissionError(409, rawCode, 'Preview истёк. Запустите предварительную проверку ещё раз.')
    throw new TaskSubmissionError(response.status, mapped.code, mapped.message)
  }
  return { status: response.status, body }
}

export async function requestTaskPreflight(payload: TaskSubmissionPayload, fetcher: typeof fetch = fetch): Promise<TaskPreview> {
  const { status, body } = await requestJson('/__mao_api/v1/tasks/preflight', {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }, fetcher)
  const preview = body.preview && typeof body.preview === 'object' ? body.preview as Record<string, unknown> : undefined
  const previewId = typeof preview?.id === 'string' ? preview.id : undefined
  const expiresAt = typeof preview?.expiresAt === 'string' ? preview.expiresAt : undefined
  if (status !== 200 || !previewId || !/^preview-[a-f0-9]{36}$/.test(previewId) || !expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
    throw new TaskSubmissionError(502, 'invalid_preview', 'Backend вернул некорректный или уже истёкший preview.')
  }
  const resolvedRaw = body.resolved && typeof body.resolved === 'object' ? body.resolved as Record<string, unknown> : undefined
  return {
    previewId,
    expiresAt,
    checks: body.checks && typeof body.checks === 'object' ? body.checks as Record<string, unknown> : undefined,
    resolved: resolvedRaw ? {
      ...(typeof resolvedRaw.runtimeId === 'string' ? { runtimeId: resolvedRaw.runtimeId } : {}),
      ...(typeof resolvedRaw.modelId === 'string' ? { modelId: resolvedRaw.modelId } : {}),
    } : undefined,
  }
}

export async function confirmTaskSubmission(
  payload: TaskSubmissionPayload,
  preview: TaskPreview,
  idempotencyKey: string,
  confirmed: boolean,
  fetcher: typeof fetch = fetch,
): Promise<AcceptedTaskResponse> {
  if (!confirmed) throw new TaskSubmissionError(428, 'user_confirmation_required', 'Подтвердите проверенный preview перед отправкой.')
  if (!/^preview-[a-f0-9]{36}$/.test(preview.previewId) || !Number.isFinite(Date.parse(preview.expiresAt)) || Date.parse(preview.expiresAt) <= Date.now()) {
    throw new TaskSubmissionError(409, 'preview_expired', 'Preview истёк. Запустите предварительную проверку ещё раз.')
  }
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new TaskSubmissionError(428, 'idempotency_key_required', 'Не удалось создать безопасный ключ отправки.')
  if (activeKeys.has(idempotencyKey) || acceptedKeys.has(idempotencyKey)) throw new TaskSubmissionError(409, 'duplicate_submission_blocked', 'Эта отправка уже выполняется или была принята.')

  activeKeys.add(idempotencyKey)
  try {
    const { status, body } = await requestJson('/__mao_api/v1/tasks', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ ...payload, previewId: preview.previewId, confirmed: true }),
    }, fetcher)
    if (status !== 202) throw new TaskSubmissionError(status, 'unexpected_submit_status', 'Сервер не подтвердил принятие задания в очередь.')
    acceptedKeys.add(idempotencyKey)
    return body as AcceptedTaskResponse
  } finally {
    activeKeys.delete(idempotencyKey)
  }
}

export function createIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (!uuid) throw new TaskSubmissionError(0, 'secure_random_unavailable', 'Браузер не предоставил криптографический генератор ключа.')
  return `mao-${uuid}`
}
