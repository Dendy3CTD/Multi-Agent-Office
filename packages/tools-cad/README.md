# MAO Hybrid CAD tools

This package adds a task-scoped `mao_cad` stdio MCP server and CAD dispatcher to the existing API/Codex task tool composition. It creates no separate Director, Runtime, or Task Store. The API adds it only for the selected CAD-capable employee and rejects duplicate tool IDs or MCP server names. The Runtime accepts the server only when its project, task, execution, employee capabilities, tool IDs, and registered workspace match the current task.

## Tools

- `cad.capabilities` detects FreeCADCmd and reports the locally available engine/version and export support.
- `cad.model.create` reads the ESP32-C3 fixture, a generic `mao-parametric-part`, or `mao-parametric-assembly`. Assembly components use constrained rectangle/circle/circle-array sketches, `PartDesign::Pad`/`Pocket`, hole arrays, fillet/chamfer, separate bodies, and XYZ position/orientation. The lower-level generic part format retains bounded box/cylinder primitives with ordered `union`/`cut`.
- `cad.model.inspect`, `cad.model.validate`, and `cad.assembly.inspect` inspect FreeCAD or STEP geometry. Fixture assumptions produce `NEEDS_REVIEW` even when the geometric checks pass.
- `cad.export.step`, `.stl`, and `.glb` export from an FCStd model and validate the resulting file. STEP and STL are re-imported by FreeCAD. GLB reports structure validity, accessor/triangle geometry validity, independent-validator availability, and visual verification separately.
- `cad.drawing.generate` creates a measured dimensioned SVG and uses local headless Chromium to print PDF when available. It re-opens the PDF with `pdfinfo` and extracts text with `pdftotext` to confirm page count and dimensions.
- `cad.render.preview` creates an isometric SVG from a FreeCAD-exported mesh.

Every result includes the tool ID, status, real process exit code/output where applicable, warnings, checked and unconfirmed parameters, created paths, recommendations, execution flag, workspace, and command/duration when a process ran. A successful geometry/export result does not certify board fit, material behavior, printability, thermal performance, fastener strength, or product safety.

## Engine and security constraints

The verified Debian host has FreeCADCmd 1.0.0, Gmsh 4.13.1, and OpenSCAD 2021.01. FreeCAD Part, Sketcher and PartDesign Pad/Pocket/Fillet/Chamfer were exercised in console-mode geometry tests. TechDraw modules are present, but GUI-only TechDraw PDF export is unavailable. Chromium, `pdfinfo`, and `pdftotext` are available and provide the tested headless SVG-to-PDF route. Blender, CadQuery, Python OCP, trimesh, meshio, build123d, assimp, and Khronos `gltf-validator` were not detected.

CAD CLI execution requires `bwrap`. It uses an isolated network namespace, a read-only host filesystem view, a writable bind for the registered task workspace only, a workspace-local HOME/TMP, a cleared environment, argument arrays (no shell), and bounded timeout/output. The sandbox's minimal `/dev` does not expose host serial or lab devices. If bubblewrap or FreeCADCmd is unavailable or a boundary cannot be established, the result is `BLOCKED`. The tools do not install dependencies, access lab hardware, upload firmware, or write outside the task workspace.

## ESP32-C3 SuperMini fixture

`test/fixtures/low-voltage-controller-assembly.json` is the Stage 06.2 practical assembly fixture. It includes a sketched base, cavity pocket, standoff pad array, fastener hole array, separate cover body with a cavity, and an unexported controller-board reference envelope. The report checks topology, bounds, body intersections, component distances, declared-versus-measured reference dimensions, export re-import, and tolerances. An `assumptions.csv` accompanies the JSON geometry report. All PCB size/hole/tolerance values remain unverified assumptions and the component compatibility result is `NEEDS_REVIEW`.

Sketch profiles are bounded to rectangles, circles, and circle arrays on XY planes. Pad/extrude, pocket, hole-array, fillet, and chamfer operations are validated against actual FreeCAD feature shapes; edge operations require explicit `EdgeN` selectors. Generic primitive models are constrained to boxes, cylinders, and boolean union/cut. This does not yet provide arbitrary attachment planes, arbitrary sketch constraints, or a full assembly workbench. FCStd stores FreeCAD feature bodies and sketches; the JSON specification and replayable macro preserve the generation inputs.

The package GLB reader independently walks the GLB chunks, buffer views, accessors, vertex values, bounds, and triangle indices. No independent third-party validator is installed or connected, so `glb.independent.status` remains `BLOCKED`; no visual verification is claimed.

## Local verification

```sh
corepack pnpm --filter @mao-hybrid/tools-cad build
corepack pnpm --filter @mao-hybrid/tools-cad typecheck
corepack pnpm --filter @mao-hybrid/tools-cad test
MAO_HYBRID_CODEX_CLI=/path/to/codex.js MAO_HYBRID_CAD_E2E_KEEP=1 node --test apps/api/test/cad-codex.e2e.test.mjs
```

The last command is an actual Codex CLI → API → Director → CAD MCP → FreeCAD → Task Store test. It creates a disposable registered project under `/tmp`; `MAO_HYBRID_CAD_E2E_KEEP=1` preserves that isolated workspace and prints the resulting path. Without a Codex CLI path, the test is skipped and is not evidence of host E2E.
