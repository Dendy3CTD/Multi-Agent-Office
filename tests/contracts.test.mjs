import test from "node:test";
import assert from "node:assert/strict";
import { executeTool, listTools, registerTool } from "@mao-hybrid/contracts";

test("registered tools are listed and executed independently of model providers", async () => {
  registerTool({
    id: "test.echo",
    name: "Echo",
    description: "Returns the input text",
    inputSchema: { type: "object", required: ["text"] },
    async execute(input) { return { text: input.text }; },
  });
  assert.ok(listTools().some(tool => tool.id === "test.echo"));
  assert.deepEqual(await executeTool("test.echo", { text: "hello" }), { toolId: "test.echo", status: "completed", output: { text: "hello" } });
  await assert.rejects(() => executeTool("missing", {}), error => error.code === "tool_not_found");
});
