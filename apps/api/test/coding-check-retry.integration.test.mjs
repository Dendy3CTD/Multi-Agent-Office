import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApiServer } from "@mao-hybrid/api";
import { createEventBus } from "@mao-hybrid/events";
import { createCodexRuntime } from "@mao-hybrid/runtime";

test("Developer check retries use the final MCP outcome and preserve every call", async t => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-check-retry-"));
  const executable = join(scratch, "codex-fixture.cjs");
  await writeFile(executable, String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const args = process.argv.slice(2);
const scenario = path.basename(process.cwd());
const out = (type, item) => process.stdout.write(JSON.stringify({ type, item }) + "\n");
const message = text => out("item.completed", { type: "agent_message", text });

if (args.includes("read-only")) {
  fs.readFileSync("engineering.py", "utf8");
  fs.readFileSync("tests/test_engineering.py", "utf8");
  message(JSON.stringify({
    status: "approved", summary: "Inspected both files and reviewed Developer's test evidence.",
    inspectedFiles: ["engineering.py", "tests/test_engineering.py"], findings: [],
  }));
  return;
}

const commandConfig = args.find(arg => arg.startsWith("mcp_servers.mao_coding.command="));
if (!commandConfig) {
  message("Deliver engineering.answer() returning 42 and verify it with unittest.");
  return;
}
const command = JSON.parse(commandConfig.split("=").slice(1).join("="));
const serverArgs = JSON.parse(args.find(arg => arg.startsWith("mcp_servers.mao_coding.args=")).split("=").slice(1).join("="));
fs.mkdirSync("tests");
fs.writeFileSync("tests/test_engineering.py", "import unittest\nfrom engineering import answer\n\nclass AnswerTest(unittest.TestCase):\n    def test_answer(self):\n        self.assertEqual(answer(), 42)\n");
const writeCorrectCode = () => fs.writeFileSync("engineering.py", "def answer():\n    return 42\n");

function check(id, checkArgs = { check: "python-test" }) {
  const item = { id, type: "mcp_tool_call", server: "mao_coding", tool: "coding.check.run" };
  out("item.started", item);
  if (!checkArgs) {
    out("item.completed", { ...item, status: "failed", error: { message: "MCP tool call requires approval" } });
    return;
  }
  const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: item.tool, arguments: checkArgs } };
  const mcp = spawnSync(command, serverArgs, { encoding: "utf8", input: JSON.stringify(call) + "\n", timeout: 10000 });
  if (mcp.status !== 0) throw new Error(mcp.stderr || "Coding MCP failed");
  const result = JSON.parse(mcp.stdout.trim()).result;
  if (scenario === "unconfirmed") delete result.structuredContent.workspaceFingerprint;
  out("item.completed", { ...item, status: "completed", result });
}

if (scenario === "fixed") {
  check("first");
  writeCorrectCode();
  check("second");
} else if (scenario === "later-failure") {
  writeCorrectCode();
  check("first");
  fs.writeFileSync("engineering.py", "def answer():\n    return 410\n");
  check("second");
} else if (scenario === "edited") {
  writeCorrectCode();
  check("first");
  fs.writeFileSync("engineering.py", "def answer():\n    return 41\n");
} else if (scenario === "edited-tests") {
  writeCorrectCode();
  check("first");
  fs.appendFileSync("tests/test_engineering.py", "\n    def test_regression(self):\n        self.assertEqual(answer(), 41)\n");
} else if (scenario === "cache-cleanup") {
  writeCorrectCode();
  check("first");
  for (const directory of ["__pycache__", "tests/__pycache__"]) {
    const bytecode = fs.readdirSync(directory).filter(name => name.endsWith(".pyc"));
    if (!bytecode.length) throw new Error("Expected unittest to create bytecode in " + directory);
    for (const name of bytecode) fs.unlinkSync(path.join(directory, name));
  }
} else if (scenario === "snapshot-error") {
  writeCorrectCode();
  check("first");
  const fifo = spawnSync("mkfifo", ["unexpected-entry"], { encoding: "utf8" });
  if (fifo.status !== 0) throw new Error(fifo.stderr || "Could not create FIFO fixture");
} else if (scenario === "blocked") {
  check("first", { check: "python-test", paths: ["tests/missing.py"] });
} else if (scenario === "rejected") {
  check("first", null);
} else if (scenario === "unconfirmed") {
  writeCorrectCode();
  check("first");
}
message("The checks passed.");
`);
  await chmod(executable, 0o755);
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable, events });
  const api = await createApiServer({ config: { port: 0, dataDirectory: join(scratch, "data") }, runtime, events });
  t.after(async () => { await api.close(); await rm(scratch, { recursive: true, force: true }); });

  for (const [scenario, outcomes, error] of [
    ["fixed", [["failed", "failed"], ["completed", "passed"]], undefined],
    ["later-failure", [["completed", "passed"], ["failed", "failed"]], "mcp_tool_failed:mao_coding/coding.check.run"],
    ["edited", [["completed", "passed"]], "required_mcp_tool_stale:mao_coding/coding.check.run"],
    ["edited-tests", [["completed", "passed"]], "required_mcp_tool_stale:mao_coding/coding.check.run"],
    ["cache-cleanup", [["completed", "passed"]], undefined],
    ["snapshot-error", [["completed", "passed"]], "required_mcp_tool_outcome_unverified:coding.check.run"],
    ["blocked", [["completed", "blocked"]], "mcp_tool_blocked:mao_coding/coding.check.run"],
    ["rejected", [["rejected", undefined]], "mcp_tool_rejected:mao_coding/coding.check.run"],
    ["unconfirmed", [["completed", "passed"]], "required_mcp_tool_outcome_unverified:coding.check.run"],
    ["missing", [], "required_mcp_tool_not_executed:coding.check.run"],
  ]) {
    await t.test(scenario, async () => {
      const workspace = join(scratch, scenario);
      await mkdir(workspace);
      api.company.registerProject({ id: scenario, name: scenario, workspaceRoot: workspace });
      const { task } = await api.company.submitAndRun({
        projectId: scenario, title: "Deliver a Python package", complexity: "complex",
        brief: "Implement engineering.answer() and run the tests using coding.check.run.",
      });
      const saved = api.store.getTask(task.id);
      const developer = saved.steps[1];
      assert.deepEqual(saved.steps.map(step => step.status), ["completed", error ? "needs_review" : "completed", error ? "queued" : "completed"]);
      assert.equal(task.status, error ? "needs_review" : "completed");
      assert.equal(developer.error, error);
      assert.deepEqual(developer.result.toolCalls.map(call => [call.status, call.result?.status]), outcomes);
      const terminalEvents = saved.events.filter(event => event.data?.toolName === "coding.check.run" && event.type !== "tool.started");
      assert.deepEqual(terminalEvents.map(event => [event.data.itemId, event.data.status, event.data.result?.status]),
        outcomes.map(([status, result], index) => [index === 0 ? "first" : "second", status, result]));
      if (scenario === "fixed") {
        assert.match(developer.result.toolCalls[0].result.stderr, /ModuleNotFoundError/);
        assert.equal(developer.result.toolCalls[1].result.exitCode, 0);
        assert.match(developer.result.toolCalls[1].result.workspaceFingerprint, /^[a-f0-9]{64}$/);
      }
      if (scenario === "edited" || scenario === "edited-tests") {
        const diagnostic = developer.result.checkFingerprintDiagnostic;
        assert.equal(diagnostic.callId, "first");
        assert.equal(diagnostic.expected, developer.result.toolCalls[0].result.workspaceFingerprint);
        assert.match(diagnostic.observed, /^[a-f0-9]{64}$/);
        assert.notEqual(diagnostic.observed, diagnostic.expected);
      }
      if (scenario === "snapshot-error" || scenario === "unconfirmed") {
        assert.equal(developer.result.checkFingerprintDiagnostic.reason,
          scenario === "snapshot-error" ? "snapshot_unavailable" : "missing_or_invalid_evidence");
      }
    });
  }
});
