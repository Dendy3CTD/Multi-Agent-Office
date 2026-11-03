# Development Roadmap

## Stage 0 — Research

- [x] Clone four upstream repositories.
- [x] Inspect high-level structure, package manifests and licenses.
- [x] Inspect Open Office orchestrator and runtime adapter.
- [x] Confirm OpenCode CLI supports --model and --format json.
- [x] Locate the user's existing Obsidian vault.
- [x] Validate exact upstream APIs and dependency compatibility.

## Stage 1 — Foundation

- [x] Create monorepo structure.
- [x] Initialize workspace and lockfile.
- [x] Create shared event and entity types.
- [x] Create configuration and secret handling.
- [x] Add health endpoint and smoke tests.

## Stage 2 — First real team

- [x] Register Kimi K3 as Director. Historical assignment for this stage,
  replaced by the economical model table in OAO-MODEL-002
  (`docs/reports/OAO-MODEL-002.md`).
- [x] Register two independently configurable coding employees.
- [x] Launch an OpenCode session with an explicit model.
- [x] Capture status, output, errors and token usage where available.
- [x] Persist tasks and events in SQLite.

## Stage 3 — Office UI

- [x] Visual office and employee movement.
- [x] Employee details and real-time status.
- [x] Chat, task board and project navigation.
- [x] Pet with deterministic local animations.
- [x] Reports and settings.
- [x] Rework the isometric room for four independent employee stations.
- [x] Add collision-aware navigation, chair placement semantics and geometry
  tests.
- [x] Adopt the supplied four-person room texture without double-rendering
  furniture, while retaining dynamic interaction overlays and office events.
- [x] Align baked-scene collision and interaction geometry to the 1672×941
  source image; add debug overlays and geometry tests.
- [x] Add reviewed project-local multi-frame sheets derived from the existing
  character PNGs and connect walking, working, idle and coffee frame sequences
  for Director, Developer, Engineer and Analyst.

## Stage 4 — Obsidian archive

- [ ] Configure a dedicated vault subdirectory.
- [ ] Implement SQLite outbox and idempotent exporter.
- [ ] Archive projects, tasks, agent activity and reports.
- [ ] Add links, templates, daily logs and attachments.
- [ ] Add recovery and archive integrity tests.

## Stage 4a — Debian desktop shell

- [x] Add Electron main process around the existing Vite office.
- [x] Load production `?sim` by default until the local backend is available.
- [x] Add Linux desktop entry, user icon installation and uninstall scripts.
- [x] Preserve GNOME favorites without duplicates; document non-GNOME pinning.
- [ ] Validate packaged Electron runtime on the target Debian installation.

## Stage 5 — Skills and tools

- [ ] Role-specific Skills.
- [ ] Browser automation.
- [ ] Blender integration.
- [ ] KOMPAS-3D integration.
- [ ] Documents, images and presentations.

## Stage 6 — Autonomous operation

- [ ] Dynamic model routing.
- [ ] Parallel task execution.
- [ ] Review and repair loops.
- [ ] Permission profiles and emergency stop.
- [ ] Budget limits and recovery after crashes.

## Stage 7 — Benchmarking

- [ ] Compare individual models and agent teams.
- [ ] Measure pass rate, quality, latency and cost.
- [ ] Compare against a fixed Opus 5.5 baseline.
# Desktop Polish V1 status — 2026-11-01

- [x] Preserve the 1672×941 scene ratio in the Electron content area.
- [x] Keep four live-compatible desk spots with collision-safe standing and
  approach coordinates.
- [x] Repair generated sprite-sheet frame clearing and use the existing
  animation clock for visible state frames.
- [x] Make the default office UI Russian (`ru-RU`) without renaming internal
  IDs or API fields.
- [x] Add tests for sizing, workstation safety, routes and frame selection.
- [ ] Run the new screenshots and Electron smoke test on a Debian GNOME host
  with a functioning display/sandbox; this CI/container blocks the renderer.
# Fix V2 status — 2026-11-01

- [x] Remove the sim initialization path that froze all four employees at
  their desks.
- [x] Add deterministic local board visit/return movement using existing A*
  routing and collision checks.
- [x] Keep animation clocks independent of React renders and expose their
  state in debug mode.
- [x] Render generated sheets using each character's real frame dimensions.
- [x] Translate demo chat, status pools and visible operational messages to
  Russian; add Russian provider instructions for four roles.
- [x] Add behavioral tests for the local movement plan and animation clock.
- [ ] Run Electron and capture `data/live-office-movement.png`,
  `data/live-office-chat-ru.png`, `data/live-office-animations.png` and
  `data/live-office-debug.png` on Debian GNOME; the current managed runtime
  blocks Electron/Chromium sandbox startup and local ports.

# OAO-MODEL-002 — economical models and Helper — 2026-11-02

- [x] Switch the four core employees to economical models: Director and
  Analyst on `opencode-go/mimo-v2.6-flash`, Developer on
  `opencode-go/glm-5.3-flash`, Engineer on `opencode-go/qwen3.8-flash`.
- [x] Add the fifth auxiliary employee Helper on `opencode-go/beam-free`
  (routing table and fake-Runtime tests only; on-demand start, no auto-start,
  no simulated delegation between agents).
- [x] Set the manual OpenCode model in the root `opencode.json` to
  `opencode-go/glm-5.3-flash`.
- [ ] Add Helper to the visual office scene (see Stage 9).

## Stage 9 — Agent Terminal

- [ ] Add the selected third terminal-interface image from the ChatGPT
  collection shown on 2026-11-02 as a permanent design reference in the
  repository. The image is not currently confirmed to exist in the repository;
  add it before visual implementation. It is the sole visual reference for
  this terminal: a modern dark developer console with clear typography,
  structured messages, polished command/result blocks, and readable code and
  logs. Do not blend in the other two images' styles.
- [ ] Build a custom React employee terminal instead of reproducing the
  standard OpenCode TUI.
- [ ] Stream real structured AI employee messages from
  `packages/runtime-opencode`; never simulate work or parse OpenCode TUI
  presentation.
- [ ] Render Markdown and syntax-highlighted code, with expandable structured
  details for file reads/creation/changes, command and test execution, tool
  results, and errors; show the actual command/tool output.
- [ ] Derive employee states from Runtime events and display model, task,
  elapsed time, and available usage/runtime statistics.
- [ ] Provide message input and execution cancellation.
- [ ] Keep separate sessions and history for all five employees, including
  the auxiliary Helper.
- [ ] Add the fifth employee (Helper) to the visual office scene, its desk
  spot and character set; until then the on-screen office keeps four
  characters.
- [ ] Require controlled confirmation for dangerous actions and redact
  secrets, tokens, and confidential data from logs and displayed output.
