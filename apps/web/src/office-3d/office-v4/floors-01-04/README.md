# Office V4 — UI floors 01–04

Data-only floor presets following `office-v4/CONTRACT.md` and
`office-v4/REFERENCE-MAP.md`. They are not registered here; the shared registry
owner integrates `FLOOR_01_TO_04_PRESETS`.

| UI floor | Logical `floorId` | World route | `specialization` | Directory employees / workplaces |
| --- | --- | --- | --- | ---: |
| 01 Lobby & Reception | `floor-00` | `floor-1` | `lobby-reception` | 0 / 2 unassigned lobby stations |
| 02 Management | `floor-01` | `floor-2` | `management` | 11 / 12 |
| 03 Software Development | `floor-02` | `floor-3` | `software-development` | 10 / 11 |
| 04 Quality Assurance | `floor-03` | `floor-4` | `quality-assurance` | 9 / 11 |

Employee IDs come from the current MAO company catalog. Department desk IDs use
the current live office adapter and are checked against `buildDesks()`. The two
lobby positions remain unassigned; guest seats and waiting furniture are
separate from staff identity.

Run the authoring checks from the workspace root:

```bash
node --test apps/web/src/office-3d/office-v4/floors-01-04/floors-01-04.test.mjs
corepack pnpm --filter @mao-hybrid/web typecheck
```

The test checks mapping, employee and desk identity, capacity, shared geometry
validation, asset registration, collisions and connected accessible routes.
Visual matching still requires the V4 browser integration render.
