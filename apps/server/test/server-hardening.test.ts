import { afterAll, describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { BudgetManager, type BudgetDecision, type CashPaymentStore, type UsageStore } from "@open-agent-office/budget-manager";
import { seedDirectory } from "@open-agent-office/directory";
import { ProjectPortfolio, ResourceAllocator, RuntimeManager, TaskScheduler } from "@open-agent-office/orchestrator";
import type { ModelDescriptor, RuntimeAdapter, RuntimeCapabilities } from "@open-agent-office/shared";
import { createMaoServer, listenLocalhost, type MaoServer } from "../src/http.js";

const store = (): UsageStore => {
  const records: unknown[] = [];
  return { appendUsage: async record => { if (records.some(x => (x as { eventId: string }).eventId === record.eventId)) return false; records.push(structuredClone(record)); return true; }, readUsage: async () => structuredClone(records) as never };
};
const payments = (): CashPaymentStore => ({ appendPayment: async () => true, readPayments: async () => [] });
const model: ModelDescriptor = { id: "fake/free", provider: "fake-free", runtimeIds: ["fake"], tier: "free", capabilities: ["text"], relativeCost: 0, enabled: true, paidExternal: false, expenseCategory: "free" };
const runtime = (id = "fake"): RuntimeAdapter => {
  const capabilities: RuntimeCapabilities = { runtimeId: id, runtimeType: "opencode", supportedProviders: ["fake-free"], supportedModels: "*", session: false };
  return { id, capabilities: () => capabilities, execute: async () => ({ runtimeId: id, text: "fake", events: [] }) };
};

const listeningServers: Awaited<ReturnType<typeof listenLocalhost>>[] = [];
afterAll(async () => { listeningServers.length = 0; });

async function setup() {
  const directory = seedDirectory();
  const portfolio = new ProjectPortfolio();
  const scheduler = new TaskScheduler(portfolio, new ResourceAllocator([], portfolio));
  const runtimeManager = new RuntimeManager();
  runtimeManager.register(runtime("fake"));
  const budget = new BudgetManager(store(), { paymentStore: payments() });
  return createMaoServer({ token: "secret-token", directory, portfolio, scheduler, runtimeManager, budget, models: [model] });
}

type Body = { status: number; body: unknown };
async function request(app: MaoServer, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Body> {
  const body = init.body;
  const headers: Record<string, string> = { authorization: "Bearer secret-token", ...(init.headers ?? {}) };
  return app.app.dispatch({ method: init.method ?? "GET", url: path, headers, [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(body); } } as unknown as IncomingMessage);
}
const jsonInit = (body: unknown, extra: Record<string, string> = {}, skipType = false) => ({ method: "POST", headers: { ...(skipType ? {} : { "content-type": "application/json" }), ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) });
const projectBody = (id: string, priority = "normal", share = 0.5) => ({ id, name: id, rootDir: `/tmp/${id}`, status: "active", portfolio: { priority, budgetShare: share, maxConcurrentExecutions: 2 } });
const taskBody = (projectId: string, id: string, patch: Record<string, unknown> = {}) => ({ projectId, title: `T ${id}`, brief: ".Private brief data.", priority: "normal", id, ...patch });

const dispatch = (app: MaoServer, method: string, url: string, headers: Record<string, string> = {}, body?: string): Promise<Body> =>
  app.app.dispatch({ method, url, headers, [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(body); } } as unknown as IncomingMessage);

describe("authentication", () => {
  it("refuses missing, empty, malformed and wrong tokens without leaking the secret", async () => {
    const app = await setup();
    const probe = async (headers: Record<string, string>) => (await dispatch(app, "GET", "/v1/health", headers)).status;
    expect(await probe({})).toBe(401);
    expect(await probe({ authorization: "Bearer" })).toBe(401);
    expect(await probe({ authorization: "Bearer " })).toBe(401);
    expect(await probe({ authorization: "Bearer wrong-token" })).toBe(401);
    expect(await probe({ authorization: "Bearer SECRET-TOKEN" })).toBe(401);
    expect(await probe({ authorization: "Basic secret-token" })).toBe(401);
    expect(await probe({ authorization: "Bearer secret-token extra" })).toBe(401);
    expect(await probe({ authorization: "bearer secret-token" })).toBe(200); // scheme is case-insensitive per RFC 7235
    expect(await probe({ authorization: "Bearer secret-token" })).toBe(200);
    for (const path of ["/v1/departments", "/v1/professions", "/v1/projects", "/v1/events", "/v1/models", "/v1/tasks/none"]) {
      expect((await dispatch(app, "GET", path, { authorization: "Bearer wrong" })).status).toBe(401);
    }
    expect((await dispatch(app, "POST", "/v1/tasks", { authorization: "Bearer wrong" }, "{}")).status).toBe(401);
    const denied = await dispatch(app, "GET", "/v1/health", { authorization: "Bearer wrong" });
    expect(JSON.stringify(denied.body)).not.toContain("secret-token");
  });

  it("accepts post bodies only with an application/json content-type", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("ctype-a")));
    expect((await request(app, "/v1/tasks", { ...jsonInit(taskBody("ctype-a", "t-1")), headers: { authorization: "Bearer secret-token", "content-type": "text/plain" } })).status).toBe(415);
    expect((await request(app, "/v1/tasks", jsonInit(taskBody("ctype-a", "t-2")))).status).toBe(202);
    expect((await request(app, "/v1/projects", { ...jsonInit(projectBody("ctype-b")), headers: { authorization: "Bearer secret-token", "content-type": "text/xml" } })).status).toBe(415);
  });
});

describe("request validation", () => {
  it("rejects structurally invalid bodies without touching scheduler state", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("val-p")));
    expect((await request(app, "/v1/tasks", jsonInit([1, 2, 3], { "idempotency-key": "arr" }))).status).toBe(422);
    expect((await request(app, "/v1/tasks", jsonInit(null))).status).toBe(422);
    expect((await request(app, "/v1/tasks", jsonInit(true))).status).toBe(422);
    expect((await request(app, "/v1/tasks", jsonInit(taskBody("val-p", "bad id")))).status).toBe(422);
    expect((await request(app, "/v1/tasks", jsonInit({ projectId: "val-p", title: "T", brief: "B", priority: "urgent" }))).status).toBe(422);
    expect((await request(app, "/v1/tasks", jsonInit(taskBody("ghost-project", "w-t")))).status).toBe(422);
    expect((await request(app, "/v1/tasks", jsonInit("{", {}, true))).status).toBe(400);
    // Task endpoints deliberately answer unknown/malformed ids with 404 (lookup-based).
    expect((await request(app, "/v1/tasks/task-bad!id")).status).toBe(404);
    expect((await app.app.dispatch({ method: "PATCH", url: "/v1/tasks/x", headers: { authorization: "Bearer secret-token" }, [Symbol.asyncIterator]: async function* () {} } as unknown as IncomingMessage)).status).toBe(404);
    expect((await app.app.dispatch({ method: "GET", url: `/v1/${"a".repeat(2000)}`, headers: { authorization: "Bearer secret-token" }, [Symbol.asyncIterator]: async function* () {} } as unknown as IncomingMessage)).status).toBe(404);
    const big = JSON.stringify(projectBody("val-big"));
    const bigResponse = (await app.app.dispatch({ method: "POST", url: "/v1/projects", headers: { authorization: "Bearer secret-token", "content-type": "application/json" }, [Symbol.asyncIterator]: async function* () { yield Buffer.alloc(2_000_001, 0x62); void big; } } as unknown as IncomingMessage));
    expect(bigResponse.status).toBe(413);
  });

  it("rejects invalid project policy numbers (NaN, negative, zero) with 422", async () => {
    const app = await setup();
    for (const portfolioPatch of [{ budgetShare: -0.5, maxConcurrentExecutions: 2 }, { budgetShare: 0.4, maxConcurrentExecutions: 0 }, { budgetShare: 1.5, maxConcurrentExecutions: 2 }]) {
      const body = { id: `val-${JSON.stringify(portfolioPatch).length}`, name: "x", rootDir: "/tmp/x", status: "active", portfolio: { priority: "normal", ...portfolioPatch } };
      expect((await request(app, "/v1/projects", jsonInit(body))).status).toBe(422);
    }
  });

  it("does not create intermediate state when a request fails late", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("atomic-p")));
    await request(app, "/v1/tasks", jsonInit(taskBody("atomic-p", "atomic-1")));
    const duplicate = await request(app, "/v1/tasks", jsonInit(taskBody("atomic-p", "atomic-1")));
    expect(duplicate.status).toBe(422);
    const view = (await request(app, "/v1/projects/atomic-p")).body as { tasks: unknown[] };
    expect(view.tasks).toHaveLength(1);
  });
});

describe("idempotency", () => {
  const key = { "idempotency-key": "same-key" };

  it("returns the same task for the same key and body, 409 for a different body", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("idem-p")));
    const first = await request(app, "/v1/tasks", jsonInit(taskBody("idem-p", "idem-task"), key));
    const replay = await request(app, "/v1/tasks", jsonInit(taskBody("idem-p", "idem-task"), key));
    expect(first.status).toBe(202);
    expect(replay.body).toEqual(first.body);
    const otherPayload = await request(app, "/v1/tasks", jsonInit(taskBody("idem-p", "idem-task", { title: "Different" }), key));
    expect(otherPayload.status).toBe(409);
    const otherProject = await request(app, "/v1/tasks", jsonInit(taskBody("idem-p", "idem-task", { projectId: "ghost" }), key));
    expect(otherProject.status).toBe(409);
    const view = (await request(app, "/v1/projects/idem-p")).body as { tasks: unknown[] };
    expect(view.tasks).toHaveLength(1);
  });

  it("serializes racing identical requests so only one task is queued", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("race-p")));
    const payload = jsonInit(taskBody("race-p", "race-task"), key);
    const [a, b] = await Promise.all([request(app, "/v1/tasks", payload), request(app, "/v1/tasks", payload)]);
    expect([a.status, b.status]).toEqual([202, 202]);
    const view = (await request(app, "/v1/projects/race-p")).body as { tasks: unknown[] };
    expect(view.tasks).toHaveLength(1);
  });

  it("treats concurrent different payloads under one key deterministically: one task plus a conflict", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("live-p")));
    const [a, b] = await Promise.all([
      request(app, "/v1/tasks", jsonInit(taskBody("live-p", "live-a"), key)),
      request(app, "/v1/tasks", jsonInit(taskBody("live-p", "live-b"), key)),
    ]);
    expect([202, 409].sort()).toEqual([a.status, b.status].sort());
    const view = (await request(app, "/v1/projects/live-p")).body as { tasks: unknown[] };
    expect(view.tasks).toHaveLength(1);
  });

  it("does not create a task without an Idempotency-Key replay path", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("nokey-p")));
    const first = await request(app, "/v1/tasks", jsonInit(taskBody("nokey-p", "nokey-1")));
    const second = await request(app, "/v1/tasks", jsonInit(taskBody("nokey-p", "nokey-1")));
    expect(first.status).toBe(202);
    expect(second.status).toBe(422);
  });
});

describe("project isolation and lifecycle", () => {
  it("isolates tasks of different projects and refuses foreign ids", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("iso-a", "normal", 0.25)));
    await request(app, "/v1/projects", jsonInit(projectBody("iso-b", "normal", 0.25)));
    await request(app, "/v1/tasks", jsonInit(taskBody("iso-a", "iso-task-a")));
    await request(app, "/v1/tasks", jsonInit(taskBody("iso-b", "iso-task-b")));
    const a = (await request(app, "/v1/projects/iso-a")).body as { tasks: Array<{ id: string }> };
    const b = (await request(app, "/v1/projects/iso-b")).body as { tasks: Array<{ id: string }> };
    expect(a.tasks.map(x => x.id)).toEqual(["iso-task-a"]);
    expect(b.tasks.map(x => x.id)).toEqual(["iso-task-b"]);
    const filtered = ((await request(app, "/v1/tasks/iso-task-a")).body as { task: { projectId: string } }).task;
    expect(filtered.projectId).toBe("iso-a");
    expect(((await request(app, "/v1/projects/iso-a?includeTasks=false")).body as { tasks: unknown }).tasks).toBeUndefined();
  });

  it("queues into paused projects only after resume, refuses archived", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("lifecycle-p")));
    expect((await request(app, "/v1/tasks", jsonInit(taskBody("lifecycle-p", "pt-1")))).status).toBe(202);
    const archived = { ...projectBody("archived-p"), status: "archived" };
    await request(app, "/v1/projects", jsonInit(archived));
    expect((await request(app, "/v1/tasks", jsonInit(taskBody("archived-p", "at-1")))).status).toBe(422);
  });

  it("cancels a queued task once and then reports conflicts on retries", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("cancel-p")));
    await request(app, "/v1/tasks", jsonInit(taskBody("cancel-p", "cancel-task")));
    expect((await request(app, "/v1/tasks/cancel-task/cancel", { method: "POST" })).status).toBe(200);
    expect(((await request(app, "/v1/tasks/cancel-task")).body as { task: { status: string } }).task.status).toBe("cancelled");
    expect((await request(app, "/v1/tasks/cancel-task/cancel", { method: "POST" })).status).toBe(409);
    expect((await request(app, "/v1/tasks/cancel-task", jsonInit({}))).status).toBe(404);
  });
});

describe("budget API", () => {
  it("budget snapshot is read-only per contract shape and exposes category statuses", async () => {
    const app = await setup();
    const before = (await request(app, "/v1/budget/snapshot")).body as { status: string; monthlyBudgetRub: number; allowanceStatus: string; subscriptionUsage?: { status: string } };
    expect((await request(app, "/v1/budget/snapshot")).body).toEqual(before);
    expect(before.allowanceStatus).toBe("unknown");
    expect(before.monthlyBudgetRub).toBe(1000);
    expect(before.subscriptionUsage?.status).toBe("unknown");
    expect(JSON.stringify(before)).not.toContain("bearer");
    expect(((await request(app, "/v1/usage/models")).body as { stats: unknown[] }).stats).toEqual([]);
    void (null as unknown as BudgetDecision);
  });
});

describe("runtime and models honesty", () => {
  it("lists only registered runtimes and exposes honest readiness without inventing production capabilities", async () => {
    const app = await setup();
    const body = (await request(app, "/v1/runtimes")).body as { runtimes: Array<{ runtimeId: string; runtimeType: string; kind: string; registered: boolean; available: boolean; authentication: { verified: boolean }; readiness: { ready: boolean; restrictions: string[] } }> };
    expect(body.runtimes).toHaveLength(1);
    expect(body.runtimes[0]).toMatchObject({ runtimeId: "fake", runtimeType: "opencode", kind: "fake", registered: true, available: true, authentication: { verified: false }, readiness: { ready: false } });
    expect(body.runtimes[0].readiness.restrictions).toContain("fake_runtime");
    expect(JSON.stringify(body)).not.toContain("codex");
    const models = (await request(app, "/v1/models")).body as { models: Array<{ id: string; expenseCategory: string }> };
    expect(models.models).toHaveLength(1);
    expect(models.models[0]).toMatchObject({ id: "fake/free", expenseCategory: "free", paidExternal: false, tier: "free" });
  });
});

describe("events", () => {
  it("filters by taskId, type, from and clamps limit with deterministic order", async () => {
    const app = await setup();
    await request(app, "/v1/projects", jsonInit(projectBody("ev-p")));
    await request(app, "/v1/tasks", jsonInit(taskBody("ev-p", "ev-a"), { "idempotency-key": "ev-a" }));
    await request(app, "/v1/tasks", jsonInit(taskBody("ev-p", "ev-b"), { "idempotency-key": "ev-b" }));
    await request(app, "/v1/tasks/ev-a/cancel", { method: "POST" });
    const all = (await request(app, "/v1/events")).body as { events: Array<{ type: string; taskId?: string }> };
    expect(all.events.map(x => x.type)).toEqual(["task_queued", "task_queued", "task_cancelled"]);
    expect(((await request(app, "/v1/events?taskId=ev-a")).body as { events: unknown[] }).events).toHaveLength(2);
    expect(((await request(app, "/v1/events?type=task_cancelled")).body as { events: unknown[] }).events).toHaveLength(1);
    expect(((await request(app, "/v1/events?limit=1")).body as { events: unknown[] }).events).toHaveLength(1);
    expect((await request(app, "/v1/events?limit=-3")).status).toBe(422);
    expect((await request(app, "/v1/events?limit=abc")).status).toBe(422);
    expect((await request(app, "/v1/events?from=not-a-date")).status).toBe(422);
    expect(JSON.stringify(all)).not.toContain("Private brief data");
  });
});

describe("server lifecycle", () => {
  it("smoke-tests a real socket bound to 127.0.0.1 and stops cleanly", async (context) => {
    const app = await setup();
    let address: string;
    try { address = await listenLocalhost(app.server, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { context.skip("sandbox forbids localhost socket binding"); return; } throw error; }
    expect(address.startsWith("127.0.0.1:")).toBe(true);
    const url = `http://${address}/v1/health`;
    const response = await fetch(url, { headers: { authorization: "Bearer secret-token" } });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { status: string };
    expect(payload.status).toBe("ok");
    const unauthorized = await fetch(url);
    expect(unauthorized.status).toBe(401);
    await new Promise<void>(resolve => app.server.close(() => resolve()));
  });

  it("reports a busy port as an error and keeps the first server alive", async (context) => {
    const first = await setup();
    let firstAddress: string;
    try { firstAddress = await listenLocalhost(first.server, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { context.skip("sandbox forbids localhost socket binding"); return; } throw error; }
    const port = Number(firstAddress.split(":")[1]);
    const second = await setup();
    await expect(listenLocalhost(second.server, port)).rejects.toThrow();
    const stillAlive = await fetch(`http://${firstAddress}/v1/health`, { headers: { authorization: "Bearer secret-token" } });
    expect(stillAlive.status).toBe(200);
    await new Promise<void>(resolve => first.server.close(() => resolve()));
    await new Promise<void>(resolve => second.server.close(() => resolve()));
  });

  it("importing the server library has no side effects (no listening sockets)", async () => {
    await import("../src/index.js");
    const second = await setup();
    expect(second.server.listening).toBe(false);
  });
});
