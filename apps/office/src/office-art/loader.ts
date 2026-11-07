import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  assetById,
  loadOfficeManifest,
  OfficeArtError,
  OfficeAssetManifest,
  OfficeAssetRecord,
  resolveAssetUrl,
  validateOfficeManifest,
} from './asset-manifest'
import {
  loadOfficeMaterials,
  OfficeMaterialDescriptor,
  OfficeMaterialLibrary,
} from './materials'

export interface OfficeModelDocument {
  scene: THREE.Object3D
  animations?: readonly THREE.AnimationClip[]
}

export type OfficeModelLoader = (url: string) => Promise<OfficeModelDocument>
export type OfficeManifestFetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>
export type OfficeTextureLoader = (url: string) => Promise<THREE.Texture>

export interface AssetTransform {
  position?: THREE.Vector3 | readonly [number, number, number]
  rotation?: THREE.Euler | readonly [number, number, number]
  scale?: number | THREE.Vector3 | readonly [number, number, number]
}

export interface LoadedOfficeModel {
  record: OfficeAssetRecord
  source: OfficeModelDocument
  node: THREE.Object3D
  bounds: THREE.Box3
}

export interface BoundsReport {
  valid: boolean
  expected: readonly [number, number, number]
  actual: readonly [number, number, number]
  relativeError: readonly [number, number, number]
}

export interface OfficeArtRuntimeOptions {
  manifest?: OfficeAssetManifest
  manifestUrl?: string
  fetcher?: OfficeManifestFetcher
  modelLoader?: OfficeModelLoader
  textureLoader?: OfficeTextureLoader
}

interface ModelCacheEntry {
  promise: Promise<OfficeModelDocument>
  document?: OfficeModelDocument
  references: number
}

function vector(value: number | THREE.Vector3 | readonly [number, number, number] | undefined, fallback: THREE.Vector3): THREE.Vector3 {
  if (typeof value === 'number') return new THREE.Vector3(value, value, value)
  return value instanceof THREE.Vector3 ? value.clone() : value ? new THREE.Vector3(...value) : fallback.clone()
}

function loaderFromGLTF(): OfficeModelLoader {
  const loader = new GLTFLoader()
  return async url => {
    try {
      const gltf = await loader.loadAsync(url)
      return { scene: gltf.scene, animations: gltf.animations }
    } catch (error) {
      // Loader diagnostics can contain local paths or request details. Keep the
      // public error deliberately opaque; callers can log the typed code.
      void error
      throw new OfficeArtError('asset_load_failed')
    }
  }
}

function loaderFromTextureLoader(): OfficeTextureLoader {
  const loader = new THREE.TextureLoader()
  return url => loader.loadAsync(url)
}

function disposeObjectResources(root: THREE.Object3D): void {
  root.traverse(object => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) material?.dispose()
  })
}

export class OfficeArtRuntime {
  private readonly manifestUrl: string
  private readonly fetcher?: OfficeManifestFetcher
  private readonly modelLoader: OfficeModelLoader
  private readonly textureLoader: OfficeTextureLoader
  private readonly manifestSnapshot?: OfficeAssetManifest
  private manifestPromise?: Promise<OfficeAssetManifest>
  private readonly modelEntries = new Map<string, ModelCacheEntry>()
  private readonly instanceOwners = new WeakMap<THREE.Object3D, string>()
  private readonly materialInstances = new Map<string, THREE.MeshStandardMaterial>()
  private readonly texturePromises = new Map<string, Promise<THREE.Texture>>()
  private materialsPromise?: Promise<OfficeMaterialLibrary>
  private activeInstances = 0

  constructor(options: OfficeArtRuntimeOptions = {}) {
    this.manifestUrl = options.manifestUrl ?? '/office-art/v1/manifest.json'
    this.fetcher = options.fetcher
    this.manifestSnapshot = options.manifest ? validateOfficeManifest(options.manifest, this.manifestUrl) : undefined
    this.modelLoader = options.modelLoader ?? loaderFromGLTF()
    this.textureLoader = options.textureLoader ?? loaderFromTextureLoader()
  }

  async loadManifest(): Promise<OfficeAssetManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = this.manifestSnapshot
        ? Promise.resolve(this.manifestSnapshot)
        : loadOfficeManifest(this.fetcher ?? (url => fetch(url)), this.manifestUrl)
    }
    return this.manifestPromise
  }

  async getAsset(id: string): Promise<OfficeAssetRecord> {
    const record = assetById(await this.loadManifest(), id)
    if (!record) throw new OfficeArtError('asset_not_found')
    return record
  }

  async loadMaterials(): Promise<OfficeMaterialLibrary> {
    if (!this.materialsPromise) {
      this.materialsPromise = this.loadManifest().then(manifest => {
        const materialAsset = manifest.assets.find(asset => asset.id === 'material.floor.oak.light' && asset.type === 'material') ?? manifest.assets.find(asset => asset.type === 'material')
        if (!materialAsset) throw new OfficeArtError('office_art_material_invalid')
        const url = resolveAssetUrl(this.manifestUrl, materialAsset.url)
        return loadOfficeMaterials(this.fetcher ?? (requestUrl => fetch(requestUrl)), url, this.manifestUrl)
      })
    }
    return this.materialsPromise
  }

  async resolveMaterial(assetMaterialId: string): Promise<{ mapping: OfficeMaterialLibrary['mappings'][string]; descriptor: OfficeMaterialDescriptor }> {
    const library = await this.loadMaterials()
    const mapping = library.mappings[assetMaterialId]
    if (!mapping) throw new OfficeArtError('office_art_material_invalid')
    const descriptor = library.materials[mapping.libraryKey]
    if (!descriptor) throw new OfficeArtError('office_art_material_invalid')
    return { mapping, descriptor }
  }

  findNode(root: THREE.Object3D, nodeName: string): THREE.Object3D {
    const node = root.getObjectByName(nodeName) ?? root.getObjectByName(nodeName.replace(/\./g, ''))
    if (!node) throw new OfficeArtError('office_art_node_missing')
    return node
  }

  private async loadDocument(url: string): Promise<OfficeModelDocument> {
    let entry = this.modelEntries.get(url)
    if (!entry) {
      const promise = Promise.resolve().then(() => this.modelLoader(url)).catch(error => {
        if (error instanceof OfficeArtError) throw error
        throw new OfficeArtError('asset_load_failed')
      })
      entry = { promise, references: 0 }
      this.modelEntries.set(url, entry)
      const createdEntry = entry
      promise.then(document => {
        if (this.modelEntries.get(url) === createdEntry) createdEntry.document = document
      }, () => {
        if (this.modelEntries.get(url) === createdEntry) this.modelEntries.delete(url)
      })
    }
    return entry.promise
  }

  async loadModel(id: string): Promise<LoadedOfficeModel> {
    const record = await this.getAsset(id)
    if (record.type !== 'model' || !record.node) throw new OfficeArtError('asset_not_model')
    const url = resolveAssetUrl(this.manifestUrl, record.url)
    const source = await this.loadDocument(url)
    const node = this.findNode(source.scene, record.node)
    const bounds = this.computeBounds(node)
    return { record, source, node, bounds }
  }

  async createInstance(id: string, transform: AssetTransform = {}): Promise<THREE.Object3D> {
    const loaded = await this.loadModel(id)
    let visualNode = loaded.node
    const variants = loaded.record.variants?.filter(id => id.startsWith('character.base.'))
    if (variants?.length && id.startsWith('character.base.')) {
      const position = vector(transform.position, new THREE.Vector3())
      const seed = Math.abs(Math.round(position.x * 137 + position.z * 311))
      const variant = assetById(await this.loadManifest(), variants[seed % variants.length])
      if (variant?.node) visualNode = this.findNode(loaded.source.scene, variant.node)
    }
    const instance = cloneSkinned(visualNode)
    const requestedScale = vector(transform.scale, new THREE.Vector3(1, 1, 1))
    instance.scale.set(loaded.record.scale * requestedScale.x, loaded.record.scale * requestedScale.y, loaded.record.scale * requestedScale.z)
    if (transform.position) instance.position.copy(vector(transform.position, new THREE.Vector3()))
    if (transform.rotation) instance.rotation.copy(transform.rotation instanceof THREE.Euler ? transform.rotation : new THREE.Euler(...transform.rotation))
    instance.userData.officeAssetId = id
    const url = resolveAssetUrl(this.manifestUrl, loaded.record.url)
    const entry = this.modelEntries.get(url)
    if (entry) {
      entry.references += 1
      this.instanceOwners.set(instance, url)
      this.activeInstances += 1
    }
    return instance
  }

  createCharacter(employeeId: string, status: 'idle' | 'working' | 'selected' | 'blocked', transform?: AssetTransform): Promise<THREE.Object3D> {
    return this.createInstance(`character.base.${status}`, transform).then(instance => {
      instance.userData.employeeId = employeeId
      instance.userData.characterStatus = status
      return instance
    })
  }

  applyTransform(object: THREE.Object3D, transform: AssetTransform): THREE.Object3D {
    if (transform.position) object.position.copy(vector(transform.position, object.position))
    if (transform.rotation) object.rotation.copy(transform.rotation instanceof THREE.Euler ? transform.rotation : new THREE.Euler(...transform.rotation))
    if (transform.scale) object.scale.copy(vector(transform.scale, object.scale))
    return object
  }

  async applyMaterials(object: THREE.Object3D): Promise<void> {
    const library = await this.loadMaterials()
    const materialPromises: Promise<void>[] = []
    object.traverse(child => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const replacements = sourceMaterials.map(source => {
        const mapping = Object.values(library.mappings).find(candidate => candidate.glbMaterialName === source.name)
        if (!mapping) return Promise.resolve(source)
        const descriptor = library.materials[mapping.libraryKey]
        const cached = this.materialInstances.get(mapping.libraryKey)
        if (cached) return Promise.resolve(cached)
        return this.materialForDescriptor(mapping.libraryKey, descriptor)
      })
      materialPromises.push(Promise.all(replacements).then(materials => {
        mesh.material = Array.isArray(mesh.material) ? materials : materials[0]
      }))
    })
    await Promise.all(materialPromises)
  }

  private async materialForDescriptor(key: string, descriptor: OfficeMaterialDescriptor): Promise<THREE.MeshStandardMaterial> {
    const existing = this.materialInstances.get(key)
    if (existing) return existing
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(descriptor.baseColorFactor[0], descriptor.baseColorFactor[1], descriptor.baseColorFactor[2]),
      opacity: descriptor.baseColorFactor[3],
      transparent: descriptor.baseColorFactor[3] < 1,
      roughness: descriptor.roughness,
      side: descriptor.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      emissive: descriptor.emissiveFactor ? new THREE.Color(...descriptor.emissiveFactor) : new THREE.Color(0),
      metalness: descriptor.metallic,
    })
    this.materialInstances.set(key, material)
    if (descriptor.baseColorTexture) {
      let texturePromise = this.texturePromises.get(descriptor.baseColorTexture.url)
      if (!texturePromise) {
        const url = resolveAssetUrl(this.manifestUrl, descriptor.baseColorTexture.url)
        texturePromise = Promise.resolve().then(() => this.textureLoader(url)).catch(error => {
          if (error instanceof OfficeArtError) throw error
          throw new OfficeArtError('asset_load_failed')
        })
        this.texturePromises.set(descriptor.baseColorTexture.url, texturePromise)
      }
      try {
        const texture = await texturePromise
        texture.colorSpace = THREE.SRGBColorSpace
        texture.wrapS = descriptor.baseColorTexture.wrapS === 'repeat' ? THREE.RepeatWrapping : descriptor.baseColorTexture.wrapS === 'mirrored-repeat' ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping
        texture.wrapT = descriptor.baseColorTexture.wrapT === 'repeat' ? THREE.RepeatWrapping : descriptor.baseColorTexture.wrapT === 'mirrored-repeat' ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping
        texture.repeat.set(...descriptor.baseColorTexture.repeat)
        material.map = texture
        material.needsUpdate = true
      } catch (error) {
        this.materialInstances.delete(key)
        throw error
      }
    }
    return material
  }

  computeBounds(object: THREE.Object3D): THREE.Box3 {
    object.updateMatrixWorld(true)
    return new THREE.Box3().setFromObject(object)
  }

  checkBounds(object: THREE.Object3D, expected: readonly [number, number, number], tolerance = 0.25): BoundsReport {
    const size = this.computeBounds(object).getSize(new THREE.Vector3())
    const actual = [size.x, size.y, size.z] as const
    const relativeError = actual.map((value, index) => expected[index] === 0 ? (value === 0 ? 0 : Infinity) : Math.abs(value - expected[index]) / expected[index]) as unknown as readonly [number, number, number]
    return { valid: relativeError.every(value => value <= tolerance), expected, actual, relativeError }
  }

  disposeInstance(object: THREE.Object3D): void {
    object.parent?.remove(object)
    const url = this.instanceOwners.get(object)
    if (!url) return
    this.instanceOwners.delete(object)
    this.activeInstances -= 1
    const entry = this.modelEntries.get(url)
    if (!entry) return
    entry.references = Math.max(0, entry.references - 1)
    if (entry.references === 0 && entry.document) {
      disposeObjectResources(entry.document.scene)
      this.modelEntries.delete(url)
    }
  }

  clearModelCache(): void {
    for (const [url, entry] of this.modelEntries) {
      if (entry.references !== 0) continue
      if (entry.document) disposeObjectResources(entry.document.scene)
      this.modelEntries.delete(url)
    }
  }

  disposeSharedResources(): void {
    if (this.activeInstances > 0) throw new OfficeArtError('office_art_resources_in_use')
    this.clearModelCache()
    for (const material of this.materialInstances.values()) material.dispose()
    for (const texturePromise of this.texturePromises.values()) texturePromise.then(texture => texture.dispose()).catch(() => undefined)
    this.materialInstances.clear()
    this.texturePromises.clear()
  }
}

export function createOfficeArtRuntime(options?: OfficeArtRuntimeOptions): OfficeArtRuntime {
  return new OfficeArtRuntime(options)
}
