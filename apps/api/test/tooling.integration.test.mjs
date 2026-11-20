import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "@mao-hybrid/api";
import { createDefaultRoster } from "@mao-hybrid/company";
import { createEventBus } from "@mao-hybrid/events";

function callMcp(server, calls) {
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ...calls.map((params, index) => ({ jsonrpc: "2.0", id: index + 3, method: "tools/call", params })),
  ];
  const output = execFileSync(server.command, server.args, { encoding: "utf8", input: messages.map(message => JSON.stringify(message)).join("\n") + "\n", timeout: 5_000 });
  return output.trim().split("\n").map(line => JSON.parse(line));
}

test("complex Python handoff requires a real Developer check and an independent QA verdict", async t => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-python-handoff-"));
  const workspace = join(scratch, "project");
  await mkdir(workspace);
  const events = createEventBus();
  const dispatches = [];
  const api = await createApiServer({
    config: { port: 0, dataDirectory: join(scratch, "data") },
    events,
    runtime: {
      available: () => true,
      async execute(input) {
        const { step, task, taskTools } = input;
        dispatches.push(step.id);
        const coding = taskTools.mcpServers.find(server => server.name === "mao_coding");
        if (step.id === "analyze") {
          assert.deepEqual(taskTools.requiredToolIds, []);
          return { status: "completed", text: "Analyst contract: engineering.load(force, area) returns force / area. Tool reference: coding.review.diff." };
        }
        if (step.id === "specialist-work") {
          assert.match(step.prompt, /Analyst contract: engineering\.load/);
          const requiresReview = task.title === "Python delivery with explicit MCP review";
          assert.deepEqual(taskTools.requiredToolIds, requiresReview ? ["coding.review.diff", "coding.check.run"] : ["coding.check.run"]);
          assert.equal(coding.allowedTools.includes("coding.review.diff"), requiresReview);
          const launch = JSON.parse(coding.args[1]);
          assert.equal(Boolean(launch.reviewSocketPath), requiresReview);
          await writeFile(join(workspace, "engineering.py"), "def load(force, area):\n    return force / area\n");
          await writeFile(join(workspace, "test_engineering.py"), "import unittest\nfrom engineering import load\n\nclass LoadTest(unittest.TestCase):\n    def test_load(self):\n        self.assertEqual(load(12, 3), 4)\n");
          const calls = [{ name: "coding.check.run", arguments: { check: "python-test" } }];
          if (requiresReview) calls.push({ name: "coding.review.diff", arguments: {} });
          if (task.title !== "Python delivery without check evidence") {
            const exchange = callMcp(coding, calls);
            for (const [index, call] of calls.entries()) {
              const result = exchange.find(message => message.id === index + 3).result.structuredContent;
              assert.equal(result.status, index === 0 ? "passed" : "blocked");
              events.publish({ taskId: task.id, executionId: input.executionId, type: "tool.completed", data: {
                tool: "mcp_tool_call", itemId: `developer-${index}`, server: "mao_coding", toolName: call.name, result,
              } });
            }
          }
          return { status: "completed", text: "Developer delivered engineering.py and test_engineering.py. No coding.review.diff was used for ordinary QA." };
        }
        assert.equal(step.id, "review", "QA is a separate planned execution");
        assert.equal(input.employee.professionId, "qa-engineer");
        assert.equal(input.readOnly, true);
        assert.deepEqual(taskTools.requiredToolIds, []);
        assert.ok(!coding?.allowedTools.includes("coding.review.diff"));
        assert.ok(!coding?.allowedTools.includes("coding.check.run"));
        assert.match(step.prompt, /Analyst contract: engineering\.load/);
        assert.match(step.prompt, /Developer delivered engineering\.py/);
        assert.match(step.prompt, /developer-0/);
        assert.match(step.prompt, /Ran 1 test/);
        if (task.title === "Python delivery with unconfirmed QA") {
          return { status: "completed", text: "All tests passed, as Developer reported." };
        }
        const source = await readFile(join(input.workingDirectory, "engineering.py"), "utf8");
        const tests = await readFile(join(input.workingDirectory, "test_engineering.py"), "utf8");
        assert.match(source, /return force \/ area/);
        assert.match(tests, /assertEqual\(load\(12, 3\), 4\)/);
        const findings = task.title === "Python delivery with QA findings" ? ["Zero area is not covered by the tests."] : [];
        return { status: "completed", text: JSON.stringify({
          status: findings.length ? "needs_review" : "approved",
          summary: "Inspected the implementation and tests. Examined Developer's unittest result.",
          inspectedFiles: ["engineering.py", "test_engineering.py"],
          findings,
        }) };
      },
    },
  });
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  api.company.registerProject({ id: "python-handoff", name: "Python handoff", workspaceRoot: workspace });
  const submit = (title, extraCriterion = []) => api.company.submitAndRun({
    projectId: "python-handoff", title, complexity: "complex",
    brief: "Analyze the load calculation contract, implement a Python module, add tests, and have QA inspect the result.",
    acceptanceCriteria: ["Run the Python tests and retain the test output.", ...extraCriterion],
  });

  const approved = await submit("Python delivery with independent QA");
  assert.deepEqual(dispatches.splice(0), ["analyze", "specialist-work", "review"]);
  assert.deepEqual(approved.steps.map(step => step.roleId), ["analyst", "developer", "qa-engineer"]);
  assert.deepEqual(approved.steps.map(step => step.status), ["completed", "completed", "completed"]);
  assert.equal(approved.task.status, "completed");
  const saved = api.store.getTask(approved.task.id);
  assert.deepEqual(saved.steps[1].result.toolCalls.map(call => [call.id, call.toolId, call.result.status]), [["developer-0", "coding.check.run", "passed"]]);

  const missing = await submit("Python delivery without check evidence", ["Do not use coding.review.diff for this task."]);
  assert.deepEqual(dispatches.splice(0), ["analyze", "specialist-work"]);
  assert.equal(missing.steps[1].error, "required_mcp_tool_not_executed:coding.check.run");
  assert.equal(missing.steps[2].status, "queued");

  const flagged = await submit("Python delivery with QA findings");
  assert.deepEqual(dispatches.splice(0), ["analyze", "specialist-work", "review"]);
  assert.equal(flagged.task.status, "needs_review");
  assert.match(flagged.steps[2].result.text, /Zero area is not covered/);

  const unconfirmed = await submit("Python delivery with unconfirmed QA");
  assert.deepEqual(dispatches.splice(0), ["analyze", "specialist-work", "review"]);
  assert.equal(unconfirmed.task.status, "needs_review");
  assert.equal(unconfirmed.steps[2].error, "qa_verdict_unconfirmed");

  await t.test("an explicitly requested MCP review returning blocked prevents completion", async () => {
    const blocked = await submit("Python delivery with explicit MCP review", ["Call coding.review.diff and retain its structured result."]);
    assert.deepEqual(dispatches.splice(0), ["analyze", "specialist-work"]);
    assert.equal(blocked.task.status, "needs_review");
    assert.deepEqual(blocked.steps.map(step => step.status), ["completed", "needs_review", "queued"]);
    assert.equal(blocked.steps[1].error, "mcp_tool_blocked:mao_coding/coding.review.diff");
    assert.equal(blocked.steps[1].result.toolCalls.find(call => call.toolId === "coding.review.diff").result.status, "blocked");
  });
});

test("API gives only the selected developer task a workspace-bound Coding Tools MCP dispatcher", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-coding-api-"));
  const workspace = join(scratch, "project-a");
  const workspaceB = join(scratch, "project-b");
  const workspaceC = join(scratch, "project-c-no-git");
  await mkdir(workspace);
  await mkdir(workspaceB);
  await mkdir(workspaceC);
  execFileSync("git", ["-C", workspace, "init", "--quiet"]);
  execFileSync("git", ["-C", workspaceB, "init", "--quiet"]);
  await writeFile(join(workspace, "sum.js"), "export const sum = (a, b) => a + b;\n");
  await writeFile(join(workspace, "sum.test.js"), "import test from 'node:test'; import assert from 'node:assert/strict'; import { sum } from './sum.js'; test('sum', () => assert.equal(sum(2, 3), 5));\n");
  const receivedInputs = [];
  const events = createEventBus();
  const runtime = {
    available: () => true,
    async execute(input) {
      receivedInputs.push(input);
      const binding = input.taskTools;
      assert.ok(binding, "Codex Runtime must receive task-scoped tools");
      if (input.step.id === "analyze") {
        assert.equal(binding.tools.length, 0, "the Analyst must not receive developer Coding Tools");
        assert.match(input.step.prompt, /no Coding Tools are available.*hand off/i);
        return { status: "completed", text: "Analysis complete; hand off the requested Git inspection to the developer.", executionState: "terminated" };
      }
      const mcpServer = binding.mcpServers[0];
      assert.ok(mcpServer, "Codex Runtime must receive a per-execution MCP server");
      if (input.project.id === "project-c") {
        const statusCall = callMcp(mcpServer, [{ name: "coding.git.status", arguments: {} }]).find(message => message.id === 3);
        assert.equal(statusCall.result.isError, false);
        const result = statusCall.result.structuredContent;
        assert.deepEqual({ status: result.status, reasonCode: result.reasonCode }, { status: "blocked", reasonCode: "not_repository" });
        const toolCall = { id: "not-repository", server: "mao_coding", toolId: "coding.git.status", status: "completed", result };
        events.publish({ taskId: input.task.id, executionId: input.executionId, type: "tool.completed", data: { tool: "mcp_tool_call", server: "mao_coding", toolName: "coding.git.status", status: "completed", result } });
        return { status: "completed", text: "The workspace is not a Git repository.", executionState: "terminated", toolCalls: [toolCall] };
      }
      if (input.task.title === "Read Git status using Coding Tools") {
        assert.deepEqual(binding.requiredToolIds, ["coding.git.status"], "a negative shell-command instruction must not require the check runner");
        const status = callMcp(mcpServer, [{ name: "coding.git.status", arguments: {} }]).find(message => message.id === 3).result.structuredContent;
        return { status: "completed", text: "Git status read", executionState: "terminated", toolCalls: [{ id: "status-accepted", server: "mao_coding", toolId: "coding.git.status", status: "completed", result: status }] };
      }
      if (input.project.id === "project-b") {
        assert.equal(binding.workspaceRoot, workspaceB);
        const attemptedCrossProjectAccess = callMcp(mcpServer, [{ name: "coding.check.run", arguments: { check: "javascript-test", paths: ["../project-a/sum.test.js"] } }]).find(message => message.id === 3);
        assert.equal(attemptedCrossProjectAccess.result.isError, true);
        return { status: "completed", text: "The test passed", result: { denied: true }, executionState: "terminated", toolCalls: [{ id: "blocked-1", server: "mao_coding", toolId: "coding.check.run", status: "failed", error: "coding path is outside the selected workspace" }] };
      }
      assert.equal(binding.projectId, "project-a");
      assert.equal(binding.workspaceRoot, workspace);
      assert.ok(binding.tools.some(tool => tool.id === "coding.check.run"));
      assert.ok(!binding.tools.some(tool => tool.id === "coding.github.push"));
      if (binding.requiredToolIds?.includes("coding.git.status")) {
        const statusCall = callMcp(mcpServer, [{ name: "coding.git.status", arguments: {} }]).find(message => message.id === 3);
        const result = statusCall.result.structuredContent;
        events.publish({ taskId: input.task.id, executionId: input.executionId, type: "tool.completed", data: { server: "mao_coding", toolName: "coding.git.status", status: "completed", result } });
        return { status: "completed", text: "Git status was read.", result, executionState: "terminated", toolCalls: [{ id: "status-1", server: "mao_coding", toolId: "coding.git.status", status: "completed", result }] };
      }
      const exchange = callMcp(mcpServer, [
        { name: "coding.check.run", arguments: { check: "javascript-test", paths: ["sum.test.js"] } },
        { name: "coding.github.push", arguments: { branch: "main", confirmation: "PUSH main" } },
      ]);
      const result = exchange.find(message => message.id === 3).result.structuredContent;
      assert.equal(result.status, "passed", JSON.stringify(result));
      assert.equal(exchange.find(message => message.id === 4).error.code, -32602);
      events.publish({ taskId: input.task.id, executionId: input.executionId, type: "tool.completed", data: { toolId: "coding.check.run", status: result.status } });
      return { status: "completed", text: "Coding check passed", result: { tool: result, workspace }, executionState: "terminated", toolCalls: [{ id: "call-1", server: "mao_coding", toolId: "coding.check.run", status: "completed", result }] };
    },
    async inspect() { return { status: "unknown", executionState: "unknown" }; },
  };
  const api = await createApiServer({ config: { host: "127.0.0.1", port: 0, dataDirectory: join(scratch, "data") }, runtime, events });
  const address = await api.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });

  await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "project-a", name: "Project A", workspaceRoot: workspace }) });
  await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "project-b", name: "Project B", workspaceRoot: workspaceB }) });
  await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "project-c", name: "Project C, no Git", workspaceRoot: workspaceC }) });
  const catalog = await fetch(`${origin}/api/tools`).then(response => response.json());
  assert.ok(catalog.tools.find(tool => tool.id === "coding.check.run").capabilities.includes("coding"));
  const response = await fetch(`${origin}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "coding-tools-e2e-1" },
    body: JSON.stringify({ projectId: "project-a", title: "Create a JavaScript sum program", brief: "Implement the JavaScript function sum(a,b).", acceptanceCriteria: ["Run JavaScript tests with the Coding Tool"], complexity: "simple" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  t.diagnostic(`coding task id: ${body.task.id}`);
  assert.equal(body.task.status, "completed", JSON.stringify({ task: body.task, steps: body.steps, events: api.events.list(body.task.id) }));
  assert.equal(receivedInputs[0].employee.professionId, "developer");
  assert.equal(receivedInputs[0].workingDirectory, workspace);
  assert.deepEqual(receivedInputs[0].taskTools.requiredToolIds, ["coding.check.run"]);
  assert.equal(body.steps[0].result.result.tool.status, "passed");
  assert.ok(api.events.list(body.task.id).some(event => event.type === "tool.completed"));
  const stored = api.store.getTask(body.task.id);
  assert.equal(stored.steps[0].status, "completed");
  assert.equal(stored.steps[0].result.result.tool.status, "passed");

  const readStatusResponse = await fetch(`${origin}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "coding-tools-read-status" },
    body: JSON.stringify({ projectId: "project-a", title: "Read Git status using Coding Tools", brief: "Call coding.git.status and report its actual result. Do not run a shell Git command or modify files.", acceptanceCriteria: ["A successful coding.git.status MCP result is recorded."], complexity: "simple" }),
  });
  assert.equal(readStatusResponse.status, 200);
  const readStatusTask = await readStatusResponse.json();
  assert.equal(readStatusTask.task.status, "completed", JSON.stringify(readStatusTask.steps));

  const noGitResponse = await fetch(`${origin}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "coding-tools-no-git" },
    body: JSON.stringify({ projectId: "project-c", title: "Check Git status in plain workspace", brief: "Call coding.git.status and report its actual result. Do not run a shell Git command or modify files.", acceptanceCriteria: ["A coding.git.status MCP result is recorded."], complexity: "simple" }),
  });
  assert.equal(noGitResponse.status, 200);
  const noGitTask = await noGitResponse.json();
  assert.equal(noGitTask.task.status, "needs_review");
  assert.equal(noGitTask.steps[0].error, "mcp_tool_blocked:mao_coding/coding.git.status:not_repository");
  assert.equal(noGitTask.steps[0].result.toolCalls[0].status, "completed");
  assert.equal(noGitTask.steps[0].result.toolCalls[0].result.reasonCode, "not_repository");
  const noGitStored = api.store.getTask(noGitTask.task.id);
  assert.equal(noGitStored.steps[0].result.toolCalls[0].result.reasonCode, "not_repository");
  assert.equal(noGitStored.attempts[0].result.toolCalls[0].result.reasonCode, "not_repository");
  assert.ok(noGitStored.events.some(event => event.type === "step_needs_review" && event.result.toolCalls[0].result.reasonCode === "not_repository"));
  assert.ok(api.events.list(noGitTask.task.id).some(event => event.type === "tool.completed" && event.data.result.reasonCode === "not_repository"));

  const crossProjectResponse = await fetch(`${origin}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "coding-tools-e2e-project-b" },
    body: JSON.stringify({ projectId: "project-b", title: "Create a JavaScript sum program", brief: "Implement the JavaScript function sum(a,b).", acceptanceCriteria: ["Run JavaScript tests with the Coding Tool"], complexity: "simple" }),
  });
  assert.equal(crossProjectResponse.status, 200);
  const projectBTask = await crossProjectResponse.json();
  assert.equal(projectBTask.task.status, "needs_review", "workspace rejection must not become a PASS from model text");
  assert.match(projectBTask.steps[0].error, /mcp_tool_failed|tool_execution_not_accepted/);

  const analystResponse = await fetch(`${origin}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "coding-tools-analyst-handoff" },
    body: JSON.stringify({
      projectId: "project-a",
      title: "Analyze requested Git status",
      brief: "Use the Coding Tool to read Git status, then report the current branch and changes. This request is intentionally standard complexity so Director creates analysis followed by a developer specialist step.",
      complexity: "standard",
    }),
  });
  assert.equal(analystResponse.status, 200);
  const analystTask = await analystResponse.json();
  assert.equal(analystTask.directorPlan.specialistRoleId, "developer", "Coding Tool requests route to a specialist that owns Coding capabilities");
  assert.equal(analystTask.steps[0].status, "completed", JSON.stringify(analystTask.steps[0]));
  assert.equal(analystTask.steps[1].status, "completed", JSON.stringify(analystTask.steps[1]));
  assert.ok(receivedInputs.some(input => input.step.id === "analyze" && input.taskTools.tools.length === 0));
  assert.ok(receivedInputs.some(input => input.step.id === "specialist-work" && input.taskTools.tools.some(tool => tool.id === "coding.git.status")));
});

test('API forwards declared code capability so the Developer receives required Coding MCP tools', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'mao-hybrid-role-code-capability-'));
  const workspace = join(scratch, 'project');
  await mkdir(workspace);
  const roster = createDefaultRoster();
  const developer = roster.employees.find(employee => employee.professionId === 'developer');
  assert.ok(developer);
  const developerRole = roster.professions.find(item => item.id === 'developer');
  assert.ok(developerRole?.capabilityRequirements.includes('code'));
  const received = [];
  const events = createEventBus();
  const api = await createApiServer({
    config: { host: '127.0.0.1', port: 0, dataDirectory: join(scratch, 'data') },
    roster,
    events,
    runtime: {
      available: () => true,
      async execute(input) {
        received.push(input);
        assert.ok(input.taskTools.tools.some(tool => tool.id === 'coding.check.run'));
        assert.ok(input.taskTools.requiredToolIds.includes('coding.check.run'));
        assert.ok(input.taskTools.mcpServers.find(server => server.name === 'mao_coding')?.allowedTools.includes('coding.check.run'));
        return { status: 'needs_review', error: 'test_verified_tool_composition_without_execution', executionState: 'terminated' };
      },
    },
  });
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  api.company.registerProject({ id: 'role-code-capability', name: 'Role code capability', workspaceRoot: workspace });
  const created = api.store.createTaskPlan({
    request: { projectId: 'role-code-capability', title: 'Implement backend feature', brief: 'Implement the API change and run tests.', complexity: 'standard', acceptanceCriteria: ['Run tests and report their result.'] },
    steps: [{ id: 'specialist-work', title: 'Specialist work', prompt: 'Implement the requested code. Acceptance criteria: Run tests and report their result.', roleId: 'developer', employeeId: developer.id, dependsOn: [] }],
  });
  await api.company.runAvailable();
  const stored = api.store.getTask(created.task.id);
  assert.equal(received.length, 1, 'the task reaches Runtime instead of being rejected as unavailable before dispatch');
  assert.equal(received[0].employee.id, developer.id);
  assert.equal(received[0].employee.professionId, 'developer');
  assert.equal(received[0].employee.role.id, 'developer');
  assert.ok(received[0].employee.role.capabilityRequirements.includes('code'));
  assert.equal(stored.steps[0].status, 'needs_review', 'tool registration alone must not mark the task completed');
  assert.match(stored.steps[0].error, /test_verified_tool_composition_without_execution/);
});

test("API composes electronics MCP only for the selected electronics engineer and requires its real result", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-electronics-api-"));
  const workspace = join(scratch, "project");
  await mkdir(workspace);
  await writeFile(join(workspace, "divider.cir"), ".title divider\nV1 in 0 DC 10\nR1 in out 10k\nR2 out 0 10k\n.op\n.end\n");
  const receivedInputs = [];
  const events = createEventBus();
  const runtime = {
    available: () => true,
    async execute(input) {
      receivedInputs.push(input);
      if (input.step.id === "analyze") {
        assert.deepEqual(input.taskTools.tools, [], "non-engineering Analyst must not receive specialized MCP tools");
        assert.deepEqual(input.taskTools.mcpServers, []);
        return { status: "completed", text: "Hand off to the electronics engineer.", executionState: "terminated" };
      }
      assert.equal(input.employee.professionId, "electronics-engineer");
      assert.ok(input.taskTools.tools.some(tool => tool.id === "electronics.ngspice.run"));
      assert.deepEqual(input.taskTools.mcpServers.map(server => server.name), ["mao_electronics", "mao_research"]);
      assert.deepEqual(input.taskTools.requiredToolIds, ["electronics.ngspice.run"]);
      assert.equal(input.taskTools.tools.some(tool => tool.id.startsWith("coding.")), false);
      const server = input.taskTools.mcpServers.find(server => server.name === "mao_electronics");
      const messages = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "electronics.ngspice.run", arguments: { netlist: "divider.cir", analysis: "dc" } } },
      ];
      const output = execFileSync(server.command, server.args, { encoding: "utf8", input: messages.map(message => JSON.stringify(message)).join("\n") + "\n", timeout: 5_000 });
      const result = JSON.parse(output.trim().split("\n")[1]).result.structuredContent;
      assert.equal(result.status, "PASS");
      assert.ok(result.stdout.includes("5.000000e+00"), JSON.stringify(result));
      events.publish({ taskId: input.task.id, executionId: input.executionId, type: "tool.started", data: { tool: "mcp_tool_call", itemId: "ngspice-1", server: "mao_electronics", toolName: "electronics.ngspice.run" } });
      events.publish({ taskId: input.task.id, executionId: input.executionId, type: "tool.completed", data: { tool: "mcp_tool_call", itemId: "ngspice-1", server: "mao_electronics", toolName: "electronics.ngspice.run", status: "completed", result } });
      return { status: "completed", text: "Divider output is 5 V.", executionState: "terminated", toolCalls: [{ id: "ngspice-1", server: "mao_electronics", toolId: "electronics.ngspice.run", status: "completed", result }] };
    },
    async inspect() { return { status: "unknown", executionState: "unknown" }; },
  };
  const api = await createApiServer({ config: { host: "127.0.0.1", port: 0, dataDirectory: join(scratch, "data"), maxConcurrent: 1 }, runtime, events });
  const address = await api.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  const projectResponse = await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "divider", name: "Voltage Divider", workspaceRoot: workspace }) });
  assert.equal(projectResponse.status, 201);
  const response = await fetch(`${origin}/api/tasks`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "electronics-divider-mock-integration" },
    body: JSON.stringify({ projectId: "divider", title: "Analyze voltage divider with ngspice", brief: "Call electronics.ngspice.run for divider.cir using DC operating point analysis and report measured v(out).", acceptanceCriteria: ["A successful electronics.ngspice.run result reports v(out) approximately 5 V."], complexity: "standard" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.task.status, "completed", JSON.stringify({ task: body.task, steps: body.steps, events: api.events.list(body.task.id) }));
  assert.equal(receivedInputs[0].employee.professionId, "analyst");
  assert.equal(receivedInputs[1].employee.professionId, "electronics-engineer");
  assert.equal(body.steps[1].result.toolCalls[0].result.status, "PASS");
  assert.ok(api.events.list(body.task.id).some(event => event.type === "tool.started" && event.data.server === "mao_electronics"));
  assert.ok(api.events.list(body.task.id).some(event => event.type === "tool.completed" && event.data.server === "mao_electronics" && event.data.result.stdout.includes("5.000000e+00")));
  const stored = api.store.getTask(body.task.id);
  assert.equal(stored.steps[1].result.toolCalls[0].result.status, "PASS");
  assert.ok(stored.events.some(event => event.type === "tool.started" && event.data.server === "mao_electronics"));
  assert.ok(stored.events.some(event => event.type === "tool.completed" && event.data.server === "mao_electronics" && event.data.result.stdout.includes("5.000000e+00")));
});

test("API composes Coding and Electronics MCP together for an employee with both capabilities", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-combined-tools-api-"));
  const workspace = join(scratch, "project");
  await mkdir(workspace);
  const roster = createDefaultRoster();
  const engineer = roster.employees.find(employee => employee.professionId === "electronics-engineer");
  assert.ok(engineer);
  engineer.skills.push("coding");
  const events = createEventBus();
  const runtime = {
    available: () => true,
    async execute(input) {
      if (input.step.id === "analyze") return { status: "completed", text: "Hand off to the electronics engineer.", executionState: "terminated" };
      assert.deepEqual(input.taskTools.mcpServers.map(server => server.name), ["mao_coding", "mao_electronics", "mao_research"]);
      const ids = input.taskTools.tools.map(tool => tool.id);
      assert.ok(ids.includes("coding.git.status"));
      assert.ok(ids.includes("electronics.ngspice.run"));
      assert.equal(new Set(ids).size, ids.length);
      assert.equal(new Set(input.taskTools.mcpServers.map(server => server.name)).size, input.taskTools.mcpServers.length);
      return { status: "needs_review", error: "composition_only_test_did_not_execute_tools", executionState: "terminated" };
    },
    async inspect() { return { status: "unknown", executionState: "unknown" }; },
  };
  const api = await createApiServer({ config: { host: "127.0.0.1", port: 0, dataDirectory: join(scratch, "data"), maxConcurrent: 1 }, runtime, roster, events });
  const address = await api.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "combined", name: "Combined tools", workspaceRoot: workspace }) });
  const response = await fetch(`${origin}/api/tasks`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "combined-electronics-coding-capabilities" },
    body: JSON.stringify({ projectId: "combined", title: "Analyze an electronics voltage divider with ngspice", brief: "Inspect the divider netlist with the electronics engineer.", complexity: "standard" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.task.status, "needs_review", "composition alone must not be recorded as completed engineering work");
  assert.equal(body.steps[1].roleId, "electronics-engineer");
  assert.ok(api.events.list(body.task.id).some(event => event.type === "tools.available" && event.data.serverNames.join(",") === "mao_coding,mao_electronics,mao_research"));
});

test("API composes the task-scoped CAD MCP only for the selected CAD engineer", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-cad-api-"));
  const workspace = join(scratch, "project");
  await mkdir(workspace);
  const events = createEventBus();
  const observed = [];
  const runtime = {
    available: () => true,
    async execute(input) {
      observed.push(input);
      assert.equal(input.employee.professionId, "cad-engineer");
      assert.ok(input.taskTools.tools.some(tool => tool.id === "cad.model.create"));
      assert.deepEqual(input.taskTools.mcpServers.map(server => server.name), ["mao_cad"]);
      assert.equal(input.taskTools.tools.some(tool => tool.id.startsWith("electronics.")), false);
      assert.equal(input.taskTools.tools.some(tool => tool.id.startsWith("coding.")), false);
      assert.ok(input.taskTools.requiredToolIds.includes("cad.model.create"));
      return { status: "needs_review", error: "composition_test_did_not_execute_CAD", executionState: "terminated" };
    },
    async inspect() { return { status: "unknown", executionState: "unknown" }; },
  };
  const api = await createApiServer({ config: { host: "127.0.0.1", port: 0, dataDirectory: join(scratch, "data"), maxConcurrent: 1 }, runtime, events });
  const address = await api.listen(); const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });
  await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "cad-project", name: "CAD project", workspaceRoot: workspace }) });
  const response = await fetch(`${origin}/api/tasks`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "api-cad-tool-routing" },
    body: JSON.stringify({ projectId: "cad-project", title: "Design a CAD enclosure for ESP32-C3 SuperMini", brief: "Call cad.model.create using the documented fixture, then report its real geometry outputs.", complexity: "simple" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.directorPlan.specialistRoleId, "cad-engineer");
  assert.equal(body.task.status, "needs_review", "composition without real CAD execution must not be marked complete");
  assert.equal(observed.length, 1);
});
