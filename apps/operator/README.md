# MAO Operator CLI

`mao` is a thin local HTTP client for the existing MAO Server API. It does
not create a Runtime, Scheduler or BudgetManager. A task is submitted only
after the user explicitly invokes `task submit` or `demo fake`.

## Build and configure

The workspace discovers `apps/operator` through `apps/*`; no root config or
lockfile change is required.

```bash
corepack pnpm --filter @open-agent-office/operator build
node apps/operator/dist/cli.js --help

export MAO_SERVER_URL=http://127.0.0.1:3333
export MAO_TOKEN_FILE="$HOME/.config/open-agent-office/server-token"
chmod 600 "$MAO_TOKEN_FILE"
```

The repository currently has no standalone Server start command. Start the
Server through the host/composition mechanism provided by the parallel server
work, then point the CLI at its loopback URL. `MAO_SERVER_URL` also supports
an ephemeral test port. The default is the documented local URL
`http://127.0.0.1:3333/`.

The repository has no dedicated token-file provider yet. `MAO_TOKEN_FILE` is
the preferred owner-readable local source. `MAO_TOKEN` is supported for
process-local automation. Neither value is printed, logged, placed in a URL,
or written by the CLI.

## Inspect the office

```bash
node apps/operator/dist/cli.js health
node apps/operator/dist/cli.js status
node apps/operator/dist/cli.js projects
node apps/operator/dist/cli.js employees
node apps/operator/dist/cli.js runtimes
node apps/operator/dist/cli.js diagnostics
node apps/operator/dist/cli.js events --limit 20
```

Add `--json` to commands when machine-readable output is required.

## Projects

The command uses the Server DTO (`id`, `name`, `rootDir`, `status` and
`portfolio`). The CLI validates project status, priority, budget share and
concurrency before making the request.

```bash
node apps/operator/dist/cli.js project create \
  --project-id demo \
  --name "Demo project" \
  --root-dir "$PWD" \
  --status active \
  --priority normal \
  --budget-share 0.10 \
  --max-concurrent-executions 1

node apps/operator/dist/cli.js project show demo
node apps/operator/dist/cli.js projects
```

Duplicate IDs and portfolio-budget conflicts are returned as safe errors from
the Server. The CLI never edits Portfolio directly.

## Tasks

The Server requires `projectId`, `title` and `brief`. Its task type field is
`complexity`, not a separate `type` field.

```bash
node apps/operator/dist/cli.js task submit \
  --project-id demo \
  --title "Fake check" \
  --brief "Inspect the MVP" \
  --complexity simple \
  --priority normal \
  --idempotency-key demo-task-1

node apps/operator/dist/cli.js task status task-id
node apps/operator/dist/cli.js task watch task-id --interval-ms 1000 --timeout-ms 60000
node apps/operator/dist/cli.js task cancel task-id
```

`task watch` performs bounded GET polling, handles Ctrl+C, and stops at
`completed`, `failed` or `cancelled`. It never repeats the POST request.

Task status display includes task/project IDs, phase, employee, runtime,
model, attempts, safe result fields and safe diagnostic error codes. Briefs,
prompts, credentials and token-like values are redacted.

## Safe Fake demo

```bash
node apps/operator/dist/cli.js demo fake
node apps/operator/dist/cli.js demo fake --project-id demo --json
```

The demo performs health/status checks, verifies that Fake Runtime is
available, creates or uses one project, submits one idempotent task, watches
its terminal state and reads archive history when `status.archive.configured`
is true.

Because the current task DTO has no runtime selector, the demo refuses to run
when any non-fake production Runtime is reported as available. It therefore
cannot accidentally submit the demo task to a production Runtime. It never
starts a real LLM and never removes user projects.

## Archive

```bash
node apps/operator/dist/cli.js archive project demo
node apps/operator/dist/cli.js archive task task-id
node apps/operator/dist/cli.js archive events --project-id demo
```

Only existing Server archive endpoints are used. No direct vault access and
no invented recovery endpoint are present in the CLI.
