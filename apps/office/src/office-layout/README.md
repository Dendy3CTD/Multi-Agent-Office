# Floor Layout Engine

This module is independent of the renderer and uses metres. `x` and `z` are
the horizontal floor plane, `y` is height, and `FloorSize.origin` is the
world-space lower-left origin. The default origin is `(0, 0, 0)`.

`createFloorLayout` accepts a floor id, dimensions, Directory-compatible
employee assignments, desk slots, room profile, and aisle parameters. It
never invents occupants: unassigned slots remain empty. Desk and employee
identity errors, floor mismatches, and insufficient capacity throw
`FloorLayoutError` before a partial layout is returned.

For production data, call `createOfficeFloorLayouts({ floors, employees,
deskSlots, departmentIds })`. The adapter validates one-to-one floor IDs,
preserves every supplied employee and desk ID, filters assignments by their
existing floor, and returns a `ReadonlyMap<floorId, FloorLayout>`. Empty or
`reserved` desk slots remain visible and unoccupied. `departmentIds` must be
the Directory snapshot; the adapter never creates or reassigns departments.

Supported profiles are `open-space`, `management`, `engineering`, `research`,
`design`, `infrastructure`, `archive`, `lobby`, `kitchen`, and `lounge`.
Department IDs remain external Directory data; profiles do not create
departments. The engine groups desks into six-seat neighbourhoods, reserves
rooms/service zones, leaves chair clearance, and emits entry/main/row aisles,
collision bounds, character spots, and camera targets.

Integration with Three.js is intentionally mechanical: pass `desk.position`,
`desk.orientation`, `chair.position`, and the returned collision rectangles to
the scene adapter. The engine does not import Three.js or the unfinished scene.
The renderer can use `floorBounds`, `focusTarget`, `collisionBounds`,
`desk.position`, `chair.position`, and `characterSpots` directly.

Every layout also includes four perimeter `walls`, wall-owned `windows`,
wall-owned `doors`, management `partitions`, and decorative `plants`. The
management profile reserves a leadership room, meeting room, and rest area;
the standard aisle validator treats touching rectangles as clear, while a
positive-area intersection is reported as `AISLE_DESK_OVERLAP`. This avoids a
false collision when a walkway terminates exactly at a desk clearance edge.

The management fixture uses a `22 × 14 m` floor, two centred six-desk groups,
one reserved seat, a solid leadership room, a glass meeting room, a lounge,
perimeter walls, a south entry, north windows, and plants placed outside the
walkways. All emitted positions are renderer-ready; no scene-specific offsets
are required.
