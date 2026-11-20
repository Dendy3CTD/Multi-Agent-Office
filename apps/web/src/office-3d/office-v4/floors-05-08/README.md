# Office V4 floors 05–08

This folder exports `createOfficeV4Presets(employees, desks, options?)`. It
returns four data-only `FloorDesignPreset` values for the shared
`OfficeScene3D` renderer:

| UI floor | Logical `floorId` | Current world route | Department | Employees / seats |
|---|---|---|---|---:|
| 05 | `floor-04` | `floor-5` | `engineering-electronics` | 10 / 10 |
| 06 | `floor-05` | `floor-6` | `cad-3d` | 9 / 10 |
| 07 | `floor-06` | `floor-7` | `research-analytics` | 10 / 10 |
| 08 | `floor-07` | `floor-8` | `documentation` | 9 / 10 |

Pass the existing Directory snapshot as `WorldEmployee[]` and `DeskObject[]`.
Employee IDs, department IDs, desk IDs, and occupied-seat bindings are copied
from those records. `specialization` is the preset's department key. Current
canonical desk IDs (`desk-floor-N-NN`) map to authored positions directly. If
the Directory uses another desk-ID format, pass an explicit 1-based
`ReadonlyMap<deskId, slot>` as `{ deskSlotById }`; the factory rejects missing,
duplicate, or out-of-range mappings rather than inferring positions from
array order.

Integration example:

```ts
import { createOfficeV4Presets } from './office-v4/floors-05-08'

const presets = createOfficeV4Presets(directoryEmployees, directoryDesks, {
  deskSlotById: explicitDeskSlotBindings,
})
for (const preset of presets) registerFloorDesignPreset(preset)
```

The logical-to-world conversion remains owned by
`office-v4/floor-id-adapter.ts`. These presets do not register themselves or
create a renderer. Geometry and procedural model checks:

```bash
node --test apps/web/src/office-3d/office-v4/floors-05-08/floor-presets.test.mjs
```

The reference images are review metadata only. A browser render is still
required for visual acceptance.
