# Engineering workflow API

The engineering project endpoint creates one durable Director task with these ordered stages:

`requirements → research → bom → electronics → firmware → cad → verification → documentation`

Each stage depends on the immediately preceding stage. The Task Store allows at most two active executions globally; this workflow itself runs serially. Every stage is persisted before dispatch, and its employee ID, role ID, required capabilities, required MCP tool IDs, budget cap, result, and attempt count are stored with the task.

## Create a project and workflow

`POST /api/engineering/projects`

```json
{
  "id": "sensor-controller",
  "name": "Sensor Controller",
  "workspaceRoot": "/absolute/path/to/project",
  "brief": "Design a low-voltage sensor controller...",
  "procurementBudget": { "amount": 180, "currency": "USD" },
  "executionBudget": { "amount": 250, "currency": "USD" },
  "acceptanceCriteria": ["..." ]
}
```

An optional `Idempotency-Key` (up to 128 characters) makes creation repeatable. The workspace must already exist. The response includes the persisted project and workflow plan with its latest status. Creation can succeed with the first step in `needs_review` when runtime, budget enforcement, or a required capability is unavailable; that is a durable blocked workflow, not a successful engineering result.

`GET /api/projects/:projectId/manifest` returns the latest workflow, validated stage artifacts, output files, and validation statuses. `DESIGN_VERIFIED` requires a completed workflow and a verified consistency artifact backed by actual tool evidence. The API always reports `hardwareStatus: NOT_VALIDATED` and an empty hardware evidence list; this workflow has no mechanism to claim physical validation.

## Artifact handoff

Completed stages must return one JSON artifact prefixed with `ENGINEERING_ARTIFACT_JSON:` or provide the same structure in a structured runtime result:

```json
{
  "schemaVersion": 1,
  "id": "requirements-v1",
  "kind": "requirements",
  "status": "draft",
  "summary": "...",
  "items": [{ "id": "REQ-1", "description": "..." }],
  "files": [],
  "sourceEvidence": [],
  "assumptions": [],
  "basedOnArtifactIds": []
}
```

Artifacts are validated for stage identity, shape, traceability, safe project-relative file paths that exist in the workspace, required successful task-scoped MCP calls, and source evidence. Research requires at least one verifiable source. Verification and documentation are not marked complete if their requirements are not met. A non-empty assumptions list, malformed artifact, conflict, missing evidence, or `needs_review` artifact stops the workflow. Only validated artifacts from completed prerequisite steps are passed to the next stage.

## Runtime and MCP integration

`createApiServer` registers host adapters for `@mao-hybrid/engineering-consistency` and `@mao-hybrid/tools-research`, and accepts optional `taskToolProviders` for other providers. The consistency adapter calls the package's real `analyzeEngineeringProject()` contract and exposes a task-scoped `mao_consistency` MCP server without `approvedToolIds`; Research exposes its real dispatcher through `mao_research`, also without `approvedToolIds`. Codex therefore keeps its per-call prompt policy for Research network reads. Every provider creates fresh task/execution-bound tool summaries, MCP servers, and invoke functions. Tool IDs and MCP server names are conflict-checked.

Research tool exposure follows the package's employee capabilities. A research analyst gets `research.capabilities`, `research.web.search`, and `research.datasheet.extract`; an electronics engineer additionally gets component search/inspection/comparison and BOM compilation. The package enforces HTTPS and its existing search/manufacturer/distributor host allowlists, validates every redirect, bounds redirect count, response size and request time, and does not provide arbitrary URL fetch, local file, or shell tools. PDF text extraction uses the package's fixed, bounded `pdftotext` invocation. No Research tools are globally auto-approved.

The workflow requires `research.web.search` and `research.datasheet.extract`. Search results remain `UNVERIFIED` leads. Research artifact provenance is host-collected from the actual MCP result and carries `toolId`, `callId`, status, `checkedAt`, source URL, extraction, quoted evidence, and page where available. A Research artifact cannot be `verified` unless every cited source call returns `VERIFIED`. In downstream artifacts, only `VERIFIED` source values can support confirmed characteristics or prices; `UNVERIFIED` and `OUTDATED` remain explicitly untrusted. `OUTDATED`, `NEEDS_DATASHEET`, and blocked results stop acceptance.

Electronics BOM requires `electronics.kicad.bom` and `electronics.bom.validate`; electronics design requires `electronics.components.validate`, `electronics.electrical.validate`, and KiCad ERC. They are exposed only through the existing Electronics capability-filtered dispatcher. The two new validation tools are absent from its auto-approval allowlist, so the existing per-call prompt policy remains active. `UNSAFE`, `NEEDS_DATASHEET`, `NEEDS_REVIEW`, and `BLOCKED` tool results stop the workflow. Known BOM costs are compared with the project procurement budget; unknown or mismatched currencies require review.

Current integration dependencies:

- Engineering Consistency is connected through the package manifest/report contract. It reports declared-data consistency only; source artifacts still need to provide a complete, verified manifest.
- The runtime must declare `supportsBudgetLimit: true` only when it enforces the per-execution USD maximum supplied as `budget.maxUsd` and `step.budgetCapUsd`. Otherwise engineering steps are durably moved to `needs_review` before runtime dispatch.
- `procurementBudget` is the parts-cost ceiling; `executionBudget` is the separate USD ceiling for AI execution. Current Codex CLI adapter does not enforce an actual USD spend ceiling, so it must not claim this capability. The eight stage caps split `executionBudget` evenly across two maximum attempts per stage; this is a planning ceiling only until a capable runtime enforces it.

No purchase, firmware upload, or physical device operation is performed by this workflow. The API rejects task-scoped tool IDs for purchasing, checkout, firmware flashing/upload, device writes, actuation, soldering, and high-voltage operations before runtime dispatch.

## Recovery and limits

At startup, Company inspects saved running execution IDs. It records confirmed completions, permits only explicitly safe retries after confirmed termination, and sends unknown outcomes to `needs_review` without duplicate dispatch. Successful prior artifacts remain stored when a later step fails.

`POST /api/tasks/:taskId/steps/:stepId/retry` retries only a `failed` step. Each engineering stage is limited to two attempts; total workflow size is fixed at eight steps. `needs_review` is not implicitly retried. The task-level idempotency key and durable execution IDs prevent duplicate project plans and unsafe repeated dispatch.

## Readiness

The host reported `codex-cli 0.167.0`. The current Runtime adapter does not declare or enforce an actual USD spend maximum, so the regular eight-stage engineering workflow remains fail-closed before automatic dispatch.

For an explicitly confirmed bounded integration trial, `POST /api/engineering/test-runs` accepts only the exact confirmation string exported as `BOUNDED_ENGINEERING_TEST_CONFIRMATION`, `stepCount: 2`, and `maxAttemptsPerStage: 1`. The endpoint refuses to run while another task is queued or running, then runs only Research → BOM with one attempt per stage. It uses the configured Codex CLI and the existing Research/Electronics tools; it does not configure another paid API. It has **no monetary AI execution hard cap**. Do not treat this mode as budget enforcement or production readiness. This endpoint was not invoked during implementation.

Research package fixtures and API handoff fixtures test the contracts without claiming live web search. Real network search and real Codex E2E remain `NOT TESTED`. Host end-to-end readiness remains `NO` until real source checks and real engineering E2E complete successfully.
