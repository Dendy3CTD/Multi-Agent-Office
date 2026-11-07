import { createAuditReport } from './report'
import type {
  AssetManifest,
  AuditFinding,
  GlbAxisReferenceEvidence,
  GlbAxisVerification,
  GlbNodeSpatialBounds,
  SpatialAxis,
  SpatialPoint3,
} from './types'

const REFERENCE_ASSETS = new Set([
  'floor.oak.light',
  'wall.brick.loft',
  'wall.painted',
  'desk.modern',
  'plant.potted',
  'window.frame',
  'partition.glass',
])

function referenceAxis(assetId: string, size: SpatialPoint3): SpatialAxis | undefined {
  const ranked = [...([['X', size.x], ['Y', size.y], ['Z', size.z]] as const)].sort((left, right) => left[1] - right[1])
  if (assetId === 'floor.oak.light') return ranked[0][1] * 4 < ranked[1][1] ? ranked[0][0] : undefined
  if (assetId === 'plant.potted') return ranked[2][1] > ranked[1][1] * 1.4 ? ranked[2][0] : undefined
  if (assetId === 'desk.modern' || assetId.startsWith('wall.') || assetId === 'window.frame' || assetId === 'partition.glass') return ranked[1][0]
  return undefined
}

function verticalRange(bounds: GlbNodeSpatialBounds, axis: SpatialAxis): readonly [number, number] {
  if (axis === 'X') return [bounds.bounds.min.x, bounds.bounds.max.x]
  if (axis === 'Y') return [bounds.bounds.min.y, bounds.bounds.max.y]
  return [bounds.bounds.min.z, bounds.bounds.max.z]
}

export function verifyGlbAxisFromReferenceBounds(
  nodes: Readonly<Record<string, GlbNodeSpatialBounds>>,
  manifest: AssetManifest,
  declaredUpAxis: SpatialAxis,
  file = 'office-pack.glb',
): GlbAxisVerification {
  const references: GlbAxisReferenceEvidence[] = []
  for (const asset of manifest.assets) {
    if (!REFERENCE_ASSETS.has(asset.id) || typeof asset.node !== 'string' || asset.bounds.some(value => value <= 0)) continue
    const node = nodes[asset.node]
    if (!node) continue
    const inferred = referenceAxis(asset.id, node.size)
    if (!inferred) continue
    references.push({
      assetId: asset.id,
      node: asset.node,
      scores: { X: inferred === 'X' ? 0 : 1, Y: inferred === 'Y' ? 0 : 1, Z: inferred === 'Z' ? 0 : 1 },
    })
  }

  const findings: AuditFinding[] = []
  if (references.length < 3) {
    findings.push({ code: 'GLB_AXIS_REFERENCE_INSUFFICIENT', severity: 'WARNING', description: `Only ${references.length} known reference objects can be used for axis verification.`, file, recommendation: 'Export floor, wall, desk, plant, window, and partition bounds with stable node names.', category: 'validator' })
    return { report: createAuditReport(findings), confidence: 0, references }
  }
  const totals: Record<SpatialAxis, number> = { X: 0, Y: 0, Z: 0 }
  for (const reference of references) for (const axis of ['X', 'Y', 'Z'] as const) totals[axis] += reference.scores[axis]
  const ranked = (['X', 'Y', 'Z'] as const).map(axis => ({ axis, score: totals[axis] / references.length })).sort((left, right) => left.score - right.score)
  const inferredUpAxis = ranked[0].axis
  const confidence = Math.max(0, Math.min(1, (ranked[1].score - ranked[0].score) / Math.max(ranked[1].score, 0.001)))
  if (confidence < 0.15) findings.push({ code: 'GLB_AXIS_INFERENCE_AMBIGUOUS', severity: 'WARNING', description: `Reference-bound axis confidence is only ${(confidence * 100).toFixed(1)}%.`, file, recommendation: 'Add an explicit asymmetric calibration object or authoritative exporter metadata.', category: 'validator' })
  if (inferredUpAxis !== declaredUpAxis) findings.push({ code: 'GLB_REFERENCE_AXIS_MISMATCH', severity: 'FAIL', description: `Known model bounds indicate ${inferredUpAxis}-up, while the manifest declares ${declaredUpAxis}-up.`, file, recommendation: 'Normalize GLB geometry to the declared axis or correct manifest metadata.', category: 'compatibility' })

  for (const asset of manifest.assets) {
    if (typeof asset.node !== 'string') continue
    const node = nodes[asset.node]
    if (!node) continue
    const [minimum, maximum] = verticalRange(node, inferredUpAxis)
    const height = maximum - minimum
    if (['floor-center', 'bottom-center'].includes(asset.anchor) && Math.abs(minimum) > Math.max(0.05, height * 0.08)) findings.push({
      code: 'ASSET_FLOOR_PIVOT_MISMATCH', severity: 'FAIL', description: `${asset.id} uses ${asset.anchor} but its vertical minimum is ${minimum.toFixed(3)} m from the node origin.`, file, asset: asset.id, recommendation: 'Move the node pivot to its floor contact plane or publish a truthful anchor offset.', category: 'compatibility',
    })
    if (asset.anchor === 'wall-center' && Math.abs((minimum + maximum) / 2) > Math.max(0.05, height * 0.1)) findings.push({
      code: 'ASSET_WALL_PIVOT_MISMATCH', severity: 'FAIL', description: `${asset.id} uses wall-center but its vertical centre is ${((minimum + maximum) / 2).toFixed(3)} m from the node origin.`, file, asset: asset.id, recommendation: 'Centre the wall-mounted node pivot or use an explicit bottom/offset anchor.', category: 'compatibility',
    })
  }
  return { report: createAuditReport(findings), inferredUpAxis, confidence, references }
}
