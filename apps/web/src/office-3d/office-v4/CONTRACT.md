# Office V4 Floor Authoring Contract

Office V4 presets are data-only inputs to the existing
`FloorDesignPreset`/`OfficeScene3D` pipeline. They do not define a React view,
Three.js scene, employee list, or second renderer. Shared geometry, materials,
interaction, directory identity, camera controls, and scene lifetime remain
owned by the common office engine.

## Source of truth and coordinate system

- Import `FloorDesignPreset` and its placement types from
  `../floor-presets/types`.
- Keep `schemaVersion: 1`; any V4-only fields added by the lead integrator are
  optional and backward compatible with existing v1 presets.
- Coordinates are metres, X east and Z north, origin at the southwest floor
  corner, Y up. For the approved 22 × 14 m plan, convert source coordinates
  only in an adapter with `xScene = xPlan - 11` and `zScene = zPlan - 7`.
- Use the logical floor mapping from `REFERENCE-MAP.md`. The shared registry
  translates logical floor IDs to current MAO world route IDs.
- Keep employee IDs, department IDs and desk IDs exactly as supplied by the
  directory. Never infer identity from a display name or array order.

## Required existing fields

Each preset implements all required `FloorDesignPreset` fields:

- `floorId`, `presetId`, `theme`: stable IDs and one existing theme value.
- Office V4 presets must also set `specialization` so the shared registry can
  distinguish logical `floor-00`…`floor-14` IDs from overlapping legacy world
  IDs such as `floor-13`.
- `bounds`: positive width, depth and wall height.
- `zones[]`: `{ id, kind, bounds, label?, material? }`. Use circulation zones
  and `aisles[]` to keep continuous accessible routes clear.
- `rooms[]`: `{ id, kind, bounds, capacity?, privacy?, material? }`. Use
  `privacy: 'glass' | 'solid' | 'open'` to describe the room boundary.
- `barriers[]`: `{ id, kind, x, z, length, height, rotationY, material,
  doorWidth? }`. A centered `doorWidth` creates a clear opening.
- `windows[]`: `{ id, wall, offset, width, sill, height, frameMaterial }`.
- `entrances[]`: `{ id, wall, offset, width, kind }` where kind is `door`,
  `elevator`, or `open`.
- `materials`: semantic role IDs or hex colors. Prefer existing local art
  manifest materials and textures; do not embed or duplicate texture data.
- `lighting`: `exposure`, `ambient`, `key`, `fill`, `keyIntensity`, and
  `fillIntensity`.
- `furniture[]` and `decor[]`: placements with a valid shared `asset` ID,
  stable placement `id`, position, optional rotation/scale/footprint, and
  optional employee/desk identity when the placed prop is part of a real
  workstation.
- `workplaces[]`: every desk position supplied by the real floor layout,
  including unoccupied reserve desks. Keep stable `id` and the real `deskId`
  association through the directory adapter.
- `aisles[]`: rectangles kept free from desks, chairs, and large props.
- `camera`: position, target, zoom, minZoom and maxZoom, calibrated to the
  isometric cutaway composition in the references.

## Shared visual and specialized asset IDs

Use the existing manifest IDs where they fit (for example `desk.modern`,
`chair.ergonomic`, `monitor.dual`, `table.meeting`, `partition.glass`,
`bookshelf`, `sofa.cozy`, `plant.potted`, and `window.frame`). Specialized
furniture must use the following shared IDs or an existing manifest asset; do
not add group-specific renderer code or edit another group's files:

- worktops: `desk.reception`, `desk.lab`, `desk.cad`, `desk.standing`,
  `desk.focus`;
- test and compute equipment: `equipment.oscilloscope`,
  `equipment.test-bench`, `equipment.3d-printer`,
  `equipment.server-rack`, `equipment.network-rack`,
  `equipment.analytics-display`, `equipment.security-console`,
  `equipment.whiteboard-display`, `equipment.graphics-tablet`,
  `equipment.qa-device-wall`, `equipment.archive-shelf`;
- reception and cafe: `equipment.espresso-machine`,
  `equipment.cafe-counter`, `furniture.cafe-table`, `furniture.banquette`,
  `furniture.kiosk`;
- collaboration and leisure: `furniture.pool-table`, `furniture.foosball`,
  `furniture.acoustic-focus-pod`, `furniture.whiteboard`,
  `furniture.moodboard`.

These IDs resolve to assembled, shared procedural models in the common office
art library; they are not generated per floor. Do not use a plain cube as a
substitute for a recognizable specialist item.

## V4-compatible optional data extensions

The lead integrator may add these optional fields to the shared preset types;
authors must not redeclare them locally:

- `specialization?: string` — department/use identifier from the V4 map; the
  renderer creates a wall plaque and exposes the key in scene metadata.
- `referenceImage?: string` — reference path for review metadata only; never
  loaded or rendered as scene content.
- `rooms[].door?: { wall, offset, width, kind }` — non-centered/custom room
  opening; omitted values retain the current centered south opening.
- `workplaces[].employeeId?: string` and `deskId?: string` — explicit bindings
  to existing directory identity; a missing `employeeId` means reserve/free.
- `workplaces[].kind?: 'standard' | 'focus' | 'lab' | 'cad' | 'standing'` and
  `equipment?: readonly string[]` — choose a desk profile and attach
  registered specialist equipment without changing the employee record.
- `furniture[].interaction?: { kind, targetId? }` — opt-in semantic
  interaction such as `screen`, `door`, `display`, or `equipment`; it does not
  make a generic prop clickable by default.
- `lighting.fixtures?: readonly { id, kind, x, y, z, color, intensity,
  distance?, angle?, target? }[]` — local warm fixtures. Shared quality
  settings cap shadow and light cost.
- `materials` may name a registered shared material/texture profile. Palette
  and PBR parameters remain global; floors may select, not redefine, them.

Optional scene fields are rendered by the shared renderer when present.
`referenceImage` is deliberately review-only and is never loaded into Three.js.
A missing field preserves existing v1 behavior. Unknown asset IDs fail the
scene's authored-asset loading check instead of silently becoming a generic
placeholder; an unavailable preset remains visibly marked as incomplete.

## Layout, capacity, and authorship checks

- Match actual department membership and available `deskId` values from the
  company catalog. Never add employees to fill a reference image.
- Workplace count must meet assigned employees and may include explicitly
  identified reserves. Reserve positions have no employee binding.
- Keep major furniture footprints inside `bounds`, out of room door swings,
  and outside marked circulation. Keep required door clear widths and access
  paths.
- Use `validateFloorDesignPreset` and the shared overlap/capacity checks before
  registering a preset. A floor is integrated only after its authored preset
  renders in a real browser scene and the rendered employee IDs match the
  directory.
- Keep the approved loft material language consistent across floors; use
  restrained department accents for specialist equipment and signage.

## Minimal example

```ts
import type { FloorDesignPreset } from '../floor-presets/types'

export const example: FloorDesignPreset = {
  schemaVersion: 1,
  floorId: 'floor-02',
  presetId: 'software-development-v4',
  theme: 'studio',
  bounds: { width: 22, depth: 14, height: 5.2 },
  zones: [
    { id: 'dev-pods', kind: 'work', bounds: { x: 1, z: 3, width: 14, depth: 9 }, label: 'Development' },
    { id: 'main-aisle', kind: 'circulation', bounds: { x: 1, z: 1.1, width: 20, depth: 1 } },
  ],
  rooms: [{ id: 'team-room', kind: 'meeting', bounds: { x: 1, z: 1, width: 5, depth: 4 }, privacy: 'glass', capacity: 6 }],
  barriers: [],
  windows: [{ id: 'north-window', wall: 'north', offset: 2, width: 17, sill: 1.05, height: 2.8, frameMaterial: 'graphite-metal' }],
  entrances: [{ id: 'lift-entry', wall: 'south', offset: 19, width: 1.4, kind: 'elevator' }],
  materials: { floor: 'oak-floor', wall: 'warm-plaster', featureWall: 'warm-brick', trim: 'graphite-metal', textile: 'sage-fabric' },
  lighting: { exposure: 1.08, ambient: '#e4edf4', key: '#fff2df', fill: '#d8e8f2', keyIntensity: 2.2, fillIntensity: 0.8 },
  furniture: [{ id: 'huddle-table', asset: 'table.meeting', x: 17, z: 4 }],
  decor: [{ id: 'lounge-plant', asset: 'plant.potted', x: 20, z: 11 }],
  workplaces: [{ id: 'reserve-01', x: 7, z: 7, width: 1.5, depth: 1.3 }],
  aisles: [{ x: 1, z: 1.1, width: 20, depth: 1 }],
  camera: { position: [19, 17, -23], target: [0, 1.4, 0], zoom: 1, minZoom: 0.72, maxZoom: 1.8 },
}
```

The example is a schema illustration, not an authored employee layout. Group
authors should ship real floor data in their assigned folder and leave the
shared registry and renderer to the lead integrator.
