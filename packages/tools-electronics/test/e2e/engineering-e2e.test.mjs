import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElectronicsTools } from "../../dist/index.js";

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test("A: ngspice voltage divider produces a measured operating point or is explicitly sandbox-blocked", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mao-e2e-ngspice-"));
  await mkdir(join(root, "circuit"));
  await cp(join(packageRoot, "test/fixtures/voltage-divider.cir"), join(root, "circuit/divider.cir"));
  await cp(join(packageRoot, "test/fixtures/empty-sheet.kicad_sch"), join(root, "circuit/empty.kicad_sch"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await createElectronicsTools({ workspaceRoot: root }).get("electronics.ngspice.run").execute({ netlist: "circuit/divider.cir", analysis: "dc" });
  assert.ok(["PASS", "BLOCKED"].includes(result.status), JSON.stringify(result));
  if (result.status === "PASS") {
    assert.match(result.stdout, /5\.0{3,}e\+00/i);
    assert.ok(result.createdFiles.some(path => path.endsWith("ngspice.log")));
  } else assert.match(result.reason, /sandbox|unavailable/i);
  const erc = await createElectronicsTools({ workspaceRoot: root }).get("electronics.kicad.erc").execute({ schematic: "circuit/empty.kicad_sch" });
  assert.ok(["PASS", "BLOCKED"].includes(erc.status), JSON.stringify(erc));
  if (erc.status === "PASS") assert.match(erc.stdout, /"violations":\s*\[\]/);
  else assert.match(erc.reason, /sandbox|unavailable/i);
  for (const id of ["electronics.kicad.netlist", "electronics.kicad.bom"]) {
    const output = await createElectronicsTools({ workspaceRoot: root }).get(id).execute({ schematic: "circuit/empty.kicad_sch" });
    assert.ok(["PASS", "BLOCKED"].includes(output.status), JSON.stringify(output));
    if (output.status === "PASS") assert.ok(output.createdFiles.length === 1, JSON.stringify(output));
    else assert.match(output.reason, /sandbox|unavailable/i);
  }
});

test("A-error: malformed SPICE input is rejected and absent tools return BLOCKED", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mao-e2e-bad-netlist-"));
  await writeFile(join(root, "broken.cir"), "broken circuit\nV1 in 0 DC 5\n");
  await writeFile(join(root, "unsafe-include.cir"), "unsafe include\n.include /etc/passwd\n.end\n");
  await writeFile(join(root, "broken.kicad_sch"), "not a KiCad schematic\n");
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = createElectronicsTools({ workspaceRoot: root });
  const malformed = await tools.get("electronics.ngspice.run").execute({ netlist: "broken.cir", analysis: "dc" });
  assert.equal(malformed.status, "BLOCKED");
  assert.match(malformed.stderr, /\.end/);
  const unsafeInclude = await tools.get("electronics.ngspice.run").execute({ netlist: "unsafe-include.cir", analysis: "dc" });
  assert.equal(unsafeInclude.status, "BLOCKED");
  assert.match(unsafeInclude.stderr, /inside the registered project workspace/i);
  const invalidSchematic = await tools.get("electronics.kicad.erc").execute({ schematic: "broken.kicad_sch" });
  assert.ok(["FAIL", "BLOCKED"].includes(invalidSchematic.status));
  assert.equal(invalidSchematic.executed, true);
  const unavailable = await createElectronicsTools({ workspaceRoot: root, commandAvailability: () => false }).get("electronics.kicad.version").execute({});
  assert.equal(unavailable.status, "BLOCKED");
  assert.equal(unavailable.executed, false);
});

test("B: Arduino PlatformIO project is inspected and build is PASS or precisely BLOCKED", async (t) => {
  const workspace = resolve(packageRoot, "../..");
  await mkdir(join(workspace, ".mao-electronics"), { recursive: true });
  const root = await mkdtemp(join(workspace, ".mao-electronics", "e2e-platformio-"));
  await cp(join(packageRoot, "test/fixtures/platformio.ini"), join(root, "platformio.ini"));
  await cp(join(packageRoot, "test/fixtures/main.cpp"), join(root, "main.cpp"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = relative(workspace, join(root, "platformio.ini"));
  const tools = createElectronicsTools({ workspaceRoot: workspace });
  const inspected = await tools.get("electronics.platformio.inspect").execute({ config, environment: "uno" });
  assert.equal(inspected.status, "PASS");
  assert.ok(inspected.checkedParameters.some(param => param.parameter === "platformio.board" && param.value === "uno"));
  const result = await tools.get("electronics.platformio.build").execute({ config, environment: "uno" });
  t.diagnostic(JSON.stringify({ status: result.status, reason: result.reason, stderr: result.stderr, stdout: result.stdout, exitCode: result.exitCode, durationMs: result.durationMs, command: result.command, workspace: result.workspace, effectiveCliPath: result.effectiveCliPath, effectivePlatformioCoreDir: result.effectivePlatformioCoreDir }));
  assert.ok(["PASS", "BLOCKED"].includes(result.status), JSON.stringify(result));
  assert.equal(result.workspace, workspace);
  assert.ok(result.command?.includes("pio run") || result.reason?.includes("PlatformIO CLI unavailable"), JSON.stringify(result));
  assert.ok(result.effectivePlatformioCoreDir?.startsWith(`${workspace}/`), JSON.stringify(result));
  assert.ok(result.durationMs >= 0, JSON.stringify(result));
  if (result.status === "BLOCKED") assert.ok(result.reason, JSON.stringify(result));
});

test("B-negative: a task workspace without prepared PlatformIO packages is BLOCKED before CLI execution", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "mao-e2e-platformio-no-cache-"));
  await cp(join(packageRoot, "test/fixtures/platformio.ini"), join(workspace, "platformio.ini"));
  await cp(join(packageRoot, "test/fixtures/main.cpp"), join(workspace, "main.cpp"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const tools = createElectronicsTools({ workspaceRoot: workspace });
  const result = await tools.get("electronics.platformio.build").execute({ config: "platformio.ini", environment: "uno" });
  t.diagnostic(JSON.stringify({ status: result.status, reason: result.reason, stderr: result.stderr, stdout: result.stdout, exitCode: result.exitCode, durationMs: result.durationMs, command: result.command, workspace: result.workspace, effectiveCliPath: result.effectiveCliPath, effectivePlatformioCoreDir: result.effectivePlatformioCoreDir }));
  assert.equal(result.status, "BLOCKED", JSON.stringify(result));
  assert.equal(result.executed, false, "must not invoke PlatformIO when required packages are missing");
  assert.match(result.reason ?? "", /preinstalled PlatformIO dependencies are unavailable/i);
  assert.equal(result.exitCode, null);
  assert.equal(result.workspace, workspace);
  assert.equal(result.effectivePlatformioCoreDir, join(workspace, ".mao-electronics", "home", ".platformio"));
});

test("KiCad DRC: clean route passes, narrow route is a structured failure, CLI parse errors never pass", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mao-e2e-kicad-drc-"));
  const fixture = join(packageRoot, "test/fixtures");
  for (const name of ["drc-clean.kicad_pcb", "drc-clean.kicad_pro", "drc-clean.kicad_dru", "drc-narrow-track.kicad_pcb", "drc-narrow-track.kicad_pro", "drc-narrow-track.kicad_dru", "fp-lib-table"]) await cp(join(fixture, name), join(root, name));
  await cp(join(fixture, "Test.pretty"), join(root, "Test.pretty"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const tool = createElectronicsTools({ workspaceRoot: root }).get("electronics.kicad.drc");
  const good = await tool.execute({ board: "drc-clean.kicad_pcb" });
  if (good.status === "BLOCKED") { assert.match(good.reason, /unavailable|sandbox/i); return; }
  assert.equal(good.status, "PASS", good.stderr);
  assert.ok(good.createdFiles.every(path => path.startsWith(`${root}/`)));
  assert.equal(good.checkedParameters.find(item => item.parameter === "drc.violationCount")?.value, 0);
  assert.deepEqual(JSON.parse(await readFile(good.createdFiles[0], "utf8")).violations, []);

  const bad = await tool.execute({ board: "drc-narrow-track.kicad_pcb" });
  assert.equal(bad.status, "FAIL", bad.stderr);
  assert.notEqual(bad.exitCode, 0);
  const violations = bad.checkedParameters.find(item => item.parameter === "drc.violations")?.value;
  assert.ok(Array.isArray(violations) && violations.some(item => item.type === "track_width"));
  assert.ok(JSON.parse(await readFile(bad.createdFiles[0], "utf8")).violations.length > 0);

  await writeFile(join(root, "malformed.kicad_pcb"), "not a KiCad board\n");
  const malformed = await tool.execute({ board: "malformed.kicad_pcb" });
  assert.equal(malformed.status, "FAIL");
  assert.notEqual(malformed.exitCode, 0);
  assert.equal(malformed.executed, true);
});
