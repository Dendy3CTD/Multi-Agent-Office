export type OfficeAssetType = 'model' | 'material'

export interface OfficeAssetRecord {
  id: string
  url: string
  node?: string
  type: OfficeAssetType
  scale: number
  origin: readonly [number, number, number]
  anchor: string
  bounds: readonly [number, number, number]
  license: string
  source: string
  variants?: readonly string[]
}

export interface OfficeAssetManifest {
  schemaVersion: number
  packId: string
  coordinateSystem: string
  defaultScale: number
  assets: readonly OfficeAssetRecord[]
}

export type OfficeArtErrorCode =
  | 'office_art_manifest_unavailable'
  | 'office_art_manifest_invalid'
  | 'asset_not_found'
  | 'asset_not_model'
  | 'asset_url_must_be_local'
  | 'asset_url_outside_manifest'
  | 'office_art_node_missing'
  | 'asset_load_failed'
  | 'office_art_material_invalid'
  | 'office_art_resources_in_use'

export class OfficeArtError extends Error {
  readonly code: OfficeArtErrorCode

  constructor(code: OfficeArtErrorCode, message: string = code) {
    super(message)
    this.name = 'OfficeArtError'
    this.code = code
  }
}

export function assetById(manifest: OfficeAssetManifest, id: string): OfficeAssetRecord | undefined {
  return manifest.assets.find(asset => asset.id === id)
}

/**
 * Resolves only manifest-owned relative URLs. It intentionally rejects
 * protocol, traversal and absolute paths before a renderer starts lazy loading.
 */
export function resolveAssetUrl(manifestUrl: string, assetUrl: string): string {
  if (!assetUrl || /^[a-z][a-z\d+.-]*:/i.test(assetUrl) || assetUrl.startsWith('//')) throw new OfficeArtError('asset_url_must_be_local')
  let base: URL
  let resolved: URL
  try {
    base = new URL(manifestUrl, 'http://mao.local')
    resolved = new URL(assetUrl, base)
  } catch {
    throw new OfficeArtError('asset_url_outside_manifest')
  }
  const rootPath = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1)
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(rootPath) || resolved.pathname.includes('/../') || resolved.pathname.includes('..')) throw new OfficeArtError('asset_url_outside_manifest')
  return `${resolved.pathname}${resolved.search}`
}

function isTuple(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

export function validateOfficeManifest(value: unknown, manifestUrl = '/office-art/v1/manifest.json'): OfficeAssetManifest {
  if (!value || typeof value !== 'object') throw new OfficeArtError('office_art_manifest_invalid')
  const candidate = value as Partial<OfficeAssetManifest>
  if (!Number.isInteger(candidate.schemaVersion) || typeof candidate.packId !== 'string' || typeof candidate.coordinateSystem !== 'string' || typeof candidate.defaultScale !== 'number' || !Number.isFinite(candidate.defaultScale) || candidate.defaultScale <= 0 || !Array.isArray(candidate.assets)) {
    throw new OfficeArtError('office_art_manifest_invalid')
  }
  const ids = new Set<string>()
  for (const asset of candidate.assets) {
    if (!asset || typeof asset !== 'object') throw new OfficeArtError('office_art_manifest_invalid')
    const record = asset as OfficeAssetRecord
    if (!record.id || ids.has(record.id) || typeof record.url !== 'string' || (record.type !== 'model' && record.type !== 'material') || typeof record.scale !== 'number' || !Number.isFinite(record.scale) || record.scale <= 0 || !isTuple(record.origin) || typeof record.anchor !== 'string' || !isTuple(record.bounds) || record.bounds.some(item => item < 0) || typeof record.license !== 'string' || typeof record.source !== 'string') {
      throw new OfficeArtError('office_art_manifest_invalid')
    }
    if (record.type === 'model' && (!record.node || typeof record.node !== 'string')) throw new OfficeArtError('office_art_manifest_invalid')
    if (record.variants && (!Array.isArray(record.variants) || record.variants.some(variant => typeof variant !== 'string' || !variant))) throw new OfficeArtError('office_art_manifest_invalid')
    resolveAssetUrl(manifestUrl, record.url)
    ids.add(record.id)
  }
  return candidate as OfficeAssetManifest
}

export async function loadOfficeManifest(fetcher: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>, manifestUrl = '/office-art/v1/manifest.json'): Promise<OfficeAssetManifest> {
  const response = await fetcher(manifestUrl)
  if (!response.ok) throw new OfficeArtError('office_art_manifest_unavailable')
  const value = await response.json()
  return validateOfficeManifest(value, manifestUrl)
}
