# MAO-GFX-12 — spatial forensics

Status: **FAIL**. Spatial gate implementation: **READY**. Performance profile:
`low` for Intel Iris Xe.

## Root causes

- **Coordinate metadata:** GLB accessor bounds prove that the pack is Z-up,
  while `manifest.json` declares Y-up. The renderer's single `-PI/2` X
  conversion matches the bytes, but the manifest and generic
  `createOfficeArtRuntime` contract do not.
- **Floor coverage:** the source floor is 12×9×0.12 in Z-up coordinates.
  `fitScale: [22/12, 1, 14/9]` scales local axes before rotation, so the rendered
  floor is approximately 22×9 m, not the logical 22×14 m room. Objects in the
  outer desk row and plants at z≈±5 m therefore sit outside the visible floor.
- **Perceived furniture scale:** GLB desk width/depth is 1.5×0.72 m while the
  procedural reference desk is 2.45×1.15 m. The GLB is internally metre-sized,
  but replacing the fallback creates a 39% scale discontinuity in the existing
  composition. This is not evidence of duplicate scaling.
- **Laminate loss:** the GLB reports zero textures/images. `materials.json` v2
  references an oak SVG, but `OfficeScene3D` loads only manifest + GLB and hides
  the textured procedural fallback. The external material mapping is therefore
  not applied by this render path.
- **Loader split:** `OfficeScene3D` bypasses `createOfficeArtRuntime`; the two
  loaders disagree about where Z-up conversion belongs. `fitScale` also has no
  declared source-axis semantics.

## Current compatibility matrix

| Contract | Result | Evidence |
| --- | --- | --- |
| GLB up axis | FAIL | Geometry is Z-up; manifest says Y-up. |
| Renderer axis conversion | PASS | Current renderer converts Z-up once at the integration boundary. |
| Floor bounds | FAIL | Actual transformed floor is ~22×9 m for a 22×14 m layout. |
| Walls/windows | PASS with regression coverage | Current fitted wall spans and window overlap satisfy geometric tolerances; tests retain failure cases for detached windows and short walls. |
| Employee → desk | PASS | Layout desk IDs drive rendered seats and characters. |
| Reserved desk | PASS | The twelfth unoccupied desk remains in visible desk data. |
| Asset mapping | WARNING | IDs resolve, but materials are not deterministically bound in the renderer. |
| Visual material continuity | FAIL | Textured fallback is replaced by an untextured GLB floor. |

## Performance evidence

- Real GLB: 174,968 bytes, 133 nodes, 106 meshes/primitives, 2,544 vertices,
  1,272 triangles, 11 materials, zero textures/images/animations/lights.
- Static pack complexity is below the configurable low-tier limits.
- Configured DPR cap is 1.5; no measured DPR sample was supplied.
- Runtime draw calls, texture memory, GPU memory, load latency, WebGL errors,
  disposal counters and FPS were not measured. Their absence is WARNING, not
  PASS. No Iris Xe FPS claim is made.
- The renderer uses a shared promise cache, but no eviction diagnostics exist;
  hidden fallback resources remain allocated; the continuous render loop has no
  visibility pause. Unmount cancels its frame and disposes fallback resources,
  but shared GLB ownership/disposal still requires measured lifecycle evidence.

## Required renderer fixes

1. Make manifest geometry axis truthful, then keep exactly one tested conversion.
2. Express fit scale in source axes or compute it after axis normalization.
3. Bind `materials.json` textures, or embed reviewed textures in the GLB.
4. Reconcile model scale with camera/spacing instead of blindly multiplying all models.
5. Expose `RendererRuntimeMetrics`, pause hidden/idle rendering, and verify cache eviction/disposal.

## Target-device verification

Run Firefox/Chromium on Debian 13 with hardware WebGL, capture renderer strings,
draw calls, triangles, DPR, load time, texture/GPU-memory estimate, console and
WebGL errors, then repeat showroom enter/leave. A software renderer or empty
canvas cannot validate Intel Iris Xe performance or visual composition.
