import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { CheckStatus, ConsistencyCheck, ConsistencyIssue, EngineeringArtifact, EngineeringArtifactKind, EngineeringProjectManifest, IntegrationReport, SafetyGate } from './types.js'

export type { CheckStatus, ConsistencyCheck, ConsistencyIssue, DimensionsMm, EngineeringArtifact, EngineeringArtifactKind, EngineeringProjectManifest, IntegrationReport, IssueSeverity, PinAssignment, SafetyGate, SchematicComponent } from './types.js'

const CHECKS = [
  ['schematic-bom', 'Schematic components and BOM references agree.'],
  ['firmware-pinout', 'Firmware GPIO configuration matches the schematic pin table.'],
  ['power-and-interfaces', 'Declared component supply ranges and interfaces are compatible.'],
  ['cad-clearance', 'Declared component envelopes fit their assigned CAD spaces.'],
  ['firmware-schematic-version', 'Firmware declares the current schematic version.'],
  ['artifact-freshness', 'Derived artifacts refer to current source versions and component revision.'],
] as const

const DEFAULT_REQUIRED_ARTIFACTS: EngineeringArtifactKind[] = ['schematic', 'bom', 'firmware', 'cad', 'assembly-instructions']
const DEFAULT_REQUIRED_CHECKS = CHECKS.map(([id]) => id)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Stable SHA-256 of normalized component records, sorted by schematic reference. */
export function computeComponentSetDigest(components: EngineeringProjectManifest['schematic']['components']): string {
  const canonical = [...components].sort((left, right) => left.ref.localeCompare(right.ref))
  return createHash('sha256').update(stableStringify(canonical)).digest('hex')
}

function add(issues: ConsistencyIssue[], issue: ConsistencyIssue): void { issues.push(issue) }

function artifactIndex(artifacts: readonly EngineeringArtifact[], issues: ConsistencyIssue[]): Map<string, EngineeringArtifact> {
  const result = new Map<string, EngineeringArtifact>()
  for (const [index, artifact] of artifacts.entries()) {
    if (!nonEmpty(artifact.id) || !nonEmpty(artifact.version) || !nonEmpty(artifact.sourcePath)) {
      add(issues, { severity: 'unconfirmed', code: 'artifact_metadata_missing', checkId: 'artifact-freshness', path: `artifacts[${index}]`, message: 'Artifact id, version and sourcePath must be explicitly declared.' })
      continue
    }
    if (result.has(artifact.id)) add(issues, { severity: 'error', code: 'duplicate_artifact_id', checkId: 'artifact-freshness', artifactId: artifact.id, path: `artifacts[${index}].id`, message: `Artifact id ${artifact.id} is declared more than once.` })
    else result.set(artifact.id, artifact)
  }
  return result
}

function requireSourceArtifact(
  sourceId: string,
  expectedKind: EngineeringArtifactKind,
  artifacts: Map<string, EngineeringArtifact>,
  issues: ConsistencyIssue[],
  path: string,
): EngineeringArtifact | undefined {
  const artifact = artifacts.get(sourceId)
  if (!artifact) {
    add(issues, { severity: 'unconfirmed', code: 'source_artifact_missing', checkId: checkForKind(expectedKind), artifactId: sourceId, path, message: `No source artifact ${sourceId} is registered for ${expectedKind}.` })
    return undefined
  }
  if (artifact.kind !== expectedKind) add(issues, { severity: 'error', code: 'source_artifact_kind_mismatch', checkId: checkForKind(expectedKind), artifactId: sourceId, path, message: `Expected ${expectedKind} source, found ${artifact.kind}.` })
  return artifact
}

function checkForKind(kind: EngineeringArtifactKind): string {
  if (kind === 'schematic' || kind === 'bom') return 'schematic-bom'
  if (kind === 'firmware') return 'firmware-pinout'
  if (kind === 'cad') return 'cad-clearance'
  return 'artifact-freshness'
}

function requiredArtifactGate(
  requiredKinds: readonly EngineeringArtifactKind[],
  artifacts: readonly EngineeringArtifact[],
  issues: ConsistencyIssue[],
): void {
  const present = new Set(artifacts.map((artifact) => artifact.kind))
  for (const kind of requiredKinds) if (!present.has(kind)) add(issues, {
    severity: 'unconfirmed', code: 'required_artifact_missing', checkId: 'artifact-freshness',
    message: `Required ${kind} artifact is not present in the project manifest.`, evidence: { artifactKind: kind },
  })
}

function checkBomSchematic(manifest: EngineeringProjectManifest, issues: ConsistencyIssue[]): void {
  const schematicByRef = new Map<string, EngineeringProjectManifest['schematic']['components'][number]>()
  for (const [index, component] of manifest.schematic.components.entries()) {
    if (!nonEmpty(component.ref) || !nonEmpty(component.partNumber)) {
      add(issues, { severity: 'unconfirmed', code: 'schematic_component_identity_missing', checkId: 'schematic-bom', path: `schematic.components[${index}]`, message: 'Component reference and part number are required for BOM comparison.' })
      continue
    }
    if (schematicByRef.has(component.ref)) add(issues, { severity: 'error', code: 'duplicate_schematic_reference', checkId: 'schematic-bom', componentRef: component.ref, path: `schematic.components[${index}].ref`, message: `Schematic reference ${component.ref} is duplicated.` })
    schematicByRef.set(component.ref, component)
  }
  const bomByRef = new Map<string, { partNumber: string; itemIndex: number }>()
  for (const [itemIndex, item] of manifest.bom.items.entries()) {
    if (!Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity !== item.references.length) add(issues, { severity: 'error', code: 'bom_quantity_reference_mismatch', checkId: 'schematic-bom', path: `bom.items[${itemIndex}]`, message: 'BOM quantity must equal the explicit reference count; the checker does not infer reference allocation.' })
    for (const [referenceIndex, ref] of item.references.entries()) {
      if (bomByRef.has(ref)) add(issues, { severity: 'error', code: 'duplicate_bom_reference', checkId: 'schematic-bom', componentRef: ref, path: `bom.items[${itemIndex}].references[${referenceIndex}]`, message: `BOM reference ${ref} is duplicated.` })
      else bomByRef.set(ref, { partNumber: item.partNumber, itemIndex })
    }
  }
  for (const [ref, component] of schematicByRef) {
    const bom = bomByRef.get(ref)
    if (!bom) add(issues, { severity: 'error', code: 'bom_missing_component', checkId: 'schematic-bom', componentRef: ref, path: 'bom.items', message: `Schematic component ${ref} is absent from the BOM.` })
    else if (bom.partNumber !== component.partNumber) add(issues, { severity: 'error', code: 'bom_part_number_mismatch', checkId: 'schematic-bom', componentRef: ref, path: `bom.items[${bom.itemIndex}].partNumber`, message: `BOM part number ${bom.partNumber} does not match schematic part ${component.partNumber}.`, evidence: { schematicPartNumber: component.partNumber, bomPartNumber: bom.partNumber } })
  }
  for (const [ref, bom] of bomByRef) if (!schematicByRef.has(ref)) add(issues, { severity: 'error', code: 'bom_extra_component', checkId: 'schematic-bom', componentRef: ref, path: `bom.items[${bom.itemIndex}]`, message: `BOM reference ${ref} is not present in the schematic.` })
}

function checkPinout(manifest: EngineeringProjectManifest, issues: ConsistencyIssue[]): void {
  const schematic = new Map(manifest.schematic.gpioAssignments?.map((pin) => [pin.signal, pin]) ?? [])
  const firmware = new Map(manifest.firmware.pinConfig.map((pin) => [pin.signal, pin]))
  const checkCollisions = (pins: readonly { signal: string; mcuPin: string }[], source: 'schematic' | 'firmware') => {
    const owners = new Map<string, string>()
    for (const pin of pins) {
      const owner = owners.get(pin.mcuPin)
      if (owner) add(issues, { severity: 'error', code: 'gpio_pin_collision', checkId: 'firmware-pinout', path: source, message: `${source} assigns ${pin.mcuPin} to both ${owner} and ${pin.signal}.`, evidence: { pin: pin.mcuPin, firstSignal: owner, secondSignal: pin.signal, source } })
      else owners.set(pin.mcuPin, pin.signal)
    }
  }
  checkCollisions(manifest.schematic.gpioAssignments ?? [], 'schematic')
  checkCollisions(manifest.firmware.pinConfig, 'firmware')
  for (const [signal, pin] of schematic) {
    const configured = firmware.get(signal)
    if (!configured) add(issues, { severity: 'error', code: 'firmware_pin_missing', checkId: 'firmware-pinout', componentRef: signal, message: `Firmware does not configure schematic GPIO signal ${signal}.` })
    else {
      if (pin.mcuPin !== configured.mcuPin) add(issues, { severity: 'error', code: 'gpio_pin_mismatch', checkId: 'firmware-pinout', componentRef: signal, message: `${signal} uses ${pin.mcuPin} in the schematic and ${configured.mcuPin} in firmware.`, evidence: { schematicPin: pin.mcuPin, firmwarePin: configured.mcuPin } })
      if (pin.direction && configured.direction && pin.direction !== configured.direction) add(issues, { severity: 'error', code: 'gpio_direction_mismatch', checkId: 'firmware-pinout', componentRef: signal, message: `${signal} direction differs between schematic and firmware.` })
      if (!pin.direction || !configured.direction) add(issues, { severity: 'unconfirmed', code: 'gpio_direction_unconfirmed', checkId: 'firmware-pinout', componentRef: signal, message: `Direction for ${signal} is not declared in both pin tables.` })
    }
  }
  for (const signal of firmware.keys()) if (!schematic.has(signal)) add(issues, { severity: 'error', code: 'firmware_pin_unknown_signal', checkId: 'firmware-pinout', componentRef: signal, message: `Firmware pin ${signal} has no matching schematic GPIO assignment.` })
  if (manifest.schematic.gpioAssignments === undefined) add(issues, { severity: 'unconfirmed', code: 'schematic_gpio_table_missing', checkId: 'firmware-pinout', path: 'schematic.gpioAssignments', message: 'Schematic GPIO table was not supplied.' })
}

function checkPowerAndInterfaces(manifest: EngineeringProjectManifest, issues: ConsistencyIssue[]): void {
  const domains = new Map((manifest.schematic.powerDomains ?? []).map((domain) => [domain.id, domain]))
  const components = new Map(manifest.schematic.components.map((component) => [component.ref, component]))
  for (const [index, component] of manifest.schematic.components.entries()) {
    if (component.powerRole !== 'powered' && component.powerRole !== 'passive' && component.powerRole !== 'unpowered') add(issues, { severity: 'unconfirmed', code: 'component_power_requirement_unconfirmed', checkId: 'power-and-interfaces', componentRef: component.ref, path: `schematic.components[${index}].powerRole`, message: `Power role for ${component.ref} must be explicitly declared as powered, passive, or unpowered.` })
    if (component.powerRole === 'powered' && !component.powerDomainId) add(issues, { severity: 'unconfirmed', code: 'power_domain_unconfirmed', checkId: 'power-and-interfaces', componentRef: component.ref, message: `Powered component ${component.ref} has no declared supply domain.` })
    if (component.powerDomainId) {
      const domain = domains.get(component.powerDomainId)
      if (!domain) add(issues, { severity: 'unconfirmed', code: 'power_domain_missing', checkId: 'power-and-interfaces', componentRef: component.ref, path: `schematic.components[${index}].powerDomainId`, message: `Power domain ${component.powerDomainId} is not declared.` })
      else if (!isFiniteNumber(domain.nominalVoltageV)) add(issues, { severity: 'unconfirmed', code: 'nominal_voltage_unconfirmed', checkId: 'power-and-interfaces', componentRef: component.ref, message: `Nominal voltage for domain ${domain.id} is not a finite declared value.` })
      else if (!component.operatingVoltageV || !isFiniteNumber(component.operatingVoltageV.min) || !isFiniteNumber(component.operatingVoltageV.max)) add(issues, { severity: 'unconfirmed', code: 'component_voltage_range_unconfirmed', checkId: 'power-and-interfaces', componentRef: component.ref, message: `Operating voltage range is missing for powered component ${component.ref}.` })
      else if (domain.nominalVoltageV < component.operatingVoltageV.min || domain.nominalVoltageV > component.operatingVoltageV.max) add(issues, { severity: 'error', code: 'supply_voltage_out_of_range', checkId: 'power-and-interfaces', componentRef: component.ref, message: `${domain.nominalVoltageV} V nominal supply is outside ${component.ref}'s declared ${component.operatingVoltageV.min}–${component.operatingVoltageV.max} V range.`, evidence: { nominalVoltageV: domain.nominalVoltageV, minimumVoltageV: component.operatingVoltageV.min, maximumVoltageV: component.operatingVoltageV.max } })
    } else if (component.operatingVoltageV) add(issues, { severity: 'unconfirmed', code: 'component_power_domain_unconfirmed', checkId: 'power-and-interfaces', componentRef: component.ref, message: `Operating voltage is declared for ${component.ref}, but its nominal supply domain is not mapped.` })
    if (component.interfaces === undefined) add(issues, { severity: 'unconfirmed', code: 'component_interfaces_unconfirmed', checkId: 'power-and-interfaces', componentRef: component.ref, message: `Supported interfaces are not declared for ${component.ref}.` })
  }
  if (manifest.schematic.connections === undefined) add(issues, { severity: 'unconfirmed', code: 'schematic_connections_unconfirmed', checkId: 'power-and-interfaces', path: 'schematic.connections', message: 'Schematic interface connection data was not supplied.' })
  for (const [index, connection] of (manifest.schematic.connections ?? []).entries()) {
    if (connection.endpoints.length < 2) add(issues, { severity: 'unconfirmed', code: 'interface_connection_incomplete', checkId: 'power-and-interfaces', path: `schematic.connections[${index}]`, message: `Connection ${connection.id} needs at least two explicit endpoints.` })
    for (const ref of connection.endpoints) {
      const component = components.get(ref)
      if (!component) add(issues, { severity: 'error', code: 'interface_endpoint_missing', checkId: 'power-and-interfaces', componentRef: ref, path: `schematic.connections[${index}]`, message: `Connection ${connection.id} references missing component ${ref}.` })
      else if (component.interfaces === undefined) continue
      else if (!component.interfaces.includes(connection.interface)) add(issues, { severity: 'error', code: 'interface_mismatch', checkId: 'power-and-interfaces', componentRef: ref, path: `schematic.connections[${index}]`, message: `${ref} does not declare support for ${connection.interface} used by connection ${connection.id}.`, evidence: { requiredInterface: connection.interface, declaredInterfaces: component.interfaces.join(',') } })
    }
  }
}

function validDimensions(value: unknown): value is { x: number; y: number; z: number } {
  if (!value || typeof value !== 'object') return false
  const dimensions = value as Record<string, unknown>
  return [dimensions.x, dimensions.y, dimensions.z].every((entry) => isFiniteNumber(entry) && entry > 0)
}

function checkCadClearance(manifest: EngineeringProjectManifest, issues: ConsistencyIssue[]): void {
  const envelopes = new Map(manifest.cad.componentClearances.map((entry) => [entry.componentRef, entry]))
  for (const component of manifest.schematic.components) {
    const envelope = envelopes.get(component.ref)
    if (!component.physicalDimensionsMm || !validDimensions(component.physicalDimensionsMm)) add(issues, { severity: 'unconfirmed', code: 'component_dimensions_unconfirmed', checkId: 'cad-clearance', componentRef: component.ref, message: `Source dimensions for ${component.ref} are missing or invalid; no dimensions are inferred.` })
    if (!envelope) {
      add(issues, { severity: 'unconfirmed', code: 'cad_clearance_missing', checkId: 'cad-clearance', componentRef: component.ref, message: `CAD has no declared allocated space for ${component.ref}.` })
      continue
    }
    if (!envelope.componentDimensionsMm || !validDimensions(envelope.componentDimensionsMm)) add(issues, { severity: 'unconfirmed', code: 'cad_component_dimensions_unconfirmed', checkId: 'cad-clearance', componentRef: component.ref, message: `CAD model dimensions for ${component.ref} are missing or invalid.` })
    if (!envelope.spaceAvailableMm || !validDimensions(envelope.spaceAvailableMm)) add(issues, { severity: 'unconfirmed', code: 'cad_allocated_space_unconfirmed', checkId: 'cad-clearance', componentRef: component.ref, message: `Allocated CAD space for ${component.ref} is missing or invalid.` })
    if (!validDimensions(component.physicalDimensionsMm) || !validDimensions(envelope.componentDimensionsMm) || !validDimensions(envelope.spaceAvailableMm)) continue
    const axes = ['x', 'y', 'z'] as const
    if (axes.some((axis) => Math.abs(component.physicalDimensionsMm![axis] - envelope.componentDimensionsMm![axis]) > .01)) add(issues, { severity: 'error', code: 'cad_component_dimension_mismatch', checkId: 'cad-clearance', componentRef: component.ref, message: `CAD envelope for ${component.ref} differs from its explicitly supplied component dimensions.`, evidence: { sourceDimensionsMm: `${component.physicalDimensionsMm.x}x${component.physicalDimensionsMm.y}x${component.physicalDimensionsMm.z}`, cadDimensionsMm: `${envelope.componentDimensionsMm.x}x${envelope.componentDimensionsMm.y}x${envelope.componentDimensionsMm.z}` } })
    if (axes.some((axis) => envelope.componentDimensionsMm![axis] > envelope.spaceAvailableMm![axis])) add(issues, { severity: 'error', code: 'cad_clearance_exceeded', checkId: 'cad-clearance', componentRef: component.ref, message: `CAD allocated space for ${component.ref} is smaller than its declared envelope on at least one axis.`, evidence: { componentDimensionsMm: `${envelope.componentDimensionsMm.x}x${envelope.componentDimensionsMm.y}x${envelope.componentDimensionsMm.z}`, spaceAvailableMm: `${envelope.spaceAvailableMm.x}x${envelope.spaceAvailableMm.y}x${envelope.spaceAvailableMm.z}` } })
  }
  for (const ref of envelopes.keys()) if (!manifest.schematic.components.some((component) => component.ref === ref)) add(issues, { severity: 'error', code: 'cad_unknown_component', checkId: 'cad-clearance', componentRef: ref, message: `CAD clearance entry references unknown schematic component ${ref}.` })
}

function checkFirmwareVersion(manifest: EngineeringProjectManifest, artifacts: Map<string, EngineeringArtifact>, issues: ConsistencyIssue[]): void {
  const schematic = artifacts.get(manifest.schematic.sourceArtifactId)
  if (!schematic) return
  if (!manifest.firmware.compatibleSchematicVersion) add(issues, { severity: 'unconfirmed', code: 'firmware_schematic_version_unconfirmed', checkId: 'firmware-schematic-version', message: 'Firmware does not declare a compatible schematic version.' })
  else if (manifest.firmware.compatibleSchematicVersion !== schematic.version) add(issues, { severity: 'error', code: 'firmware_schematic_version_mismatch', checkId: 'firmware-schematic-version', artifactId: manifest.firmware.sourceArtifactId, message: `Firmware targets schematic ${manifest.firmware.compatibleSchematicVersion}, current schematic is ${schematic.version}.`, evidence: { firmwareSchematicVersion: manifest.firmware.compatibleSchematicVersion, currentSchematicVersion: schematic.version } })
  const firmwareArtifact = artifacts.get(manifest.firmware.sourceArtifactId)
  if (firmwareArtifact && firmwareArtifact.version !== manifest.firmware.version) add(issues, { severity: 'error', code: 'firmware_version_metadata_mismatch', checkId: 'firmware-schematic-version', artifactId: firmwareArtifact.id, message: `Firmware section version ${manifest.firmware.version} differs from source artifact version ${firmwareArtifact.version}.` })
}

function checkArtifactFreshness(manifest: EngineeringProjectManifest, artifacts: Map<string, EngineeringArtifact>, issues: ConsistencyIssue[]): void {
  const expectedDependencies: Partial<Record<EngineeringArtifactKind, readonly string[]>> = {
    firmware: ['schematic'],
    cad: ['schematic', 'bom'],
    'assembly-instructions': ['cad', 'bom'],
  }
  const currentComponentDigest = computeComponentSetDigest(manifest.schematic.components)
  for (const artifact of manifest.artifacts) {
    const requiredDependencies = expectedDependencies[artifact.kind] ?? []
    if (!artifact.basedOn) {
      if (requiredDependencies.length || artifact.kind === 'firmware' || artifact.kind === 'cad' || artifact.kind === 'assembly-instructions') add(issues, { severity: 'unconfirmed', code: 'artifact_provenance_unconfirmed', checkId: 'artifact-freshness', artifactId: artifact.id, message: `Derived ${artifact.kind} artifact ${artifact.id} has no basedOn snapshot.` })
      continue
    }
    for (const dependencyId of requiredDependencies) if (!Object.hasOwn(artifact.basedOn.artifactVersions ?? {}, dependencyId)) add(issues, { severity: 'unconfirmed', code: 'artifact_dependency_snapshot_missing', checkId: 'artifact-freshness', artifactId: artifact.id, message: `${artifact.kind} artifact ${artifact.id} must record the source version of ${dependencyId}.` })
    for (const [dependencyId, recordedVersion] of Object.entries(artifact.basedOn.artifactVersions ?? {})) {
      const current = artifacts.get(dependencyId)
      if (!current || current.version !== recordedVersion) {
        add(issues, { severity: 'warning', code: 'stale_artifact', checkId: 'artifact-freshness', artifactId: artifact.id, path: `artifacts.${artifact.id}.basedOn.artifactVersions.${dependencyId}`, message: `${artifact.id} was produced from ${dependencyId}@${recordedVersion}; current source is ${current ? `${dependencyId}@${current.version}` : 'missing'}.`, evidence: { dependencyId, recordedVersion, currentVersion: current?.version ?? null } })
      }
    }
    if (artifact.basedOn.componentSetRevision !== undefined && artifact.basedOn.componentSetRevision !== manifest.project.componentSetRevision) {
      add(issues, { severity: 'warning', code: 'stale_artifact', checkId: 'artifact-freshness', artifactId: artifact.id, path: `artifacts.${artifact.id}.basedOn.componentSetRevision`, message: `${artifact.id} uses component revision ${artifact.basedOn.componentSetRevision}; current component revision is ${manifest.project.componentSetRevision}.`, evidence: { recordedComponentSetRevision: artifact.basedOn.componentSetRevision, currentComponentSetRevision: manifest.project.componentSetRevision } })
    }
    if (!artifact.basedOn.componentSetRevision && (artifact.kind === 'firmware' || artifact.kind === 'cad' || artifact.kind === 'assembly-instructions')) add(issues, { severity: 'unconfirmed', code: 'component_revision_unconfirmed', checkId: 'artifact-freshness', artifactId: artifact.id, message: `Derived artifact ${artifact.id} does not record the component-set revision it used.` })
    if (!artifact.basedOn.componentSetDigest && (artifact.kind === 'firmware' || artifact.kind === 'cad' || artifact.kind === 'assembly-instructions')) add(issues, { severity: 'unconfirmed', code: 'component_digest_unconfirmed', checkId: 'artifact-freshness', artifactId: artifact.id, message: `Derived artifact ${artifact.id} does not record the normalized component-set digest it used.` })
    else if (artifact.basedOn.componentSetDigest && artifact.basedOn.componentSetDigest !== currentComponentDigest) add(issues, { severity: 'warning', code: 'stale_artifact', checkId: 'artifact-freshness', artifactId: artifact.id, path: `artifacts.${artifact.id}.basedOn.componentSetDigest`, message: `${artifact.id} was produced from a different normalized component set.`, evidence: { recordedComponentSetDigest: artifact.basedOn.componentSetDigest, currentComponentSetDigest: currentComponentDigest } })
  }
}

function checkRequiredCheckIds(required: readonly string[], issues: ConsistencyIssue[]): void {
  const known = new Set<string>(CHECKS.map(([id]) => id))
  for (const id of required) if (!known.has(id)) add(issues, { severity: 'unconfirmed', code: 'unknown_required_check', checkId: 'artifact-freshness', message: `Required check ${id} is not implemented by this package version.` })
}

export function analyzeEngineeringProject(manifest: EngineeringProjectManifest, generatedAt = new Date()): IntegrationReport {
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.project || !Array.isArray(manifest.artifacts)) throw new TypeError('Unsupported or malformed engineering project manifest (expected schemaVersion: 1).')
  const issues: ConsistencyIssue[] = []
  const artifacts = artifactIndex(manifest.artifacts, issues)
  const requiredArtifacts = manifest.policy?.requiredArtifacts ?? DEFAULT_REQUIRED_ARTIFACTS
  requiredArtifactGate(requiredArtifacts, manifest.artifacts, issues)
  checkBomSchematic(manifest, issues)
  requireSourceArtifact(manifest.bom.sourceArtifactId, 'bom', artifacts, issues, 'bom.sourceArtifactId')
  requireSourceArtifact(manifest.firmware.sourceArtifactId, 'firmware', artifacts, issues, 'firmware.sourceArtifactId')
  requireSourceArtifact(manifest.cad.sourceArtifactId, 'cad', artifacts, issues, 'cad.sourceArtifactId')
  requireSourceArtifact(manifest.assemblyInstructions.sourceArtifactId, 'assembly-instructions', artifacts, issues, 'assemblyInstructions.sourceArtifactId')
  checkPinout(manifest, issues)
  checkPowerAndInterfaces(manifest, issues)
  checkCadClearance(manifest, issues)
  checkFirmwareVersion(manifest, artifacts, issues)
  checkArtifactFreshness(manifest, artifacts, issues)
  const requiredChecks = manifest.policy?.requiredChecks ?? DEFAULT_REQUIRED_CHECKS
  checkRequiredCheckIds(requiredChecks, issues)

  const staleIssues = issues.filter((issue) => issue.code === 'stale_artifact')
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const unconfirmed = issues.filter((issue) => issue.severity === 'unconfirmed')
  const requiredSourceMissing = issues.some((issue) => issue.code === 'required_artifact_missing')
  const gates: SafetyGate[] = [
    { id: 'critical-consistency', status: errors.length ? 'blocked' : 'passed', reason: errors.length ? `${errors.length} critical mismatch(es) must be resolved.` : 'No critical cross-domain mismatches were found.' },
    { id: 'artifact-freshness', status: staleIssues.length ? 'blocked' : 'passed', reason: staleIssues.length ? `${new Set(staleIssues.map((issue) => issue.artifactId)).size} derived artifact(s) are stale.` : 'Derived artifact snapshots match current declared source versions and component revision.' },
    { id: 'required-evidence', status: unconfirmed.length || requiredSourceMissing ? 'blocked' : 'passed', reason: unconfirmed.length || requiredSourceMissing ? `${unconfirmed.length} required value(s) remain unconfirmed; unknown engineering values are never inferred.` : 'Required engineering evidence is explicitly supplied.' },
  ]
  const status = gates.every((gate) => gate.status === 'passed') ? 'READY_TO_BUILD' : 'BLOCKED'
  const checks: ConsistencyCheck[] = CHECKS.map(([id, summary]) => {
    const related = issues.filter((issue) => issue.checkId === id)
    const status: CheckStatus = related.some((issue) => issue.severity === 'error' || issue.severity === 'unconfirmed' || issue.code === 'stale_artifact') ? 'blocked' : 'passed'
    return { id, status, issueCodes: [...new Set(related.map((issue) => issue.code))], summary }
  })
  return {
    schemaVersion: 1,
    projectId: manifest.project.id,
    projectVersion: manifest.project.version,
    status,
    generatedAt: generatedAt.toISOString(),
    checks,
    issues,
    errors,
    warnings,
    unconfirmed,
    safetyGates: gates,
  }
}

export function renderIntegrationReportJson(report: IntegrationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

const md = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ')

export function renderIntegrationReportMarkdown(report: IntegrationReport): string {
  const rows = (entries: readonly ConsistencyIssue[]) => entries.length
    ? entries.map((issue) => `| ${md(issue.severity.toUpperCase())} | ${md(issue.code)} | ${md(issue.message)} |`).join('\n')
    : '| — | — | None |'
  return [
    `# Engineering integration report: ${md(report.projectId)}`,
    '',
    `- Project version: ${md(report.projectVersion)}`,
    `- Status: **${report.status}**`,
    `- Generated: ${report.generatedAt}`,
    '',
    '## Cross-domain checks',
    '',
    '| Check | Status | Summary |',
    '| --- | --- | --- |',
    ...report.checks.map((check) => `| ${md(check.id)} | ${check.status} | ${md(check.summary)} |`),
    '',
    '## Safety gates',
    '',
    '| Gate | Status | Reason |',
    '| --- | --- | --- |',
    ...report.safetyGates.map((gate) => `| ${md(gate.id)} | ${gate.status} | ${md(gate.reason)} |`),
    '',
    '## Errors',
    '',
    '| Severity | Code | Message |',
    '| --- | --- | --- |',
    rows(report.errors),
    '',
    '## Warnings',
    '',
    '| Severity | Code | Message |',
    '| --- | --- | --- |',
    rows(report.warnings),
    '',
    '## Unconfirmed parameters',
    '',
    '| Severity | Code | Message |',
    '| --- | --- | --- |',
    rows(report.unconfirmed),
    '',
    'This report compares declared project data only. It does not certify physical safety, manufacturability, or device readiness.',
    '',
  ].join('\n')
}

export async function writeIntegrationReports(manifest: EngineeringProjectManifest, outputDirectory: string): Promise<{ report: IntegrationReport; jsonPath: string; markdownPath: string }> {
  const report = analyzeEngineeringProject(manifest)
  await mkdir(outputDirectory, { recursive: true })
  const jsonPath = join(outputDirectory, 'integration-report.json')
  const markdownPath = join(outputDirectory, 'integration-report.md')
  await Promise.all([
    writeFile(jsonPath, renderIntegrationReportJson(report), 'utf8'),
    writeFile(markdownPath, renderIntegrationReportMarkdown(report), 'utf8'),
  ])
  return { report, jsonPath, markdownPath }
}

export async function readEngineeringProjectManifest(path: string): Promise<EngineeringProjectManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as EngineeringProjectManifest
}
