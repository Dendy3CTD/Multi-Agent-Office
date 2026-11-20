export type EngineeringArtifactKind = 'schematic' | 'bom' | 'firmware' | 'cad' | 'assembly-instructions' | 'research'
export type IssueSeverity = 'error' | 'warning' | 'unconfirmed'
export type CheckStatus = 'passed' | 'blocked' | 'not_checked'

export interface EngineeringArtifact {
  id: string
  kind: EngineeringArtifactKind
  version: string
  sourcePath: string
  contentHash?: string
  basedOn?: {
    artifactVersions?: Record<string, string>
    componentSetRevision?: string
    componentSetDigest?: string
  }
}

export interface DimensionsMm { x: number; y: number; z: number }
export interface PinAssignment { signal: string; mcuPin: string; direction?: string }
export interface SchematicComponent {
  ref: string
  partNumber: string
  powerRole?: 'powered' | 'passive' | 'unpowered'
  powerDomainId?: string
  operatingVoltageV?: { min: number; max: number }
  interfaces?: readonly string[]
  physicalDimensionsMm?: DimensionsMm
}

export interface EngineeringProjectManifest {
  schemaVersion: 1
  project: { id: string; name: string; version: string; componentSetRevision: string }
  artifacts: readonly EngineeringArtifact[]
  schematic: {
    sourceArtifactId: string
    powerDomains?: readonly { id: string; nominalVoltageV: number }[]
    components: readonly SchematicComponent[]
    connections?: readonly { id: string; interface: string; endpoints: readonly string[] }[]
    gpioAssignments?: readonly PinAssignment[]
  }
  bom: {
    sourceArtifactId: string
    items: readonly { references: readonly string[]; partNumber: string; quantity: number }[]
  }
  firmware: {
    sourceArtifactId: string
    version: string
    compatibleSchematicVersion?: string
    pinConfig: readonly PinAssignment[]
  }
  cad: {
    sourceArtifactId: string
    componentClearances: readonly { componentRef: string; componentDimensionsMm?: DimensionsMm; spaceAvailableMm?: DimensionsMm }[]
  }
  assemblyInstructions: { sourceArtifactId: string }
  policy?: {
    requiredArtifacts?: readonly EngineeringArtifactKind[]
    requiredChecks?: readonly string[]
  }
}

export interface ConsistencyIssue {
  severity: IssueSeverity
  code: string
  checkId: string
  message: string
  path?: string
  artifactId?: string
  componentRef?: string
  evidence?: Readonly<Record<string, string | number | boolean | null>>
}

export interface ConsistencyCheck {
  id: string
  status: CheckStatus
  issueCodes: readonly string[]
  summary: string
}

export interface SafetyGate {
  id: string
  status: 'passed' | 'blocked'
  reason: string
}

export interface IntegrationReport {
  schemaVersion: 1
  projectId: string
  projectVersion: string
  status: 'READY_TO_BUILD' | 'BLOCKED'
  generatedAt: string
  checks: readonly ConsistencyCheck[]
  issues: readonly ConsistencyIssue[]
  errors: readonly ConsistencyIssue[]
  warnings: readonly ConsistencyIssue[]
  unconfirmed: readonly ConsistencyIssue[]
  safetyGates: readonly SafetyGate[]
}
