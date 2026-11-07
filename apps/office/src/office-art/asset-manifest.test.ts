import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assetById, resolveAssetUrl, validateOfficeManifest } from './asset-manifest'
import { validateOfficeMaterialLibrary } from './materials'
import type { OfficeAssetManifest } from './asset-manifest'

const publicRoot = resolve(process.cwd(), 'public')
const manifest = JSON.parse(readFileSync(resolve(publicRoot, 'office-art/v1/manifest.json'), 'utf8')) as OfficeAssetManifest

describe('office art pack', () => {
  it('has unique stable ids and real local files for every manifest record', () => {
    const ids = manifest.assets.map(asset => asset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const asset of manifest.assets) {
      expect(asset.id).toMatch(/^[a-z0-9][a-z0-9.-]+$/)
      expect(asset.license).not.toMatch(/paid|unknown/i)
      expect(asset.scale).toBeGreaterThan(0)
      expect(asset.bounds).toHaveLength(3)
      const url = resolveAssetUrl('/office-art/v1/manifest.json', asset.url)
      expect(statSync(resolve(publicRoot, url.slice(1))).isFile()).toBe(true)
    }
  })

  it('contains the required models, character states and preview compositions', () => {
    for (const id of ['floor.oak.light', 'wall.brick.loft', 'desk.modern', 'chair.ergonomic', 'monitor.single', 'monitor.dual', 'plant.potted', 'sofa.cozy', 'table.meeting', 'character.base', 'character.base.idle', 'character.base.working', 'character.base.selected', 'character.base.blocked', 'preview.workstation', 'preview.office.group', 'preview.meeting.room']) {
      expect(assetById(manifest, id)).toBeDefined()
    }
    expect(assetById(manifest, 'character.base')?.variants).toContain('character.base.blocked')
  })

  it('rejects remote and traversal asset URLs', () => {
    expect(() => resolveAssetUrl('/office-art/v1/manifest.json', 'https://example.com/model.glb')).toThrow('asset_url_must_be_local')
    expect(() => resolveAssetUrl('/office-art/v1/manifest.json', '../secret.glb')).toThrow('asset_url_outside_manifest')
    expect(() => resolveAssetUrl('/office-art/v1/manifest.json', '/tmp/secret.glb')).toThrow('asset_url_outside_manifest')
  })

  it('writes a valid GLB signature with a bounded pack size', () => {
    const file = readFileSync(resolve(publicRoot, 'office-art/v1/office-pack.glb'))
    expect(file.subarray(0, 4).toString()).toBe('glTF')
    expect(file.length).toBeLessThan(2 * 1024 * 1024)
  })

  it('validates the v2 material library and every local texture reference', () => {
    expect(validateOfficeManifest(manifest).packId).toBe('mao-office-art-v2')
    const materials = JSON.parse(readFileSync(resolve(publicRoot, 'office-art/v1/materials.json'), 'utf8')) as { version: number; materials: Record<string, { roughness: number; metallic: number; baseColorTexture?: { url: string; repeat: number[]; colorSpace: string } }> }
    expect(materials.version).toBe(2)
    for (const material of Object.values(materials.materials)) {
      expect(material.roughness).toBeGreaterThanOrEqual(0)
      expect(material.roughness).toBeLessThanOrEqual(1)
      expect(material.metallic).toBeGreaterThanOrEqual(0)
      expect(material.metallic).toBeLessThanOrEqual(1)
      if (material.baseColorTexture) {
        const texturePath = resolveAssetUrl('/office-art/v1/manifest.json', material.baseColorTexture.url)
        expect(statSync(resolve(publicRoot, texturePath.slice(1))).isFile()).toBe(true)
        expect(material.baseColorTexture.colorSpace).toBe('srgb')
        expect(material.baseColorTexture.repeat).toHaveLength(2)
      }
    }
  })

  it('uses canonical Y-up geometry and floor-plane pivots in the GLB', () => {
    const bytes = readFileSync(resolve(publicRoot, 'office-art/v1/office-pack.glb'))
    const jsonLength = bytes.readUInt32LE(12)
    const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
      nodes: { name?: string; mesh?: number; translation?: number[] }[]
      meshes: { primitives: { attributes: { POSITION: number } }[] }[]
      accessors: { min?: number[]; max?: number[] }[]
    }
    const nodes = new Map(document.nodes.map(node => [node.name, node]))
    const boundsFor = (name: string) => {
      const node = nodes.get(name)
      expect(node?.mesh).toBeTypeOf('number')
      const accessor = document.accessors[document.meshes[node!.mesh!].primitives[0].attributes.POSITION]
      return { min: accessor.min!, max: accessor.max! }
    }
    const floor = boundsFor('floor.oak.light.slab')
    expect(floor.max[1] - floor.min[1]).toBeCloseTo(0.12)
    expect(floor.max[2] - floor.min[2]).toBeCloseTo(9)
    expect(nodes.get('floor.oak.light.slab')?.translation).toEqual([0, 0.06, 0])
    const wall = boundsFor('wall.brick.loft.brick')
    expect(wall.max[1] - wall.min[1]).toBeCloseTo(3.5)
    expect(wall.max[2] - wall.min[2]).toBeCloseTo(0.22)
    const character = boundsFor('character.base.idle.body')
    expect(character.max[1] - character.min[1]).toBeCloseTo(0.5)
    expect(character.max[1]).toBeGreaterThan(character.max[2])
  })

  it('validates the explicit asset-to-GLB material contract', () => {
    const library = JSON.parse(readFileSync(resolve(publicRoot, 'office-art/v1/materials.json'), 'utf8'))
    const validated = validateOfficeMaterialLibrary(library, '/office-art/v1/manifest.json')
    const bytes = readFileSync(resolve(publicRoot, 'office-art/v1/office-pack.glb'))
    const jsonLength = bytes.readUInt32LE(12)
    const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as { materials: { name?: string }[] }
    const glbNames = new Set(document.materials.map(material => material.name))
    for (const [assetMaterialId, mapping] of Object.entries(validated.mappings)) {
      expect(assetById(manifest, assetMaterialId)?.type).toBe('material')
      expect(glbNames.has(mapping.glbMaterialName)).toBe(true)
      expect(validated.materials[mapping.libraryKey]).toBeDefined()
    }
  })
})
