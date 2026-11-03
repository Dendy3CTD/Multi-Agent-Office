# Open Agent Office — Architecture

## Purpose

Build a local-first AI office on Debian. Multiple cloud-hosted open-weight
LLMs work as employees with distinct roles, Skills, models and permissions.

## Main components

### Office UI — apps/office

Interactive office, employee cards, character movement, pet, chat,
task board, reports, settings and model/employee management.

### Local API — apps/server

Local HTTP API, WebSocket event stream, authentication for local clients,
health checks and application lifecycle.

### Orchestrator — packages/orchestrator

Implemented (OAO-RT-003): `AgentExecutionCoordinator` connects Budget Manager
and OpenCode Runtime for one employee task. Admission goes through the budget
before any process starts; the budget AbortSignal is passed to Runtime; usage
deltas from Runtime (`onUsage`) are recorded in order; the slot is released only
after usage writes finish. The factory builds JSONL journals under
`~/.local/share/open-agent-office/budget/` with a fixed financial policy.

Not yet implemented: task planning, task graph, delegation, retries, team
phases, review cycles, result aggregation and recovery.

### Model Manager — packages/model-manager

Provider catalogue, model registry, role-to-model assignments,
availability checks, pricing metadata, routing and fallback policy.

### OpenCode Runtime — packages/runtime-opencode

Launch and manage OpenCode sessions, pass provider/model identifiers,
stream structured events, capture results, cancel tasks and recover sessions.

### Agent Terminal — Stage 9

The Agent Terminal is a custom React interface for employee sessions, not an
embedded or visually copied OpenCode TUI. It consumes typed, structured events
from `packages/runtime-opencode`; Runtime events are the source of truth for
employee activity and visible execution state. The interface must not infer
work by parsing terminal presentation or simulate agent activity. Runtime
event contracts should expose message streaming, tool/command lifecycle and
results, errors, session/task identity, model identity and available timing or
usage statistics. The terminal presents employee-specific sessions/history,
supports user input and cancellation, and gates dangerous actions through
controlled approval. Logs and rendered event details must redact secrets and
confidential data. Stage 9 also requires a permanent checked-in design
reference for the selected third terminal-interface image before visual work
begins.

### Skills — packages/skills and skills/

Skill discovery, validation, role assignment, progressive loading,
versioning and execution-tool requirements.

### Archive — packages/archive

SQLite event log, transactional outbox, idempotent Markdown exporter,
Obsidian vault integration, search and recovery.

### OpenCode Plugin — plugins/opencode-office

Observe manually started OpenCode sessions and report lifecycle events
to the local office. Orchestrated tasks must also report events directly
through the runtime adapter.

## Team composition (OAO-MODEL-002)

The office routes five AI employees. The routing table lives in
`packages/orchestrator` (`DEFAULT_AGENT_MODELS`) and is configuration only:
nothing is launched from it, and a `modelId` cannot be passed per task.

| agentId | default model |
| --- | --- |
| director | opencode-go/mimo-v2.6-flash |
| developer | opencode-go/glm-5.3-flash |
| engineer | opencode-go/qwen3.8-flash |
| analyst | opencode-go/mimo-v2.6-flash |
| helper | opencode-go/beam-free |

Helper is the fifth, auxiliary employee on Beam Free. It supports the four
core employees with small errands: short research and reference gathering,
summaries, checklists and documentation, explaining errors and small code
fragments, formatting and structuring data, pre-checking small results and
preparing support materials. Helper does not replace the developer, engineer,
analyst or director. It is auxiliary and is not required in every project:
it runs only on explicit request for small supporting tasks, never
automatically. Full automatic subtask delegation is a later Orchestrator
stage and is not simulated.

The visual office still shows four characters; adding the fifth on-screen
employee remains Stage 9 work.

## Event flow

User request
  -> Director
  -> task plan
  -> task router
  -> selected employees and models
  -> isolated workspaces
  -> execution and tool events
  -> review and tests
  -> integration
  -> final report
  -> SQLite event log
  -> Obsidian Markdown archive

## Storage

SQLite is the operational source of truth for task state and event delivery.
Obsidian is the human-readable long-term archive and knowledge interface.
Git is the source of truth for code history.

## Runtime strategy

Start with OpenCode CLI using explicit model selection and JSON output.
Validate its real event format before implementing the parser.
Keep the runtime interface replaceable so an SDK/server adapter can be
introduced later without rewriting the orchestrator.

## Security

Use localhost-only services by default, per-agent permissions, isolated
worktrees, secret redaction, task budgets, audit logs and explicit approval
for destructive or externally visible actions.
