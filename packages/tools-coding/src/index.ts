import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { accessSync, constants, mkdirSync, realpathSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CODEX_AUTO_APPROVED_CODING_READ_ONLY_TOOLS, registerTool, type RuntimeMcpServerConfig, type ToolDefinition, type ToolSummary } from "@mao-hybrid/contracts";

export type CodingCheck =
  | "python-test" | "python-lint" | "python-compile" | "rust-test" | "rust-check"
  | "javascript-test" | "javascript-check" | "vitest" | "playwright" | "eslint" | "ruff"
  | "typescript-typecheck" | "build" | "c-check" | "cpp-check" | "html-check" | "css-check" | "shell-check";

export interface ToolCommandResult {
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly status: "passed" | "failed" | "blocked" | "timed_out";
  readonly reasonCode?: "not_repository";
  readonly artifacts: readonly { readonly path: string; readonly uri: string }[];
}

export interface CodingToolOptions {
  /** The exact registered project workspace assigned to this coding execution. */
  readonly workspaceRoot: string;
  /** Optional exact Git repository root selected by the application owner. */
  readonly repositoryRoot?: string;
  /** Enables local Git mutations and, with a separate confirmation, GitHub writes. */
  readonly allowExternalWrites?: boolean;
  /** Enables branch/commit actions only in the selected registered project repository. */
  readonly allowLocalGitWrites?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  /** Test seam for deterministic unavailable-tool reporting. */
  readonly commandAvailability?: (command: string) => boolean;
  readonly browserPort?: BrowserAutomationPort;
  readonly codeReviewPort?: CodeReviewPort;
  /** Owner-configured local apps only; tool inputs cannot supply a command or working directory. */
  readonly localServers?: readonly LocalServerDefinition[];
}

export interface LocalServerDefinition {
  readonly id: string;
  readonly cwd: string;
  readonly command: "node" | "npm" | "pnpm" | "python3";
  readonly args: readonly string[];
  readonly urlTemplate: string;
}

export interface CodingToolset {
  readonly tools: readonly ToolDefinition[];
  get(id: string): ToolDefinition | undefined;
  register(): void;
}

export interface CodingTaskEmployee {
  readonly id?: string;
  readonly professionId: string;
  readonly skills: readonly string[];
}

export interface CodingTaskDispatcher {
  readonly projectId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly workspaceRoot: string;
  readonly tools: readonly ToolDefinition[];
  readonly summaries: readonly ToolSummary[];
  readonly mcpServer: RuntimeMcpServerConfig;
  invoke(toolId: string, input: unknown): Promise<unknown>;
}

/** Filter tools for an employee profile using the schema extension visible from the existing ToolSummary contract. */
export function filterCodingToolsByCapabilities(tools: readonly ToolDefinition[], employeeCapabilities: readonly string[]): readonly ToolDefinition[] {
  const available = new Set(employeeCapabilities);
  return tools.filter((tool) => {
    const capabilities = tool.capabilities ?? tool.inputSchema["x-mao-capabilities"];
    return Array.isArray(capabilities) && capabilities.some((capability) => typeof capability === "string" && available.has(capability));
  });
}

/** Only coding and QA professions receive language tooling; other employee skills remain untouched. */
export function codingCapabilitiesForEmployee(employee: CodingTaskEmployee): readonly string[] {
  const capabilities = new Set(employee.skills);
  if (employee.professionId === "developer") {
    for (const capability of ["coding", "git", "git-write", "github-readonly", "browser-testing", "python", "rust", "typescript", "javascript", "c", "cpp", "shell", "web", "build", "testing"]) capabilities.add(capability);
  } else if (employee.professionId === "qa-engineer") {
    for (const capability of ["testing", "browser-testing", "javascript", "typescript", "web"]) capabilities.add(capability);
  }
  return Object.freeze([...capabilities]);
}

export function createTaskCodingDispatcher(options: {
  readonly projectId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly workspaceRoot: string;
  readonly employee: CodingTaskEmployee;
  readonly repositoryRoot?: string;
  readonly allowExternalWrites?: boolean;
  readonly allowLocalGitWrites?: boolean;
  readonly browserPort?: BrowserAutomationPort;
  readonly codeReviewPort?: CodeReviewPort;
  readonly localServers?: readonly LocalServerDefinition[];
}): CodingTaskDispatcher {
  const workspaceRoot = requireDirectory(options.workspaceRoot, "workspaceRoot");
  const repositoryRoot = requireDirectory(options.repositoryRoot ?? workspaceRoot, "repositoryRoot");
  if (!isWithin(workspaceRoot, repositoryRoot)) throw new TypeError("Coding repository must be inside the registered project workspace");
  const capabilities = codingCapabilitiesForEmployee(options.employee);
  const toolset = createCodingTools({
    workspaceRoot, repositoryRoot,
    allowExternalWrites: options.allowExternalWrites === true,
    allowLocalGitWrites: options.allowLocalGitWrites ?? options.employee.professionId === "developer",
    ...(options.browserPort ? { browserPort: options.browserPort } : {}),
    ...(options.codeReviewPort ? { codeReviewPort: options.codeReviewPort } : {}),
    ...(options.localServers ? { localServers: options.localServers } : {}),
  });
  const tools = filterCodingToolsByCapabilities(toolset.tools, capabilities);
  const allowed = new Map(tools.map((tool) => [tool.id, tool]));
  const mcpOptions = { workspaceRoot, repositoryRoot, allowedToolIds: [...allowed.keys()], employeeCapabilities: capabilities, allowExternalWrites: options.allowExternalWrites === true, allowLocalGitWrites: options.allowLocalGitWrites ?? options.employee.professionId === "developer" };
  const mcpPath = fileURLToPath(new URL("./mcp-server.js", import.meta.url));
  const mcpServer: RuntimeMcpServerConfig = Object.freeze({
    name: "mao_coding",
    command: process.execPath,
    args: Object.freeze([mcpPath, JSON.stringify(mcpOptions)]),
    allowedTools: Object.freeze([...allowed.keys()]),
  });
  return Object.freeze({
    projectId: options.projectId, taskId: options.taskId, executionId: options.executionId, workspaceRoot,
    tools: Object.freeze([...tools]),
    summaries: Object.freeze(tools.map(({ id, name, description, inputSchema, capabilities: toolCapabilities, annotations }) => Object.freeze({ id, name, description, inputSchema, ...(toolCapabilities ? { capabilities: toolCapabilities } : {}), ...(annotations ? { annotations } : {}) }))),
    mcpServer,
    async invoke(toolId: string, input: unknown) {
      const tool = allowed.get(toolId);
      if (!tool) throw Object.assign(new Error(`Tool ${toolId} is not permitted for employee ${options.employee.id ?? options.employee.professionId} in task ${options.taskId}`), { code: "tool_not_allowed" });
      enforceCodingToolInputCapabilities(toolId, input, capabilities);
      return await tool.execute(input, { projectId: options.projectId, taskId: options.taskId, executionId: options.executionId, employeeId: options.employee.id, workspaceRoot });
    },
  });
}

/** Safe public discovery metadata. No workspace-bound executor is retained or globally registered. */
export function listCodingToolSummaries(): readonly ToolSummary[] {
  const toolset = createCodingTools({ workspaceRoot: process.cwd() });
  return Object.freeze(toolset.tools.map(({ id, name, description, inputSchema, capabilities, annotations }) => Object.freeze({ id, name, description, inputSchema, ...(capabilities ? { capabilities } : {}), ...(annotations ? { annotations } : {}) })));
}

export function enforceCodingToolInputCapabilities(toolId: string, input: unknown, capabilities: readonly string[]): void {
  if (capabilities.includes("coding") || toolId !== "coding.check.run") return;
  const check = record(input).check;
  if (typeof check !== "string" || !CHECKS[check as CodingCheck]) throw new TypeError("Unknown check kind");
  const required = new Set([CHECKS[check as CodingCheck].capability]);
  if (check.endsWith("-test") || check === "vitest" || check === "playwright") required.add("testing");
  if (![...required].every((capability) => capabilities.includes(capability))) throw Object.assign(new Error(`Employee lacks capability required for check ${check}`), { code: "tool_capability_denied" });
}

export interface BrowserAction {
  readonly type: "click" | "fill" | "assertText" | "screenshot" | "snapshot";
  readonly selector?: string;
  readonly uid?: string;
  readonly value?: string;
  readonly text?: string;
  readonly name?: string;
}

export interface BrowserScenarioResult {
  readonly status: "passed" | "failed";
  readonly url: string;
  readonly steps: readonly { readonly action: string; readonly status: "passed" | "failed"; readonly detail?: string }[];
  readonly consoleErrors: readonly string[];
  readonly artifacts: readonly { readonly path: string; readonly uri: string }[];
}

export interface BrowserAutomationPort {
  readonly allowedOrigins: readonly string[];
  runScenario(input: { readonly url: string; readonly actions: readonly BrowserAction[] }): Promise<BrowserScenarioResult>;
}

export interface CodeReviewPort {
  /** The host binds this to the existing Codex Runtime and current durable task context. */
  review(input: { readonly diff: string; readonly requirements: readonly string[]; readonly checks: readonly Readonly<Record<string, unknown>>[] }): Promise<{ readonly summary: string; readonly findings: readonly Readonly<Record<string, unknown>>[]; readonly requirementCoverage?: readonly Readonly<Record<string, unknown>>[] }>;
}

interface CommandSpec { readonly command: string; readonly args: readonly string[]; readonly capability: string; }
interface RunnerOptions { readonly cwd: string; readonly workspaceRoot: string; readonly repositoryRoot: string; readonly timeoutMs: number; readonly maxOutputBytes: number; readonly isolatedHome: string; readonly trustedUserAuth?: boolean; readonly commandAvailability?: (command: string) => boolean; }
interface ProcessResult { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean; readonly durationMs: number; }
interface RunningLocalServer { readonly child: ChildProcess; readonly url: string; readonly command: string; readonly startedAt: string; exited: boolean; exitCode: number | null; stderr: string; closed: Promise<void>; }

const CHECKS: Record<CodingCheck, CommandSpec> = {
  "python-test": { command: "pytest", args: [], capability: "python" },
  "python-lint": { command: "ruff", args: ["check", "."], capability: "python" },
  "python-compile": { command: "python3", args: ["-m", "compileall", "-q", "."], capability: "python" },
  "rust-test": { command: "cargo", args: ["test"], capability: "rust" },
  "rust-check": { command: "cargo", args: ["check"], capability: "rust" },
  "javascript-test": { command: "node", args: ["--test"], capability: "javascript" },
  "javascript-check": { command: "node", args: ["--check"], capability: "javascript" },
  vitest: { command: "vitest", args: ["run"], capability: "typescript" },
  playwright: { command: "playwright", args: ["test"], capability: "web" },
  eslint: { command: "eslint", args: ["."], capability: "typescript" },
  ruff: { command: "ruff", args: ["check", "."], capability: "python" },
  "typescript-typecheck": { command: "tsc", args: ["--noEmit"], capability: "typescript" },
  build: { command: "npm", args: ["run", "build"], capability: "build" },
  "c-check": { command: "gcc", args: ["-fsyntax-only"], capability: "c" },
  "cpp-check": { command: "g++", args: ["-fsyntax-only"], capability: "cpp" },
  "html-check": { command: "html-validate", args: ["**/*.html"], capability: "web" },
  "css-check": { command: "stylelint", args: ["**/*.css"], capability: "web" },
  "shell-check": { command: "bash", args: ["-n"], capability: "shell" },
};

const TOOL_CAPABILITIES = ["coding", "testing", "python", "rust", "typescript", "javascript", "c", "cpp", "shell", "web"] as const;
const TOOL_TIMEOUT_DEFAULT = 120_000;
const MAX_OUTPUT_DEFAULT = 256 * 1024;

export function createCodingTools(options: CodingToolOptions): CodingToolset {
  const workspaceRoot = requireDirectory(options.workspaceRoot, "workspaceRoot");
  const repositoryRoot = requireDirectory(options.repositoryRoot ?? options.workspaceRoot, "repositoryRoot");
  if (!isWithin(repositoryRoot, workspaceRoot) && !isWithin(workspaceRoot, repositoryRoot)) {
    throw new TypeError("repositoryRoot and workspaceRoot must refer to the selected project or its containing repository");
  }
  const timeoutMs = boundedInteger(options.timeoutMs ?? TOOL_TIMEOUT_DEFAULT, 1_000, 15 * 60_000, "timeoutMs");
  const maxOutputBytes = boundedInteger(options.maxOutputBytes ?? MAX_OUTPUT_DEFAULT, 4_096, 4 * 1024 * 1024, "maxOutputBytes");
  const runnerOptions = { cwd: workspaceRoot, workspaceRoot, repositoryRoot, timeoutMs, maxOutputBytes, isolatedHome: join(workspaceRoot, ".mao-coding-home"), commandAvailability: options.commandAvailability };
  const tools: ToolDefinition[] = [];
  const localServers = validateLocalServers(options.localServers ?? [], workspaceRoot);
  const startedServers = new Map<string, RunningLocalServer>();

  const add = (definition: ToolDefinition) => tools.push(definition);
  add(definition("coding.capabilities", "Coding capabilities", "Inspect available compilers, test runners, and repository tools without installing anything.", { type: "object", additionalProperties: false }, async () => discoverCapabilities(workspaceRoot, repositoryRoot, options.commandAvailability, options.allowExternalWrites === true)));
  add(definition("coding.check.run", "Run project check", "Run a known project test, linter, compiler, typecheck, browser test, or build command and return the exact process result.", {
    type: "object", required: ["check"], additionalProperties: false, properties: { check: { enum: Object.keys(CHECKS) }, paths: { type: "array", items: { type: "string" }, maxItems: 32 }, artifacts: { type: "array", items: { type: "string" }, maxItems: 32 } },
    "x-mao-capabilities": TOOL_CAPABILITIES,
  }, async (raw) => runCheck(raw, runnerOptions, workspaceRoot)));

  add(definition("coding.git.status", "Git status", "Show status for the selected repository.", objectSchema(), async () => gitRead(repositoryRoot, ["status", "--short", "--branch"], runnerOptions)));
  add(definition("coding.git.diff", "Git diff", "Read the unstaged and staged diff for the selected repository.", { type: "object", additionalProperties: false, properties: { path: { type: "string" } } }, async (raw) => {
    const input = record(raw);
    const args = ["diff", "--no-ext-diff", "--"];
    if (input.path !== undefined) args.push(relativeInside(repositoryRoot, stringValue(input.path, "path")));
    const unstaged = await gitRead(repositoryRoot, args, runnerOptions);
    if (unstaged.status !== "passed") return unstaged;
    const staged = await gitRead(repositoryRoot, ["diff", "--cached", "--no-ext-diff", "--"], runnerOptions);
    return combineReadResults("git diff", [unstaged, staged]);
  }));
  add(definition("coding.git.log", "Git history", "Read recent commits from the selected repository.", { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } }, async (raw) => {
    const limit = integerOption(record(raw).limit, 20, 1, 100, "limit");
    return gitRead(repositoryRoot, ["log", `-${limit}`, "--date=iso-strict", "--format=%h %ad %an %s"], runnerOptions);
  }));
  add(definition("coding.git.branch.create", "Create local branch", "Create a branch in the selected repository; requires enabled write mode and explicit confirmation.", { type: "object", required: ["name", "confirmed"], additionalProperties: false, properties: { name: { type: "string" }, confirmed: { const: true } } }, async (raw) => {
    const input = record(raw);
    if (options.allowLocalGitWrites !== true || input.confirmed !== true) return blockedResult("git branch", "Local Git mutation is disabled; enable registered-workspace Git writes and explicitly confirm this operation.");
    const branch = stringValue(input.name, "name");
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(branch) || branch.startsWith("-") || branch.includes("..") || branch.endsWith("/")) throw new TypeError("Invalid branch name");
    return gitRead(repositoryRoot, ["branch", branch], runnerOptions);
  }));
  add(definition("coding.git.commit", "Commit selected changes", "Stage only explicitly selected paths and create a local commit in the selected repository.", { type: "object", required: ["message", "paths", "confirmed"], additionalProperties: false, properties: { message: { type: "string", minLength: 1, maxLength: 200 }, paths: { type: "array", minItems: 1, maxItems: 64, items: { type: "string" } }, confirmed: { const: true } } }, async (raw) => {
    const input = record(raw);
    if (options.allowLocalGitWrites !== true || input.confirmed !== true) return blockedResult("git commit", "Local Git mutation is disabled; enable registered-workspace Git writes and explicitly confirm this operation.");
    const message = stringValue(input.message, "message").trim();
    if (!message || message.startsWith("-")) throw new TypeError("Commit message must be non-empty and cannot start with '-'");
    const paths = stringArray(input.paths, "paths", 1, 64).map((path) => relativeInside(repositoryRoot, path));
    const stage = await runCommand("git", ["add", "--", ...paths], { ...runnerOptions, cwd: repositoryRoot });
    if (stage.exitCode !== 0) return commandResult("git add", ["--", ...paths], stage, runnerOptions, repositoryRoot);
    const commit = await runCommand("git", ["commit", "-m", message], { ...runnerOptions, cwd: repositoryRoot });
    return commandResult("git commit", ["-m", message], commit, runnerOptions, repositoryRoot);
  }));
  add(definition("coding.github.read", "Read GitHub repository", "Read issues, pull requests, CI and authentication status for the selected repository using the official gh CLI.", {
    type: "object", required: ["action"], additionalProperties: false,
    properties: { action: { enum: ["auth-status", "issues", "issue", "pull-requests", "pull-request", "pull-request-diff", "pull-request-checks", "workflow-runs", "workflow-run"] }, number: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 100 } },
    "x-mao-capabilities": ["coding", "git", "github", "read-only"],
  }, async (raw) => githubRead(raw, repositoryRoot, runnerOptions)));
  add(definition("coding.github.prepare-pr", "Prepare pull request summary", "Collect selected-repository branch, status, and diff for a human-reviewed pull request draft; does not push or create a PR.", objectSchema(), async () => preparePullRequest(repositoryRoot, runnerOptions)));
  add(definition("coding.github.push", "Push selected branch", "Push only the selected repository branch. Requires external-write mode and the exact confirmation phrase.", { type: "object", required: ["branch", "confirmation"], additionalProperties: false, properties: { branch: { type: "string" }, confirmation: { type: "string" } } }, async (raw) => githubWrite(raw, repositoryRoot, runnerOptions, options.allowExternalWrites === true, "push")));
  add(definition("coding.github.create-pr", "Create pull request", "Create a PR only in the selected GitHub repository after explicit external-write confirmation.", { type: "object", required: ["title", "body", "base", "confirmation"], additionalProperties: false, properties: { title: { type: "string" }, body: { type: "string" }, base: { type: "string" }, confirmation: { type: "string" } } }, async (raw) => githubWrite(raw, repositoryRoot, runnerOptions, options.allowExternalWrites === true, "create-pr")));
  add(definition("coding.github.merge-pr", "Merge pull request", "Merge only in the selected GitHub repository after explicit external-write confirmation.", { type: "object", required: ["number", "confirmation"], additionalProperties: false, properties: { number: { type: "integer", minimum: 1 }, confirmation: { type: "string" } } }, async (raw) => githubWrite(raw, repositoryRoot, runnerOptions, options.allowExternalWrites === true, "merge-pr")));
  add(definition("coding.review.diff", "Review Git diff", "Scan the selected repository diff for risky patterns and check results, then request substantive findings from the existing Codex Runtime reviewer when connected.", { type: "object", additionalProperties: false, properties: { requirements: { type: "array", maxItems: 32, items: { type: "string" } }, checks: { type: "array", maxItems: 32, items: { type: "object" } } }, "x-mao-capabilities": ["coding", "code-review", "security-review"] }, async (raw) => reviewDiff(raw, repositoryRoot, runnerOptions, options.codeReviewPort)));
  add(definition("coding.browser.scenario", "Run browser scenario", "Navigate and test a configured local application, capture screenshots, and report browser console errors through an injected Playwright or Chrome DevTools MCP port.", {
    type: "object", required: ["url", "actions"], additionalProperties: false, properties: { url: { type: "string" }, actions: { type: "array", maxItems: 32 } }, "x-mao-capabilities": ["coding", "web", "browser-testing", "playwright", "chrome-devtools-mcp"],
  }, async (raw) => {
    if (!options.browserPort) return blockedResult("browser scenario", "Playwright/Chrome DevTools browser port is not connected; no browser check was run.");
    const input = record(raw);
    const url = stringValue(input.url, "url");
    assertAllowedUrl(url, options.browserPort.allowedOrigins);
    return options.browserPort.runScenario({ url, actions: parseBrowserActions(input.actions) });
  }));
  add(definition("coding.web.start", "Start local application", "Start a pre-registered local application on loopback; command and directory come only from trusted host configuration.", { type: "object", required: ["appId", "port"], additionalProperties: false, properties: { appId: { type: "string" }, port: { type: "integer", minimum: 1024, maximum: 65535 } }, "x-mao-capabilities": ["coding", "web", "browser-testing"] }, async (raw) => startLocalServer(raw, localServers, startedServers, timeoutMs, repositoryRoot)));
  add(definition("coding.web.stop", "Stop local application", "Stop a local application process started by this adapter.", { type: "object", required: ["appId"], additionalProperties: false, properties: { appId: { type: "string" } }, "x-mao-capabilities": ["coding", "web", "browser-testing"] }, async (raw) => stopLocalServer(raw, startedServers)));

  return Object.freeze({ tools: Object.freeze(tools), get: (id: string) => tools.find((tool) => tool.id === id), register: () => { for (const tool of tools) registerTool(tool); } });
}

/** Attach an existing Playwright package to Chrome over CDP; this adds no browser dependency. */
export function createPlaywrightBrowserPort(options: {
  readonly playwright: { readonly chromium: { connectOverCDP(endpoint: string, options?: { timeout?: number }): Promise<PlaywrightBrowser> } };
  readonly cdpEndpoint: string;
  readonly workspaceRoot: string;
  readonly allowedOrigins: readonly string[];
}): BrowserAutomationPort & { readonly allowedOrigins: readonly string[] } {
  const workspaceRoot = requireDirectory(options.workspaceRoot, "workspaceRoot");
  const allowedOrigins = normalizeOrigins(options.allowedOrigins);
  const endpoint = new URL(options.cdpEndpoint);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:" && endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") throw new TypeError("Invalid Playwright CDP endpoint");
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(endpoint.hostname)) throw new TypeError("Playwright CDP endpoint must be loopback-only");
  let browserConnection: Promise<PlaywrightBrowser> | undefined;
  return Object.freeze({ allowedOrigins, async runScenario(input: { readonly url: string; readonly actions: readonly BrowserAction[] }): Promise<BrowserScenarioResult> {
    assertAllowedUrl(input.url, allowedOrigins);
    browserConnection ??= options.playwright.chromium.connectOverCDP(endpoint.toString(), { timeout: 10_000 }).catch((error) => { browserConnection = undefined; throw error; });
    const browser = await browserConnection;
    const context = browser.contexts()[0];
    if (!context) throw new Error("CDP browser has no default context");
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 2_000)); });
    page.on("pageerror", (error) => consoleErrors.push(error.message.slice(0, 2_000)));
    const steps: { action: string; status: "passed" | "failed"; detail?: string }[] = [];
    const artifacts: { path: string; uri: string }[] = [];
    let failed = false;
    try {
      try {
        await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        assertAllowedUrl(page.url(), allowedOrigins);
        steps.push({ action: "navigate", status: "passed", detail: input.url });
      } catch (error) {
        steps.push({ action: "navigate", status: "failed", detail: errorMessage(error) });
        return { status: "failed", url: input.url, steps, consoleErrors, artifacts };
      }
      for (const action of input.actions) {
        try {
          if (action.type === "click") await page.locator(requiredSelector(action)).click({ timeout: 10_000 });
          else if (action.type === "fill") await page.locator(requiredSelector(action)).fill(action.value ?? "", { timeout: 10_000 });
          else if (action.type === "assertText") {
            const actual = (await page.locator(requiredSelector(action)).textContent({ timeout: 10_000 })) ?? "";
            if (!actual.includes(action.text ?? "")) throw new Error(`Expected text not found: ${action.text ?? ""}`);
          } else if (action.type === "snapshot") {
            const text = await page.locator("body").innerText({ timeout: 10_000 });
            steps.push({ action: "snapshot", status: "passed", detail: text.slice(0, 8_000) });
            continue;
          } else if (action.type === "screenshot") {
            const name = screenshotName(action.name);
            const path = resolveInside(workspaceRoot, join("artifacts", name));
            mkdirSync(join(workspaceRoot, "artifacts"), { recursive: true });
            await page.screenshot({ path, fullPage: true });
            artifacts.push({ path, uri: pathToFileURL(path).href });
          }
          assertAllowedUrl(page.url(), allowedOrigins);
          steps.push({ action: action.type, status: "passed" });
        } catch (error) {
          failed = true;
          steps.push({ action: action.type, status: "failed", detail: errorMessage(error) });
          if (errorMessage(error).includes("outside configured applications")) break;
        }
      }
      const status: BrowserScenarioResult["status"] = failed || consoleErrors.length > 0 ? "failed" : "passed";
      return { status, url: input.url, steps, consoleErrors, artifacts };
    } finally {
      // Closing a page created by this port is safe; the attached user's Chrome session stays connected.
      await page.close().catch(() => undefined);
    }
  } });
}

/** Adapter for the official Chrome DevTools MCP tool names; the host owns MCP session setup. */
export function createChromeDevToolsMcpPort(options: {
  readonly callTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  readonly workspaceRoot: string;
  readonly allowedOrigins: readonly string[];
}): BrowserAutomationPort & { readonly allowedOrigins: readonly string[] } {
  const workspaceRoot = requireDirectory(options.workspaceRoot, "workspaceRoot");
  const allowedOrigins = normalizeOrigins(options.allowedOrigins);
  return Object.freeze({ allowedOrigins, async runScenario(input: { readonly url: string; readonly actions: readonly BrowserAction[] }): Promise<BrowserScenarioResult> {
    assertAllowedUrl(input.url, allowedOrigins);
    const pageResult = await options.callTool("new_page", { url: input.url, isolatedContext: `mao-${Date.now()}` });
    const pageId = extractPageId(pageResult);
    const steps: { action: string; status: "passed" | "failed"; detail?: string }[] = [{ action: "navigate", status: "passed", detail: input.url }];
    const consoleErrors: string[] = [];
    const artifacts: { path: string; uri: string }[] = [];
    let failed = false;
    for (const action of input.actions) {
      try {
        if (action.type === "snapshot") {
          const snapshot = await options.callTool("take_snapshot", { pageId });
          steps.push({ action: "snapshot", status: "passed", detail: extractText(snapshot).slice(0, 8_000) });
          continue;
        }
        if (action.type === "click") await options.callTool("click", { pageId, uid: requiredUid(action), includeSnapshot: false });
        else if (action.type === "fill") await options.callTool("fill", { pageId, uid: requiredUid(action), value: action.value ?? "", includeSnapshot: false });
        else if (action.type === "assertText") {
          const snapshot = await options.callTool("take_snapshot", { pageId });
          const text = extractText(snapshot);
          if (!text.includes(action.text ?? "")) throw new Error(`Expected text not found in page accessibility snapshot: ${action.text ?? ""}`);
        } else if (action.type === "screenshot") {
          const path = resolveInside(workspaceRoot, join("artifacts", screenshotName(action.name)));
          mkdirSync(join(workspaceRoot, "artifacts"), { recursive: true });
          await options.callTool("take_screenshot", { pageId, filePath: path, fullPage: true, format: "png" });
          if (!existsSync(path) || !statSync(path).isFile()) throw new Error("Chrome DevTools MCP did not create the requested local screenshot artifact");
          artifacts.push({ path, uri: pathToFileURL(path).href });
        }
        steps.push({ action: action.type, status: "passed" });
      } catch (error) {
        failed = true;
        steps.push({ action: action.type, status: "failed", detail: errorMessage(error) });
      }
    }
    try {
      const messages = await options.callTool("list_console_messages", { pageId, types: ["error"], pageSize: 100 });
      consoleErrors.push(...extractConsoleErrors(messages));
    } catch (error) { consoleErrors.push(`Console inspection failed: ${errorMessage(error)}`); failed = true; }
    const status: BrowserScenarioResult["status"] = failed || consoleErrors.length > 0 ? "failed" : "passed";
    return { status, url: input.url, steps, consoleErrors, artifacts };
  } });
}

function definition(id: string, name: string, description: string, inputSchema: Readonly<Record<string, unknown>>, execute: (input: unknown) => Promise<unknown> | unknown): ToolDefinition {
  const declared = inputSchema["x-mao-capabilities"];
  const defaultCapabilities = id === "coding.capabilities" ? ["coding"]
    : id === "coding.check.run" ? TOOL_CAPABILITIES
      : id === "coding.git.status" || id === "coding.git.diff" || id === "coding.git.log" || id === "coding.github.prepare-pr" ? ["coding", "git"]
        : id === "coding.git.branch.create" || id === "coding.git.commit" ? ["git-write"]
          : id === "coding.github.read" ? ["github-readonly"]
            : id.startsWith("coding.github.") ? ["github-write"]
              : id === "coding.review.diff" ? ["code-review"]
                : id === "coding.browser.scenario" || id === "coding.web.start" || id === "coding.web.stop" ? ["browser-testing"]
                  : ["coding"];
  const capabilities = Object.freeze(Array.isArray(declared) ? declared.filter((item): item is string => typeof item === "string") : defaultCapabilities);
  const annotations = (CODEX_AUTO_APPROVED_CODING_READ_ONLY_TOOLS as readonly string[]).includes(id)
    ? Object.freeze({ readOnlyHint: true, destructiveHint: false, openWorldHint: false })
    : undefined;
  return Object.freeze({ id, name, description, capabilities, ...(annotations ? { annotations } : {}), inputSchema: Object.freeze({ ...inputSchema, "x-mao-capabilities": capabilities }), execute });
}

async function runCheck(raw: unknown, options: RunnerOptions, workspaceRoot: string): Promise<ToolCommandResult> {
  const input = record(raw);
  const check = stringValue(input.check, "check") as CodingCheck;
  const spec = CHECKS[check];
  if (!spec) throw new TypeError(`Unsupported check kind: ${check}`);
  const paths = input.paths === undefined ? [] : stringArray(input.paths, "paths", 0, 32).map((path) => relativeInside(workspaceRoot, path));
  if (paths.length > 0 && !["python-test", "javascript-test", "javascript-check", "vitest", "playwright", "eslint", "ruff", "c-check", "cpp-check", "html-check", "css-check", "shell-check"].includes(check)) throw new TypeError(`${check} does not accept file paths; run the project-level check without paths`);
  const needsFiles = ["javascript-check", "c-check", "cpp-check", "shell-check"].includes(check);
  if (needsFiles && paths.length === 0) throw new TypeError(`${check} requires at least one project-relative source path`);
  const artifactPaths = input.artifacts === undefined ? [] : stringArray(input.artifacts, "artifacts", 0, 32).map((path) => resolveInside(workspaceRoot, path));
  const command = resolveExecutable(spec.command, workspaceRoot, options.commandAvailability, options.repositoryRoot);
  if (!command) return blockedResult(spec.command, `${spec.command} is unavailable; ${check} was not run.`);
  const args = [...spec.args, ...paths];
  const run = await runCommand(command, args, options);
  return commandResult(command, args, run, options, workspaceRoot, artifactPaths);
}

async function gitRead(repositoryRoot: string, args: string[], runner: RunnerOptions): Promise<ToolCommandResult> {
  if (assertGitRoot(repositoryRoot, runner) === "not_repository") {
    return blockedResult(formatCommand("git", args), "The selected project workspace is not a Git repository.", "not_repository");
  }
  const result = await runCommand("git", args, { ...runner, cwd: repositoryRoot });
  return commandResult("git", args, result, runner, repositoryRoot);
}

async function preparePullRequest(repositoryRoot: string, runner: RunnerOptions): Promise<Record<string, unknown>> {
  const [status, branch, diff, log] = await Promise.all([
    gitRead(repositoryRoot, ["status", "--short"], runner),
    gitRead(repositoryRoot, ["branch", "--show-current"], runner),
    gitRead(repositoryRoot, ["diff", "HEAD", "--no-ext-diff", "--"], runner),
    gitRead(repositoryRoot, ["log", "-5", "--format=%h %s"], runner),
  ]);
  const failed = [status, branch, diff, log].find((entry) => entry.status !== "passed");
  return { status: failed ? "failed" : "passed", branch: branch.stdout.trim(), changes: status.stdout, diff: diff.stdout, recentCommits: log.stdout, message: "Draft only; no push or pull request was created." };
}

async function githubRead(raw: unknown, repositoryRoot: string, runner: RunnerOptions): Promise<ToolCommandResult> {
  const input = record(raw);
  const action = stringValue(input.action, "action");
  const gh = resolveExecutable("gh", repositoryRoot, runner.commandAvailability, runner.repositoryRoot);
  if (!gh) return blockedResult("gh", "GitHub read blocked: official gh CLI is not installed; no GitHub request was made.");
  const auth = action === "auth-status";
  const repo = auth ? undefined : await githubRepository(repositoryRoot, runner);
  let args: string[];
  const number = () => {
    if (!Number.isSafeInteger(input.number) || Number(input.number) < 1) throw new TypeError(`${action} requires a positive numeric number`);
    return String(input.number);
  };
  const limit = integerOption(input.limit, 20, 1, 100, "limit");
  switch (action) {
    case "auth-status": args = ["auth", "status", "--hostname", "github.com", "--no-refresh"]; break;
    case "issues": args = ["issue", "list", "--repo", repo!, "--limit", String(limit), "--json", "number,title,state,url,labels,assignees"]; break;
    case "issue": args = ["issue", "view", number(), "--repo", repo!, "--json", "number,title,state,body,url,labels,assignees,comments"]; break;
    case "pull-requests": args = ["pr", "list", "--repo", repo!, "--limit", String(limit), "--json", "number,title,state,url,headRefName,baseRefName,isDraft,statusCheckRollup"]; break;
    case "pull-request": args = ["pr", "view", number(), "--repo", repo!, "--json", "number,title,state,body,url,headRefName,baseRefName,isDraft,statusCheckRollup"]; break;
    case "pull-request-diff": args = ["pr", "diff", number(), "--repo", repo!]; break;
    case "pull-request-checks": args = ["pr", "checks", number(), "--repo", repo!]; break;
    case "workflow-runs": args = ["run", "list", "--repo", repo!, "--limit", String(limit), "--json", "databaseId,displayTitle,status,conclusion,url,workflowName,headBranch,createdAt"]; break;
    case "workflow-run": args = ["run", "view", number(), "--repo", repo!, "--json", "databaseId,displayTitle,status,conclusion,url,workflowName,jobs"]; break;
    default: throw new TypeError(`Unsupported GitHub read action: ${action}`);
  }
  return commandResult(gh, args, await runCommand(gh, args, { ...runner, cwd: repositoryRoot, trustedUserAuth: true }), runner, repositoryRoot);
}

async function reviewDiff(raw: unknown, repositoryRoot: string, runner: RunnerOptions, reviewer?: CodeReviewPort): Promise<Record<string, unknown>> {
  const input = record(raw);
  const requirements = input.requirements === undefined ? [] : stringArray(input.requirements, "requirements", 0, 32);
  const checks = input.checks === undefined ? [] : input.checks;
  if (!Array.isArray(checks) || checks.length > 32 || checks.some((value) => !value || typeof value !== "object" || Array.isArray(value))) throw new TypeError("checks must be an array of at most 32 result objects");
  const diff = await gitRead(repositoryRoot, ["diff", "HEAD", "--no-ext-diff", "--"], runner);
  if (diff.status !== "passed") return { status: "blocked", diff, staticFindings: [], checks, runtimeReview: { status: "blocked", message: "Git diff is unavailable." } };
  const staticFindings = scanDiff(diff.stdout);
  if (!reviewer) return { status: "blocked", diff, staticFindings, checks, runtimeReview: { status: "blocked", message: "Substantive code review needs a CodeReviewPort bound to the existing Codex Runtime; no second Runtime was created." } };
  const runtimeReview = await reviewer.review({ diff: diff.stdout, requirements, checks: checks as Readonly<Record<string, unknown>>[] });
  return { status: "completed", diff, staticFindings, checks, runtimeReview };
}

function scanDiff(diff: string): readonly Readonly<Record<string, string>>[] {
  const rules: readonly { rule: string; severity: string; pattern: RegExp; summary: string }[] = [
    { rule: "hard-coded-secret", severity: "critical", pattern: /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"']{8,}["']/i, summary: "Possible credential literal in changed code" },
    { rule: "dynamic-code-evaluation", severity: "high", pattern: /\beval\s*\(/, summary: "Dynamic code evaluation in changed code" },
    { rule: "shell-command-construction", severity: "high", pattern: /(?:exec|execSync|execFileSync)\s*\(/, summary: "Shell or child-process execution needs input-boundary review" },
    { rule: "tls-verification-disabled", severity: "critical", pattern: /(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0)/, summary: "TLS certificate verification appears disabled" },
  ];
  const findings: Readonly<Record<string, string>>[] = [];
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const rule of rules) if (rule.pattern.test(line.slice(1))) findings.push({ rule: rule.rule, severity: rule.severity, summary: rule.summary, excerpt: line.slice(1, 300) });
    if (/^\+[^+].*(?:"dependencies"|"devDependencies"|"optionalDependencies"|"peerDependencies")/.test(line)) findings.push({ rule: "dependency-change-review-required", severity: "medium", summary: "Review dependency changes and lockfile impact", excerpt: line.slice(1, 300) });
  }
  return findings;
}

async function githubWrite(raw: unknown, repositoryRoot: string, runner: RunnerOptions, enabled: boolean, operation: "push" | "create-pr" | "merge-pr"): Promise<ToolCommandResult> {
  const input = record(raw);
  const confirmation = stringValue(input.confirmation, "confirmation");
  const expectedConfirmation = operation === "push" ? `PUSH ${stringValue(input.branch, "branch")}` : operation === "merge-pr" ? `MERGE PR ${numberValue(input.number, "number")}` : "CREATE PR";
  if (!enabled || confirmation !== expectedConfirmation) return blockedResult(`github ${operation}`, `External GitHub write blocked; enable external-write mode and pass confirmation exactly: ${expectedConfirmation}`);
  const repo = await githubRepository(repositoryRoot, runner);
  if (operation === "push") {
    const branch = stringValue(input.branch, "branch");
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(branch) || branch.includes("..")) throw new TypeError("Invalid branch name");
    const head = await gitRead(repositoryRoot, ["branch", "--show-current"], runner);
    if (head.status !== "passed" || head.stdout.trim() !== branch) throw new Error("Push target must equal the current branch in the selected repository");
    return commandResult("git", ["push", "--set-upstream", "origin", branch], await runCommand("git", ["push", "--set-upstream", "origin", branch], { ...runner, cwd: repositoryRoot, trustedUserAuth: true }), runner, repositoryRoot);
  }
  const gh = resolveExecutable("gh", repositoryRoot, runner.commandAvailability, runner.repositoryRoot);
  if (!gh) return blockedResult("gh", "GitHub write blocked: official gh CLI is unavailable.");
  let args: string[];
  if (operation === "create-pr") {
    const title = stringValue(input.title, "title"); const body = stringValue(input.body, "body"); const base = stringValue(input.base, "base");
    if (!title.trim() || title.length > 200 || body.length > 32_000 || !/^[A-Za-z0-9._/-]{1,120}$/.test(base)) throw new TypeError("Invalid pull request fields");
    args = ["pr", "create", "--repo", repo, "--title", title, "--body", body, "--base", base];
  } else args = ["pr", "merge", String(numberValue(input.number, "number")), "--repo", repo];
  return commandResult(gh, args, await runCommand(gh, args, { ...runner, cwd: repositoryRoot, trustedUserAuth: true }), runner, repositoryRoot);
}

function validateLocalServers(entries: readonly LocalServerDefinition[], workspaceRoot: string): ReadonlyMap<string, LocalServerDefinition & { readonly cwd: string }> {
  if (!Array.isArray(entries) || entries.length > 32) throw new TypeError("localServers must contain at most 32 trusted application definitions");
  const result = new Map<string, LocalServerDefinition & { readonly cwd: string }>();
  for (const entry of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(entry.id) || result.has(entry.id)) throw new TypeError("Local application IDs must be unique and stable");
    if (!["node", "npm", "pnpm", "python3"].includes(entry.command)) throw new TypeError("Local server executable is not allowed");
    if (!Array.isArray(entry.args) || entry.args.length > 32 || entry.args.some((arg: unknown) => typeof arg !== "string" || arg.includes("\0"))) throw new TypeError("Local server arguments must be a fixed string array");
    const cwd = requireDirectory(entry.cwd, `localServers.${entry.id}.cwd`);
    if (!isWithin(workspaceRoot, cwd)) throw new TypeError(`Local application ${entry.id} must run inside the registered workspace`);
    if (typeof entry.urlTemplate !== "string" || !entry.urlTemplate.includes("{port}")) throw new TypeError(`Local application ${entry.id} requires a {port} URL template`);
    const url = new URL(entry.urlTemplate.replaceAll("{port}", "5173"));
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) throw new TypeError(`Local application ${entry.id} must bind to an HTTP loopback URL`);
    result.set(entry.id, Object.freeze({ ...entry, cwd }));
  }
  return result;
}

async function startLocalServer(raw: unknown, definitions: ReadonlyMap<string, LocalServerDefinition & { readonly cwd: string }>, running: Map<string, RunningLocalServer>, timeoutMs: number, repositoryRoot: string): Promise<Record<string, unknown>> {
  const input = record(raw);
  const appId = stringValue(input.appId, "appId");
  const port = boundedInteger(input.port, 1024, 65535, "port");
  const definition = definitions.get(appId);
  if (!definition) return { status: "blocked", appId, message: "Application is not in the host-configured local server allowlist; no process was started." };
  if (running.has(appId)) return { status: "blocked", appId, message: "This configured application already has a process started by the coding adapter." };
  if ([...running.values()].some((server) => { try { return new URL(server.url).port === String(port) && !server.exited; } catch { return false; } })) return { status: "blocked", appId, message: "The requested local port is already assigned to another adapter-managed application." };
  const url = definition.urlTemplate.replaceAll("{port}", String(port));
  const executable = resolveExecutable(definition.command, definition.cwd, undefined, repositoryRoot);
  if (!executable) return { status: "blocked", appId, url, message: `${definition.command} is unavailable; local application was not started.` };
  const args = definition.args.map((arg: string) => arg.replaceAll("{port}", String(port)));
  const child = spawn(executable, args, { cwd: definition.cwd, env: { ...sanitizedEnvironment(join(definition.cwd, ".mao-coding-home")), HOST: "127.0.0.1", PORT: String(port) }, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16_000); });
  let exited = false;
  let exitCode: number | null = null;
  let closeResolve!: () => void;
  const closed = new Promise<void>((resolvePromise) => { closeResolve = resolvePromise; });
  child.once("error", (error) => { exited = true; stderr = `${stderr}\n${errorMessage(error)}`.slice(-16_000); closeResolve(); });
  child.once("close", (code) => { exited = true; exitCode = code; closeResolve(); });
  const state: RunningLocalServer = { child, url, command: formatCommand(executable, args), startedAt: new Date().toISOString(), get exited() { return exited; }, set exited(value: boolean) { exited = value; }, get exitCode() { return exitCode; }, set exitCode(value: number | null) { exitCode = value; }, get stderr() { return stderr; }, set stderr(value: string) { stderr = value; }, closed };
  running.set(appId, state);
  const deadline = Date.now() + Math.min(timeoutMs, 15_000);
  while (Date.now() < deadline && !state.exited) {
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(500) });
      if (response.status < 500) return { status: "passed", appId, pid: child.pid, url, command: state.command, startedAt: state.startedAt };
    } catch { /* server is still starting */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  const detail = state.exited ? `Application exited before readiness with code ${state.exitCode}. ${state.stderr}` : "Application did not become ready on loopback before the bounded startup timeout.";
  await stopLocalServer({ appId }, running);
  return { status: state.exited ? "failed" : "timed_out", appId, url, command: state.command, message: detail };
}

async function stopLocalServer(raw: unknown, running: Map<string, RunningLocalServer>): Promise<Record<string, unknown>> {
  const appId = stringValue(record(raw).appId, "appId");
  const state = running.get(appId);
  if (!state) return { status: "blocked", appId, message: "No adapter-managed process exists for this configured application." };
  if (!state.exited && state.child.pid) {
    try { if (process.platform !== "win32") process.kill(-state.child.pid, "SIGTERM"); else state.child.kill("SIGTERM"); } catch { state.child.kill("SIGTERM"); }
    await Promise.race([state.closed, new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
    if (!state.exited && state.child.pid) {
      try { if (process.platform !== "win32") process.kill(-state.child.pid, "SIGKILL"); else state.child.kill("SIGKILL"); } catch { state.child.kill("SIGKILL"); }
      await Promise.race([state.closed, new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))]);
    }
  }
  running.delete(appId);
  return { status: "passed", appId, command: state.command, exitCode: state.exitCode, message: "Adapter-managed local process stopped." };
}

async function githubRepository(repositoryRoot: string, runner: RunnerOptions): Promise<string> {
  assertGitRoot(repositoryRoot, runner);
  const result = await runCommand("git", ["remote", "get-url", "origin"], { ...runner, cwd: repositoryRoot });
  if (result.exitCode !== 0) throw new Error("The selected repository has no origin remote; refusing to target an unbound GitHub repository");
  const remote = result.stdout.trim();
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote);
  if (!match) throw new Error("The selected repository origin is not a supported github.com URL");
  return `${match[1]}/${match[2]}`;
}

async function discoverCapabilities(workspaceRoot: string, repositoryRoot: string, availability?: (command: string) => boolean, externalWritesEnabled = false): Promise<Record<string, unknown>> {
  const commands = [...new Set([...Object.values(CHECKS).map(({ command }) => command), "git", "gh"] )];
  const detected: Record<string, boolean> = {};
  for (const command of commands) detected[command] = resolveExecutable(command, workspaceRoot, availability, repositoryRoot) !== undefined;
  let gitRoot: string | undefined;
  try { if (assertGitRoot(repositoryRoot, { cwd: repositoryRoot, workspaceRoot, repositoryRoot, timeoutMs: 3_000, maxOutputBytes: 8_192, isolatedHome: join(workspaceRoot, ".mao-coding-home"), commandAvailability: availability }) === "ready") gitRoot = repositoryRoot; } catch { /* a Git inspection error does not hide other available capabilities */ }
  return { workspaceRoot, repositoryRoot: gitRoot, commands: detected, languageChecks: Object.fromEntries(Object.entries(CHECKS).map(([check, spec]) => [check, detected[spec.command]])), externalWritesEnabled };
}

async function runCommand(command: string, args: readonly string[], options: RunnerOptions): Promise<ProcessResult> {
  const started = performance.now();
  const executable = isAbsolute(command) ? command : resolveExecutable(command, options.cwd, options.commandAvailability, options.repositoryRoot);
  if (!executable) return { exitCode: null, stdout: "", stderr: `${command} is unavailable; command was not run.`, timedOut: false, durationMs: Math.round(performance.now() - started) };
  let processCommand = executable;
  let processArgs = [...args];
  let processEnv: NodeJS.ProcessEnv;
  if (options.trustedUserAuth === true) {
    processEnv = sanitizedEnvironment(options.isolatedHome, true);
  } else {
    const bubblewrap = resolveExecutable("bwrap", options.cwd, options.commandAvailability, options.repositoryRoot);
    if (!bubblewrap) return { exitCode: null, stdout: "", stderr: "bubblewrap is unavailable; project command was blocked because its filesystem boundary could not be enforced.", timedOut: false, durationMs: Math.round(performance.now() - started) };
    const isolatedHome = options.isolatedHome;
    const isolatedTmp = join(options.workspaceRoot, ".mao-coding-tmp");
    mkdirSync(isolatedHome, { recursive: true });
    mkdirSync(isolatedTmp, { recursive: true });
    processEnv = sanitizedEnvironment(isolatedHome);
    processEnv.TMPDIR = isolatedTmp;
    processCommand = bubblewrap;
    processArgs = [
      "--die-with-parent", "--ro-bind", "/", "/", "--bind", options.workspaceRoot, options.workspaceRoot,
      "--proc", "/proc", "--dev", "/dev", "--unshare-net", "--chdir", options.cwd, "--clearenv",
      ...Object.entries(processEnv).flatMap(([key, value]) => value === undefined ? [] : ["--setenv", key, value]),
      "--", executable, ...args,
    ];
  }
  return await new Promise((resolvePromise) => {
    let stdout = ""; let stderr = ""; let outputBytes = 0; let timedOut = false; let finished = false;
    let child: ChildProcess;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null) => {
      if (finished) return;
      finished = true; if (timer) clearTimeout(timer);
      resolvePromise({ exitCode, stdout: stdout.slice(-options.maxOutputBytes), stderr: stderr.slice(-options.maxOutputBytes), timedOut, durationMs: Math.round(performance.now() - started) });
    };
    try {
      child = spawn(processCommand, processArgs, { cwd: options.cwd, env: processEnv, shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) { stderr = errorMessage(error); finish(null); return; }
    const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
      outputBytes += chunk.length;
      const text = chunk.toString("utf8");
      if (stream === "stdout") stdout += text; else stderr += text;
      if (outputBytes > options.maxOutputBytes * 2) {
        stderr += "\n[output truncated; process terminated]";
        killChildGroup(child, "SIGTERM");
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    timer = setTimeout(() => { timedOut = true; killChildGroup(child, "SIGTERM"); setTimeout(() => { if (!finished) killChildGroup(child, "SIGKILL"); }, 1_000).unref(); }, options.timeoutMs);
    child.once("error", (error) => { stderr += errorMessage(error); finish(null); });
    child.once("close", (code) => finish(code));
  });
}

function commandResult(command: string, args: readonly string[], result: ProcessResult, options: RunnerOptions, root: string, paths: readonly string[] = []): ToolCommandResult {
  const artifacts = paths.filter((path) => { try { statSync(path).isFile(); return true; } catch { return false; } }).map((path) => ({ path, uri: pathToFileURL(path).href }));
  return Object.freeze({ command: formatCommand(command, args), exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, status: result.timedOut ? "timed_out" : result.exitCode === 0 ? "passed" : result.exitCode === null ? "blocked" : "failed", artifacts });
}

function blockedResult(command: string, message: string, reasonCode?: ToolCommandResult["reasonCode"]): ToolCommandResult {
  return Object.freeze({ command, exitCode: null, stdout: "", stderr: message, durationMs: 0, status: "blocked", ...(reasonCode ? { reasonCode } : {}), artifacts: [] });
}

function combineReadResults(command: string, results: readonly ToolCommandResult[]): ToolCommandResult {
  const failed = results.find((result) => result.status !== "passed");
  return { command, exitCode: failed?.exitCode ?? 0, stdout: results.map((result) => result.stdout).join(""), stderr: results.map((result) => result.stderr).filter(Boolean).join("\n"), durationMs: results.reduce((total, result) => total + result.durationMs, 0), status: failed?.status ?? "passed", artifacts: results.flatMap((result) => result.artifacts) };
}

function resolveExecutable(command: string, workspaceRoot: string, availability?: (command: string) => boolean, repositoryRoot = workspaceRoot): string | undefined {
  if (availability && !availability(command)) return undefined;
  const roots = [...new Set([workspaceRoot, repositoryRoot])];
  const localCandidates = roots.flatMap((root) => [join(root, "node_modules", ".bin", command), join(root, ".venv", "bin", command), join(root, "venv", "bin", command), join(root, "packages", "tools-coding", "node_modules", ".bin", command)]);
  for (const candidate of localCandidates) { try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* try PATH */ } }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, command);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
  }
  return undefined;
}

function killChildGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid && process.platform !== "win32") {
    try { process.kill(-child.pid, signal); return; } catch { /* process group unavailable; fall back to the direct child */ }
  }
  try { child.kill(signal); } catch { /* already exited */ }
}

function sanitizedEnvironment(isolatedHome = homedir(), trustedUserAuth = false): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowed = new Set(["PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "TERM", "CI", "SSH_AUTH_SOCK", "SYSTEMROOT", "WINDIR"]);
  for (const key of allowed) { const value = process.env[key]; if (value !== undefined) env[key] = value; }
  env.HOME = trustedUserAuth ? (process.env.HOME ?? homedir()) : isolatedHome;
  if (trustedUserAuth) for (const key of ["XDG_CONFIG_HOME", "GH_CONFIG_DIR"]) { const value = process.env[key]; if (value) env[key] = value; }
  return env;
}

function assertGitRoot(repositoryRoot: string, runner: RunnerOptions): "ready" | "not_repository" {
  const git = resolveExecutable("git", repositoryRoot, runner.commandAvailability);
  if (!git) throw new Error("git is unavailable");
  const result = spawnSyncSafe(git, ["rev-parse", "--show-toplevel"], repositoryRoot, runner.timeoutMs);
  if (result.code !== 0 || !result.stdout.trim()) {
    if (/not a git repository/i.test(result.stderr)) return "not_repository";
    throw new Error("Git repository inspection failed");
  }
  if (realpathSync(result.stdout.trim()) !== repositoryRoot) throw new Error("Git root does not match the selected repositoryRoot");
  return "ready";
}

function spawnSyncSafe(command: string, args: string[], cwd: string, timeout: number): { code: number | null; stdout: string; stderr: string } {
  // Keep this synchronous check tiny and argument-fixed; all task-facing commands use the bounded async runner.
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout, shell: false, env: sanitizedEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function requireDirectory(path: string, label: string): string {
  if (typeof path !== "string" || !isAbsolute(path)) throw new TypeError(`${label} must be an absolute registered path`);
  let actual: string;
  try { actual = realpathSync(path); } catch { throw new TypeError(`${label} must already exist`); }
  if (!statSync(actual).isDirectory()) throw new TypeError(`${label} must be a directory`);
  return actual;
}

function relativeInside(root: string, path: string): string {
  if (typeof path !== "string" || !path.trim() || isAbsolute(path)) throw new TypeError("path must be relative to the selected workspace");
  if (path.startsWith("-")) throw new TypeError("path cannot be interpreted as a command-line option");
  const absolute = resolve(root, path);
  if (!isWithin(root, absolute)) throw new TypeError("path is outside the selected workspace");
  let probe = absolute;
  while (!existsSync(probe)) {
    const parent = resolve(probe, "..");
    if (parent === probe) break;
    probe = parent;
  }
  try { if (!isWithin(root, realpathSync(probe))) throw new TypeError("path resolves through a symlink outside the selected workspace"); }
  catch (error) { if (error instanceof TypeError) throw error; }
  return relative(root, absolute) || ".";
}

function resolveInside(root: string, path: string): string { return resolve(root, relativeInside(root, path)); }
function isWithin(root: string, target: string): boolean { const rel = relative(root, target); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("tool input must be an object"); return value as Record<string, unknown>; }
function stringValue(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`); return value; }
function stringArray(value: unknown, label: string, min: number, max: number): string[] { if (!Array.isArray(value) || value.length < min || value.length > max || value.some((item) => typeof item !== "string" || !item.trim())) throw new TypeError(`${label} must contain ${min} to ${max} non-empty strings`); return value as string[]; }
function integerOption(value: unknown, fallback: number, min: number, max: number, label: string): number { return value === undefined ? fallback : boundedInteger(value, min, max, label); }
function boundedInteger(value: unknown, min: number, max: number, label: string): number { if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new RangeError(`${label} must be an integer from ${min} to ${max}`); return Number(value); }
function numberValue(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError(`${label} must be a positive integer`); return Number(value); }
function objectSchema(): Readonly<Record<string, unknown>> { return { type: "object", additionalProperties: false }; }
function formatCommand(command: string, args: readonly string[]): string { return [command, ...args].map((arg) => /^[A-Za-z0-9_./:=+-]+$/.test(arg) ? arg : JSON.stringify(arg)).join(" "); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function normalizeOrigins(origins: readonly string[]): readonly string[] { if (!Array.isArray(origins) || origins.length < 1 || origins.length > 64) throw new TypeError("At least one allowed application origin is required"); return Object.freeze([...new Set(origins.map((origin) => { const url = new URL(origin); if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin || url.username || url.password) throw new TypeError(`Invalid allowed origin: ${origin}`); return url.origin; }))]); }
function assertAllowedUrl(value: string, origins: readonly string[] | undefined): void {
  if (!origins) throw new Error("Browser port must declare allowed application origins");
  const url = new URL(value);
  if (url.username || url.password || !origins.includes(url.origin)) throw new Error(`URL origin ${url.origin} is outside configured applications`);
}
function parseBrowserActions(value: unknown): BrowserAction[] {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError("actions must be an array with at most 32 entries");
  return value.map((item) => {
    const action = record(item);
    const type = action.type;
    if (!["click", "fill", "assertText", "screenshot", "snapshot"].includes(String(type))) throw new TypeError("Unsupported browser action");
    if (type === "click" || type === "fill") {
      const hasSelector = typeof action.selector === "string" && action.selector.trim().length > 0;
      const hasUid = typeof action.uid === "string" && action.uid.trim().length > 0;
      if (!hasSelector && !hasUid) throw new TypeError(`${String(type)} requires a selector or MCP element uid`);
    }
    if (type === "fill" && typeof action.value !== "string") throw new TypeError("fill requires a string value");
    if (type === "assertText" && (typeof action.text !== "string" || !action.text)) throw new TypeError("assertText requires expected text");
    if (type === "screenshot") screenshotName(typeof action.name === "string" ? action.name : undefined);
    return action as unknown as BrowserAction;
  });
}
function requiredSelector(action: BrowserAction): string { const selector = stringValue(action.selector, "selector"); if (selector.length > 500) throw new TypeError("selector is too long"); return selector; }
function requiredUid(action: BrowserAction): string { const uid = stringValue(action.uid, "uid"); if (uid.length > 120) throw new TypeError("uid is too long"); return uid; }
function screenshotName(value: string | undefined): string { const name = value ?? `browser-${Date.now()}.png`; if (!/^[A-Za-z0-9_-]{1,80}\.png$/.test(name)) throw new TypeError("screenshot name must be a simple .png file name"); return name; }
function extractText(value: unknown): string { if (typeof value === "string") return value; if (value && typeof value === "object") { const recordValue = value as Record<string, unknown>; if (typeof recordValue.text === "string") return recordValue.text; const content = recordValue.content; if (Array.isArray(content)) return content.map((item) => item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "").join("\n"); } return JSON.stringify(value); }
function extractPageId(value: unknown): number { if (value && typeof value === "object") { const result = value as Record<string, unknown>; if (Number.isSafeInteger(result.pageId)) return Number(result.pageId); if (Number.isSafeInteger(result.id)) return Number(result.id); if (result.structuredContent) return extractPageId(result.structuredContent); } const match = /page(?:\s+id)?\s*[:#]?\s*(\d+)/i.exec(extractText(value)); if (!match) throw new Error("Chrome DevTools MCP new_page response did not include a pageId"); return Number(match[1]); }
function extractConsoleErrors(value: unknown): string[] { const text = extractText(value); if (!text) return []; try { const parsed = JSON.parse(text) as unknown; if (Array.isArray(parsed)) return parsed.map((item) => JSON.stringify(item)).slice(0, 100); } catch { /* MCP often returns formatted text */ } return text.split("\n").filter(Boolean).slice(0, 100); }

interface PlaywrightLocator {
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  textContent(options?: { timeout?: number }): Promise<string | null>;
  innerText(options?: { timeout?: number }): Promise<string>;
}
interface PlaywrightPage {
  on(event: "console", handler: (message: { type(): string; text(): string }) => void): void;
  on(event: "pageerror", handler: (error: Error) => void): void;
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  locator(selector: string): PlaywrightLocator;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  url(): string;
  close(): Promise<void>;
}
interface PlaywrightContext { newPage(): Promise<PlaywrightPage>; pages(): readonly PlaywrightPage[]; }
interface PlaywrightBrowser { contexts(): readonly PlaywrightContext[]; }
