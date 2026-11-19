# Workspace ownership

Shared ownership rules for the MAO Hybrid MVP workspace.

- Root package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json,
  and root scripts: Bootstrap owner.
- packages/contracts: Bootstrap owner; stable cross-package types and the
  model-independent tool registry.
- packages/runtime: Codex CLI adapter owner.
- packages/company: Company agent owner. It owns Director, roster and plan
  execution. Do not duplicate Director logic.
- packages/task-store: Task Store agent owner. It owns the SQLite queue,
  execution IDs, durability and concurrency cap. Do not add a second queue.
- packages/events: shared AgentEvent fan-out.
- packages/chat: chat/session feature owner.
- packages/tools-coding: coding tools owner.
- packages/tools-electronics: electronics tools owner.
- packages/tools-cad: CAD tools owner.
- packages/tools-research: research tools owner.
- packages/integrations: integration adapters owner.
- apps/api: Bootstrap owner for the local API composition and RuntimePort
  adapter.
- apps/web: frontend agent owner. Existing web files are preserved.
- tests: workspace acceptance and package consumer tests.
- docs: shared docs; agent-specific docs should not be overwritten by
  Bootstrap changes.

Before editing another owner's implementation, agree on the contract first.
