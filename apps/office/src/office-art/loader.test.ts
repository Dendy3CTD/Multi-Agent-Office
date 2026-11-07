import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { OfficeArtRuntime } from './loader'
import { validateOfficeManifest } from './asset-manifest'
import type { OfficeAssetManifest, OfficeAssetRecord } from './asset-manifest'

const publicRoot = resolve(process.cwd(), 'public')
const manifest = JSON.parse(readFileSync(resolve(publicRoot, 'office-art/v1/manifest.json'), 'utf8')) as OfficeAssetManifest

function glbNodeNames(): Set<string> {
  const bytes = readFileSync(resolve(publicRoot, 'office-art/v1/office-pack.glb'))
  const jsonLength = bytes.readUInt32LE(12)
  const jsonStart = 20
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonStart + jsonLength))) as { nodes?: readonly { name?: string }[] }
  return new Set((json.nodes ?? []).flatMap(node => node.name ? [node.name] : []))
}

function record(id: string, node: string): OfficeAssetRecord {
  return { id, url: 'pack.glb', node, type: 'model', scale: 1, origin: [0, 0, 0], anchor: 'base', bounds: [1, 1, 1], license: 'CC0', source: 'synthetic' }
}

function syntheticManifest(): OfficeAssetManifest {
  return { schemaVersion: 1, packId: 'synthetic', coordinateSystem: 'right-handed-z-up', defaultScale: 1, assets: [record('character.base.idle', 'character'), record('character.base.working', 'character')] }
}

describe('office art runtime', () => {
  it('maps every declared model node to a node in the shipped GLB', () => {
    const names = glbNodeNames()
    const checked = manifest.assets.filter(asset => asset.type === 'model')
    expect(checked.length).toBeGreaterThan(0)
    for (const asset of checked) expect(names.has(asset.node!)).toBe(true)
    expect(validateOfficeManifest(manifest).assets).toHaveLength(manifest.assets.length)
  })

  it('shares one model load while returning independent instances', async () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    mesh.name = 'character'
    root.add(mesh)
    let loads = 0
    const runtime = new OfficeArtRuntime({
      manifest: syntheticManifest(),
      modelLoader: async () => { loads += 1; return { scene: root } },
    })

    const [first, second] = await Promise.all([runtime.createInstance('character.base.idle'), runtime.createInstance('character.base.idle')])
    expect(loads).toBe(1)
    expect(first).not.toBe(second)
    const firstMesh = first.getObjectByName('character') as THREE.Mesh
    const secondMesh = second.getObjectByName('character') as THREE.Mesh
    expect(firstMesh.geometry).toBe(secondMesh.geometry)
    runtime.disposeInstance(first)
    expect(second.getObjectByName('character')).toBeDefined()
    runtime.disposeInstance(second)
    await runtime.createInstance('character.base.idle')
    expect(loads).toBe(2)
  })

  it('creates status-tagged character instances without duplicating source assets', async () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial())
    mesh.name = 'character'
    root.add(mesh)
    const runtime = new OfficeArtRuntime({ manifest: syntheticManifest(), modelLoader: async () => ({ scene: root }) })
    const instance = await runtime.createCharacter('employee-001', 'working')
    expect(instance.userData).toMatchObject({ employeeId: 'employee-001', characterStatus: 'working' })
    expect(runtime.checkBounds(instance, [1, 2, 1]).valid).toBe(true)
  })

  it('reports missing nodes with a typed error and does not cache failed loads', async () => {
    let loads = 0
    const runtime = new OfficeArtRuntime({
      manifest: { ...syntheticManifest(), assets: [record('missing', 'not-in-scene')] },
      modelLoader: async () => { loads += 1; return { scene: new THREE.Group() } },
    })
    await expect(runtime.loadModel('missing')).rejects.toMatchObject({ code: 'office_art_node_missing' })
    await expect(runtime.loadModel('missing')).rejects.toMatchObject({ code: 'office_art_node_missing' })
    expect(loads).toBe(1)
  })

  it('resolves shared material metadata and reuses one texture/material instance', async () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: 'oak' }))
    mesh.name = 'character'
    root.add(mesh)
    const materialAsset = { id: 'material.floor.oak.light', url: 'materials.json', type: 'material' as const, scale: 1, origin: [0, 0, 0] as const, anchor: 'surface', bounds: [0, 0, 0] as const, license: 'Project-owned', source: 'synthetic' }
    const materials = {
      version: 2, units: 'linear-srgb', colorSpace: 'srgb',
      materials: { oak: { baseColorFactor: [0.6, 0.4, 0.2, 1], roughness: 0.8, metallic: 0, baseColorTexture: { url: 'oak.svg', colorSpace: 'srgb', wrapS: 'repeat', wrapT: 'repeat', repeat: [2, 2] } } },
      mappings: { 'material.floor.oak.light': { glbMaterialName: 'oak', libraryKey: 'oak', textureUrl: 'oak.svg' } },
    }
    let textures = 0
    const runtime = new OfficeArtRuntime({
      manifest: { ...syntheticManifest(), assets: [...syntheticManifest().assets, materialAsset] },
      modelLoader: async () => ({ scene: root }),
      fetcher: async url => ({ ok: true, json: async () => url.endsWith('materials.json') ? materials : {} }),
      textureLoader: async () => { textures += 1; return new THREE.Texture() },
    })
    const first = await runtime.createInstance('character.base.idle')
    const second = await runtime.createInstance('character.base.idle')
    await runtime.applyMaterials(first)
    await runtime.applyMaterials(second)
    expect(textures).toBe(1)
    expect((first.getObjectByName('character') as THREE.Mesh).material).toBe((second.getObjectByName('character') as THREE.Mesh).material)
    runtime.disposeInstance(first)
    runtime.disposeInstance(second)
    runtime.disposeSharedResources()
  })
})
