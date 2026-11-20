# `@mao-hybrid/tools-coding`

Coding, Git, test, GitHub, browser, and code-review tools for the existing MAO Hybrid Director and Codex Runtime. This package adds no Director, queue, database, language server, or compiler. It implements a task-scoped `ToolDefinition` dispatcher and a small stdio MCP server so the existing Codex CLI can call tools during a task.

## Host wiring

```ts
import { createTaskCodingDispatcher } from "@mao-hybrid/tools-coding";

const taskTools = createTaskCodingDispatcher({
  projectId: task.projectId,
  taskId: task.id,
  executionId,
  workspaceRoot: project.workspaceRoot,
  employee: { id: employee.id, professionId: employee.professionId, skills: employee.skills },
});
await runtime.execute({ ...input, taskTools: { ...taskTools, mcpServers: [taskTools.mcpServer] } });
```

The API host now performs this wiring after Company selected the employee and Task Store claimed the step. Developer profiles receive coding, checks, Git reads, project-local Git branch/commit, and GitHub read tools. QA gets its smaller testing capability set. Other professions do not receive Coding Tools by default. `ToolDefinition` and `ToolSummary` now carry first-class immutable `capabilities`; the dispatcher filters by them and rechecks input-specific language capability for generic check calls. The host never registers workspace-bound closures in the process-global registry.

Project check commands run through `bubblewrap`: the filesystem root is read-only, only the registered project workspace is persistently writable, HOME/TMP are inside that workspace, and project checks get an isolated network namespace. If `bubblewrap` is unavailable, the check is blocked. Commands are fixed by check kind. File arguments are relative to the workspace and rejected if they resolve through a symlink outside it. Output and duration are bounded.

## Checks and adapters

- Python: pytest, Ruff, compileall.
- Rust: `cargo test` and `cargo check`.
- JavaScript / Node: `node --test` and `node --check`.
- TypeScript / React / Next.js: Vitest, Playwright Test, ESLint, `tsc --noEmit`, and the selected project's `npm run build`.
- C / C++: GCC and G++ syntax checks.
- HTML / CSS: html-validate and Stylelint.
- Shell: `bash -n`.

Each check returns `command`, `exitCode`, `stdout`, `stderr`, `durationMs`, `status`, and existing artifact file paths/URIs. An unavailable executable returns `blocked` with `exitCode: null`; it is never reported as a pass. Installations are not attempted by the adapter.

Git status, diff, log, local branch creation, and selected-path commits are bound to the exact registered workspace. Local Git writes are available only to developer profiles and require explicit tool input confirmation. The API does not grant GitHub push, PR creation, or merge capabilities. Those tools remain separately gated by external-write mode and are excluded from ordinary task dispatch. GitHub reads use only the official `gh` CLI and cover auth status, issues, PRs, PR checks/diffs, and workflow runs. Credentials stay with the user's `gh`/Git credential configuration; the package does not read or store tokens.

Local sites can be started only from host-configured `localServers`, with loopback URL templates. The browser adapters require an explicit origin allowlist. Playwright connects over loopback CDP when supplied by the host. The API currently does not inject browser or reviewer ports, so those tool calls return explicit blocked results until host configuration is added.

`coding.review.diff` performs a small deterministic scan and accepts a `CodeReviewPort` bound by the API host to the existing Codex Runtime and the current durable task context. Without that port, its overall status is `blocked` and it explicitly reports that substantive review did not run.

## Local verification

```sh
corepack pnpm --filter @mao-hybrid/tools-coding build
corepack pnpm --filter @mao-hybrid/tools-coding typecheck
corepack pnpm --filter @mao-hybrid/tools-coding test
```

The package E2E creates an isolated temporary Git repository, runs a real Node test against an intentionally defective program, edits the program, reruns the test, and checks the resulting Git diff. The API integration test executes a Coding Tool through a Fake Runtime and verifies events and Task Store persistence. The environment used for verification has no installed `codex` CLI, so it cannot make an actual model-driven tool call.
