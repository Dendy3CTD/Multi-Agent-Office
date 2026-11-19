import * as THREE from 'three';

/** Linear material multipliers; hex light/background colors are decoded by Three. */
export const COMFORT_LIGHTING = {
  background: 0x68757d,
  exposure: 1.0,
  hemisphere: { sky: 0xe2eaf0, ground: 0x747d82, intensity: 2.0 },
  sun: { color: 0xf2f0e9, intensity: 1.75 },
  windowFill: { color: 0xe5eef5, intensity: 3.5 },
} as const;

/** Capture GLB material semantics before OfficeArtRuntime replaces their names. */
export function rememberMaterialRoles(object: THREE.Object3D): void {
  object.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) mesh.userData.maoMaterialRoles = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => material.name);
  });
}

/** Own scene-local overrides. Never mutate/dispose runtime cache materials or maps. */
export class ScenePalette {
  private owned = new WeakSet<THREE.Material>();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private bump?: THREE.Texture;
  apply(object: THREE.Object3D, assetId: string): void {
    object.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const roles = mesh.userData.maoMaterialRoles as string[] | undefined;
      const apply = (source: THREE.Material, index: number): THREE.Material => {
        if (this.owned.has(source)) return source;
        const role = roles?.[index] ?? source.name;
        const floor = assetId === 'floor.oak.light';
        const key = `${source.uuid}:${floor ? 'floor' : 'object'}`;
        const existing = this.materials.get(key);
        if (existing) return existing;
        if (!(source instanceof THREE.MeshStandardMaterial)) return source;
        const material = source.clone();
        material.name = `comfort-${role}`;
        if (role === 'oak') {
          material.color.multiply(new THREE.Color(...(floor ? [.78,.85,.98] : [.90,.95,1.04]) as [number,number,number]));
          material.roughness = floor ? .82 : .76;
          if (floor && material.map) {
            this.bump ??= material.map.clone();
            this.bump.colorSpace = THREE.NoColorSpace; this.bump.needsUpdate = true;
            material.bumpMap = this.bump; material.bumpScale = .006;
          }
        } else if (role === 'brick') {
          material.color.multiply(new THREE.Color(.83,.90,.96)); material.roughness = .92;
        } else if (role === 'wall') {
          material.color.multiply(new THREE.Color(.82,.85,.90)); material.roughness = .94;
        } else if (role === 'metal') {
          material.roughness = .48; material.metalness = .55;
        } else if (role === 'bronze') {
          material.color.multiply(new THREE.Color(.94,1,1.08)); material.roughness = .46; material.metalness = .62;
        } else if (role === 'carpet') {
          material.color.lerp(new THREE.Color(.29,.33,.31), .5);
        } else if (role === 'amber') {
          material.emissiveIntensity *= .65;
        }
        this.owned.add(material);
        this.materials.set(key,material);
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(apply) : apply(mesh.material,0);
    });
  }
  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear(); this.bump?.dispose(); this.bump = undefined;
  }
}
