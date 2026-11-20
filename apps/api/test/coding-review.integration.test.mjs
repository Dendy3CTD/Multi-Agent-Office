import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "@mao-hybrid/api";
import { createEventBus } from "@mao-hybrid/events";
import { createCodexRuntime } from "@mao-hybrid/runtime";

test("API Coding MCP review re-enters the same Codex Runtime read-only and persists only confirmed structured review", async t => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-coding-review-api-"));
  const workspace = join(scratch, "deep-workspace-".repeat(8), "project");
  const dataDirectory = join(scratch, "data");
  const reportFile = join(scratch, "review-report.json");
  const invocationLog = join(scratch, "codex-invocations.jsonl");
  await mkdir(workspace, { recursive: true });
  assert.ok(Buffer.byteLength(join(workspace, ".mao-review-abcdef", "review.sock")) > 107);
  execFileSync("git", ["-C", workspace, "init", "--quiet"]);
  await writeFile(join(workspace, "src.py"), "def answer():\n    return 42\n");
  const fakeCodex = join(scratch, "codex-fixture");
  await writeFile(fakeCodex, String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
const sandbox = args[args.indexOf('--sandbox') + 1];
const cwd = args[args.indexOf('--cd') + 1];
const hasMcp = args.some(value => /^mcp_servers\..+\.command=/.test(value));
const prompt = args[args.length - 1] || '';
const codingMcpDisabled = args.includes('mcp_servers.mao_coding.enabled=false');
fs.appendFileSync(process.env.MAO_REVIEW_INVOCATIONS, JSON.stringify({sandbox, cwd, hasMcp, codingMcpDisabled, promptHasDiff:prompt.includes('def answer'), promptHasHostMemory:prompt.includes('.mao/employees/'), promptHasRequirement:prompt.includes('Preserve answer() behavior')}) + '\n');
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
if (sandbox === 'read-only') {
  const report = fs.readFileSync(process.env.MAO_REVIEW_REPORT, 'utf8');
  if (report === 'fixture-runtime-failure') process.exit(34);
  out({type:'item.completed',item:{type:'agent_message',text:report}});
} else {
  const config = {};
  for (let index = 0; index < args.length; index++) if (args[index] === '--config') {
    const entry = args[++index]; const separator = entry.indexOf('=');
    if (separator > 0) { try { config[entry.slice(0, separator)] = JSON.parse(entry.slice(separator + 1)); } catch {} }
  }
  const command = config['mcp_servers.mao_coding.command'];
  const serverArgs = config['mcp_servers.mao_coding.args'];
  if (!command || !Array.isArray(serverArgs)) process.exit(31);
  const launch = JSON.parse(serverArgs[1]);
  const socketReady = typeof launch.reviewSocketPath === 'string' && fs.existsSync(launch.reviewSocketPath) && fs.lstatSync(launch.reviewSocketPath).isSocket();
  fs.appendFileSync(process.env.MAO_REVIEW_INVOCATIONS, JSON.stringify({bridge: true, socketReady, shortPath: Buffer.byteLength(launch.reviewSocketPath || '') <= 107, validToken: /^[a-f0-9]{64}$/.test(launch.reviewSocketToken || ''), boundWorkspace: launch.workspaceRoot === cwd}) + '\n');
  const requests = [
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},
    {jsonrpc:'2.0',id:2,method:'tools/list',params:{}},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'coding.review.diff',arguments:{requirements:['Preserve answer() behavior'],checks:[{status:'passed',command:'python -m unittest'}]}}}
  ];
  const exchange = cp.spawnSync(command, serverArgs, {encoding:'utf8',input:requests.map(value=>JSON.stringify(value)).join('\n')+'\n',timeout:15000});
  if (exchange.status !== 0) { process.stderr.write(exchange.stderr || 'MCP fixture failed'); process.exit(32); }
  const response = exchange.stdout.trim().split('\n').map(line=>JSON.parse(line)).find(value=>value.id===3);
  const result = response && response.result;
  if (!result) process.exit(33);
  out({type:'item.started',item:{id:'review-tool-1',type:'mcp_tool_call',server:'mao_coding',tool:'coding.review.diff'}});
  out({type:'item.completed',item:{id:'review-tool-1',type:'mcp_tool_call',server:'mao_coding',tool:'coding.review.diff',status:'completed',result:{structured_content:result.structuredContent,content:result.content,isError:result.isError}}});
  out({type:'item.completed',item:{type:'agent_message',text:'Review tool result recorded.'}});
}
`);
  await chmod(fakeCodex, 0o755);
  process.env.MAO_REVIEW_REPORT = reportFile;
  process.env.MAO_REVIEW_INVOCATIONS = invocationLog;
  await writeFile(reportFile, JSON.stringify({ reviewComplete: true, summary: "Reviewed the supplied diff; answer() behavior is preserved.", findings: [], requirementCoverage: [{ requirement: "Preserve answer() behavior", status: "covered" }] }));
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable: fakeCodex, sandbox: "workspace-write", events });
  const api = await createApiServer({ config: { host: "127.0.0.1", port: 0, dataDirectory }, runtime, events });
  const address = await api.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await api.close();
    delete process.env.MAO_REVIEW_REPORT;
    delete process.env.MAO_REVIEW_INVOCATIONS;
    await rm(scratch, { recursive: true, force: true });
  });

  const projectResponse = await fetch(`${origin}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "review-project", name: "Review fixture", workspaceRoot: workspace }) });
  assert.equal(projectResponse.status, 201);
  const submit = async (title, idempotencyKey) => fetch(`${origin}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ projectId: "review-project", title, brief: "Use coding.review.diff to review the Python change. Do not modify files.", acceptanceCriteria: ["Call coding.review.diff and retain its structured result."], complexity: "simple" }),
  });

  const accepted = await submit("Review Python code through Coding Tools", "coding-review-confirmed");
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.task.status, "completed", JSON.stringify(acceptedBody.steps));
  const review = acceptedBody.steps[0].result.toolCalls.find(call => call.toolId === "coding.review.diff");
  assert.equal(review.status, "completed");
  assert.equal(review.result.status, "completed");
  assert.equal(review.result.runtimeReview.reviewComplete, true);
  assert.match(review.result.diff.stdout, /def answer/);
  assert.doesNotMatch(review.result.diff.stdout, /\.mao\/employees\//);
  assert.match(review.result.runtimeReview.summary, /Reviewed the supplied diff/);
  const acceptedStored = api.store.getTask(acceptedBody.task.id);
  assert.equal(acceptedStored.steps[0].result.toolCalls[0].result.runtimeReview.reviewComplete, true);
  assert.deepEqual(api.events.list(acceptedBody.task.id).filter(event => event.data.tool === "mcp_tool_call" && event.data.toolName === "coding.review.diff").map(event => event.type), ["tool.started", "tool.completed"]);
  assert.ok(acceptedStored.events.some(event => event.type === "tool.completed" && event.data?.result?.runtimeReview?.reviewComplete === true));

  await writeFile(reportFile, "No structured review was returned.");
  const blocked = await submit("Review Python code with missing report", "coding-review-unconfirmed");
  assert.equal(blocked.status, 200);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.task.status, "needs_review", JSON.stringify(blockedBody.steps));
  assert.equal(blockedBody.steps[0].error, "mcp_tool_blocked:mao_coding/coding.review.diff");
  assert.equal(blockedBody.steps[0].result.toolCalls[0].result.status, "blocked");
  assert.equal(api.store.getTask(blockedBody.task.id).steps[0].result.toolCalls[0].result.runtimeReview.status, "blocked");

  await writeFile(reportFile, "fixture-runtime-failure");
  const failed = await submit("Review Python code with failed reviewer", "coding-review-runtime-failure");
  assert.equal(failed.status, 200);
  const failedBody = await failed.json();
  assert.equal(failedBody.task.status, "needs_review");
  assert.equal(failedBody.steps[0].error, "mcp_tool_blocked:mao_coding/coding.review.diff");
  const failedReview = failedBody.steps[0].result.toolCalls[0].result.runtimeReview;
  assert.equal(failedReview.status, "blocked");
  assert.equal(failedReview.runtimeStatus, "failed");

  const entries = (await readFile(invocationLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const bridges = entries.filter(entry => entry.bridge);
  assert.equal(bridges.length, 3);
  for (const bridge of bridges) assert.deepEqual(bridge, { bridge: true, socketReady: true, shortPath: true, validToken: true, boundWorkspace: true });
  const invocations = entries.filter(entry => !entry.bridge);
  assert.equal(invocations.length, 6, "each task uses the shared Runtime once for work and once for review");
  assert.equal(invocations[1].sandbox, "read-only");
  assert.equal(invocations[1].hasMcp, false, "the nested review execution cannot recursively call coding.review.diff");
  assert.equal(invocations[1].codingMcpDisabled, true);
  assert.equal(invocations[1].cwd, workspace);
  assert.equal(invocations[1].promptHasDiff, true);
  assert.equal(invocations[1].promptHasHostMemory, false);
  assert.equal(invocations[1].promptHasRequirement, true);
  assert.equal(invocations[3].sandbox, "read-only");
  assert.equal(invocations[3].hasMcp, false);
});
