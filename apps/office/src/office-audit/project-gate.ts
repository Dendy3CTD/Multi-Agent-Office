import { evaluateOfficeCompatibility } from './compatibility'
import { auditAssetFiles } from './files'
import { inspectGlb } from './gltf'
import { isAssetManifest } from './manifest'
import { validateMaterialsLibrary } from './materials'
import { canonicalPath, extensionOf } from './paths'
import { evaluatePerformanceBudget } from './performance'
import { createAuditReport, formatAuditReport, mergeAuditReports } from './report'
import { auditRendererRuntime, performanceMeasurementsFromRuntime } from './runtime'
import type {
  AuditFinding,
  AuditReport,
  PerformanceMeasurements,
  MachineQualityGateReport,
  ProjectQualityGateInput,
  ProjectQualityGateResult,
} from './types'

const TEXTURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.basis'])

function integrationReport(input: ProjectQualityGateInput): AuditReport {
  if (input.compatibility) return evaluateOfficeCompatibility(input.compatibility)
  return createAuditReport([{
    code: 'COMPATIBILITY_SNAPSHOT_MISSING',
    severity: 'WARNING',
    description: 'No renderer/layout compatibility snapshot was supplied.',
    file: 'office-3d / office-layout',
    recommendation: 'Provide coordinate, bounds, seat, asset ID, orientation, and click-target contracts.',
    category: 'integration',
  }])
}

function materialMappingFindings(input: ProjectQualityGateInput): AuditFinding[] {
  if (!isAssetManifest(input.assetPack.manifest)) return []
  if (typeof input.assetPack.materials !== 'object' || input.assetPack.materials === null) return []
  const root = input.assetPack.materials as { materials?: unknown; mappings?: unknown }
  if (typeof root.materials !== 'object' || root.materials === null || Array.isArray(root.materials)) return []
  const materialKeys = new Set(Object.keys(root.materials as Record<string, unknown>))
  const mappings = typeof root.mappings === 'object' && root.mappings !== null && !Array.isArray(root.mappings)
    ? root.mappings as Record<string, unknown>
    : undefined
  const findings: AuditFinding[] = []
  for (const asset of input.assetPack.manifest.assets) {
    if (asset.type !== 'material') continue
    // Texture records are also represented as material assets in the manifest,
    // but they are files, not keys in the material library map.
    if (canonicalPath(asset.url) !== canonicalPath(input.assetPack.materialsPath)) continue
    const explicitKey = typeof asset.materialKey === 'string' ? asset.materialKey : undefined
    const inferredKey = asset.id.startsWith('material.') ? asset.id.slice('material.'.length) : asset.id
    const key = explicitKey ?? inferredKey
    const mapped = mappings?.[asset.id]
    const mappedLibraryKey = typeof mapped === 'object' && mapped !== null && !Array.isArray(mapped)
      ? (mapped as Record<string, unknown>).libraryKey
      : undefined
    if (!materialKeys.has(key) && !(typeof mappedLibraryKey === 'string' && materialKeys.has(mappedLibraryKey))) findings.push({
      code: 'MATERIAL_MAPPING_UNRESOLVED',
      severity: 'WARNING',
      description: `Manifest material "${asset.id}" does not resolve to a materials.json key; inferred key "${key}" is absent.`,
      file: input.assetPack.manifestPath,
      asset: asset.id,
      recommendation: 'Add an explicit materialKey or align the manifest ID suffix with materials.json.',
      category: 'compatibility',
    })
  }
  return findings
}

export function runProjectQualityGate(input: ProjectQualityGateInput): ProjectQualityGateResult {
  const fileIndex = new Map(input.assetPack.files.map(file => [canonicalPath(file.path), file]))
  const requiredPaths = [input.assetPack.manifestPath, input.assetPack.materialsPath, input.assetPack.glbPath].map(canonicalPath)
  const requiredFindings: AuditFinding[] = requiredPaths.flatMap(path => fileIndex.has(path) ? [] : [{
    code: 'PROJECT_ASSET_FILE_MISSING',
    severity: 'FAIL' as const,
    description: `Required project asset "${path}" is missing from the audit input.`,
    file: path,
    recommendation: 'Load manifest.json, materials.json, and office-pack.glb into the project gate.',
    category: 'validator' as const,
  }])

  const glbFile = fileIndex.get(canonicalPath(input.assetPack.glbPath))
  const glbInspection = glbFile ? inspectGlb(glbFile.bytes, input.assetPack.glbPath) : undefined
  const assetFindings: AuditFinding[] = [...requiredFindings]
  if (isAssetManifest(input.assetPack.manifest) && glbInspection?.statistics) {
    const nodeNames = new Set(glbInspection.statistics.nodeNames)
    for (const asset of input.assetPack.manifest.assets) {
      if (asset.type !== 'model' || canonicalPath(asset.url) !== canonicalPath(input.assetPack.glbPath)) continue
      if (typeof asset.node !== 'string' || !nodeNames.has(asset.node)) assetFindings.push({
        code: 'GLB_NODE_REFERENCE_MISSING',
        severity: 'FAIL',
        description: `Manifest model "${asset.id}" references missing GLB node "${String(asset.node ?? '')}".`,
        file: input.assetPack.glbPath,
        asset: asset.id,
        recommendation: 'Correct the manifest node or export the named node into the GLB.',
        category: 'compatibility',
      })
    }
  }
  const assets = mergeAuditReports(
    auditAssetFiles(input.assetPack.manifest, input.assetPack.files),
    glbInspection?.report ?? createAuditReport([]),
    createAuditReport(assetFindings),
  )

  const materialsAudit = validateMaterialsLibrary(input.assetPack.materials, input.assetPack.materialsPath)
  const materials = mergeAuditReports(materialsAudit.report, createAuditReport(materialMappingFindings(input)))
  const uniqueFiles = [...fileIndex.values()]
  const assetBytes = uniqueFiles.reduce((total, file) => total + file.bytes.byteLength, 0)
  const textureFiles = uniqueFiles.filter(file => TEXTURE_EXTENSIONS.has(extensionOf(file.path)))
  const textureBytes = textureFiles.reduce((total, file) => total + file.bytes.byteLength, 0)
  const offline: PerformanceMeasurements = {
    totalAssetBytes: assetBytes,
    textureBytes,
    textureCount: glbInspection?.statistics?.textureCount ?? textureFiles.length,
    maxTextureDimension: textureFiles.length === 0 && (glbInspection?.statistics?.textureCount ?? 0) === 0 ? 0 : undefined,
    objectCount: glbInspection?.statistics?.nodeCount,
    meshCount: glbInspection?.statistics?.meshCount,
    triangleCount: glbInspection?.statistics?.triangleCount,
    vertexCount: glbInspection?.statistics?.vertexCount,
    lightCount: glbInspection?.statistics?.lightCount,
  }
  const measurements = input.runtime
    ? { ...offline, ...performanceMeasurementsFromRuntime(input.runtime) }
    : offline
  const performance = evaluatePerformanceBudget(
    measurements,
    input.tier ?? 'low',
    { budget: input.performanceBudget, requireRuntimeMetrics: false },
  )
  const compatibility = integrationReport(input)
  const runtime = auditRendererRuntime(input.runtime)
  const report = mergeAuditReports(assets, materials, performance, compatibility, runtime)
  return {
    status: report.status,
    report,
    sections: { assets, materials, performance, compatibility, runtime },
    evidence: {
      assetBytes,
      textureBytes,
      glb: glbInspection?.statistics,
      runtimeMeasured: input.runtime?.source === 'measured',
    },
  }
}

export function formatProjectQualityGate(result: ProjectQualityGateResult): string {
  const glb = result.evidence.glb
  const evidence = glb
    ? `Measured pack: ${result.evidence.assetBytes} bytes; GLB ${glb.byteLength} bytes, ${glb.meshCount} meshes, ${glb.triangleCount} triangles, ${glb.vertexCount} vertices, ${glb.lightCount} lights, ${glb.textureCount} textures.`
    : `Measured pack: ${result.evidence.assetBytes} bytes; GLB statistics unavailable.`
  return [`3D Quality Gate: ${result.status}`, evidence, `Runtime measured: ${result.evidence.runtimeMeasured ? 'yes' : 'no'}`, '', formatAuditReport(result.report)].join('\n')
}

export function serializeProjectQualityGate(result: ProjectQualityGateResult): string {
  return JSON.stringify(toMachineReadableQualityGate(result), null, 2)
}

export function toMachineReadableQualityGate(result: ProjectQualityGateResult): MachineQualityGateReport {
  return {
    status: result.status,
    sections: {
      assets: result.sections.assets.status,
      materials: result.sections.materials.status,
      performance: result.sections.performance.status,
      compatibility: result.sections.compatibility.status,
      runtime: result.sections.runtime.status,
    },
    evidence: result.evidence,
    issues: result.report.findings
      .filter(finding => finding.code !== 'AUDIT_OK')
      .map(finding => ({
        code: finding.code,
        severity: finding.severity,
        file: finding.file,
        asset: finding.asset,
        metric: finding.metric,
        category: finding.category,
        explanation: finding.description,
        recommendation: finding.recommendation,
      })),
  }
}
