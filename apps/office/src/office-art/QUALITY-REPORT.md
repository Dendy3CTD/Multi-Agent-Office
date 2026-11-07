# MAO-GFX-28 asset quality evidence

## Baseline

Old pack: 268,552 bytes, 156 mesh definitions, 193 nodes, 38 model IDs / 63 total
IDs. Furniture consisted primarily of rigid boxes. Cylinders were uncapped,
characters had oversized sphere heads, no neck and straight limbs. Shelf books
were largely hidden inside a solid case. The embedded elevator animation used
an output accessor of four values for two input keys and one shared sampler.

## Authored changes

- Desks: bevels, cylindrical frame, feet, cable tray, mat, notebook and mug.
- Office chairs: lumbar shell/ribs, headrest, arms, five-spoke base and casters.
- Displays/input: bevels, screen code lines, individual keys and shaped mouse.
- Lounge: rounded seats, separate cushions, pillows, wooden plinths and tables.
- Shelving: open construction, individual colored books, drawers and handles.
- Meeting: glass tabletop, bronze beam, diagonal legs, upholstered chairs.
- Lights/plants: closed shades, articulated arms, emissive diffusers, tapered
  ceramic planters, soil, nine stems and shaped leaves.
- Architecture: full window perimeter, mullion, sill/handle, glass rails, skirting,
  relief wall art and a reusable glass office door (`door.office.glass`).
- Elevator: beveled bronze panels with graphite inlays, call-panel surround,
  frame trim, cabin handrail; original animated node names/pivots retained.
- People: neck, proportionate head/nose/ears, hair/fringe/bun, collar, pelvis,
  bent arms/hands, seated thighs, shins/shoes. Three styles per state use shared
  geometry and varied clothes/skin; state and employee identities remain intact.

## Size and render cost

New pack: 1,213,908 bytes (1.16 MiB), 109 mesh definitions, 226 nodes,
47 model IDs / 74 total IDs. All 63 original IDs remain.

Full Floor 02, same current renderer, 1366×900, DPR 1, Chromium software WebGL:

| renderer.info measurement | Before | After |
|---|---:|---:|
| draw calls | 516 | 384 |
| rendered triangles (including render/shadow passes) | 7,680 | 168,112 |
| resident geometries | 133 | 109 |
| textures | 10 | 10 |

The pack is about 4.5× larger, geometry detail is substantially higher, and draw
calls decrease about 26%. These counts do not establish FPS on Intel Iris Xe.
No postprocessing, new dependency or texture atlas download was added.

## Acceptance artifacts

- `public/office-art/comparison/premium-contact-sheet.png`: same lighting and
  camera direction for actual old/new production models; eight labeled pairs.
- `floor02-before.png` / `floor02-premium.png`: current full scene with old/new
  packs, without changing scene or UI code.
- `preview-metrics.json`, `floor02-before-metrics.json`, `floor02-metrics.json`:
  actual renderer measurements, not predicted counts.
- `comparison/before/`: preserved original pack/material/texture/manifest snapshot.

Real GLTFLoader parses the new pack; tests validate IDs, animation sampler
sizes, normals, bounds/index ranges, geometry budget, runtime cloning and styles.
The existing real-WebGL interaction runner passes all 22 checks on the new pack,
including door/panel clicks, animation, employee selection and the Tower floor
round trip. Firefox and Iris Xe were not re-tested after the asset upgrade.

## Remaining art work

This is a materially richer stylized game pack, not photorealistic furniture or
production character rigging. People remain static seated models (no skeletal
animation/facial expressions). Styles are tied to placement, not stored portraits.
Textures remain lightweight SVG color detail rather than normal/roughness maps.

Room dressing, wall openings aligned to windows, camera composition, character
chair-to-desk spacing and broader lighting refinement belong to scene/layout
integration. The full-floor capture still shows sparse zones; that is not solved
by this asset-only change. The glass office door is prepared but not automatically
placed. Legacy `preview.*` schematic compositions are retained for compatibility.

## Changed source/artifact files

Source: `generate-assets.mjs`, `premium-models.mjs`, `loader.ts`, `materials.ts`,
`asset-manifest.test.ts`, `premium-assets.test.ts`, `asset-preview.ts`,
`preview-check.mjs`, `README.md`, `QUALITY-REPORT.md`.

Generated production files: `public/office-art/v1/office-pack.glb`,
`manifest.json`, `materials.json`, `textures/*.svg`.

Evidence: original files copied into `public/office-art/comparison/before/`,
three PNG screenshots and three JSON metric reports in `comparison/`.
All edits are confined to the authorized office-art directories. No changes to
scene/layout/UI, dependencies or lockfile were made for this task.
