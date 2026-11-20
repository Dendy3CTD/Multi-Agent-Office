# MAO Hybrid API and package contract

Base URL: http://127.0.0.1:8765, loopback only. The API uses the existing
Company Director, SqliteTaskStore, and RuntimePort. Do not add another queue
or Director.

## HTTP

- GET /health returns { status: "ok" }.
- GET /api/status returns runtime availability, project/task counts, active
  execution count, and configured concurrency.
- GET /api/tools returns model-independent registered ToolSummary values.
- POST /api/projects accepts { id, name, workspaceRoot }.
- GET /api/projects returns registered projects.
- GET /api/employees returns the Company employee catalog.
- POST /api/tasks accepts { projectId, title, brief, priority?, complexity?,
  acceptanceCriteria? }. Idempotency-Key is optional. It calls
  Company.submitAndRun() and returns the Company task, steps, and plan.
- GET /api/tasks returns durable TaskDetail records.
- GET /api/tasks/:taskId returns one durable TaskDetail.
- GET /api/tasks/:taskId/events returns structured AgentEvent records as SSE.

Task POST validates fields, project registration, Runtime availability, and
the Company/Task Store contract before dispatch. Task Store owns persistence,
execution IDs, the two-slot parallelism limit, and restart needs_review rules.

## Shared TypeScript

Import types and the tool registry from @mao-hybrid/contracts:

- Task, Project, Employee, AgentEvent, Execution
- ToolDefinition<Input, Output>, ToolResult<Output>
- RuntimeAdapter.execute() and RuntimeAdapter.inspect()
- registerTool(), listTools(), executeTool()

ToolDefinition has a stable id, description, JSON input schema, and executor.
It contains no provider or model field. The API lists registered summaries;
tool invocation is a package API and must remain subject to the caller's
ordinary application policy.

## Runtime

@mao-hybrid/runtime exports createCodexRuntime(). Its execute method matches
the Company RuntimePort through the typed adapter in apps/api. It invokes the
official Codex CLI with JSONL output, passes the step prompt and project
working directory, and normalizes message/tool events. It inherits the user's
existing CLI authorization and never reads or logs auth files.

The Runtime reports inspect=unknown after a restart when its in-memory child
identity is unavailable. Company then persists needs_review and does not
redispatch an uncertain execution.
