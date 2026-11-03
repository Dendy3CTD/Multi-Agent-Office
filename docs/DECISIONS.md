# Architecture Decisions

## ADR-001 — Local-first monorepo

Use a pnpm TypeScript workspace. Keep the office, server and packages
in one repository, with clear module boundaries.

Status: accepted.

## ADR-002 — Reuse components, not whole applications

Study Claude Office for visual patterns and assets whose licenses permit
reuse. Study Open Office for orchestration concepts. Study the OpenCode
integrations for event handling. Do not merge upstream repositories wholesale.

Status: accepted.

## ADR-003 — OpenCode as initial agent runtime

Use OpenCode as the first execution runtime. Each employee receives an
explicit provider/model identifier. Validate JSON event parsing and
session recovery before production use.

Status: accepted, implementation pending.

## ADR-004 — Kimi K3 as replaceable Director

Kimi K3 is the default Director model. The role and model assignment
must be configurable; the application must support replacing the Director.

Status: accepted.

## ADR-005 — SQLite plus Obsidian

SQLite is the transactional event store. Obsidian is the Markdown archive
and knowledge base. Use an outbox so failed exports can be retried safely.

Status: accepted.

## ADR-006 — Safe autonomy

Autonomy is configurable by capability and workspace. Full computer access
does not imply unrestricted root access or permission to disclose secrets.

Status: accepted.
