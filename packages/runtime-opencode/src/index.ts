/**
 * Public surface of `@open-agent-office/runtime-opencode`.
 * Barrel only: the OpenCode Runtime implementation lives in `runtime.ts`,
 * the RuntimeAdapter wrapper (S2-1) in `adapter.ts` — no import cycles.
 */

export * from "./runtime.js";
export { ProductionOpenCodeBackend, FakeOpenCodeBackend } from "./backend.js";
export type { ProductionOpenCodeBackendOptions } from "./backend.js";
export { OpenCodeRuntimeAdapter, OpenCodeAdapterError, createOpenCodeRuntimeAdapter } from "./adapter.js";
export type { OpenCodeRuntimeAdapterOptions } from "./adapter.js";
export { preflightOpenCode, type OpenCodePreflightOptions, type OpenCodePreflightResult } from "./preflight.js";
