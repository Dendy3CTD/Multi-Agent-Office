# MAO-GFX-20 — actual quality gate

Status: **WARNING**. Profile: `low`. The report is based on offline manifest,
materials, GLB and layout checks; runtime performance is **NOT MEASURED**.

## Asset and runtime contracts

- `manifest.json`, `materials.json`, referenced textures and
  `office-pack.glb` are present and structurally valid.
- GLB node references and Y-up geometry are checked against the current pack.
- Material records resolve through the explicit `materials.json.mappings` table;
  texture records are not incorrectly treated as material-library keys.
- `OfficeScene3D` is audited through the public `OfficeArtRuntime` boundary,
  including manifest loading, placement scale, material application and cleanup.

## Spatial gate

The current layout is checked at 22×14 m with 12 desks, 12 chairs, 11 employees
and one reserved desk. Windows and partitions are tied to layout records, and
all workstation objects are checked against floor bounds. The only known spatial
warning is the measured character-node versus manifest-bounds mismatch.

## Performance

Offline asset metrics are available and the configured DPR cap is 1.5. No real
browser session supplied draw calls, measured DPR, load time, GPU memory, FPS,
or disposal counters. These values remain NOT MEASURED and are not inferred.

## Remaining blockers

- Declare and verify model forward-axis metadata.
- Capture hardware-WebGL lifecycle metrics on the target Debian machine.
- Reconcile character bounds in the manifest with the current GLB export.
- Perform visual acceptance separately; automated tests cannot establish it.
