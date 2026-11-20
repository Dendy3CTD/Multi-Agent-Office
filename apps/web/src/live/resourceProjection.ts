export type ResourceReadiness = 'registered' | 'verified' | 'unavailable'

export interface ModelUsageView {
  input?: number
  output?: number
  cachedInput?: number
  reasoning?: number
  reportedTotal?: number
  costUsd?: number
  costKnown: boolean
}

export interface ModelResourceView {
  runtimeId: string
  modelId: string
  status: ResourceReadiness
  blockers: readonly string[]
  usage: ModelUsageView
}

export interface RuntimeResourceView {
  runtimeId: string
  status: ResourceReadiness
  blockers: readonly string[]
}

export interface ResourceProjection {
  runtimes: readonly RuntimeResourceView[]
  models: readonly ModelResourceView[]
  allowanceLabel: string
  runningProcessCount?: number
  maxActiveLlm: 2
}

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
}

function list(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function text(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined }
function metric(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined }

function normalizedBlockers(runtime: RecordValue | undefined): string[] {
  if (!runtime) return ['runtime_not_registered']
  const readiness = record(runtime.readiness)
  const supplied = [...list(runtime.blockers), ...list(readiness?.restrictions)]
  return [...new Set(supplied.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 16))]
}

function runtimeState(runtime: RecordValue | undefined): ResourceReadiness {
  if (!runtime || runtime.registered === false || runtime.available === false) return 'unavailable'
  const readiness = record(runtime.readiness)
  const authentication = record(runtime.authentication)
  if (readiness?.ready === true && authentication?.verified === true) return 'verified'
  return 'registered'
}

function modelState(runtime: RecordValue | undefined, model: RecordValue, modelId: string): { status: ResourceReadiness; blockers: string[] } {
  if (model.enabled === false) return { status: 'unavailable', blockers: ['model_disabled'] }
  const state = runtimeState(runtime)
  if (state === 'unavailable') return { status: state, blockers: normalizedBlockers(runtime) }
  const supported = runtime?.supportedModels
  if (supported === '*') {
    return { status: state === 'verified' ? 'verified' : 'registered', blockers: normalizedBlockers(runtime) }
  }
  if (Array.isArray(supported) && !supported.includes(modelId)) {
    return { status: 'unavailable', blockers: [...normalizedBlockers(runtime), 'model_not_supported_by_runtime'] }
  }
  if (state === 'verified' && Array.isArray(supported) && supported.includes(modelId)) {
    return { status: 'verified', blockers: normalizedBlockers(runtime) }
  }
  return { status: 'registered', blockers: normalizedBlockers(runtime) }
}

function usageFor(value: unknown): ModelUsageView {
  const source = record(value) ?? {}
  const eventCount = metric(source.eventCount)
  const knownCount = metric(source.costUsdKnownEventCount)
  const unknownCount = metric(source.costUsdUnknownEventCount)
  const costKnown = knownCount !== undefined && knownCount > 0 && unknownCount === 0 && (eventCount === undefined || knownCount === eventCount)
  return {
    input: metric(source.input),
    output: metric(source.output),
    cachedInput: metric(source.cacheRead),
    reasoning: metric(source.reasoning),
    // `total` is the server reported total. Cached input is intentionally not added again.
    reportedTotal: metric(source.total) ?? metric(source.totalTokens),
    costUsd: costKnown ? metric(source.costUsd) : undefined,
    costKnown,
  }
}

export function projectResources(input: { models?: unknown; runtimes?: unknown; usage?: unknown; budget?: unknown }): ResourceProjection {
  const runtimeRecords = list(input.runtimes).map(record).filter((item): item is RecordValue => Boolean(item))
  const runtimeById = new Map<string, RecordValue>()
  for (const runtime of runtimeRecords) {
    const runtimeId = text(runtime.runtimeId)
    if (runtimeId) runtimeById.set(runtimeId, runtime)
  }
  const runtimeViews = [...runtimeById.entries()].map(([runtimeId, runtime]) => ({ runtimeId, status: runtimeState(runtime), blockers: normalizedBlockers(runtime) }))
  const usageEnvelope = record(input.usage)
  const totals = record(usageEnvelope?.totals)
  const budget = record(input.budget)
  const monthlyUsage = record(budget?.monthlyUsage)
  const byModel = record(totals?.byModel) ?? record(monthlyUsage?.byModel) ?? {}
  const models: ModelResourceView[] = []
  for (const candidate of list(input.models)) {
    const model = record(candidate)
    const modelId = model && text(model.id)
    if (!model || !modelId) continue
    const declaredRuntimeIds = list(model.runtimeIds).filter((value): value is string => typeof value === 'string' && value.length > 0)
    for (const runtimeId of declaredRuntimeIds) {
      const runtime = runtimeById.get(runtimeId)
      const readiness = modelState(runtime, model, modelId)
      models.push({
        runtimeId,
        modelId,
        status: readiness.status,
        blockers: readiness.blockers,
        usage: usageFor(byModel[modelId]),
      })
    }
  }
  const allowance = text(budget?.allowanceStatus) ?? text(monthlyUsage?.allowanceStatus)
  return {
    runtimes: runtimeViews,
    models,
    allowanceLabel: allowance === 'available' ? 'Доступно по данным API' : allowance === 'blocked' ? 'Заблокировано политикой API' : 'Нет данных',
    // Neither /v1/status nor the current runtime diagnostics provide a verified process count.
    runningProcessCount: undefined,
    maxActiveLlm: 2,
  }
}

