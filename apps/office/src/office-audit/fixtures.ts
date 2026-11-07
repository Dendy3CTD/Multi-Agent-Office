import type { AssetManifest, AuditableAssetFile, PerformanceMeasurements } from './types'

const encoder = new TextEncoder()

export function createGlb(json: object = { asset: { version: '2.0' } }): Uint8Array {
  const encodedJson = encoder.encode(JSON.stringify(json))
  const paddedLength = Math.ceil(encodedJson.byteLength / 4) * 4
  const bytes = new Uint8Array(12 + 8 + paddedLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.byteLength, true)
  view.setUint32(12, paddedLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.fill(0x20, 20)
  bytes.set(encodedJson, 20)
  return bytes
}

export function createCorruptGlb(): Uint8Array {
  const bytes = createGlb()
  new DataView(bytes.buffer).setUint32(12, bytes.byteLength * 2, true)
  return bytes
}

export const validManifest: AssetManifest = {
  schemaVersion: 1,
  packId: 'fixture-pack',
  assets: [
    {
      id: 'desk.fixture',
      url: 'assets/desk.glb',
      type: 'model',
      scale: 1,
      origin: [0, 0, 0],
      anchor: 'floor-center',
      bounds: [1.4, 0.7, 0.8],
      license: 'CC0-1.0',
      source: 'Fixture generator',
    },
  ],
}

export const validFiles: readonly AuditableAssetFile[] = [
  { path: 'assets/desk.glb', bytes: createGlb() },
]

export const completeLowTierMeasurements: PerformanceMeasurements = {
  totalAssetBytes: 8 * 1024 * 1024,
  textureBytes: 4 * 1024 * 1024,
  maxTextureDimension: 1024,
  textureCount: 8,
  objectCount: 100,
  meshCount: 80,
  triangleCount: 100_000,
  vertexCount: 80_000,
  lightCount: 4,
  drawCalls: 80,
  dpr: 1.25,
  animationLoopActive: false,
  pageVisible: true,
  sceneAnimating: false,
  loadTimeMs: 1_000,
  gpuMemoryBytes: 96 * 1024 * 1024,
}
