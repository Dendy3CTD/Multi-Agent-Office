import { readGlbJsonDocument, validateGlb } from './gltf'
import { createAuditReport, mergeAuditReports } from './report'
import type {
  AuditFinding,
  GlbNodeSpatialBounds,
  GlbSpatialInspection,
  SpatialAxis,
  SpatialBounds3,
  SpatialPoint3,
} from './types'

type Matrix4 = readonly number[]

interface GltfAccessor {
  min?: unknown
  max?: unknown
}

interface GltfPrimitive {
  attributes?: { POSITION?: unknown }
}

interface GltfMesh {
  primitives?: unknown
}

interface GltfNode {
  name?: unknown
  mesh?: unknown
  children?: unknown
  translation?: unknown
  rotation?: unknown
  scale?: unknown
  matrix?: unknown
}

function vector3(value: unknown): readonly [number, number, number] | undefined {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item))
    ? value as [number, number, number]
    : undefined
}

function identity(): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function multiply(left: Matrix4, right: Matrix4): Matrix4 {
  const result = Array<number>(16).fill(0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) result[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index]
    }
  }
  return result
}

function nodeMatrix(node: GltfNode): Matrix4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16 && node.matrix.every(value => typeof value === 'number' && Number.isFinite(value))) return node.matrix
  const translation = vector3(node.translation) ?? [0, 0, 0]
  const scale = vector3(node.scale) ?? [1, 1, 1]
  const rotation = Array.isArray(node.rotation) && node.rotation.length === 4 && node.rotation.every(value => typeof value === 'number' && Number.isFinite(value))
    ? node.rotation as [number, number, number, number]
    : [0, 0, 0, 1]
  const [x, y, z, w] = rotation
  const [sx, sy, sz] = scale
  return [
    (1 - 2 * y * y - 2 * z * z) * sx, (2 * x * y + 2 * w * z) * sx, (2 * x * z - 2 * w * y) * sx, 0,
    (2 * x * y - 2 * w * z) * sy, (1 - 2 * x * x - 2 * z * z) * sy, (2 * y * z + 2 * w * x) * sy, 0,
    (2 * x * z + 2 * w * y) * sz, (2 * y * z - 2 * w * x) * sz, (1 - 2 * x * x - 2 * y * y) * sz, 0,
    translation[0], translation[1], translation[2], 1,
  ]
}

function transformPoint(matrix: Matrix4, point: readonly [number, number, number]): SpatialPoint3 {
  return {
    x: matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    y: matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    z: matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  }
}

function corners(min: readonly [number, number, number], max: readonly [number, number, number]): readonly [number, number, number][] {
  return [
    [min[0], min[1], min[2]], [min[0], min[1], max[2]], [min[0], max[1], min[2]], [min[0], max[1], max[2]],
    [max[0], min[1], min[2]], [max[0], min[1], max[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]],
  ]
}

function boundsFromPoints(points: readonly SpatialPoint3[]): SpatialBounds3 | undefined {
  if (points.length === 0) return undefined
  return points.reduce<SpatialBounds3>((bounds, point) => ({
    min: { x: Math.min(bounds.min.x, point.x), y: Math.min(bounds.min.y, point.y), z: Math.min(bounds.min.z, point.z) },
    max: { x: Math.max(bounds.max.x, point.x), y: Math.max(bounds.max.y, point.y), z: Math.max(bounds.max.z, point.z) },
  }), { min: { ...points[0] }, max: { ...points[0] } })
}

function union(left: SpatialBounds3 | undefined, right: SpatialBounds3 | undefined): SpatialBounds3 | undefined {
  if (!left) return right
  if (!right) return left
  return {
    min: { x: Math.min(left.min.x, right.min.x), y: Math.min(left.min.y, right.min.y), z: Math.min(left.min.z, right.min.z) },
    max: { x: Math.max(left.max.x, right.max.x), y: Math.max(left.max.y, right.max.y), z: Math.max(left.max.z, right.max.z) },
  }
}

function size(bounds: SpatialBounds3): SpatialPoint3 {
  return { x: bounds.max.x - bounds.min.x, y: bounds.max.y - bounds.min.y, z: bounds.max.z - bounds.min.z }
}

function inferFloorUpAxis(floor?: GlbNodeSpatialBounds): SpatialAxis | undefined {
  if (!floor) return undefined
  const dimensions: readonly [SpatialAxis, number][] = [['X', floor.size.x], ['Y', floor.size.y], ['Z', floor.size.z]]
  const ordered = [...dimensions].sort((left, right) => left[1] - right[1])
  return ordered[0][1] * 4 < ordered[1][1] ? ordered[0][0] : undefined
}

export function inspectGlbNodeBounds(bytes: Uint8Array, subject = 'office-pack.glb'): GlbSpatialInspection {
  const container = validateGlb(bytes, subject)
  if (container.status === 'FAIL') return { report: container, nodes: {} }
  let parsed: unknown
  try {
    parsed = readGlbJsonDocument(bytes)
  } catch {
    return { report: createAuditReport([{ code: 'GLB_SPATIAL_JSON_INVALID', severity: 'FAIL', description: 'GLB JSON cannot be parsed for spatial inspection.', file: subject, recommendation: 'Regenerate the GLB JSON chunk.', category: 'validator' }]), nodes: {} }
  }
  if (typeof parsed !== 'object' || parsed === null) return { report: createAuditReport([{ code: 'GLB_SPATIAL_DATA_MISSING', severity: 'FAIL', description: 'GLB has no spatial JSON object.', file: subject, recommendation: 'Regenerate the GLB with nodes, meshes, and accessor bounds.', category: 'validator' }]), nodes: {} }
  const document = parsed as { nodes?: unknown; meshes?: unknown; accessors?: unknown }
  const nodes = Array.isArray(document.nodes) ? document.nodes as GltfNode[] : []
  const meshes = Array.isArray(document.meshes) ? document.meshes as GltfMesh[] : []
  const accessors = Array.isArray(document.accessors) ? document.accessors as GltfAccessor[] : []
  const findings: AuditFinding[] = []

  function walk(nodeIndex: number, parentMatrix: Matrix4, visited: ReadonlySet<number>): SpatialBounds3 | undefined {
    if (visited.has(nodeIndex) || !nodes[nodeIndex]) return undefined
    const nextVisited = new Set(visited).add(nodeIndex)
    const node = nodes[nodeIndex]
    const matrix = multiply(parentMatrix, nodeMatrix(node))
    let result: SpatialBounds3 | undefined
    if (typeof node.mesh === 'number' && meshes[node.mesh]) {
      const primitives = Array.isArray(meshes[node.mesh].primitives) ? meshes[node.mesh].primitives as GltfPrimitive[] : []
      for (const primitive of primitives) {
        const accessorIndex = primitive.attributes?.POSITION
        const accessor = typeof accessorIndex === 'number' ? accessors[accessorIndex] : undefined
        const min = vector3(accessor?.min)
        const max = vector3(accessor?.max)
        if (!min || !max) {
          findings.push({ code: 'GLB_ACCESSOR_BOUNDS_MISSING', severity: 'WARNING', description: `Node ${String(node.name ?? nodeIndex)} lacks POSITION min/max metadata.`, file: subject, recommendation: 'Export accessor min/max bounds for deterministic spatial QA.', category: 'validator' })
          continue
        }
        result = union(result, boundsFromPoints(corners(min, max).map(point => transformPoint(matrix, point))))
      }
    }
    if (Array.isArray(node.children)) for (const child of node.children) if (typeof child === 'number') result = union(result, walk(child, matrix, nextVisited))
    return result
  }

  const inspected: Record<string, GlbNodeSpatialBounds> = {}
  nodes.forEach((node, index) => {
    if (typeof node.name !== 'string') return
    const bounds = walk(index, identity(), new Set())
    if (bounds) inspected[node.name] = { node: node.name, bounds, size: size(bounds) }
  })
  return {
    report: mergeAuditReports(container, createAuditReport(findings)),
    nodes: inspected,
    inferredUpAxis: inferFloorUpAxis(inspected['floor.oak.light']),
  }
}

function toYUp(point: SpatialPoint3, sourceUpAxis: SpatialAxis): SpatialPoint3 {
  if (sourceUpAxis === 'Y') return point
  if (sourceUpAxis === 'Z') return { x: point.x, y: point.z, z: -point.y }
  return { x: -point.y, y: point.x, z: point.z }
}

export function transformAssetBoundsToYUp(
  bounds: SpatialBounds3,
  position: SpatialPoint3,
  sourceUpAxis: SpatialAxis,
  scale: number | SpatialPoint3 = 1,
  rotationY = 0,
): SpatialBounds3 {
  const axisScale = typeof scale === 'number' ? { x: scale, y: scale, z: scale } : scale
  const cosine = Math.cos(rotationY)
  const sine = Math.sin(rotationY)
  const transformed = corners(
    [bounds.min.x, bounds.min.y, bounds.min.z],
    [bounds.max.x, bounds.max.y, bounds.max.z],
  ).map(([x, y, z]) => {
    const converted = toYUp({ x: x * axisScale.x, y: y * axisScale.y, z: z * axisScale.z }, sourceUpAxis)
    return {
      x: converted.x * cosine + converted.z * sine + position.x,
      y: converted.y + position.y,
      z: -converted.x * sine + converted.z * cosine + position.z,
    }
  })
  return boundsFromPoints(transformed)!
}
