# MAO Hybrid engineering consistency

This package compares versioned, normalized engineering facts across a schematic, BOM, firmware pin table, CAD envelope, and assembly instructions. It is a consistency gate only. It does not replace the task Runtime or Director and does not certify a physical device as safe or buildable.

## Manifest contract

The package consumes one `schemaVersion: 1` JSON manifest. Coding, Electronics, CAD, and future Research adapters should translate their outputs into this contract; the checker does not parse KiCad, source code, CAD files, PDFs, or laboratory results itself. `sourcePath` is provenance metadata relative to the project workspace. The checker does not open or execute referenced paths.

Required sections are `project`, `artifacts`, `schematic`, `bom`, `firmware`, `cad`, and `assemblyInstructions`. The fixtures under `test/fixtures/` are complete examples. Key records:

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "controller-alpha",
    "name": "Controller Alpha",
    "version": "0.3.0",
    "componentSetRevision": "parts-r1"
  },
  "artifacts": [
    { "id": "schematic", "kind": "schematic", "version": "1.4.0", "sourcePath": "electronics/controller.kicad_sch" },
    { "id": "cad", "kind": "cad", "version": "3.0.0", "sourcePath": "cad/enclosure.FCStd", "basedOn": { "artifactVersions": { "schematic": "1.4.0", "bom": "1.2.0" }, "componentSetRevision": "parts-r1" } }
  ]
}
```

Every normalized component uses its schematic reference as the stable join key. BOM rows list the exact reference designators they cover; quantity must equal the reference count. Each schematic component explicitly declares `powerRole` as `powered`, `passive`, or `unpowered`; powered components map to a named voltage domain and include their operating range. `powerDomains`, `connections`, and component interface declarations are explicit engineering facts. The pin table joins on signal name and compares the MCU pin and optional direction. CAD supplies both the component envelope and available space on X/Y/Z axes in millimetres.

Never substitute a guessed value for an unavailable measurement or electrical parameter. Omit it and the report will include an `unconfirmed` finding. Unconfirmed required evidence blocks `READY_TO_BUILD`.

## Revision and stale result rules

Each artifact has an explicit `version`, `sourcePath`, and optional `contentHash`. Derived firmware, CAD, and assembly artifacts must record a `basedOn` snapshot. Firmware records the schematic version; CAD records schematic and BOM versions; assembly instructions record CAD and BOM versions. Derived outputs also record the human-managed `componentSetRevision` and SHA-256 `componentSetDigest` computed from the normalized schematic component records. The digest catches component edits even if an adapter forgets to bump the revision.

When normalized component records change, the artifact producer must increment `project.componentSetRevision` and regenerate dependent outputs. Any changed dependency version, component-set revision, or component-set digest emits `stale_artifact` and blocks `READY_TO_BUILD`. The checker does not hash external files; adapters must update artifact versions when referenced source file contents change.

`policy.requiredArtifacts` and `policy.requiredChecks` can add project requirements. By default the gate requires schematic, BOM, firmware, CAD, and assembly instructions, and runs all implemented checks. The optional `research` artifact kind is available for provenance and future normalized inputs; it does not currently establish a design fact by itself.

## Build and use

```sh
npm run build
npm test
node dist/cli.js test/fixtures/consistent-project.json ./artifacts/consistent
```

The CLI writes `integration-report.json` and `integration-report.md`. It exits `0` for `READY_TO_BUILD`, `1` for a consistency gate block, and `2` for an invalid manifest or invocation. The JSON report separates `errors`, `warnings`, and `unconfirmed` parameters and includes per-check status and explicit safety gates.

The deliberately contradictory fixture demonstrates BOM mismatch, GPIO mismatch/collision, supply and interface conflicts, CAD overfill, firmware/schematic version mismatch, missing measurements, and stale generated outputs. A blocked result is not silently downgraded to a warning.

## Safety boundary

The gate compares only declared values. It does not determine whether a part selection is correct, infer component ratings from a part number, interpret an undocumented schematic, rotate a component to make an envelope fit, evaluate thermal/current/EMC behavior, validate creepage/clearance, or certify assembly instructions. `READY_TO_BUILD` means the supplied records passed these implemented consistency checks; it is not product approval or physical safety approval.
