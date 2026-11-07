import { OpenCodeLaunchError, OpenCodeRuntime, RuntimeModelError, type OpenCodeRuntimeCapabilities, type OpenCodeRuntimeOptions, type RuntimeResult, type RuntimeTaskOptions } from "./runtime.js";

export interface ProductionOpenCodeBackendOptions extends OpenCodeRuntimeOptions {
  readonly supportedModels: readonly string[];
  readonly provider?: string;
  readonly authenticated: boolean;
  readonly available: boolean;
  readonly version?: string;
}

/**
 * Production transport boundary for the official `opencode run` CLI.
 * Authentication and availability are verified snapshots supplied by the
 * composition root; this backend never reads credentials or probes by running
 * a model request.
 */
export class ProductionOpenCodeBackend extends OpenCodeRuntime {
  private readonly snapshot: OpenCodeRuntimeCapabilities;

  constructor(options: ProductionOpenCodeBackendOptions) {
    super(options);
    const provider = options.provider ?? "opencode-go";
    if (!provider.trim() || options.supportedModels.length === 0 || options.supportedModels.some((model) => !/^[^/\s]+\/[^/\s]+$/.test(model) || model === "*" || !model.startsWith(`${provider}/`))) {
      throw new TypeError("Production OpenCode models must be explicit non-wildcard ids");
    }
    if (new Set(options.supportedModels).size !== options.supportedModels.length) {
      throw new TypeError("Production OpenCode models must be unique");
    }
    if (!options.allowedCwdRoots || options.allowedCwdRoots.length === 0) {
      throw new TypeError("Production OpenCode requires explicit allowedCwdRoots");
    }
    this.snapshot = Object.freeze({
      provider: options.provider ?? "opencode-go",
      supportedModels: Object.freeze([...options.supportedModels]),
      authenticated: options.authenticated,
      available: options.available,
      version: options.version,
    });
  }

  override capabilities(): OpenCodeRuntimeCapabilities {
    return this.snapshot;
  }

  override runTask(options: RuntimeTaskOptions): Promise<RuntimeResult> {
    if (!this.snapshot.authenticated || !this.snapshot.available) {
      return Promise.reject(new OpenCodeLaunchError("OpenCode CLI authentication and availability are unverified"));
    }
    if (!this.snapshot.supportedModels.includes(options.model)) {
      return Promise.reject(new RuntimeModelError("OpenCode model is not confirmed by the runtime catalog"));
    }
    return super.runTask(options);
  }
}

/** Injectable fake transport retained for deterministic offline tests. */
export class FakeOpenCodeBackend extends OpenCodeRuntime {
  override capabilities(): OpenCodeRuntimeCapabilities {
    return { provider: "opencode-go", supportedModels: [], authenticated: true, available: true };
  }
}
