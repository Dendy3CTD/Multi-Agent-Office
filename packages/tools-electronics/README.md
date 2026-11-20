# MAO Hybrid electronics tools

This package implements workspace-bound KiCad, ngspice, component-review, and PlatformIO tools. It does not create or schedule employees; it exports a task-scoped dispatcher and `mao_electronics` stdio MCP server for the existing host.

## Tools

- `electronics.kicad.version` reports the installed CLI version.
- `electronics.kicad.erc` runs KiCad 9 `sch erc` with JSON output and `--exit-code-violations`.
- `electronics.kicad.netlist` and `electronics.kicad.bom` export from a schematic.
- `electronics.kicad.drc` runs `pcb drc` with JSON output and `--exit-code-violations`.
- `electronics.ngspice.run` runs a supplied `.cir` netlist in batch mode and saves the ngspice log and raw data.
- `electronics.components.validate` compares explicitly documented parameters. Missing values or sources are `NEEDS_DATASHEET`.
- `electronics.bom.validate` validates manufacturer/MPN/quantity and source provenance, calculates known totals per ISO currency, and keeps delivery, reserve, and unknown-price lines separate. Pass `kicadReferences` to compare BOM references with KiCad's exported component references.
- `electronics.electrical.validate` checks supply ratings and summed load current, supply voltage ranges, GPIO voltage/current and pin conflicts, I2C/SPI/UART/PWM compatibility, pull-up/level-shifter declarations, driver current, protection declarations, thermal limits, and connection/netlist agreement.
- `electronics.platformio.detect`, `.inspect`, and `.build` detect PlatformIO, check a selected `platformio.ini` environment, and build without any upload action.

Every result has the same shape: `toolId`, `status`, `exitCode`, actual `stdout`/`stderr`, `warnings`, `checkedParameters`, `unconfirmedParameters`, `createdFiles`, `recommendations`, and `executed`. Inputs and generated artifacts are constrained to the registered project workspace. Commands use argument arrays, no shell, a bounded timeout/output, a project-local HOME/TMP, read-only host filesystem, and a minimal `/dev`. KiCad and ngspice use fixed local CLI operations in that filesystem sandbox. PlatformIO builds also require an isolated network namespace, so they cannot fetch dependencies; if bubblewrap cannot establish the required boundary, the result is `BLOCKED`.

Component checks cover documented supply ranges, power budget/headroom, GPIO current, logic high/low compatibility, I2C/SPI/UART/PWM compatibility, pull-up and level-shifter requirements, reverse-polarity/fuse requirements, and power/thermal review. Every comparison requires source references and confidence labels. A known violation returns `FAIL`; incomplete datasheets return `NEEDS_DATASHEET`; ambient/layout heating context remains `NEEDS_REVIEW`.

The BOM input is an array of lines shaped as `{ reference, manufacturer, mpn, quantity, unitPrice, currency, sourceUrl, checkedAt, datasheetUrl }`. `unitPrice: null` or an omitted price is reported in `unknownPriceReferences`, never silently counted as zero. Known prices require a 3-letter currency, HTTP(S) source URL, and parseable ISO timestamp. Cost fields are emitted per currency: `subtotal`, `delivery`, `reserve`, and `knownTotal`; no currency conversion is inferred. Missing/invalid datasheets return `NEEDS_DATASHEET`. A supplied KiCad reference list produces `netlistReconciliation.bomOnly` and `.netlistOnly`.

Electrical compatibility input is deliberately explicit. Components provide exact datasheet URLs and GPIO/driver ratings; supplies provide output voltage and rated current; loads identify current, operating-voltage range, supply and driver; interfaces identify endpoint protocol compatibility and pull-up/level-shifter requirements; connections identify `componentId`, `pin`, `net`, optional voltage and direction, plus optional GPIO assignment. Optional KiCad netlist connections are compared as `reference.pin=net`. Results include `connectionTable`, `findings`, `checkedInterfaces`, and netlist deltas. Contradictions such as overvoltage, pin conflict, overloaded supply/driver, a pump/motor directly attached to GPIO, missing required protection, or documented thermal overrun return `UNSAFE`. Unknown ratings and datasheets do not pass.

The new tools use the existing `component-validation` capability and task-scoped MCP dispatcher. Their IDs are not added to the shared contracts auto-approval list by this package-only change, so a host that does not recognize the new IDs must expose them with its normal MCP approval policy until the shared allowlist is updated by its owner.

## Integrator handoff

| Tool ID | Capability | Host approval |
| --- | --- | --- |
| `electronics.bom.validate` | `electronics`, `component-validation` | Task dispatcher exposes it to electronics-capable employees. It is not in the shared contracts auto-approval list yet; apply the host's normal MCP prompt policy. |
| `electronics.electrical.validate` | `electronics`, `component-validation` | Same as BOM. It reports design-level checks only and must not be treated as physical safety approval. |

Minimal `electronics.bom.validate` request:

```json
{
  "items": [
    {
      "reference": "U1",
      "manufacturer": "Acme",
      "mpn": "ACME-1",
      "quantity": 1,
      "unitPrice": 2.5,
      "currency": "USD",
      "sourceUrl": "https://shop.example/acme-1",
      "checkedAt": "2026-11-20T09:00:00.000Z",
      "datasheetUrl": "https://example.com/acme-1.pdf"
    }
  ],
  "delivery": [{ "amount": 4, "currency": "USD" }],
  "reservePercent": 10,
  "kicadReferences": ["U1"]
}
```

Minimal `electronics.electrical.validate` request:

```json
{
  "components": [
    { "id": "MCU", "datasheetUrl": "https://example.com/mcu.pdf", "gpio": { "maxVoltage": 3.3, "maxCurrent": 0.02 } },
    { "id": "SENSOR", "datasheetUrl": "https://example.com/sensor.pdf", "pins": [{ "name": "OUT", "maxVoltage": 5 }] }
  ],
  "supplies": [{ "id": "PS1", "voltage": 5, "ratedCurrent": null }],
  "loads": [],
  "interfaces": [{ "protocol": "I2C", "from": "MCU", "to": "SENSOR", "compatible": true, "pullupsRequired": true, "pullupsPresent": null, "levelShifterRequired": true, "levelShifterPresent": false }],
  "connections": [{ "componentId": "SENSOR", "pin": "OUT", "net": "DATA", "voltage": 5, "direction": "output", "gpio": { "componentId": "MCU", "pin": "PA0" } }],
  "kicadNetlistConnections": [{ "componentId": "SENSOR", "pin": "OUT", "net": "DATA" }]
}
```

This second example should report `UNSAFE` for GPIO overvoltage and `NEEDS_DATASHEET` for unknown supply current. The API host should surface the returned status, findings, and unconfirmed parameters verbatim and must not translate `PASS` into a physical safety guarantee. A real Codex → host approval → MCP tool call has not been verified by this package.

The ngspice adapter rejects `.control` blocks, process/file commands, and model includes outside the project workspace. It runs only the analyses declared in the supplied netlist; the selected `analysis` is reported and a missing directive is a warning. It does not infer results from unsupported models. A `PASS` means only that the selected CLI finished and produced its requested report. It is not a safety finding.

PlatformIO builds use the isolated network namespace and project-local HOME. The fixed `buildprog` target is selected; no uploader, erase, monitor, serial, or reset target is accepted by the tool schema. The package does not install dependencies. A missing platform/toolchain therefore returns the PlatformIO build's actual failure output or a sandbox `BLOCKED` result.

PlatformIO was absent in this Debian environment. Manual owner setup, if desired (these commands were not run here):

```sh
curl -fsSL -o /tmp/get-platformio.py https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py
python3 /tmp/get-platformio.py
~/.platformio/penv/bin/pio --version
```

The installer uses the current user and does not require `sudo`. To provision the Arduino Uno platform packages explicitly into a selected registered workspace, run this command from the repository root:

```sh
PLATFORMIO_CORE_DIR="$PWD/.mao-electronics/home/.platformio" \
  ~/.platformio/penv/bin/pio pkg install \
  --project-dir "$PWD/packages/tools-electronics/test/fixtures" \
  --environment uno
```

That package-install command is a manual owner action. The adapter never runs it. PlatformIO honors `PLATFORMIO_CORE_DIR` for package storage, and the fixture's build uses the fixed `buildprog` target ([PlatformIO installation](https://docs.platformio.org/en/latest/core/installation/methods/installer-script.html), [core directory setting](https://docs.platformio.org/en/stable/projectconf/sections/platformio/options/directory/core_dir.html), [package install](https://docs.platformio.org/en/latest/core/userguide/pkg/cmd_install.html)).

## Task-scoped MCP integration

The host calls `createTaskElectronicsDispatcher({ projectId, taskId, executionId, workspaceRoot, employee })` only after it has selected the employee and claimed a task step. It passes `dispatcher.mcpServer` alongside the existing task's MCP server list and publishes only `dispatcher.summaries`. Only an employee with an electronics capability or an electronics/electrical/embedded-engineer profession receives this tool family. The MCP server independently filters the allowlisted tool IDs against the same capabilities.

Minimal host-side merge (shown after task claim and employee selection; `taskTools` is the existing task context):

```ts
import {
  createTaskElectronicsDispatcher,
  electronicsCapabilitiesForEmployee,
} from "@mao-hybrid/tools-electronics";

const electronicsCapabilityIds = new Set([
  "electronics", "kicad", "ngspice", "component-validation", "embedded-build",
]);
const selectedCapabilities = electronicsCapabilitiesForEmployee(employee);

if (selectedCapabilities.some((capability) => electronicsCapabilityIds.has(capability))) {
  const dispatcher = createTaskElectronicsDispatcher({
    projectId: task.projectId,
    taskId: task.id,
    executionId: execution.id,
    workspaceRoot: project.workspaceRoot,
    employee: { id: employee.id, professionId: employee.professionId, skills: employee.skills },
  });

  const existingToolIds = new Set(taskTools.tools.map((tool) => tool.id));
  const duplicateToolIds = dispatcher.summaries
    .map((tool) => tool.id)
    .filter((id) => existingToolIds.has(id));
  if (duplicateToolIds.length) {
    throw new Error(`Task tool ID conflict: ${duplicateToolIds.join(", ")}`);
  }

  const existingServerNames = new Set(taskTools.mcpServers.map((server) => server.name));
  if (existingServerNames.has(dispatcher.mcpServer.name)) {
    throw new Error(`Task MCP server name conflict: ${dispatcher.mcpServer.name}`);
  }

  taskTools = {
    ...taskTools,
    tools: [...taskTools.tools, ...dispatcher.summaries],
    mcpServers: [...taskTools.mcpServers, dispatcher.mcpServer],
  };
}
```

This keeps selected employee capabilities and task identity in scope, and fails closed on tool-ID or MCP-server-name collisions. It does not add electronics tools to global discovery or registration.

### Minimal host contract still needed

The existing task context accepts multiple `RuntimeMcpServerConfig` entries, so no Runtime or shared contract change is required. The API currently constructs only the Coding dispatcher. Its minimal integration change is:

1. After selecting the employee and workspace, call `createTaskElectronicsDispatcher` for an electronics-capable employee.
2. Merge that dispatcher's `tools` summaries and `mcpServer` into the existing `taskTools.tools` and `taskTools.mcpServers` arrays. Keep existing `requiredToolIds` semantics unchanged.
3. Do not add electronics summaries to global `/api/tools` for non-electronics employees, and do not register workspace-bound tool closures globally.
4. Keep the existing Codex MCP approval policy. Electronics commands write reports into the project workspace, so they remain prompt-gated unless the host adds a narrowly reviewed approval policy.

This repository change intentionally does not edit API, Runtime, Director, contracts, Task Store, web, or office packages. Host wiring and an actual Codex→electronics MCP→Task Store E2E remain pending.

## Verification

Run `corepack pnpm --filter @mao-hybrid/tools-electronics build`, `... test`, and `... e2e`. The E2E tests create disposable project workspaces. Scenario A checks an Ohm's-law divider with expected output near 5 V. The KiCad fixtures include a two-pad through-hole footprint, a routed copper track, an Edge.Cuts rectangle, a project footprint table, and project DRC rules (0.25 mm minimum track width, 0.20 mm clearance). The clean board has zero violations; the second board uses a 0.10 mm track and must report `track_width`. Scenario B inspects and attempts an Arduino Uno PlatformIO build. If the host cannot establish the sandbox or a CLI is missing, it reports `BLOCKED`; that is not an engineering E2E pass.

ERC, DRC, SPICE, firmware compile, and documented-value comparisons cannot guarantee electrical safety. A qualified engineer must review exact part revisions, wiring, component tolerances, heat, protection, layout, and applicable standards.
