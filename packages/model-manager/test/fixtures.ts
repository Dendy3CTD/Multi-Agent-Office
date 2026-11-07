import type { BudgetSnapshotView, ModelStatsView, Profession, RuntimeCapabilities, SubtaskBrief } from "@open-agent-office/shared";

export const runtime = (id: string, models: readonly string[] | "*" = "*"): RuntimeCapabilities => ({
  runtimeId: id as never,
  runtimeType: id,
  supportedProviders: [id === "codex" ? "chatgpt-plus" : "opencode-go"] as never[],
  supportedModels: models,
  session: true,
  cancel: true,
  streamEvents: true,
  usage: true,
});

export const profession: Profession = {
  id: "developer" as never,
  version: "1.0.0",
  name: "Developer",
  role: "developer",
  departmentId: "engineering" as never,
  responsibilities: ["implement"],
  baseInstructions: "implement carefully",
  skillTags: ["coding"],
  capabilityRequirements: ["code"],
  modelHints: { tier: "cheap" },
  acceptancePolicy: { mode: "auto", checks: [] },
  status: "active",
};

export const subtask = (overrides: Partial<SubtaskBrief> = {}): SubtaskBrief => ({
  complexity: "standard",
  taskType: "coding",
  requiredCapabilities: [],
  ...overrides,
});

export const budget = (overrides: Partial<BudgetSnapshotView> = {}): BudgetSnapshotView => ({
  generatedAt: "2026-11-04T00:00:00.000Z" as never,
  status: "normal",
  allowanceStatus: "unknown",
  monthlyBudgetRub: 1000,
  subscriptionCostRub: 1000,
  extraBudgetRemainingRub: 0,
  reportedUsageUsd: 0,
  monthlyUsage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0, eventCount: 0 },
  activeTaskCount: 0,
  ...overrides,
});

export const stats = (overrides: Partial<ModelStatsView> = {}): ModelStatsView => ({
  modelId: "opencode-go/glm-5.3-flash" as never,
  attempts: 0,
  successes: 0,
  ...overrides,
});

export const model = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "opencode-go/glm-5.3-flash",
  provider: "opencode-go",
  runtimeIds: ["opencode"],
  tier: "cheap",
  capabilities: ["code", "reasoning"],
  relativeCost: 0,
  enabled: true,
  paidExternal: false,
  expenseCategory: "free",
  ...overrides,
});
