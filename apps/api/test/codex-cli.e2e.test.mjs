import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createApiServer } from "@mao-hybrid/api";
import { createDefaultRoster } from "@mao-hybrid/company";
import { createEventBus } from "@mao-hybrid/events";
import { createCodexRuntime } from "@mao-hybrid/runtime";

const codexPath = process.env.MAO_HYBRID_CODEX_CLI;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("real Codex CLI records capabilities, Git status, and non-repository blocked outcomes through task-scoped MCP", { skip: !codexPath, timeout: 360_000 }, async (t) => {
  const version = execFileSync(codexPath, ["--version"], { encoding: "utf8", timeout: 5_000 }).trim();
  t.diagnostic(`real Codex CLI: ${version}`);
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-real-codex-"));
  const workspace = join(scratch, "project");
  const plainWorkspace = join(scratch, "plain-project");
  await mkdir(workspace);
  await mkdir(plainWorkspace);
  execFileSync("git", ["-C", workspace, "init", "--quiet"]);
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable: codexPath, sandbox: "workspace-write", events });
  const api = await createApiServer({ config: { host: "127.0.0.1", port: 0, dataDirectory: join(scratch, "data"), maxConcurrent: 1 }, runtime, events });
  const address = await api.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });

  for (const project of [
    { id: "real-codex-project", name: "Real Codex MCP E2E", workspaceRoot: workspace },
    { id: "real-codex-no-git", name: "Real Codex Non-Git E2E", workspaceRoot: plainWorkspace },
  ]) {
    const projectResponse = await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(project) });
    assert.equal(projectResponse.status, 201);
  }
  async function submit(projectId, title, brief, acceptance, key) {
    const response = await fetch(`${origin}/api/tasks`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ projectId, title, brief, acceptanceCriteria: acceptance, complexity: "simple" }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  const gitTask = await submit("real-codex-project", "Inspect Coding Tools capabilities and Git status", "Call coding.capabilities, then call coding.git.status and report both actual structured results. Do not run a shell Git command or modify files.", ["A successful coding.capabilities MCP result is recorded.", "A successful coding.git.status MCP result is recorded."], "real-codex-capabilities-and-git-status");
  t.diagnostic(`capabilities+Git task completed: ${gitTask.task.id}`);
  assert.equal(gitTask.task.status, "completed", JSON.stringify(gitTask.steps));
  const realCalls = gitTask.steps[0].result.toolCalls;
  assert.ok(realCalls.some(call => call.toolId === "coding.capabilities" && call.status === "completed"), JSON.stringify(realCalls));
  assert.ok(realCalls.some(call => call.toolId === "coding.git.status" && call.status === "completed" && call.result.status === "passed"), JSON.stringify(realCalls));
  const gitEvents = api.events.list(gitTask.task.id).filter(event => event.type === "tool.completed").map(event => event.data.toolName);
  assert.ok(gitEvents.includes("coding.capabilities") && gitEvents.includes("coding.git.status"), JSON.stringify(gitEvents));
  const gitStored = api.store.getTask(gitTask.task.id);
  assert.ok(gitStored.steps[0].result.toolCalls.some(call => call.toolId === "coding.capabilities"));
  assert.ok(gitStored.steps[0].result.toolCalls.some(call => call.toolId === "coding.git.status" && call.result.status === "passed"));

  const noGitTask = await submit("real-codex-no-git", "Read Git status in non-Git workspace", "Call coding.git.status and report its actual result. Do not run a shell Git command or modify files.", ["A coding.git.status MCP result is recorded."], "real-codex-no-git-status");
  t.diagnostic(`non-Git task completed: ${noGitTask.task.id}`);
  assert.equal(noGitTask.task.status, "needs_review", JSON.stringify(noGitTask.steps));
  assert.equal(noGitTask.steps[0].error, "mcp_tool_blocked:mao_coding/coding.git.status:not_repository");
  assert.equal(noGitTask.steps[0].result.toolCalls[0].status, "completed");
  assert.equal(noGitTask.steps[0].result.toolCalls[0].result.reasonCode, "not_repository");
  assert.ok(api.events.list(noGitTask.task.id).some(event => event.type === "tool.completed" && event.data.toolName === "coding.git.status" && event.data.result.reasonCode === "not_repository"));
  assert.equal(api.store.getTask(noGitTask.task.id).steps[0].result.toolCalls[0].result.reasonCode, "not_repository");
  t.diagnostic(`real Codex tasks: capabilities+git=${gitTask.task.id}, nonGit=${noGitTask.task.id}`);
});

test("real Codex executes ngspice and KiCad MCP tasks and persists tool evidence in Task Store", { skip: !codexPath, timeout: 360_000 }, async (t) => {
  const version = execFileSync(codexPath, ["--version"], { encoding: "utf8", timeout: 5_000 }).trim();
  t.diagnostic(`real Codex CLI: ${version}`);
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-real-electronics-"));
  const workspace = join(scratch, "electronics-project");
  const fixtures = join(repositoryRoot, "packages/tools-electronics/test/fixtures");
  const circuit = join(workspace, "circuit");
  await mkdir(circuit, { recursive: true });
  await cp(join(fixtures, "voltage-divider.cir"), join(circuit, "divider.cir"));
  await cp(join(fixtures, "empty-sheet.kicad_sch"), join(circuit, "empty.kicad_sch"));
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable: codexPath, sandbox: "workspace-write", events });
  const api = await createApiServer({ config: { host: "127.0.0.1", port: 0, dataDirectory: join(scratch, "task-store"), maxConcurrent: 1 }, runtime, events });
  const address = await api.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  const projectResponse = await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "electronics-project", name: "Isolated electronics E2E", workspaceRoot: workspace }) });
  assert.equal(projectResponse.status, 201);

  async function submit(title, brief, acceptance, key) {
    const response = await fetch(`${origin}/api/tasks`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ projectId: "electronics-project", title, brief, acceptanceCriteria: acceptance, complexity: "simple" }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  const simulation = await submit(
    "Analyze an electronics voltage divider with ngspice",
    "Use MCP tool electronics.ngspice.run on circuit/divider.cir with DC operating point analysis. Do not use shell commands or claim a result that is not in the structured tool output. Report the measured v(out).",
    ["A completed electronics.ngspice.run toolCalls result has PASS status and measured v(out) approximately 5 V."],
    "real-electronics-ngspice-divider",
  );
  t.diagnostic(`real ngspice task id: ${simulation.task.id}`);
  assert.equal(simulation.task.status, "completed", JSON.stringify(simulation.steps));
  assert.equal(simulation.steps[0].roleId, "electronics-engineer");
  const simCall = simulation.steps[0].result.toolCalls.find(call => call.server === "mao_electronics" && call.toolId === "electronics.ngspice.run");
  assert.equal(simCall?.status, "completed", JSON.stringify(simulation.steps[0].result.toolCalls));
  assert.equal(simCall?.result.status, "PASS", JSON.stringify(simCall));
  assert.match(simCall?.result.stdout ?? "", /5\.0{3,}e\+00/i);
  const simEvents = events.list(simulation.task.id).filter(event => event.data.server === "mao_electronics" && event.data.toolName === "electronics.ngspice.run");
  assert.deepEqual(simEvents.map(event => event.type), ["tool.started", "tool.completed"]);
  const simStored = api.store.getTask(simulation.task.id);
  assert.equal(simStored.steps[0].result.toolCalls[0].result.status, "PASS");
  assert.deepEqual(simStored.events.filter(event => event.data?.server === "mao_electronics").map(event => event.type), ["tool.started", "tool.completed"]);
  assert.ok(simStored.events.some(event => event.type === "step_completed" && event.result.toolCalls[0].toolId === "electronics.ngspice.run"));

  const erc = await submit(
    "Check an electronics circuit with KiCad ERC",
    "Use MCP tool electronics.kicad.erc on circuit/empty.kicad_sch. Do not use shell commands. Report the actual ERC status and violation count from its structured result.",
    ["A completed electronics.kicad.erc toolCalls result is recorded with the actual CLI status."],
    "real-electronics-kicad-erc",
  );
  t.diagnostic(`real KiCad task id: ${erc.task.id}`);
  assert.equal(erc.task.status, "completed", JSON.stringify(erc.steps));
  assert.equal(erc.steps[0].roleId, "electronics-engineer");
  const ercCall = erc.steps[0].result.toolCalls.find(call => call.server === "mao_electronics" && call.toolId === "electronics.kicad.erc");
  assert.equal(ercCall?.status, "completed", JSON.stringify(erc.steps[0].result.toolCalls));
  assert.equal(ercCall?.result.status, "PASS", JSON.stringify(ercCall));
  assert.equal(ercCall?.result.exitCode, 0);
  assert.ok(ercCall?.result.createdFiles.some(path => path.startsWith(`${workspace}/`)));
  const ercEvents = events.list(erc.task.id).filter(event => event.data.server === "mao_electronics" && event.data.toolName === "electronics.kicad.erc");
  assert.deepEqual(ercEvents.map(event => event.type), ["tool.started", "tool.completed"]);
  const ercStored = api.store.getTask(erc.task.id);
  assert.equal(ercStored.steps[0].result.toolCalls[0].result.status, "PASS");
  assert.deepEqual(ercStored.events.filter(event => event.data?.server === "mao_electronics").map(event => event.type), ["tool.started", "tool.completed"]);
});

test("real Codex builds Arduino Uno through Electronics MCP when project-local packages are available", { skip: !codexPath || process.env.MAO_HYBRID_INCLUDE_PLATFORMIO_E2E !== "1", timeout: 360_000 }, async (t) => {
  const version = execFileSync(codexPath, ["--version"], { encoding: "utf8", timeout: 5_000 }).trim();
  t.diagnostic(`real Codex CLI: ${version}`);
  const workspace = repositoryRoot;
  await mkdir(join(workspace, ".mao-electronics"), { recursive: true });
  const projectDir = await mkdtemp(join(workspace, ".mao-electronics", "host-platformio-"));
  const fixtures = join(workspace, "packages/tools-electronics/test/fixtures");
  const employeeId = `host-e2e-${randomUUID()}`;
  const roster = createDefaultRoster();
  const engineer = roster.employees.find(employee => employee.professionId === "electronics-engineer");
  assert.ok(engineer);
  engineer.id = employeeId;
  await cp(join(fixtures, "platformio.ini"), join(projectDir, "platformio.ini"));
  await cp(join(fixtures, "main.cpp"), join(projectDir, "main.cpp"));
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-real-platformio-"));
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable: codexPath, sandbox: "read-only", events });
  const api = await createApiServer({ config: { host: "127.0.0.1", port: 0, dataDirectory: join(scratch, "task-store"), maxConcurrent: 1 }, runtime, roster, events });
  const address = await api.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await api.close();
    await rm(projectDir, { recursive: true, force: true });
    await rm(join(workspace, ".mao", "employees", employeeId), { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  });
  const projectResponse = await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "platformio-project", name: "Isolated Arduino build", workspaceRoot: workspace }) });
  assert.equal(projectResponse.status, 201);
  const configPath = relative(workspace, join(projectDir, "platformio.ini"));
  const response = await fetch(`${origin}/api/tasks`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "real-platformio-host-build" },
    body: JSON.stringify({ projectId: "platformio-project", title: "Build embedded Arduino firmware with PlatformIO", brief: `Use MCP tool electronics.platformio.build on ${configPath} with environment uno. Do not use shell commands and do not upload or flash anything. Report the structured build result.`, acceptanceCriteria: ["A completed electronics.platformio.build toolCalls result reports PASS and exit code 0."], complexity: "simple" }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  t.diagnostic(`real PlatformIO task id: ${result.task.id}`);
  assert.equal(result.task.status, "completed", JSON.stringify(result.steps));
  const call = result.steps[0].result.toolCalls.find(item => item.server === "mao_electronics" && item.toolId === "electronics.platformio.build");
  assert.equal(call?.status, "completed", JSON.stringify(result.steps[0].result.toolCalls));
  assert.equal(call?.result.status, "PASS", JSON.stringify(call));
  assert.equal(call?.result.exitCode, 0);
  assert.ok(call?.result.stdout.includes("[SUCCESS]"));
  assert.ok(api.store.getTask(result.task.id).events.some(event => event.type === "tool.completed" && event.data?.toolName === "electronics.platformio.build"));
});
