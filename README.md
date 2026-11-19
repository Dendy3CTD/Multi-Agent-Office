# MAO Hybrid

Minimal local agent backend for Node.js 22. Company and Task Store are the
single Director and durable queue. Codex runs through the official local CLI,
so the process uses the user's existing Codex login and does not need an API
key.

## Requirements

- Node.js 22.5 or newer
- pnpm 12
- Codex CLI installed and logged in

## Start

    corepack pnpm install
    cp mao-hybrid.config.example.json mao-hybrid.config.json
    corepack pnpm build
    corepack pnpm start

The API binds only to 127.0.0.1. Edit mao-hybrid.config.json to set the Codex
CLI path for the host. Runtime authorization is inherited from the current
user's Codex CLI configuration. Do not add an API key.

Default durable task database: ./data/tasks.sqlite. It is local to this
checkout and unrelated to any legacy MAO database.

## Smoke request

Register an existing workspace:

    curl -sS -X POST http://127.0.0.1:8765/api/projects \
      -H 'content-type: application/json' \
      -d '{"id":"demo","name":"Demo","workspaceRoot":"/absolute/path/to/project"}'

Submit a task:

    curl -sS -X POST http://127.0.0.1:8765/api/tasks \
      -H 'content-type: application/json' \
      -H 'Idempotency-Key: demo-first-task' \
      -d '{"projectId":"demo","title":"Inspect README","brief":"Read README.md and report its purpose.","complexity":"simple"}'

The request runs through Company.submitAndRun() and returns the persisted task,
planned steps, and actual Runtime result. Other read-only endpoints:

- GET /health
- GET /api/status
- GET /api/tools
- GET /api/projects
- GET /api/employees
- GET /api/tasks
- GET /api/tasks/:taskId/events (SSE replay)

## Development

    corepack pnpm test
    corepack pnpm typecheck
    corepack pnpm build

Tools are registered through the model-independent functions exported by
@mao-hybrid/contracts: registerTool(), listTools(), and executeTool().
