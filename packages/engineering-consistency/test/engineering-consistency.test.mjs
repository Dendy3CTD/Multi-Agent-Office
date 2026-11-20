import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeEngineeringProject, renderIntegrationReportJson, renderIntegrationReportMarkdown, writeIntegrationReports } from '../dist/index.js'

const testDir = dirname(fileURLToPath(import.meta.url))
const fixture = async (name) => JSON.parse(await readFile(join(testDir, 'fixtures', name), 'utf8'))

test('a fully specified, revision-aligned project can be READY_TO_BUILD', async () => {
  const report = analyzeEngineeringProject(await fixture('consistent-project.json'))
  assert.equal(report.status, 'READY_TO_BUILD')
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.unconfirmed, [])
  assert.ok(report.checks.some((check) => check.id === 'schematic-bom' && check.status === 'passed'))
  assert.ok(report.checks.some((check) => check.id === 'firmware-pinout' && check.status === 'passed'))
  assert.ok(report.checks.some((check) => check.id === 'cad-clearance' && check.status === 'passed'))
})

test('contradictions and stale derived artifacts block READY_TO_BUILD with actionable issue codes', async () => {
  const report = analyzeEngineeringProject(await fixture('contradictory-project.json'))
  const codes = new Set(report.issues.map((issue) => issue.code))
  assert.equal(report.status, 'BLOCKED')
  for (const code of [
    'bom_missing_component', 'bom_part_number_mismatch', 'gpio_pin_mismatch', 'gpio_pin_collision',
    'supply_voltage_out_of_range', 'interface_mismatch', 'cad_clearance_exceeded',
    'firmware_schematic_version_mismatch', 'stale_artifact', 'component_dimensions_unconfirmed',
  ]) assert.ok(codes.has(code), `missing issue ${code}`)
  assert.ok(report.errors.length > 0)
  assert.ok(report.warnings.some((issue) => issue.code === 'stale_artifact'))
  assert.ok(report.unconfirmed.length > 0)
})

test('missing electrical and physical source values stay unconfirmed and cannot be inferred', async () => {
  const project = await fixture('consistent-project.json')
  project.schematic.connections = undefined
  project.schematic.components.find((component) => component.ref === 'U1').powerRole = undefined
  project.schematic.components.find((component) => component.ref === 'U1').operatingVoltageV = undefined
  project.schematic.components.find((component) => component.ref === 'J1').physicalDimensionsMm = undefined
  const report = analyzeEngineeringProject(project)
  const codes = new Set(report.unconfirmed.map((issue) => issue.code))
  assert.equal(report.status, 'BLOCKED')
  assert.ok(codes.has('schematic_connections_unconfirmed'))
  assert.ok(codes.has('component_power_requirement_unconfirmed'))
  assert.ok(codes.has('component_voltage_range_unconfirmed'))
  assert.ok(codes.has('component_dimensions_unconfirmed'))
})

test('component data edits invalidate derived outputs even if the declared revision was not bumped', async () => {
  const project = await fixture('consistent-project.json')
  project.schematic.components.find((component) => component.ref === 'U1').partNumber = 'UNDECLARED-CHANGE'
  const report = analyzeEngineeringProject(project)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.warnings.some((issue) => issue.code === 'stale_artifact'))
})

test('report exporters produce deterministic machine and human readable outputs', async () => {
  const project = await fixture('contradictory-project.json')
  const report = analyzeEngineeringProject(project)
  const json = JSON.parse(renderIntegrationReportJson(report))
  const markdown = renderIntegrationReportMarkdown(report)
  assert.equal(json.projectId, project.project.id)
  assert.equal(json.status, 'BLOCKED')
  assert.match(markdown, /Safety gates/)
  assert.match(markdown, /stale_artifact/)
})

test('report writer emits integration-report.json and integration-report.md', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const output = await mkdtemp(join(tmpdir(), 'mao-engineering-consistency-'))
  try {
    await writeIntegrationReports(await fixture('consistent-project.json'), output)
    const json = JSON.parse(await readFile(join(output, 'integration-report.json'), 'utf8'))
    const markdown = await readFile(join(output, 'integration-report.md'), 'utf8')
    assert.equal(json.status, 'READY_TO_BUILD')
    assert.match(markdown, /READY_TO_BUILD/)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
