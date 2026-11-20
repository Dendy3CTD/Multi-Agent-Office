import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElectronicsTools, validateComponentConstraints } from "../dist/index.js";

test("component validation refuses undocumented limits and identifies measured margin", () => {
  const result = validateComponentConstraints({
    components: [
      { id: "reg", kind: "regulator", limits: { inputVoltage: { min: 4.5, max: 12, source: "datasheet.pdf p.4", confidence: "documented" }, maxOutputCurrent: { value: 1, unit: "A", source: "datasheet.pdf p.7", confidence: "documented" } } },
      { id: "load", kind: "load", requirements: { voltage: { value: 5, unit: "V", source: "load-datasheet.pdf p.2" }, current: { value: 0.7, unit: "A", source: "load-datasheet.pdf p.2" } } },
    ],
    checks: [{ kind: "power_budget", source: "reg", load: "load", available: { value: 1, unit: "A", source: "datasheet.pdf p.7", confidence: "documented" } }],
  });
  assert.equal(result.status, "NEEDS_DATASHEET");
  assert.ok(result.unconfirmedParameters.some((item) => item.parameter.includes("reversePolarity")));
  assert.ok(Math.abs(result.checkedParameters.find((item) => item.parameter === "powerBudget.margin")?.value - 0.3) < 1e-10);
});

test("component validation compares supply, GPIO, logic, interface, protection, and thermal documents", () => {
  const limit = (value, unit, source) => ({ value, unit, source, confidence: "documented" });
  const minMax = (min, max, unit, source) => ({ min, max, unit, source, confidence: "documented" });
  const parts = [
    { id: "U1", applicableParameters: ["supplyVoltage", "gpioMaxCurrent", "logicHigh", "logicLow", "powerDissipation", "thermalLimit", "reversePolarityProtection", "i2cCompatibility"], limits: {
      supplyVoltage: minMax(3, 3.6, "V", "U1.pdf p.8"), gpioMaxCurrent: { max: 0.01, unit: "A", source: "U1.pdf p.12", confidence: "documented" },
      logicHigh: { min: 2.7, unit: "V", source: "U1.pdf p.13", confidence: "documented" }, logicLow: { max: 0.5, unit: "V", source: "U1.pdf p.13", confidence: "documented" },
      powerDissipation: { max: 0.5, unit: "W", source: "U1.pdf p.15", confidence: "documented" }, thermalLimit: { max: 125, unit: "C", source: "U1.pdf p.16", confidence: "documented" },
      reversePolarityProtection: limit(false, "boolean", "U1.pdf p.3"), i2cCompatibility: limit("compatible", "protocol", "U1.pdf p.20"),
      pullupRequirements: limit("required", "text", "U1.pdf p.20"), levelShiftingRequirements: limit("not-required", "text", "U1.pdf p.20"),
    } },
    { id: "U2", applicableParameters: ["logicHigh", "logicLow", "i2cCompatibility"], limits: {
      logicHigh: { min: 3, unit: "V", source: "U2.pdf p.4", confidence: "documented" }, logicLow: { max: 0.4, unit: "V", source: "U2.pdf p.4", confidence: "documented" },
      i2cCompatibility: limit("compatible", "protocol", "U2.pdf p.7"), pullupRequirements: limit("required", "text", "U2.pdf p.7"), levelShiftingRequirements: limit("required", "text", "U2.pdf p.7"),
    } },
  ];
  const result = validateComponentConstraints({ components: parts, checks: [
    { kind: "voltage_range", component: "U1", voltage: limit(5, "V", "design requirements p.1") },
    { kind: "maximum", component: "U1", parameter: "gpioMaxCurrent", actual: limit(0.012, "A", "load estimate p.1") },
    { kind: "logic_compatibility", driver: "U1", receiver: "U2" },
    { kind: "interface_compatibility", from: "U1", to: "U2", interface: "I2C", pullupsProvided: true, levelShiftingProvided: true },
    { kind: "protection", component: "U1", feature: "reversePolarityProtection", required: true },
    { kind: "thermal", component: "U1", power: limit(0.45, "W", "thermal calculation p.1") },
  ] });
  assert.equal(result.status, "FAIL");
  assert.ok(result.warnings.some(item => /supply voltage is outside/i.test(item)));
  assert.ok(result.warnings.some(item => /GPIO.*exceeds/i.test(item)));
  assert.ok(result.warnings.some(item => /logic levels are incompatible/i.test(item)));
  assert.ok(result.warnings.some(item => /missing required reversePolarityProtection/i.test(item)));
  assert.ok(result.warnings.some(item => /thermal result needs review/i.test(item)));
  assert.ok(result.checkedParameters.some(item => item.parameter === "interface.I2C" && item.value === "compatible"));
});

test("engineering tools run only inside workspace and return exact unavailable-tool BLOCKED evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mao-electronics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await createElectronicsTools({ workspaceRoot: root, commandAvailability: () => false }).get("electronics.kicad.version").execute({});
  assert.equal(result.status, "BLOCKED");
  assert.match(result.stderr, /kicad-cli.*not installed/i);
  assert.equal(result.executed, false);
});

test("engineering outputs reject symlinks that point outside the registered project", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mao-electronics-symlink-"));
  const outside = join(root, "outside.log");
  await writeFile(outside, "do not overwrite");
  await mkdir(join(root, ".mao-electronics", "artifacts"), { recursive: true });
  await symlink(outside, join(root, ".mao-electronics", "artifacts", "ngspice.log"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "safe.cir"), "safe\nV1 in 0 DC 1\nR1 in 0 1k\n.op\n.end\n");
  const result = await createElectronicsTools({ workspaceRoot: root }).get("electronics.ngspice.run").execute({ netlist: "safe.cir", analysis: "dc" });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.stderr, /symlink/i);
  assert.equal(await readFile(outside, "utf8"), "do not overwrite");
});

test("engineering process timeout and captured output are bounded", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mao-electronics-process-limits-"));
  const bin = join(root, ".fakebin"); const fake = join(bin, "kicad-cli");
  await mkdir(bin);
  t.after(() => rm(root, { recursive: true, force: true }));
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? "/usr/bin:/bin"}`;
  t.after(() => { if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath; });
  await writeFile(fake, "#!/bin/sh\nprintf '%4097d' 0\n"); await chmod(fake, 0o755);
  const capped = await createElectronicsTools({ workspaceRoot: root, maxOutputBytes: 4096 }).get("electronics.kicad.version").execute({});
  assert.equal(capped.status, "PASS");
  assert.equal(capped.stdout.length, 4096, JSON.stringify(capped));
  await writeFile(fake, "#!/bin/sh\nexec sleep 5\n"); await chmod(fake, 0o755);
  const timedOut = await createElectronicsTools({ workspaceRoot: root, timeoutMs: 1000 }).get("electronics.kicad.version").execute({});
  assert.equal(timedOut.status, "BLOCKED");
  assert.equal(timedOut.reason, "execution timed out");
  assert.equal(timedOut.executed, true);
});

test("KiCad exports and ngspice run against project files and preserve command output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mao-electronics-fixture-"));
  await mkdir(join(root, "circuit"));
  await writeFile(join(root, "circuit", "ohms.cir"), "Voltage divider\nV1 in 0 DC 10\nR1 in out 10k\nR2 out 0 10k\n.op\n.print op v(out)\n.save all\n.end\n");
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = createElectronicsTools({ workspaceRoot: root });
  const sim = await tools.get("electronics.ngspice.run").execute({ netlist: "circuit/ohms.cir", analysis: "dc" });
  assert.ok(["PASS", "BLOCKED"].includes(sim.status), sim.stderr);
  if (sim.status === "PASS") {
    assert.match(sim.stdout, /5/i);
    assert.ok(sim.createdFiles.some((file) => file.endsWith(".log")));
  } else assert.match(sim.reason, /sandbox/i);
  await writeFile(join(root, "circuit", "transient.cir"), "Pulse divider\nV1 in 0 PULSE(0 10 0 1u 1u 5m 10m)\nR1 in out 10k\nR2 out 0 10k\n.end\n");
  const transient = await tools.get("electronics.ngspice.run").execute({ netlist: "circuit/transient.cir", analysis: "transient", step: 0.0001, stop: 0.01 });
  assert.ok(["PASS", "BLOCKED"].includes(transient.status), JSON.stringify(transient));
  if (transient.status === "PASS") {
    assert.ok(transient.createdFiles.some((file) => file.endsWith("ngspice.raw")));
    assert.ok(transient.createdFiles.some((file) => file.includes("ngspice-transient-") && file.endsWith(".cir")));
  } else assert.match(transient.reason, /sandbox/i);
  const outside = await tools.get("electronics.ngspice.run").execute({ netlist: "../outside.cir", analysis: "dc" });
  assert.equal(outside.status, "BLOCKED");
});

test("capability filtering grants electronics tools only to electronics engineers", async (t) => {
  const { createTaskElectronicsDispatcher } = await import("../dist/index.js");
  const root = await mkdtemp(join(tmpdir(), "mao-electronics-task-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const engineer = createTaskElectronicsDispatcher({ projectId: "p", taskId: "t", executionId: "e", workspaceRoot: root, employee: { professionId: "electronics-engineer", skills: [] } });
  const developer = createTaskElectronicsDispatcher({ projectId: "p", taskId: "t2", executionId: "e2", workspaceRoot: root, employee: { professionId: "developer", skills: [] } });
  const embedded = createTaskElectronicsDispatcher({ projectId: "p", taskId: "t3", executionId: "e3", workspaceRoot: root, employee: { professionId: "developer", skills: ["embedded-build"] } });
  assert.ok(engineer.tools.length > 0);
  assert.equal(developer.tools.length, 0);
  assert.deepEqual(embedded.tools.map(tool => tool.id), ["electronics.platformio.detect", "electronics.platformio.inspect", "electronics.platformio.build"]);
  assert.match(engineer.mcpServer.name, /electronics/);
  const escaped = await engineer.invoke("electronics.ngspice.run", { netlist: "../outside.cir", analysis: "dc" });
  assert.equal(escaped.status, "BLOCKED");
  assert.match(escaped.stderr, /outside|escapes the registered project workspace/i);
});
