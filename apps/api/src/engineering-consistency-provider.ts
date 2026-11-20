import { fileURLToPath } from "node:url";
import { analyzeEngineeringProject, type EngineeringProjectManifest } from "@mao-hybrid/engineering-consistency";
import type { TaskScopedToolProvider } from "@mao-hybrid/contracts";

export const ENGINEERING_CONSISTENCY_TOOL_ID = "engineering.consistency.validate";

export const ENGINEERING_CONSISTENCY_TOOL_SUMMARY = Object.freeze({
  id: ENGINEERING_CONSISTENCY_TOOL_ID,
  name: "Engineering consistency gate",
  description: "Run the package's schemaVersion 1 engineering consistency checks. Missing or uncertain facts block READY_TO_BUILD; this is not physical safety certification.",
  inputSchema: Object.freeze({
    type: "object",
    required: ["schemaVersion", "project", "artifacts", "schematic", "bom", "firmware", "cad", "assemblyInstructions"],
    properties: {
      schemaVersion: { const: 1 }, project: { type: "object" }, artifacts: { type: "array" }, schematic: { type: "object" },
      bom: { type: "object" }, firmware: { type: "object" }, cad: { type: "object" }, assemblyInstructions: { type: "object" }, policy: { type: "object" },
    },
    additionalProperties: false,
  }),
  capabilities: Object.freeze(["engineering-consistency"]),
  annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, openWorldHint: false }),
});

export function createEngineeringConsistencyProvider(): TaskScopedToolProvider {
  return {
    id: "engineering-consistency-host",
    create(context) {
      if (context.employee.professionId !== "qa-engineer") return { summaries: [], mcpServers: [], async invoke() { throw Object.assign(new Error("Consistency tool is not available to this specialist"), { code: "tool_not_allowed" }); } };
      const serverPath = fileURLToPath(new URL("./engineering-consistency-mcp-server.js", import.meta.url));
      const launch = { projectId: context.projectId, taskId: context.taskId, executionId: context.executionId, allowedToolIds: [ENGINEERING_CONSISTENCY_TOOL_ID] };
      const mcpServer = Object.freeze({
        name: "mao_consistency", command: process.execPath, args: Object.freeze([serverPath, JSON.stringify(launch)]),
        allowedTools: Object.freeze([ENGINEERING_CONSISTENCY_TOOL_ID]),
        // No approvedToolIds: Codex retains its default per-call approval policy.
      });
      return {
        summaries: [ENGINEERING_CONSISTENCY_TOOL_SUMMARY],
        mcpServers: [mcpServer],
        async invoke(toolId, input) {
          if (toolId !== ENGINEERING_CONSISTENCY_TOOL_ID) throw Object.assign(new Error("Consistency tool is not permitted for this task"), { code: "tool_not_allowed" });
          return analyzeEngineeringProject(input as EngineeringProjectManifest);
        },
      };
    },
  };
}
