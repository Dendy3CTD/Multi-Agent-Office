import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type RuntimeMcpServerConfig, type ToolDefinition, type ToolSummary } from "@mao-hybrid/contracts";

export type CadStatus = "PASS" | "FAIL" | "BLOCKED" | "NEEDS_REVIEW";
export interface CadArtifact {
  readonly toolId: string;
  readonly status: CadStatus;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly warnings: readonly string[];
  readonly checkedParameters: readonly { readonly parameter: string; readonly value: unknown; readonly source?: string }[];
  readonly unconfirmedParameters: readonly { readonly parameter: string; readonly reason: string; readonly source?: string }[];
  readonly createdFiles: readonly string[];
  readonly recommendations: readonly string[];
  readonly executed: boolean;
  readonly reason?: string;
  readonly durationMs?: number;
  readonly command?: string;
  readonly workspace?: string;
  readonly engineVersion?: string;
}
export interface CadEmployee { readonly id: string; readonly professionId: string; readonly skills: readonly string[]; }
export interface CadOptions { readonly workspaceRoot: string; readonly taskId?: string; readonly timeoutMs?: number; readonly maxOutputBytes?: number; readonly commandAvailability?: (command: string) => boolean; }
export interface CadTaskDispatcher {
  readonly projectId: string; readonly taskId: string; readonly executionId: string; readonly workspaceRoot: string;
  readonly tools: readonly ToolDefinition<Record<string, unknown>, CadArtifact>[];
  readonly summaries: readonly ToolSummary[];
  readonly mcpServer?: RuntimeMcpServerConfig;
  invoke(toolId: string, input: unknown): Promise<CadArtifact>;
}

const CAPABILITIES = Object.freeze(["cad", "3d"]);
const APPROVED_CAD_TOOLS = Object.freeze([
  "cad.capabilities", "cad.model.create", "cad.model.inspect", "cad.model.validate", "cad.assembly.inspect",
  "cad.export.step", "cad.export.stl", "cad.export.glb", "cad.drawing.generate", "cad.render.preview",
]);
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_SPEC_BYTES = 1024 * 1024;
const MAX_MODEL_INPUT_BYTES = 100 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const MODEL_ID = "esp32-c3-supermini-enclosure";
const PARAMETRIC_ASSEMBLY_ID = "mao-parametric-assembly";
type CadTool = ToolDefinition<Record<string, unknown>, CadArtifact>;
type WorkerReport = Record<string, unknown> & { ok?: boolean; error?: string; version?: string; parameters?: Record<string, unknown>; assumptions?: unknown[]; files?: Record<string, string>; checks?: Record<string, unknown>; shapes?: unknown[]; componentDimensions?: unknown[]; clearanceChecks?: unknown[]; featureHistory?: unknown[] };
interface ProcessOutput { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; blocked: boolean; durationMs: number; }

export function cadCapabilitiesForEmployee(employee: CadEmployee): readonly string[] {
  const values = new Set(employee.skills);
  if (["cad-engineer", "mechanical-engineer", "mechanical-design-engineer"].includes(employee.professionId)) for (const value of CAPABILITIES) values.add(value);
  return Object.freeze([...values]);
}
export function filterCadToolsByCapabilities(tools: readonly CadTool[], capabilities: readonly string[]): readonly CadTool[] {
  const allowed = new Set(capabilities);
  return tools.filter(tool => tool.capabilities?.some(capability => allowed.has(capability)) ?? false);
}

export function createCadTools(options: CadOptions): { readonly tools: readonly CadTool[]; get(id: string): CadTool | undefined } {
  if (!isAbsolute(options.workspaceRoot)) throw new TypeError("workspaceRoot must be an absolute registered project path");
  const root = realpathSync(options.workspaceRoot);
  const taskId = options.taskId ?? "cad-local";
  if (!statSync(root).isDirectory()) throw new TypeError("workspaceRoot must be a directory");
  const timeoutMs = bounded(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 900_000, "timeoutMs");
  const maxOutputBytes = bounded(options.maxOutputBytes ?? MAX_OUTPUT_BYTES, 4_096, 4 * MAX_OUTPUT_BYTES, "maxOutputBytes");
  const available = options.commandAvailability ?? commandExists;
  const tools: CadTool[] = [];
  const add = (id: string, description: string, schema: Record<string, unknown>, execute: (input: Record<string, unknown>) => Promise<CadArtifact>) => {
    tools.push(Object.freeze({ id, name: id, description, inputSchema: Object.freeze(schema), capabilities: CAPABILITIES, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, async execute(input: Record<string, unknown>) {
      try { return await execute(input); }
      catch (error) { return blocked(id, root, error instanceof Error ? error.message : "CAD input or geometry operation failed", false); }
    } }));
  };
  const engineAvailable = () => available("freecadcmd") || available("FreeCADCmd");
  const engineCommand = () => available("freecadcmd") ? "freecadcmd" : "FreeCADCmd";
  const fileSchema = { type: "object", required: ["model"], additionalProperties: false, properties: { model: { type: "string", minLength: 1, maxLength: 512 } } };

  add("cad.capabilities", "Detect installed CAD engines, PartDesign operations, drawing converters, and independent GLB validators.", { type: "object", additionalProperties: false }, async () => {
    if (!engineAvailable()) return blocked("cad.capabilities", root, "FreeCADCmd is not installed or not available on PATH", false);
    const result = await runSandboxedCommand(root, engineCommand(), ["--version"], timeoutMs, maxOutputBytes);
    const version = `${result.stdout}\n${result.stderr}`.match(/FreeCAD\s+([0-9][^\s,]*)/i)?.[1];
    const status = result.blocked || result.timedOut ? "BLOCKED" : result.exitCode === 0 && version ? "PASS" : "FAIL";
    return artifact("cad.capabilities", status, result.exitCode, result.stdout, result.stderr, [], [
      { parameter: "FreeCADCmd.version", value: version ?? "not detected" },
      { parameter: "export.step", value: Boolean(version) }, { parameter: "export.stl", value: Boolean(version) },
      { parameter: "export.glb", value: "supported by the package STL-to-GLB writer and structural re-reader" },
      { parameter: "drawing.svg", value: true }, { parameter: "drawing.pdf", value: available("chromium") && available("pdfinfo") && available("pdftotext") },
      { parameter: "freecad.sketcherAndPartDesign", value: "checked by actual sketch/pad/pocket geometry fixture" },
      { parameter: "glb.independentValidator", value: commandExists("gltf-validator") || commandExists("assimp") },
      { parameter: "secondaryEngines", value: { gmsh: commandExists("gmsh"), openscad: commandExists("openscad"), blender: commandExists("blender"), cadquery: false } },
    ], [], [], ["CAD engine discovery does not certify design geometry or manufacturability."], status === "PASS", root, result.durationMs, result.blocked ? "CAD command sandbox could not be established" : undefined, `${engineCommand()} --version`);
  });

  add("cad.model.create", "Create a parameterized enclosure or primitive-based mechanical part from a project JSON specification and export/re-read STEP and STL.", {
    type: "object", required: ["spec"], additionalProperties: false, properties: { spec: { type: "string", minLength: 1, maxLength: 512 } },
  }, async input => {
    const specPath = await resolveWorkspaceFile(root, stringInput(input.spec, "spec"), ".json").catch(error => { throw error; });
    const spec = await readJsonSpec(specPath);
    validateCadSpec(spec);
    if (!engineAvailable()) return blocked("cad.model.create", root, "FreeCADCmd is not installed or not available on PATH", false);
    const outputDir = await taskOutputDirectory(root, taskId);
    const modelPrefix = spec.modelId === MODEL_ID ? "esp32-c3-supermini-enclosure" : "parametric-model";
    const sourcePath = join(outputDir, `${modelPrefix}.FCMacro`);
    const reportPath = join(outputDir, "geometry.json");
    const assumptionsPath = join(outputDir, "assumptions.csv");
    const modelPath = join(outputDir, `${modelPrefix}.FCStd`);
    const stepPath = join(outputDir, `${modelPrefix}.step`);
    const stlPath = join(outputDir, `${modelPrefix}.stl`);
    const request = { action: "create", spec, outputDir, reportPath, modelPath, stepPath, stlPath };
    const run = await runWorker(root, request, sourcePath, timeoutMs, maxOutputBytes);
    const report = await readWorkerReport(reportPath);
    await writeFile(assumptionsPath, assumptionsCsv(report?.assumptions), { flag: "wx", mode: 0o600 });
    const ok = run.exitCode === 0 && !run.blocked && !run.timedOut && report?.ok === true && report.checks?.stepReimport === true && report.checks?.stlReimport === true;
    const created = await existingRelativeFiles(root, [sourcePath, modelPath, stepPath, stlPath, reportPath, assumptionsPath]);
    const assumptions = unconfirmedFrom(report?.assumptions);
    const checkParams = [
      ...recordParameters(report?.parameters),
      ...recordParameters(report?.checks).map(item => ({ ...item, parameter: `geometry.${item.parameter}` })),
      ...(Array.isArray(report?.componentDimensions) ? [{ parameter: "geometry.componentDimensions", value: report.componentDimensions }] : []),
      ...(Array.isArray(report?.clearanceChecks) ? [{ parameter: "geometry.clearanceChecks", value: report.clearanceChecks }] : []),
      ...(Array.isArray(report?.featureHistory) ? [{ parameter: "geometry.featureHistory", value: report.featureHistory.map(item => isRecord(item) ? { type: item.type, name: item.name, valid: item.valid } : item) }] : []),
    ];
    const status = ok ? "PASS" : run.blocked || run.timedOut || !report ? "BLOCKED" : "FAIL";
    const recommendations = spec.modelId === MODEL_ID
      ? ["The enclosure is generated from documented fixture assumptions; measure the target board and verify hole locations before manufacturing.", "Review print orientation, material, fasteners, connector access, thermal behavior, and fit before use."]
      : ["Review part dimensions, manufacturing process, material, load, and assembly clearances before use."];
    return artifact("cad.model.create", status, run.blocked || run.timedOut ? null : run.exitCode, run.stdout, appendError(run.stderr, report?.error), stringArray(report?.warnings), checkParams, assumptions, created, recommendations, !run.blocked, root, run.durationMs, run.blocked ? "filesystem/network sandbox could not be established" : run.timedOut ? "FreeCAD command timed out" : !report ? "FreeCAD did not produce a structured geometry report" : undefined, `${engineCommand()} ${sourcePath}`);
  });

  add("cad.model.inspect", "Inspect a FreeCAD document or STEP solid and return measured geometry.", fileSchema, input => inspectModel("cad.model.inspect", root, input, engineAvailable, engineCommand, timeoutMs, maxOutputBytes));
  add("cad.model.validate", "Validate solid topology, dimensions, wall assumptions, and exported STEP/STL re-import results.", fileSchema, input => inspectModel("cad.model.validate", root, input, engineAvailable, engineCommand, timeoutMs, maxOutputBytes));
  add("cad.assembly.inspect", "Inspect component intersections and clearances in a FreeCAD assembly document.", fileSchema, input => inspectModel("cad.assembly.inspect", root, input, engineAvailable, engineCommand, timeoutMs, maxOutputBytes));
  add("cad.export.step", "Export and re-read a STEP solid assembly from a FreeCAD document.", fileSchema, input => exportModel("cad.export.step", "step", root, input, engineAvailable, engineCommand, timeoutMs, maxOutputBytes));
  add("cad.export.stl", "Export and re-read a watertight STL mesh from a FreeCAD document.", fileSchema, input => exportModel("cad.export.stl", "stl", root, input, engineAvailable, engineCommand, timeoutMs, maxOutputBytes));
  add("cad.export.glb", "Export a binary glTF 2.0 model by converting a measured FreeCAD STL mesh and validate its GLB chunks.", fileSchema, input => exportGlb(root, input, engineAvailable, engineCommand, timeoutMs, maxOutputBytes));
  add("cad.drawing.generate", "Generate a dimensioned SVG and, when local headless converters are available, a checked PDF drawing.", fileSchema, input => generateDrawing(root, input, available, timeoutMs, maxOutputBytes));
  add("cad.render.preview", "Generate a deterministic isometric SVG preview from the model's exported mesh.", fileSchema, input => generatePreview(root, input, engineAvailable, engineCommand, timeoutMs, maxOutputBytes));
  const byId = new Map(tools.map(tool => [tool.id, tool]));
  return Object.freeze({ tools: Object.freeze(tools), get: (id: string) => byId.get(id) });
}

export function createTaskCadDispatcher(options: { projectId: string; taskId: string; executionId: string; workspaceRoot: string; employee: CadEmployee }): CadTaskDispatcher {
  if (!isAbsolute(options.workspaceRoot)) throw new TypeError("workspaceRoot must be absolute");
  const workspaceRoot = resolve(options.workspaceRoot);
  const all = createCadTools({ workspaceRoot, taskId: options.taskId });
  const capabilities = cadCapabilitiesForEmployee(options.employee);
  const tools = filterCadToolsByCapabilities(all.tools, capabilities);
  const allowed = new Map(tools.map(tool => [tool.id, tool]));
  const serverPath = fileURLToPath(new URL("./mcp-server.js", import.meta.url));
  const approvedToolIds = APPROVED_CAD_TOOLS.filter(id => allowed.has(id));
  const launch = { projectId: options.projectId, taskId: options.taskId, executionId: options.executionId, workspaceRoot, allowedToolIds: [...allowed.keys()], employeeCapabilities: capabilities, approvedToolIds, employee: options.employee };
  const mcpServer: RuntimeMcpServerConfig | undefined = tools.length ? Object.freeze({ name: "mao_cad", command: process.execPath, args: Object.freeze([serverPath, JSON.stringify(launch)]), allowedTools: Object.freeze([...allowed.keys()]), approvedToolIds: Object.freeze(approvedToolIds) }) : undefined;
  return Object.freeze({ projectId: options.projectId, taskId: options.taskId, executionId: options.executionId, workspaceRoot, tools: Object.freeze(tools), summaries: Object.freeze(tools.map(({ id, name, description, inputSchema, capabilities: toolCapabilities, annotations }) => Object.freeze({ id, name, description, inputSchema, capabilities: toolCapabilities, ...(annotations ? { annotations } : {}) }))), ...(mcpServer ? { mcpServer } : {}), async invoke(toolId: string, input: unknown) {
    const tool = allowed.get(toolId);
    if (!tool) throw Object.assign(new Error(`Tool ${toolId} is not available to ${options.employee.professionId}`), { code: "tool_not_allowed" });
    return tool.execute(input as Record<string, unknown>);
  } });
}

async function inspectModel(toolId: string, root: string, input: Record<string, unknown>, engineAvailable: () => boolean, command: () => string, timeoutMs: number, maxOutputBytes: number): Promise<CadArtifact> {
  const model = await resolveModelFile(root, stringInput(input.model, "model"));
  if (!engineAvailable()) return blocked(toolId, root, "FreeCADCmd is not installed or not available on PATH", false);
  const dir = await taskOutputDirectory(root, "cad-inspect"); const reportPath = join(dir, `inspect-${randomUUID()}.json`);
  const macroPath = join(dir, `.inspect-${randomUUID()}.FCMacro`);
  const result = await runWorker(root, { action: toolId === "cad.assembly.inspect" ? "assembly" : "inspect", modelPath: model, reportPath }, macroPath, timeoutMs, maxOutputBytes);
  await unlink(macroPath).catch(() => undefined);
  const report = await readWorkerReport(reportPath); await unlink(reportPath).catch(() => undefined);
  const valid = result.exitCode === 0 && report?.ok === true;
  const assumptions = unconfirmedFrom(report?.assumptions);
  const status = result.blocked || result.timedOut || !report ? "BLOCKED" : !valid ? "FAIL" : assumptions.length ? "NEEDS_REVIEW" : "PASS";
  return artifact(toolId, status, result.blocked || result.timedOut ? null : result.exitCode, result.stdout, appendError(result.stderr, report?.error), stringArray(report?.warnings), recordParameters(report?.checks), assumptions, [], status === "PASS" ? ["Geometric validity does not certify fit, load capacity, material behavior, or manufacturing safety."] : status === "NEEDS_REVIEW" ? ["The geometry is valid, but fixture dimensions and fit assumptions need confirmation against the exact board revision before manufacture."] : ["Repair the model or resolve the reported geometry issue, then re-run inspection."], !result.blocked, root, result.durationMs, result.blocked ? "filesystem/network sandbox could not be established" : result.timedOut ? "FreeCAD inspection timed out" : status === "NEEDS_REVIEW" ? "fixture geometry assumptions require engineering review" : undefined, `${command()} ${macroPath}`);
}

async function exportModel(toolId: string, format: "step" | "stl", root: string, input: Record<string, unknown>, engineAvailable: () => boolean, command: () => string, timeoutMs: number, maxOutputBytes: number): Promise<CadArtifact> {
  const model = await resolveModelFile(root, stringInput(input.model, "model"));
  if (!model.toLowerCase().endsWith(".fcstd")) return blocked(toolId, root, "STEP/STL export currently requires a native FreeCAD .FCStd document", false);
  if (!engineAvailable()) return blocked(toolId, root, "FreeCADCmd is not installed or not available on PATH", false);
  const dir = await taskOutputDirectory(root, "cad-export"); const target = join(dir, `export-${randomUUID()}.${format}`); const reportPath = `${target}.json`; const macro = join(dir, `.export-${randomUUID()}.FCMacro`);
  const result = await runWorker(root, { action: "export", format, modelPath: model, outputPath: target, reportPath }, macro, timeoutMs, maxOutputBytes);
  await unlink(macro).catch(() => undefined);
  const report = await readWorkerReport(reportPath); await unlink(reportPath).catch(() => undefined);
  const exists = await existingRelativeFiles(root, [target]); const ok = result.exitCode === 0 && report?.ok === true && exists.length === 1;
  return artifact(toolId, result.blocked || result.timedOut || !report ? "BLOCKED" : ok ? "PASS" : "FAIL", result.blocked || result.timedOut ? null : result.exitCode, result.stdout, appendError(result.stderr, report?.error), stringArray(report?.warnings), recordParameters(report?.checks), [], exists, [], !result.blocked, root, result.durationMs, result.blocked ? "filesystem/network sandbox could not be established" : result.timedOut ? "FreeCAD export timed out" : undefined, `${command()} ${macro}`);
}

async function exportGlb(root: string, input: Record<string, unknown>, engineAvailable: () => boolean, command: () => string, timeoutMs: number, maxOutputBytes: number): Promise<CadArtifact> {
  const model = await resolveModelFile(root, stringInput(input.model, "model"));
  if (!model.toLowerCase().endsWith(".fcstd")) return blocked("cad.export.glb", root, "GLB export currently requires a native FreeCAD .FCStd document", false);
  if (!engineAvailable()) return blocked("cad.export.glb", root, "FreeCADCmd is not installed or not available on PATH", false);
  const dir = await taskOutputDirectory(root, "cad-export"); const suffix = randomUUID(); const stl = join(dir, `mesh-${suffix}.stl`); const macro = join(dir, `.glb-${suffix}.FCMacro`); const reportPath = join(dir, `.glb-${suffix}.json`); const glb = join(dir, `assembly-${suffix}.glb`);
  const result = await runWorker(root, { action: "export", format: "stl", modelPath: model, outputPath: stl, reportPath }, macro, timeoutMs, maxOutputBytes);
  await unlink(macro).catch(() => undefined); const report = await readWorkerReport(reportPath); await unlink(reportPath).catch(() => undefined);
  if (result.exitCode !== 0 || result.blocked || result.timedOut || report?.ok !== true) {
    await unlink(stl).catch(() => undefined);
    return artifact("cad.export.glb", result.blocked || result.timedOut || !report ? "BLOCKED" : "FAIL", result.blocked || result.timedOut ? null : result.exitCode, result.stdout, appendError(result.stderr, report?.error), [], [], [], [], [], !result.blocked, root, result.durationMs, result.blocked ? "filesystem/network sandbox could not be established" : result.timedOut ? "FreeCAD mesh export timed out" : undefined);
  }
  try {
    const mesh = await readFile(stl); const glbBytes = stlToGlb(mesh); await writeFile(glb, glbBytes, { flag: "wx", mode: 0o600 });
    const check = await validateGlb(await readFile(glb));
    await unlink(stl).catch(() => undefined);
    const independentAvailable = commandExists("gltf-validator") || commandExists("assimp");
    const warnings = independentAvailable ? ["An independent GLB validator is installed but not configured by this package; only package-reader validation was run."] : ["GLB structure and accessor geometry passed the package reader. Independent validation is BLOCKED because neither gltf-validator nor assimp is installed; visual verification was not performed."];
    const checked = [
      { parameter: "glb.structure.status", value: check.structureValid ? "PASS" : "FAIL" },
      { parameter: "glb.geometry.status", value: check.geometryValid ? "PASS" : "FAIL" },
      { parameter: "glb.visual.status", value: "NOT_VERIFIED" },
      { parameter: "glb.independent.status", value: "BLOCKED" },
      { parameter: "glb.vertexCount", value: check.vertexCount }, { parameter: "glb.triangleCount", value: check.triangleCount }, { parameter: "glb.boundsMm", value: check.bounds },
    ];
    return artifact("cad.export.glb", check.ok ? "PASS" : "FAIL", result.exitCode, JSON.stringify({ freecad: report.checks, glb: check }), result.stderr, warnings, checked, [], await existingRelativeFiles(root, [glb]), [], true, root, result.durationMs, undefined, `${command()} ${macro}`);
  } catch (error) {
    await unlink(stl).catch(() => undefined); await unlink(glb).catch(() => undefined);
    return blocked("cad.export.glb", root, error instanceof Error ? error.message : "STL to GLB conversion failed", true);
  }
}

async function generateDrawing(root: string, input: Record<string, unknown>, available: (command: string) => boolean, timeoutMs: number, maxOutputBytes: number): Promise<CadArtifact> {
  const model = await resolveModelFile(root, stringInput(input.model, "model")); const geometryPath = model.endsWith(".FCStd") ? join(dirname(model), "geometry.json") : "";
  if (!geometryPath || !(await fileInside(root, geometryPath))) return blocked("cad.drawing.generate", root, "A geometry.json report next to the native model is required to dimension the drawing", false);
  const report = await readWorkerReport(geometryPath); if (!report?.ok) return blocked("cad.drawing.generate", root, "The associated geometry report is missing or invalid", false);
  const parameters = isRecord(report.parameters) ? report.parameters : {}; const dimensions = isRecord(parameters.outerMm) ? parameters.outerMm : {};
  const width = finite(dimensions.width); const length = finite(dimensions.length); const height = finite(dimensions.height);
  if (!width || !length || !height) return blocked("cad.drawing.generate", root, "The model report does not contain measured enclosure bounds", false);
  const dir = dirname(model); const output = join(dir, "dimensioned-drawing.svg"); const pdfPath = join(dir, "dimensioned-drawing.pdf");
  await writeFile(output, dimensionedSvg(width, length, height, report.modelId === MODEL_ID), { flag: "wx", mode: 0o600 });
  const checked: { parameter: string; value: unknown }[] = [
    { parameter: "drawing.widthMm", value: width }, { parameter: "drawing.lengthMm", value: length }, { parameter: "drawing.heightMm", value: height },
    { parameter: "drawing.svg.status", value: "PASS" }, { parameter: "drawing.pdf.status", value: "BLOCKED" },
  ];
  const warnings: string[] = [];
  const chromium = available("chromium") ? "chromium" : available("chromium-browser") ? "chromium-browser" : undefined;
  if (!chromium || !available("pdfinfo") || !available("pdftotext")) {
    warnings.push("PDF generation is BLOCKED: headless Chromium, pdfinfo, and pdftotext are all required; the SVG drawing was generated.");
    return artifact("cad.drawing.generate", "PASS", 0, "Generated measured dimensioned SVG; PDF converter tools are unavailable.", "", warnings, checked, unconfirmedFrom(report.assumptions), await existingRelativeFiles(root, [output]), ["Install approved local SVG-to-PDF tools to enable PDF output."], true, root, 0);
  }
  const profile = join(root, ".mao-cad", "tmp", `chromium-cad-${randomUUID()}`);
  await ensureNoSymlinkPath(root, profile); await mkdir(profile, { recursive: true });
  const args = ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-pdf-header-footer", `--user-data-dir=${profile}`, `--print-to-pdf=${pdfPath}`, pathToFileURL(output).href];
  const conversion = await runSandboxedCommand(root, chromium, args, timeoutMs, maxOutputBytes);
  await rm(profile, { recursive: true, force: true });
  const pdfPresent = await fileInside(root, pdfPath);
  if (conversion.exitCode !== 0 || conversion.blocked || conversion.timedOut || !pdfPresent) {
    const reason = conversion.blocked ? "bubblewrap denied the local PDF conversion" : conversion.timedOut ? "headless Chromium PDF conversion timed out" : conversion.stderr || "headless Chromium did not create a PDF";
    warnings.push(`PDF generation failed: ${reason}`);
    checked[4] = { parameter: "drawing.pdf.status", value: conversion.blocked || conversion.timedOut ? "BLOCKED" : "FAIL" };
    return artifact("cad.drawing.generate", "NEEDS_REVIEW", conversion.exitCode, conversion.stdout, conversion.stderr, warnings, checked, unconfirmedFrom(report.assumptions), await existingRelativeFiles(root, [output]), ["Inspect the SVG and resolve the PDF conversion failure before accepting the drawing."], true, root, conversion.durationMs, reason, `${chromium} ${args.join(" ")}`);
  }
  const info = await runSandboxedCommand(root, "pdfinfo", [pdfPath], timeoutMs, maxOutputBytes);
  const extracted = await runSandboxedCommand(root, "pdftotext", [pdfPath, "-"], timeoutMs, maxOutputBytes);
  const pageCount = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
  const dimensionsPresent = [width, length, height].every(value => extracted.stdout.includes(String(value)));
  if (info.exitCode !== 0 || extracted.exitCode !== 0 || info.blocked || extracted.blocked || info.timedOut || extracted.timedOut || pageCount < 1 || !dimensionsPresent) {
    const reason = "PDF was written but pdfinfo/pdftotext could not confirm readable pages and all dimension labels";
    warnings.push(reason);
    checked[4] = { parameter: "drawing.pdf.status", value: "FAIL" };
    return artifact("cad.drawing.generate", "NEEDS_REVIEW", info.exitCode, conversion.stdout, [conversion.stderr, info.stderr, extracted.stderr].filter(Boolean).join("\n"), warnings, checked, unconfirmedFrom(report.assumptions), await existingRelativeFiles(root, [output, pdfPath]), ["Review the generated PDF with an approved PDF reader."], true, root, conversion.durationMs + info.durationMs + extracted.durationMs, reason);
  }
  checked[4] = { parameter: "drawing.pdf.status", value: "PASS" };
  checked.push({ parameter: "drawing.pdf.pages", value: pageCount }, { parameter: "drawing.pdf.dimensionsPresent", value: dimensionsPresent });
  return artifact("cad.drawing.generate", "PASS", 0, [conversion.stdout, `pdfinfo: ${info.stdout}`, `pdftotext: ${extracted.stdout}`].join("\n"), [conversion.stderr, info.stderr, extracted.stderr].filter(Boolean).join("\n"), warnings, checked, unconfirmedFrom(report.assumptions), await existingRelativeFiles(root, [output, pdfPath]), ["A valid drawing PDF confirms its page structure and dimension text, not physical fit or manufacturing suitability."], true, root, conversion.durationMs + info.durationMs + extracted.durationMs, undefined, `${chromium} ${args.join(" ")}`);
}

async function generatePreview(root: string, input: Record<string, unknown>, engineAvailable: () => boolean, command: () => string, timeoutMs: number, maxOutputBytes: number): Promise<CadArtifact> {
  const model = await resolveModelFile(root, stringInput(input.model, "model")); if (!model.endsWith(".FCStd")) return blocked("cad.render.preview", root, "Preview currently requires a native FreeCAD .FCStd document", false);
  const dir = dirname(model); const stl = join(dir, `.preview-${randomUUID()}.stl`); const macro = join(dir, `.preview-${randomUUID()}.FCMacro`); const reportPath = join(dir, `.preview-${randomUUID()}.json`);
  if (!engineAvailable()) return blocked("cad.render.preview", root, "FreeCADCmd is not installed or not available on PATH", false);
  const result = await runWorker(root, { action: "export", format: "stl", modelPath: model, outputPath: stl, reportPath }, macro, timeoutMs, maxOutputBytes);
  await unlink(macro).catch(() => undefined); await unlink(reportPath).catch(() => undefined);
  if (result.exitCode !== 0 || result.blocked || result.timedOut) { await unlink(stl).catch(() => undefined); return blocked("cad.render.preview", root, result.blocked ? "filesystem/network sandbox could not be established" : result.timedOut ? "FreeCAD preview mesh timed out" : result.stderr || "FreeCAD could not export preview mesh", !result.blocked); }
  try { const svg = stlToPreview(await readFile(stl)); const output = join(dir, "isometric-preview.svg"); await writeFile(output, svg, { flag: "wx", mode: 0o600 }); await unlink(stl).catch(() => undefined); return artifact("cad.render.preview", "PASS", result.exitCode, "Generated isometric SVG preview from the re-exported FreeCAD mesh.", result.stderr, [], [], [], await existingRelativeFiles(root, [output]), [], true, root, result.durationMs); }
  catch (error) { await unlink(stl).catch(() => undefined); return blocked("cad.render.preview", root, error instanceof Error ? error.message : "Preview generation failed", true); }
}

async function runWorker(root: string, request: Record<string, unknown>, macroPath: string, timeoutMs: number, maxOutputBytes: number): Promise<ProcessOutput> {
  const worker = await readFile(fileURLToPath(new URL("./freecad-worker.py", import.meta.url)), "utf8");
  const macroSource = `${worker}\n\nREQUEST = json.loads(${pythonString(JSON.stringify(request))})\nrun_request(REQUEST)\n`;
  await assertWritableWithin(root, macroPath); await writeFile(macroPath, macroSource, { flag: "wx", mode: 0o600 });
  return runSandboxedCommand(root, commandExists("freecadcmd") ? "freecadcmd" : "FreeCADCmd", [macroPath], timeoutMs, maxOutputBytes);
}

async function runSandboxedCommand(root: string, command: string, args: readonly string[], timeoutMs: number, maxOutputBytes: number): Promise<ProcessOutput> {
  if (!commandExists("bwrap")) return { exitCode: null, stdout: "", stderr: "bubblewrap is unavailable; CAD command was blocked because filesystem/network boundaries could not be enforced", timedOut: false, blocked: true, durationMs: 0 };
  const workspace = await realpath(root); const internal = join(workspace, ".mao-cad"); await ensureNoSymlinkPath(workspace, internal); await mkdir(internal, { recursive: true });
  const temp = join(internal, "tmp"); await ensureNoSymlinkPath(workspace, temp); await mkdir(temp, { recursive: true });
  const home = join(internal, "home"); await ensureNoSymlinkPath(workspace, home); await mkdir(home, { recursive: true });
  const executable = resolveCommand(command); if (!executable) return { exitCode: null, stdout: "", stderr: `${command} is not installed or not available on PATH`, timedOut: false, blocked: false, durationMs: 0 };
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: temp, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  const argsInSandbox = ["--die-with-parent", "--ro-bind", "/", "/", "--bind", workspace, workspace, "--proc", "/proc", "--dev", "/dev", "--unshare-net", "--chdir", workspace, "--clearenv", "--setenv", "PATH", env.PATH, "--setenv", "HOME", env.HOME, "--setenv", "TMPDIR", env.TMPDIR, "--setenv", "LANG", env.LANG, "--setenv", "LC_ALL", env.LC_ALL, "--", executable, ...args];
  const started = Date.now();
  return new Promise(resolveProcess => {
    let stdout = ""; let stderr = ""; let timedOut = false; let settled = false;
    const child = spawn("bwrap", argsInSandbox, { cwd: workspace, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const append = (current: string, chunk: Buffer) => (current + chunk.toString("utf8")).slice(-maxOutputBytes);
    child.stdout.on("data", chunk => { stdout = append(stdout, chunk); }); child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", error => { stderr = append(stderr, Buffer.from(error.message)); });
    child.on("close", code => { if (settled) return; settled = true; clearTimeout(timer); const sandboxFailure = code !== 0 && /^bwrap:/im.test(stderr); resolveProcess({ exitCode: code, stdout, stderr, timedOut, blocked: sandboxFailure, durationMs: Date.now() - started }); });
  });
}

async function readJsonSpec(path: string): Promise<Record<string, unknown>> { if ((await stat(path)).size > MAX_SPEC_BYTES) throw new TypeError("CAD JSON specification exceeds the 1 MiB size limit"); const value: unknown = JSON.parse(await readFile(path, "utf8")); if (!isRecord(value)) throw new TypeError("CAD specification must be a JSON object"); return value; }
function validateCadSpec(spec: Record<string, unknown>): void {
  if (spec.modelId === "mao-parametric-part") { validateParametricPartSpec(spec); return; }
  if (spec.modelId === PARAMETRIC_ASSEMBLY_ID) { validateParametricAssemblySpec(spec); return; }
  validateEnclosureSpec(spec);
}
function validateParametricAssemblySpec(spec: Record<string, unknown>): void {
  if (spec.units !== "mm" || !isRecord(spec.parameters) || !Array.isArray(spec.parameters.components) || !spec.parameters.components.length || spec.parameters.components.length > 32 || !Array.isArray(spec.assumptions) || spec.assumptions.length > 100) throw new TypeError("Parametric assembly specification must declare modelId=mao-parametric-assembly, units=mm, 1-32 components, and assumptions");
  const ids = new Set<string>();
  for (const component of spec.parameters.components) {
    if (!isRecord(component) || typeof component.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(component.id) || ids.has(component.id)) throw new TypeError("Assembly component IDs must be unique safe names");
    ids.add(component.id); validateVector(component.positionMm ?? [0, 0, 0], "positionMm", 100_000); validateVector(component.rotationDeg ?? [0, 0, 0], "rotationDeg", 360);
    if (component.referenceOnly === true) {
      if (!validComponentDimensions(component.dimensionsMm) || typeof component.source !== "string" || !["assumed", "verified", "unknown"].includes(String(component.confidence))) throw new TypeError(`Reference component ${component.id} needs declared dimensions, source, and confidence`);
    } else {
      validateProfile(component.profile);
      if (!positiveDimension(component.baseHeightMm, 10_000) || !Array.isArray(component.features) || component.features.length > 64) throw new TypeError(`Component ${component.id} needs a positive baseHeightMm and at most 64 features`);
      for (const feature of component.features) validateAssemblyFeature(feature, component.id);
      if (component.dimensionsMm !== undefined && (!validComponentDimensions(component.dimensionsMm) || typeof component.source !== "string" || !["assumed", "verified", "unknown"].includes(String(component.confidence)))) throw new TypeError(`Component ${component.id} declared dimensions need width/length/height, source, and confidence`);
    }
    if (component.tolerancesMm !== undefined && (!isRecord(component.tolerancesMm) || !positiveOrZero(component.tolerancesMm.linear, 100) || typeof component.tolerancesMm.source !== "string")) throw new TypeError(`Component ${component.id} tolerancesMm must include a non-negative linear tolerance and source`);
  }
  if (spec.parameters.clearanceRequirements !== undefined) {
    if (!Array.isArray(spec.parameters.clearanceRequirements) || spec.parameters.clearanceRequirements.length > 128) throw new TypeError("clearanceRequirements must be an array with at most 128 entries");
    for (const requirement of spec.parameters.clearanceRequirements) if (!isRecord(requirement) || !Array.isArray(requirement.components) || requirement.components.length !== 2 || requirement.components.some(id => typeof id !== "string" || !ids.has(id)) || !positiveOrZero(requirement.nominalGapMm, 10_000) || !positiveOrZero(requirement.toleranceMm, 100) || typeof requirement.source !== "string" || !["assumed", "verified", "unknown"].includes(String(requirement.confidence))) throw new TypeError("Each clearance requirement must name two components and provide nominalGapMm, toleranceMm, source, and confidence");
  }
  if (spec.parameters.nominalParameters !== undefined) {
    if (!isRecord(spec.parameters.nominalParameters)) throw new TypeError("nominalParameters must be an object");
    for (const [name, value] of Object.entries(spec.parameters.nominalParameters)) if (!isRecord(value) || !positiveDimension(value.value, 10_000) || !positiveOrZero(value.toleranceMm, 100) || typeof value.source !== "string" || !["assumed", "verified", "unknown"].includes(String(value.confidence))) throw new TypeError(`Nominal parameter ${name} must state value, toleranceMm, source, and confidence`);
  }
}
function validateAssemblyFeature(input: unknown, componentId: string): void {
  if (!isRecord(input) || typeof input.type !== "string") throw new TypeError(`Component ${componentId} has an invalid feature`);
  if (input.type === "pad" || input.type === "extrude") {
    validateProfile(input.profile);
    if (!positiveDimension(input.heightMm, 10_000) || (input.planeZmm !== undefined && !finiteDimension(input.planeZmm, 100_000))) throw new TypeError(`${input.type} needs a positive heightMm and optional planeZmm`);
  } else if (input.type === "pocket") {
    validateProfile(input.profile);
    if (!positiveDimension(input.depthMm, 10_000) || (input.planeZmm !== undefined && !finiteDimension(input.planeZmm, 100_000)) || (input.reversed !== undefined && typeof input.reversed !== "boolean")) throw new TypeError("pocket needs a positive depthMm, optional planeZmm, and boolean reversed flag");
  } else if (input.type === "hole_array") {
    if (!positiveDimension(input.diameterMm, 10_000) || !Array.isArray(input.centersMm) || !input.centersMm.length || input.centersMm.length > 256 || input.centersMm.some(center => !Array.isArray(center) || center.length !== 2 || center.some(value => !finiteDimension(value, 100_000))) || !positiveDimension(input.depthMm, 10_000) || (input.planeZmm !== undefined && !finiteDimension(input.planeZmm, 100_000))) throw new TypeError("hole_array needs a positive diameterMm/depthMm and 1-256 finite XY centers");
  } else if (input.type === "fillet" || input.type === "chamfer") {
    const dimension = input.type === "fillet" ? input.radiusMm : input.sizeMm;
    if (!positiveDimension(dimension, 100) || !Array.isArray(input.edgeNames) || !input.edgeNames.length || input.edgeNames.length > 32 || input.edgeNames.some(edge => typeof edge !== "string" || !/^Edge[1-9][0-9]{0,5}$/.test(edge))) throw new TypeError(`${input.type} needs a positive bounded radius/size and explicit EdgeN names`);
  } else throw new TypeError(`Unsupported feature ${input.type}; use pad, extrude, pocket, hole_array, fillet, or chamfer`);
}
function validateProfile(input: unknown): void {
  if (!isRecord(input) || typeof input.type !== "string") throw new TypeError("Sketch profile must be rectangle, circle, or circle-array");
  if (input.type === "rectangle") {
    if (!positiveDimension(input.widthMm, 10_000) || !positiveDimension(input.lengthMm, 10_000) || (input.positionMm !== undefined && (!Array.isArray(input.positionMm) || input.positionMm.length !== 2 || input.positionMm.some(value => !finiteDimension(value, 100_000))))) throw new TypeError("rectangle profile needs positive widthMm/lengthMm and optional finite XY positionMm");
  } else if (input.type === "circle") {
    if (!positiveDimension(input.diameterMm, 10_000) || (input.centerMm !== undefined && (!Array.isArray(input.centerMm) || input.centerMm.length !== 2 || input.centerMm.some(value => !finiteDimension(value, 100_000))))) throw new TypeError("circle profile needs positive diameterMm and optional finite centerMm");
  } else if (input.type === "circle-array") {
    if (!positiveDimension(input.diameterMm, 10_000) || !Array.isArray(input.centersMm) || !input.centersMm.length || input.centersMm.length > 256 || input.centersMm.some(center => !Array.isArray(center) || center.length !== 2 || center.some(value => !finiteDimension(value, 100_000)))) throw new TypeError("circle-array profile needs positive diameterMm and 1-256 finite XY centers");
  } else throw new TypeError("Sketch profile type must be rectangle, circle, or circle-array");
}
function validateParametricPartSpec(spec: Record<string, unknown>): void {
  if (spec.units !== "mm" || !isRecord(spec.parameters) || !Array.isArray(spec.parameters.parts) || !spec.parameters.parts.length || spec.parameters.parts.length > 32 || !Array.isArray(spec.assumptions)) throw new TypeError("Parametric CAD specification must declare modelId=mao-parametric-part, units=mm, 1-32 parts, and assumptions");
  const ids = new Set<string>();
  for (const part of spec.parameters.parts) {
    if (!isRecord(part) || typeof part.id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(part.id) || ids.has(part.id) || !isRecord(part.base) || !Array.isArray(part.features) || part.features.length > 64) throw new TypeError("Each parametric part needs a unique safe ID, a base primitive, and at most 64 boolean features");
    ids.add(part.id); validatePrimitive(part.base);
    for (const feature of part.features) {
      if (!isRecord(feature) || !["union", "cut"].includes(String(feature.operation)) || !isRecord(feature.shape)) throw new TypeError(`Part ${part.id} has an unsupported feature; use union or cut with a box or cylinder`);
      validatePrimitive(feature.shape);
    }
  }
}
function validateVector(input: unknown, name: string, limit: number): void { if (!Array.isArray(input) || input.length !== 3 || input.some(value => !finiteDimension(value, limit))) throw new TypeError(`${name} must contain three finite values within ±${limit}`); }
function validComponentDimensions(input: unknown): boolean { return isRecord(input) && ["width", "length", "height"].every(key => positiveDimension(input[key], 10_000)); }
function finiteDimension(value: unknown, limit: number): boolean { return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit; }
function positiveDimension(value: unknown, limit: number): boolean { return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= limit; }
function positiveOrZero(value: unknown, limit: number): boolean { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= limit; }
function validatePrimitive(shape: Record<string, unknown>): void {
  if (shape.type === "box") {
    if (!Array.isArray(shape.sizeMm) || shape.sizeMm.length !== 3 || shape.sizeMm.some(value => typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10_000)) throw new TypeError("Box sizeMm must contain three positive dimensions up to 10000 mm");
  } else if (shape.type === "cylinder") {
    if (typeof shape.diameterMm !== "number" || !Number.isFinite(shape.diameterMm) || shape.diameterMm <= 0 || shape.diameterMm > 10_000 || typeof shape.heightMm !== "number" || !Number.isFinite(shape.heightMm) || shape.heightMm <= 0 || shape.heightMm > 10_000) throw new TypeError("Cylinder diameterMm and heightMm must be positive and up to 10000 mm");
  } else throw new TypeError("CAD primitive type must be box or cylinder");
  if (shape.positionMm !== undefined && (!Array.isArray(shape.positionMm) || shape.positionMm.length !== 3 || shape.positionMm.some(value => typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 100_000))) throw new TypeError("Primitive positionMm must contain three finite coordinates within ±100000 mm");
}
function validateEnclosureSpec(spec: Record<string, unknown>): void {
  if (spec.modelId !== MODEL_ID || spec.units !== "mm" || !isRecord(spec.parameters) || !Array.isArray(spec.assumptions)) throw new TypeError(`CAD specification must declare modelId=${MODEL_ID}, units=mm, parameters, and assumptions`);
  const p = spec.parameters; const board = isRecord(p.board) ? p.board : undefined; const enclosure = isRecord(p.enclosure) ? p.enclosure : undefined;
  if (!board || !enclosure) throw new TypeError("CAD enclosure specification must provide board and enclosure parameters");
  for (const [key, value] of Object.entries({ boardWidth: board.width, boardLength: board.length, boardThickness: board.thickness, wallThickness: enclosure.wallThickness, floorThickness: enclosure.floorThickness, boardClearance: enclosure.boardClearance, coverClearance: enclosure.coverClearance, coverThickness: enclosure.coverThickness, standoffHeight: enclosure.standoffHeight, mountHoleInset: board.mountHoleInset, mountHoleDiameter: board.mountHoleDiameter, screwHoleDiameter: enclosure.screwHoleDiameter })) if (!Number.isFinite(value) || Number(value) <= 0 || Number(value) > 250) throw new TypeError(`CAD parameter ${key} must be a positive finite millimetre value up to 250`);
  if (Number(enclosure.screwHoleDiameter) >= Number(board.mountHoleDiameter) + 1) throw new TypeError("Mounting screw and board-hole diameters are incompatible");
}

async function resolveModelFile(root: string, path: string): Promise<string> {
  const ext = path.toLowerCase().endsWith(".fcstd") ? ".FCStd" : path.toLowerCase().endsWith(".step") || path.toLowerCase().endsWith(".stp") ? ".step" : path.toLowerCase().endsWith(".stl") ? ".stl" : path.toLowerCase().endsWith(".glb") ? ".glb" : "";
  if (!ext) throw new TypeError("model must reference an .FCStd, .step, .stp, .stl, or .glb file");
  return resolveWorkspaceFile(root, path, ext);
}
async function resolveWorkspaceFile(root: string, value: string, extension: string): Promise<string> {
  const rel = relativeInput(value); if (!rel.toLowerCase().endsWith(extension.toLowerCase())) throw new TypeError(`Expected a ${extension} project file`);
  const path = resolve(root, rel); assertWithin(root, path); const canonical = await realpath(path); assertWithin(await realpath(root), canonical);
  const inputStat = await stat(canonical);
  if (!inputStat.isFile()) throw new TypeError("CAD input must be a regular project file");
  if (inputStat.size > MAX_MODEL_INPUT_BYTES) throw new TypeError("CAD model input exceeds the 100 MiB size limit");
  return canonical;
}
function relativeInput(value: string): string { if (isAbsolute(value) || value.includes("\0") || value.split(/[\\/]/).includes("..")) throw new TypeError("CAD paths must be relative and cannot traverse outside the workspace"); return value.replaceAll("\\", "/"); }
async function taskOutputDirectory(root: string, taskId: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(taskId)) throw new TypeError("CAD task ID contains unsupported path characters");
  const base = join(root, ".mao-cad", "tasks"); await ensureNoSymlinkPath(root, base); await mkdir(base, { recursive: true });
  const target = join(base, taskId); await ensureNoSymlinkPath(root, target); await mkdir(target, { recursive: true });
  const canonical = await realpath(target); assertWithin(await realpath(root), canonical); return canonical;
}
async function ensureNoSymlinkPath(root: string, target: string): Promise<void> {
  assertWithin(root, target); const rel = relative(root, target); let cursor = root;
  for (const part of rel.split(sep).filter(Boolean)) { cursor = join(cursor, part); try { if ((await lstat(cursor)).isSymbolicLink()) throw new TypeError("CAD output paths cannot pass through symlinks"); } catch (error) { if (isRecord(error) && error.code === "ENOENT") continue; throw error; } }
}
async function assertWritableWithin(root: string, target: string): Promise<void> { const parent = await realpath(dirname(target)); assertWithin(await realpath(root), parent); await ensureNoSymlinkPath(root, target); }
async function fileInside(root: string, target: string): Promise<boolean> { try { const canonical = await realpath(target); assertWithin(await realpath(root), canonical); return (await stat(canonical)).isFile(); } catch { return false; } }
async function existingRelativeFiles(root: string, candidates: readonly string[]): Promise<string[]> { const files: string[] = []; const canonicalRoot = await realpath(root); for (const item of candidates) { try { const canonical = await realpath(item); assertWithin(canonicalRoot, canonical); if ((await stat(canonical)).isFile()) files.push(relative(canonicalRoot, canonical)); } catch { /* absent or unsafe artifacts are not reported as created */ } } return files; }
async function readWorkerReport(path: string): Promise<WorkerReport | undefined> { try { const result: unknown = JSON.parse(await readFile(path, "utf8")); return isRecord(result) ? result as WorkerReport : undefined; } catch { return undefined; } }
function artifact(toolId: string, status: CadStatus, exitCode: number | null, stdout: string, stderr: string, warnings: readonly string[], checkedParameters: readonly { parameter: string; value: unknown; source?: string }[], unconfirmedParameters: readonly { parameter: string; reason: string; source?: string }[], createdFiles: readonly string[], recommendations: readonly string[], executed: boolean, workspace: string, durationMs?: number, reason?: string, command?: string): CadArtifact { return Object.freeze({ toolId, status, exitCode, stdout: stdout.slice(-MAX_OUTPUT_BYTES), stderr: stderr.slice(-MAX_OUTPUT_BYTES), warnings: Object.freeze([...warnings]), checkedParameters: Object.freeze([...checkedParameters]), unconfirmedParameters: Object.freeze([...unconfirmedParameters]), createdFiles: Object.freeze([...createdFiles]), recommendations: Object.freeze([...recommendations]), executed, workspace, ...(durationMs === undefined ? {} : { durationMs }), ...(reason ? { reason } : {}), ...(command ? { command } : {}) }); }
function blocked(toolId: string, workspace: string, reason: string, executed: boolean): CadArtifact { return artifact(toolId, "BLOCKED", null, "", reason, [], [], [], [], ["Install or enable only user-approved local CAD tools, then retry within the registered workspace."], executed, workspace, 0, reason); }
function commandExists(command: string): boolean { return (process.env.PATH ?? "").split(delimiter).some(path => { try { accessSync(join(path, command), constants.X_OK); return true; } catch { return false; } }); }
function resolveCommand(command: string): string | undefined { for (const dir of (process.env.PATH ?? "/usr/bin:/bin").split(delimiter)) { const path = join(dir, command); try { accessSync(path, constants.X_OK); return path; } catch { /* try next PATH entry */ } } return undefined; }
function bounded(value: number, min: number, max: number, name: string): number { if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}`); return value; }
function stringInput(value: unknown, name: string): string { if (typeof value !== "string" || !value.trim() || value.length > 512) throw new TypeError(`${name} must be a non-empty string up to 512 characters`); return value.trim(); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function assertWithin(root: string, target: string): void { const rel = relative(resolve(root), resolve(target)); if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new TypeError("CAD path is outside the registered project workspace"); }
function recordParameters(input: unknown): { parameter: string; value: unknown }[] { if (!isRecord(input)) return []; return Object.entries(input).map(([parameter, value]) => ({ parameter, value })); }
function stringArray(input: unknown): string[] { return Array.isArray(input) ? input.filter((value): value is string => typeof value === "string") : []; }
function unconfirmedFrom(input: unknown): { parameter: string; reason: string; source?: string }[] { if (!Array.isArray(input)) return []; return input.filter(isRecord).map(item => ({ parameter: String(item.parameter ?? "unspecified"), reason: String(item.reason ?? "Fixture assumption requires verification"), ...(typeof item.source === "string" ? { source: item.source } : {}) })); }
function assumptionsCsv(input: unknown): string { const rows = ["parameter,reason,source"]; for (const item of unconfirmedFrom(input)) rows.push([item.parameter, item.reason, item.source ?? ""].map(value => `"${value.replaceAll('"', '""')}"`).join(",")); return `${rows.join("\n")}\n`; }
function appendError(stderr: string, error?: string): string { return [stderr, error].filter(Boolean).join("\n").slice(-MAX_OUTPUT_BYTES); }
function finite(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function pythonString(value: string): string { return JSON.stringify(value); }
function readU32(buffer: Buffer, offset: number): number { if (offset + 4 > buffer.length) throw new TypeError("STL mesh is truncated"); return buffer.readUInt32LE(offset); }
function readF32(buffer: Buffer, offset: number): number { if (offset + 4 > buffer.length) throw new TypeError("STL mesh is truncated"); const value = buffer.readFloatLE(offset); if (!Number.isFinite(value)) throw new TypeError("STL mesh contains non-finite coordinates"); return value; }
function stlTriangles(bytes: Buffer): number[][][] { if (bytes.length < 84) throw new TypeError("STL mesh is too short"); const count = readU32(bytes, 80); if (bytes.length !== 84 + count * 50 || count < 1 || count > 2_000_000) throw new TypeError("STL mesh has an invalid binary triangle count"); const triangles: number[][][] = []; let offset = 84; for (let i = 0; i < count; i++, offset += 50) { const tri: number[][] = []; for (let v = 0; v < 3; v++) { const p = offset + 12 + v * 12; tri.push([readF32(bytes, p), readF32(bytes, p + 4), readF32(bytes, p + 8)]); } triangles.push(tri); } return triangles; }
function stlToGlb(stl: Buffer): Buffer {
  const triangles = stlTriangles(stl); const vertices = triangles.flat(); const positions = Buffer.alloc(vertices.length * 12); const indices = Buffer.alloc(vertices.length * 4); const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach((v, index) => { for (let axis = 0; axis < 3; axis++) { positions.writeFloatLE(v[axis]!, index * 12 + axis * 4); min[axis] = Math.min(min[axis]!, v[axis]!); max[axis] = Math.max(max[axis]!, v[axis]!); } indices.writeUInt32LE(index, index * 4); });
  const bin = Buffer.concat([positions, indices]); const json = Buffer.from(JSON.stringify({ asset: { version: "2.0", generator: "MAO Hybrid CAD Tools / FreeCAD STL" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "MAO CAD Model" }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }], buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 }, { buffer: 0, byteOffset: positions.length, byteLength: indices.length, target: 34963 }], accessors: [{ bufferView: 0, componentType: 5126, count: vertices.length, type: "VEC3", min, max }, { bufferView: 1, componentType: 5125, count: vertices.length, type: "SCALAR" }] }), "utf8");
  const padJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]); const padBin = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]); const length = 12 + 8 + padJson.length + 8 + padBin.length; const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(length, 8); const jh = Buffer.alloc(8); jh.writeUInt32LE(padJson.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); const bh = Buffer.alloc(8); bh.writeUInt32LE(padBin.length, 0); bh.writeUInt32LE(0x004e4942, 4); return Buffer.concat([header, jh, padJson, bh, padBin]);
}
function validateGlb(bytes: Buffer): { ok: boolean; structureValid: boolean; geometryValid: boolean; vertexCount: number; triangleCount: number; bounds: { min: number[]; max: number[] } } {
  if (bytes.length < 28 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new TypeError("Generated GLB has an invalid binary glTF header");
  const jsonLength = bytes.readUInt32LE(12); if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength + 8 > bytes.length) throw new TypeError("Generated GLB JSON chunk is invalid");
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength)) as Record<string, unknown>; const binHeader = 20 + jsonLength; const binLength = bytes.readUInt32LE(binHeader); if (bytes.readUInt32LE(binHeader + 4) !== 0x004e4942 || binHeader + 8 + binLength !== bytes.length) throw new TypeError("Generated GLB binary chunk is invalid");
  const binaryStart = binHeader + 8; const views = json.bufferViews as Array<Record<string, unknown>>; const accessors = json.accessors as Array<Record<string, unknown>>; const position = accessors?.[0]; const indices = accessors?.[1];
  if (position?.componentType !== 5126 || position.type !== "VEC3" || indices?.componentType !== 5125 || indices.type !== "SCALAR") throw new TypeError("Generated GLB accessors use unsupported component or element types");
  const vertexCount = Number(position.count); const indexCount = Number(indices.count); const triangleCount = indexCount / 3; const positionView = views?.[Number(position.bufferView)]; const indexView = views?.[Number(indices.bufferView)];
  if (!(vertexCount >= 3) || !(triangleCount >= 1) || !Number.isInteger(triangleCount) || !positionView || !indexView) throw new TypeError("Generated GLB has invalid mesh accessors");
  const positionOffset = binaryStart + Number(positionView.byteOffset ?? 0) + Number(position.byteOffset ?? 0); const indexOffset = binaryStart + Number(indexView.byteOffset ?? 0) + Number(indices.byteOffset ?? 0);
  const positionBytes = vertexCount * 12; const indexBytes = indexCount * 4;
  if (positionOffset < binaryStart || indexOffset < binaryStart || positionOffset + positionBytes > bytes.length || indexOffset + indexBytes > bytes.length || Number(positionView.byteLength) < positionBytes || Number(indexView.byteLength) < indexBytes) throw new TypeError("Generated GLB accessors exceed their declared binary buffer views");
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  const vertices: number[][] = [];
  for (let i = 0; i < vertexCount; i++) { const vertex = [bytes.readFloatLE(positionOffset + i * 12), bytes.readFloatLE(positionOffset + i * 12 + 4), bytes.readFloatLE(positionOffset + i * 12 + 8)]; if (!vertex.every(Number.isFinite)) throw new TypeError("Generated GLB contains non-finite vertex coordinates"); for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis]!, vertex[axis]!); max[axis] = Math.max(max[axis]!, vertex[axis]!); } vertices.push(vertex); }
  const declaredMin = position.min as number[]; const declaredMax = position.max as number[];
  if (declaredMin?.length !== 3 || declaredMax?.length !== 3 || declaredMin.some((value, axis) => Math.abs(value - min[axis]!) > 1e-5) || declaredMax.some((value, axis) => Math.abs(value - max[axis]!) > 1e-5)) throw new TypeError("Generated GLB accessor bounds do not match the actual vertex data");
  const triangleIndices: number[] = [];
  for (let i = 0; i < indexCount; i++) { const index = bytes.readUInt32LE(indexOffset + i * 4); if (index >= vertexCount) throw new TypeError("Generated GLB index is outside the vertex accessor"); triangleIndices.push(index); }
  for (let i = 0; i < triangleIndices.length; i += 3) { const a = vertices[triangleIndices[i]!]!; const b = vertices[triangleIndices[i + 1]!]!; const c = vertices[triangleIndices[i + 2]!]!; const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]; const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]; const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!]; if (cross.reduce((sum, value) => sum + value * value, 0) < 1e-20) throw new TypeError("Generated GLB contains degenerate triangles"); }
  const bounds = { min, max }; return { ok: true, structureValid: true, geometryValid: true, vertexCount, triangleCount, bounds };
}
function dimensionedSvg(width: number, length: number, height: number, espFixture: boolean): string { const title = espFixture ? "ESP32-C3 SuperMini enclosure — fixture assumptions (mm)" : "MAO Hybrid parametric part — measured bounds (mm)"; const note = espFixture ? "Board outline, mounting-hole pattern and fit are assumptions. Verify against the exact board revision before manufacture." : "Dimensions show measured overall bounds. Review design intent, fit, material and manufacturing constraints."; return `<svg xmlns="http://www.w3.org/2000/svg" width="240mm" height="150mm" viewBox="0 0 960 600"><style>text{font:16px sans-serif;fill:#17212b}.dim{stroke:#264e70;stroke-width:1;fill:none}.part{stroke:#17212b;stroke-width:2;fill:#d9e8f5}</style><text x="36" y="32" font-size="22">${title}</text><rect class="part" x="90" y="100" width="${Math.round(width * 5)}" height="${Math.round(length * 5)}"/><text x="90" y="${130 + Math.round(length * 5)}">Top view ${width} × ${length}</text><path class="dim" d="M90 82v-12m${Math.round(width * 5)} 12v-12M90 76h${Math.round(width * 5)}"/><text x="${90 + Math.round(width * 2.5)}" y="67" text-anchor="middle">${width}</text><path class="dim" d="M${110 + Math.round(width * 5)} 100h12m-12 ${Math.round(length * 5)}h12m-6 -${Math.round(length * 5)}v${Math.round(length * 5)}"/><text x="${130 + Math.round(width * 5)}" y="${100 + Math.round(length * 2.5)}">${length}</text><rect class="part" x="590" y="100" width="${Math.round(width * 4)}" height="${Math.round(height * 4)}"/><text x="590" y="${130 + Math.round(height * 4)}">Side view / overall height ${height}</text><path class="dim" d="M${610 + Math.round(width * 4)} 100h12m-12 ${Math.round(height * 4)}h12m-6 -${Math.round(height * 4)}v${Math.round(height * 4)}"/><text x="${630 + Math.round(width * 4)}" y="${100 + Math.round(height * 2)}">${height}</text><text x="36" y="560">${note}</text></svg>`; }
function stlToPreview(bytes: Buffer): string { const tris = stlTriangles(bytes); const project = (p: number[]) => { const x = (p[0]! - p[1]!) * 0.866; const y = (p[0]! + p[1]!) * 0.5 - p[2]!; return [x, y, p[0]! + p[1]! + p[2]!]; }; const pts = tris.flatMap(tri => tri.map(project)); const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0])), minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1])); const scale = Math.min(700 / Math.max(1, maxX - minX), 420 / Math.max(1, maxY - minY)); const polygons = tris.map(tri => tri.map(p => project(p))).sort((a, b) => (a[0]![2]! + a[1]![2]! + a[2]![2]!) - (b[0]![2]! + b[1]![2]! + b[2]![2]!)).map(tri => `<polygon points="${tri.map(p => `${100 + (p[0]! - minX) * scale},${480 - (p[1]! - minY) * scale}`).join(" ")}" fill="#a8c7df" stroke="#24445c" stroke-width="0.5"/>`).join(""); return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560"><rect width="100%" height="100%" fill="#f7fafc"/><text x="24" y="32" font-family="sans-serif" font-size="20">FreeCAD mesh preview (isometric projection)</text>${polygons}</svg>`; }
