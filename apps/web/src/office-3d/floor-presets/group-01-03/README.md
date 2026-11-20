# Floor design presets · public floors 01–03

These are layout records, not screenshots or renderer edits. They use the
existing `FloorLayout` engine and authored asset IDs from
`/office-art/v1/manifest.json`.

## Floor identity and roster

The public tower directory is the source of displayed floor numbers:

| Public floor | Current department / role | World floor ID | Employees | Seats |
| --- | --- | --- | ---: | ---: |
| `floor-01` | Руководство и управление проектами | `floor-2` | 11 | 12 |
| `floor-02` | Разработка ПО | `floor-3` | 10 | 11 |
| `floor-03` | Тестирование и контроль качества | `floor-4` | 9 | 11 |

Lobby is the separate public `floor-00`, backed by world `floor-1`; it is not
one of these three department floors. `world/floorData.ts` uses a different
internal numbering scheme, so integrations must match both `uiFloorId` and
`worldFloorId`, never infer identity from the number alone.

Each preset builds its employee assignments and original desk IDs from
`createDemoEmployees()` / `buildDesks()`. Empty capacity remains explicitly
reserved: one seat on floors 01 and 02, two on floor 03. No employee or desk
identity is regenerated here.

## Isolated preset contract

The shared `FloorDesignPreset` contract was not present in this checkout. This
folder defines a small versioned contract in `schema.ts` without changing the
renderer or shared layout types:

- `layout`: existing `FloorLayout`, in metres on a local 22 × 14 m X/Z plane.
- `floor`: explicit public and world IDs plus the existing department ID.
- `zones`: authored programme regions and floor finishes.
- `workstation`: existing desk/chair manifest assets.
- `furniture`: manifest asset ID, local position, mount point and optional
  floor footprint; desk-top props retain their host `deskId`.
- `lighting`: fixture positions, target, tint, intensity hint and colour
  temperature.
- `palette`: named hex values for the integration material adapter.

Renderer integration should centre local positions with the same transform used
by showroom (`x - 11`, `z - 7`), place `layout` desks/chairs from the existing
geometry, then load each furniture `assetId` from the office-art manifest.
Mounted items need their stated mount; do not collision-test a monitor as a
floor object. Map the named palette values to the renderer's material system.
The current scene accepts a `visualProfile` string but does not yet consume a
full floor preset; connecting these records requires an adapter in the renderer
owner's files.

## Design intent

The shared loft shell remains quiet: oak, warm plaster and blackened metal.
Each floor gets a different spatial rhythm and accent rather than a repeated
showroom grid:

- **01 / management:** central visitor spine, walnut leadership room, glazed
  boardroom, small lounge and three 4-seat management rows.
- **02 / software:** six-seat pairing bank facing a staggered five-seat focus
  bank, service bench, review room and a contained focus booth.
- **03 / QA:** split left/right test banks around a north-south lab aisle, with
  a separate three-seat triage belt, test bench and defect review room.

## Verification

From the workspace root:

```bash
node --test apps/web/src/office-3d/floor-presets/group-01-03/floor-presets.test.mjs
corepack pnpm --filter @mao-hybrid/web typecheck
corepack pnpm --filter @mao-hybrid/web build
```

The regression test checks the authoritative roster and desk IDs, engine
geometry validation, furniture bounds/collisions, aisle clearance, manifest
asset IDs, and that all three room programmes differ.
