# Instructions for AI agents working on Open Agent Office

## Project rules

1. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`
   and `docs/ROADMAP.md` before making architectural changes.
2. The `references/` directory contains upstream projects for research.
   Never modify these repositories unless explicitly instructed.
3. Do not copy entire upstream projects blindly. Reuse only reviewed
   components and preserve required license notices and attributions.
4. Keep model providers, model identifiers, roles and Skills configurable.
5. Employee model assignments are defined by `DEFAULT_AGENT_MODELS` in
   `packages/orchestrator/src/agents.ts` (OAO-MODEL-002): director and analyst
   `opencode-go/mimo-v2.6-flash`, developer `opencode-go/glm-5.3-flash`,
   engineer `opencode-go/qwen3.8-flash`, auxiliary helper
   `opencode-go/beam-free`. Assignments must remain replaceable through
   configuration. The manual OpenCode model in the root `opencode.json`
   (`opencode-go/glm-5.3-flash`) is the default for manual sessions and is not
   the Director model.
6. Use typed interfaces, tests and explicit error handling.
7. Do not store API keys, passwords, tokens or secrets in source code,
   logs, Markdown archives or Git.
8. Do not send secrets or full environment variables to an LLM.
9. Do not execute destructive shell commands, use sudo, change system
   settings or enable unrestricted auto-approval without explicit
   authorization for that particular operation.
10. Keep the application bound to localhost by default.
11. Do not modify the user's existing Obsidian notes. The application
    may write only inside its dedicated Open Agent Office directories.
12. Archive task events durably before exporting Markdown to Obsidian.
13. Never report a task as successful until its acceptance checks pass.
14. Keep agent work isolated with Git worktrees where concurrent edits
    could conflict.
15. Update documentation and tests alongside implementation.

## Current development policy

The current task is architecture and project scaffolding.
Do not install dependencies, run migrations or build the full application
unless the user explicitly asks for that stage.
