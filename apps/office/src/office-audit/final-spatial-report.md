# MAO-GFX-20 — synchronized 3D quality gate

Overall status: **WARNING**. The automated gate is synchronized with the current
Y-up renderer and authoritative showroom layout. This is not visual acceptance.

## Spatial checks

| Check | Result | Evidence |
| --- | --- | --- |
| GLB axis | PASS | Current `office-pack.glb` is inferred Y-up and the manifest declares right-handed Y-up metres. |
| Floor and bounds | PASS | The fixture uses the 22×14 m layout and checks all placed objects against centred floor bounds. |
| Workstations | PASS | 12 desks, 12 chairs, 11 occupied desks and one reserved desk come from `showroomLayout()`. |
| Walls/windows/partition | PASS | Wall, window and partition instances are checked against layout relationships, verticality and bounds. |
| Chair/character alignment | PASS | Chairs and character spots are sourced from layout records; no renderer-only offset is accepted. |
| Character model bounds | WARNING | The current GLB character bounds differ from manifest bounds; this is reported as `MODEL_BOUNDS_MISMATCH`, not hidden. |

## Art runtime and integration

- Manifest model nodes, GLB geometry, material library and explicit material
  mappings are validated from the current files.
- The renderer uses the public `OfficeArtRuntime` for manifest loading,
  instance creation, material application and instance/shared-resource cleanup.
- The audit no longer reports stale `SHARED_ART_RUNTIME_BYPASSED`, disposal,
  material-sharing or visibility-pause failures from the previous renderer.
- Asset scale is applied by the public runtime; the renderer supplies only
  composition fitting scales.

## Performance gate

- Offline GLB statistics are available and within the low-tier static budget.
- DPR is configured at a maximum of 1.5.
- Runtime draw calls, actual DPR sample, load time, GPU memory, disposal counts
  and hardware FPS were not supplied. The runtime section therefore remains
  **WARNING / NOT MEASURED**; no FPS or Intel Iris Xe claim is made.

## Remaining warnings

1. The manifest does not declare a model forward axis, so asymmetric model
   orientation is not fully provable (`MODEL_FORWARD_AXIS_UNDECLARED`).
2. Runtime metrics require a real browser session (`RUNTIME_METRICS_NOT_CONNECTED`).
3. Character manifest bounds should be reconciled with the measured GLB node
   bounds in the art pack; the spatial test preserves this warning deliberately.
4. Visual composition and hardware WebGL acceptance still require a real target
   Debian/Firefox or Chromium session.

## Quality-gate interpretation

Automated spatial and asset checks have no FAIL findings. The report remains
WARNING because runtime measurements and one manifest contract are unavailable;
passing tests do not imply visual acceptance.
