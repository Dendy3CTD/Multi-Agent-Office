import { OfficeArtError, resolveAssetUrl } from './asset-manifest'

export interface OfficeMaterialTexture {
  url: string
  colorSpace: 'srgb'
  wrapS: 'repeat' | 'clamp-to-edge' | 'mirrored-repeat'
  wrapT: 'repeat' | 'clamp-to-edge' | 'mirrored-repeat'
  repeat: readonly [number, number]
}

export interface OfficeMaterialDescriptor {
  baseColorFactor: readonly [number, number, number, number]
  roughness: number
  metallic: number
  baseColorTexture?: OfficeMaterialTexture
  doubleSided?: boolean
  emissiveFactor?: readonly [number, number, number]
}

export interface OfficeMaterialMapping {
  glbMaterialName: string
  libraryKey: string
  textureUrl?: string
}

export interface OfficeMaterialLibrary {
  version: number
  units: string
  colorSpace: 'srgb'
  materials: Readonly<Record<string, OfficeMaterialDescriptor>>
  mappings: Readonly<Record<string, OfficeMaterialMapping>>
}

function tuple4(value: unknown): value is readonly [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

function tuple2(value: unknown): value is readonly [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'number' && Number.isFinite(item) && item > 0)
}

export function validateOfficeMaterialLibrary(value: unknown, manifestUrl: string): OfficeMaterialLibrary {
  if (!value || typeof value !== 'object') throw new OfficeArtError('office_art_material_invalid')
  const library = value as Partial<OfficeMaterialLibrary>
  if (typeof library.version !== 'number' || typeof library.units !== 'string' || library.colorSpace !== 'srgb' || !library.materials || typeof library.materials !== 'object' || !library.mappings || typeof library.mappings !== 'object') {
    throw new OfficeArtError('office_art_material_invalid')
  }
  for (const descriptor of Object.values(library.materials)) {
    if (!descriptor || !tuple4(descriptor.baseColorFactor) || typeof descriptor.roughness !== 'number' || descriptor.roughness < 0 || descriptor.roughness > 1 || typeof descriptor.metallic !== 'number' || descriptor.metallic < 0 || descriptor.metallic > 1) throw new OfficeArtError('office_art_material_invalid')
    if (descriptor.doubleSided !== undefined && typeof descriptor.doubleSided !== 'boolean') throw new OfficeArtError('office_art_material_invalid')
    if (descriptor.emissiveFactor && (!Array.isArray(descriptor.emissiveFactor) || descriptor.emissiveFactor.length !== 3 || !descriptor.emissiveFactor.every(value => Number.isFinite(value) && value >= 0 && value <= 1))) throw new OfficeArtError('office_art_material_invalid')
    const texture = descriptor.baseColorTexture
    if (texture && (texture.colorSpace !== 'srgb' || !tuple2(texture.repeat) || !['repeat', 'clamp-to-edge', 'mirrored-repeat'].includes(texture.wrapS) || !['repeat', 'clamp-to-edge', 'mirrored-repeat'].includes(texture.wrapT))) throw new OfficeArtError('office_art_material_invalid')
    if (texture) resolveAssetUrl(manifestUrl, texture.url)
  }
  const glbNames = new Set<string>()
  for (const mapping of Object.values(library.mappings)) {
    if (!mapping || typeof mapping.glbMaterialName !== 'string' || typeof mapping.libraryKey !== 'string' || !library.materials[mapping.libraryKey] || glbNames.has(mapping.glbMaterialName)) throw new OfficeArtError('office_art_material_invalid')
    if (mapping.textureUrl) {
      resolveAssetUrl(manifestUrl, mapping.textureUrl)
      const descriptorTexture = library.materials[mapping.libraryKey].baseColorTexture?.url
      if (descriptorTexture !== mapping.textureUrl) throw new OfficeArtError('office_art_material_invalid')
    }
    glbNames.add(mapping.glbMaterialName)
  }
  return library as OfficeMaterialLibrary
}

export async function loadOfficeMaterials(fetcher: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>, url: string, manifestUrl: string): Promise<OfficeMaterialLibrary> {
  const response = await fetcher(url)
  if (!response.ok) throw new OfficeArtError('office_art_material_invalid')
  return validateOfficeMaterialLibrary(await response.json(), manifestUrl)
}
