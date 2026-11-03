import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOrchestrator, DEFAULT_AGENT_MODELS, defaultBudgetDirectory, FIXED_BUDGET_POLICY, normalizeAgentModels, OrchestratorConfigError } from "../src/index";
import { SerialQueue } from "../src/serial-queue";

const directories: string[] = [];
afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "oao-factory-"));
  directories.push(directory);
  return directory;
}

describe("createOrchestrator", () => {
  it("uses the default journal directory outside the repository", () => {
    expect(defaultBudgetDirectory("/home/tester")).toBe("/home/tester/.local/share/open-agent-office/budget");
    expect(defaultBudgetDirectory("/home/tester").startsWith("/home/tester")).toBe(true);
  });

  it("places usage.jsonl and cash-payments.jsonl in the budget directory", async () => {
    const directory = await temporaryDirectory();
    const { paths } = createOrchestrator({ budgetDirectory: join(directory, "budget") });
    expect(paths.usagePath).toBe(join(directory, "budget", "usage.jsonl"));
    expect(paths.cashPaymentsPath).toBe(join(directory, "budget", "cash-payments.jsonl"));
  });

  it("rejects relative journal paths", () => {
    expect(() => createOrchestrator({ budgetDirectory: "relative/budget" })).toThrow(OrchestratorConfigError);
    expect(() => createOrchestrator({ usagePath: "usage.jsonl" })).toThrow(OrchestratorConfigError);
    expect(() => createOrchestrator({ cashPaymentsPath: "cash.jsonl" })).toThrow(OrchestratorConfigError);
  });

  it("applies the fixed financial policy and ignores financial overrides", async () => {
    const directory = await temporaryDirectory();
    const { budget } = createOrchestrator({
      budgetDirectory: directory,
      // Financial fields are not part of the options type; a JS caller must not be able to change them.
      ...({ extraUsageEnabled: true, monthlyBudgetRub: 50_000, subscriptionCostRub: 0 } as object),
    });
    expect(budget.policy.monthlyBudgetRub).toBe(FIXED_BUDGET_POLICY.monthlyBudgetRub);
    expect(budget.policy.subscriptionCostRub).toBe(1000);
    expect(budget.policy.extraUsageEnabled).toBe(false);
    expect(budget.policy.accountingTimeZone).toBe("Europe/Amsterdam");
    expect(budget.policy.maxConcurrentTasks).toBe(1);
    expect(budget.policy.maxTaskDurationMs).toBe(600_000);
  });

  it("accepts only positive tunables for concurrency and duration", async () => {
    const directory = await temporaryDirectory();
    expect(() => createOrchestrator({ budgetDirectory: directory, maxConcurrentTasks: 0 })).toThrow(OrchestratorConfigError);
    expect(() => createOrchestrator({ budgetDirectory: directory, maxConcurrentTasks: 1.5 })).toThrow(OrchestratorConfigError);
    expect(() => createOrchestrator({ budgetDirectory: directory, maxTaskDurationMs: 0 })).toThrow(OrchestratorConfigError);
    expect(() => createOrchestrator({ budgetDirectory: directory, maxTaskDurationMs: 2 ** 31 })).toThrow(OrchestratorConfigError);
    const { budget } = createOrchestrator({ budgetDirectory: directory, maxConcurrentTasks: 2, maxTaskDurationMs: 60_000 });
    expect(budget.policy.maxConcurrentTasks).toBe(2);
    expect(budget.policy.maxTaskDurationMs).toBe(60_000);
  });

  it("validates the agent model table", () => {
    expect(normalizeAgentModels({ developer: "opencode-go/claude-haiku-5-5" })).toEqual({ developer: "opencode-go/claude-haiku-5-5" });
    expect(() => normalizeAgentModels({})).toThrow(OrchestratorConfigError);
    expect(() => normalizeAgentModels({ developer: "no-provider" })).toThrow(OrchestratorConfigError);
    expect(() => normalizeAgentModels({ "bad agent": "opencode-go/x" })).toThrow(OrchestratorConfigError);
  });

  it("defaults to the economical five-employee table with helper on Beam Free", () => {
    expect(DEFAULT_AGENT_MODELS).toEqual({
      director: "opencode-go/mimo-v2.6-flash",
      developer: "opencode-go/glm-5.3-flash",
      engineer: "opencode-go/qwen3.8-flash",
      analyst: "opencode-go/mimo-v2.6-flash",
      helper: "opencode-go/beam-free",
    });
    expect(Object.keys(DEFAULT_AGENT_MODELS)).toHaveLength(5);
    expect(Object.isFrozen(DEFAULT_AGENT_MODELS)).toBe(true);
    expect(() => normalizeAgentModels(DEFAULT_AGENT_MODELS)).not.toThrow();
  });
});

describe("SerialQueue", () => {
  it("runs tasks in call order even when earlier tasks are slower", async () => {
    const queue = new SerialQueue();
    const order: string[] = [];
    const slow = queue.enqueue(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); order.push("slow"); });
    const fast = queue.enqueue(async () => { order.push("fast"); });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["slow", "fast"]);
    await queue.idle();
  });

  it("keeps running after a failing task", async () => {
    const queue = new SerialQueue();
    const failed = queue.enqueue(async () => { throw new Error("write failed"); });
    await expect(failed).rejects.toThrow("write failed");
    await expect(queue.enqueue(async () => "ok")).resolves.toBe("ok");
    await expect(queue.idle()).resolves.toBeUndefined();
  });
});
