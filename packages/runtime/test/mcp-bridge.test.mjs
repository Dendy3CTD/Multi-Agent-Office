import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCodexRuntime } from "../dist/index.js";
import { createEventBus } from "@mao-hybrid/events";

test("Codex Runtime exposes only task tools and auto-approves the four local read-only MCP tools", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-mcp-runtime-"));
  const executable = join(scratch, "fake-codex");
  const argsFile = join(scratch, "args.json");
  await writeFile(executable, `#!/usr/bin/env node\nconst fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2))); process.stdout.write(JSON.stringify({type:'item.completed',item:{id:'message-1',type:'agent_message',text:'mcp configured'}})+'\\n');\n`);
  await chmod(executable, 0o755);
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const safeToolIds = ["coding.capabilities", "coding.git.status", "coding.git.diff", "coding.git.log"];
  const allowedToolIds = [...safeToolIds, "coding.check.run", "coding.git.commit", "coding.github.prepare-pr", "coding.web.start"];
  const serverOptions = { workspaceRoot: scratch, repositoryRoot: scratch, allowedToolIds, employeeCapabilities: ["coding"], allowExternalWrites: false, allowLocalGitWrites: true };
  const runtime = createCodexRuntime({ executable, sandbox: "workspace-write" });
  const result = await runtime.execute({
    executionId: "exec-1", idempotencyKey: "exec-1",
    task: { id: "task-1", projectId: "project-1", title: "code", brief: "code", status: "running", createdAt: "now" },
    step: { id: "work", title: "work", prompt: "Use coding tool", employeeId: "developer-1" },
    project: { id: "project-1", name: "fixture", workspaceRoot: scratch },
    employee: { id: "developer-1", professionId: "developer", displayName: "Developer", status: "active", skills: ["coding"], instructions: "", specialization: "", departmentId: "software" },
    workingDirectory: scratch, signal: new AbortController().signal,
    taskTools: {
      projectId: "project-1", taskId: "task-1", executionId: "exec-1", workspaceRoot: scratch,
      tools: [
        ...safeToolIds.map(id => ({ id, name: id, description: "read-only", inputSchema: { type: "object" }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })),
        ...["coding.check.run", "coding.git.commit", "coding.github.prepare-pr", "coding.web.start"].map(id => ({ id, name: id, description: "side effect or process", inputSchema: { type: "object" } })),
      ],
      async invoke() { throw new Error("the MCP subprocess owns tool invocation"); },
        mcpServers: [{ name: "mao_coding", command: process.execPath, args: ["/workspace/packages/tools-coding/dist/mcp-server.js", JSON.stringify(serverOptions)], allowedTools: allowedToolIds }],
    },
  });
  assert.equal(result.text, "mcp configured");
  const args = JSON.parse(await readFile(argsFile, "utf8"));
  assert.ok(args.includes("--config"), JSON.stringify(args));
  assert.ok(args.includes(`mcp_servers.mao_coding.command=${JSON.stringify(process.execPath)}`));
  assert.ok(args.includes(`mcp_servers.mao_coding.args=${JSON.stringify(["/workspace/packages/tools-coding/dist/mcp-server.js", JSON.stringify(serverOptions)])}`));
  assert.ok(args.some(value => value.startsWith("mcp_servers.mao_coding.enabled=")));
  assert.ok(args.includes("mcp_servers.mao_coding.required=true"));
  assert.ok(args.includes("mcp_servers.mao_coding.startup_timeout_sec=10"));
  assert.ok(args.includes(`mcp_servers.mao_coding.enabled_tools=${JSON.stringify(allowedToolIds)}`));
  assert.ok(args.includes('mcp_servers.mao_coding.default_tools_approval_mode="prompt"'));
  const approvalOverride = args[args.indexOf("--config", args.indexOf('mcp_servers.mao_coding.default_tools_approval_mode="prompt"')) + 1];
  assert.equal(approvalOverride, `mcp_servers.mao_coding.tools={${safeToolIds.map(id => `${JSON.stringify(id)}={approval_mode="approve"}`).join(",")}}`);
  for (const id of ["coding.capabilities", "coding.git.status", "coding.git.diff", "coding.git.log"]) {
    assert.ok(approvalOverride.includes(`${JSON.stringify(id)}={approval_mode="approve"}`), `only the read-only tool ${id} should receive approval_mode=approve`);
  }
  for (const id of ["coding.check.run", "coding.git.commit", "coding.github.prepare-pr", "coding.web.start"]) {
    assert.ok(!approvalOverride.includes(JSON.stringify(id)), `${id} must retain the default prompt policy`);
  }
});

test("Codex MCP tool JSONL items become named task events", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-mcp-events-"));
  const executable = join(scratch, "fake-codex");
  await writeFile(executable, "#!/usr/bin/env node\nconst out = value => process.stdout.write(JSON.stringify(value) + '\\n'); out({type:'item.started',item:{id:'call-1',type:'mcp_tool_call',server:'mao_coding',tool:'coding.check.run'}}); out({type:'item.completed',item:{id:'call-1',type:'mcp_tool_call',server:'mao_coding',tool:'coding.check.run',status:'completed',result:{content:[{type:'text',text:'passed'},],structured_content:{status:'passed'}}}}); out({type:'item.completed',item:{type:'agent_message',text:'checked'}});\n");
  await chmod(executable, 0o755);
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable, events });
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const result = await runtime.execute({
    executionId: "exec-2", idempotencyKey: "exec-2",
    task: { id: "task-2", projectId: "project-2", title: "code", brief: "code", status: "running", createdAt: "now" },
    step: { id: "work", title: "work", prompt: "Use coding tool", employeeId: "developer-2" },
    project: { id: "project-2", name: "fixture", workspaceRoot: scratch },
    employee: { id: "developer-2", professionId: "developer", displayName: "Developer", status: "active", skills: ["coding"], instructions: "", specialization: "", departmentId: "software" },
    workingDirectory: scratch, signal: new AbortController().signal,
  });
  assert.equal(result.status, "completed");
  const toolEvents = events.list("task-2").filter(event => event.type.startsWith("tool."));
  assert.deepEqual(toolEvents.map(event => event.type), ["tool.started", "tool.completed"]);
  assert.equal(toolEvents[0].data.server, "mao_coding");
  assert.equal(toolEvents[1].data.toolName, "coding.check.run");
  assert.deepEqual(result.toolCalls, [{ id: "call-1", server: "mao_coding", toolId: "coding.check.run", status: "completed", result: { status: "passed" } }]);
});

test("Codex Runtime refuses a model claim when the required MCP call was rejected", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-mcp-rejected-"));
  const executable = join(scratch, "fake-codex");
  await writeFile(executable, "#!/usr/bin/env node\nconst out = value => process.stdout.write(JSON.stringify(value) + '\\n'); out({type:'item.started',item:{id:'call-1',type:'mcp_tool_call',server:'mao_coding',tool:'coding.capabilities'}}); out({type:'item.completed',item:{id:'call-1',type:'mcp_tool_call',server:'mao_coding',tool:'coding.capabilities',status:'failed',error:{message:'MCP tool call requires approval, but approval policy is never'}}}); out({type:'item.completed',item:{type:'agent_message',text:'I called the tool successfully'}});\n");
  await chmod(executable, 0o755);
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable, events });
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const result = await runtime.execute({
    executionId: "exec-rejected", idempotencyKey: "exec-rejected",
    task: { id: "task-rejected", projectId: "project-1", title: "Read capabilities", brief: "Use coding capabilities", status: "running", createdAt: "now" },
    step: { id: "work", title: "work", prompt: "Use coding.capabilities", employeeId: "developer-1" },
    project: { id: "project-1", name: "fixture", workspaceRoot: scratch },
    employee: { id: "developer-1", professionId: "developer", displayName: "Developer", status: "active", skills: ["coding"], instructions: "", specialization: "", departmentId: "software" },
    workingDirectory: scratch, signal: new AbortController().signal,
    taskTools: { projectId: "project-1", taskId: "task-rejected", executionId: "exec-rejected", workspaceRoot: scratch, tools: [], mcpServers: [], requiredToolIds: ["coding.capabilities"], invoke: async () => undefined },
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.error, "mcp_tool_rejected:mao_coding/coding.capabilities");
  assert.equal(result.toolCalls[0].status, "rejected");
  assert.equal(result.text, "I called the tool successfully");
  assert.ok(events.list("task-rejected").some(event => event.type === "tool.rejected"));
});

test("Codex Runtime treats MCP result isError as failed even when the JSONL item says completed", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-mcp-error-result-"));
  const executable = join(scratch, "fake-codex");
  await writeFile(executable, "#!/usr/bin/env node\nconst out = value => process.stdout.write(JSON.stringify(value) + '\\n'); out({type:'item.started',item:{id:'call-error',type:'mcp_tool_call',server:'mao_coding',tool:'coding.check.run'}}); out({type:'item.completed',item:{id:'call-error',type:'mcp_tool_call',server:'mao_coding',tool:'coding.check.run',status:'completed',result:{content:[{type:'text',text:'workspace policy rejected the operation'}],isError:true}}}); out({type:'item.completed',item:{type:'agent_message',text:'The check passed'}});\n");
  await chmod(executable, 0o755);
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable, events });
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const result = await runtime.execute({
    executionId: "exec-error-result", idempotencyKey: "exec-error-result",
    task: { id: "task-error-result", projectId: "project-1", title: "Run a check", brief: "Run a check", status: "running", createdAt: "now" },
    step: { id: "work", title: "work", prompt: "Run a check", employeeId: "developer-1" },
    project: { id: "project-1", name: "fixture", workspaceRoot: scratch },
    employee: { id: "developer-1", professionId: "developer", displayName: "Developer", status: "active", skills: ["coding"], instructions: "", specialization: "", departmentId: "software" },
    workingDirectory: scratch, signal: new AbortController().signal,
    taskTools: { projectId: "project-1", taskId: "task-error-result", executionId: "exec-error-result", workspaceRoot: scratch, tools: [], mcpServers: [], requiredToolIds: ["coding.check.run"], invoke: async () => undefined },
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.error, "mcp_tool_failed:mao_coding/coding.check.run");
  assert.equal(result.toolCalls[0].status, "failed");
  assert.equal(result.toolCalls[0].error, "MCP tool returned isError=true");
  assert.equal(result.text, "The check passed");
  assert.ok(events.list("task-error-result").some(event => event.type === "tool.failed"));
});

test("Codex Runtime preserves a structured blocked MCP result and requires review", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-mcp-blocked-result-"));
  const executable = join(scratch, "fake-codex");
  await writeFile(executable, "#!/usr/bin/env node\nconst out = value => process.stdout.write(JSON.stringify(value) + '\\n'); out({type:'item.started',item:{id:'call-blocked',type:'mcp_tool_call',server:'mao_coding',tool:'coding.git.status'}}); out({type:'item.completed',item:{id:'call-blocked',type:'mcp_tool_call',server:'mao_coding',tool:'coding.git.status',status:'completed',result:{structured_content:{status:'blocked',reasonCode:'not_repository'},isError:false}}}); out({type:'item.completed',item:{type:'agent_message',text:'The workspace has no Git repository'}});\n");
  await chmod(executable, 0o755);
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable, events });
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const result = await runtime.execute({
    executionId: "exec-blocked-result", idempotencyKey: "exec-blocked-result",
    task: { id: "task-blocked-result", projectId: "project-1", title: "Read Git status", brief: "Read Git status", status: "running", createdAt: "now" },
    step: { id: "work", title: "work", prompt: "Call coding.git.status", employeeId: "developer-1" },
    project: { id: "project-1", name: "fixture", workspaceRoot: scratch },
    employee: { id: "developer-1", professionId: "developer", displayName: "Developer", status: "active", skills: ["coding"], instructions: "", specialization: "", departmentId: "software" },
    workingDirectory: scratch, signal: new AbortController().signal,
    taskTools: { projectId: "project-1", taskId: "task-blocked-result", executionId: "exec-blocked-result", workspaceRoot: scratch, tools: [], mcpServers: [], requiredToolIds: ["coding.git.status"], invoke: async () => undefined },
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.toolCalls[0].status, "completed");
  assert.deepEqual(result.toolCalls[0].result, { status: "blocked", reasonCode: "not_repository" });
  assert.ok(events.list("task-blocked-result").some(event => event.type === "tool.completed" && event.data.result.reasonCode === "not_repository"));
});

test("Codex Runtime marks a required MCP tool missing when output only claims it ran", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-mcp-claim-"));
  const executable = join(scratch, "fake-codex");
  await writeFile(executable, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'I ran coding.capabilities successfully'}})+'\\n');\n");
  await chmod(executable, 0o755);
  const runtime = createCodexRuntime({ executable });
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const result = await runtime.execute({
    executionId: "exec-claim", idempotencyKey: "exec-claim",
    task: { id: "task-claim", projectId: "project-1", title: "Read capabilities", brief: "Use coding capabilities", status: "running", createdAt: "now" },
    step: { id: "work", title: "work", prompt: "Use coding.capabilities", employeeId: "developer-1" },
    project: { id: "project-1", name: "fixture", workspaceRoot: scratch },
    employee: { id: "developer-1", professionId: "developer", displayName: "Developer", status: "active", skills: ["coding"], instructions: "", specialization: "", departmentId: "software" },
    workingDirectory: scratch, signal: new AbortController().signal,
    taskTools: { projectId: "project-1", taskId: "task-claim", executionId: "exec-claim", workspaceRoot: scratch, tools: [], mcpServers: [], requiredToolIds: ["coding.capabilities"], invoke: async () => undefined },
  });
  assert.equal(result.status, "needs_review");
  assert.equal(result.error, "required_mcp_tool_not_executed:coding.capabilities");
  assert.deepEqual(result.toolCalls, []);
});

test("Codex Runtime applies per-tool approvals only to the trusted Electronics allowlist", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-electronics-approval-"));
  const executable = join(scratch, "fake-codex");
  const argsFile = join(scratch, "args.json");
  await writeFile(executable, `#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(process.argv.slice(2)));process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'configured'}})+'\\n');\n`);
  await chmod(executable, 0o755);
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const workspace = scratch;
  const allowedToolIds = ["electronics.ngspice.run", "electronics.kicad.erc", "electronics.kicad.drc"];
  const approvedToolIds = ["electronics.ngspice.run", "electronics.kicad.erc"];
  const serverOptions = { workspaceRoot: workspace, allowedToolIds, employeeCapabilities: ["electronics", "ngspice", "kicad"], approvedToolIds };
  const tools = allowedToolIds.map(id => ({ id, name: id, description: id, inputSchema: { type: "object" }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }));
  const runtime = createCodexRuntime({ executable, sandbox: "workspace-write" });
  const result = await runtime.execute({
    executionId: "electronics-approval", idempotencyKey: "electronics-approval",
    task: { id: "task-electronics-approval", projectId: "project-electronics", title: "Run engineering checks", brief: "Run checks", status: "running", createdAt: "now" },
    step: { id: "work", title: "Work", prompt: "Use the task MCP tools", employeeId: "electronics-employee" },
    project: { id: "project-electronics", name: "Electronics", workspaceRoot: workspace },
    employee: { id: "electronics-employee", professionId: "electronics-engineer", displayName: "Electronics Engineer", status: "active", skills: ["electronics"], instructions: "", specialization: "", departmentId: "electronics" },
    workingDirectory: workspace, signal: new AbortController().signal,
    taskTools: { projectId: "project-electronics", taskId: "task-electronics-approval", executionId: "electronics-approval", workspaceRoot: workspace, tools, mcpServers: [{ name: "mao_electronics", command: process.execPath, args: [resolve(process.cwd(), "../../packages/tools-electronics/dist/mcp-server.js"), JSON.stringify(serverOptions)], allowedTools: allowedToolIds, approvedToolIds }], invoke: async () => undefined },
  });
  assert.equal(result.status, "completed");
  const args = JSON.parse(await readFile(argsFile, "utf8"));
  assert.ok(args.includes('mcp_servers.mao_electronics.default_tools_approval_mode="prompt"'));
  const approvalOverride = args.find(value => value.startsWith("mcp_servers.mao_electronics.tools="));
  assert.equal(approvalOverride, `mcp_servers.mao_electronics.tools={${approvedToolIds.map(id => `${JSON.stringify(id)}={approval_mode="approve"}`).join(",")}}`);
  assert.ok(!approvalOverride.includes(JSON.stringify("electronics.kicad.drc")), "unapproved artifact tools retain the prompt policy");
});

test("Codex Runtime rejects duplicate MCP names and an Electronics dispatcher bound to another workspace", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-electronics-binding-"));
  const executable = join(scratch, "fake-codex");
  await writeFile(executable, "#!/usr/bin/env node\nprocess.exit(0);\n");
  await chmod(executable, 0o755);
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const runtime = createCodexRuntime({ executable });
  const base = {
    executionId: "electronics-binding", idempotencyKey: "electronics-binding",
    task: { id: "task-electronics-binding", projectId: "project-electronics", title: "Run a check", brief: "Run a check", status: "running", createdAt: "now" },
    step: { id: "work", title: "Work", prompt: "Use the MCP tool", employeeId: "electronics-employee" },
    project: { id: "project-electronics", name: "Electronics", workspaceRoot: scratch },
    employee: { id: "electronics-employee", professionId: "electronics-engineer", displayName: "Electronics Engineer", status: "active", skills: ["electronics"], instructions: "", specialization: "", departmentId: "electronics" },
    workingDirectory: scratch, signal: new AbortController().signal,
  };
  const duplicate = await runtime.execute({ ...base, taskTools: { projectId: "project-electronics", taskId: base.task.id, executionId: base.executionId, workspaceRoot: scratch, tools: [], mcpServers: ["mao_one", "mao_one"].map(name => ({ name, command: process.execPath, args: [], allowedTools: [] })), invoke: async () => undefined } });
  assert.deepEqual({ status: duplicate.status, error: duplicate.error }, { status: "failed", error: "task_tool_name_conflict" });
  const allowedToolIds = ["electronics.ngspice.run"];
  const serverOptions = { workspaceRoot: join(scratch, "other-workspace"), allowedToolIds, employeeCapabilities: ["electronics"], approvedToolIds: ["electronics.ngspice.run"] };
  const invalidBinding = await runtime.execute({ ...base, taskTools: { projectId: "project-electronics", taskId: base.task.id, executionId: base.executionId, workspaceRoot: scratch, tools: [{ id: allowedToolIds[0], name: allowedToolIds[0], description: "simulation", inputSchema: { type: "object" } }], mcpServers: [{ name: "mao_electronics", command: process.execPath, args: [resolve(process.cwd(), "../../packages/tools-electronics/dist/mcp-server.js"), JSON.stringify(serverOptions)], allowedTools: allowedToolIds, approvedToolIds: serverOptions.approvedToolIds }], invoke: async () => undefined } });
  assert.deepEqual({ status: invalidBinding.status, error: invalidBinding.error }, { status: "failed", error: "task_electronics_server_binding_invalid" });
});

test("Codex Runtime accepts only the trusted task-scoped CAD server and preserves per-tool approval", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-mcp-cad-"));
  const executable = join(scratch, "fake-codex");
  const argsFile = join(scratch, "args.json");
  await writeFile(executable, `#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(process.argv.slice(2)));process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'CAD MCP configured'}})+'\\n');\n`);
  await chmod(executable, 0o755);
  const workspaceRoot = await mkdtemp(join(tmpdir(), "mao-hybrid-cad-workspace-"));
  const options = { projectId: "project-cad", taskId: "task-cad-runtime", executionId: "exec-cad-runtime", workspaceRoot, allowedToolIds: ["cad.model.create"], employeeCapabilities: ["cad", "3d"], approvedToolIds: ["cad.model.create"], employee: { id: "cad-1", professionId: "cad-engineer", skills: ["cad", "3d"] } };
  const server = { name: "mao_cad", command: process.execPath, args: ["/workspace/packages/tools-cad/dist/mcp-server.js", JSON.stringify(options)], allowedTools: options.allowedToolIds, approvedToolIds: options.approvedToolIds };
  const runtime = createCodexRuntime({ executable });
  t.after(async () => { await rm(scratch, { recursive: true, force: true }); await rm(workspaceRoot, { recursive: true, force: true }); });
  const result = await runtime.execute({
    executionId: options.executionId, idempotencyKey: options.executionId,
    task: { id: options.taskId, projectId: options.projectId, title: "CAD", brief: "CAD", status: "running", createdAt: "now" },
    step: { id: "work", title: "work", prompt: "Use CAD MCP", employeeId: "cad-1" },
    project: { id: options.projectId, name: "CAD fixture", workspaceRoot },
    employee: { id: "cad-1", professionId: "cad-engineer", displayName: "CAD Engineer", status: "active", skills: ["cad", "3d"], instructions: "", specialization: "", departmentId: "cad-3d" },
    workingDirectory: workspaceRoot, signal: new AbortController().signal,
    taskTools: { projectId: options.projectId, taskId: options.taskId, executionId: options.executionId, workspaceRoot, tools: [{ id: "cad.model.create", name: "CAD model", description: "create", inputSchema: { type: "object" }, capabilities: ["cad", "3d"] }], mcpServers: [server], requiredToolIds: [], invoke: async () => undefined },
  });
  assert.equal(result.status, "completed", result.error);
  const args = JSON.parse(await readFile(argsFile, "utf8"));
  assert.ok(args.includes('mcp_servers.mao_cad.default_tools_approval_mode="prompt"'));
  assert.ok(args.some(value => value.includes('mcp_servers.mao_cad.tools={"cad.model.create"={approval_mode="approve"}}')));
});
