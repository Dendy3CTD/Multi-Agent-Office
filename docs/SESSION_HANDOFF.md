# Session Handoff — Five routed employees, four visual characters

## OAO-MODEL-002: economical models and the fifth employee Helper

The routed team is now five AI employees (`packages/orchestrator`,
`DEFAULT_AGENT_MODELS`): Director and Analyst on `opencode-go/mimo-v2.6-flash`,
Developer on `opencode-go/glm-5.3-flash`, Engineer on `opencode-go/qwen3.8-flash`,
and the new auxiliary Helper on `opencode-go/beam-free`. Helper handles small
supporting errands for the four core employees (short research, summaries,
checklists, explanations, formatting, pre-checks). It does not replace them,
is not required in every project and is never started automatically; there is
no simulated delegation between agents. The root `opencode.json` now defaults
the manual OpenCode model to `opencode-go/glm-5.3-flash`.

The visual office and `?sim` still show four characters; the fifth on-screen
employee, its desk spot and terminal sessions/history for Helper remain
Stage 9 work. See `docs/reports/OAO-MODEL-002.md`.

## Fix V2: movement and Russian chat

The immobility cause was in `App.tsx`: `seatSimAgent()` replaced every sim
agent's entry position with its desk position and emptied `pathQueue`. The
animation loop and reducer were running, but had no remaining movement to
perform. That helper was removed. `?sim` now starts all four agents at the
existing entrance/path state and uses `SIM_MOVEMENT_PLAN` to send Director,
Developer, Engineer and Analyst to the task board and back to their own
standing points. The existing A* route and swept collision checks remain in
the path.

The frame chain was also audited. `Character.tsx` owns one independent
animation clock per selected state; `startAnimationClock()` is cleaned up only
when the state or component changes. The sheets had different source frame
sizes, but the renderer assumed `450×1024` for every character. Renderer width
now comes from the actual source dimensions, while the equal-frame CSS sheet
positioning remains unchanged. Pixel inspection confirms differing adjacent
frames for idle, walking and working sheets.

The visible demo chat and status vocabulary are Russian, including the default
and Office-theme scripted pools. Real live prompt/reply text is not translated
in the browser; four future provider instructions in `src/agentLanguage.ts`
require Russian responses and records while preserving code/API identifiers.

`?sim&debug=1` now shows position, target, state, movement/stop flag, route
length, per-character animation/frame/FPS and `clock: ON`. The simulation badge
reads `ДЕМОНСТРАЦИЯ`.

Automated verification after Fix V2: `corepack pnpm typecheck`, `corepack pnpm
test` (16 tests), `corepack pnpm build`, and `corepack pnpm test:desktop` all
pass. Direct Electron/Chromium manual verification and requested screenshots
remain pending on a Debian GNOME host because this managed environment denies
Electron sandbox startup and local listening ports.

## Desktop Polish V1

The initial Electron content size is derived from
`screen.getPrimaryDisplay().workAreaSize` by `electron/window-layout.cjs`.
It targets `1672×941`, preserves `1672:941` when the GNOME workarea is
smaller, uses `useContentSize`, centers the window and keeps a resizable
minimum of `1000×563`.

The four main spots remain `type: 'desk'` for compatibility with the live
assignment reducer, but now use safe standing coordinates: Director and
Developer at `(640,500)` and `(1050,500)`, Engineer and Analyst at
`(640,760)` and `(1050,760)`. Desk rectangles, chair rectangles, approach
points and interaction points are separate definitions in `rooms.ts`; route
tests verify all four targets are reachable without crossing furniture.

The visible animation defect was in `scripts/generate_character_sheets.py`:
transparent `alpha_composite` did not clear the old pixels before translating
the source frame, leaving a large static-looking remainder. The generator now
clears each frame before pasting and the existing sheets were regenerated.
`Character.tsx` uses six walking frames and four frames for idle, working and
coffee; no LLM event is needed for the animation clock.

The default UI locale is `ru-RU` (`src/i18n.ts`), with the visible title
`ОФИС ИИ-АГЕНТОВ`, Russian role names and Russian state/panel labels. Internal
role IDs, model identifiers and API fields are unchanged.

Automated verification: `corepack pnpm typecheck`, `corepack pnpm test`
(13 tests), `corepack pnpm test:desktop` and `corepack pnpm build` pass.
The repository environment could not run the Electron/Chromium renderer:
the container denies sandbox host/listening-port operations, so a fresh
Electron window and new renderer screenshots remain a host-side check.

## Electron black-screen fix

Production Electron no longer uses `file://`. `apps/office/electron/main.cjs`
starts `static-server.cjs`, binds only to `127.0.0.1` on an ephemeral free port,
and loads `http://127.0.0.1:<port>/?sim`. The server serves the Vite `dist`
tree with MIME types for the built assets, `/sprites/`, `/rooms/`, SVG/WebP and
SPA route fallback. Encoded traversal attempts are rejected and the server is
closed during Electron shutdown.

The existing `serverUrl.ts` behavior remains correct: in production the page
origin is the local HTTP server, while `?sim` disables the WebSocket hook and
runs the existing local simulation. No backend or fake LLM activity was added.
Electron logs `did-fail-load`, renderer `console-message` and
`render-process-gone` events to `open-agent-office.log` in Electron's logs
directory. DevTools are not opened automatically.

Verification after the fix used `http://127.0.0.1:4187` as a test instance:
`/?sim`, the built JavaScript and CSS, `/rooms/office-four-person.png`, and a
character animation PNG all returned HTTP 200 with the expected MIME types;
`/task-board` returned the SPA index with HTTP 200; an encoded traversal request
returned HTTP 404. The fixed visual capture is `data/desktop-app-fixed.png`.

## Debian desktop handoff

The repository now includes `apps/office/electron/main.cjs` and an empty
`preload.cjs`. The main process uses `contextIsolation`, disables Node
integration, enables sandbox/web security, blocks arbitrary navigation and
opens only HTTP(S) external links with the system browser. It loads the built
Vite app from `dist/index.html?sim`, so the existing four-person simulation is
visible without a backend and without fake LLM activity.

Commands:

```bash
corepack pnpm build
corepack pnpm desktop
corepack pnpm desktop:install
corepack pnpm desktop:uninstall
```

On the current machine `XDG_CURRENT_DESKTOP=GNOME`; the installer preserves
existing GNOME favorites and appends `open-agent-office.desktop` once. Other
desktop environments receive the same valid entry and require manual pinning.
The desktop smoke test is still pending if the Electron runtime binary cannot
be downloaded by the environment; Vite build, typecheck and tests remain
independently verifiable.

## Overview

The office frontend now uses the supplied `office-four-person.png` texture
(1672×941) as its single room background. It is a compact 2×2 plan: Director
upper-left, Developer upper-right, Engineer lower-left and Analyst lower-right.
Each has an independent desk spot, chair/sitting point, state and
collision-safe route; the old furniture renderer is not layered over the baked
room art.

## Changes Made

- `rooms.ts` now describes exactly four desks, four chairs, four desk spots and
  collision rectangles in one percentage coordinate system.
- `navigation.ts` adds 8-neighbour A* routing, agent-radius clearance, diagonal
  corner protection and swept-segment validation.
- `officeReducer.ts` refuses unsafe stale segments instead of tunnelling through
  furniture.
- The supplied room texture provides the visible desk and chair pixels. The
  app keeps only semantic interaction anchors for those baked props.
- `?sim` contains exactly the four configured staff members; the former
  Explore/replacement demo spawns were removed so the scene cannot introduce
  an extra NPC.
- `navigation.test.ts` covers station counts, chair placement, routes to all
  desks and diagonal collision behaviour.

### Files Restored
1. **Complete source directory restoration**: All TypeScript source files and components were copied from `references/claude-office-main/src/` to `apps/office/src/`
2. **Core functionality restored**:
   - All 14 React components (including AgentCard, Meters, IncidentLayer, SessionStrip, SlackChat, TaskBoard, PermissionCard, PlacementHelper)
   - Complete application architecture (App.tsx, main.tsx)
   - WebSocket and event handling (useAgentSocket, hooks)
   - Incident management system
   - Agent management (agentManager.ts, agentProvider.ts)
   - Office reducer and state management (officeReducer.ts)
   - Theme and asset management (theme.ts, assets.ts)
   - Sound effects and interaction systems

3. **Development tooling configured**:
   - vite.config.ts updated with WebSocket proxy configuration matching reference
   - package.json configuration for development

### Issues Resolved
1. **TypeScript errors**: All TypeScript compilation errors fixed - typecheck passes with no errors
2. **Missing components**: All React components restored from reference
3. **Build system**: Vite build configuration updated and working
4. **WebSocket connectivity**: Proxy configuration added for WebSocket connections to the office server

### Constraints Honored
- [x] Preserved Vite + React + TypeScript stack
- [x] Maintained original visual style, sprites, and animations
- [x] Restored full character movement and office layout
- [x] Kept all original APIs and interfaces unchanged
- [x] Did not modify references directory or delete user files
- [x] Maintained TypeScript strict mode without errors
- [x] Avoided integrating real employee APIs or autonomous execution

## Verification Results

### TypeScript Typecheck
✅ **PASSED** — `npm run typecheck`

### Production Build
✅ **PASSED** — `npm run build` (78 modules transformed)

### Tests and browser check

✅ **PASSED** — `npm test -- --run` (4 geometry/navigation tests)
✅ **PASSED** — Vite served `?sim` with HTTP 200 and headless Chromium rendered
the final room screenshot at `data/office-four-person-final.png`; an additional
smaller viewport was also rendered to check aspect-ratio scaling.

## Remaining Work
The restored frontend now provides the complete Office UI as originally designed:
- Visual office with character movement
- Employee management and status monitoring
- Real-time chat and task boards
- Incident management and alerts
- Payroll, electricity, and memory meters
- Agent inspector cards and details
- Permission management and approval workflows
- Theme switching and animations

The application is now ready for:
- Integration with the office server APIs
- Adding the missing tasks from the roadmap
- Running the demo/sim mode
- Full development and testing cycle

## Command to Start Application
```bash
corepack pnpm --filter @open-agent-office/office dev
```

The application will run on http://127.0.0.1:3333 with WebSocket support for real-time updates.

## 2026-11-01 collision/debug handoff

- Scene coordinates are normalized from the baked `1672×941` room image by
  `src/sceneGeometry.ts`; background, agents, routes, obstacles and hitboxes
  all render as percentages of the same aspect-ratio container.
- `rooms.ts` now contains measured collision rectangles for the four desks,
  four chairs, sofa, coffee table, kitchen, cabinets and large plants. Chair
  destinations have a separate approach/final-target rule in `navigation.ts`.
- Run `?sim&debug=1` to inspect red collision boxes, blue interaction areas,
  green destinations, routes, cursor pixels and character anchors. The normal
  `?sim` path does not mount this overlay.
- Verification: `./node_modules/.bin/tsc --noEmit` and
  `./node_modules/.bin/vitest run` pass (9 tests). Manual debug screenshots
  are in `data/debug-collisions.png`, `data/debug-interactions.png` and
  `data/debug-animations.png`.
- Multi-frame sheets now live in
  `apps/office/public/sprites/characters/animations/`. They are derived from
  the existing character PNGs: six walking frames and four frames for working,
  idle and coffee, in all four directions, for the four sim characters.
  `Character.tsx` uses the generated sheet when available and falls back to
  the original directional PNG for other roles/themes.
- `scripts/generate_character_sheets.py` is the reproducible generator for
  these project-local sheets; it never reads from or writes to `references/`.
- Browser verification at `?sim` observed changing DOM frame indices for idle
  and working states and mounted `.char-sprite-sheet` elements in the office.
