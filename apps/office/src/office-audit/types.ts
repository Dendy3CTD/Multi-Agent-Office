export type AuditStatus = 'PASS' | 'WARNING' | 'FAIL'

export interface AuditFinding {
  code: string
  severity: AuditStatus
  description: string
  subject?: string
  file?: string
  asset?: string
  metric?: string
  category?: 'validator' | 'performance' | 'compatibility' | 'integration'
  recommendation: string
}

export interface AuditSummary {
  pass: number
  warning: number
  fail: number
}

export interface AuditReport {
  status: AuditStatus
  findings: readonly AuditFinding[]
  summary: AuditSummary
}

export interface AssetManifestRecord {
  id: string
  url: string
  sizeBytes?: number
  type?: string
  scale: number
  origin: readonly [number, number, number]
  anchor: string
  bounds: readonly [number, number, number]
  license: string
  source: string
  [key: string]: unknown
}

export interface AssetManifest {
  assets: readonly AssetManifestRecord[]
  [key: string]: unknown
}

export interface ManifestValidationOptions {
  supportedExtensions?: readonly string[]
  allowedAnchors?: readonly string[]
}

export interface AuditableAssetFile {
  path: string
  bytes: Uint8Array
}

export interface AssetAuditOptions extends ManifestValidationOptions {
  suspiciousAssetBytes?: number
}

export interface PerformanceMeasurements {
  totalAssetBytes?: number
  textureBytes?: number
  maxTextureDimension?: number
  textureCount?: number
  objectCount?: number
  meshCount?: number
  triangleCount?: number
  vertexCount?: number
  lightCount?: number
  drawCalls?: number
  dpr?: number
  animationLoopActive?: boolean
  pageVisible?: boolean
  sceneAnimating?: boolean
  loadTimeMs?: number
  gpuMemoryBytes?: number
}

export interface PerformanceBudget {
  maxTotalAssetBytes: number
  maxTextureBytes: number
  maxTextureDimension: number
  maxTextureCount: number
  maxObjectCount: number
  maxMeshCount: number
  maxTriangleCount: number
  maxVertexCount: number
  maxLightCount: number
  maxDrawCalls: number
  maxDpr: number
  maxLoadTimeMs: number
  maxGpuMemoryBytes: number
  allowAnimationWhenIdle: boolean
}

export type PerformanceTier = 'low' | 'medium' | 'high'

export interface PerformanceEvaluationOptions {
  budget?: Partial<PerformanceBudget>
  requireRuntimeMetrics?: boolean
}

export interface GlbStatistics {
  byteLength: number
  binaryChunkBytes: number
  declaredBufferBytes: number
  nodeCount: number
  meshCount: number
  primitiveCount: number
  vertexCount: number
  triangleCount: number
  materialCount: number
  textureCount: number
  imageCount: number
  animationCount: number
  lightCount: number
  nodeNames: readonly string[]
}

export interface GlbInspection {
  report: AuditReport
  statistics?: GlbStatistics
}

export interface RendererRuntimeMetrics {
  source: 'measured'
  capturedAt: string
  renderer: string
  sampleDurationMs: number
  drawCalls: number
  meshCount: number
  triangleCount: number
  geometryCount: number
  textureCount: number
  lightCount: number
  dpr: number
  animationLoopActive: boolean
  pageVisible: boolean
  sceneAnimating: boolean
  loadTimeMs?: number
  memoryEstimate?: {
    bytes: number
    method: string
  }
  webglErrors: readonly string[]
  consoleErrors: readonly string[]
  assetLoadFailures: readonly string[]
  pendingRequestsAfterSettle: number
  disposeVerified?: boolean
  showroomSwitchVerified?: boolean
  assetCache?: {
    entries: number
    sharedDocuments: boolean
    evictionSupported: boolean
  }
  lifecycle?: {
    webglContextLost: boolean
    animationFramesAfterDispose: number
    resourcesBeforeDispose?: number
    resourcesAfterDispose?: number
  }
}

export type SpatialAxis = 'X' | 'Y' | 'Z'

export interface SpatialPoint3 {
  x: number
  y: number
  z: number
}

export interface SpatialBounds3 {
  min: SpatialPoint3
  max: SpatialPoint3
}

export interface GlbNodeSpatialBounds {
  node: string
  bounds: SpatialBounds3
  size: SpatialPoint3
}

export interface GlbSpatialInspection {
  report: AuditReport
  nodes: Readonly<Record<string, GlbNodeSpatialBounds>>
  inferredUpAxis?: SpatialAxis
}

export interface GlbAxisReferenceEvidence {
  assetId: string
  node: string
  scores: Readonly<Record<SpatialAxis, number>>
}

export interface GlbAxisVerification {
  report: AuditReport
  inferredUpAxis?: SpatialAxis
  confidence: number
  references: readonly GlbAxisReferenceEvidence[]
}

export type SpatialObjectKind = 'floor' | 'wall' | 'window' | 'partition' | 'desk' | 'chair' | 'plant' | 'character' | 'furniture' | 'decoration'

export interface SpatialObject {
  id: string
  assetId: string
  kind: SpatialObjectKind
  bounds: SpatialBounds3
  position?: SpatialPoint3
  expectedPosition?: SpatialPoint3
  expectedSize?: SpatialPoint3
  referenceSize?: SpatialPoint3
  deskId?: string
  employeeId?: string
  wallId?: string
  requiresFloorContact?: boolean
}

export interface SpatialWorkstation {
  deskId: string
  employeeId?: string
  reserved: boolean
}

export interface SpatialSceneSnapshot {
  file: string
  manifestUpAxis: SpatialAxis
  geometryUpAxis?: SpatialAxis
  rendererAssetUpAxis: SpatialAxis
  logicalFloorBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  floorSurfaceY: number
  objects: readonly SpatialObject[]
  workstations: readonly SpatialWorkstation[]
  visibleDeskIds: readonly string[]
  visibleEmployeeIds: readonly string[]
  surfaceMaterials?: {
    floorHasTexture: boolean
    fallbackFloorHasTexture: boolean
    loadedArtReplacesFallback: boolean
    mappingsResolved: boolean
  }
}

export interface SpatialAuditTolerances {
  floorContact: number
  floorPenetration: number
  roomMargin: number
  wallSurfaceDistance: number
  wallSpanCoverage: number
  windowSpanCoverage: number
  characterDeskDistance: number
  chairDeskDistance: number
  wallBoundaryDistance: number
  partitionHeightToThickness: number
  layoutPosition: number
  boundsRelativeError: number
  extremeScaleRatioMin: number
  extremeScaleRatioMax: number
}

export interface CoordinateContract {
  unit: 'metre' | string
  upAxis: 'X' | 'Y' | 'Z'
  horizontalAxes: readonly [string, string]
  handedness: 'left' | 'right'
  originConvention: 'center' | 'lower-left' | string
  modelForwardAxis?: string
}

export interface CompatibilityBounds {
  x: number
  z: number
  width: number
  depth: number
}

export interface CompatibilitySeat {
  employeeId?: string
  deskId: string
  x: number
  z: number
}

export interface OfficeCompatibilitySnapshot {
  asset: {
    file: string
    coordinate: CoordinateContract
    defaultScale: number
    assetIds: readonly string[]
    geometryUpAxis?: SpatialAxis
  }
  layout: {
    file: string
    coordinate: CoordinateContract
    bounds: CompatibilityBounds
    seats: readonly CompatibilitySeat[]
    hasOrientations: boolean
  }
  renderer: {
    file: string
    coordinate: CoordinateContract
    bounds: CompatibilityBounds
    seats: readonly CompatibilitySeat[]
    usedAssetIds: readonly string[]
    clickTargetEmployeeIds: readonly string[]
    consumesAssetManifest: boolean
    consumesLayout: boolean
    appliesModelOrientation: boolean
    appliesAssetScale: boolean
    adaptsLayoutOrigin: boolean
    assetUpAxisAssumption: 'X' | 'Y' | 'Z'
    retainsFallbackAfterAssetLoad: boolean
    fallbackVisibleWithAssetPack: boolean
    configuredDprCap?: number
    pausesAnimationWhenHidden: boolean
    axisConversionCount?: number
    manifestScaleApplicationCount?: number
    usesSharedArtRuntime?: boolean
    loadsMaterialLibrary?: boolean
    disposesLoadedArt?: boolean
    reusesPlacedMaterials?: boolean
  }
}

export interface MaterialsLibraryAudit {
  report: AuditReport
  materialCount: number
}

export interface ProjectAssetPackInput {
  manifestPath: string
  manifest: unknown
  materialsPath: string
  materials: unknown
  glbPath: string
  files: readonly AuditableAssetFile[]
}

export interface ProjectQualityGateInput {
  assetPack: ProjectAssetPackInput
  compatibility?: OfficeCompatibilitySnapshot
  runtime?: RendererRuntimeMetrics
  tier?: PerformanceTier
  performanceBudget?: Partial<PerformanceBudget>
}

export interface ProjectQualityGateResult {
  status: AuditStatus
  report: AuditReport
  sections: {
    assets: AuditReport
    materials: AuditReport
    performance: AuditReport
    compatibility: AuditReport
    runtime: AuditReport
  }
  evidence: {
    assetBytes: number
    textureBytes: number
    glb?: GlbStatistics
    runtimeMeasured: boolean
  }
}

export interface MachineQualityGateIssue {
  code: string
  severity: AuditStatus
  file?: string
  asset?: string
  metric?: string
  category?: AuditFinding['category']
  explanation: string
  recommendation: string
}

export interface MachineQualityGateReport {
  status: AuditStatus
  sections: Record<keyof ProjectQualityGateResult['sections'], AuditStatus>
  evidence: ProjectQualityGateResult['evidence']
  issues: readonly MachineQualityGateIssue[]
}
