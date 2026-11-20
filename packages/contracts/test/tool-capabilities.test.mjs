import test from "node:test";
import assert from "node:assert/strict";
import { listTools, registerTool } from "../dist/index.js";

test("registered tool summaries retain immutable employee capabilities", () => {
  const capabilities = ["coding", "git"];
  registerTool({
    id: "test.capabilities",
    name: "Capability fixture",
    description: "Lists employee capabilities",
    inputSchema: { type: "object" },
    capabilities,
    execute: async () => ({}),
  });
  capabilities.push("github-write");
  const listed = listTools().find(tool => tool.id === "test.capabilities");
  assert.deepEqual(listed.capabilities, ["coding", "git"]);
  assert.ok(Object.isFrozen(listed.capabilities));
});
