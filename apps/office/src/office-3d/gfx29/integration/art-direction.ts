import * as THREE from 'three';
import type { PremiumArchitecture } from '../architecture';

/** Scene-only finishing; never edits the source pack or architecture factory. */
export function finishPremiumInterior(architecture: PremiumArchitecture, floor: THREE.Object3D) {
  const group = new THREE.Group(); group.name = 'premium-floor-finishing';
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const assignments = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const characterAssignments = new Map<THREE.Object3D, { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; owned: THREE.Material[] }[]>();
  const hidden: THREE.Object3D[] = [];
  let disposed = false;
  const canvasMap = (width: number, height: number, paint: (context: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('premium_texture_context_unavailable');
    paint(context);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    textures.add(texture); return texture;
  };
  const oak = canvasMap(1024, 512, context => {
    const shades = ['#b99a7b', '#bea183', '#c3a689', '#bfa084', '#b2957a', '#c4a98c'];
    for (let row = 0; row < 8; row++) {
      context.fillStyle = shades[row % shades.length]; context.fillRect(0, row * 64, 1024, 64);
      context.strokeStyle = 'rgba(74,53,37,.24)'; context.lineWidth = 1;
      context.beginPath(); context.moveTo(0, row * 64); context.lineTo(1024, row * 64); context.stroke();
      for (let board = 0; board < 4; board++) { const x = board * 320 + (row % 3) * 94; context.fillStyle = 'rgba(66,45,32,.16)'; context.fillRect(x, row * 64, 1.2, 64); }
      for (let grain = 0; grain < 30; grain++) {
        const y = row * 64 + grain * 2.1;
        context.strokeStyle = grain % 3 ? 'rgba(80,57,39,.07)' : 'rgba(244,223,192,.14)'; context.lineWidth = .6;
        context.beginPath(); context.moveTo(0, y); context.bezierCurveTo(280, y + Math.sin(grain) * 4, 660, y - Math.cos(grain) * 3, 1024, y + 1); context.stroke();
      }
    }
  });
  oak.wrapS = oak.wrapT = THREE.RepeatWrapping; oak.repeat.set(2.5, 2);
  floor.traverse(node => {
    const mesh = node as THREE.Mesh; if (!mesh.isMesh) return;
    assignments.set(mesh, mesh.material);
    const adjust = (source: THREE.Material) => {
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      const material = source.clone(); material.map = oak; material.color.set(0xffffff); material.roughness = .84;
      materials.add(material); return material;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(adjust) : adjust(mesh.material);
  });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number]) => {
    geometries.add(geometry); materials.add(material);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); group.add(mesh); return mesh;
  };
  const pendant = architecture.getObjectByName('meeting-pendant');
  if (pendant) {
    hidden.push(pendant); pendant.visible = false;
    const dark = new THREE.MeshStandardMaterial({ name: 'metal', color: 0x34393a, roughness: .42, metalness: .35 });
    const glow = new THREE.MeshStandardMaterial({ name: 'amber', color: 0xf5dbb6, emissive: 0xffd6a0, emissiveIntensity: .65, roughness: .6 });
    const ring = add(new THREE.TorusGeometry(.7, .055, 8, 64), dark, [7.15, 3.02, -4.25]); ring.rotation.x = Math.PI / 2;
    const diffuser = add(new THREE.TorusGeometry(.7, .027, 6, 64), glow, [7.15, 2.975, -4.25]); diffuser.rotation.x = Math.PI / 2;
    for (const x of [6.65, 7.65]) add(new THREE.CylinderGeometry(.008, .008, 1.1, 5), dark, [x, 3.58, -4.25]);
  }
  const landscape = canvasMap(384, 256, context => {
    const sky = context.createLinearGradient(0, 0, 0, 256); sky.addColorStop(0, '#d8c9af'); sky.addColorStop(1, '#b7aa95');
    context.fillStyle = sky; context.fillRect(0, 0, 384, 256);
    for (const [color, base, height] of [['#b4a38f', 130, 55], ['#927d68', 172, 70], ['#6e6459', 230, 62]] as const) {
      context.fillStyle = color; context.beginPath(); context.moveTo(0, 256);
      for (let x = 0; x <= 384; x += 20) context.lineTo(x, base - Math.abs(Math.sin(x * .013 + base)) * height);
      context.lineTo(384, 256); context.closePath(); context.fill();
    }
  });
  for (const key of ['brick-art', 'lounge-art']) {
    const frame = architecture.getObjectByName(key); if (!frame) continue;
    const box = new THREE.Box3().setFromObject(frame), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const side = key === 'lounge-art';
    const picture = add(new THREE.PlaneGeometry((side ? size.z : size.x) * .84, size.y * .77), new THREE.MeshStandardMaterial({ map: landscape, roughness: .96 }), side ? [box.max.x + .007, center.y, center.z] : [center.x, center.y, box.min.z - .007]);
    picture.rotation.y = side ? Math.PI / 2 : Math.PI;
  }
  // The shader uses this neutral weave only for individually styled shirts.
  const weave = canvasMap(64, 64, context => {
    context.fillStyle = '#e2e0da'; context.fillRect(0, 0, 64, 64);
    context.strokeStyle = '#c9c8c3'; context.globalAlpha = .35;
    for (let i = 0; i < 64; i += 3) { context.beginPath(); context.moveTo(i, 0); context.lineTo(i, 64); context.moveTo(0, i); context.lineTo(64, i); context.stroke(); }
  });
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping; weave.repeat.set(3, 3);
  const releaseCharacter = (root: THREE.Object3D) => {
    const entries = characterAssignments.get(root); if (!entries) return;
    for (const entry of entries) { entry.mesh.material = entry.original; for (const material of entry.owned) material.dispose(); }
    characterAssignments.delete(root);
  };
  return {
    group,
    applyCharacter(root: THREE.Object3D, employeeId: string) {
      let seed = 0; for (const ch of employeeId) seed = Math.imul(seed, 31) + ch.charCodeAt(0) | 0;
      const color = [0x425960, 0x687d72, 0xbcb4a5, 0x786663, 0x596a7b, 0x986e57][Math.abs(seed) % 6];
      const entries: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; owned: THREE.Material[] }[] = [];
      root.traverse(node => {
        const mesh = node as THREE.Mesh; if (!mesh.isMesh) return;
        const owned: THREE.Material[] = [], original = mesh.material;
        const adjust = (source: THREE.Material, index: number) => {
          if (!(source instanceof THREE.MeshStandardMaterial) || mesh.userData.maoMaterialRoles?.[index] !== 'fabric-blue') return source;
          const material = source.clone(); material.color.set(color); material.map = weave; material.name = 'clothing'; material.roughness = .9; owned.push(material); return material;
        };
        mesh.material = Array.isArray(original) ? original.map(adjust) : adjust(original, 0);
        if (owned.length) entries.push({ mesh, original, owned });
      });
      characterAssignments.set(root, entries);
    },
    releaseCharacter,
    cleanup() {
      if (disposed) return; disposed = true;
      group.removeFromParent();
      for (const root of characterAssignments.keys()) releaseCharacter(root);
      for (const [mesh, original] of assignments) mesh.material = original;
      for (const object of hidden) object.visible = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      group.clear(); assignments.clear();
    },
  };
}
