import { describe, expect, it } from "vitest";
import { FetchTransport, OperatorError, type HttpTransport, loadOperatorConfig, runCli, watchTask } from "../src/cli";

class FakeTransport implements HttpTransport {
  readonly calls: Array<{ method: string; path: string; body?: unknown; headers?: Record<string, string> }> = [];
  constructor(private readonly responses: Record<string, unknown>, private readonly statuses: Record<string, number> = {}) {}
  async request<T>(method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}) {
    this.calls.push({ method, path, body: options.body, headers: options.headers });
    const status = this.statuses[path] ?? 200;
    if (status >= 400) throw new OperatorError(status === 401 ? "unauthorized: authorization required" : "request failed", status === 401 ? 2 : 1);
    return { status, body: (this.responses[path] ?? {}) as T };
  }
}

describe("operator CLI", () => {
  it("prints help without HTTP", async () => {
    const lines: string[] = [];
    expect(await runCli(["--help"], { output: (line) => lines.push(line) })).toBe(0);
    expect(lines.join("\n")).toContain("task submit");
  });

  it("uses authenticated requests without exposing the token", async () => {
    let requestHeaders: HeadersInit | undefined; const transport = new FetchTransport({ baseUrl: "http://127.0.0.1:3333/", token: "do-not-print", timeoutMs: 1000 }, async (_input, init) => { requestHeaders = init?.headers; return new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json" } }); }); const lines: string[] = [];
    expect(await runCli(["health"], { client: transport, output: (line) => lines.push(line) })).toBe(0);
    expect(new Headers(requestHeaders).get("authorization")).toBe("Bearer do-not-print");
    expect(lines.join(" ")).not.toContain("do-not-print");
  });

  it("covers list, readiness, diagnostics and archive routes", async () => {
    const transport = new FakeTransport({ "/v1/projects": { projects: [] }, "/v1/employees": { employees: [] }, "/v1/runtimes": { runtimes: [{ runtimeId: "fake", available: true }] }, "/v1/executions/diagnostics": { aggregates: {} }, "/v1/archive/projects/p": { project: { projectId: "p" } }, "/v1/archive/tasks/t/history": { events: [] }, "/v1/archive/projects/p/events": { events: [] } });
    for (const args of [["projects"], ["employees"], ["runtimes"], ["diagnostics"], ["archive", "project", "--id", "p"], ["archive", "task", "--id", "t"], ["archive", "events", "--project-id", "p"]]) expect(await runCli(args, { client: transport, output: () => undefined })).toBe(0);
    expect(transport.calls.map((call) => call.path)).toEqual(["/v1/projects", "/v1/employees", "/v1/runtimes", "/v1/executions/diagnostics", "/v1/archive/projects/p", "/v1/archive/tasks/t/history", "/v1/archive/projects/p/events"]);
  });

  it("creates and shows projects using the server DTO", async () => {
    const transport = new FakeTransport({ "/v1/projects": { project: { id: "p" } }, "/v1/projects/p": { project: { id: "p", name: "Demo" } } });
    expect(await runCli(["project", "create", "--project-id", "p", "--name", "Demo", "--root-dir", "/tmp/demo", "--priority", "high", "--budget-share", "0.25", "--max-concurrent-executions", "2"], { client: transport, output: () => undefined })).toBe(0);
    expect(await runCli(["project", "show", "p"], { client: transport, output: () => undefined })).toBe(0);
    expect(transport.calls[0]).toMatchObject({ method: "POST", path: "/v1/projects", body: { id: "p", name: "Demo", rootDir: "/tmp/demo", status: "active", portfolio: { priority: "high", budgetShare: 0.25, maxConcurrentExecutions: 2 } } });
  });

  it("rejects invalid project policy before HTTP and maps duplicate errors", async () => {
    const calls: string[] = []; const transport = new FakeTransport({}, { "/v1/projects": 422 });
    expect(await runCli(["project", "create", "--project-id", "p", "--name", "Demo", "--root-dir", "/tmp/demo", "--priority", "urgent", "--budget-share", "2", "--max-concurrent-executions", "0"], { client: transport, output: () => undefined, error: (line) => calls.push(line) })).toBe(1);
    expect(transport.calls).toHaveLength(0);
    expect(await runCli(["project", "create", "--project-id", "p", "--name", "Demo", "--root-dir", "/tmp/demo", "--budget-share", "0.1", "--max-concurrent-executions", "1"], { client: transport, output: () => undefined, error: (line) => calls.push(line) })).toBe(1);
    expect(calls.join(" ")).toContain("request failed");
  });

  it("submits idempotently and never retries POST", async () => {
    const transport = new FakeTransport({ "/v1/tasks": { task: { id: "t" } } });
    expect(await runCli(["task", "submit", "--project-id", "p", "--title", "Title", "--brief", "Brief", "--complexity", "simple", "--idempotency-key", "key"], { client: transport, output: () => undefined })).toBe(0);
    expect(transport.calls).toHaveLength(1); expect(transport.calls[0]).toMatchObject({ method: "POST", path: "/v1/tasks", headers: { "idempotency-key": "key" }, body: { projectId: "p", title: "Title", brief: "Brief", complexity: "simple" } });
  });

  it("supports status and cancellation", async () => {
    const transport = new FakeTransport({ "/v1/tasks/t": { status: "running", employeeId: "developer", runtimeId: "fake", modelId: "fake/model", attempts: 1 }, "/v1/tasks/t/cancel": { cancelled: true } });
    expect(await runCli(["task", "status", "t"], { client: transport, output: () => undefined })).toBe(0);
    expect(await runCli(["task", "cancel", "t"], { client: transport, output: () => undefined })).toBe(0);
    expect(transport.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /v1/tasks/t", "POST /v1/tasks/t/cancel"]);
  });

  it("watches with bounded polling and stops at terminal state", async () => {
    let count = 0; const transport: HttpTransport = { async request<T>() { count += 1; return { status: 200, body: { status: count < 2 ? "running" : "completed", attempts: count } as T }; } };
    const updates: string[] = []; const result = await watchTask(transport, "t", { intervalMs: 100, timeoutMs: 1000, sleep: async () => undefined, onUpdate: (body) => updates.push(String(body.status)) });
    expect(result.status).toBe("completed"); expect(updates).toEqual(["running", "completed"]); expect(count).toBe(2);
  });

  it("returns failed terminal tasks, times out and handles Ctrl+C", async () => {
    const failed: HttpTransport = { async request<T>() { return { status: 200, body: { status: "failed", error: { code: "runtime_failed" } } as T }; } };
    await expect(watchTask(failed, "t", { sleep: async () => undefined })).resolves.toMatchObject({ status: "failed" });
    const running: HttpTransport = { async request<T>() { return { status: 200, body: { status: "running" } as T }; } };
    await expect(watchTask(running, "t", { intervalMs: 100, timeoutMs: 100, sleep: async () => new Promise((resolve) => setTimeout(resolve, 110)) })).rejects.toThrow("timed out");
    const controller = new AbortController(); controller.abort();
    await expect(watchTask(running, "t", { signal: controller.signal, sleep: async () => undefined })).rejects.toThrow("cancelled");
  });

  it("runs the safe Fake demo, checks archive and performs one task POST", async () => {
    const transport = new FakeTransport({ "/v1/health": { status: "ok" }, "/v1/status": { archive: { configured: true } }, "/v1/runtimes": { runtimes: [{ runtimeId: "fake", kind: "fake", registered: true, available: true }, { runtimeId: "codex", kind: "production", registered: false, available: false }] }, "/v1/projects": { project: { id: "demo-project" } }, "/v1/tasks": { task: { id: "demo-task" } }, "/v1/archive/tasks/demo-task/history": { events: [{ type: "task_completed" }] } });
    const result = await (await import("../src/cli")).runFakeDemo(transport, [], { output: () => undefined, watch: async () => ({ status: "completed", taskId: "demo-task", result: { text: "fake result" } }) });
    expect(result.task).toMatchObject({ status: "completed" });
    expect(transport.calls.filter((call) => call.method === "POST" && call.path === "/v1/tasks")).toHaveLength(1);
    expect(transport.calls.some((call) => call.path === "/v1/archive/tasks/demo-task/history")).toBe(true);
  });

  it("reports archive disabled without inventing an archive request", async () => {
    const transport = new FakeTransport({ "/v1/health": {}, "/v1/status": { archive: { configured: false } }, "/v1/runtimes": { runtimes: [{ runtimeId: "fake", kind: "fake", registered: true, available: true }] }, "/v1/projects": { project: { id: "demo-project" } }, "/v1/tasks": { task: { id: "demo-task" } } });
    const result = await (await import("../src/cli")).runFakeDemo(transport, [], { output: () => undefined, watch: async () => ({ status: "completed", taskId: "demo-task" }) });
    expect(result.archive).toEqual({ enabled: false });
    expect(transport.calls.some((call) => call.path.includes("/v1/archive/"))).toBe(false);
  });

  it("refuses Fake demo when production runtime is available", async () => {
    const transport = new FakeTransport({ "/v1/health": {}, "/v1/status": {}, "/v1/runtimes": { runtimes: [{ runtimeId: "fake", kind: "fake", registered: true, available: true }, { runtimeId: "opencode", kind: "production", registered: true, available: true }] } });
    await expect((await import("../src/cli")).runFakeDemo(transport, [], { output: () => undefined })).rejects.toThrow("no available production Runtime");
    expect(transport.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("supports JSON output and exit codes without duplicating POST", async () => {
    const transport = new FakeTransport({ "/v1/tasks": { task: { id: "t" } } }); const output: string[] = [];
    expect(await runCli(["task", "submit", "--json", "--project-id", "p", "--title", "T", "--brief", "safe", "--idempotency-key", "k"], { client: transport, output: (line) => output.push(line) })).toBe(0);
    expect(JSON.parse(output.join("\n"))).toEqual({ task: { id: "t" } });
    expect(transport.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("fails safely on unauthorized and unavailable server responses", async () => {
    const errors: string[] = []; const unauthorized = new FakeTransport({}, { "/v1/status": 401 });
    expect(await runCli(["status"], { client: unauthorized, output: () => undefined, error: (line) => errors.push(line) })).toBe(2);
    expect(errors.join(" ")).not.toContain("do-not-print");
    const unavailable: HttpTransport = { async request() { throw new OperatorError("server unavailable", 2); } };
    expect(await runCli(["health"], { client: unavailable, output: () => undefined, error: (line) => errors.push(line) })).toBe(2);
  });

  it("redacts the configured token from a hostile HTTP error", async () => {
    const errors: string[] = [];
    const transport = new FetchTransport({ baseUrl: "http://127.0.0.1:3333/", token: "private-token", timeoutMs: 1000 }, async () => new Response(JSON.stringify({ error: { code: "bad", message: "private-token" } }), { status: 500 }));
    expect(await runCli(["status"], { client: transport, output: () => undefined, error: (line) => errors.push(line) })).toBe(2);
    expect(errors.join(" ")).not.toContain("private-token");
  });

  it("rejects unsafe task ids and reads owner-only token files", async () => {
    const config = await loadOperatorConfig({ MAO_SERVER_URL: "http://127.0.0.1:3333", MAO_TOKEN: "secret", MAO_HTTP_TIMEOUT_MS: "500" });
    expect(config.baseUrl).toBe("http://127.0.0.1:3333/"); expect(config.token).toBe("secret");
    const errors: string[] = [];
    expect(await runCli(["task", "status", "../x"], { client: new FakeTransport({}), output: () => undefined, error: (line) => errors.push(line) })).toBe(1);
    expect(errors[0]).toContain("invalid task id");
  });
});
