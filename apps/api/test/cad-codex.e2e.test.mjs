import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiServer } from "@mao-hybrid/api";
import { createEventBus } from "@mao-hybrid/events";
import { createCodexRuntime } from "@mao-hybrid/runtime";

const codexPath = process.env.MAO_HYBRID_CODEX_CLI;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("real Codex creates and exports a controller CAD assembly through task-scoped MCP and Task Store", { skip: !codexPath, timeout: 360_000 }, async t => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-real-cad-"));
  const workspace = join(scratch, "cad-project");
  const fixture = join(repositoryRoot, "packages/tools-cad/test/fixtures/low-voltage-controller-assembly.json");
  await mkdir(join(workspace, "fixtures"), { recursive: true });
  await cp(fixture, join(workspace, "fixtures/controller.json"));
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable: codexPath, sandbox: "workspace-write", events });
  const api = await createApiServer({ config: { host: "127.0.0.1", port: 0, dataDirectory: join(scratch, "task-store"), maxConcurrent: 1 }, runtime, events });
  const address = await api.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await api.close();
    if (process.env.MAO_HYBRID_CAD_E2E_KEEP !== "1") await rm(scratch, { recursive: true, force: true });
    else t.diagnostic(`preserved CAD E2E workspace: ${scratch}`);
  });
  const projectResponse = await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "cad-controller-fixture", name: "Low-voltage controller assembly fixture", workspaceRoot: workspace }) });
  assert.equal(projectResponse.status, 201);
  const taskResponse = await fetch(`${origin}/api/tasks`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "real-cad-controller-assembly-exports" },
    body: JSON.stringify({
      projectId: "cad-controller-fixture",
      title: "Design a low-voltage controller CAD assembly and export its engineering files",
      brief: "Use the fixture fixtures/controller.json. Call cad.model.create with {spec:'fixtures/controller.json'}. Read the .FCStd path from its createdFiles, then call cad.model.validate, cad.assembly.inspect, cad.export.step, cad.export.stl, cad.export.glb, cad.drawing.generate, and cad.render.preview with {model:<that relative .FCStd path>}. Keep all reference dimensions marked as unverified assumptions. Do not use shell commands. Do not claim physical compatibility, fit, safety, or manufacturing suitability.",
      acceptanceCriteria: ["Successful structured cad.model.create, cad.model.validate, cad.assembly.inspect, cad.export.step, cad.export.stl, cad.export.glb, cad.drawing.generate, and cad.render.preview tool calls are saved; STEP/STL/GLB/SVG and PDF when the local converter exists are non-empty workspace files."],
      complexity: "simple",
    }),
  });
  assert.equal(taskResponse.status, 200);
  const taskResult = await taskResponse.json();
  t.diagnostic(`real Codex CLI task id: ${taskResult.task.id}`);
  assert.equal(taskResult.directorPlan.specialistRoleId, "cad-engineer");
  assert.equal(taskResult.task.status, "needs_review", JSON.stringify(taskResult.steps));
  const step = taskResult.steps[0];
  assert.equal(step.roleId, "cad-engineer");
  const expected = ["cad.model.create", "cad.model.validate", "cad.assembly.inspect", "cad.export.step", "cad.export.stl", "cad.export.glb", "cad.drawing.generate", "cad.render.preview"];
  const calls = step.result.toolCalls.filter(call => call.server === "mao_cad");
  t.diagnostic(`isolated CAD workspace: ${workspace}`);
  t.diagnostic(`MCP artifacts: ${JSON.stringify(calls.map(call => ({ toolId: call.toolId, status: call.result?.status, exitCode: call.result?.exitCode, createdFiles: call.result?.createdFiles })))}`);
  const reviewTools = new Set(["cad.model.validate", "cad.assembly.inspect"]);
  for (const id of expected) {
    const call = calls.find(item => item.toolId === id);
    assert.ok(call, `${id} missing: ${JSON.stringify(calls)}`);
    if (reviewTools.has(id)) assert.equal(call.result.status, "NEEDS_REVIEW", `${id}: ${JSON.stringify(call)}`);
    else assert.ok(call.status === "completed" && call.result.status === "PASS", `${id}: ${JSON.stringify(call)}`);
  }
  const created = calls.find(call => call.toolId === "cad.model.create");
  assert.ok(created.result.unconfirmedParameters.some(item => item.parameter.includes("controller-board dimensions")));
  const assumptionsCsv = created.result.createdFiles.find(path => path.endsWith("assumptions.csv"));
  assert.ok(assumptionsCsv);
  assert.match(await readFile(join(workspace, assumptionsCsv), "utf8"), /controller-board dimensions/);
  const artifactTools = new Set(["cad.export.step", "cad.export.stl", "cad.export.glb", "cad.drawing.generate", "cad.render.preview"]);
  for (const call of calls.filter(item => artifactTools.has(item.toolId))) {
    assert.ok(call.result.createdFiles.length > 0, `${call.toolId} did not create an artifact`);
    for (const path of call.result.createdFiles) assert.ok((await stat(join(workspace, path))).size > 0, `${path} is missing or empty`);
  }
  const geometryPath = created.result.createdFiles.find(path => path.endsWith("geometry.json"));
  const geometry = JSON.parse(await readFile(join(workspace, geometryPath), "utf8"));
  assert.equal(geometry.checks.stepReimport, true);
  assert.equal(geometry.checks.stlReimport, true);
  assert.equal(geometry.checks.noVolumeCollisions, true);
  assert.equal(geometry.checks.componentDimensionsStatus, "NEEDS_REVIEW");
  const drawing = calls.find(call => call.toolId === "cad.drawing.generate");
  assert.ok(drawing.result.createdFiles.some(path => path.endsWith(".svg")));
  assert.ok(drawing.result.createdFiles.some(path => path.endsWith(".pdf")));
  assert.equal(drawing.result.checkedParameters.find(item => item.parameter === "drawing.pdf.pages")?.value, 1);
  assert.equal(drawing.result.checkedParameters.find(item => item.parameter === "drawing.pdf.dimensionsPresent")?.value, true);
  const glb = calls.find(call => call.toolId === "cad.export.glb");
  assert.equal(glb.result.checkedParameters.find(item => item.parameter === "glb.structure.status")?.value, "PASS");
  assert.equal(glb.result.checkedParameters.find(item => item.parameter === "glb.geometry.status")?.value, "PASS");
  assert.equal(glb.result.checkedParameters.find(item => item.parameter === "glb.visual.status")?.value, "NOT_VERIFIED");
  assert.equal(glb.result.checkedParameters.find(item => item.parameter === "glb.independent.status")?.value, "BLOCKED");

  const toolEvents = api.events.list(taskResult.task.id).filter(event => event.data.server === "mao_cad" && expected.includes(event.data.toolName));
  for (const id of expected) {
    const observed = toolEvents.filter(event => event.data.toolName === id).map(event => event.type);
    assert.deepEqual(observed[0], "tool.started");
    assert.ok(["tool.completed", "tool.failed"].includes(observed[1]), `${id}: ${observed}`);
  }
  const stored = api.store.getTask(taskResult.task.id);
  for (const id of expected) assert.ok(stored.steps[0].result.toolCalls.some(call => call.server === "mao_cad" && call.toolId === id));
  assert.equal(stored.task.status, "needs_review");
});
