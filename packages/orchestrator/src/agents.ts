import { OrchestratorConfigError } from "./errors.js";

/**
 * Starting model assignments for the five employees (OAO-MODEL-002). These are
 * routing configuration only: nothing is launched from this table. Helper is an
 * auxiliary employee on Beam Free: it is used for small supporting errands and
 * is not required in every project; nothing starts it automatically.
 */
export const DEFAULT_AGENT_MODELS: Readonly<Record<string, string>> = Object.freeze({
  director: "opencode-go/mimo-v2.6-flash",
  developer: "opencode-go/glm-5.3-flash",
  engineer: "opencode-go/qwen3.8-flash",
  analyst: "opencode-go/mimo-v2.6-flash",
  helper: "opencode-go/beam-free",
});

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** provider/model, e.g. opencode-go/claude-haiku-5-5 */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function normalizeAgentModels(models: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const entries = Object.entries(models);
  if (entries.length === 0) throw new OrchestratorConfigError("agent model configuration must not be empty");
  for (const [agentId, modelId] of entries) {
    if (!AGENT_ID_PATTERN.test(agentId)) throw new OrchestratorConfigError(`invalid agent id in configuration: ${agentId}`);
    if (typeof modelId !== "string" || !MODEL_ID_PATTERN.test(modelId)) throw new OrchestratorConfigError(`invalid model id for agent ${agentId}: expected provider/model`);
  }
  return Object.freeze(Object.fromEntries(entries));
}
