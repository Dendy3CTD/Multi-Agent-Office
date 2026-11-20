# Floor design preset contract

The scene engine owns rendering, asset acquisition, employee identity, and
navigation. Floor presets are data-only modules; do not add renderer or React
components per floor. Coordinates are metres, origin is the south-west floor
corner, X east, Z north, Y up. `rotationY` is radians. Asset IDs must exist in
`public/office-art/v1/manifest.json` or in the shared procedural asset registry.

## Type and accepted fields

Import `FloorDesignPreset` from `./types`. Furniture/decor assets must use one of the `FloorPresetAsset` IDs in that file; those IDs are checked against the shared office art pack at render time.

- `schemaVersion`: literal `1`.
- `floorId`, `presetId`: stable non-empty identifiers.
- `theme`: `showroom | studio | industrial | library | atrium | custom`.
- `bounds`: positive finite `width`, `depth`, `height` in metres.
- `zones[]`: `{ id, kind, bounds, label?, material? }`; kind is `work | meeting | focus | lounge | service | reception | circulation`. `material` optionally selects the inlay finish.
- `rooms[]`: `{ id, kind, bounds, capacity?, privacy?, material? }`; kind is `meeting | leadership | focus | lounge | service | reception`. `privacy` can be `glass | solid | open`; a glass room uses translucent walls. `material` optionally selects its wall finish.
- `barriers[]`: `{ id, kind, x, z, length, height, rotationY, material, doorWidth? }`; kind is `wall | glass | railing`.
- `windows[]`: `{ id, wall, offset, width, sill, height, frameMaterial }`; wall is `north | south | east | west`.
- `entrances[]`: `{ id, wall, offset, width, kind }`; kind is `door | elevator | open`.
- `materials`: named semantic roles mapped to shared material/texture IDs or `#RRGGBB` palette colors; no duplicated texture payloads. The current renderer consumes `floor`, `wall`, `featureWall`, `glazing`, `trim`, `desk`, and `textile`; unknown roles are retained for later extensions. Named values resolve against the shared art palette (oak/wood, walnut, plaster/sand, glass, graphite/metal, sage/fabric, bronze); direct hex colors tint the same role-selected shared texture.
- `lighting`: `{ exposure, ambient, key, fill, keyIntensity, fillIntensity }`.
- `furniture[]`, `decor[]`: placements `{ id, asset, x, z, y?, rotationY?, scale?, footprint?, employeeId?, deskId? }`. Asset IDs are restricted to the `FloorPresetAsset` union in `types.ts`. `y` is the height above the floor (used by desktop, wall and ceiling mounts); `footprint` supplies a more accurate floor rectangle for placement validation.
- `workplaces[]`: `{ id, x, z, rotationY?, width?, depth? }`. The adapter binds each seat to the employee's real `employeeId` and `deskId`; preset IDs are never substitutes for directory IDs.
- `aisles[]`: rectangles `{ x, z, width, depth }`; keep them free of workplace/chair clearance.
- `camera`: `{ position:[x,y,z], target:[x,y,z], zoom, minZoom, maxZoom }`.

## Rendering and placement semantics

- The authored `theme` selects the architectural accent trim; material role IDs
  select the PBR tint while preserving existing shared texture maps.
- Exterior walls are segmented around declared openings. Window offsets and
  entrance offsets are measured from the west/south endpoint of the named wall;
  north/south walls use X as their axis and east/west walls use Z.
- A `barrier` `(x,z)` is the start point of its centerline; it extends along
  local +X rotated by `rotationY`. `doorWidth` is a centered clear opening.
- Each `room` renders a wall ring with a centered 1.15 m south doorway because
  the v1 room shape has no door field. A future non-centered or custom room door
  can be added as a backwards-compatible optional `entrance` field.
- Aisles and zones are floor inlays; zones with labels include a small floor
  marker. Furniture and decor use shared manifest assets. A placement with a
  `deskId` matching a workplace reuses that employee workstation's desk, chair,
  or monitor to avoid duplicates; other placements render as individual assets.
- `bounds.height` sets exterior wall height; width/depth set the shared floor
  footprint and all contract geometry uses the south-west origin.
- `lighting` sets scene exposure, ambient/key/fill colors and light intensity;
  `camera` sets the initial camera and zoom limits. Balanced quality is default;
  `?quality=low|balanced|high` selects a render quality profile.

`validateFloorDesignPreset(preset, employeeCount)` checks duplicate IDs,
capacity, floor bounds, workplace overlap, aisle obstruction, and window/barrier
dimensions. A preset that fails validation is rejected; missing presets render
the explicitly marked showroom fallback while awaiting authoring.

## Example

```ts
import type { FloorDesignPreset } from './types'

export const floor04: FloorDesignPreset = {
  schemaVersion: 1,
  floorId: 'floor-5',
  presetId: 'electronics-lab-v1',
  theme: 'industrial',
  bounds: { width: 22, depth: 14, height: 5.8 },
  zones: [
    { id: 'bench-lab', kind: 'work', bounds: { x: 1, z: 1, width: 14, depth: 11 } },
    { id: 'briefing', kind: 'meeting', bounds: { x: 15, z: 7, width: 6, depth: 6 } },
    { id: 'aisle', kind: 'circulation', bounds: { x: 1, z: 6, width: 20, depth: 1 } },
  ],
  rooms: [{ id: 'briefing-room', kind: 'meeting', bounds: { x: 15, z: 7, width: 6, depth: 6 }, capacity: 6 }],
  barriers: [{ id: 'lab-glass', kind: 'glass', x: 14, z: 7, length: 6, height: 2.8, rotationY: 0, material: 'glass-tint', doorWidth: 1.2 }],
  windows: [{ id: 'north-window', wall: 'north', offset: 3, width: 12, sill: 1, height: 3, frameMaterial: 'graphite-metal' }],
  entrances: [{ id: 'lift', wall: 'south', offset: 19, width: 1.2, kind: 'elevator' }],
  materials: { floor: 'oak-floor', wall: 'warm-plaster', glazing: 'glass-tint', metal: 'graphite-metal' },
  lighting: { exposure: 1.08, ambient: '#e4edf4', key: '#fff6e8', fill: '#d8e8f2', keyIntensity: 2.45, fillIntensity: .85 },
  furniture: [{ id: 'bench-01', asset: 'desk.modern', x: 5, z: 3 }],
  decor: [{ id: 'plant-01', asset: 'plant.potted', x: 2, z: 12 }],
  workplaces: [
    { id: 'seat-a', x: 4, z: 3, width: 1.5, depth: 1.3 },
    { id: 'seat-b', x: 7, z: 3, width: 1.5, depth: 1.3 },
  ],
  aisles: [{ x: 1, z: 6, width: 20, depth: 1 }],
  camera: { position: [19, 20, -23], target: [0, 1.4, 0], zoom: 1, minZoom: .72, maxZoom: 1.8 },
}
```

Author one preset module per assigned floor range and register its exports in
the shared preset registry. A schema adapter can map local plan coordinates to
this contract without changing authored files. Keep preset files independent;
only the lead integrator changes the registry, renderer, and data adapters.
