import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { BudgetManager, JsonlCashPaymentStore, JsonlUsageStore, type BudgetPolicyConfig } from "@open-agent-office/budget-manager";
import { OpenCodeRuntime, type SpawnFunction } from "@open-agent-office/runtime-opencode";
import { AgentExecutionCoordinator } from "./agent-execution-coordinator.js";
import { OrchestratorConfigError } from "./errors.js";

/**
 * Financial policy is fixed here and is not configurable through the factory:
 * monthly budget 1000 RUB, subscription 1000 RUB (extra budget 0 RUB), extra usage disabled.
 * This is local application policy; it does not configure the OpenCode provider account.
 */
export const FIXED_BUDGET_POLICY = Object.freeze({
  monthlyBudgetRub: 1000,
  subscriptionCostRub: 1000,
  extraUsageEnabled: false,
  accountingTimeZone: "Europe/Amsterdam",
} as const);

export const DEFAULT_MAX_CONCURRENT_TASKS = 1;
export const DEFAULT_MAX_TASK_DURATION_MS = 10 * 60 * 1000;
const MAX_TIMER_MS = 2_147_483_647;

/** Default journal directory, outside the Git repository: ~/.local/share/open-agent-office/budget */
export function defaultBudgetDirectory(home: string = homedir()): string {
  return join(home, ".local", "share", "open-agent-office", "budget");
}

export interface OrchestratorFactoryOptions {
  /** Absolute journal directory. Defaults to defaultBudgetDirectory(). */
  budgetDirectory?: string;
  /** Absolute path overrides for the two journals. */
  usagePath?: string;
  cashPaymentsPath?: string;
  /** Tunables only. Financial fields are not accepted. */
  maxConcurrentTasks?: number;
  maxTaskDurationMs?: number;
  /** Runtime command and spawn override (tests). */
  runtimeCommand?: string;
  spawn?: SpawnFunction;
  agents?: Record<string, string>;
  now?: () => string;
}

export interface OrchestratorComponents {
  coordinator: AgentExecutionCoordinator;
  budget: BudgetManager;
  paths: { usagePath: string; cashPaymentsPath: string };
}

function absolutePath(name: string, value: string): string {
  if (!isAbsolute(value)) throw new OrchestratorConfigError(`${name} must be an absolute path`);
  return value;
}

/** Builds the coordinator with JSONL journals and a fresh Budget Manager. Does not start any process. */
export function createOrchestrator(options: OrchestratorFactoryOptions = {}): OrchestratorComponents {
  const directory = absolutePath("budgetDirectory", options.budgetDirectory ?? defaultBudgetDirectory());
  const usagePath = absolutePath("usagePath", options.usagePath ?? join(directory, "usage.jsonl"));
  const cashPaymentsPath = absolutePath("cashPaymentsPath", options.cashPaymentsPath ?? join(directory, "cash-payments.jsonl"));

  const maxConcurrentTasks = options.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS;
  if (!Number.isSafeInteger(maxConcurrentTasks) || maxConcurrentTasks < 1) throw new OrchestratorConfigError("maxConcurrentTasks must be a positive integer");
  const maxTaskDurationMs = options.maxTaskDurationMs ?? DEFAULT_MAX_TASK_DURATION_MS;
  if (!Number.isFinite(maxTaskDurationMs) || maxTaskDurationMs <= 0 || maxTaskDurationMs > MAX_TIMER_MS) {
    throw new OrchestratorConfigError(`maxTaskDurationMs must be a positive number up to ${MAX_TIMER_MS}`);
  }

  const policy: Partial<BudgetPolicyConfig> = { ...FIXED_BUDGET_POLICY, maxConcurrentTasks, maxTaskDurationMs };
  const budget = new BudgetManager(new JsonlUsageStore(usagePath), {
    policy,
    paymentStore: new JsonlCashPaymentStore(cashPaymentsPath),
    now: options.now,
  });
  const runtime = new OpenCodeRuntime({ command: options.runtimeCommand, spawn: options.spawn });
  const coordinator = new AgentExecutionCoordinator({ runtime, budget, agents: options.agents });
  return { coordinator, budget, paths: { usagePath, cashPaymentsPath } };
}
