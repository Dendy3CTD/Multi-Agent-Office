import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type RuntimeMcpServerConfig, type ToolDefinition, type ToolSummary } from "@mao-hybrid/contracts";

export type EngineeringStatus = "PASS" | "FAIL" | "UNSAFE" | "BLOCKED" | "NEEDS_REVIEW" | "NEEDS_DATASHEET";
export interface EngineeringArtifact {
  readonly toolId: string;
  readonly status: EngineeringStatus;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly warnings: readonly string[];
  readonly checkedParameters: readonly { readonly parameter: string; readonly value: unknown; readonly source?: string }[];
  readonly unconfirmedParameters: readonly { readonly parameter: string; readonly reason: string }[];
  readonly createdFiles: readonly string[];
  readonly recommendations: readonly string[];
  readonly executed: boolean;
  readonly reason?: string;
  readonly durationMs?: number;
  readonly command?: string;
  readonly workspace?: string;
  readonly effectiveCliPath?: string | null;
  readonly effectivePlatformioCoreDir?: string;
}
export interface ElectronicsOptions {
  readonly workspaceRoot: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly commandAvailability?: (command: string) => boolean;
}
interface ProcessResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; blocked: boolean; durationMs: number; }
type EngineeringTool = ToolDefinition<Record<string, unknown>, EngineeringArtifact>;

const CAPABILITIES = ["electronics", "kicad", "ngspice", "component-validation", "embedded-build"] as const;
const CODEX_APPROVED_ELECTRONICS_TOOLS = Object.freeze([
  "electronics.kicad.version",
  "electronics.kicad.erc",
  "electronics.ngspice.run",
  "electronics.components.validate",
  "electronics.platformio.detect",
  "electronics.platformio.inspect",
  "electronics.platformio.build",
] as const);
const MAX_OUTPUT = 1024 * 1024;

export function createElectronicsTools(options: ElectronicsOptions): { readonly tools: readonly EngineeringTool[]; get(id: string): EngineeringTool | undefined } {
  if (!isAbsolute(options.workspaceRoot)) throw new TypeError("workspaceRoot must be an absolute registered project path");
  const root = realpathSync(options.workspaceRoot);
  if (!statSync(root).isDirectory()) throw new TypeError("workspaceRoot must be a directory");
  const timeoutMs = bounded(options.timeoutMs ?? 120_000, 1000, 900_000, "timeoutMs");
  const maxOutputBytes = bounded(options.maxOutputBytes ?? MAX_OUTPUT, 4096, 4 * MAX_OUTPUT, "maxOutputBytes");
  const available = options.commandAvailability ?? commandExists;
  const tools: EngineeringTool[] = [];
  const documentedValueSchema = { type: "object", required: ["unit", "source", "confidence"], properties: { value: { oneOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }] }, min: { type: "number" }, max: { type: "number" }, unit: { type: "string" }, source: { type: "string" }, confidence: { enum: ["documented", "estimated", "unknown"] } } };
  const add = (id: string, name: string, description: string, schema: Record<string, unknown>, run: (input: Record<string, unknown>) => Promise<EngineeringArtifact>) => {
    tools.push(Object.freeze({ id, name, description, inputSchema: Object.freeze(schema), capabilities: toolCapabilities(id), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, execute: run }));
  };
  const execTool = (id: string, name: string, description: string, command: string, args: (input: Record<string, unknown>, artifactDir: string) => Promise<{ args: string[]; files: string[]; warnings?: string[] }>) =>
    add(id, name, description, { type: "object", additionalProperties: false, properties: { schematic: { type: "string" }, board: { type: "string" }, netlist: { type: "string" }, analysis: { enum: ["dc", "transient", "batch"] }, step: { type: "number", minimum: 1e-12 }, stop: { type: "number", minimum: 1e-12 }, start: { type: "number", minimum: 0 } } }, async input => {
      let resolved: { args: string[]; files: string[]; warnings?: string[] };
      try { resolved = await args(input, await artifactDirectory(root)); }
      catch (error) { const message = error instanceof Error ? error.message : "Invalid engineering input"; return artifact(id, "BLOCKED", null, "", message, [], [], [], [], ["Correct the input path or parameters and retry within the registered project workspace."], false, message); }
      try { await prepareOutputFiles(root, resolved.files); }
      catch (error) { const message = error instanceof Error ? error.message : "Invalid output path"; return artifact(id, "BLOCKED", null, "", message, [], [], [], [], ["Remove the unsafe output path and retry."], false, message); }
      if (!available(command)) return artifact(id, "BLOCKED", null, "", `${command} is not installed or not available on PATH`, resolved.warnings ?? [], [], [], resolved.files, [`Install ${command} through the user's approved system package workflow, then retry.`], false, `${command} unavailable`);
      const cwd = root;
      const result = await runProcess(command, resolved.args, { cwd, workspaceRoot: root, timeoutMs, maxOutputBytes });
      const generated = await collectTextArtifacts(root, resolved.files, maxOutputBytes);
      const stdout = [result.stdout, ...generated.text].filter(Boolean).join("\n").slice(-maxOutputBytes);
      const errorMarkers = /(^|\n)(fatal error|error:|no such file|cannot open|unknown model|unknown device|singular matrix|timestep too small|no convergence|failed to converge)/i;
      let status: EngineeringStatus = result.timedOut || result.blocked ? "BLOCKED" : result.exitCode === 0 && generated.missing.length === 0 && !errorMarkers.test(`${stdout}\n${result.stderr}`) ? "PASS" : "FAIL";
      const checkedParameters: EngineeringArtifact["checkedParameters"][number][] = [];
      const stderr = [result.stderr, ...generated.missing.map(file => `Expected output was not created: ${file}`)].filter(Boolean).join("\n");
      const warnings = [...(resolved.warnings ?? []), ...extractWarnings(stdout, stderr)];
      if (id === "electronics.kicad.drc" && !result.blocked) {
        const reportPath = resolved.files[0];
        try {
          const report = JSON.parse(await readFile(reportPath, "utf8")) as { violations?: unknown; unconnected_items?: unknown };
          if (!Array.isArray(report.violations) || !Array.isArray(report.unconnected_items)) throw new TypeError("KiCad DRC report is missing violations or unconnected_items arrays");
          const violations = report.violations as Array<{ type?: unknown; severity?: unknown; description?: unknown }>;
          checkedParameters.push({ parameter: "drc.violationCount", value: violations.length }, { parameter: "drc.unconnectedCount", value: report.unconnected_items.length }, { parameter: "drc.violations", value: violations.map(item => ({ type: item.type, severity: item.severity, description: item.description })) });
          warnings.push(...violations.filter(item => item.severity === "warning").map(item => `KiCad DRC warning: ${String(item.description ?? item.type ?? "unspecified violation")}`));
          if (report.unconnected_items.length > 0 || violations.some(item => item.severity === "error")) status = "FAIL";
          else if (violations.length > 0 && status === "PASS") status = "NEEDS_REVIEW";
        } catch (error) {
          status = "FAIL";
          warnings.push(`KiCad DRC report could not be parsed: ${error instanceof Error ? error.message : "invalid report"}`);
        }
      }
      if (command === "ngspice" && /unknown model|unknown device|no convergence|singular matrix|timestep too small/i.test(`${stdout}\n${stderr}`)) status = "FAIL";
      if (result.timedOut) warnings.push("Command exceeded its time limit.");
      const recommendations = status === "PASS" ? ["This command result is not proof of electrical safety. Review component datasheets, topology, thermal behavior, and the complete engineering context."] : ["Review the full command output and correct the source design or netlist before relying on derived artifacts."];
      return artifact(id, status, result.blocked ? null : result.exitCode, stdout, stderr, warnings, checkedParameters, [], resolved.files.filter(file => existsInWorkspace(root, file)), recommendations, !result.blocked, result.blocked ? "filesystem/network sandbox could not be established" : result.timedOut ? "execution timed out" : undefined);
    });

  add("electronics.kicad.version", "KiCad CLI version", "Detect installed KiCad CLI and report its actual version.", { type: "object", additionalProperties: false }, async () => {
    if (!available("kicad-cli")) return artifact("electronics.kicad.version", "BLOCKED", null, "", "kicad-cli is not installed or not available on PATH", [], [], [], [], ["Install KiCad using the user's approved system package workflow."], false, "kicad-cli unavailable");
    const result = await runProcess("kicad-cli", ["--version"], { cwd: root, workspaceRoot: root, timeoutMs, maxOutputBytes });
    const status = result.blocked || result.timedOut ? "BLOCKED" : result.exitCode === 0 ? "PASS" : "FAIL";
    return artifact("electronics.kicad.version", status, result.blocked || result.timedOut ? null : result.exitCode, result.stdout, result.stderr, extractWarnings(result.stdout, result.stderr), [], [], [], [], !result.blocked, result.blocked ? "sandbox could not be established" : result.timedOut ? "execution timed out" : undefined);
  });
  const inputFile = async (input: Record<string, unknown>, key: string, ext: string) => resolveWorkspaceFile(root, stringInput(input[key], key), ext);
  execTool("electronics.kicad.erc", "KiCad ERC", "Run KiCad CLI Electrical Rules Check and save the actual report. ERC is not a safety certification.", "kicad-cli", async (input, out) => {
    const file = await inputFile(input, "schematic", ".kicad_sch"); const report = join(out, "erc.json");
    return { args: ["sch", "erc", "--format", "json", "--exit-code-violations", "--output", report, file], files: [report] };
  });
  execTool("electronics.kicad.netlist", "KiCad netlist export", "Export a KiCad schematic netlist using the installed CLI.", "kicad-cli", async (input, out) => {
    const file = await inputFile(input, "schematic", ".kicad_sch"); const netlist = join(out, "netlist.net");
    return { args: ["sch", "export", "netlist", "--output", netlist, file], files: [netlist] };
  });
  execTool("electronics.kicad.bom", "KiCad BOM export", "Export a KiCad schematic BOM using the installed CLI.", "kicad-cli", async (input, out) => {
    const file = await inputFile(input, "schematic", ".kicad_sch"); const bom = join(out, "bom.csv");
    return { args: ["sch", "export", "bom", "--output", bom, file], files: [bom] };
  });
  execTool("electronics.kicad.drc", "KiCad PCB DRC", "Run KiCad CLI PCB Design Rules Check against an existing board.", "kicad-cli", async (input, out) => {
    const file = await inputFile(input, "board", ".kicad_pcb"); const report = join(out, "drc.json");
    return { args: ["pcb", "drc", "--format", "json", "--exit-code-violations", "--output", report, file], files: [report] };
  });
  execTool("electronics.ngspice.run", "ngspice simulation", "Run a user-supplied SPICE netlist in batch mode; no model results are invented.", "ngspice", async (input, out) => {
    const file = await inputFile(input, "netlist", ".cir");
    const analysis = input.analysis === undefined ? "batch" : stringInput(input.analysis, "analysis");
    if (!["dc", "transient", "batch"].includes(analysis)) throw new TypeError("analysis must be dc, transient, or batch");
    const content = await readNetlist(file);
    if (!/^\s*\.end\s*$/im.test(content)) throw new TypeError("SPICE netlist must contain a .end directive");
    if (/^\s*\.(control|endc)\b|^\s*(shell|exec|source|write|wrdata|hardcopy|gnuplot)\b/im.test(content)) throw new TypeError("SPICE control blocks and file/process commands are blocked; use declarative analysis directives only");
    await validateSpiceIncludes(root, content);
    if (analysis === "transient") {
      const step = numeric(input.step, "step"); const stop = numeric(input.stop, "stop"); const start = input.start === undefined ? 0 : numeric(input.start, "start", true);
      if (!(step > 0 && stop > 0 && start < stop)) throw new TypeError("transient requires step > 0 and stop > start >= 0");
    }
    const log = join(out, "ngspice.log"); const raw = join(out, "ngspice.raw");
    let runFile = file; let generatedInput: string | undefined;
    if (analysis === "transient") {
      const step = Number(input.step); const stop = Number(input.stop); const start = input.start === undefined ? 0 : Number(input.start);
      const modified = content.replace(/^\s*\.tran\b[^\r\n]*/gim, "").replace(/^\s*\.end\s*$/im, `.tran ${step} ${stop} ${start}\n.end`);
      generatedInput = join(out, `ngspice-transient-${randomUUID()}.cir`); await writeFile(generatedInput, modified, { flag: "wx", mode: 0o600 }); runFile = generatedInput;
    } else if (analysis === "dc" && !/^\s*\.print\b/im.test(content)) {
      const hasDcSweep = /^\s*\.dc\b/im.test(content);
      const hasOperatingPoint = /^\s*\.op\b/im.test(content);
      const directives = `${!hasDcSweep && !hasOperatingPoint ? ".op\n" : ""}.print ${hasDcSweep ? "dc" : "op"} all\n.end`;
      const modified = content.replace(/^\s*\.end\s*$/im, directives);
      generatedInput = join(out, `ngspice-dc-${randomUUID()}.cir`); await writeFile(generatedInput, modified, { flag: "wx", mode: 0o600 }); runFile = generatedInput;
    }
    const warnings: string[] = [];
    return { args: ["-n", "-b", "-o", log, ...(analysis === "transient" ? ["-r", raw] : []), runFile], files: [log, ...(generatedInput ? [generatedInput] : []), ...(analysis === "transient" ? [raw] : [])], warnings };
  });

  add("electronics.components.validate", "Component constraints", "Compare documented component and load parameters; undocumented limits return NEEDS_DATASHEET.", {
    type: "object", required: ["components", "checks"], additionalProperties: false,
    properties: {
      components: { type: "array", maxItems: 200, items: { type: "object", required: ["id"], additionalProperties: false, properties: {
        id: { type: "string", minLength: 1 }, kind: { type: "string" }, applicableParameters: { type: "array", items: { enum: COMPONENT_PARAMETERS } },
        limits: { type: "object", additionalProperties: documentedValueSchema },
        requirements: { type: "object", additionalProperties: { type: "object", required: ["value", "unit"], properties: { value: { type: "number" }, unit: { type: "string" }, source: { type: "string" } } } },
      } } },
      checks: { type: "array", maxItems: 500, items: { type: "object", required: ["kind"], properties: { kind: { enum: ["power_budget", "voltage_range", "maximum", "logic_compatibility", "interface_compatibility", "protection", "thermal"] }, component: { type: "string" }, parameter: { type: "string" }, driver: { type: "string" }, receiver: { type: "string" }, from: { type: "string" }, to: { type: "string" }, load: { type: "string" }, available: documentedValueSchema, voltage: documentedValueSchema, actual: documentedValueSchema, power: documentedValueSchema, interface: { enum: ["I2C", "SPI", "UART", "PWM"] }, feature: { type: "string" }, required: { type: "boolean" }, pullupsProvided: { type: "boolean" }, levelShiftingProvided: { type: "boolean" } } } },
    },
  }, async input => validateComponentConstraints(input as unknown as ComponentValidationInput));

  add("electronics.bom.validate", "BOM and project costing", "Validate structured BOM provenance and report known cost by currency, with delivery, reserve, and unknown prices separated.", {
    type: "object", required: ["items"], additionalProperties: false,
    properties: { items: { type: "array", maxItems: 1000, items: { type: "object", required: ["reference", "manufacturer", "mpn", "quantity"], additionalProperties: false, properties: { reference: { type: "string", minLength: 1 }, manufacturer: { type: "string", minLength: 1 }, mpn: { type: "string", minLength: 1 }, quantity: { type: "integer", minimum: 1 }, unitPrice: { oneOf: [{ type: "number", minimum: 0 }, { type: "null" }] }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, sourceUrl: { type: "string", format: "uri" }, checkedAt: { type: "string", format: "date-time" }, datasheetUrl: { type: "string", format: "uri" } } } }, delivery: { type: "array", items: { type: "object", required: ["amount", "currency"], properties: { amount: { type: "number", minimum: 0 }, currency: { type: "string", pattern: "^[A-Z]{3}$" } } } }, reservePercent: { type: "number", minimum: 0, maximum: 1000 }, kicadReferences: { type: "array", items: { type: "string" } } },
  }, async input => validateBillOfMaterials(input as unknown as BillOfMaterialsInput));

  add("electronics.electrical.validate", "Electrical compatibility", "Check documented power, GPIO, interfaces, drivers, protection, thermal constraints, connection table, and KiCad netlist agreement. A report is not a safety certification.", {
    type: "object", required: ["components", "supplies", "loads", "interfaces", "connections"], additionalProperties: false,
    properties: {
      components: { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string" }, datasheetUrl: { type: "string", format: "uri" }, gpio: { type: "object", properties: { maxVoltage: { type: "number" }, maxCurrent: { type: "number" } } }, driver: { type: "object", properties: { maxCurrent: { type: "number" }, voltageMin: { type: "number" }, voltageMax: { type: "number" } } }, pins: { type: "array", items: { type: "object", required: ["name"], properties: { name: { type: "string" }, maxVoltage: { type: "number" }, maxCurrent: { type: "number" } } } } } } },
      supplies: { type: "array", items: { type: "object", required: ["id", "voltage"], properties: { id: { type: "string" }, voltage: { type: "number" }, ratedCurrent: { oneOf: [{ type: "number" }, { type: "null" }] } } } },
      loads: { type: "array", items: { type: "object", required: ["componentId"], properties: { componentId: { type: "string" }, kind: { type: "string" }, supplyId: { type: "string" }, voltageMin: { type: "number" }, voltageMax: { type: "number" }, current: { type: "number" }, gpioDirect: { type: "boolean" }, gpioComponentId: { type: "string" }, driverComponentId: { type: ["string", "null"] }, requiredProtection: { type: "array", items: { type: "string" } }, protectionPresent: { type: "array", items: { type: "string" } }, dissipation: { type: "number" }, thermalLimit: { type: "number" } } } },
      interfaces: { type: "array", items: { type: "object", required: ["protocol", "from", "to"], properties: { protocol: { enum: ["I2C", "SPI", "UART", "PWM"] }, from: { type: "string" }, to: { type: "string" }, compatible: { type: "boolean" }, pullupsRequired: { type: "boolean" }, pullupsPresent: { type: ["boolean", "null"] }, levelShifterRequired: { type: ["boolean", "null"] }, levelShifterPresent: { type: ["boolean", "null"] } } } },
      connections: { type: "array", items: { type: "object", required: ["componentId", "pin", "net", "direction"], properties: { componentId: { type: "string" }, pin: { type: "string" }, net: { type: "string" }, voltage: { type: "number" }, direction: { enum: ["input", "output", "bidirectional", "power", "passive", "unknown"] }, gpio: { type: "object", properties: { componentId: { type: "string" }, pin: { type: "string" } } } } } },
      kicadNetlistConnections: { type: "array", items: { type: "object", required: ["componentId", "pin", "net"], properties: { componentId: { type: "string" }, pin: { type: "string" }, net: { type: "string" } } } },
    },
  }, async input => validateElectricalCompatibility(input as unknown as ElectricalCompatibilityInput));

  add("electronics.platformio.detect", "PlatformIO detection", "Detect PlatformIO without installing packages.", { type: "object", additionalProperties: false }, async () => {
    const command = available("pio") ? "pio" : available("platformio") ? "platformio" : null;
    if (!command) return artifact("electronics.platformio.detect", "BLOCKED", null, "", "PlatformIO CLI (pio/platformio) is not installed or not available on PATH", [], [], [], [], ["Install PlatformIO only through an explicitly approved setup task."], false, "PlatformIO unavailable");
    const result = await runProcess(command, ["--version"], { cwd: root, workspaceRoot: root, timeoutMs, maxOutputBytes });
    const status = result.blocked || result.timedOut ? "BLOCKED" : result.exitCode === 0 ? "PASS" : "FAIL";
    return artifact("electronics.platformio.detect", status, result.blocked || result.timedOut ? null : result.exitCode, result.stdout, result.stderr, extractWarnings(result.stdout, result.stderr), [], [], [], [], !result.blocked, result.blocked ? "sandbox could not be established" : result.timedOut ? "execution timed out" : undefined);
  });
  add("electronics.platformio.inspect", "PlatformIO project inspection", "Validate project-local platformio.ini, selected environment, and board declaration without building or installing dependencies.", { type: "object", required: ["config"], additionalProperties: false, properties: { config: { type: "string" }, environment: { type: "string" } } }, async input => inspectPlatformio(root, input));
  add("electronics.platformio.build", "PlatformIO firmware build", "Build project firmware without uploading, erasing, opening serial devices, or resetting hardware.", { type: "object", required: ["config"], additionalProperties: false, properties: { config: { type: "string" }, environment: { type: "string" } } }, async input => {
    let config: string; let inspected: EngineeringArtifact;
    try { config = await resolveWorkspaceFile(root, stringInput(input.config, "config"), ".ini"); inspected = await parsePlatformioConfig(config, input.environment); }
    catch (error) { const message = error instanceof Error ? error.message : "Invalid PlatformIO project"; return artifact("electronics.platformio.build", "BLOCKED", null, "", message, [], [], [], [], ["Correct the platformio.ini path and retry within the registered project workspace."], false, message); }
    if (inspected.status !== "PASS") return inspected;
    const workspace = root;
    const coreDir = join(root, ".mao-electronics", "home", ".platformio");
    const cliAvailable = available("pio") || available("platformio");
    const command = available("pio") ? "pio" : "platformio";
    const projectDir = dirname(config); const args = ["run", "--project-dir", projectDir, "--target", "buildprog"];
    const env = inspected.checkedParameters.find(value => value.parameter === "platformio.environment")?.value;
    if (typeof env === "string") args.push("-e", env);
    const effectiveCliPath = commandExistsAbsolute(command);
    const commandText = [effectiveCliPath, ...args].map(shellDisplayArgument).join(" ");
    const prerequisites = await inspectPlatformioBuildPrerequisites(root, coreDir, config, inspected);
    if (prerequisites.missing.length) {
      const reason = `Preinstalled PlatformIO dependencies are unavailable inside the registered workspace: ${prerequisites.missing.join(", ")}. Automatic dependency installation is disabled.`;
      return withPlatformioDiagnostics(artifact("electronics.platformio.build", "BLOCKED", null, "", reason, [], [...inspected.checkedParameters, ...prerequisites.checked], prerequisites.missing.map(parameter => ({ parameter, reason: "Required preinstalled PlatformIO package is missing or escapes the workspace." })), [], ["Run the owner-approved PlatformIO package preparation inside this project workspace, then retry."], false, reason), { command: commandText, workspace, effectiveCliPath, coreDir, durationMs: 0 });
    }
    if (!cliAvailable) return withPlatformioDiagnostics(artifact("electronics.platformio.build", "BLOCKED", null, "", "PlatformIO CLI (pio/platformio) is not installed or not available on task PATH", [], [...inspected.checkedParameters, ...prerequisites.checked], inspected.unconfirmedParameters, [], ["Install PlatformIO only through an explicitly approved setup task."], false, "PlatformIO CLI unavailable on task PATH"), { command: commandText, workspace, effectiveCliPath: null, coreDir, durationMs: 0 });
    const result = await runProcess(command, args, { cwd: projectDir, workspaceRoot: root, timeoutMs, maxOutputBytes, networkRestricted: true, platformioCoreDir: coreDir, readOnlyBindPaths: prerequisites.readOnlyPaths });
    const size = result.stdout.match(/RAM:\s*\[([^\]]+)\].*FLASH:\s*\[([^\]]+)\]/s);
    const status = result.blocked || result.timedOut ? "BLOCKED" : result.exitCode === 0 ? "PASS" : "FAIL";
    const reason = result.blocked ? `PlatformIO sandbox could not be established: ${firstLine(result.stderr) || "bwrap failed before command execution"}` : result.timedOut ? "PlatformIO build exceeded the configured time limit" : undefined;
    return withPlatformioDiagnostics(artifact("electronics.platformio.build", status, result.blocked || result.timedOut ? null : result.exitCode, result.stdout, result.stderr, extractWarnings(result.stdout, result.stderr), [...inspected.checkedParameters, ...prerequisites.checked, ...(size ? [{ parameter: "platformio.memorySummary", value: { ram: size[1], flash: size[2] } }] : [])], inspected.unconfirmedParameters, [], ["Firmware was built only; it was not flashed to hardware."], !result.blocked, reason), { command: commandText, workspace, effectiveCliPath, coreDir, durationMs: result.durationMs });
  });
  return Object.freeze({ tools: Object.freeze(tools), get: (id: string) => tools.find(tool => tool.id === id) });
}

export interface DocumentedParameter { readonly value?: number | string | boolean; readonly min?: number; readonly max?: number; readonly unit: string; readonly source: string; readonly confidence: "documented" | "estimated" | "unknown"; }
export interface ComponentValidationInput { readonly components: readonly { readonly id: string; readonly kind?: string; readonly applicableParameters?: readonly string[]; readonly limits?: Readonly<Record<string, DocumentedParameter>>; readonly requirements?: Readonly<Record<string, { readonly value: number; readonly unit: string; readonly source?: string }>> }[]; readonly checks: readonly Readonly<Record<string, unknown>>[]; }
export function validateComponentConstraints(input: ComponentValidationInput): EngineeringArtifact {
  const checked: { parameter: string; value: unknown; source?: string }[] = [];
  const missing: { parameter: string; reason: string }[] = [];
  const warnings: string[] = [];
  const violations: string[] = [];
  const components = Array.isArray(input?.components) ? input.components : [];
  const checks = Array.isArray(input?.checks) ? input.checks : [];
  if (components.length === 0 || checks.length === 0) missing.push({ parameter: "validation.scope", reason: "Provide at least one component and one explicit constraint check; empty scope is not a passing result." });
  for (const component of components) {
    if (!component || typeof component.id !== "string") throw new TypeError("Each component needs an id");
    const applicable = component.applicableParameters ?? COMPONENT_PARAMETERS;
    for (const parameter of applicable) {
      if (!(COMPONENT_PARAMETERS as readonly string[]).includes(parameter)) { missing.push({ parameter: `${component.id}.${parameter}`, reason: "Unknown component parameter key." }); continue; }
      const value = component.limits?.[parameter];
      if (!documented(value) || (NUMERIC_PARAMETERS.has(parameter) && !Number.isFinite(value.value ?? value.max ?? value.min))) missing.push({ parameter: `${component.id}.${parameter}`, reason: "Provide the exact value and source reference from the component datasheet." });
      else checked.push({ parameter: `${component.id}.${parameter}`, value: value.value ?? { min: value.min, max: value.max, unit: value.unit }, source: value.source });
    }
  }
  for (const check of checks) {
    if (check.kind === "power_budget") {
      const supply = (check.available as DocumentedParameter | undefined);
      const loadId = check.load;
      const load = components.find(item => item.id === loadId)?.requirements?.current;
      if (!documented(supply) || typeof supply.value !== "number" || !load || !Number.isFinite(load.value) || !load.source?.trim()) missing.push({ parameter: "powerBudget.margin", reason: "Document the source capacity and total load current in matching units." });
      else if (supply.unit !== load.unit) missing.push({ parameter: "powerBudget.margin", reason: `Unit mismatch: supply is ${supply.unit}, load is ${load.unit}.` });
      else {
        const margin = supply.value! - load.value;
        checked.push({ parameter: "powerBudget.margin", value: margin, source: `${supply.source}; load ${load.source ?? "source not provided"}` });
        if (margin < 0) violations.push("Documented load exceeds documented source capacity.");
        else if (supply.value! > 0 && margin / supply.value! < 0.2) warnings.push("Documented source headroom is below 20%; engineering review is required.");
      }
    } else if (check.kind === "voltage_range") {
      const component = components.find(item => item.id === check.component);
      const voltage = check.voltage as DocumentedParameter | undefined; const range = component?.limits?.supplyVoltage;
      if (!documented(voltage) || typeof voltage.value !== "number" || !documented(range) || typeof range.min !== "number" || typeof range.max !== "number") missing.push({ parameter: `${String(check.component)}.supplyVoltage`, reason: "Document the applied voltage and component supply-voltage range with sources." });
      else if (voltage.unit !== range.unit) missing.push({ parameter: `${String(check.component)}.supplyVoltage`, reason: `Unit mismatch: applied ${voltage.unit}, allowed ${range.unit}.` });
      else { const pass = voltage.value >= range.min! && voltage.value <= range.max!; checked.push({ parameter: `${String(check.component)}.supplyVoltageCheck`, value: { applied: voltage.value, allowed: [range.min, range.max], pass }, source: `${voltage.source}; ${range.source}` }); if (!pass) violations.push(`${String(check.component)} supply voltage is outside the documented range.`); }
    } else if (check.kind === "maximum") {
      const component = components.find(item => item.id === check.component); const parameter = check.parameter;
      const actual = check.actual as DocumentedParameter | undefined; const limit = typeof parameter === "string" ? component?.limits?.[parameter] : undefined;
      const limitValue = limit?.max ?? limit?.value;
      if (typeof parameter !== "string" || !documented(actual) || typeof actual.value !== "number" || !documented(limit) || typeof limitValue !== "number") missing.push({ parameter: `${String(check.component)}.${String(parameter)}`, reason: "Document the measured/calculated value and component maximum, with sources." });
      else if (actual.unit !== limit.unit) missing.push({ parameter: `${String(check.component)}.${parameter}`, reason: `Unit mismatch: actual ${actual.unit}, allowed ${limit.unit}.` });
      else { const pass = actual.value <= limitValue; checked.push({ parameter: `${String(check.component)}.${parameter}Check`, value: { actual: actual.value, maximum: limitValue, pass }, source: `${actual.source}; ${limit.source}` }); if (!pass) violations.push(`${String(check.component)} ${parameter} exceeds its documented maximum.`); }
    } else if (check.kind === "logic_compatibility") {
      const driver = components.find(item => item.id === check.driver); const receiver = components.find(item => item.id === check.receiver);
      const outputHigh = driver?.limits?.logicHigh; const inputHigh = receiver?.limits?.logicHigh; const outputLow = driver?.limits?.logicLow; const inputLow = receiver?.limits?.logicLow;
      if (![outputHigh, inputHigh, outputLow, inputLow].every(documented) || typeof outputHigh?.min !== "number" || typeof inputHigh?.min !== "number" || typeof outputLow?.max !== "number" || typeof inputLow?.max !== "number") missing.push({ parameter: `logic.${String(check.driver)}.${String(check.receiver)}`, reason: "Document driver VOH/VOL and receiver VIH/VIL limits, including datasheet sources." });
      else if (outputHigh.unit !== inputHigh.unit || outputLow.unit !== inputLow.unit || outputHigh.unit !== outputLow.unit) missing.push({ parameter: "logic.compatibility", reason: "Driver and receiver logic-level units must match." });
      else { const highPass = outputHigh.min! >= inputHigh.min!; const lowPass = outputLow.max! <= inputLow.max!; checked.push({ parameter: "logic.compatibility", value: { highPass, lowPass }, source: `${outputHigh.source}; ${inputHigh.source}; ${outputLow.source}; ${inputLow.source}` }); if (!highPass || !lowPass) violations.push("Documented logic levels are incompatible; review level shifting and input thresholds."); }
    } else if (check.kind === "interface_compatibility") {
      const mapping: Record<string, string> = { I2C: "i2cCompatibility", SPI: "spiCompatibility", UART: "uartCompatibility", PWM: "pwmCompatibility" };
      const key = typeof check.interface === "string" ? mapping[check.interface.toUpperCase()] : undefined;
      const from = components.find(item => item.id === check.from); const to = components.find(item => item.id === check.to);
      const left = key ? from?.limits?.[key] : undefined; const right = key ? to?.limits?.[key] : undefined;
      if (!key || !documented(left) || !documented(right) || typeof left.value !== "string" || typeof right.value !== "string") missing.push({ parameter: `interface.${String(check.interface)}`, reason: "Document protocol compatibility for both exact components and cite their datasheets." });
      else {
        const pass = left.value.toLowerCase() === "compatible" && right.value.toLowerCase() === "compatible";
        checked.push({ parameter: `interface.${String(check.interface)}`, value: pass ? "compatible" : "incompatible", source: `${left.source}; ${right.source}` });
        if (!pass) violations.push(`${String(check.interface)} interface compatibility is not established; check voltage domains, pull-ups, and level shifting.`);
        for (const [name, field, provided] of [["pull-up", "pullupRequirements", check.pullupsProvided], ["level shifting", "levelShiftingRequirements", check.levelShiftingProvided]] as const) {
          const a = from?.limits?.[field]; const b = to?.limits?.[field];
          if (!documented(a) || !documented(b) || typeof a.value !== "string" || typeof b.value !== "string") missing.push({ parameter: `interface.${String(check.interface)}.${field}`, reason: `Document ${name} requirements for both parts.` });
          else if ([a.value, b.value].some(value => value.toLowerCase() === "required") && provided !== true) violations.push(`${String(check.interface)} requires ${name}; confirm it is present in the circuit.`);
        }
      }
    } else if (check.kind === "protection") {
      const component = components.find(item => item.id === check.component); const parameter = check.feature;
      const value = typeof parameter === "string" ? component?.limits?.[parameter] : undefined;
      if (!["reversePolarityProtection", "fuseRequirement"].includes(String(parameter)) || !documented(value) || typeof value.value !== "boolean" || typeof check.required !== "boolean") missing.push({ parameter: `${String(check.component)}.${String(parameter)}`, reason: "Document the protection feature and whether the circuit requires it." });
      else { const pass = !check.required || value.value; checked.push({ parameter: `${String(check.component)}.${String(parameter)}Check`, value: { required: check.required, present: value.value, pass }, source: value.source }); if (!pass) violations.push(`${String(check.component)} is missing required ${String(parameter)}.`); }
    } else if (check.kind === "thermal") {
      const component = components.find(item => item.id === check.component); const power = check.power as DocumentedParameter | undefined;
      const maxPower = component?.limits?.powerDissipation; const thermal = component?.limits?.thermalLimit; const maxPowerValue = maxPower?.max ?? (typeof maxPower?.value === "number" ? maxPower.value : undefined);
      if (!documented(power) || typeof power.value !== "number" || !documented(maxPower) || typeof maxPowerValue !== "number" || !documented(thermal)) missing.push({ parameter: `${String(check.component)}.thermal`, reason: "Document power dissipation, thermal limit, applied power, and sources." });
      else if (power.unit !== maxPower.unit) missing.push({ parameter: `${String(check.component)}.thermal`, reason: "Power units do not match the component's documented dissipation limit." });
      else { const pass = power.value <= maxPowerValue; checked.push({ parameter: `${String(check.component)}.powerDissipationCheck`, value: { applied: power.value, maximum: maxPowerValue, pass, thermalLimit: thermal.value ?? { min: thermal.min, max: thermal.max, unit: thermal.unit } }, source: `${power.source}; ${maxPower.source}; ${thermal.source}` }); if (!pass) violations.push(`${String(check.component)} may exceed its documented power dissipation limit.`); warnings.push(`${String(check.component)} thermal result needs review against ambient temperature, PCB copper, enclosure, and derating curves.`); }
    } else if (typeof check.kind === "string") missing.push({ parameter: `check.${check.kind}`, reason: "Unsupported check kind; no result was inferred." });
  }
  const status: EngineeringStatus = missing.length ? "NEEDS_DATASHEET" : violations.length ? "FAIL" : warnings.length ? "NEEDS_REVIEW" : "PASS";
  return artifact("electronics.components.validate", status, 0, "", "", [...violations, ...warnings], checked, missing, [], ["This structured review does not certify safety. Validate all limits against the exact part revision and applicable standards."], true);
}

export interface BillOfMaterialsItem {
  readonly reference: string; readonly manufacturer: string; readonly mpn: string; readonly quantity: number;
  readonly unitPrice?: number | null; readonly currency?: string; readonly sourceUrl?: string; readonly checkedAt?: string; readonly datasheetUrl?: string;
}
export interface BillOfMaterialsInput { readonly items: readonly BillOfMaterialsItem[]; readonly delivery?: readonly { readonly amount: number; readonly currency: string }[]; readonly reservePercent?: number; readonly kicadReferences?: readonly string[]; }
export interface BomCostByCurrency { readonly currency: string; readonly subtotal: number; readonly delivery: number; readonly reserve: number; readonly knownTotal: number; }
export interface BillOfMaterialsReport extends EngineeringArtifact { readonly costs: readonly BomCostByCurrency[]; readonly unknownPriceReferences: readonly string[]; readonly itemTotals: readonly { readonly reference: string; readonly quantity: number; readonly unitPrice: number | null; readonly currency?: string; readonly extendedPrice: number | null }[]; readonly netlistReconciliation: { readonly bomOnly: readonly string[]; readonly netlistOnly: readonly string[] }; }

/** Validate BOM identity/provenance and calculate known costs without treating unknown prices as zero. */
export function validateBillOfMaterials(input: BillOfMaterialsInput): BillOfMaterialsReport {
  if (!input || !Array.isArray(input.items) || input.items.length > 1000) throw new TypeError("items must be an array with at most 1000 BOM lines");
  const seen = new Set<string>(); const missing: { parameter: string; reason: string }[] = []; const warnings: string[] = [];
  if (input.items.length === 0) warnings.push("BOM is empty; an empty list is not evidence that the project has no components or cost.");
  const totals = new Map<string, number>(); const itemTotals: BillOfMaterialsReport["itemTotals"][number][] = []; const unknownPriceReferences: string[] = [];
  for (const item of input.items) {
    if (!item || !nonEmpty(item.reference) || !nonEmpty(item.manufacturer) || !nonEmpty(item.mpn) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new TypeError("Each BOM line needs reference, manufacturer, MPN, and positive integer quantity");
    if (seen.has(item.reference)) throw new TypeError(`Duplicate BOM reference ${item.reference}`); seen.add(item.reference);
    const unknown = item.unitPrice === undefined || item.unitPrice === null;
    if (!unknown && (!Number.isFinite(item.unitPrice) || item.unitPrice! < 0)) throw new TypeError(`${item.reference}.unitPrice must be a non-negative number or null`);
    if (!unknown && (!isCurrency(item.currency) || !validUrl(item.sourceUrl) || !validTimestamp(item.checkedAt))) missing.push({ parameter: `${item.reference}.priceProvenance`, reason: "A known price requires ISO currency, source URL, and checkedAt timestamp." });
    if (!unknown && isCurrency(item.currency)) totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.unitPrice! * item.quantity);
    else unknownPriceReferences.push(item.reference);
    if (!validUrl(item.datasheetUrl)) missing.push({ parameter: `${item.reference}.datasheetUrl`, reason: "Provide the exact manufacturer datasheet URL for the selected part/revision." });
    itemTotals.push({ reference: item.reference, quantity: item.quantity, unitPrice: unknown ? null : item.unitPrice!, ...(item.currency ? { currency: item.currency } : {}), extendedPrice: unknown ? null : item.unitPrice! * item.quantity });
  }
  const deliveryTotals = new Map<string, number>();
  for (const delivery of input.delivery ?? []) {
    if (!delivery || !isCurrency(delivery.currency) || !Number.isFinite(delivery.amount) || delivery.amount < 0) throw new TypeError("Delivery entries need a non-negative amount and ISO 4217 currency");
    deliveryTotals.set(delivery.currency, (deliveryTotals.get(delivery.currency) ?? 0) + delivery.amount);
  }
  const reservePercent = input.reservePercent ?? 0;
  if (!Number.isFinite(reservePercent) || reservePercent < 0 || reservePercent > 1000) throw new TypeError("reservePercent must be between 0 and 1000");
  const currencies = new Set([...totals.keys(), ...deliveryTotals.keys()]);
  const costs = [...currencies].sort().map(currency => {
    const subtotal = roundMoney(totals.get(currency) ?? 0); const delivery = roundMoney(deliveryTotals.get(currency) ?? 0);
    const reserve = roundMoney((subtotal + delivery) * reservePercent / 100);
    return Object.freeze({ currency, subtotal, delivery, reserve, knownTotal: roundMoney(subtotal + delivery + reserve) });
  });
  if (unknownPriceReferences.length) warnings.push(`Price is unknown for ${unknownPriceReferences.join(", ")}; known totals exclude these lines.`);
  const bomRefs = new Set(input.items.map(item => item.reference));
  const netlistRefs = input.kicadReferences ? new Set(input.kicadReferences) : undefined;
  const bomOnly = netlistRefs ? [...bomRefs].filter(reference => !netlistRefs.has(reference)).sort() : [];
  const netlistOnly = netlistRefs ? [...netlistRefs].filter(reference => !bomRefs.has(reference)).sort() : [];
  if (netlistRefs && (bomOnly.length || netlistOnly.length)) warnings.push("BOM references do not match the KiCad netlist; reconcile fitted, excluded, and virtual components.");
  const status: EngineeringStatus = missing.length ? "NEEDS_DATASHEET" : !input.items.length || bomOnly.length || netlistOnly.length || unknownPriceReferences.length ? "NEEDS_REVIEW" : "PASS";
  const base = artifact("electronics.bom.validate", status, 0, "", "", warnings, costs.map(row => ({ parameter: `cost.${row.currency}`, value: row })), missing, [], ["Prices are source snapshots, not quotes; taxes, exchange rates, availability, and delivery estimates may change."], true);
  return Object.freeze({ ...base, costs: Object.freeze(costs), unknownPriceReferences: Object.freeze(unknownPriceReferences), itemTotals: Object.freeze(itemTotals), netlistReconciliation: Object.freeze({ bomOnly: Object.freeze(bomOnly), netlistOnly: Object.freeze(netlistOnly) }) });
}

export type SignalDirection = "input" | "output" | "bidirectional" | "power" | "passive" | "unknown";
export interface ElectricalCompatibilityInput {
  readonly components: readonly { readonly id: string; readonly datasheetUrl?: string; readonly gpio?: { readonly maxVoltage?: number; readonly maxCurrent?: number }; readonly driver?: { readonly maxCurrent?: number; readonly voltageMin?: number; readonly voltageMax?: number }; readonly pins?: readonly { readonly name: string; readonly maxVoltage?: number; readonly maxCurrent?: number }[] }[];
  readonly supplies: readonly { readonly id: string; readonly voltage: number; readonly ratedCurrent?: number | null }[];
  readonly loads: readonly { readonly componentId: string; readonly kind?: string; readonly supplyId?: string; readonly voltageMin?: number; readonly voltageMax?: number; readonly current?: number; readonly gpioDirect?: boolean; readonly gpioComponentId?: string; readonly driverComponentId?: string | null; readonly requiredProtection?: readonly string[]; readonly protectionPresent?: readonly string[]; readonly dissipation?: number; readonly thermalLimit?: number }[];
  readonly interfaces: readonly { readonly protocol: "I2C" | "SPI" | "UART" | "PWM"; readonly from: string; readonly to: string; readonly compatible?: boolean; readonly pullupsRequired?: boolean; readonly pullupsPresent?: boolean | null; readonly levelShifterRequired?: boolean | null; readonly levelShifterPresent?: boolean | null }[];
  readonly connections: readonly { readonly componentId: string; readonly pin: string; readonly net: string; readonly voltage?: number; readonly direction: SignalDirection; readonly gpio?: { readonly componentId: string; readonly pin: string } }[];
  readonly kicadNetlistConnections?: readonly { readonly componentId: string; readonly pin: string; readonly net: string }[];
}
export interface ElectricalFinding { readonly code: string; readonly severity: "unsafe" | "review"; readonly message: string; readonly references?: readonly string[]; }
export interface ElectricalCompatibilityReport extends EngineeringArtifact {
  readonly findings: readonly ElectricalFinding[];
  readonly connectionTable: readonly { readonly component: string; readonly contact: string; readonly net: string; readonly voltage?: number; readonly direction: SignalDirection }[];
  readonly checkedInterfaces: readonly string[];
  readonly netlistReconciliation: { readonly designOnly: readonly string[]; readonly netlistOnly: readonly string[] };
}

/** Conservative project-level checks. UNSAFE means a documented/design-level contradiction, not a physical safety certification. */
export function validateElectricalCompatibility(input: ElectricalCompatibilityInput): ElectricalCompatibilityReport {
  if (!input || !Array.isArray(input.components) || !Array.isArray(input.supplies) || !Array.isArray(input.loads) || !Array.isArray(input.interfaces) || !Array.isArray(input.connections)) throw new TypeError("Electrical compatibility input requires components, supplies, loads, interfaces, and connections arrays");
  const findings: ElectricalFinding[] = []; const missing: { parameter: string; reason: string }[] = []; const checked: { parameter: string; value: unknown; source?: string }[] = [];
  if (input.components.length === 0) findings.push({ code: "EMPTY_COMPONENT_SCOPE", severity: "review", message: "No components were supplied; no compatibility conclusion can be drawn." });
  if (input.supplies.length === 0 && input.loads.length === 0 && input.interfaces.length === 0 && input.connections.length === 0) findings.push({ code: "EMPTY_ELECTRICAL_SCOPE", severity: "review", message: "No supplies, loads, interfaces, or connections were supplied; this is not a passing electrical check." });
  const byId = new Map<string, ElectricalCompatibilityInput["components"][number]>();
  for (const component of input.components) {
    if (!nonEmpty(component.id) || byId.has(component.id)) throw new TypeError("Electrical component IDs must be non-empty and unique");
    byId.set(component.id, component);
    if (!validUrl(component.datasheetUrl)) missing.push({ parameter: `${component.id}.datasheetUrl`, reason: "Exact component datasheet is required before compatibility can be established." });
  }
  const supplyById = new Map(input.supplies.map(supply => {
    if (!nonEmpty(supply.id) || !Number.isFinite(supply.voltage)) throw new TypeError("Supply needs an ID and a finite output voltage");
    if (supply.ratedCurrent === undefined || supply.ratedCurrent === null) missing.push({ parameter: `${supply.id}.ratedCurrent`, reason: "Power-supply current rating is unknown; do not infer available current." });
    else if (!Number.isFinite(supply.ratedCurrent) || supply.ratedCurrent < 0) throw new TypeError(`${supply.id}.ratedCurrent must be non-negative`);
    return [supply.id, supply] as const;
  }));
  if (supplyById.size !== input.supplies.length) throw new TypeError("Supply IDs must be unique");

  const assignedPins = new Map<string, string[]>();
  for (const connection of input.connections) {
    if (!byId.has(connection.componentId) || !nonEmpty(connection.pin) || !nonEmpty(connection.net)) throw new TypeError("Each connection must reference an existing component and have pin/net names");
    if (connection.gpio) {
      const gpioComponent = byId.get(connection.gpio.componentId); const key = `${connection.gpio.componentId}.${connection.gpio.pin}`;
      const occupants = assignedPins.get(key) ?? []; occupants.push(`${connection.componentId}.${connection.pin}`); assignedPins.set(key, occupants);
      const maxVoltage = gpioComponent?.gpio?.maxVoltage ?? gpioComponent?.pins?.find(pin => pin.name === connection.gpio!.pin)?.maxVoltage;
      if (!gpioComponent) findings.push({ code: "GPIO_CONTROLLER_UNKNOWN", severity: "review", message: `${key} refers to an unknown GPIO controller.` });
      if (connection.voltage !== undefined && maxVoltage === undefined) missing.push({ parameter: `${key}.maxVoltage`, reason: "GPIO absolute maximum voltage is unknown; a matching signal level is not assumed safe." });
      else if (connection.voltage !== undefined && maxVoltage !== undefined && connection.voltage > maxVoltage) findings.push({ code: "GPIO_OVERVOLTAGE", severity: "unsafe", message: `${key} may receive ${connection.voltage} V but the documented maximum is ${maxVoltage} V. Use a suitable level shifter or divider and re-check the exact parts.`, references: [`${connection.componentId}.${connection.pin}`, key] });
      if (gpioComponent?.pins && !gpioComponent.pins.some(pin => pin.name === connection.gpio!.pin)) findings.push({ code: "GPIO_PIN_NOT_PRESENT", severity: "unsafe", message: `${key} does not exist in the declared controller pinout.` });
    }
  }
  for (const [pin, owners] of assignedPins) if (owners.length > 1) findings.push({ code: "GPIO_PIN_CONFLICT", severity: "unsafe", message: `${pin} has conflicting assignments: ${owners.join(", ")}.`, references: owners });

  const currentBySupply = new Map<string, number>();
  for (const load of input.loads) {
    if (!byId.has(load.componentId)) throw new TypeError(`Unknown load component ${load.componentId}`);
    const motorLike = /motor|pump|solenoid|relay|inductive/i.test(`${load.kind ?? ""} ${load.componentId}`);
    if (load.current === undefined || !Number.isFinite(load.current) || load.current < 0) missing.push({ parameter: `${load.componentId}.current`, reason: "Load current is required for supply and GPIO checks." });
    if (load.supplyId) {
      const supply = supplyById.get(load.supplyId);
      if (!supply) findings.push({ code: "SUPPLY_NOT_FOUND", severity: "unsafe", message: `${load.componentId} references unknown supply ${load.supplyId}.` });
      else {
        if (load.current !== undefined) currentBySupply.set(load.supplyId, (currentBySupply.get(load.supplyId) ?? 0) + load.current);
        if (load.voltageMin === undefined || load.voltageMax === undefined) missing.push({ parameter: `${load.componentId}.supplyVoltage`, reason: "Load operating-voltage range is not documented." });
        else if (supply.voltage < load.voltageMin || supply.voltage > load.voltageMax) findings.push({ code: "SUPPLY_VOLTAGE_OUT_OF_RANGE", severity: "unsafe", message: `${load.componentId} requires ${load.voltageMin}-${load.voltageMax} V, while ${load.supplyId} provides ${supply.voltage} V.` });
      }
    }
    if (load.gpioDirect && (motorLike || load.current === undefined || !load.gpioComponentId || load.current > (byId.get(load.gpioComponentId)?.gpio?.maxCurrent ?? -1))) {
      findings.push({ code: "GPIO_LOAD_REQUIRES_DRIVER", severity: "unsafe", message: `${load.componentId} must not be connected directly to a GPIO; specify a correctly rated driver stage and protection.` });
    }
    if (motorLike && !load.driverComponentId) findings.push({ code: "DRIVER_NOT_SPECIFIED", severity: "unsafe", message: `${load.componentId} has no driver component specified.` });
    else if (load.driverComponentId && !byId.has(load.driverComponentId)) findings.push({ code: "DRIVER_UNKNOWN", severity: "unsafe", message: `${load.componentId} names missing driver ${load.driverComponentId}.` });
    else if (load.driverComponentId) {
      const driver = byId.get(load.driverComponentId)!;
      if (driver.driver?.maxCurrent === undefined) missing.push({ parameter: `${driver.id}.driver.maxCurrent`, reason: "Driver current rating must be sourced from its exact datasheet." });
      else if (load.current !== undefined && load.current > driver.driver.maxCurrent) findings.push({ code: "DRIVER_CURRENT_EXCEEDED", severity: "unsafe", message: `${driver.id} current rating ${driver.driver.maxCurrent} A is below ${load.componentId} load current ${load.current} A.` });
    }
    for (const protection of load.requiredProtection ?? []) {
      if (load.protectionPresent === undefined) findings.push({ code: "PROTECTION_UNKNOWN", severity: "review", message: `Presence of required ${protection} protection for ${load.componentId} has not been confirmed.` });
      else if (!load.protectionPresent.includes(protection)) findings.push({ code: "PROTECTION_MISSING", severity: "unsafe", message: `${load.componentId} requires protection element '${protection}'.` });
    }
    if (load.dissipation === undefined || load.thermalLimit === undefined) missing.push({ parameter: `${load.componentId}.thermal`, reason: "Thermal dissipation and component thermal limit need documented values and conditions." });
    else if (load.dissipation > load.thermalLimit) findings.push({ code: "THERMAL_LIMIT_EXCEEDED", severity: "unsafe", message: `${load.componentId} dissipation ${load.dissipation} W exceeds thermal limit ${load.thermalLimit} W.` });
    else findings.push({ code: "THERMAL_REVIEW_REQUIRED", severity: "review", message: `${load.componentId} thermal margin still needs review against ambient temperature, PCB copper, enclosure, and derating.` });
  }
  for (const supply of input.supplies) {
    const total = currentBySupply.get(supply.id) ?? 0;
    if (supply.ratedCurrent !== undefined && supply.ratedCurrent !== null) {
      checked.push({ parameter: `${supply.id}.loadCurrent`, value: { total, rated: supply.ratedCurrent } });
      if (total > supply.ratedCurrent) findings.push({ code: "SUPPLY_CURRENT_EXCEEDED", severity: "unsafe", message: `${supply.id} load current ${total} A exceeds its rating ${supply.ratedCurrent} A.` });
    }
  }

  const checkedInterfaces: string[] = [];
  for (const link of input.interfaces) {
    if (!byId.has(link.from) || !byId.has(link.to)) { findings.push({ code: "INTERFACE_ENDPOINT_UNKNOWN", severity: "unsafe", message: `${link.protocol} endpoint ${link.from} or ${link.to} is not in the component list.` }); continue; }
    if (link.compatible === undefined) missing.push({ parameter: `interface.${link.protocol}.${link.from}.${link.to}`, reason: "Document protocol mode, voltage domain, and exact endpoint capabilities in both datasheets." });
    else if (!link.compatible) findings.push({ code: "INTERFACE_INCOMPATIBLE", severity: "unsafe", message: `${link.protocol} compatibility is documented as incompatible for ${link.from} and ${link.to}.` });
    else { checkedInterfaces.push(link.protocol); checked.push({ parameter: `interface.${link.protocol}`, value: "compatible" }); }
    if (link.pullupsRequired === true && link.pullupsPresent === false) findings.push({ code: `${link.protocol}_PULLUP_MISSING`, severity: "unsafe", message: `${link.protocol} requires pull-ups but none are present.` });
    else if ((link.protocol === "I2C" || link.pullupsRequired === undefined) && link.pullupsPresent == null) findings.push({ code: `${link.protocol}_PULLUP_UNKNOWN`, severity: "review", message: `${link.protocol} pull-up requirement/presence is unknown; verify bus topology and resistor values.` });
    if (link.levelShifterRequired === true && link.levelShifterPresent === false) findings.push({ code: "LEVEL_SHIFTER_MISSING", severity: "unsafe", message: `${link.protocol} requires a level shifter but none is present.` });
    else if (link.levelShifterRequired == null || link.levelShifterPresent == null) findings.push({ code: "LEVEL_SHIFTING_UNKNOWN", severity: "review", message: `${link.protocol} voltage-domain level shifting has not been established.` });
  }

  const connectionTable = input.connections.map(connection => Object.freeze({ component: connection.componentId, contact: connection.pin, net: connection.net, ...(connection.voltage !== undefined ? { voltage: connection.voltage } : {}), direction: connection.direction }));
  const designNets = new Set(connectionTable.map(connectionKey));
  const netlistNets = new Set((input.kicadNetlistConnections ?? []).map(row => `${row.componentId}.${row.pin}=${row.net}`));
  const designOnly = [...designNets].filter(connection => !netlistNets.has(connection)).sort();
  const netlistOnly = [...netlistNets].filter(connection => !designNets.has(connection)).sort();
  if ((input.kicadNetlistConnections ?? []).length && (designOnly.length || netlistOnly.length)) findings.push({ code: "KICAD_NETLIST_MISMATCH", severity: "review", message: "Design connection table and KiCad netlist differ; reconcile before relying on the compatibility report." });
  const status: EngineeringStatus = findings.some(item => item.severity === "unsafe") ? "UNSAFE" : missing.length ? "NEEDS_DATASHEET" : findings.length || designOnly.length || netlistOnly.length ? "NEEDS_REVIEW" : "PASS";
  const base = artifact("electronics.electrical.validate", status, 0, "", "", findings.map(item => item.message), checked, missing, [], ["Electrical checks are design-level screening only. They do not guarantee physical electrical safety or replace qualified schematic, layout, thermal, and standards review."], true);
  return Object.freeze({ ...base, findings: Object.freeze(findings), connectionTable: Object.freeze(connectionTable), checkedInterfaces: Object.freeze(checkedInterfaces), netlistReconciliation: Object.freeze({ designOnly: Object.freeze(designOnly), netlistOnly: Object.freeze(netlistOnly) }) });
}

function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isCurrency(value: unknown): value is string { return typeof value === "string" && /^[A-Z]{3}$/.test(value); }
function validUrl(value: unknown): value is string { if (typeof value !== "string" || !value.trim()) return false; try { const parsed = new URL(value); return parsed.protocol === "https:" || parsed.protocol === "http:"; } catch { return false; } }
function validTimestamp(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function connectionKey(connection: ElectricalCompatibilityReport["connectionTable"][number]): string { return `${connection.component}.${connection.contact}=${connection.net}`; }

const COMPONENT_PARAMETERS = ["supplyVoltage", "logicHigh", "logicLow", "gpioMaxCurrent", "loadCurrent", "reversePolarityProtection", "fuseRequirement", "powerDissipation", "thermalLimit", "i2cCompatibility", "spiCompatibility", "uartCompatibility", "pwmCompatibility", "pullupRequirements", "levelShiftingRequirements"] as const;
const NUMERIC_PARAMETERS = new Set(["supplyVoltage", "logicHigh", "logicLow", "gpioMaxCurrent", "loadCurrent", "powerDissipation", "thermalLimit"]);
function toolCapabilities(id: string): readonly string[] {
  if (id.startsWith("electronics.kicad.")) return ["electronics", "kicad"];
  if (id.startsWith("electronics.ngspice.")) return ["electronics", "ngspice"];
  if (id.startsWith("electronics.components.") || id === "electronics.bom.validate" || id === "electronics.electrical.validate") return ["electronics", "component-validation"];
  return ["electronics", "embedded-build"];
}
function documented(value: DocumentedParameter | undefined): value is DocumentedParameter { return Boolean(value && value.source?.trim() && value.confidence === "documented" && value.unit?.trim() && (value.value !== undefined || value.min !== undefined || value.max !== undefined)); }
function artifact(toolId: string, status: EngineeringStatus, exitCode: number | null, stdout: string, stderr: string, warnings: readonly string[], checkedParameters: EngineeringArtifact["checkedParameters"], unconfirmedParameters: EngineeringArtifact["unconfirmedParameters"], createdFiles: readonly string[], recommendations: readonly string[], executed: boolean, reason?: string): EngineeringArtifact {
  return Object.freeze({ toolId, status, exitCode, stdout, stderr, warnings: Object.freeze([...warnings]), checkedParameters: Object.freeze([...checkedParameters]), unconfirmedParameters: Object.freeze([...unconfirmedParameters]), createdFiles: Object.freeze([...createdFiles]), recommendations: Object.freeze([...recommendations]), executed, ...(reason ? { reason } : {}) });
}
function withPlatformioDiagnostics(result: EngineeringArtifact, details: { command: string; workspace: string; effectiveCliPath: string | null; coreDir: string; durationMs: number }): EngineeringArtifact {
  return Object.freeze({ ...result, command: details.command, workspace: details.workspace, effectiveCliPath: details.effectiveCliPath, effectivePlatformioCoreDir: details.coreDir, durationMs: details.durationMs });
}
function bounded(value: number, min: number, max: number, name: string): number { if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${name} must be between ${min} and ${max}`); return value; }
function stringInput(value: unknown, name: string): string { if (typeof value !== "string" || !value.trim() || value.length > 512 || value.includes("\0")) throw new TypeError(`${name} must be a non-empty relative project path`); return value; }
function numeric(value: unknown, name: string, allowZero = false): number { if (typeof value !== "number" || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new TypeError(`${name} must be a ${allowZero ? "non-negative" : "positive"} finite number`); return value; }
async function artifactDirectory(root: string): Promise<string> { const out = join(root, ".mao-electronics", "artifacts"); await mkdir(out, { recursive: true }); assertWithin(root, await realpath(out)); return out; }
async function prepareOutputFiles(root: string, files: readonly string[]): Promise<void> {
  for (const file of files) {
    assertWithin(root, resolve(file));
    try { const info = await lstat(file); if (info.isSymbolicLink() || !info.isFile()) throw new TypeError("Engineering output path must not be a symlink or directory"); }
    catch (error) { if (error instanceof TypeError) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
async function resolveWorkspaceFile(root: string, value: string, ext: string): Promise<string> {
  const candidate = resolve(root, value);
  assertWithin(root, candidate);
  if (candidate.toLowerCase().endsWith(ext) === false) throw new TypeError(`Expected a ${ext} project file`);
  const canonical = await realpath(candidate); assertWithin(await realpath(root), canonical);
  const info = await stat(canonical); if (!info.isFile()) throw new TypeError("Input must be a regular project file");
  return canonical;
}
function assertWithin(root: string, target: string): void { const rel = relative(root, target); if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Object.assign(new Error("Path escapes the registered project workspace"), { code: "workspace_path_denied" }); }
async function readNetlist(file: string): Promise<string> { const { readFile } = await import("node:fs/promises"); const content = await readFile(file, "utf8"); if (content.length > 1024 * 1024) throw new RangeError("SPICE netlist exceeds 1 MiB"); return content; }
async function validateSpiceIncludes(root: string, content: string): Promise<void> {
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*\*/.test(line)) continue;
    const match = line.match(/^\s*\.(?:include|inc|lib)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
    if (!match) continue;
    const name = match[1] ?? match[2] ?? match[3];
    if (!name || isAbsolute(name)) throw new TypeError("SPICE model includes must use paths inside the registered project workspace");
    const candidate = resolve(root, name);
    assertWithin(root, candidate);
    const canonical = await realpath(candidate);
    assertWithin(await realpath(root), canonical);
    if (!(await stat(canonical)).isFile()) throw new TypeError("SPICE model include must be a project file");
  }
}
function commandExists(command: string): boolean { const paths = (process.env.PATH ?? "").split(delimiter); return paths.some(path => { try { accessSync(join(path, command), constants.X_OK); return true; } catch { return false; } }); }
async function runProcess(command: string, args: readonly string[], options: { cwd: string; workspaceRoot: string; timeoutMs: number; maxOutputBytes: number; networkRestricted?: boolean; platformioCoreDir?: string; readOnlyBindPaths?: readonly string[] }): Promise<ProcessResult> {
  const home = join(options.workspaceRoot, ".mao-electronics", "home");
  const temp = join(options.workspaceRoot, ".mao-electronics", "tmp");
  await Promise.all([mkdir(home, { recursive: true }), mkdir(temp, { recursive: true })]);
  assertWithin(await realpath(options.workspaceRoot), await realpath(home));
  assertWithin(await realpath(options.workspaceRoot), await realpath(temp));
  const relativeTmpRoot = relative("/tmp", options.workspaceRoot);
  if (relativeTmpRoot !== ".." && !relativeTmpRoot.startsWith(`..${sep}`) && !isAbsolute(relativeTmpRoot)) await mkdir(join(temp, relativeTmpRoot), { recursive: true });
  const startedAt = Date.now();
  return new Promise(resolvePromise => {
    let stdout = ""; let stderr = ""; let timedOut = false; let settled = false;
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: "/tmp", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
    const executable = commandExistsAbsolute(command);
    const argsInSandbox = ["--die-with-parent", "--ro-bind", "/", "/", "--bind", options.workspaceRoot, options.workspaceRoot, "--bind", temp, "/tmp", "--bind", options.workspaceRoot, options.workspaceRoot, "--proc", "/proc", "--dev", "/dev", ...(options.readOnlyBindPaths ?? []).flatMap(path => ["--ro-bind", path, path]), ...(options.networkRestricted ? ["--unshare-net"] : []), "--chdir", options.cwd, "--clearenv", "--setenv", "PATH", env.PATH, "--setenv", "HOME", env.HOME, "--setenv", "TMPDIR", env.TMPDIR, "--setenv", "LANG", env.LANG, "--setenv", "LC_ALL", env.LC_ALL, ...(options.platformioCoreDir ? ["--setenv", "PLATFORMIO_CORE_DIR", options.platformioCoreDir] : []), "--", executable, ...args];
    const child = spawn("bwrap", argsInSandbox, { cwd: options.cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const add = (current: string, chunk: Buffer) => (current + chunk.toString("utf8")).slice(-options.maxOutputBytes);
    child.stdout.on("data", chunk => { stdout = add(stdout, chunk); }); child.stderr.on("data", chunk => { stderr = add(stderr, chunk); });
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, options.timeoutMs);
    child.on("error", error => { stderr += `${stderr ? "\n" : ""}${error.message}`; });
    child.on("close", code => { if (settled) return; settled = true; clearTimeout(timeout); const blocked = code !== 0 && /^bwrap:/im.test(stderr); resolvePromise({ exitCode: code, stdout, stderr, timedOut, blocked, durationMs: Date.now() - startedAt }); });
  });
}
function commandExistsAbsolute(command: string): string { for (const path of (process.env.PATH ?? "/usr/bin:/bin").split(delimiter)) { const candidate = join(path, command); try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* try next PATH entry */ } } return command; }
function existsInWorkspace(root: string, path: string): boolean { try { const rel = relative(root, path); return (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) && statSync(path).isFile(); } catch { return false; } }
async function collectTextArtifacts(root: string, paths: readonly string[], maxBytes: number): Promise<{ text: string[]; missing: string[] }> {
  const text: string[] = []; const missing: string[] = [];
  for (const path of paths) {
    if (!existsInWorkspace(root, path)) { missing.push(path); continue; }
    if (path.endsWith(".raw")) continue;
    try { const content = await readFile(path, "utf8"); text.push(`--- ${relative(root, path)} ---\n${content.slice(-maxBytes)}`); }
    catch { missing.push(path); }
  }
  return { text, missing };
}
function extractWarnings(...values: string[]): string[] { return values.join("\n").split(/\r?\n/).map(line => line.trim()).filter(line => /\bwarning\b|\bwarn\b/i.test(line)).slice(0, 100); }
async function parsePlatformioConfig(config: string, requested: unknown): Promise<EngineeringArtifact> {
  const { readFile } = await import("node:fs/promises"); const text = await readFile(config, "utf8");
  const sections = new Map<string, Map<string, string>>(); let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[;#].*$/, "").trim(); if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/); if (header) { section = header[1]; if (!sections.has(section)) sections.set(section, new Map()); continue; }
    const entry = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/); if (section && entry) sections.get(section)!.set(entry[1], entry[2]);
  }
  const names = [...sections.keys()].filter(name => name.startsWith("env:"));
  const selected = typeof requested === "string" ? `env:${requested}` : names.length === 1 ? names[0] : "";
  const values = sections.get(selected);
  if (!values || !selected) return artifact("electronics.platformio.inspect", "FAIL", 2, "", names.length ? `Select one environment: ${names.map(name => name.slice(4)).join(", ")}` : "No [env:<name>] environment found", [], [], [{ parameter: "platformio.environment", reason: "A valid selected environment is required." }], [], ["Add an [env:<name>] section with platform and board values."], false);
  const platform = values.get("platform"); const board = values.get("board");
  const missing = [!platform ? "platformio.platform" : undefined, !board ? "platformio.board" : undefined].filter((parameter): parameter is string => Boolean(parameter)).map(parameter => ({ parameter, reason: "Required by the selected environment; configure an explicit board and platform." }));
  const framework = values.get("framework");
  return artifact("electronics.platformio.inspect", missing.length ? "FAIL" : "PASS", missing.length ? 2 : 0, "", missing.map(item => item.parameter).join(", "), [], [{ parameter: "platformio.environment", value: selected.slice(4) }, ...(platform ? [{ parameter: "platformio.platform", value: platform }] : []), ...(board ? [{ parameter: "platformio.board", value: board }] : []), ...(framework ? [{ parameter: "platformio.framework", value: framework }] : [])], missing, [], ["Inspection does not install platform packages or upload firmware."], false);
}
async function inspectPlatformio(root: string, input: Record<string, unknown>): Promise<EngineeringArtifact> {
  try { const file = await resolveWorkspaceFile(root, stringInput(input.config, "config"), ".ini"); return await parsePlatformioConfig(file, input.environment); }
  catch (error) { const message = error instanceof Error ? error.message : "Invalid PlatformIO project"; return artifact("electronics.platformio.inspect", "BLOCKED", null, "", message, [], [], [], [], ["Correct the platformio.ini path and retry within the registered project workspace."], false, message); }
}

async function inspectPlatformioBuildPrerequisites(root: string, coreDir: string, config: string, inspected: EngineeringArtifact): Promise<{ missing: string[]; checked: EngineeringArtifact["checkedParameters"]; readOnlyPaths: string[] }> {
  const value = (parameter: string) => inspected.checkedParameters.find(item => item.parameter === parameter)?.value;
  const platform = value("platformio.platform"); const board = value("platformio.board"); const framework = value("platformio.framework");
  const missing: string[] = []; const checked: EngineeringArtifact["checkedParameters"][number][] = [{ parameter: "platformio.coreDir", value: coreDir }]; const readOnlyPaths: string[] = [];
  if (!await isWorkspaceDirectory(root, coreDir)) missing.push(".mao-electronics/home/.platformio (task-workspace Core directory missing or outside workspace)");
  const platformName = typeof platform === "string" ? platform : "";
  if (!/^[A-Za-z0-9_.-]+$/.test(platformName)) return { missing: ["platformio.platform must resolve to a preinstalled named platform"], checked, readOnlyPaths };
  const platformsDir = join(coreDir, "platforms"); const platformDir = join(platformsDir, platformName);
  if (!await isWorkspaceDirectory(root, platformsDir)) missing.push(`platforms/${platformName}`);
  if (!await isWorkspaceDirectory(root, platformDir)) missing.push(`platforms/${platformName}`);
  let manifest: { frameworks?: Record<string, { package?: string }>; packages?: Record<string, { type?: string; optional?: boolean }> } | undefined;
  try { manifest = JSON.parse(await readFile(join(platformDir, "platform.json"), "utf8")) as typeof manifest; }
  catch { missing.push(`platforms/${platformName}/platform.json`); }
  if (manifest && typeof board === "string" && /^[A-Za-z0-9_.-]+$/.test(board)) {
    if (!await isWorkspaceFile(root, join(platformDir, "boards", `${board}.json`))) missing.push(`platforms/${platformName}/boards/${board}.json`);
  } else if (typeof board !== "string") missing.push("platformio.board");
  const frameworkNames = typeof framework === "string" ? framework.split(/[;,\s]+/).filter(Boolean) : [];
  const frameworkPackages = frameworkNames.map(name => manifest?.frameworks?.[name]?.package).filter((name): name is string => Boolean(name));
  if (frameworkNames.length && frameworkPackages.length !== frameworkNames.length) missing.push(`platforms/${platformName} framework metadata`);
  const requiredPackages = new Set([
    ...Object.entries(manifest?.packages ?? {}).filter(([, details]) => details.type === "toolchain" && details.optional !== true).map(([name]) => name),
    ...frameworkPackages,
    "tool-scons",
  ]);
  const packagesDir = join(coreDir, "packages");
  if (!await isWorkspaceDirectory(root, packagesDir)) missing.push("packages/");
  for (const packageName of requiredPackages) {
    if (!/^[A-Za-z0-9_.-]+$/.test(packageName) || !await isWorkspaceDirectory(root, join(packagesDir, packageName))) missing.push(`packages/${packageName}`);
  }
  if (await isWorkspaceDirectory(root, platformsDir)) readOnlyPaths.push(await realpath(platformsDir));
  if (await isWorkspaceDirectory(root, packagesDir)) readOnlyPaths.push(await realpath(packagesDir));
  const configText = await readFile(config, "utf8");
  if (/^\s*(?:lib_deps|platform_packages)\s*=/im.test(configText)) missing.push("configured lib_deps/platform_packages are not verified as preinstalled by this adapter");
  checked.push({ parameter: "platformio.availablePreinstalledPackages", value: [...requiredPackages] });
  return { missing: [...new Set(missing)], checked, readOnlyPaths: [...new Set(readOnlyPaths)] };
}

async function isWorkspaceDirectory(root: string, path: string): Promise<boolean> {
  try { const canonical = await realpath(path); assertWithin(await realpath(root), canonical); return (await stat(canonical)).isDirectory(); }
  catch { return false; }
}
async function isWorkspaceFile(root: string, path: string): Promise<boolean> {
  try { const canonical = await realpath(path); assertWithin(await realpath(root), canonical); return (await stat(canonical)).isFile(); }
  catch { return false; }
}
function shellDisplayArgument(value: string): string { return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value); }
function firstLine(value: string): string { return value.split(/\r?\n/, 1)[0]?.slice(0, 300) ?? ""; }

export interface ElectronicsEmployee { readonly id?: string; readonly professionId: string; readonly skills: readonly string[]; }
export interface ElectronicsTaskDispatcher {
  readonly projectId: string; readonly taskId: string; readonly executionId: string; readonly workspaceRoot: string;
  readonly tools: readonly EngineeringTool[]; readonly summaries: readonly ToolSummary[]; readonly mcpServer: RuntimeMcpServerConfig;
  invoke(toolId: string, input: unknown): Promise<EngineeringArtifact>;
}
export function electronicsCapabilitiesForEmployee(employee: ElectronicsEmployee): readonly string[] {
  const capabilities = new Set(employee.skills);
  if (["electronics-engineer", "electrical-engineer", "embedded-engineer"].includes(employee.professionId)) for (const item of CAPABILITIES) capabilities.add(item);
  return Object.freeze([...capabilities]);
}
export function filterElectronicsToolsByCapabilities(tools: readonly EngineeringTool[], capabilities: readonly string[]): readonly EngineeringTool[] {
  const allowed = new Set(capabilities); return tools.filter(tool => tool.capabilities?.some(capability => allowed.has(capability)) ?? false);
}
export function createTaskElectronicsDispatcher(options: { projectId: string; taskId: string; executionId: string; workspaceRoot: string; employee: ElectronicsEmployee }): ElectronicsTaskDispatcher {
  if (!isAbsolute(options.workspaceRoot)) throw new TypeError("workspaceRoot must be absolute");
  const workspaceRoot = resolve(options.workspaceRoot); const capabilities = electronicsCapabilitiesForEmployee(options.employee);
  const toolset = createElectronicsTools({ workspaceRoot }); const tools = filterElectronicsToolsByCapabilities(toolset.tools, capabilities); const allowed = new Map(tools.map(tool => [tool.id, tool]));
  const serverPath = fileURLToPath(new URL("./mcp-server.js", import.meta.url));
  const approvedToolIds = CODEX_APPROVED_ELECTRONICS_TOOLS.filter(toolId => allowed.has(toolId));
  const launch = { workspaceRoot, allowedToolIds: [...allowed.keys()], employeeCapabilities: capabilities, approvedToolIds };
  const mcpServer: RuntimeMcpServerConfig = Object.freeze({ name: "mao_electronics", command: process.execPath, args: Object.freeze([serverPath, JSON.stringify(launch)]), allowedTools: Object.freeze([...allowed.keys()]), approvedToolIds: Object.freeze([...approvedToolIds]) });
  return Object.freeze({ projectId: options.projectId, taskId: options.taskId, executionId: options.executionId, workspaceRoot, tools: Object.freeze(tools), summaries: Object.freeze(tools.map(({ id, name, description, inputSchema, capabilities: toolCapabilities, annotations }) => Object.freeze({ id, name, description, inputSchema, capabilities: toolCapabilities, ...(annotations ? { annotations } : {}) }))), mcpServer, async invoke(toolId: string, input: unknown) { const tool = allowed.get(toolId); if (!tool) throw Object.assign(new Error(`Tool ${toolId} is not available to ${options.employee.professionId}`), { code: "tool_not_allowed" }); return tool.execute(input as Record<string, unknown>); } });
}
