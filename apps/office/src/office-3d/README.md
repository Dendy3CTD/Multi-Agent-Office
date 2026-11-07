# Three.js scene lifecycle and interaction

`OfficeScene3D` owns one WebGLRenderer per mounted component. React StrictMode
may create/dispose its probe instance; after that replay only one canvas remains.
Callbacks and metrics use refs. Employee updates reconcile GLB characters by
employee ID, desk ID and visual status. Equivalent array identities do not rebuild
the renderer. A semantic manifest key sorts record entries; a genuine config
change replaces scene content/listeners and reloads assets, retaining the renderer.

All requested asset placements and initial character reconciliation must finish
before the first complete render can report `ready`. Failures report `error`;
a 30 second deadline prevents indefinite loading. Procedural geometry stays
hidden during startup. Disposed scenes cannot report status. Pending asset work
is drained before shared runtime resources are released. Renderer disposal and
context loss happen only on actual unmount/retry.

Picking updates world/camera matrices and selects the nearest visible mesh.
Hidden fallback meshes are excluded. The old broad transparent elevator box and
unconditional elevator intersection priority were removed: furniture and
employees cannot be selected through, or redirected to, the elevator. Doors and
call-panel GLB instances carry semantic ownership. Their actual visible surfaces
are the hit areas. The native canvas pointerup handler dispatches one callback
only for a matching, non-drag pointer sequence.

Visible nodes `elevatordoorsleft` and `elevatordoorsright` animate from saved local
X coordinates (-0.54/+0.54 in the current pack) by -0.95/+0.95. Parent transforms,
Y/Z, scale and rotation are preserved. Closing restores the exact base X;
new instances after remount start from the GLB transforms. Animation converges
and stops scheduling RAF. Hover draws an outline with raycasting disabled.

## Verification

```sh
node apps/office/src/office-3d/scene.browser-check.mjs
cd apps/office
./node_modules/.bin/vitest run --no-cache
./node_modules/.bin/tsc --noEmit --incremental false
npm run build
```

The browser runner uses installed Chromium with software WebGL and real GLB
loading. No scene module, renderer, intersection or callback is replaced. It
projects actual visible meshes to canvas coordinates and uses CDP mouse input,
which generates browser pointer events. It tests doors/panel, exact callback
counts, pan suppression, employee/furniture picking, actual renderer identity,
Directory updates, GLB transforms, idle RAF, StrictMode/remount, status failures,
hover, wheel, and the actual MAOTower menu/floor round trip.

The opt-in dev event `mao-3d-inspect` on the mount element exposes runtime objects
to a callback in its CustomEvent detail only with `?debug=1`. It has no production
behavior and is used to inspect real objects, not substitute intersections.

Firefox/Debian physical touchpad behavior and the reported pre-document reload
flash still require manual verification. Chromium software WebGL is not proof
of Firefox GPU/compositor behavior or historical flash causation.

## GFX-28R built interior

`interior.ts` assembles GLB scenery from the existing showroomLayout windows and
meeting/rest room bounds. It does not create desks, identities or a second seat
layout. Workstation positions and elevator pivots remain unchanged.

The north wall is split into seven masonry segments around two 3.84 m wide
apertures at X -4.4/+4.4, Y 1.05–4.4, wall Z 7. Scaled window.frame instances
provide glazing, graphite mullions and oak sills. No full-width opaque north slab
is loaded into the visible art root. Skyline geometry lies outside the facade
at Z 7.6; a pale sky at Z 7.95 stays below the top of the cutaway wall. Two
non-shadowed daylight fill lights sit inside the apertures.

The meeting room uses existing bounds X 4.2–9.8, Z -2.5–0.7. Three full glazed
sides plus a fixed front pane and door.office.glass enclose table.meeting,
four chair.meeting instances, rug, pendant and a plant/decor panel. Clear glass
does not cast opaque shadows and transmits pointer selection; metal frames
retain normal picking. No workstation or elevator semantic owner is changed.

The lounge is based on the existing rest-room centre (-7.7, -4.6): sofa
(-7.6, -5.6), armchair (-9.25, -4.25), coffee table (-7.85, -4.55), floor lamp
(-9.6, -5.6) and two plants. Rugs are at Y .13, above the .12 m GLB floor.
The approach to the elevator at (-5.4, -2.9) remains clear. All furniture bounds
are checked against the 22×14 floor and desk rectangles using actual GLB geometry.

Fit Floor and Reset derive the orthographic span from room corners at the
original isometric orientation. The 3D-specific CSS constrains the canvas to the
visible viewport: a tall right rail/intrinsic canvas size can no longer stretch
it below the screen. Pan/zoom bounds and the DPR cap are preserved.

Run `node apps/office/src/office-3d/scene.browser-check.mjs` to exercise the real
scene, verify exterior rays through both windows, and capture:

- `screenshots/floor02-1366x768.png`
- `screenshots/floor02-1920x1080.png`
- `screenshots/windows-closeup.png`
- `screenshots/meeting-closeup.png`

These are actual GLB/WebGL captures. Close-ups use the dev inspector to pose the
real camera; the full-floor shots use the production Fit Floor event. Compare
with `public/office-art/comparison/floor02-premium.png` from the asset-only stage.
The new interior tests verify aperture area, enclosure parts and transformed
GLB furniture bounds/clearance. No packages or files outside office-3d are edited.

## GFX-28S lighting comfort

Lighting is authored in `lighting.ts` and applied only in OfficeScene3D. The pack,
material library, layout and UI files are unchanged. The baseline used warm
hemisphere intensity 2.7, warm sun 3.4, two window fills at 8, a global orange
point at 7, teal fill at 2.5 and exposure 1.08. These contributions and pale beige
background compressed bright oak highlights into a yellow-beige wash. Hidden
procedural fallback lamps are not part of the active GLB lighting sum.

Final scheme: neutral hemisphere 2.0, neutral sun 1.75, window fills 3.5, weak fill
.8, local lounge/meeting warm accents 3/4 (limited ranges), reduced skyline glow.
ACES and sRGB output remain; exposure is 1.0. The single PCFSoft shadow map remains
1024². Normal bias .025 and depth bias -.00015 reduce contact artifacts. The shadow
projection is explicitly updated after setting bounds; a browser assertion checks
all four floor corners, avoiding the former default ±5 m shadow projection. Softer
contrast comes from the fill/key balance, without new shadow maps or post FX.

`ScenePalette` clones/reuses materials per scene/source and keeps cached GLB
materials/maps intact. Floor oak loses excess red/yellow, walls become cream-grey,
brick less orange, metal/bronze less mirror-like. Skin, monitor colors and glass
opacity/sidedness are preserved; lamp emission is moderated, not removed. A
single cloned oak map in NoColorSpace provides subtle .006 m bump detail on the
floor. Color maps retain SRGBColorSpace. This is lightweight height modulation
from the existing tile, not a newly authored normal map.

Overrides run after initial asynchronous material work settles, so shared runtime
textures are present before cloning. The operation is idempotent. Owned materials
and the bump texture are disposed after pending loads drain; shared color maps
remain owned by OfficeArtRuntime. No new continuous RAF loop is introduced.

Before captures (from the identical GFX-28R runner cameras) are preserved under
`screenshots/lighting-before/`. Current after captures use the same viewport,
Fit Floor and close-up poses: `floor02-1366x768.png`, `floor02-1920x1080.png`,
`meeting-closeup.png` (floor/glass/furniture) and `windows-closeup.png`.
`lighting-metrics.json` records actual renderer counters and map/exposure checks.
The browser regression asserts that the oak color texture and linear bump data
survive runtime material replacement. Unit tests verify ownership/disposal,
repeat application, transparency and retained monitor/skin colors.

Performance changes: no new geometry, one additional non-shadowed point light
relative to the previous rig, one additional small bump texture and floor texture
sampling. Shadow map count/resolution and DPR cap 1.5 are unchanged. Software
WebGL captures establish appearance and interaction, not FPS on Intel Iris Xe.
Firefox/Iris Xe comfort and performance require a manual pass on the target.
