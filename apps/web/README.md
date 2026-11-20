# MAO Hybrid Web

This frontend lives in `apps/web` and reuses the authored MAO three.js office
scene and directory model from Open Agent Office. Department floors use the
premium 3D renderer, one active floor at a time; lobby, cafe and lounge retain
their own authored room scenes. The 113-person, 12-department fixture is
available only through the visible development fixture mode.

## Run

```sh
npm install
npm run dev
```

The development server listens on loopback port 3333 and makes no API calls.
Live mode is clearly `OFFLINE / NOT CONNECTED` and never contacts the older
Open Agent Office API. The top-right button switches to the explicit
`?mode=fixture` preview and back.

## Live behavior

The shared `@mao-hybrid/contracts` package now defines domain types such as
`Project`, `Employee`, `Task`, `Execution`, `AgentEvent`, and `RuntimeAdapter`.
It does not define a browser transport or authoritative snapshot service. The
frontend still needs backend-owned access to directory/projects/tasks and
executions, task preview/confirmation/cancellation, result retrieval, runtime
and budget status, and event streaming or a documented polling cadence. The
web app will map those responses to the office view models through the
package's public exports; it does not define routes or substitute local DTOs.

The app must not show fixture staff, task execution, model output, or status as
live. Fixture mode is read-only, visibly marked `DEVELOPMENT FIXTURE`, and
does not call any backend. The offline live shell shows no employees or tasks.

## Checks

```sh
npm run typecheck
npm run build
npm run browser-check
```

The browser check validates the 3D floor/Director UI in explicit fixture mode,
including floor switching, the renderer, 113 staff, 15 floors, and fixture
labeling, employee selection, and disabled task submission. Real Codex task
creation and streaming remain blocked until an authorized backend transport
is available; the browser check does not substitute mocked API replies.
