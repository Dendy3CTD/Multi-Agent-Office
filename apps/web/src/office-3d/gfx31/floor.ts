import * as THREE from 'three';

/** World-metre UVs: full tile 5.5 × 1.4 m, seven .20 m courses per tile. */
export function setFloorWorldUV(geometry: THREE.BufferGeometry, matrixWorld: THREE.Matrix4, bounds: THREE.Box3): void {
  const size = bounds.getSize(new THREE.Vector3()), positions = geometry.getAttribute('position');
  const uv = new Float32Array(positions.count * 2), point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(matrixWorld);
    uv[i * 2] = (point.x - bounds.min.x) / size.x;
    uv[i * 2 + 1] = (point.z - bounds.min.z) / size.z;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Derives the existing GFX30 albedo; suppresses only the abnormally dark seam texels. */
function softenOakSeams(source: THREE.Texture): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = source.image.width; canvas.height = source.image.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('gfx31_floor_context_missing');
  context.drawImage(source.image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height), original = new Uint8ClampedArray(pixels.data);
  const width = canvas.width, height = canvas.height;
  const luminance = (i: number) => original[i] * .2126 + original[i + 1] * .7152 + original[i + 2] * .0722;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4; if (luminance(i) > 113) continue;
    let neighbor = i;
    for (const [dx, dy] of [[-8, 0], [8, 0], [0, -8], [0, 8]]) {
      const j = (((y + dy + height) % height) * width + (x + dx + width) % width) * 4;
      if (luminance(j) > luminance(neighbor)) neighbor = j;
    }
    for (let c = 0; c < 3; c++) pixels.data[i + c] = original[i + c] * .18 + original[neighbor + c] * .82;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export function applyPremiumFloorV31(floor: THREE.Object3D) {
  floor.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(floor), ownedTextures = new Set<THREE.Texture>(), ownedMaterials = new Set<THREE.Material>();
  const entries: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[] = [];
  const materialCache = new Map<THREE.Material, THREE.Material>();
  let disposed = false;
  floor.traverse(node => {
    const mesh = node as THREE.Mesh; if (!mesh.isMesh) return;
    entries.push({ mesh, geometry: mesh.geometry, material: mesh.material });
    const geometry = mesh.geometry.clone(); setFloorWorldUV(geometry, mesh.matrixWorld, bounds); mesh.geometry = geometry;
    const adjust = (source: THREE.Material) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      const cached = materialCache.get(source); if (cached) return cached;
      const material = source.clone(); material.name = 'gfx31-oak-floor';
      for (const key of ['map', 'normalMap', 'roughnessMap'] as const) {
        const original = source[key]; if (!original) continue;
        const texture = key === 'map' ? softenOakSeams(original) : original.clone();
        texture.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(4, 10); texture.anisotropy = 4; texture.needsUpdate = true;
        ownedTextures.add(texture); material[key] = texture;
      }
      material.normalScale.set(.075, .075); material.roughness = .88; material.color.set(0xe0d1be);
      materialCache.set(source, material); ownedMaterials.add(material); return material;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(adjust) : adjust(mesh.material);
  });
  return {
    bounds, plankWidth: bounds.getSize(new THREE.Vector3()).z / 70, averageLength: bounds.getSize(new THREE.Vector3()).x / 8,
    cleanup() {
      if (disposed) return; disposed = true;
      for (const entry of entries) { entry.mesh.geometry.dispose(); entry.mesh.geometry = entry.geometry; entry.mesh.material = entry.material; }
      for (const material of ownedMaterials) material.dispose(); for (const texture of ownedTextures) texture.dispose();
      entries.length = 0; materialCache.clear(); ownedMaterials.clear(); ownedTextures.clear();
    },
  };
}
