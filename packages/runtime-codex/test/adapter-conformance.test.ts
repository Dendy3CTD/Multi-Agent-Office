import { describeRuntimeAdapterContract, type AdapterConformanceDriver, type AdapterConformanceFixtures } from "../../runtime-opencode/test/conformance/adapter-contract.js";
import { CodexRuntimeAdapter, FakeCodexBackend, type CodexNativeEvent } from "../src/index.js";

/**
 * Wave S2-3: re-uses the S2-1 conformance suite through a driver bound to
 * FakeCodexBackend slots. No real Codex CLI, no network, no subscription.
 */

/** Conformance driver over one FakeCodexBackend slot. */
class CodexDriver implements AdapterConformanceDriver {
  constructor(
    private readonly backend: FakeCodexBackend,
    private readonly index: number,
  ) {}

  emit(event: Record<string, unknown>): void {
    this.backend.fill(this.index, event as CodexNativeEvent);
  }

  finish(options: { exitCode?: number; sessionId?: string; withFinalStop?: boolean } = {}): void {
    // The final stop record is the driver's responsibility in this dialect too.
    if (options.withFinalStop !== false) {
      this.emit({ type: "step_finish", sessionID: options.sessionId, reason: "stop" });
    }
    this.backend.completeSlot(this.index, { externalSessionId: options.sessionId, exitCode: options.exitCode, reason: "stop" });
  }

  fail(kind: "model" | "exit"): void {
    // Fake native failure dialect: model reports and non-zero exits.
    this.backend.failSlot(this.index, kind === "model" ? "model" : "exit");
  }
}

let currentBackend: FakeCodexBackend = new FakeCodexBackend({ models: "*" });

const codexFixtures: AdapterConformanceFixtures = {
  name: "CodexRuntimeAdapter (FakeCodexBackend)",
  makeAdapter: () => {
    currentBackend = new FakeCodexBackend({ models: "*", autoSlots: false });
    return new CodexRuntimeAdapter({ backend: currentBackend });
  },
  makeTask: (overrides = {}) => ({
    executionId: `cx-${Math.random().toString(36).slice(2, 8)}`,
    attempt: 1,
    modelId: "chatgpt-plus/fake-model",
    runtimeId: "codex" as never,
    prompt: "conformance hello",
    cwd: "/tmp/open-agent-office-codex-conformance",
    ...overrides,
  }),
  nextExecutionDriver: () => new CodexDriver(currentBackend, currentBackend.createSlot()),
  failureCodes: { model: "runtime_model_rejected", exit: "runtime_exit_nonzero" },
};

describeRuntimeAdapterContract(codexFixtures);
