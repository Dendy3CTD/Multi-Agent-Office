import { createAuditReport } from './report'
import type {
  AuditFinding,
  AuditReport,
  SpatialAuditTolerances,
  SpatialBounds3,
  SpatialObject,
  SpatialPoint3,
  SpatialSceneSnapshot,
} from './types'

export const DEFAULT_SPATIAL_TOLERANCES: SpatialAuditTolerances = {
  floorContact: 0.12,
  floorPenetration: 0.08,
  roomMargin: 0.25,
  wallSurfaceDistance: 0.15,
  wallSpanCoverage: 0.9,
  windowSpanCoverage: 0.8,
  characterDeskDistance: 1.6,
  chairDeskDistance: 1.8,
  wallBoundaryDistance: 0.2,
  partitionHeightToThickness: 3,
  layoutPosition: 0.2,
  boundsRelativeError: 0.25,
  extremeScaleRatioMin: 0.5,
  extremeScaleRatioMax: 2,
}

function issue(code: string, severity: 'WARNING' | 'FAIL', description: string, file: string, asset: string, recommendation: string): AuditFinding {
  return { code, severity, description, file, asset, recommendation, category: 'compatibility' }
}

function center(bounds: SpatialBounds3): SpatialPoint3 {
  return { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 }
}

function dimensions(bounds: SpatialBounds3): SpatialPoint3 {
  return { x: bounds.max.x - bounds.min.x, y: bounds.max.y - bounds.min.y, z: bounds.max.z - bounds.min.z }
}

function unionBounds(objects: readonly SpatialObject[]): SpatialBounds3 | undefined {
  return objects.reduce<SpatialBounds3 | undefined>((result, object) => result ? ({
    min: { x: Math.min(result.min.x, object.bounds.min.x), y: Math.min(result.min.y, object.bounds.min.y), z: Math.min(result.min.z, object.bounds.min.z) },
    max: { x: Math.max(result.max.x, object.bounds.max.x), y: Math.max(result.max.y, object.bounds.max.y), z: Math.max(result.max.z, object.bounds.max.z) },
  }) : object.bounds, undefined)
}

function intervalCoverage(min: number, max: number, containerMin: number, containerMax: number): number {
  const length = max - min
  if (length <= 0) return 0
  return Math.max(0, Math.min(max, containerMax) - Math.max(min, containerMin)) / length
}

function horizontalDistance(left: SpatialBounds3, right: SpatialBounds3): number {
  const leftCenter = center(left)
  const rightCenter = center(right)
  return Math.hypot(leftCenter.x - rightCenter.x, leftCenter.z - rightCenter.z)
}

function requiresFloorContact(object: SpatialObject): boolean {
  if (object.requiresFloorContact !== undefined) return object.requiresFloorContact
  return ['wall', 'partition', 'desk', 'chair', 'plant', 'character', 'furniture'].includes(object.kind)
}

function mustFitRoom(object: SpatialObject): boolean {
  return ['partition', 'desk', 'chair', 'plant', 'character', 'furniture', 'decoration'].includes(object.kind)
}

export function evaluateSpatialQuality(
  snapshot: SpatialSceneSnapshot,
  overrides: Partial<SpatialAuditTolerances> = {},
): AuditReport {
  const tolerance = { ...DEFAULT_SPATIAL_TOLERANCES, ...overrides }
  const findings: AuditFinding[] = []
  const floors = snapshot.objects.filter(object => object.kind === 'floor')
  const renderedFloor = unionBounds(floors)

  if (snapshot.geometryUpAxis && snapshot.geometryUpAxis !== snapshot.manifestUpAxis) findings.push(issue(
    'GLB_UP_AXIS_METADATA_MISMATCH', 'FAIL',
    `Manifest declares ${snapshot.manifestUpAxis}-up while floor geometry indicates ${snapshot.geometryUpAxis}-up.`,
    snapshot.file, 'office-pack.glb', 'Correct coordinate metadata or regenerate geometry in the declared orientation.',
  ))
  const effectiveAxis = snapshot.geometryUpAxis ?? snapshot.manifestUpAxis
  if (snapshot.rendererAssetUpAxis !== effectiveAxis) findings.push(issue(
    'RENDERER_UP_AXIS_MISMATCH', 'FAIL',
    `Renderer converts from ${snapshot.rendererAssetUpAxis}-up but geometry is ${effectiveAxis}-up.`,
    snapshot.file, 'renderer transform', 'Apply exactly one conversion from the validated GLB geometry axis.',
  ))

  if (!renderedFloor) {
    findings.push(issue('RENDERED_FLOOR_MISSING', 'FAIL', 'No visible floor object is present.', snapshot.file, 'floor', 'Render one floor matching logical bounds.'))
  } else {
    const logicalWidth = snapshot.logicalFloorBounds.maxX - snapshot.logicalFloorBounds.minX
    const logicalDepth = snapshot.logicalFloorBounds.maxZ - snapshot.logicalFloorBounds.minZ
    const actual = dimensions(renderedFloor)
    if (actual.x < logicalWidth * tolerance.wallSpanCoverage || actual.z < logicalDepth * tolerance.wallSpanCoverage) findings.push(issue(
      'FLOOR_COVERAGE_MISMATCH', 'FAIL',
      `Rendered floor covers ${actual.x.toFixed(2)}×${actual.z.toFixed(2)} m for logical ${logicalWidth.toFixed(2)}×${logicalDepth.toFixed(2)} m bounds.`,
      snapshot.file, floors.map(floor => floor.assetId).join(', '), 'Scale/tile floor assets to the full layout bounds or use matching pack dimensions.',
    ))
  }

  for (const object of snapshot.objects) {
    const objectCenter = center(object.bounds)
    if (objectCenter.x < snapshot.logicalFloorBounds.minX - tolerance.roomMargin || objectCenter.x > snapshot.logicalFloorBounds.maxX + tolerance.roomMargin
      || objectCenter.z < snapshot.logicalFloorBounds.minZ - tolerance.roomMargin || objectCenter.z > snapshot.logicalFloorBounds.maxZ + tolerance.roomMargin) findings.push(issue(
      'OBJECT_OUTSIDE_ROOM', 'FAIL', `${object.id} is centred outside logical room bounds.`, snapshot.file, object.id, 'Correct placement coordinates or floor-origin conversion.',
    ))

    if (mustFitRoom(object) && (object.bounds.min.x < snapshot.logicalFloorBounds.minX - tolerance.roomMargin
      || object.bounds.max.x > snapshot.logicalFloorBounds.maxX + tolerance.roomMargin
      || object.bounds.min.z < snapshot.logicalFloorBounds.minZ - tolerance.roomMargin
      || object.bounds.max.z > snapshot.logicalFloorBounds.maxZ + tolerance.roomMargin)) findings.push(issue(
      'OBJECT_BOUNDS_OUTSIDE_ROOM', 'FAIL', `${object.id} bounds extend beyond the logical room.`, snapshot.file, object.id, 'Keep the full model bounds inside floor limits; do not validate only its pivot or centre.',
    ))

    if (object.position && object.expectedPosition) {
      const positionError = Math.hypot(object.position.x - object.expectedPosition.x, object.position.y - object.expectedPosition.y, object.position.z - object.expectedPosition.z)
      if (positionError > tolerance.layoutPosition) findings.push(issue(
        'LAYOUT_POSITION_MISMATCH', 'FAIL', `${object.id} placement differs from layout by ${positionError.toFixed(3)} m.`, snapshot.file, object.id, 'Use the authoritative layout position and a separately validated asset pivot offset.',
      ))
    }

    if (requiresFloorContact(object)) {
      const gap = object.bounds.min.y - snapshot.floorSurfaceY
      if (gap > tolerance.floorContact) findings.push(issue('OBJECT_FLOATING', 'FAIL', `${object.id} floats ${gap.toFixed(3)} m above the floor.`, snapshot.file, object.id, 'Align the model pivot/anchor with the floor surface.'))
      if (gap < -tolerance.floorPenetration) findings.push(issue('OBJECT_BELOW_FLOOR', 'FAIL', `${object.id} penetrates the floor by ${Math.abs(gap).toFixed(3)} m.`, snapshot.file, object.id, 'Correct pivot, vertical offset, or axis conversion.'))
      if (renderedFloor && object.kind !== 'wall' && (object.bounds.min.x < renderedFloor.min.x - tolerance.roomMargin || object.bounds.max.x > renderedFloor.max.x + tolerance.roomMargin
        || object.bounds.min.z < renderedFloor.min.z - tolerance.roomMargin || object.bounds.max.z > renderedFloor.max.z + tolerance.roomMargin)) findings.push(issue(
        'OBJECT_OFF_RENDERED_FLOOR', 'FAIL', `${object.id} is inside logical room data but outside the rendered floor asset.`, snapshot.file, object.id, 'Make rendered floor coverage match layout before placing room objects.',
      ))
    }

    if (object.expectedSize) {
      const actual = dimensions(object.bounds)
      const ratios = [actual.x / object.expectedSize.x, actual.y / object.expectedSize.y, actual.z / object.expectedSize.z].filter(Number.isFinite)
      if (ratios.some(ratio => ratio < tolerance.extremeScaleRatioMin || ratio > tolerance.extremeScaleRatioMax)) findings.push(issue(
        'OBJECT_SCALE_EXTREME', 'FAIL', `${object.id} actual/expected size ratios are ${ratios.map(value => value.toFixed(2)).join(', ')}.`, snapshot.file, object.id, 'Remove duplicate scaling and verify axis-normalized manifest bounds.',
      ))
      else if (ratios.some(ratio => Math.abs(1 - ratio) > tolerance.boundsRelativeError)) findings.push(issue(
        'MODEL_BOUNDS_MISMATCH', 'WARNING', `${object.id} differs from expected bounds: ratios ${ratios.map(value => value.toFixed(2)).join(', ')}.`, snapshot.file, object.id, 'Recalculate manifest bounds from the exported node or adjust the model.',
      ))
    }

    if (object.referenceSize) {
      const actual = dimensions(object.bounds)
      const ratios = [actual.x / object.referenceSize.x, actual.y / object.referenceSize.y, actual.z / object.referenceSize.z].filter(Number.isFinite)
      const minRatio = Math.min(...ratios)
      const maxRatio = Math.max(...ratios)
      if (minRatio < tolerance.extremeScaleRatioMin || maxRatio > tolerance.extremeScaleRatioMax
        || ratios.some(ratio => Math.abs(1 - ratio) > tolerance.boundsRelativeError)) findings.push(issue(
          'REFERENCE_SCALE_DISCONTINUITY', 'WARNING',
          `${object.id} differs strongly from the established scene reference scale (${ratios.map((ratio) => ratio.toFixed(2)).join('×')}).`,
          snapshot.file, object.id,
          'Review the model export scale or update the scene spacing and camera composition together.',
        ))
    }
  }

  const logicalWidth = snapshot.logicalFloorBounds.maxX - snapshot.logicalFloorBounds.minX
  const logicalDepth = snapshot.logicalFloorBounds.maxZ - snapshot.logicalFloorBounds.minZ
  for (const wall of snapshot.objects.filter(object => object.kind === 'wall')) {
    const wallSize = dimensions(wall.bounds)
    const coverage = wallSize.x >= wallSize.z ? wallSize.x / logicalWidth : wallSize.z / logicalDepth
    if (coverage < tolerance.wallSpanCoverage) findings.push(issue(
      'WALL_SPAN_MISMATCH', 'FAIL', `${wall.id} spans only ${(coverage * 100).toFixed(1)}% of its logical floor edge.`, snapshot.file, wall.id, 'Use a wall asset matching the floor edge or tile it without gaps.',
    ))
    const wallCenter = center(wall.bounds)
    const boundaryDistance = wallSize.x >= wallSize.z
      ? Math.min(Math.abs(wallCenter.z - snapshot.logicalFloorBounds.minZ), Math.abs(wallCenter.z - snapshot.logicalFloorBounds.maxZ))
      : Math.min(Math.abs(wallCenter.x - snapshot.logicalFloorBounds.minX), Math.abs(wallCenter.x - snapshot.logicalFloorBounds.maxX))
    if (boundaryDistance > tolerance.wallBoundaryDistance) findings.push(issue(
      'WALL_OFF_FLOOR_BOUNDARY', 'FAIL', `${wall.id} is ${boundaryDistance.toFixed(3)} m from the nearest matching floor boundary.`, snapshot.file, wall.id, 'Place wall centreline on the corresponding logical floor edge.',
    ))
  }

  for (const partition of snapshot.objects.filter(object => object.kind === 'partition')) {
    const size = dimensions(partition.bounds)
    const thickness = Math.min(size.x, size.z)
    if (thickness <= 0 || size.y / thickness < tolerance.partitionHeightToThickness) findings.push(issue(
      'PARTITION_NOT_VERTICAL', 'FAIL', `${partition.id} height/thickness ratio is ${thickness > 0 ? (size.y / thickness).toFixed(2) : 'invalid'}.`, snapshot.file, partition.id, 'Apply the axis conversion once and keep partition height on renderer Y.',
    ))
  }

  const objectsById = new Map(snapshot.objects.map(object => [object.id, object]))
  for (const window of snapshot.objects.filter(object => object.kind === 'window')) {
    const wall = window.wallId ? objectsById.get(window.wallId) : undefined
    if (!wall) {
      findings.push(issue('WINDOW_WALL_MISSING', 'FAIL', `${window.id} has no associated wall.`, snapshot.file, window.id, 'Associate every window placement with a rendered wall.'))
      continue
    }
    const wallSize = dimensions(wall.bounds)
    const alongX = wallSize.x >= wallSize.z
    const spanCoverage = alongX
      ? intervalCoverage(window.bounds.min.x, window.bounds.max.x, wall.bounds.min.x, wall.bounds.max.x)
      : intervalCoverage(window.bounds.min.z, window.bounds.max.z, wall.bounds.min.z, wall.bounds.max.z)
    const surfaceGap = alongX
      ? Math.max(0, wall.bounds.min.z - window.bounds.max.z, window.bounds.min.z - wall.bounds.max.z)
      : Math.max(0, wall.bounds.min.x - window.bounds.max.x, window.bounds.min.x - wall.bounds.max.x)
    if (spanCoverage < tolerance.windowSpanCoverage || surfaceGap > tolerance.wallSurfaceDistance) findings.push(issue(
      'WINDOW_NOT_ON_WALL', 'FAIL', `${window.id} has ${(spanCoverage * 100).toFixed(1)}% span overlap and ${surfaceGap.toFixed(3)} m surface gap from ${wall.id}.`, snapshot.file, window.id, 'Place the window from its real pivot and keep its centre inside wall span.',
    ))
    if (window.bounds.min.y < wall.bounds.min.y - tolerance.wallSurfaceDistance || window.bounds.max.y > wall.bounds.max.y + tolerance.wallSurfaceDistance) findings.push(issue(
      'WINDOW_VERTICAL_MISALIGNMENT', 'FAIL', `${window.id} vertical bounds do not fit ${wall.id}.`, snapshot.file, window.id, 'Use wall-relative height once; do not add an anchor offset already baked into the node.',
    ))
  }

  for (const character of snapshot.objects.filter(object => object.kind === 'character' && object.deskId)) {
    const desk = snapshot.objects.find(object => object.kind === 'desk' && object.deskId === character.deskId)
    if (!desk || horizontalDistance(character.bounds, desk.bounds) > tolerance.characterDeskDistance) findings.push(issue(
      'CHARACTER_DESK_MISALIGNED', 'FAIL', `${character.id} is not positioned near desk ${character.deskId}.`, snapshot.file, character.id, 'Place characters from layout characterSpots linked by deskId.',
    ))
  }

  for (const chair of snapshot.objects.filter(object => object.kind === 'chair' && object.deskId)) {
    const desk = snapshot.objects.find(object => object.kind === 'desk' && object.deskId === chair.deskId)
    if (!desk || horizontalDistance(chair.bounds, desk.bounds) > tolerance.chairDeskDistance) findings.push(issue(
      'CHAIR_DESK_MISALIGNED', 'FAIL', `${chair.id} is not positioned near desk ${chair.deskId}.`, snapshot.file, chair.id, 'Place each work chair from the same workstation record as its desk.',
    ))
  }

  const visibleDesks = new Set(snapshot.visibleDeskIds)
  const visibleEmployees = new Set(snapshot.visibleEmployeeIds)
  for (const workstation of snapshot.workstations) {
    if (!visibleDesks.has(workstation.deskId)) findings.push(issue('VISIBLE_DESK_MISSING', 'FAIL', `Layout desk ${workstation.deskId} is not rendered.`, snapshot.file, workstation.deskId, 'Render occupied and reserved desks from the same layout collection.'))
    if (workstation.employeeId && !visibleEmployees.has(workstation.employeeId)) findings.push(issue('VISIBLE_EMPLOYEE_MISSING', 'FAIL', `Assigned employee ${workstation.employeeId} is not rendered.`, snapshot.file, workstation.employeeId, 'Render one character for each occupied workstation.'))
  }

  if (snapshot.surfaceMaterials?.loadedArtReplacesFallback && snapshot.surfaceMaterials.fallbackFloorHasTexture && !snapshot.surfaceMaterials.floorHasTexture) findings.push(issue(
    'FLOOR_MATERIAL_QUALITY_REGRESSION', 'FAIL', 'Loading the art pack replaces a textured fallback floor with an untextured floor material.', snapshot.file, 'floor material', 'Preserve the reviewed laminate texture in the loaded pack and verify texture color space/repeat.',
  ))
  if (snapshot.surfaceMaterials && !snapshot.surfaceMaterials.mappingsResolved) findings.push(issue(
    'SURFACE_MATERIAL_MAPPING_UNRESOLVED', 'WARNING', 'Surface material IDs do not resolve deterministically to the material library.', snapshot.file, 'materials.json', 'Add explicit material keys and verify loader bindings.',
  ))
  return createAuditReport(findings)
}
