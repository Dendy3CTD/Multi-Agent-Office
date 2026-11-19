import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type MaterialRole = 'oak' | 'oak-floor' | 'brick' | 'fabric' | 'glass' | 'bronze' | 'metal' | 'skin' | 'clothing' | 'other';
export interface PremiumLightingOptions {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  /** Y-up metres; lighting follows this root's transform. Default footprint 22 × 14. */
  floorRoot: THREE.Object3D;
  exposure?: number;
  /** Static low-resolution PBR reflections; generated once, no real-time GI. */
  environment?: boolean;
  shadowMapSize?: 1024 | 2048;
  resolveMaterialRole?: (material: THREE.Material, mesh: THREE.Mesh, index: number) => MaterialRole;
}
export const PREMIUM_LIGHTING_V29 = {
  background: 0x30363c,
  exposure: 1.08,
  hemisphere: { sky: 0xe4edf4, ground: 0x8d9291, intensity: 1.65 },
  daylight: { color: 0xfff6e8, intensity: 2.45 },
  fill: { color: 0xd8e8f2, intensity: .85 },
  // Orthographic controller recommendations only; this module never moves the camera.
  camera: { position: [19, 20, -23], target: [0, 1.1, 0], verticalSpan: 23, near: .1, far: 150, zoomMin: .72, zoomMax: 1.8, defaultZoom: 1 },
} as const;

function roleOf(material: THREE.Material, mesh: THREE.Mesh, index: number): MaterialRole {
  const name = String(mesh.userData.maoMaterialRoles?.[index] ?? material.userData.maoMaterialRole ?? material.name).toLowerCase();
  if (/oak|wood/.test(name)) {
    for (let object: THREE.Object3D | null = mesh; object; object = object.parent) if (object.userData.officeAssetId === 'floor.oak.light') return 'oak-floor';
    return 'oak';
  }
  if (/brick/.test(name)) return 'brick';
  if (/fabric|carpet|rug/.test(name)) return 'fabric';
  if (/glass/.test(name)) return 'glass';
  if (/bronze|brass/.test(name)) return 'bronze';
  if (/metal|graphite|steel/.test(name)) return 'metal';
  if (/skin/.test(name)) return 'skin';
  if (/cloth|shirt|trouser|denim|leather/.test(name)) return 'clothing';
  return 'other';
}

/** Material instances belong to this palette; textures always belong to their source owner. */
export class PremiumMaterialPaletteV29 {
  private assignments = new Map<THREE.Mesh, { original: THREE.Material | THREE.Material[]; applied: THREE.Material | THREE.Material[] }>();
  private clones = new Map<THREE.Material, Map<MaterialRole, THREE.MeshStandardMaterial>>();
  private owned = new Set<THREE.Material>();
  private references = new Map<THREE.Material, number>();
  private owners = new Map<THREE.Material, { source: THREE.Material; role: MaterialRole }>();
  private disposed = false;
  constructor(private resolve = roleOf) {}
  apply(root: THREE.Object3D): void {
    if (this.disposed) throw new Error('premium_palette_disposed');
    root.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || this.assignments.has(mesh)) return;
      const original = mesh.material;
      const adjust = (source: THREE.Material, index: number) => {
        if (!(source instanceof THREE.MeshStandardMaterial) || this.owned.has(source)) return source;
        const role = this.resolve(source, mesh, index);
        if (role === 'other') return source;
        let byRole = this.clones.get(source);
        if (!byRole) { byRole = new Map(); this.clones.set(source, byRole); }
        const existing = byRole.get(role); if (existing) return existing;
        const m = source.clone(); // Preserves maps, UVs, vertex colours, alpha, side, skin and morph support.
        m.name = `premium-v29:${source.name}`;
        if (role === 'oak') { m.color.multiply(new THREE.Color(.94, .98, 1.04)); m.roughness = Math.max(m.roughness, .7); }
        if (role === 'oak-floor') { m.color.multiply(new THREE.Color(.90, .90, .84)); m.roughness = Math.max(m.roughness, .82); }
        if (role === 'brick') { m.color.multiply(new THREE.Color(.98, 1, 1.02)); m.roughness = Math.max(m.roughness, .9); }
        if (role === 'fabric' || role === 'clothing') { m.roughness = Math.max(m.roughness, .88); m.metalness = 0; }
        // No environment map is assumed: keep a diffuse component so metal does not become black.
        if (role === 'bronze' || role === 'metal') { m.metalness = Math.min(m.metalness, .55); m.roughness = THREE.MathUtils.clamp(m.roughness, .38, .65); }
        if (role === 'skin') { m.roughness = Math.max(m.roughness, .68); m.metalness = 0; }
        // Glass deliberately retains source transmission/opacity/depthWrite; no scene-wide transparency edits.
        byRole.set(role, m); this.owned.add(m); this.owners.set(m, { source, role }); return m;
      };
      const applied = Array.isArray(original) ? original.map(adjust) : adjust(original, 0);
      mesh.material = applied; this.assignments.set(mesh, { original, applied });
      for (const material of Array.isArray(applied) ? applied : [applied]) if (this.owned.has(material)) this.references.set(material, (this.references.get(material) ?? 0) + 1);
    });
  }
  /** Forget removed/replaced employees promptly instead of retaining them until floor unmount. */
  release(root: THREE.Object3D): void { root.traverse(node => this.releaseMesh(node as THREE.Mesh)); }
  private releaseMesh(mesh: THREE.Mesh): void {
    const entry = this.assignments.get(mesh); if (!entry) return;
    if (mesh.material === entry.applied) mesh.material = entry.original;
    this.assignments.delete(mesh);
    for (const material of Array.isArray(entry.applied) ? entry.applied : [entry.applied]) {
      if (!this.owned.has(material)) continue;
      const references = (this.references.get(material) ?? 1) - 1;
      if (references > 0) { this.references.set(material, references); continue; }
      this.references.delete(material);
      const owner = this.owners.get(material);
      if (owner) { const byRole = this.clones.get(owner.source); byRole?.delete(owner.role); if (!byRole?.size) this.clones.delete(owner.source); }
      this.owners.delete(material); this.owned.delete(material); material.dispose();
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.assignments.keys()) this.releaseMesh(mesh);
    for (const material of this.owned) material.dispose();
    this.assignments.clear(); this.clones.clear(); this.owned.clear(); this.references.clear(); this.owners.clear();
  }
}

const activeRenderers = new WeakSet<THREE.WebGLRenderer>();
/** No renderer, animation loop, postprocess targets, geometry or texture allocations. */
export function createPremiumLightingV29(options: PremiumLightingOptions) {
  const { scene, renderer, camera, floorRoot } = options;
  const exposure = options.exposure ?? PREMIUM_LIGHTING_V29.exposure;
  if (!Number.isFinite(exposure) || exposure <= 0) throw new Error('premium_lighting_invalid_exposure');
  if (activeRenderers.has(renderer)) throw new Error('premium_lighting_already_active');
  activeRenderers.add(renderer);
  const saved = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, colorSpace: renderer.outputColorSpace,
    shadowEnabled: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type, shadowAuto: renderer.shadowMap.autoUpdate,
    shadowNeeds: renderer.shadowMap.needsUpdate, background: scene.background, backgroundIntensity: scene.backgroundIntensity, backgroundBlurriness: scene.backgroundBlurriness };
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = true;
  scene.background = new THREE.Color(PREMIUM_LIGHTING_V29.background); scene.backgroundIntensity = 1; scene.backgroundBlurriness = 0;
  const originalEnvironment = scene.environment, originalEnvironmentIntensity = scene.environmentIntensity;
  let environmentTarget: THREE.WebGLRenderTarget | undefined;
  if (options.environment) {
    const room = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
    try { environmentTarget = generator.fromScene(room, .06, .1, 100); scene.environment = environmentTarget.texture; scene.environmentIntensity = .16; }
    finally { room.dispose(); generator.dispose(); }
  }
  const group = new THREE.Group(); group.name = 'premium-lighting-v29'; floorRoot.add(group);
  const hemi = new THREE.HemisphereLight(PREMIUM_LIGHTING_V29.hemisphere.sky, PREMIUM_LIGHTING_V29.hemisphere.ground, PREMIUM_LIGHTING_V29.hemisphere.intensity);
  const daylight = new THREE.DirectionalLight(PREMIUM_LIGHTING_V29.daylight.color, PREMIUM_LIGHTING_V29.daylight.intensity);
  daylight.position.set(-8, 13, 8); daylight.target.position.set(0, 0, 0); daylight.castShadow = true;
  const shadow = daylight.shadow;
  shadow.mapSize.setScalar(options.shadowMapSize ?? 2048);
  Object.assign(shadow.camera, { left: -17, right: 17, top: 14, bottom: -14, near: .5, far: 48 });
  shadow.camera.updateProjectionMatrix(); shadow.bias = -.00015; shadow.normalBias = .035; shadow.radius = 2;
  const fill = new THREE.DirectionalLight(PREMIUM_LIGHTING_V29.fill.color, PREMIUM_LIGHTING_V29.fill.intensity);
  fill.position.set(7, 7, -8);
  const practical = (name: string, color: number, intensity: number, distance: number, position: [number,number,number]) => {
    const light = new THREE.PointLight(color, intensity, distance, 2); light.name = name; light.position.set(...position); return light;
  };
  const lounge = practical('lounge-amber', 0xffd6a4, 18, 7, [-9.2, 2.5, 4.6]);
  const meeting = practical('meeting-pendant', 0xffe6c4, 22, 8, [7.1, 3.5, -4.15]);
  const elevator = practical('elevator-soft', 0xdce7ed, 5, 4, [-5.4, 2.4, -2.9]);
  const lamps = practical('desk-practicals', 0xffdeb1, 12, 6, [0, 2.5, 1]);
  group.add(hemi, daylight, daylight.target, fill, fill.target, lounge, meeting, elevator, lamps);
  const palette = new PremiumMaterialPaletteV29(options.resolveMaterialRole);
  let disposed = false;
  const controls = {
    group, camera, lights: { hemisphere: hemi, daylight, fill, lounge, meeting, elevator, lamps },
    cameraRecommendation: PREMIUM_LIGHTING_V29.camera,
    /** Call after loading new scene-local clones; no implicit traversal every frame. */
    applyMaterials(root: THREE.Object3D = floorRoot) { if (disposed) throw new Error('premium_lighting_disposed'); palette.apply(root); },
    releaseMaterials(root: THREE.Object3D) { palette.release(root); },
    setExposure(value: number) { if (disposed || !Number.isFinite(value) || value <= 0) throw new Error('premium_lighting_invalid_exposure'); renderer.toneMappingExposure = value; },
    cleanup() {
      if (disposed) return; disposed = true;
      group.removeFromParent(); group.clear(); shadow.dispose(); palette.dispose();
      scene.environment = originalEnvironment; scene.environmentIntensity = originalEnvironmentIntensity; environmentTarget?.dispose();
      renderer.toneMapping = saved.toneMapping; renderer.toneMappingExposure = saved.exposure; renderer.outputColorSpace = saved.colorSpace;
      renderer.shadowMap.enabled = saved.shadowEnabled; renderer.shadowMap.type = saved.shadowType;
      renderer.shadowMap.autoUpdate = saved.shadowAuto; renderer.shadowMap.needsUpdate = saved.shadowNeeds;
      scene.background = saved.background; scene.backgroundIntensity = saved.backgroundIntensity; scene.backgroundBlurriness = saved.backgroundBlurriness;
      activeRenderers.delete(renderer);
    },
  };
  try { palette.apply(floorRoot); } catch (error) { controls.cleanup(); throw error; }
  return controls;
}
