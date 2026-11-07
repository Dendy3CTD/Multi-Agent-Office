import { createAuditReport } from './report'
import type { AuditFinding, AuditReport, CompatibilityBounds, CoordinateContract, OfficeCompatibilitySnapshot } from './types'

function issue(
  code: string,
  severity: 'WARNING' | 'FAIL',
  description: string,
  file: string,
  recommendation: string,
  category: 'compatibility' | 'integration' | 'performance' = 'compatibility',
): AuditFinding {
  return { code, severity, description, file, recommendation, category }
}

function sameAxes(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((axis, index) => axis.toUpperCase() === right[index]?.toUpperCase())
}

function coordinateMismatch(asset: CoordinateContract, other: CoordinateContract): string[] {
  const differences: string[] = []
  if (asset.unit !== other.unit) differences.push(`unit ${asset.unit}/${other.unit}`)
  if (asset.upAxis !== other.upAxis) differences.push(`up axis ${asset.upAxis}/${other.upAxis}`)
  if (asset.handedness !== other.handedness) differences.push(`handedness ${asset.handedness}/${other.handedness}`)
  if (!sameAxes(asset.horizontalAxes, other.horizontalAxes)) differences.push(`horizontal axes ${asset.horizontalAxes.join('')}/${other.horizontalAxes.join('')}`)
  return differences
}

function contains(bounds: CompatibilityBounds, x: number, z: number): boolean {
  return x >= bounds.x && x <= bounds.x + bounds.width && z >= bounds.z && z <= bounds.z + bounds.depth
}

export function evaluateOfficeCompatibility(snapshot: OfficeCompatibilitySnapshot): AuditReport {
  const findings: AuditFinding[] = []
  const assetLayoutDifferences = coordinateMismatch(snapshot.asset.coordinate, snapshot.layout.coordinate)
  const assetRendererDifferences = coordinateMismatch(snapshot.asset.coordinate, snapshot.renderer.coordinate)
  if (assetLayoutDifferences.length > 0) findings.push(issue('ASSET_LAYOUT_COORDINATE_MISMATCH', 'FAIL', `Asset and layout coordinates differ: ${assetLayoutDifferences.join(', ')}.`, snapshot.layout.file, 'Align layout units and axes with the asset pack before placement.'))
  if (assetRendererDifferences.length > 0) findings.push(issue('ASSET_RENDERER_COORDINATE_MISMATCH', 'FAIL', `Asset and renderer coordinates differ: ${assetRendererDifferences.join(', ')}.`, snapshot.renderer.file, 'Apply a documented coordinate conversion in the renderer adapter.'))
  if (snapshot.asset.defaultScale <= 0 || !Number.isFinite(snapshot.asset.defaultScale)) findings.push(issue('ASSET_DEFAULT_SCALE_INVALID', 'FAIL', 'Asset default scale must be finite and positive.', snapshot.asset.file, 'Publish a positive metre-based default scale.'))

  if (snapshot.layout.coordinate.originConvention !== snapshot.renderer.coordinate.originConvention && !snapshot.renderer.adaptsLayoutOrigin) {
    findings.push(issue('ORIGIN_CONVENTION_ADAPTER_REQUIRED', 'WARNING', `Layout uses ${snapshot.layout.coordinate.originConvention} origin while renderer uses ${snapshot.renderer.coordinate.originConvention}.`, snapshot.renderer.file, 'Translate lower-left layout coordinates to the renderer origin in one tested adapter.'))
  }
  if (snapshot.asset.geometryUpAxis && snapshot.asset.geometryUpAxis !== snapshot.asset.coordinate.upAxis) {
    findings.push(issue('ASSET_METADATA_UP_AXIS_MISMATCH', 'FAIL', `Manifest declares ${snapshot.asset.coordinate.upAxis}-up but GLB geometry is ${snapshot.asset.geometryUpAxis}-up.`, snapshot.asset.file, 'Correct manifest coordinate metadata or regenerate the pack in the declared coordinate system.'))
  }
  const effectiveAssetUpAxis = snapshot.asset.geometryUpAxis ?? snapshot.asset.coordinate.upAxis
  if (snapshot.renderer.assetUpAxisAssumption !== effectiveAssetUpAxis) {
    findings.push(issue('ASSET_UP_AXIS_ASSUMPTION_MISMATCH', 'FAIL', `Asset geometry is ${effectiveAssetUpAxis}-up but renderer integration assumes ${snapshot.renderer.assetUpAxisAssumption}-up.`, snapshot.renderer.file, 'Derive conversion from validated geometry/manifest metadata and apply it once.'))
  }
  if (!snapshot.asset.coordinate.modelForwardAxis || !snapshot.renderer.coordinate.modelForwardAxis) {
    findings.push(issue('MODEL_FORWARD_AXIS_UNDECLARED', 'WARNING', 'Model forward-axis compatibility cannot be proven from the current contracts.', snapshot.asset.file, 'Declare model forward axis in manifest metadata and renderer placement contract.'))
  } else if (snapshot.asset.coordinate.modelForwardAxis !== snapshot.renderer.coordinate.modelForwardAxis) {
    findings.push(issue('MODEL_FORWARD_AXIS_MISMATCH', 'FAIL', `Asset forward axis ${snapshot.asset.coordinate.modelForwardAxis} differs from renderer ${snapshot.renderer.coordinate.modelForwardAxis}.`, snapshot.renderer.file, 'Rotate models in the placement adapter or align export orientation.'))
  }

  if (!snapshot.renderer.consumesAssetManifest) findings.push(issue('ASSET_MANIFEST_NOT_CONNECTED', 'WARNING', 'Renderer does not consume the v1 asset manifest yet.', snapshot.renderer.file, 'Connect the reviewed asset loader and resolve models by manifest asset ID.', 'integration'))
  if (!snapshot.renderer.consumesLayout) findings.push(issue('LAYOUT_NOT_CONNECTED', 'WARNING', 'Renderer does not consume the floor-layout output yet.', snapshot.renderer.file, 'Use layout desks, character spots, bounds, and camera through a typed adapter.', 'integration'))
  if (snapshot.layout.hasOrientations && !snapshot.renderer.appliesModelOrientation) findings.push(issue('MODEL_ORIENTATION_NOT_APPLIED', 'WARNING', 'Layout orientations are available but renderer placement does not apply them.', snapshot.renderer.file, 'Apply desk and character Y rotation from layout orientation.', 'integration'))
  if (!snapshot.renderer.appliesAssetScale) findings.push(issue('ASSET_SCALE_NOT_APPLIED', 'WARNING', 'Renderer placement does not apply the manifest asset scale.', snapshot.renderer.file, 'Multiply instance scale by the validated manifest scale.', 'integration'))
  if ((snapshot.renderer.axisConversionCount ?? 1) > 1) findings.push(issue('ASSET_AXIS_CONVERSION_DUPLICATED', 'FAIL', 'Renderer applies the asset-axis conversion more than once.', snapshot.renderer.file, 'Keep one coordinate conversion at a documented integration boundary.', 'integration'))
  if ((snapshot.renderer.manifestScaleApplicationCount ?? (snapshot.renderer.appliesAssetScale ? 1 : 0)) > 1) findings.push(issue('ASSET_SCALE_DUPLICATED', 'FAIL', 'Manifest scale is applied more than once.', snapshot.renderer.file, 'Apply manifest scale once, then apply clearly separated composition fitting.', 'integration'))
  if (snapshot.renderer.usesSharedArtRuntime === false) findings.push(issue('SHARED_ART_RUNTIME_BYPASSED', 'WARNING', 'Renderer bypasses createOfficeArtRuntime and maintains a second loading/transform path.', snapshot.renderer.file, 'Use one tested asset runtime or share its axis, pivot, scale, material, cache, and disposal contracts.', 'integration'))
  if (snapshot.renderer.loadsMaterialLibrary === false) findings.push(issue('MATERIAL_LIBRARY_NOT_CONNECTED', 'FAIL', 'Renderer does not load materials.json, so external material IDs and textures cannot affect the scene.', snapshot.renderer.file, 'Load and bind the material library or embed reviewed materials and textures in the GLB.', 'integration'))
  if (snapshot.renderer.disposesLoadedArt === false) findings.push(issue('LOADED_ART_DISPOSAL_MISSING', 'FAIL', 'Loaded art-root materials and textures are detached without deterministic disposal.', snapshot.renderer.file, 'Dispose scene-owned cloned materials/textures and release cache ownership on final unmount.', 'performance'))
  if (snapshot.renderer.reusesPlacedMaterials === false) findings.push(issue('PLACED_MATERIALS_NOT_SHARED', 'WARNING', 'Repeated asset placement creates separate material/texture instances.', snapshot.renderer.file, 'Cache resolved materials and textures per material key, then dispose them once with the pack.', 'performance'))
  if (snapshot.renderer.retainsFallbackAfterAssetLoad) findings.push(issue('HIDDEN_FALLBACK_RETAINED', 'WARNING', 'Procedural fallback remains allocated after the GLB pack loads successfully.', snapshot.renderer.file, 'Dispose and detach fallback geometry, materials, and textures after the art pack is ready.', 'performance'))
  if (snapshot.renderer.fallbackVisibleWithAssetPack) findings.push(issue('DUPLICATE_FALLBACK_RENDERING', 'FAIL', 'Procedural fallback and loaded GLB art can remain visible at the same time.', snapshot.renderer.file, 'Show fallback only when no required GLB assets were placed; otherwise detach and dispose it.', 'performance'))
  if (!snapshot.renderer.pausesAnimationWhenHidden) findings.push(issue('ANIMATION_VISIBILITY_PAUSE_MISSING', 'WARNING', 'Renderer contract does not pause its animation loop when the document is hidden.', snapshot.renderer.file, 'Pause requestAnimationFrame on visibilitychange and resume on demand.', 'performance'))

  const assetIds = new Set(snapshot.asset.assetIds)
  for (const assetId of snapshot.renderer.usedAssetIds) {
    if (!assetIds.has(assetId)) findings.push({ ...issue('RENDERER_ASSET_ID_UNKNOWN', 'FAIL', `Renderer requests unknown asset id "${assetId}".`, snapshot.renderer.file, 'Use an ID present in manifest.json.'), asset: assetId })
  }

  const layoutByEmployee = new Map(snapshot.layout.seats.flatMap(seat => seat.employeeId ? [[seat.employeeId, seat] as const] : []))
  const rendererByEmployee = new Map(snapshot.renderer.seats.flatMap(seat => seat.employeeId ? [[seat.employeeId, seat] as const] : []))
  for (const [employeeId, layoutSeat] of layoutByEmployee) {
    const rendererSeat = rendererByEmployee.get(employeeId)
    if (!rendererSeat) findings.push({ ...issue('EMPLOYEE_RENDERER_SEAT_MISSING', 'FAIL', `Employee ${employeeId} has no renderer seat.`, snapshot.renderer.file, 'Preserve every employee-to-desk assignment in the renderer adapter.'), asset: employeeId })
    else if (rendererSeat.deskId !== layoutSeat.deskId) findings.push({ ...issue('EMPLOYEE_DESK_MISMATCH', 'FAIL', `Employee ${employeeId} maps to ${layoutSeat.deskId} in layout and ${rendererSeat.deskId} in renderer.`, snapshot.renderer.file, 'Use the Directory/layout deskId without synthesizing a replacement.'), asset: employeeId })
  }

  for (const seat of snapshot.layout.seats) if (!contains(snapshot.layout.bounds, seat.x, seat.z)) findings.push({ ...issue('LAYOUT_SEAT_OUT_OF_BOUNDS', 'FAIL', `Desk ${seat.deskId} lies outside layout floor bounds.`, snapshot.layout.file, 'Correct the layout position or floor bounds.'), asset: seat.deskId })
  for (const seat of snapshot.renderer.seats) if (!contains(snapshot.renderer.bounds, seat.x, seat.z)) findings.push({ ...issue('RENDERER_SEAT_OUT_OF_BOUNDS', 'FAIL', `Desk ${seat.deskId} lies outside renderer room bounds.`, snapshot.renderer.file, 'Correct the renderer placement or room bounds.'), asset: seat.deskId })

  if (snapshot.layout.bounds.width !== snapshot.renderer.bounds.width || snapshot.layout.bounds.depth !== snapshot.renderer.bounds.depth) {
    findings.push(issue('FLOOR_BOUNDS_MISMATCH', 'WARNING', `Layout floor is ${snapshot.layout.bounds.width}×${snapshot.layout.bounds.depth} while renderer room is ${snapshot.renderer.bounds.width}×${snapshot.renderer.bounds.depth}.`, snapshot.renderer.file, 'Drive renderer room dimensions from the selected floor layout.', 'integration'))
  }

  const clickTargets = new Set(snapshot.renderer.clickTargetEmployeeIds)
  for (const seat of snapshot.renderer.seats) {
    if (seat.employeeId && !clickTargets.has(seat.employeeId)) findings.push({ ...issue('EMPLOYEE_CLICK_TARGET_MISSING', 'FAIL', `Employee ${seat.employeeId} has no click target.`, snapshot.renderer.file, 'Attach employeeId to the raycast ancestor and cover it with an interaction test.'), asset: seat.employeeId })
  }
  return createAuditReport(findings)
}
