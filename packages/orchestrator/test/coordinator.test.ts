import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BudgetExceededError,
  BudgetManager,
  BudgetStoreError,
  JsonlCashPaymentStore,
  JsonlUsageStore,
  type UsageRecord,
  type UsageStore,
} from "@open-agent-office/budget-manager";
import {
  OpenCodeRuntime,
  RuntimeAbortError,
  RuntimeEventCallbackError,
  RuntimeExitError,
  RuntimeTimeoutError,
  type RuntimeEvent,
  type SpawnFunction,
} from "@open-agent-office/runtime-opencode";
import {
  AgentExecutionCoordinator,
  DuplicateTaskError,
  InvalidTaskRequestError,
  TaskBudgetStopError,
  UnknownAgentError,
  UsageRecordingError,
  type AgentTaskRequest,
} from "../src/index";

const NOW = "2026-11-02T10:00:00.000Z";
const CWD = "/tmp/oao-orchestrator-test";

type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
interface SpawnCall { command: string; args: readonly string[]; options: SpawnOptions; child: FakeChild }

/** Fake spawn: the child never exits on its own; it closes only when killed (or when the script closes it). */
function fakeSpawn(script: (child: FakeChild) => void, calls: SpawnCall[], autoClose = true): SpawnFunction {
  return ((command: string, args: readonly string[], options: SpawnOptions) => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn((signal: string) => {
      // autoClose=false models a child that is still shutting down: the test emits "close" itself.
      if (autoClose) child.emit("close", signal === "SIGKILL" ? 137 : 143);
      return true;
    });
    calls.push({ command, args, options, child });
    queueMicrotask(() => { child.emit("spawn"); script(child); });
    return child;
  }) as unknown as SpawnFunction;
}

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;
const usageEvent = (overrides: Record<string, unknown> = {}): string => line({
  type: "step_finish",
  sessionID: "ses-live",
  tokens: { input: 10, output: 5, reasoning: 2, total: 17, cache: { read: 3, write: 1 } },
  cost: 0.02,
  ...overrides,
});
const finalEvent = line({ type: "step_finish", reason: "stop" });

/** Child that writes the given lines, then finishes successfully. */
const finishing = (...lines: string[]) => (child: FakeChild) => {
  child.stdout.end(lines.join("") + finalEvent);
  setImmediate(() => child.emit("close", 0));
};
/** Child that writes the given lines and keeps running until it is killed. */
const holding = (...lines: string[]) => (child: FakeChild) => {
  child.stdout.write(lines.join(""));
};

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true });
});

interface SetupOptions {
  script?: (child: FakeChild) => void;
  policy?: Partial<import("@open-agent-office/budget-manager").BudgetPolicyConfig>;
  usageStore?: UsageStore;
  now?: () => string;
  agents?: Record<string, string>;
  /** The child does not close on kill; the test controls the close event. */
  manualClose?: boolean;
}

async function setup(options: SetupOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "oao-orch-"));
  directories.push(directory);
  const usagePath = join(directory, "usage.jsonl");
  const cashPath = join(directory, "cash-payments.jsonl");
  const calls: SpawnCall[] = [];
  const budget = new BudgetManager(options.usageStore ?? new JsonlUsageStore(usagePath), {
    now: options.now ?? (() => NOW),
    policy: { accountingTimeZone: "UTC", subscriptionCostRub: 1000, maxConcurrentTasks: 1, maxTaskDurationMs: 600_000, ...options.policy },
    paymentStore: new JsonlCashPaymentStore(cashPath),
  });
  const runtime = new OpenCodeRuntime({ spawn: fakeSpawn(options.script ?? finishing(usageEvent()), calls, !options.manualClose), terminateGraceMs: 5 });
  const coordinator = new AgentExecutionCoordinator({ runtime, budget, agents: options.agents });
  return { directory, usagePath, cashPath, calls, budget, runtime, coordinator };
}

function request(overrides: Partial<AgentTaskRequest> = {}): AgentTaskRequest {
  return { taskId: "task-1", agentId: "developer", prompt: "write tests", cwd: CWD, title: "Office task", ...overrides };
}

async function waitForSpawn(calls: SpawnCall[], count = 1): Promise<void> {
  await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(count), { timeout: 2000 });
}

describe("AgentExecutionCoordinator", () => {
  it("admits the task through Budget Manager before Runtime spawns a process", async () => {
    const order: string[] = [];
    const { budget, coordinator } = await setup({ script: (child) => { order.push("spawn"); finishing(usageEvent())(child); } });
    const start = vi.spyOn(budget, "startTask");
    start.mockImplementation(async (input) => { order.push("admitted"); return BudgetManager.prototype.startTask.call(budget, input); });
    await coordinator.runTask(request());
    expect(order).toEqual(["admitted", "spawn"]);
  });

  it("does not call Runtime or spawn when Budget Manager blocks the task", async () => {
    const { calls, coordinator, budget } = await setup({ policy: { maxReportedCostUsdPerTask: 1 } });
    await expect(coordinator.runTask(request({ estimatedCostUsd: 999 }))).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toHaveLength(0);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("selects the configured model for each of the five employees", async () => {
    const { calls, coordinator } = await setup();
    const expected: Record<string, string> = {
      director: "opencode-go/mimo-v2.6-flash",
      developer: "opencode-go/glm-5.3-flash",
      engineer: "opencode-go/qwen3.8-flash",
      analyst: "opencode-go/mimo-v2.6-flash",
      helper: "opencode-go/beam-free",
    };
    for (const [index, [agentId, modelId]] of Object.entries(expected).entries()) {
      await coordinator.runTask(request({ taskId: `model-${index}`, agentId }));
      const args = calls[index].args;
      expect(args[args.indexOf("--model") + 1]).toBe(modelId);
      expect(coordinator.modelFor(agentId)).toBe(modelId);
    }
    expect(calls).toHaveLength(5);
  });

  it("launches helper on Beam Free through the fake Runtime and records its usage", async () => {
    const { calls, coordinator, usagePath } = await setup({
      script: finishing(line({ type: "step_start", sessionID: "ses-helper" }), usageEvent({ sessionID: "ses-helper" })),
    });
    const result = await coordinator.runTask(request({ taskId: "helper-1", agentId: "helper", title: "Prepare a checklist" }));
    expect(coordinator.modelFor("helper")).toBe("opencode-go/beam-free");
    const args = calls[0].args;
    expect(args[args.indexOf("--model") + 1]).toBe("opencode-go/beam-free");
    expect(result.sessionId).toBe("ses-helper");
    const records = await new JsonlUsageStore(usagePath).readUsage();
    expect(records).toHaveLength(1);
    expect(records[0].agentId).toBe("helper");
    expect(records[0].modelId).toBe("opencode-go/beam-free");
    expect(records[0].taskId).toBe("helper-1");
    expect(records[0].sessionId).toBe("ses-helper");
  });

  it("keeps taskId, sessionId and usage of helper independent from other employees", async () => {
    const sessions = ["ses-helper-run", "ses-developer-run"];
    let spawnIndex = 0;
    const script = (child: FakeChild) => { finishing(usageEvent({ sessionID: sessions[spawnIndex++] }))(child); };
    const { calls, coordinator, usagePath } = await setup({ script });
    await coordinator.runTask(request({ taskId: "helper-indep", agentId: "helper", prompt: "collect references", sessionId: "ses-helper-base" }));
    await coordinator.runTask(request({ taskId: "dev-indep", agentId: "developer", prompt: "write module", sessionId: "ses-developer-base" }));
    expect(calls).toHaveLength(2);
    expect(calls[0].args[calls[0].args.indexOf("--session") + 1]).toBe("ses-helper-base");
    expect(calls[1].args[calls[1].args.indexOf("--session") + 1]).toBe("ses-developer-base");
    const records = await new JsonlUsageStore(usagePath).readUsage();
    expect(records.map((record) => [record.eventId, record.agentId, record.modelId, record.taskId, record.sessionId])).toEqual([
      ["helper-indep:usage:1", "helper", "opencode-go/beam-free", "helper-indep", "ses-helper-run"],
      ["dev-indep:usage:1", "developer", "opencode-go/glm-5.3-flash", "dev-indep", "ses-developer-run"],
    ]);
  });

  it("rejects an unknown employee before admission or Runtime", async () => {
    const { calls, coordinator, budget } = await setup();
    const startSpy = vi.spyOn(budget, "startTask");
    await expect(coordinator.runTask(request({ agentId: "intern" }))).rejects.toBeInstanceOf(UnknownAgentError);
    expect(startSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(() => coordinator.modelFor("intern")).toThrow(UnknownAgentError);
  });

  it("passes the budget AbortSignal to Runtime", async () => {
    const { coordinator, budget, runtime } = await setup({ script: holding(usageEvent()) });
    const run = vi.spyOn(runtime, "runTask");
    const startSpy = vi.spyOn(budget, "startTask");
    const pending = coordinator.runTask(request());
    const handle = await startSpy.mock.results[0].value;
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const passed = run.mock.calls[0][0].signal;
    expect(passed).toBe(handle.abortController.signal);
    handle.abortController.abort(new Error("external stop"));
    await expect(pending).rejects.toBeInstanceOf(RuntimeAbortError);
  });

  it("cancelTask terminates the real child with SIGTERM and waits for close", async () => {
    const { calls, coordinator } = await setup({ script: holding(usageEvent()) });
    const pending = coordinator.runTask(request());
    await waitForSpawn(calls);
    expect(coordinator.activeTaskIds()).toEqual(["task-1"]);
    expect(coordinator.cancelTask("task-1")).toBe(true);
    await expect(pending).rejects.toBeInstanceOf(RuntimeAbortError);
    expect(calls[0].child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(coordinator.activeTaskIds()).toEqual([]);
  });

  it("cancelTask is safe for unknown, finished and already cancelled tasks", async () => {
    const { calls, coordinator } = await setup({ script: holding(usageEvent()) });
    expect(coordinator.cancelTask("never-started")).toBe(false);
    const pending = coordinator.runTask(request());
    await waitForSpawn(calls);
    expect(coordinator.cancelTask("task-1")).toBe(true);
    expect(coordinator.cancelTask("task-1")).toBe(false);
    await expect(pending).rejects.toBeInstanceOf(RuntimeAbortError);
    expect(coordinator.cancelTask("task-1")).toBe(false);
  });

  it("releases the task when Runtime fails", async () => {
    const { budget, coordinator } = await setup({ script: (child) => { child.stderr.end("failed"); setImmediate(() => child.emit("close", 2)); } });
    await expect(coordinator.runTask(request())).rejects.toBeInstanceOf(RuntimeExitError);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("releases the task on Runtime timeout", async () => {
    const { budget, coordinator, calls } = await setup({ script: holding(usageEvent()) });
    await expect(coordinator.runTask(request({ timeoutMs: 20 }))).rejects.toBeInstanceOf(RuntimeTimeoutError);
    expect(calls[0].child.kill).toHaveBeenCalledWith("SIGTERM");
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("records one usage event per usage-bearing Runtime event with deterministic IDs", async () => {
    const { coordinator, usagePath } = await setup({
      script: finishing(line({ type: "text", text: "no usage" }), usageEvent(), usageEvent({ tokens: { input: 1, output: 1, total: 2 }, cost: 0.01 })),
    });
    await coordinator.runTask(request());
    const records = await new JsonlUsageStore(usagePath).readUsage();
    expect(records.map((record) => record.eventId).sort()).toEqual(["task-1:usage:1", "task-1:usage:2"]);
    expect(records.every((record) => record.agentId === "developer" && record.modelId === "opencode-go/glm-5.3-flash")).toBe(true);
  });

  it("sums recorded usage to RuntimeResult.usage and never records the aggregate as an extra event", async () => {
    const { coordinator, usagePath, budget } = await setup({
      script: finishing(usageEvent(), usageEvent({ tokens: { input: 4, output: 6, total: 10 }, cost: 0.5 })),
    });
    const result = await coordinator.runTask(request());
    const records = await new JsonlUsageStore(usagePath).readUsage();
    expect(records).toHaveLength(2);
    const summary = await budget.getUsageSummary();
    expect(summary.input).toBe(result.usage.input);
    expect(summary.output).toBe(result.usage.output);
    expect(summary.reasoning).toBe(result.usage.reasoning);
    expect(summary.cacheRead).toBe(result.usage.cacheRead);
    expect(summary.cacheWrite).toBe(result.usage.cacheWrite);
    expect(summary.total).toBe(result.usage.total);
    expect(summary.costUsd).toBeCloseTo(result.usage.cost, 10);
  });

  it("cancels the real Runtime when a usage write fails, and reports UsageRecordingError", async () => {
    const failing: UsageStore = { appendUsage: async () => { throw new Error("disk full"); }, readUsage: async () => [] };
    const { coordinator, calls } = await setup({ usageStore: failing, script: holding(usageEvent()) });
    const failure = await coordinator.runTask(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UsageRecordingError);
    expect((failure as UsageRecordingError).cause).toBeInstanceOf(BudgetStoreError);
    expect(calls[0].child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("treats a budget limit raised during usage recording as a budget stop, not a storage error", async () => {
    const { coordinator, budget } = await setup({ policy: { maxTotalTokensPerTask: 10 }, script: holding(usageEvent({ tokens: { input: 15, total: 20 } })) });
    const failure = await coordinator.runTask(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TaskBudgetStopError);
    expect(failure).not.toBeInstanceOf(UsageRecordingError);
    expect((failure as TaskBudgetStopError).reason).toContain("maximum total tokens per task exceeded");
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("stops an active task when a current-month extra payment blocks the budget", async () => {
    const { coordinator, budget, calls } = await setup({ policy: { subscriptionCostRub: 0 }, script: holding(usageEvent()) });
    const pending = coordinator.runTask(request());
    await waitForSpawn(calls);
    await budget.recordCashPayment({ paymentId: "extra-block", amountRub: 1000, timestamp: NOW });
    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TaskBudgetStopError);
    expect((failure as TaskBudgetStopError).reason).toContain("extra budget exhausted");
    expect(calls[0].child.kill).toHaveBeenCalledWith("SIGTERM");
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("keeps the slot until usage writes are durable, then releases it", async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const directory = await mkdtemp(join(tmpdir(), "oao-orch-gate-"));
    directories.push(directory);
    const inner = new JsonlUsageStore(join(directory, "usage.jsonl"));
    const gated: UsageStore = { appendUsage: async (record) => { await gate; return inner.appendUsage(record); }, readUsage: () => inner.readUsage() };
    const { coordinator, budget, calls } = await setup({ usageStore: gated, script: finishing(usageEvent()) });
    let done = false;
    const pending = coordinator.runTask(request()).then(() => { done = true; });
    await waitForSpawn(calls);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(done).toBe(false);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(1);
    openGate();
    await pending;
    expect(done).toBe(true);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
    expect(await inner.readUsage()).toHaveLength(1);
  });

  it("preserves the OpenCode session in the result and in usage records, and continues a given session", async () => {
    const { coordinator, usagePath, calls } = await setup({ script: finishing(line({ type: "step_start", sessionID: "ses-42" }), usageEvent({ sessionID: "ses-42" })) });
    const result = await coordinator.runTask(request());
    expect(result.sessionId).toBe("ses-42");
    const records = await new JsonlUsageStore(usagePath).readUsage();
    expect(records[0].sessionId).toBe("ses-42");
    await coordinator.runTask(request({ taskId: "task-2", sessionId: "ses-prev" }));
    expect(calls[1].args).toContain("--session");
    expect(calls[1].args[calls[1].args.indexOf("--session") + 1]).toBe("ses-prev");
  });

  it("keeps usage and budget totals after a new BudgetManager is created with the same paths", async () => {
    const { coordinator, usagePath, cashPath } = await setup({ script: finishing(usageEvent()) });
    const result = await coordinator.runTask(request());
    const restarted = new BudgetManager(new JsonlUsageStore(usagePath), { now: () => NOW, policy: { accountingTimeZone: "UTC" }, paymentStore: new JsonlCashPaymentStore(cashPath) });
    const summary = await restarted.getUsageSummary();
    expect(summary.total).toBe(result.usage.total);
    expect(summary.eventCount).toBe(1);
  });

  it("rejects a taskId that was already used, even after the task finished", async () => {
    const { coordinator, calls } = await setup();
    await coordinator.runTask(request());
    await expect(coordinator.runTask(request())).rejects.toBeInstanceOf(DuplicateTaskError);
    expect(calls).toHaveLength(1);
  });

  it("rejects a concurrent duplicate taskId and never spawns for it", async () => {
    const { coordinator, calls, budget } = await setup({ policy: { maxConcurrentTasks: 2 }, script: holding(usageEvent()) });
    const first = coordinator.runTask(request());
    await expect(coordinator.runTask(request())).rejects.toBeInstanceOf(DuplicateTaskError);
    await waitForSpawn(calls);
    expect(calls).toHaveLength(1);
    coordinator.cancelTask("task-1");
    await expect(first).rejects.toBeInstanceOf(RuntimeAbortError);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("enforces maxConcurrentTasks for parallel starts", async () => {
    const { coordinator, calls, budget } = await setup({ script: holding(usageEvent()) });
    const first = coordinator.runTask(request({ taskId: "parallel-a" }));
    const second = coordinator.runTask(request({ taskId: "parallel-b", agentId: "analyst" }));
    const rejected = await second.catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(BudgetExceededError);
    expect((rejected as BudgetExceededError).reason).toContain("maximum concurrent tasks");
    await waitForSpawn(calls);
    expect(calls).toHaveLength(1);
    coordinator.cancelTask("parallel-a");
    await expect(first).rejects.toBeInstanceOf(RuntimeAbortError);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("delivers usage before onEvent, so a throwing onEvent does not lose the usage event", async () => {
    const { coordinator, usagePath } = await setup({ script: finishing(usageEvent()) });
    const onEvent = vi.fn((_event: RuntimeEvent) => { throw new Error("UI failed"); });
    const failure = await coordinator.runTask(request({ onEvent })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RuntimeEventCallbackError);
    const records = await new JsonlUsageStore(usagePath).readUsage();
    expect(records).toHaveLength(1);
  });

  it("never sends the prompt or the response to Budget Manager or the usage journal", async () => {
    const { coordinator, usagePath, budget } = await setup({ script: finishing(line({ type: "text", text: "EMPLOYEE RESPONSE" }), usageEvent()) });
    const starts = vi.spyOn(budget, "startTask");
    const usages = vi.spyOn(budget, "recordUsage");
    await coordinator.runTask(request({ prompt: "SECRET PROMPT TEXT" }));
    expect(JSON.stringify(starts.mock.calls)).not.toContain("SECRET PROMPT TEXT");
    expect(JSON.stringify(usages.mock.calls)).not.toContain("EMPLOYEE RESPONSE");
    const raw = await readFile(usagePath, "utf8");
    expect(raw).not.toContain("SECRET PROMPT TEXT");
    expect(raw).not.toContain("EMPLOYEE RESPONSE");
  });

  it("rejects invalid requests, including a per-task model override, before any side effect", async () => {
    const { coordinator, calls, budget } = await setup();
    const startSpy = vi.spyOn(budget, "startTask");
    await expect(coordinator.runTask(request({ taskId: "bad id" }))).rejects.toBeInstanceOf(InvalidTaskRequestError);
    await expect(coordinator.runTask(request({ cwd: "relative" }))).rejects.toBeInstanceOf(InvalidTaskRequestError);
    await expect(coordinator.runTask(request({ estimatedCostUsd: Number.NaN }))).rejects.toBeInstanceOf(InvalidTaskRequestError);
    await expect(coordinator.runTask({ ...request({ taskId: "override" }), modelId: "opencode-go/other" } as AgentTaskRequest)).rejects.toBeInstanceOf(InvalidTaskRequestError);
    expect(startSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("does not leave active tasks behind after a normal completion", async () => {
    const { coordinator, budget } = await setup();
    await coordinator.runTask(request());
    expect(coordinator.activeTaskIds()).toEqual([]);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("uses the configured agent table and rejects an unknown configured model format", async () => {
    const { coordinator, calls } = await setup({ agents: { reviewer: "opencode-go/reviewer-model" }, script: finishing(usageEvent()) });
    await coordinator.runTask(request({ agentId: "reviewer", taskId: "custom-agent" }));
    expect(calls[0].args[calls[0].args.indexOf("--model") + 1]).toBe("opencode-go/reviewer-model");
    await expect(coordinator.runTask(request({ agentId: "developer", taskId: "not-configured" }))).rejects.toBeInstanceOf(UnknownAgentError);
    expect(() => new AgentExecutionCoordinator({ runtime: new OpenCodeRuntime(), budget: {} as BudgetManager, agents: { reviewer: "no-slash" } })).toThrow(/provider\/model/);
  });

  it("stores usage with the budget clock and keeps the usage record shape", async () => {
    const { coordinator, usagePath } = await setup({ now: () => "2026-11-02T10:30:00.000Z", script: finishing(usageEvent()) });
    await coordinator.runTask(request());
    const [record] = await new JsonlUsageStore(usagePath).readUsage() as UsageRecord[];
    expect(record.timestamp).toBe("2026-11-02T10:30:00.000Z");
    expect(record.projectId).toBeUndefined();
    expect(record.costUsd).toBe(0.02);
  });
});

describe("late budget violation (OAO-RT-003-FIX1)", () => {
  const overTokenLimit = usageEvent({ tokens: { input: 15, total: 20 } });

  it("returns TaskBudgetStopError when Runtime succeeded but a deferred usage write exposed a violation", async () => {
    const { coordinator, budget } = await setup({ policy: { maxTotalTokensPerTask: 10 }, script: finishing(overTokenLimit) });
    const failure = await coordinator.runTask(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TaskBudgetStopError);
    expect(failure).not.toBeInstanceOf(UsageRecordingError);
    expect((failure as TaskBudgetStopError).reason).toContain("maximum total tokens per task exceeded");
    expect((failure as TaskBudgetStopError).cause).toBeInstanceOf(BudgetExceededError);
    expect((failure as TaskBudgetStopError).runtimeError).toBeUndefined();
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("gives Runtime the budget AbortSignal when the violation is seen during the run", async () => {
    const { coordinator, runtime, calls } = await setup({ policy: { maxTotalTokensPerTask: 10 }, script: holding(overTokenLimit) });
    const run = vi.spyOn(runtime, "runTask");
    const failure = await coordinator.runTask(request()).catch((error: unknown) => error);
    expect(run.mock.calls[0][0].signal?.aborted).toBe(true);
    expect(calls[0].child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(failure).toBeInstanceOf(TaskBudgetStopError);
    expect((failure as TaskBudgetStopError).runtimeError).toBeInstanceOf(RuntimeAbortError);
  });

  it("waits for the usage queue after a successful Runtime run before deciding the result", async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const directory = await mkdtemp(join(tmpdir(), "oao-orch-late-"));
    directories.push(directory);
    const inner = new JsonlUsageStore(join(directory, "usage.jsonl"));
    const gated: UsageStore = { appendUsage: async (record) => { await gate; return inner.appendUsage(record); }, readUsage: () => inner.readUsage() };
    const { coordinator, budget, calls } = await setup({ usageStore: gated, policy: { maxTotalTokensPerTask: 10 }, script: finishing(overTokenLimit) });
    let settled = false;
    let outcome: unknown;
    const pending = coordinator.runTask(request()).then((value) => { settled = true; outcome = value; }, (error: unknown) => { settled = true; outcome = error; });
    await waitForSpawn(calls);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBe(false);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(1);
    openGate();
    await pending;
    expect(settled).toBe(true);
    expect(outcome).toBeInstanceOf(TaskBudgetStopError);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
    expect(await inner.readUsage()).toHaveLength(1);
  });

  it("releases the TaskHandle exactly once on success, budget stop and storage failure", async () => {
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const track = (budget: BudgetManager) => {
      const original = budget.startTask.bind(budget);
      vi.spyOn(budget, "startTask").mockImplementation(async (input) => {
        const handle = await original(input);
        const release = vi.fn(handle.release);
        handle.release = release;
        releases.push(release);
        return handle;
      });
    };
    const ok = await setup({ script: finishing(usageEvent()) });
    track(ok.budget);
    await ok.coordinator.runTask(request({ taskId: "release-ok" }));
    const budgetStop = await setup({ policy: { maxTotalTokensPerTask: 10 }, script: finishing(overTokenLimit) });
    track(budgetStop.budget);
    await budgetStop.coordinator.runTask(request({ taskId: "release-budget" })).catch(() => undefined);
    const storage = await setup({ usageStore: { appendUsage: async () => { throw new Error("disk full"); }, readUsage: async () => [] }, script: finishing(usageEvent()) });
    track(storage.budget);
    await storage.coordinator.runTask(request({ taskId: "release-storage" })).catch(() => undefined);
    expect(releases.map((release) => release.mock.calls.length)).toEqual([1, 1, 1]);
    expect((await budgetStop.budget.getSnapshot()).activeTaskCount).toBe(0);
    expect((await storage.budget.getSnapshot()).activeTaskCount).toBe(0);
  });

  it("keeps a storage failure as UsageRecordingError and attaches the budget violation that happened alongside it", async () => {
    let calls = 0;
    const directory = await mkdtemp(join(tmpdir(), "oao-orch-both-"));
    directories.push(directory);
    const inner = new JsonlUsageStore(join(directory, "usage.jsonl"));
    const flaky: UsageStore = {
      appendUsage: async (record) => {
        calls += 1;
        if (calls === 2) throw new Error("disk full on second write");
        return inner.appendUsage(record);
      },
      readUsage: () => inner.readUsage(),
    };
    const { coordinator } = await setup({
      usageStore: flaky,
      policy: { maxTotalTokensPerTask: 10 },
      script: finishing(overTokenLimit, usageEvent()),
    });
    const failure = await coordinator.runTask(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UsageRecordingError);
    expect(failure).not.toBeInstanceOf(TaskBudgetStopError);
    expect((failure as UsageRecordingError).cause).toBeInstanceOf(BudgetStoreError);
    expect((failure as UsageRecordingError).budgetStop).toBeInstanceOf(BudgetExceededError);
  });

  it("still returns the RuntimeResult for a normal task and records the usage sum without duplicates", async () => {
    const { coordinator, usagePath, budget } = await setup({ script: finishing(usageEvent()) });
    const result = await coordinator.runTask(request({ taskId: "normal" }));
    expect(result.reason).toBe("stop");
    const records = await new JsonlUsageStore(usagePath).readUsage();
    expect(records).toHaveLength(1);
    expect((await budget.getUsageSummary()).total).toBe(result.usage.total);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });
});

describe("competing cancellation causes (OAO-RT-003-FIX2)", () => {
  const overTokenLimit = usageEvent({ tokens: { input: 15, total: 20 } });

  /** Wraps startTask so the test can count how many times the handle was released. */
  function trackReleases(budget: BudgetManager): Array<ReturnType<typeof vi.fn>> {
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const original = budget.startTask.bind(budget);
    vi.spyOn(budget, "startTask").mockImplementation(async (input) => {
      const handle = await original(input);
      const release = vi.fn(handle.release);
      handle.release = release;
      releases.push(release);
      return handle;
    });
    return releases;
  }

  it("reports TaskBudgetStopError when a user cancel and a budget violation race during shutdown", async () => {
    const { coordinator, budget, calls } = await setup({
      policy: { maxTotalTokensPerTask: 10 },
      script: holding(),
      manualClose: true,
    });
    const releases = trackReleases(budget);
    const pending = coordinator.runTask(request());
    await waitForSpawn(calls);

    // 1. User cancels; Runtime starts terminating the child.
    expect(coordinator.cancelTask("task-1")).toBe(true);
    await vi.waitFor(() => expect(calls[0].child.kill).toHaveBeenCalledWith("SIGTERM"));

    // 2. Before the child closes, a usage event arrives and exceeds the token limit.
    calls[0].child.stdout.write(overTokenLimit);
    await vi.waitFor(async () => expect((await budget.getUsageSummary()).eventCount).toBe(1));

    // 3. The child finally closes; Runtime settles with its abort error.
    calls[0].child.emit("close", 143);

    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TaskBudgetStopError);
    expect(failure).not.toBeInstanceOf(UsageRecordingError);
    const stop = failure as TaskBudgetStopError;
    expect(stop.cause).toBeInstanceOf(BudgetExceededError);
    expect((stop.cause as BudgetExceededError).reason).toContain("maximum total tokens per task exceeded");
    expect(stop.reason).toContain("maximum total tokens per task exceeded");
    expect(stop.runtimeError).toBeInstanceOf(RuntimeAbortError);
    // Usage queue was drained before the error was returned: the late event is durably recorded once.
    expect((await budget.getUsageSummary()).eventCount).toBe(1);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
    expect(releases.map((release) => release.mock.calls.length)).toEqual([1]);
  });

  it("keeps a plain user cancellation as RuntimeAbortError when no budget violation happened", async () => {
    const { coordinator, budget, calls } = await setup({ script: holding(), manualClose: true });
    const releases = trackReleases(budget);
    const pending = coordinator.runTask(request());
    await waitForSpawn(calls);
    expect(coordinator.cancelTask("task-1")).toBe(true);
    await vi.waitFor(() => expect(calls[0].child.kill).toHaveBeenCalledWith("SIGTERM"));
    calls[0].child.emit("close", 143);
    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RuntimeAbortError);
    expect(failure).not.toBeInstanceOf(TaskBudgetStopError);
    expect((await budget.getUsageSummary()).eventCount).toBe(0);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
    expect(releases.map((release) => release.mock.calls.length)).toEqual([1]);
  });

  it("keeps a storage failure during a racing cancellation as UsageRecordingError (highest priority)", async () => {
    const failing: UsageStore = { appendUsage: async () => { throw new Error("disk full during shutdown"); }, readUsage: async () => [] };
    const { coordinator, budget, calls } = await setup({
      usageStore: failing,
      policy: { maxTotalTokensPerTask: 10 },
      script: holding(),
      manualClose: true,
    });
    const releases = trackReleases(budget);
    const pending = coordinator.runTask(request());
    await waitForSpawn(calls);
    expect(coordinator.cancelTask("task-1")).toBe(true);
    await vi.waitFor(() => expect(calls[0].child.kill).toHaveBeenCalledWith("SIGTERM"));
    calls[0].child.stdout.write(overTokenLimit);
    await new Promise((resolve) => setImmediate(resolve));
    calls[0].child.emit("close", 143);
    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UsageRecordingError);
    expect((failure as UsageRecordingError).cause).toBeInstanceOf(BudgetStoreError);
    expect(releases.map((release) => release.mock.calls.length)).toEqual([1]);
    expect((await budget.getSnapshot()).activeTaskCount).toBe(0);
  });
});
