import { createTaskResearchDispatcher } from "@mao-hybrid/tools-research";
import type { TaskScopedToolProvider } from "@mao-hybrid/contracts";

/**
 * Task scoped adapter for the published Research package. The package owns its
 * HTTPS host allowlist, redirect checks, timeouts, and bounded PDF extraction.
 * Research tools deliberately receive no Codex auto-approval configuration.
 */
export function createResearchProvider(): TaskScopedToolProvider {
  return {
    id: "research-tools-host",
    create(context) {
      const dispatcher = createTaskResearchDispatcher({
        projectId: context.projectId,
        taskId: context.taskId,
        executionId: context.executionId,
        workspaceRoot: context.workspaceRoot,
        employee: context.employee,
      });
      return {
        summaries: dispatcher.summaries,
        mcpServers: dispatcher.tools.length > 0 ? [dispatcher.mcpServer] : [],
        invoke: (toolId, input) => dispatcher.invoke(toolId, input),
      };
    },
  };
}
