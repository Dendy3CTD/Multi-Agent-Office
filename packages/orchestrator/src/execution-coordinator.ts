import { BudgetExceededError, type BudgetManager } from "@open-agent-office/budget-manager";
import type { BudgetSnapshot, ModelSelection, ModelStatsView, Profession, RuntimeCapabilities, RuntimeEvent, RuntimeResult, UsageMetrics, TaskComplexity } from "@open-agent-office/shared";
import { ProjectPortfolio } from "./portfolio-manager.js";
import { ResourceAllocator, type ResourceAssignment } from "./resource-allocator.js";
import { RuntimeManager } from "./runtime-manager.js";
import { TaskScheduler } from "./scheduler.js";

export interface ExecutionEmployeeProfile { readonly employeeId: string; readonly profession: Profession; readonly modelDefault: string; }
export interface ExecutionDirectoryPort { getEmployeeProfile(employeeId: string): ExecutionEmployeeProfile; /** Optional freshness gate: when provided, the coordinator re-checks availability before every attempt. */ isEmployeeActive?(employeeId: string): boolean; }
export interface ExecutionModelGatewayPort { select(input: { readonly subtask: { readonly id: string; readonly complexity: TaskComplexity; readonly requiredCapabilities?: readonly string[]; readonly requiredTools?: readonly string[]; readonly taskType?: string }; readonly profession: Profession; readonly estimatedInputTokens: number; readonly estimatedOutputTokens?: number; readonly employeeDefault?: string; readonly attempt: number; readonly lastFailure?: { readonly verdict: "fail" | "partial"; readonly errorClass?: string }; readonly runtimes: readonly RuntimeCapabilities[]; readonly stats: readonly ModelStatsView[]; readonly budget: BudgetSnapshot }): ModelSelection; }

export type ExecutionPhase = "queued" | "scheduled" | "admitted" | "running" | "completed" | "failed" | "cancelled";
export interface ExecutionRequest { readonly taskId: string; readonly projectId: string; readonly title: string; readonly prompt: string; readonly cwd: string; readonly complexity: TaskComplexity; readonly employeeId?: string; readonly requiredCapabilities?: readonly string[]; readonly requiredSkills?: readonly string[]; readonly requiredTools?: readonly string[]; readonly taskType?: string; readonly estimatedInputTokens: number; readonly estimatedOutputTokens?: number; readonly estimatedCostUsd?: number; readonly estimatedTotalTokens?: number; readonly estimatedDurationMs?: number; readonly allowPaidExternal?: boolean; readonly maxAttempts?: number; }
export interface ExecutionEvent { readonly type: "task_scheduled" | "task_started" | "task_completed" | "task_failed" | "task_cancelled" | "budget_blocked" | "model_escalated" | "resource_released"; readonly timestamp: string; readonly taskId: string; readonly projectId: string; readonly employeeId?: string; readonly attempt?: number; readonly modelId?: string; readonly runtimeId?: string; readonly reason?: string; }
export interface ExecutionSnapshot { readonly taskId: string; readonly projectId: string; readonly phase: ExecutionPhase; readonly attempt: number; readonly employeeId?: string; readonly selection?: ModelSelection; readonly result?: RuntimeResult; readonly error?: { readonly code: string; readonly message: string }; }
export interface ExecutionOutcome { readonly phase: "completed" | "failed" | "cancelled" | "queued"; readonly snapshot: ExecutionSnapshot; readonly result?: RuntimeResult; }
export class ExecutionCoordinatorError extends Error { readonly code: "duplicate_execution" | "invalid_request" | "resource_unavailable" | "budget_blocked" | "runtime_failed" | "cancelled"; constructor(code: ExecutionCoordinatorError["code"], message: string) { super(message); this.name = "ExecutionCoordinatorError"; this.code = code; } }

interface MutableExecution { snapshot: ExecutionSnapshot; request: ExecutionRequest; assignment?: ResourceAssignment; selection?: ModelSelection; promise?: Promise<ExecutionOutcome>; cancelRequested: boolean; abortController?: AbortController; /** Guard against a second active attempt: set while executeAttempts is in flight. */ running?: Promise<unknown>; resolveCompletion?: (outcome: ExecutionOutcome) => void; completion?: Promise<ExecutionOutcome>; }
export interface ExecutionDiagnosticsEntry { readonly taskId: string; readonly projectId: string; readonly phase: ExecutionPhase; readonly attempt: number; readonly employeeId?: string; readonly modelId?: string; readonly runtimeId?: string; readonly error?: { readonly code: string; readonly message: string }; readonly cancelRequested: boolean; readonly waiting: boolean; readonly inFlight: boolean; }
export interface ExecutionDiagnostics { readonly version: 1; readonly generatedAt: string; readonly waiting: readonly ExecutionDiagnosticsEntry[]; readonly active: readonly ExecutionDiagnosticsEntry[]; readonly incomplete: readonly ExecutionDiagnosticsEntry[]; readonly counts: Readonly<Partial<Record<ExecutionPhase, number>>>; readonly entries: readonly ExecutionDiagnosticsEntry[]; }
const isoNow = () => new Date().toISOString();
const safeError = (error: unknown): { code: string; message: string } => { if (error instanceof BudgetExceededError) return { code: "budget_blocked", message: error.reason }; if (error && typeof error === "object" && "code" in error) return { code: String((error as { code: unknown }).code), message: error instanceof Error ? error.message : "execution failed" }; return { code: "runtime_failed", message: error instanceof Error ? error.message : "execution failed" }; };

export interface ExecutionCoordinatorOptions { readonly portfolio: ProjectPortfolio; readonly allocator: ResourceAllocator; readonly scheduler: TaskScheduler; readonly budget: BudgetManager; readonly runtimeManager: RuntimeManager; readonly directory: ExecutionDirectoryPort; readonly gateway: ExecutionModelGatewayPort; readonly stats?: readonly never[]; readonly onEvent?: (event: ExecutionEvent) => void; }

export class ExecutionCoordinator {
  private readonly executions = new Map<string, MutableExecution>(); private readonly events: ExecutionEvent[] = [];
  /** Queued tasks waiting for resources; promoted only through the pump. */
  private waiting: MutableExecution[] = [];
  private pumpActive = false; private pumpRequeued = false;
  constructor(private readonly options: ExecutionCoordinatorOptions) {}

  dispatch(request: ExecutionRequest): Promise<ExecutionOutcome> { this.validate(request); const existing = this.executions.get(request.taskId); if (existing) return existing.promise ?? Promise.reject(new ExecutionCoordinatorError("duplicate_execution", `task ${request.taskId} is already dispatched`)); const state: MutableExecution = { request, cancelRequested: false, snapshot: { taskId: request.taskId, projectId: request.projectId, phase: "queued", attempt: 0 } }; this.executions.set(request.taskId, state); state.completion = new Promise<ExecutionOutcome>(resolve => { state.resolveCompletion = resolve; }); state.promise = this.start(state); return state.promise; }
  /** Coalesced, event-driven promotion of queued tasks; safe to call concurrently. */
  pump(): void { if (this.pumpActive) { this.pumpRequeued = true; return; } this.pumpActive = true; queueMicrotask(() => { try { this.runPumpPass(); } finally { this.pumpActive = false; } if (this.pumpRequeued) { this.pumpRequeued = false; this.pump(); } }); }
  /** Resolves with the terminal outcome of the task (for queued tasks: after a later promotion). */
  completion(taskId: string): Promise<ExecutionOutcome> { const state = this.executions.get(taskId); if (!state) throw new ExecutionCoordinatorError("invalid_request", `task ${taskId} is not dispatched`); if (["completed", "failed", "cancelled"].includes(state.snapshot.phase)) return Promise.resolve({ phase: state.snapshot.phase as ExecutionOutcome["phase"], snapshot: structuredClone(state.snapshot) }); return state.completion ?? Promise.reject(new ExecutionCoordinatorError("invalid_request", `task ${taskId} has no completion future`)); }
  /** Queued tasks that have not obtained a resource assignment yet. */
  listWaiting(): readonly { readonly taskId: string; readonly projectId: string }[] { return this.waiting.map(state => ({ taskId: state.request.taskId, projectId: state.request.projectId })); }
  cancel(taskId: string): boolean { const state = this.executions.get(taskId); if (!state || ["completed", "failed", "cancelled"].includes(state.snapshot.phase)) return false; state.cancelRequested = true; state.abortController?.abort(new ExecutionCoordinatorError("cancelled", "execution cancelled")); if (state.snapshot.phase === "queued" || state.snapshot.phase === "scheduled") { const cancelled = this.options.scheduler.cancel(taskId); if (cancelled) { this.setPhase(state, "cancelled"); this.waiting = this.waiting.filter(x => x !== state); this.emit({ type: "task_cancelled", timestamp: isoNow(), taskId, projectId: state.request.projectId, reason: "cancelled while queued" }); state.resolveCompletion?.({ phase: "cancelled", snapshot: structuredClone(state.snapshot) }); return true; } } const handle = this.options.runtimeManager.listActiveExecutions().find(x => String(x.executionId) === `${taskId}:attempt:${state.snapshot.attempt}`); if (handle) void this.options.runtimeManager.cancel(handle).catch(() => undefined); return true; }
  snapshot(taskId: string): ExecutionSnapshot | undefined { const state = this.executions.get(taskId); return state ? structuredClone(state.snapshot) : undefined; }
  listEvents(): readonly ExecutionEvent[] { return this.events.map(event => structuredClone(event)); }

  /**
   * Serializable, secret-free diagnostic state for recovery tooling. Contains
   * identifiers, phases and typed errors only — never prompts, cwd or runtime
   * payloads. Version 1 until a durable persistence contract stabilises it.
   */
  diagnostics(): ExecutionDiagnostics {
    const entries: ExecutionDiagnosticsEntry[] = [];
    for (const state of this.executions.values()) {
      entries.push({
        taskId: state.request.taskId,
        projectId: state.request.projectId,
        phase: state.snapshot.phase,
        attempt: state.snapshot.attempt,
        employeeId: state.snapshot.employeeId,
        modelId: state.snapshot.selection?.modelId,
        runtimeId: state.snapshot.selection?.runtimeId,
        error: state.snapshot.error,
        cancelRequested: state.cancelRequested,
        waiting: this.waiting.includes(state),
        inFlight: state.snapshot.phase === "scheduled" || state.snapshot.phase === "admitted" || state.snapshot.phase === "running",
      });
    }
    const counts = entries.reduce((map, entry) => { map[entry.phase] = (map[entry.phase] ?? 0) + 1; return map; }, {} as Record<ExecutionPhase, number>);
    return Object.freeze({
      version: 1 as const,
      generatedAt: isoNow(),
      waiting: entries.filter(x => x.waiting),
      active: entries.filter(x => x.inFlight),
      incomplete: entries.filter(x => !["completed", "failed", "cancelled"].includes(x.phase)),
      counts,
      entries,
    });
  }

  private async start(state: MutableExecution): Promise<ExecutionOutcome> { const { request } = state; try { const queued = this.options.scheduler.enqueue({ taskId: request.taskId, projectId: request.projectId, priority: "normal", employeeId: request.employeeId, requiredCapabilities: request.requiredCapabilities, requiredSkills: request.requiredSkills }); this.setPhase(state, "scheduled"); this.emit({ type: "task_scheduled", timestamp: isoNow(), taskId: request.taskId, projectId: request.projectId });     const plan = this.options.scheduler.schedule(1); state.assignment = plan.assigned.find(x => x.taskId === request.taskId); if (!state.assignment) { this.setPhase(state, "queued"); // The task stays queued and is promoted later by the event-driven pump (§ MAO-CORE-13).
      this.waiting.push(state); return { phase: "queued", snapshot: structuredClone(state.snapshot) }; } const outcome = await this.executeAttempts(state, queued); if (this.isTerminalOut(outcome)) state.resolveCompletion?.(outcome); return outcome;
    } catch (error) { this.fail(state, error); const outcome = { phase: "failed" as const, snapshot: structuredClone(state.snapshot) }; state.resolveCompletion?.(outcome); return outcome; } }

  private async executeAttempts(state: MutableExecution, _queued: unknown): Promise<ExecutionOutcome> { const request = state.request; const employeeId = state.assignment!.employeeId; const profile = this.options.directory.getEmployeeProfile(employeeId); const maxAttempts = Math.min(Math.max(request.maxAttempts ?? 1, 1), 3); let lastFailure: { verdict: "fail"; errorClass?: string } | undefined;
    let previousModelId: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (this.options.directory.isEmployeeActive && !this.options.directory.isEmployeeActive(employeeId)) {
        if (attempt === 1 || maxAttempts === 1) { this.requeue(state); return { phase: "queued", snapshot: structuredClone(state.snapshot) }; }
        this.fail(state, new ExecutionCoordinatorError("resource_unavailable", `employee is no longer active: ${employeeId}`)); this.release(state); return { phase: "failed", snapshot: structuredClone(state.snapshot) };
      } state.snapshot = { ...state.snapshot, phase: "scheduled", attempt, employeeId }; let selection: ModelSelection; try { const budget = await this.modelBudgetSnapshot(); selection = this.options.gateway.select({ subtask: { id: request.taskId, complexity: request.complexity, requiredCapabilities: request.requiredCapabilities, requiredTools: request.requiredTools, taskType: request.taskType }, profession: profile.profession, estimatedInputTokens: request.estimatedInputTokens, estimatedOutputTokens: request.estimatedOutputTokens, employeeDefault: profile.modelDefault, attempt, lastFailure, runtimes: this.options.runtimeManager.list(), stats: this.options.stats ?? [], budget }); } catch (error) { const info = safeError(error); if (["no_eligible_model", "no_runtime_support", "resource_unavailable"].includes(info.code) && attempt === 1) { this.requeue(state); return { phase: "queued", snapshot: structuredClone(state.snapshot) }; } this.fail(state, error); this.release(state); return { phase: "failed", snapshot: structuredClone(state.snapshot) }; }
      state.selection = selection; state.snapshot = { ...state.snapshot, selection, phase: "admitted" };      let admission: Awaited<ReturnType<BudgetManager["startTask"]>> | undefined; try { admission = await this.options.budget.startTask({ taskId: `${request.taskId}:attempt:${attempt}`, agentId: employeeId, modelId: selection.modelId, projectId: request.projectId, estimatedCostUsd: request.estimatedCostUsd, estimatedTotalTokens: request.estimatedTotalTokens ?? (request.estimatedInputTokens + (request.estimatedOutputTokens ?? 0)), estimatedOutputTokens: request.estimatedOutputTokens, estimatedDurationMs: request.estimatedDurationMs, expenseCategory: selection.expenseCategory, providerId: selection.provider, paidExternal: false, allowPaidExternal: request.allowPaidExternal === true });
        if (attempt > 1 && previousModelId !== selection.modelId) this.emit({ type: "model_escalated", timestamp: isoNow(), taskId: request.taskId, projectId: request.projectId, employeeId, attempt, modelId: selection.modelId, runtimeId: selection.runtimeId, reason: "retry selection changed model" }); previousModelId = selection.modelId;
        // Cancellation decided while admission was pending must still prevent running.
        if (state.cancelRequested) { this.setPhase(state, "cancelled", { error: { code: "cancelled", message: "execution cancelled" } }); this.emit({ type: "task_cancelled", timestamp: isoNow(), taskId: request.taskId, projectId: request.projectId, employeeId, attempt, reason: "cancelled before runtime start" }); this.release(state); return { phase: "cancelled", snapshot: structuredClone(state.snapshot) }; }
        const controller = new AbortController(); state.abortController = controller; const usageWrites: Promise<void>[] = []; state.snapshot = { ...state.snapshot, phase: "running" }; this.emit({ type: "task_started", timestamp: isoNow(), taskId: request.taskId, projectId: request.projectId, employeeId, attempt, modelId: selection.modelId, runtimeId: selection.runtimeId }); const executionId = `${request.taskId}:attempt:${attempt}`;
        // Budget-side stops (duration limit, payment-driven block) must reach the runtime signal.
        const forwardAbort = () => controller.abort(admission!.abortController.signal.reason);
        if (admission!.abortController.signal.aborted) forwardAbort(); else admission!.abortController.signal.addEventListener("abort", forwardAbort, { once: true });
        const result = await this.options.runtimeManager.execute({ executionId, attempt, modelId: selection.modelId, runtimeId: selection.runtimeId, prompt: request.prompt, cwd: request.cwd, title: request.title, signal: controller.signal }, { onEvent: event => this.safeRuntimeEvent(event), onUsage: (usage, event) => { usageWrites.push(this.recordUsage(request, employeeId, selection, attempt, usage, event, admission!)); } }); await Promise.all(usageWrites);
        // A runtime that settles successfully after a cancel request must not report success.
        if (state.cancelRequested) { this.setPhase(state, "cancelled", { error: { code: "cancelled", message: "execution cancelled" } }); this.emit({ type: "task_cancelled", timestamp: isoNow(), taskId: request.taskId, projectId: request.projectId, employeeId, attempt, reason: "runtime settled after cancellation request" }); this.release(state); return { phase: "cancelled", snapshot: structuredClone(state.snapshot) }; }
        this.options.scheduler.complete(request.taskId, "completed"); this.setPhase(state, "completed", { result }); this.emit({ type: "task_completed", timestamp: isoNow(), taskId: request.taskId, projectId: request.projectId, employeeId, attempt, modelId: selection.modelId, runtimeId: selection.runtimeId }); this.release(state); return { phase: "completed", snapshot: structuredClone(state.snapshot), result };
      } catch (error) { lastFailure = { verdict: "fail", errorClass: safeError(error).code }; if (state.cancelRequested) { this.setPhase(state, "cancelled", { error: { code: "cancelled", message: "execution cancelled" } }); this.emit({ type: "task_cancelled", timestamp: isoNow(), taskId: request.taskId, projectId: request.projectId, employeeId, attempt }); this.release(state); return { phase: "cancelled", snapshot: structuredClone(state.snapshot) }; } if (attempt >= maxAttempts) { this.fail(state, error); this.release(state); return { phase: "failed", snapshot: structuredClone(state.snapshot) }; } } finally { admission?.release(); state.abortController = undefined; }
    }
    this.fail(state, new Error("retry attempts exhausted")); this.release(state); return { phase: "failed", snapshot: structuredClone(state.snapshot) };
  }

  private async recordUsage(request: ExecutionRequest, employeeId: string, selection: ModelSelection, attempt: number, usage: UsageMetrics, event: RuntimeEvent, _handle: { release(): void }): Promise<void> { try { await this.options.budget.recordUsage({ eventId: `${request.taskId}:attempt:${attempt}:usage:${event.occurredAt ?? isoNow()}`, agentId: employeeId, modelId: selection.modelId, taskId: `${request.taskId}:attempt:${attempt}`, projectId: request.projectId, input: usage.input, output: usage.output, reasoning: usage.reasoning, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, total: usage.total, costUsd: usage.costUsd }); } catch { /* Usage accounting failures never release the admission handle mid-run: the finally on the attempt releases it exactly once. */ } }
  private async modelBudgetSnapshot(): Promise<BudgetSnapshot> { const raw = await this.options.budget.getSnapshot(); const usage = raw.monthlyUsage; return { generatedAt: isoNow(), status: raw.status, allowanceStatus: "unknown", monthlyBudgetRub: raw.monthlyBudgetRub, subscriptionCostRub: raw.subscriptionCostRub, extraBudgetRemainingRub: raw.extraBudgetRemainingRub, reportedUsageUsd: raw.reportedUsageUsd, monthlyUsage: { input: usage.input, output: usage.output, reasoning: usage.reasoning, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, total: usage.total, costUsd: usage.costUsd, eventCount: usage.eventCount }, activeTaskCount: raw.activeTaskCount, subscription: raw.subscriptionUsage ? { providerId: "chatgpt-plus", subscriptionName: "ChatGPT Plus", requestsUsed: raw.subscriptionUsage.requestsUsed, requestLimit: raw.subscriptionUsage.requestLimit, approxContextTokensUsed: raw.subscriptionUsage.approxContextTokensUsed, approxContextTokensLimit: raw.subscriptionUsage.approxContextTokensLimit, periodStart: raw.subscriptionUsage.periodStart, periodEnd: raw.subscriptionUsage.periodEnd } : undefined }; }
  private validate(request: ExecutionRequest): void { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.taskId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.projectId)) throw new ExecutionCoordinatorError("invalid_request", "taskId and projectId are invalid"); if (!request.prompt.trim() || !request.cwd.startsWith("/")) throw new ExecutionCoordinatorError("invalid_request", "prompt and absolute cwd are required"); if (!Number.isFinite(request.estimatedInputTokens) || request.estimatedInputTokens < 0) throw new ExecutionCoordinatorError("invalid_request", "estimatedInputTokens is invalid"); for (const [field, value] of [["estimatedOutputTokens", request.estimatedOutputTokens], ["estimatedCostUsd", request.estimatedCostUsd], ["estimatedTotalTokens", request.estimatedTotalTokens], ["estimatedDurationMs", request.estimatedDurationMs]] as const) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new ExecutionCoordinatorError("invalid_request", `${field} is invalid`); }
  private setPhase(state: MutableExecution, phase: ExecutionPhase, extra: Partial<ExecutionSnapshot> = {}): void { state.snapshot = { ...state.snapshot, ...extra, phase }; }
  private fail(state: MutableExecution, error: unknown): void { const reason = safeError(error); this.setPhase(state, "failed", { error: reason }); this.emit({ type: reason.code === "budget_blocked" ? "budget_blocked" : "task_failed", timestamp: isoNow(), taskId: state.request.taskId, projectId: state.request.projectId, employeeId: state.assignment?.employeeId, attempt: state.snapshot.attempt, reason: reason.message }); }
  private release(state: MutableExecution): void { this.options.scheduler.complete(state.request.taskId, state.snapshot.phase === "completed" ? "completed" : "failed"); this.emit({ type: "resource_released", timestamp: isoNow(), taskId: state.request.taskId, projectId: state.request.projectId, employeeId: state.assignment?.employeeId }); // Freed resources may satisfy a queued task.
    this.pump(); }
  private requeue(state: MutableExecution): void { this.options.scheduler.complete(state.request.taskId, "cancelled"); this.options.scheduler.enqueue({ taskId: state.request.taskId, projectId: state.request.projectId, priority: "normal", employeeId: state.request.employeeId, requiredCapabilities: state.request.requiredCapabilities, requiredSkills: state.request.requiredSkills }); this.setPhase(state, "queued"); // The previously cleared assignment is gone: clear the liveness guard so the pump can promote this task again.
    state.running = undefined; state.assignment = undefined; this.waiting.push(state); }
  private isTerminalOut(outcome: ExecutionOutcome): boolean { return outcome.phase !== "queued"; }
  private runPumpPass(): void {
    const eligible = this.waiting.filter(state => !state.running && !["completed", "failed", "cancelled"].includes(state.snapshot.phase));
    if (eligible.length === 0) return;
    // A single scheduling pass keeps priority/FIFO/quota semantics for the whole waiting set.
    const plan = this.options.scheduler.schedule(eligible.length);
    for (const state of eligible) {
      const assignment = plan.assigned.find(x => x.taskId === state.request.taskId);
      if (!assignment) continue;
      try {
        this.waiting = this.waiting.filter(x => x !== state);
        if (state.cancelRequested) {
          try { this.options.scheduler.complete(state.request.taskId, "cancelled"); } catch { /* cleanup best-effort: the state is terminal regardless. */ }
          this.setPhase(state, "cancelled", { error: { code: "cancelled", message: "execution cancelled" } });
          this.emit({ type: "task_cancelled", timestamp: isoNow(), taskId: state.request.taskId, projectId: state.request.projectId, reason: "cancelled during pump" });
          state.resolveCompletion?.({ phase: "cancelled", snapshot: structuredClone(state.snapshot) });
          continue;
        }
        state.assignment = assignment;
        // Exactly-once: `running` marks the only active attempt; pump skips busy states.
        const run = this.executeAttempts(state, undefined).then(
          outcome => { if (this.isTerminalOut(outcome)) state.resolveCompletion?.(outcome); },
          error => {
            // executeAttempts never rejects on nominal flows; a cleanup crash (release failure)
            // must land in a terminal state instead of leaving an unhandled rejection behind.
            try { this.fail(state, error); this.release(state); } catch { /* still terminal below */ }
            try { this.setPhase(state, "failed"); } catch { /* ignore */ }
            state.resolveCompletion?.({ phase: "failed", snapshot: structuredClone(state.snapshot) });
          },
        );
        state.running = run;
      } catch (error) {
        // A failure while promoting one task must not poison the rest of the pass.
        this.fail(state, error);
        this.waiting = this.waiting.filter(x => x !== state);
        state.resolveCompletion?.({ phase: "failed", snapshot: structuredClone(state.snapshot) });
      }
    }
  }
  private emit(event: ExecutionEvent): void { this.events.push(event); this.options.onEvent?.(event); }
  private safeRuntimeEvent(_event: RuntimeEvent): void { /* Runtime payloads are intentionally not copied to the public event stream. */ }
}
