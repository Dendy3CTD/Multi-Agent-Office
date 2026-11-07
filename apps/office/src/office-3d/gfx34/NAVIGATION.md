# GFX35 navigation handoff

Use `buildNavigationCatalog(layout, artRoot, architecture, polish.solidBounds, floorY)` after acquiring and placing furniture. It reads the current `showroomLayout()` and actual chair geometry. Do not copy the recorded JSON back into the layout.

The JSON example is `screenshots/final-navigation.json`. Coordinates are Y-up world metres. `chair`, `desk`, meeting/lounging `seat` points are floor anchors, not hip bone transforms; they are occupied furniture and are not walkable destinations. Desk `stand`, meeting `approach`, `walkPoints`, and `routes` are the tested walk targets. Routes use stable desk IDs. Occupancy is refreshed from current employees during reconciliation.

`ready` means static radius-0.27 m, grid-0.12 m reachability with architecture/workplace/known pot and console footprints. GFX35 must still implement swept collision, turning/capsule clearance, reservations, dynamic avoidance, correct standing/sitting rig offsets, and path refreshing after furniture changes. Do not run the static flood fill per frame. No locomotion engine or extra animation loop is added here.

Meeting entry: (3.65, -2.95), interior (5.5, -2.6). Lounge entry: (-6.2, -5.9). Lift approach: (-8.9, 3), waiting: (-8.1, 3). The meeting glass leaf is statically open outward around the west entrance hinge; both entrance and four chair approaches were tested against the real GLB footprints.
