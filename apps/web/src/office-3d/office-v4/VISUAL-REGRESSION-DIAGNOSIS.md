# Office V4 visual regression diagnosis

## Evidence reviewed

- `apps/web/screenshots/floor-02-before.png` is the pre-V4 browser capture. It uses the premium showroom architecture: a cutaway floor, readable rear brick wall, bright glazed windows, and an open view of the interior.
- `apps/web/screenshots/office-v4/floor-02.png` and the live captures for UI floors 01 and 14 show the V4 regression: the south/east exterior shell dominates the foreground, the window apertures read as dark blocks, and rooms/furniture are hidden behind the shell and the open Director panel.
- `design-references/office-v4/floor-02.png`, `floor-01.png`, and `floor-14.png` show open cutaway compositions with the floor and functional zones visible from the same general south-east isometric direction.
- `OfficeScene3D.tsx` marks authored Office V4 presets as `customAuthoredPreset`; in that branch it hides `PremiumArchitectureV29` and its showroom finishing, polish, ambient contact, and dressing groups. The V4 plan renderer is therefore the only exterior architecture renderer for those floors.
- `floor-presets/render.ts` unconditionally emitted all four full-height exterior walls. With the presets' camera at positive X / negative Z, the east and south walls are in the camera foreground. The legacy showroom architecture did not build those two walls.
- Window pane creation passed `frameMaterial` (commonly `graphite-metal`) as the glass color source. The palette resolves graphite before glass, producing dark panes. The generated city boxes were positioned at approximately `depth / 2` inside the room, in front of the north glazing, so they formed a dark screen rather than a distant view.
- The old showroom renderer's saved comparison is substantially more open and has deliberately visible window light. This is a renderer regression, not missing route registration: the author presets' zones, rooms, workplaces, furniture and decor reach the current renderer, but the shell and incorrect glazing mask their contents.

## Root cause

Office V4 replaced the showroom's carefully cutaway-specific shell with generic four-sided walls, but did not make the shell camera-aware. At the same time, the window material inherited the dark frame tint and an interior-side skyline occluded the glass. Hiding the showroom finishing was correct to avoid duplicate/foreign furniture, but the replacement V4 architectural layer did not preserve the old showroom's open composition, lighting/readability, or material treatment.

## Recovery target

Keep all author presets and the single shared renderer. Omit the two camera-facing exterior walls for each preset camera, keep the far walls, render translucent glazing with the preset glazing tint, and place procedural skyline geometry outside the floor boundary. Verify actual generated geometry for UI floors 02, 01, and 14 before assessing all floors. Do not treat the prior 15/15 route test as visual acceptance.

## Scope note

The earlier captures also contained the fixed TaskDesk overlay, which obscured part of the scene. Office V4 E2E hides that overlay only while writing visual-review screenshots, then restores it and checks Director/API in the same browser session. Preset author files are outside this renderer recovery scope.

## Recovery verification — 2026-11-20

- Renderer omits the two camera-facing outer walls while retaining the two rear walls. The browser audit checks the omitted sides against each preset camera, not a hard-coded floor number.
- Window panes now use the glazing material rather than the frame color. Procedural daylight and low-cost city silhouettes sit outside the floor boundary; fixture bounds exclude only those marked exterior environment meshes.
- Runtime placement IDs were audited against every author furniture/decor ID on all 15 routes. All authored placement IDs appeared in the active scene; no preset fallback was used.
- UI 02 camera zoom, fit, and pan were exercised in Chromium. UI 03 and UI 04 continue to render their own employee/desk layouts without `FloorLayoutError`.
- Chromium screenshots and live API/Director checks pass. The API provided 113 employees, one project, and six stored tasks; no new tasks were submitted.
- This fixes the shell/window occlusion regression, but does not bring Office V4 to visual acceptance. UI 02 remains less detailed than the previous showroom capture and reference: the exterior skyline is simplified, several authored specialist props are low-detail procedural assets, and room dressing/material nuance remains below the approved artwork. UI 01 and UI 14 read as reception/cafe spaces, but likewise do not yet match the density and finish of their references.
- Before/after comparison: `apps/web/screenshots/floor-02-before.png` and `apps/web/screenshots/office-v4/floor-02.png`. Current captures of the recovery targets are under `apps/web/screenshots/office-v4/floor-01.png`, `floor-02.png`, and `floor-14.png`.
- Headless Chromium measured at most 458 draw calls and about 255k triangles on UI 02 at DPR 1.0. This is not a measurement on Intel Iris Xe; real-device FPS/memory and visual acceptance remain open.
