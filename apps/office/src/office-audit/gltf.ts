import { createAuditReport } from './report'
import { isEmbeddedDataUri, isSafeLocalPath, resolveSiblingPath } from './paths'
import type { AuditFinding, AuditReport, GlbInspection, GlbStatistics } from './types'

const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2

function fail(code: string, description: string, subject: string, recommendation: string): AuditFinding {
  return { code, severity: 'FAIL', description, subject, recommendation }
}

export function validateGlb(bytes: Uint8Array, subject = 'GLB'): AuditReport {
  const findings: AuditFinding[] = []
  if (bytes.byteLength < 12) {
    return createAuditReport([fail('GLB_HEADER_TRUNCATED', 'GLB header is shorter than 12 bytes.', subject, 'Re-export or replace the damaged GLB.')])
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    findings.push(fail('GLB_MAGIC_INVALID', 'GLB magic header is not "glTF".', subject, 'Provide a binary glTF file with a valid GLB header.'))
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    findings.push(fail('GLB_VERSION_UNSUPPORTED', `GLB version ${view.getUint32(4, true)} is unsupported.`, subject, 'Export the model as glTF 2.0 / GLB version 2.'))
  }
  const declaredLength = view.getUint32(8, true)
  if (declaredLength !== bytes.byteLength) {
    findings.push(fail('GLB_LENGTH_MISMATCH', `Header declares ${declaredLength} bytes but the file contains ${bytes.byteLength}.`, subject, 'Regenerate the GLB so its declared and actual lengths match.'))
  }

  let offset = 12
  let chunkIndex = 0
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      findings.push(fail('GLB_CHUNK_HEADER_TRUNCATED', `Chunk ${chunkIndex} header crosses the file boundary.`, subject, 'Re-export the damaged GLB.'))
      break
    }
    const chunkLength = view.getUint32(offset, true)
    if (chunkLength % 4 !== 0) {
      findings.push(fail('GLB_CHUNK_UNALIGNED', `Chunk ${chunkIndex} length ${chunkLength} is not 4-byte aligned.`, subject, 'Use a conforming glTF 2.0 exporter.'))
    }
    const chunkEnd = offset + 8 + chunkLength
    if (chunkEnd > bytes.byteLength || chunkEnd < offset) {
      findings.push(fail('GLB_CHUNK_OUT_OF_BOUNDS', `Chunk ${chunkIndex} extends beyond the file boundary.`, subject, 'Re-export the damaged GLB.'))
      break
    }
    offset = chunkEnd
    chunkIndex += 1
  }
  if (chunkIndex === 0 && offset === bytes.byteLength) {
    findings.push(fail('GLB_CHUNK_MISSING', 'GLB contains no JSON chunk.', subject, 'Export a complete GLB containing a JSON chunk.'))
  }
  return createAuditReport(findings)
}

function parseGlbChunks(bytes: Uint8Array): { json: unknown; binaryChunkBytes: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  let json: unknown
  let binaryChunkBytes = 0
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const chunkEnd = offset + 8 + chunkLength
    if (chunkEnd > bytes.byteLength) return { json: undefined, binaryChunkBytes }
    if (chunkType === 0x4e4f534a) {
      const text = new TextDecoder().decode(bytes.subarray(offset + 8, chunkEnd)).replace(/[\u0000\u0020]+$/g, '')
      json = JSON.parse(text)
    }
    if (chunkType === 0x004e4942) binaryChunkBytes += chunkLength
    offset = chunkEnd
  }
  return { json, binaryChunkBytes }
}

export function readGlbJsonDocument(bytes: Uint8Array): unknown {
  return parseGlbChunks(bytes).json
}

function objectArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    : []
}

export function inspectGlb(bytes: Uint8Array, subject = 'GLB'): GlbInspection {
  const containerReport = validateGlb(bytes, subject)
  if (containerReport.status === 'FAIL') return { report: containerReport }

  let parsed: unknown
  let binaryChunkBytes = 0
  try {
    const chunks = parseGlbChunks(bytes)
    parsed = chunks.json
    binaryChunkBytes = chunks.binaryChunkBytes
  } catch {
    return { report: createAuditReport([fail('GLB_JSON_INVALID', 'The GLB JSON chunk is not valid JSON.', subject, 'Re-export the GLB with a valid glTF 2.0 JSON chunk.')]) }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { report: createAuditReport([fail('GLB_JSON_CHUNK_MISSING', 'The GLB has no valid JSON object chunk.', subject, 'Re-export a complete glTF 2.0 binary.')]) }
  }

  const document = parsed as Record<string, unknown>
  const accessors = objectArray(document.accessors)
  const meshes = objectArray(document.meshes)
  const nodes = objectArray(document.nodes)
  let primitiveCount = 0
  let vertexCount = 0
  let triangleCount = 0

  for (const mesh of meshes) {
    for (const primitive of objectArray(mesh.primitives)) {
      primitiveCount += 1
      const attributes = typeof primitive.attributes === 'object' && primitive.attributes !== null
        ? primitive.attributes as Record<string, unknown>
        : {}
      const positionAccessorIndex = typeof attributes.POSITION === 'number' ? attributes.POSITION : -1
      const positionCount = typeof accessors[positionAccessorIndex]?.count === 'number'
        ? accessors[positionAccessorIndex].count as number
        : 0
      vertexCount += positionCount
      const indexAccessorIndex = typeof primitive.indices === 'number' ? primitive.indices : -1
      const elementCount = indexAccessorIndex >= 0 && typeof accessors[indexAccessorIndex]?.count === 'number'
        ? accessors[indexAccessorIndex].count as number
        : positionCount
      const mode = typeof primitive.mode === 'number' ? primitive.mode : 4
      if (mode === 4) triangleCount += Math.floor(elementCount / 3)
      if (mode === 5 || mode === 6) triangleCount += Math.max(0, elementCount - 2)
    }
  }

  const extensions = typeof document.extensions === 'object' && document.extensions !== null
    ? document.extensions as Record<string, unknown>
    : {}
  const punctual = typeof extensions.KHR_lights_punctual === 'object' && extensions.KHR_lights_punctual !== null
    ? extensions.KHR_lights_punctual as Record<string, unknown>
    : {}
  const statistics: GlbStatistics = {
    byteLength: bytes.byteLength,
    binaryChunkBytes,
    declaredBufferBytes: objectArray(document.buffers).reduce(
      (total, buffer) => total + (typeof buffer.byteLength === 'number' ? buffer.byteLength : 0),
      0,
    ),
    nodeCount: nodes.length,
    meshCount: meshes.length,
    primitiveCount,
    vertexCount,
    triangleCount,
    materialCount: objectArray(document.materials).length,
    textureCount: objectArray(document.textures).length,
    imageCount: objectArray(document.images).length,
    animationCount: objectArray(document.animations).length,
    lightCount: objectArray(punctual.lights).length,
    nodeNames: nodes.flatMap(node => typeof node.name === 'string' ? [node.name] : []),
  }
  return { report: containerReport, statistics }
}

interface GltfDocument {
  asset?: { version?: unknown }
  buffers?: unknown
  images?: unknown
}

export function validateGltfJson(
  bytes: Uint8Array,
  subject = 'glTF',
  availablePaths: ReadonlySet<string> = new Set(),
): AuditReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return createAuditReport([fail('GLTF_JSON_INVALID', 'glTF is not valid JSON.', subject, 'Fix or re-export the glTF JSON document.')])
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return createAuditReport([fail('GLTF_STRUCTURE_INVALID', 'glTF root must be a JSON object.', subject, 'Export a valid glTF 2.0 document.')])
  }

  const document = parsed as GltfDocument
  const findings: AuditFinding[] = []
  if (document.asset?.version !== '2.0') {
    findings.push(fail('GLTF_VERSION_UNSUPPORTED', `glTF asset.version must be "2.0", received "${String(document.asset?.version ?? '')}".`, subject, 'Export the model as glTF 2.0.'))
  }

  if (document.buffers !== undefined && !Array.isArray(document.buffers)) {
    findings.push(fail('GLTF_BUFFERS_INVALID', 'glTF buffers must be an array.', subject, 'Fix or re-export the glTF document.'))
  }
  if (document.images !== undefined && !Array.isArray(document.images)) {
    findings.push(fail('GLTF_IMAGES_INVALID', 'glTF images must be an array.', subject, 'Fix or re-export the glTF document.'))
  }
  const references: { kind: 'buffer' | 'image'; uri: unknown; index: number }[] = []
  if (Array.isArray(document.buffers)) {
    document.buffers.forEach((buffer, index) => {
      if (typeof buffer !== 'object' || buffer === null || Array.isArray(buffer)) {
        findings.push(fail('GLTF_BUFFER_INVALID', `Buffer ${index} must be an object.`, `${subject}#buffers[${index}]`, 'Fix or re-export the glTF document.'))
      } else {
        references.push({ kind: 'buffer', uri: (buffer as { uri?: unknown }).uri, index })
      }
    })
  }
  if (Array.isArray(document.images)) {
    document.images.forEach((image, index) => {
      if (typeof image !== 'object' || image === null || Array.isArray(image)) {
        findings.push(fail('GLTF_IMAGE_INVALID', `Image ${index} must be an object.`, `${subject}#images[${index}]`, 'Fix or re-export the glTF document.'))
      } else {
        const record = image as { uri?: unknown; bufferView?: unknown }
        if (record.uri !== undefined) references.push({ kind: 'image', uri: record.uri, index })
        else if (record.bufferView === undefined) findings.push(fail('GLTF_IMAGE_SOURCE_MISSING', `Image ${index} has neither uri nor bufferView.`, `${subject}#images[${index}]`, 'Provide an external URI or embedded bufferView.'))
      }
    })
  }
  for (const reference of references) {
    const referenceSubject = `${subject}#${reference.kind}s[${reference.index}]`
    if (typeof reference.uri !== 'string' || reference.uri.length === 0) {
      findings.push(fail('GLTF_REFERENCE_INVALID', `${reference.kind} URI must be a non-empty string.`, referenceSubject, 'Provide a valid local URI or embedded data URI.'))
      continue
    }
    if (isEmbeddedDataUri(reference.uri)) continue
    const resolved = resolveSiblingPath(subject, reference.uri)
    if (!isSafeLocalPath(reference.uri) || !resolved) {
      findings.push(fail('GLTF_REFERENCE_UNSAFE', `${reference.kind} URI "${reference.uri}" is not a safe local path.`, referenceSubject, 'Use a relative pack-local URI without traversal or network protocols.'))
    } else if (!availablePaths.has(resolved)) {
      findings.push(fail('GLTF_REFERENCE_MISSING', `${reference.kind} file "${resolved}" is missing.`, referenceSubject, 'Add the referenced file to the asset pack or correct the URI.'))
    }
  }
  return createAuditReport(findings)
}
