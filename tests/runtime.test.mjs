import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexRuntime } from "@mao-hybrid/runtime";
import { createEventBus } from "@mao-hybrid/events";

test("Codex CLI JSONL is normalized into events and a completed RuntimePort result", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "mao-hybrid-codex-fixture-"));
  const executable = join(scratch, "fake-codex");
  await writeFile(executable, "#!/usr/bin/env node\nconst out = value => process.stdout.write(JSON.stringify(value) + \"\\n\");\nout({type:\"thread.started\",thread_id:\"session-1\"});\nout({type:\"item.started\",item:{id:\"tool-1\",type:\"command_execution\"}});\nout({type:\"item.completed\",item:{id:\"message-1\",type:\"agent_message\",text:\"fixture result\"}});\n");
  await chmod(executable, 0o755);
  const events = createEventBus();
  const runtime = createCodexRuntime({ executable, sandbox: "read-only", events });
  t.after(() => rm(scratch, { recursive: true, force: true }));

  const result = await runtime.execute({
    executionId: "exec-1", idempotencyKey: "exec-1",
    task: { id: "task-1", projectId: "project-1", title: "fixture", brief: "fixture", status: "running", createdAt: new Date().toISOString() },
    step: { id: "step-1", title: "read", prompt: "read only", employeeId: "employee-1" },
    project: { id: "project-1", name: "fixture", workspaceRoot: scratch },
    employee: { id: "employee-1", professionId: "analyst", displayName: "Analyst", status: "active", skills: [], instructions: "", specialization: "", departmentId: "research" },
    workingDirectory: scratch, signal: new AbortController().signal,
  });

  assert.deepEqual(result, { status: "completed", text: "fixture result", result: { text: "fixture result" }, executionState: "terminated" });
  assert.deepEqual(events.list("task-1").map(event => event.type), ["session.started", "tool.started", "agent.message", "runtime.completed"]);
});
