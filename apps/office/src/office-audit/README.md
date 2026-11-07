# Office asset audit

Engine-independent validation for the office asset pack and renderer metrics.
The module does not read the filesystem, import Three.js, or estimate FPS. A
caller supplies parsed manifest data, file bytes, and optional runtime metrics.

## API

- `validateAssetManifest(manifest, options)` validates IDs, local paths,
  formats, dimensions, scale, anchors, origin, license, and source metadata.
- `auditAssetFiles(manifest, files, options)` checks file presence and size,
  GLB container structure, and external glTF buffer/image references.
- `evaluatePerformanceBudget(measurements, tier, options)` compares offline and
  runtime measurements with configurable `low`, `medium`, or `high` budgets.
- `formatAuditReport(report)` renders a deterministic text report without
  writing it to disk.
- `inspectGlbNodeBounds(bytes)` reads accessor bounds and node transforms from
  a GLB without importing a rendering engine. `transformAssetBoundsToYUp(...)`
  applies the renderer-boundary coordinate transform to those bounds.
- `evaluateSpatialQuality(snapshot, tolerances)` checks floor contact and
  coverage, walls/windows, room outliers, workstation visibility, desk
  alignment, model scale, axis contracts, and material replacement.
- `runProjectQualityGate(input)` combines the real pack, low-tier performance,
  compatibility, and measured runtime sections. `serializeProjectQualityGate`
  emits issues with `code`, `severity`, `file`/`asset`, `explanation`, and
  `recommendation`; `formatProjectQualityGate` emits the human report.

`RECOMMENDED_PERFORMANCE_BUDGETS.low` is the starting profile for Intel Iris Xe,
not a hardware benchmark. Projects should override limits after measurements on
the target Xiaomi Book Pro 14. The recommended first controls are capped DPR,
compressed textures no larger than 2048 px for ordinary props, instancing for
repeated furniture, few shadow-casting lights, and pausing the animation loop
while hidden or idle.

## Integration data

The future renderer can pass total asset and texture bytes, maximum texture
dimension, texture/object/triangle/vertex/light counts, draw calls, DPR,
animation-loop/page/scene state, measured load time, and an estimated GPU
memory total. Missing values produce explicit diagnostics; they are never
replaced with guessed FPS or GPU utilization.

The renderer-facing `RendererRuntimeMetrics` contract accepts only
`source: 'measured'` snapshots and includes draw calls, meshes, triangles,
geometries, textures, lights, DPR, animation state, loading time, a labelled
memory estimate, WebGL/console/load failures, pending requests, disposal, and
showroom-switch verification.
Optional cache and lifecycle evidence reports shared GLB documents, eviction,
WebGL context loss, post-dispose animation frames, and residual resources.

The latest checked-in project run is available as
`actual-quality-report.json` and `actual-quality-report.md` in this directory.
The MAO-GFX-12 spatial investigation is recorded separately in
`spatial-forensics-report.json` and `spatial-forensics-report.md`.
The current normalized-GLB and hardware-WebGL result is recorded in
`final-spatial-report.json` and `final-spatial-report.md`.

To audit a completed art pack, parse its `manifest.json`, recursively load the
pack files as `{ path, bytes }`, then merge `validateAssetManifest(...)`,
`auditAssetFiles(...)`, and `evaluatePerformanceBudget(...)` results if one
combined report is required. GLB checks cover only container integrity. glTF
checks cover JSON shape and local references; neither is a substitute for
geometry, material, animation, visual, or renderer validation.
