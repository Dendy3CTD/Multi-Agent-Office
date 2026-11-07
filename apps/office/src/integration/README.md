# Tower lifecycle checks

`MAOTower` keeps its demo snapshot for its mounted lifetime. Supplied employee and
live Directory snapshots remain replaceable. Employee IDs and desk assignments
come from the existing world adapters.

`PremiumFloorScene` owns loading/ready/error for one Floor 02 visit. Only an
explicit retry changes the scene key. Leaving Floor 02 destroys that visit; an
old status callback cannot affect a later visit. Ready is reported by the 3D
renderer, never inferred by the parent from downloaded asset counts. The neutral
overlay covers intermediate canvas output while keeping the floor menu available.

Run existing unit tests and the dependency-free browser regression:

```sh
cd apps/office
./node_modules/.bin/vitest run src/integration/integration.test.tsx src/office-ui/office-ui.test.tsx --no-cache
./node_modules/.bin/tsc --noEmit --incremental false
cd ../..
node apps/office/src/integration/tower.browser-check.mjs
```

The browser check uses installed Chromium, Vite, and React. It replaces only the
WebGL scene module with an instrumented component, then exercises actual React
updates, menu buttons, keyboard shortcuts, status/retry, and layout geometry at
1366×768, 1920×1080 and narrow widths. It checks props by reference and counts
scene mounts. It is **not** a physical canvas/raycaster test or a Firefox test.
The fixture is served only by the check runner; normal startup never imports it.

## Investigating the Firefox reload flash

Open the dev application with `?debug=1`, enable Preserve log, then reload.
Inspect `window.__MAO_STARTUP_TRACE__` and `[mao-startup]` messages. They report
route, tower/scene mount/unmount, employee snapshot changes, and scene status.
The `#root` element also carries `data-startup-route`. No tokens or employee
records are logged. Production builds disable this trace.

Development StrictMode intentionally replays effects. HMR may also remount a
component after source edits; distinguish these from an ordinary refresh in a
production build. Do not infer a Firefox visual result from a Chromium test.

Distinguish the observed frame using its structure:

- Legacy React App: `.office-root`, explicit legacy/video/sim route.
- SVG world scene: SVG under the Tower viewport, expected on floors other than 02.
- Procedural 3D: canvas content before GLB readiness; the Tower overlay hides it
  until the renderer reports ready. The 3D implementation owns readiness.
- Browser-retained previous frame: visible before the new document/React tree;
  a DOM trace alone cannot prove or exclude it.

The precise source of the reported Firefox flash remains unconfirmed until a
real refresh capture and the served build are inspected.
