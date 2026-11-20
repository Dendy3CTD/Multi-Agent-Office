# Coding Tools host integration

The task-scoped host contract is now implemented across `@mao-hybrid/contracts`,
`@mao-hybrid/api`, `@mao-hybrid/runtime`, and this package.

`ToolDefinition` and `ToolSummary` carry optional immutable `capabilities`.
`RuntimeExecutionInput.taskTools` carries the selected task's tool summaries,
the trusted project/workspace identity, a host-side `invoke()` dispatcher, and
an MCP server launch configuration. The API builds that dispatcher only after
Company has selected an employee and Task Store has claimed the step.

For a developer, the API creates a fresh `CodingTaskDispatcher` bound to the
registered project workspace. The Codex Runtime translates its one stdio MCP
server into per-execution `codex exec --config mcp_servers...` overrides. The
server is launched from the Coding Tools package, reconstructs the adapter for
that workspace, publishes only the allowed tool IDs, and checks the selected
employee capabilities again on every call. It is not registered in the global
tool registry, so concurrent projects cannot share workspace-bound closures.

The MCP server runs known project checks through `bubblewrap`: the host root is
read-only, the registered project workspace is the only persistent writable
mount, HOME and TMP are inside that workspace, and project check processes have
an isolated network namespace. GitHub read commands are fixed, read-only `gh`
operations. External GitHub write tools are never included in the API task
dispatcher; the host currently does not expose an owner grant for them.

The API's existing `/api/tools` route now includes model-independent coding
summaries with capabilities. Normal task submission remains unchanged:
`POST /api/tasks` → Company Director → Task Store claim → existing Codex Runtime.
No frontend route, Director, queue, database, or Runtime was added.

## Remaining host limitations

- Browser automation needs the host to provide a Playwright/Chrome DevTools
  port and configured local application origins. The API currently has no such
  host configuration, so calls return an explicit blocked result.
- `coding.review.diff` needs a CodeReviewPort bound to a current trusted review
  context; the API does not yet provide one.
- Actual CLI execution requires an installed `codex` executable and existing
  user authorization. Tests in this package validate the MCP protocol and
  Runtime configuration separately; the API E2E uses a Fake Runtime.
