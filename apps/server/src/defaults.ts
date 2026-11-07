import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { MarkdownArchive, type Archive, type ArchiveEvent } from "@open-agent-office/archive";
import { BudgetManager, type CashPayment, type CashPaymentStore, type UsageStore } from "@open-agent-office/budget-manager";
import { seedDirectory } from "@open-agent-office/directory";
import { ExecutionCoordinator, ProjectPortfolio, ResourceAllocator, RuntimeManager, TaskScheduler } from "@open-agent-office/orchestrator";
import { createModelCatalog, ModelGateway } from "@open-agent-office/model-manager";
import { createCodexRuntimeAdapter, ProductionCodexBackend } from "@open-agent-office/runtime-codex";
import { createOpenCodeRuntimeAdapter, ProductionOpenCodeBackend } from "@open-agent-office/runtime-opencode";
import type { ModelDescriptor, RuntimeAdapter, RuntimeCapabilities, RuntimeEvent, RuntimeTask, RuntimeExecutionCallbacks, UsageRecord } from "@open-agent-office/shared";
import { createMaoServer, type MaoServer, type ServerOptions } from "./http.js";
import { DeliveryJournal } from "./delivery-journal.js";
import { loadLocalRuntimeConfiguration, registerProductionCodex, registerProductionOpenCode, resolveProductionCodexConfiguration, resolveProductionOpenCodeConfiguration, type ProductionCodexConfiguration, type ProductionOpenCodeConfiguration } from "./runtime-config.js";

function contained(root: string, candidate: string): boolean { const rel = relative(root, candidate); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`)); }
async function createConfiguredArchive(): Promise<Archive | undefined> { const configured = process.env.MAO_ARCHIVE_ROOT; if (!configured) return undefined; const root = resolve(configured); const canonical = await realpath(root).catch(() => root); const cwd = resolve(process.cwd()); const home = resolve(homedir()); const allowed = contained(home, canonical) || canonical === "/tmp" || canonical.startsWith("/tmp/"); if (!allowed || canonical === "/" || contained(cwd, canonical)) return undefined; return new MarkdownArchive({ vaultRoot: canonical }); }
async function createConfiguredJournal(): Promise<DeliveryJournal | undefined> { const configured = process.env.MAO_DELIVERY_JOURNAL; const archiveRoot = process.env.MAO_ARCHIVE_ROOT; const candidate = configured ?? (archiveRoot ? join(resolve(archiveRoot), ".oao-delivery", "events.jsonl") : undefined); if (!candidate) return undefined; const path = resolve(candidate); const canonicalParent = await realpath(resolve(path, "..")).catch(() => resolve(path, "..")); const home = resolve(homedir()); const allowed = contained(home, canonicalParent) || canonicalParent === "/tmp" || canonicalParent.startsWith("/tmp/"); if (!allowed || contained(resolve(process.cwd()), path)) return undefined; return new DeliveryJournal(path); }
function archiveEvent(event: { readonly type: string; readonly timestamp: string; readonly taskId: string; readonly projectId: string; readonly employeeId?: string; readonly attempt?: number; readonly modelId?: string; readonly runtimeId?: string; readonly reason?: string }): ArchiveEvent { const eventId = [event.type, event.taskId, event.attempt ?? 0, event.employeeId ?? "", event.modelId ?? "", event.runtimeId ?? ""].map(value => encodeURIComponent(String(value))).join(":"); return { eventId, timestamp: event.timestamp, type: event.type, taskId: event.taskId, projectId: event.projectId, employeeId: event.employeeId, modelId: event.modelId, runtimeId: event.runtimeId, payload: event.reason ? { reason: event.reason, attempt: event.attempt } : { attempt: event.attempt } }; }

function createConfiguredCodexAdapter(config: ProductionCodexConfiguration | undefined): RuntimeAdapter | undefined {
  if (!config || config.adapter || config.enabled !== true) return config?.adapter;
  if (config.modelIds === undefined || config.modelIds.length === 0 || !config.allowedCwdRoots || config.allowedCwdRoots.length === 0) return undefined;
  try {
    return createCodexRuntimeAdapter({ backend: new ProductionCodexBackend({
      command: config.command,
      supportedModels: config.modelIds,
      provider: config.provider,
      authenticated: config.authenticationVerified === true,
      available: config.availabilityVerified === true,
      allowedCwdRoots: config.allowedCwdRoots,
      version: config.checkedAt,
    }) });
  } catch {
    return undefined;
  }
}

function createConfiguredOpenCodeAdapter(config: ProductionOpenCodeConfiguration | undefined): RuntimeAdapter | undefined {
  if (!config || config.adapter || config.enabled !== true) return config?.adapter;
  if (config.modelIds === undefined || config.modelIds.length === 0 || !config.allowedCwdRoots || config.allowedCwdRoots.length === 0) return undefined;
  try {
    return createOpenCodeRuntimeAdapter({ runtime: new ProductionOpenCodeBackend({
      command: config.command,
      supportedModels: config.modelIds,
      provider: config.provider,
      authenticated: config.authenticationVerified === true,
      available: config.availabilityVerified === true,
      allowedCwdRoots: config.allowedCwdRoots,
      version: config.checkedAt,
    }) });
  } catch {
    return undefined;
  }
}

const memoryStore = (): UsageStore => { const records: UsageRecord[] = []; return { async appendUsage(record) { if (records.some(x => x.eventId === record.eventId)) return false; records.push(structuredClone(record)); return true; }, async readUsage() { return structuredClone(records); } }; };
const paymentStore = (): CashPaymentStore => { const records = new Map<string, CashPayment>(); return { async appendPayment(payment) { if (records.has(payment.paymentId)) return false; records.set(payment.paymentId, structuredClone(payment)); return true; }, async readPayments() { return [...records.values()].map(payment => structuredClone(payment)); } }; };
class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly id = "fake"; private readonly runtimeCapabilities: RuntimeCapabilities = { runtimeId: "fake", runtimeType: "opencode", supportedProviders: ["fake"], supportedModels: ["fake/model"], session: false, cancel: true, usage: true };
  capabilities(): RuntimeCapabilities { return this.runtimeCapabilities; }
  async execute(task: RuntimeTask, callbacks: RuntimeExecutionCallbacks) { callbacks.onEvent?.({ type: "message", runtimeId: "fake", payload: { synthetic: true } }); callbacks.onUsage?.({ input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 2, costUsd: 0 }, { type: "usage", runtimeId: "fake", payload: {} }); return { runtimeId: "fake", text: `synthetic result for ${task.title ?? task.executionId}`, events: [] as readonly RuntimeEvent[] }; }
  async cancel(): Promise<void> { return undefined; }
}
export async function createDefaultMaoServer(options: Omit<Partial<ServerOptions>, "directory" | "portfolio" | "scheduler" | "runtimeManager" | "budget" | "models" | "coordinator" | "runtimeReadiness"> & { token?: string; productionCodex?: ProductionCodexConfiguration; productionOpenCode?: ProductionOpenCodeConfiguration } = {}): Promise<MaoServer> { const local = await loadLocalRuntimeConfiguration(); const archiveErrors: string[] = []; const archive = options.archive ?? await createConfiguredArchive(); if (process.env.MAO_ARCHIVE_ROOT && !archive && !options.archive) archiveErrors.push("invalid_archive_root"); const journal = options.deliveryJournal ?? (archive ? await createConfiguredJournal() : undefined); if (archive && journal) { try { await journal.open(); await journal.replay(event => archive.recordEvent(event).then(() => undefined)); } catch { archiveErrors.push("journal_unavailable"); } if (!journal.diagnostics().journalHealthy) archiveErrors.push(journal.diagnostics().lastErrorCode ?? "journal_unhealthy"); } const directory = seedDirectory(); const portfolio = new ProjectPortfolio(); const employeeSnapshots = directory.employees.list().map(employee => { const profession = directory.professions.get(employee.professionId); return { id: employee.id, departmentId: profession.departmentId, professionId: profession.id, status: employee.status, availableSkillIds: [], capabilityRequirements: profession.capabilityRequirements }; }); const allocator = new ResourceAllocator(employeeSnapshots, portfolio); const scheduler = new TaskScheduler(portfolio, allocator); const runtimeManager = new RuntimeManager(); runtimeManager.register(new FakeRuntimeAdapter()); const configuredCodex = await resolveProductionCodexConfiguration(options.productionCodex ?? local.codex); const codexAdapter = createConfiguredCodexAdapter(configuredCodex); const codex = registerProductionCodex(runtimeManager, codexAdapter ? { ...configuredCodex, adapter: codexAdapter } : configuredCodex); const configuredOpenCode = await resolveProductionOpenCodeConfiguration(options.productionOpenCode ?? local.openCode); const openCodeAdapter = createConfiguredOpenCodeAdapter(configuredOpenCode); const openCode = registerProductionOpenCode(runtimeManager, openCodeAdapter ? { ...configuredOpenCode, adapter: openCodeAdapter } : configuredOpenCode); const budget = new BudgetManager(memoryStore(), { paymentStore: paymentStore(), policy: { monthlyBudgetRub: 2000, subscriptionCostRub: null } }); const fakeModel: ModelDescriptor = { id: "fake/model", provider: "fake", runtimeIds: ["fake"], tier: "strong", capabilities: ["code", "reasoning", "vision", "long-context"], relativeCost: 0, enabled: true, paidExternal: false, expenseCategory: "free" }; const models: readonly ModelDescriptor[] = createModelCatalog([fakeModel, ...codex.models, ...openCode.models]).list(); const gateway = new ModelGateway(createModelCatalog(models)); const coordinator = new ExecutionCoordinator({ onEvent: event => { const archived = archiveEvent(event); if (archive && journal) void journal.accept(archived).then(() => journal.deliver(item => archive.recordEvent(item).then(() => undefined))).catch(() => { archiveErrors.push("journal_delivery_failed"); }); else if (archive) void archive.recordEvent(archived).catch(() => { archiveErrors.push("archive_write_failed"); }); }, portfolio, allocator, scheduler, budget, runtimeManager, directory: { getEmployeeProfile(employeeId) { const employee = directory.employees.get(employeeId); const profession = directory.professions.get(employee.professionId); return { employeeId, profession, modelDefault: "fake/model" }; }, isEmployeeActive(employeeId) { try { return directory.employees.get(employeeId).status === "active"; } catch { return false; } } }, gateway: { select(input) { return gateway.select({ ...input, employeeDefault: undefined }); } } }); return createMaoServer({ directory, portfolio, scheduler, coordinator, runtimeManager, budget, models, runtimeReadiness: [codex.readiness, openCode.readiness], archive, archiveErrors: () => [...archiveErrors], deliveryJournal: journal, deliveryDiagnostics: () => journal?.diagnostics() ?? { journalHealthy: false, pendingDeliveries: 0, replayStatus: "not_started" as const }, ...options }); }
