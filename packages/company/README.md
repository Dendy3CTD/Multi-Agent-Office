# Company

Deterministic Director and employee runtime boundary for MAO Hybrid. It is a small workflow runner, not CrewAI or a second orchestration engine. It consumes the existing MAO role/employee catalog and an injected `TaskStore` and `RuntimePort`.

## Contract boundary

`Company.submitTask()` accepts the MAO task body fields `projectId`, `title`, `brief`, optional `priority`, optional `complexity`, and optional acceptance criteria. The API host maps HTTP `Idempotency-Key` to `idempotencyKey`. It returns the saved task and its planned steps. Task states are `queued`, `running`, `completed`, `failed`, and `needs_review`.

Call `submitAndRun()` for the usual autonomous flow: it durably saves the plan first, then uses the shared queue slots to dispatch eligible work through the runtime port and returns the latest task state. Hosts that need separate submit and execution endpoints can call `submitTask()` and `runAvailable()` independently.

`RuntimePort.execute()` receives a durable `executionId` as both identity and idempotency key, a single selected employee, the project workspace, role instructions, Skills, and per-project employee memory paths. `inspect()` is used after restart; `unknown` executions become `needs_review` and are never dispatched again. Only Director-marked read-only analysis/review steps may retry, and only after the port confirms termination and `safeToRetry`.

The checked-in catalog is a data-only projection of the legacy MAO Directory seed: 113 employee profiles, 63 profession profiles, and 12 departments. Idle profiles are records only and do not start processes. Each project gets separate employee memory under its own `.mao/employees/` directory.

Run tests with `node --test test/*.test.js`. Node.js 22.5 or newer is required for the SQLite Task Store.
