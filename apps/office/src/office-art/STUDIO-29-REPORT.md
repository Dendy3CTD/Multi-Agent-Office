# MAO-GFX-29-A — studio production evidence

Status: PARTIAL. Real modelling, two art iterations, optimization, GLTF loading
and browser comparisons are complete. Required reference
`references/MAO-FLOOR02-APPROVED.png` is absent. It could not be opened, and no
claim of matching the approved image is made. A path was requested from the user.

## Model production

- Ergonomic chair: deformed curved shell and upholstery, lumbar support,
  shaped seat/headrest, tilt mechanism/lever, piston, five arms and paired casters.
- Desk: extruded rounded oak top with two actual through-holes, grommets, tubular
  steel frame, cable basket, mat, hollow handled mug/coffee, documents and tray.
- Monitors: thinner housings, correctly raised feet/stands, subdued UI geometry.
  Keys use tapered individual caps; the existing mouse remains compatible.
- Lounge: forest-green shaped cushions, rolled arms, back cushions, piping,
  terracotta lounge chair with a soft curved back and splayed wooden legs.
  Round oak coffee table has a beveled edge, three legs and books/ceramics.
- Lighting/decor: hollow lathed lamp shades, ribbed planters, curved volumetric
  leaves, rug fringe, shelf storage, framed wooden drawers and new wall sconce.
- Architecture: oak sill apron/brackets, glass door hinges/kickplate, curved
  meeting-chair upholstery. Existing meeting table and character states remain.
- Elevator: graphite outer jambs/bronze trims, door inlay seams, call-button bezel,
  visible 3D `02` indicator and floor sign. Door names, local transforms, extras,
  pivots and opening animation endpoints remain unchanged.

The first render showed a hard lounge back and mirrored digits (`50`). The
second iteration added the padded back, pillow piping, round-table bevel and
corrected front-facing `02`. The final optimization replaced invisible rounded
screen-line bevels and high-tessellation keys with cheaper geometry, and reduced
fringe repeats. These were actual geometry edits, not color-only substitutions.

## IDs and budget

All 74 baseline IDs retained; total 79 IDs / 48 models. New IDs:

- `decor.wall.sconce`
- `material.fabric-forest`
- `material.fabric-clay`
- `texture.fabric-forest`
- `texture.fabric-clay`

Pack size: 1,213,908 -> 1,559,768 bytes (1.49 MiB), below the 2 MiB art budget.
116 mesh definitions, 234 nodes, 20 materials. Source meshes/indices are hashed
and reused, and static parts are merged per material. New material variants share
one woven SVG image. No runtime format, dependencies or renderer files changed.

Actual full-floor counters at 1366x900 DPR 1, same scene/lighting, before/after:

| Counter | GFX-28 | Optimized GFX-29 |
|---|---:|---:|
| Draw calls | 435 | 440 |
| Rendered triangles, including shadow passes | 180,128 | 171,100 |
| Resident geometries | 115 | 120 |
| Textures | 11 | 12 |

The unoptimized second iteration had 231,132 rendered triangles. Final vertex
budget was reduced while preserving the new silhouettes. These counters are
software-WebGL measurements, not Iris Xe FPS claims.

## Artifacts

- `public/office-art/studio-29/before/`: preserved GFX-28 pack and library.
- `studio-29/iteration-1/premium-contact-sheet.png`: actual first art iteration.
- `studio-29/premium-contact-sheet.png`: final eight-pair GFX-28/GFX-29 sheet.
- `studio-29/floor02-before.png`, `floor02-premium.png`: real game-camera captures.
- JSON files alongside the PNGs contain actual renderer counters.
- `studio-29/interaction/`: real interaction runner captures and lighting metrics.

Both sides of the contact sheet use identical lighting, exposure and per-pair
framing. The baseline is GFX-28, not the missing approved reference. Full-floor
captures use the existing current OfficeScene3D, with old/new packs served by
isolated middleware. No screenshots are substituted for the live scene.

## Verification and limitations

Art tests parse real GLB via GLTFLoader, check all 74 old IDs, actual tabletop
hole raycasts, unit normals/index bounds, material contracts, exact door pivots,
animation sampler lengths, cloning and shared-resource disposal. The dedicated
interaction runner is copied from the existing office-3d runner but writes only
inside office-art; it uses the real scene, pointers, GLB and raycaster.

Run from repository root:

```sh
node apps/office/src/office-art/generate-assets.mjs
node apps/office/src/office-art/preview-check.mjs
node apps/office/src/office-art/interaction-check.mjs
```

Run tests/typecheck from apps/office. No Blender or new packages were installed.

Approved-reference matching remains blocked by the missing PNG. Materials are
stylized PBR with lightweight woven color detail, not scanned fabrics or heavy
normal maps. People are retained from GFX-28. Newly prepared wall sconces are
not auto-placed; room composition/lighting belongs to other file owners. The
refined pack has not been manually checked on Firefox/Iris Xe hardware.

## Changed files

Source: `generate-assets.mjs`, `studio-models.mjs`, `studio-geometry.mjs`,
`asset-preview.ts`, `preview-check.mjs`, `interaction-check.mjs`,
`studio-assets.test.ts`, `README.md`, `STUDIO-29-REPORT.md`.

Generated: GLB/manifest/materials/SVG textures under `public/office-art/v1`, and
preserved baselines, screenshots and metrics under `public/office-art/studio-29`.
