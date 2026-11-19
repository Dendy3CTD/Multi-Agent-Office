import * as THREE from 'three';
import { createBotanicalPalette } from '../gfx33/botanical';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PremiumArchitecture } from '../gfx29/architecture';
import type { SetName } from '../gfx30/materials';

type XYZ = [number, number, number];
interface Part { position: XYZ; size: XYZ; rotation: XYZ; color?: THREE.Color }
export interface PolishOptions {
  root: THREE.Group;
  architecture: PremiumArchitecture;
  material(name: SetName): THREE.MeshStandardMaterial;
  floorY: number;
}
/** Batched scene art: borrowed GLB resources stay with OfficeArtRuntime. */
export function createVisualPolishV31(options: PolishOptions) {
  const { root, architecture, floorY, material } = options;
  const group = new THREE.Group(); group.name = 'gfx31-production-polish';
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const hidden: THREE.Object3D[] = [], transforms: { object: THREE.Object3D; position: THREE.Vector3; scale: THREE.Vector3 }[] = [];
  const assignments: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[] = [];
  const batches = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material; parts: Part[]; cast: boolean }>();
  const solidBounds: { id: string; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  let disposed = false;
  const cube = new THREE.BoxGeometry(); geometries.add(cube);
  const cushion = new RoundedBoxGeometry(1, 1, 1, 3, .16); geometries.add(cushion);
  const paper = new THREE.MeshStandardMaterial({ color: 0xd9cfba, roughness: .97 }); materials.add(paper);
  const bookMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9 }); materials.add(bookMaterial);
  const bronze = material('brushed-bronze'), wood = material('walnut-shelf'), forest = material('forest-upholstery');
  const part = (geometry: THREE.BufferGeometry, mat: THREE.Material, position: XYZ, size: XYZ, rotation: XYZ = [0, 0, 0], color?: number, cast = true) => {
    const key = `${geometry.uuid}:${mat.uuid}:${cast}`;
    let batch = batches.get(key); if (!batch) { batch = { geometry, material: mat, parts: [], cast }; batches.set(key, batch); }
    batch.parts.push({ position, size, rotation, color: color === undefined ? undefined : new THREE.Color(color) });
  };
  const block = (position: XYZ, size: XYZ, mat: THREE.Material, color?: number) => part(cube, mat, position, size, [0, 0, 0], color);
  const botanical = createBotanicalPalette();
  botanical.geometries.forEach(g => geometries.add(g)); botanical.materials.forEach(m => materials.add(m));
  const plant = (x:number,y:number,z:number,scale=1) => {
    botanical.plant(part,x,y,z,scale);
    if(y <= floorY+.01) solidBounds.push({id:`plant-${x}-${z}`,minX:x-.25*scale,maxX:x+.25*scale,minZ:z-.25*scale,maxZ:z+.25*scale});
  };
  // Replace only legacy plant holders, never storage, furniture or employee roots.
  for (const asset of architecture.assetBounds ?? []) if (asset.id === 'plant.potted' && !asset.key.startsWith('sill-plant-')) {
    const object = architecture.getObjectByName(asset.key);
    if (object?.visible) { hidden.push(object); object.visible = false; }
    const center = asset.bounds.getCenter(new THREE.Vector3());
    botanical.plant(part,center.x,asset.supportY,center.z,asset.key.startsWith('shelf-') ? .62 : asset.key === 'lounge-plant' ? 1.35 : 1.05);
  }
  const hanging = architecture.getObjectByName('hanging-foliage');
  if (hanging) { hidden.push(hanging); hanging.visible = false; }
  for (const x of [-9.5,9.5]) botanical.vine(part,x,floorY+3.5,6.02);
  // Real slats around the existing physical door opening; no false door facade.
  for (const center of [1.13, 4.87]) for (let i = 0; i < 8; i++) block([-10.67, floorY + 1.72, center - .27 + i * .077], [.055, 3.4, .045], wood);
  for (let i = 0; i < 51; i++) block([-10.67, floorY + 3.18, 1.08 + i * .077], [.055, .94, .045], wood);
  // A built-in console fills the empty side wall without entering the lift approach.
  for (const y of [.12, .66, 1.14]) block([-10.43, floorY + y, -.05], [.56, .055, 2.55], wood);
  for (const z of [-1.33, -.05, 1.23]) block([-10.43, floorY + .63, z], [.56, 1.06, .045], wood);
  solidBounds.push({ id: 'gfx31-console', minX: -10.71, maxX: -10.15, minZ: -1.36, maxZ: 1.26 });
  const bookColors = [0x526257, 0xb37f58, 0x666c75, 0xa58d65, 0x715450, 0xc3b89b];
  for (let i = 0; i < 18; i++) {
    const z = -.98 + (i % 9) * .12, y = floorY + (i < 9 ? .31 : .84), h = .25 + (i % 4) * .025;
    block([-10.17, y, z], [.27, h, .075], bookMaterial, bookColors[i % bookColors.length]);
  }
  plant(-10.37, floorY + 1.18, .69, .7);
  block([-10.34, floorY + 1.19, -.6], [.3, .045, .39], paper);
  block([-10.34, floorY + 1.23, -.6], [.3, .025, .39], bookMaterial, 0x87724f);

  const assign = (mesh: THREE.Mesh, mat: THREE.Material) => { assignments.push({ mesh, original: mesh.material }); mesh.material = mat; };
  // Preserve the public assets and their supports; dress the real furniture in place.
  const localPart = (holder: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, pos: XYZ, size: XYZ, rotation: XYZ = [0, 0, 0]) => {
    holder.updateWorldMatrix(true, false);
    const point = holder.localToWorld(new THREE.Vector3(...pos));
    const euler = new THREE.Euler(...rotation); euler.y += holder.rotation.y;
    part(geometry, mat, point.toArray() as XYZ, size, [euler.x, euler.y, euler.z]);
  };
  const table = architecture.getObjectByName('meeting-table');
  if (table) {
    table.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && /glass/.test(mesh.name)) assign(mesh, material('desk-oak'));
    });
    // Books, notepads and ceramic planter sit on the measured .788 m table top.
    const y = floorY + .035 + .788;
    block([6.2, y + .025, -4.25], [.39, .05, .28], bookMaterial, 0x586950);
    block([6.2, y + .063, -4.25], [.35, .025, .25], paper);
    block([8.15, y + .012, -4.15], [.32, .018, .24], paper);
    plant(7.15, y, -4.25, .32);
  }
  for (const holder of architecture.children.filter(o => o.name.startsWith('meeting-chair-'))) {
    holder.traverse(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh && /fabric/.test(mesh.name)) assign(mesh, forest); });
    localPart(holder, cushion, forest, [0, .51, 0], [.59, .15, .53]);
    localPart(holder, cushion, forest, [0, .83, .22], [.59, .48, .14], [-.12, 0, 0]);
  }
  // Volume and pillows read at Fit Floor, with a shared rounded geometry.
  const sofa = architecture.getObjectByName('lounge-sofa');
  if (sofa) {
    for (const z of [-5.45, -4.35, -3.25]) {
      part(cushion, forest, [-9.86, floorY + .55, z], [.9, .24, .9]);
      part(cushion, forest, [-10.25, floorY + .91, z], [.25, .68, .88], [0, 0, -.12]);
    }
    for (const [z, mat] of [[-5.47, material('terracotta-upholstery')], [-3.32, material('ivory-rug')]] as const)
      part(cushion, mat, [-9.94, floorY + .91, z], [.28, .49, .49], [.12, 0, -.2]);
  }
  // Warm shade, side table and books complete the lounge without entering the lift route.
  const shade = new THREE.CylinderGeometry(.68, 1, 1, 32, 1, true); geometries.add(shade);
  const linen = material('ivory-rug').clone(); linen.side = THREE.DoubleSide; materials.add(linen);
  const diffuser = new THREE.MeshStandardMaterial({ color: 0xffe4b5, emissive: 0xffc57c, emissiveIntensity: .75, roughness: .8 }); materials.add(diffuser);
  const disk = new THREE.CylinderGeometry(1, 1, 1, 32); geometries.add(disk);
  part(shade, linen, [-10.1, floorY + 1.86, -6.55], [.37, .36, .37]);
  part(disk, diffuser, [-10.1, floorY + 1.69, -6.55], [.34, .014, .34], [0, 0, 0], undefined, false);
  block([-8.32, floorY + .48, -2.83], [.58, .07, .58], wood);
  for (const x of [-8.55, -8.09]) for (const z of [-3.06, -2.6]) block([x, floorY + .25, z], [.045, .46, .045], wood);
  for (let i = 0; i < 4; i++) block([-8.32, floorY + .54 + i * .055, -2.83], [.42 - i * .025, .05, .34], bookMaterial, bookColors[i]);
  plant(-8.5, floorY + .56, -4.35, .27);
  plant(7.8, floorY, 5.65, .85);
  plant(-10.2, floorY, 5.1, 1.2);
  for (const x of [-6.55, -1.95, 1.95, 6.55]) {
    const original = architecture.getObjectByName(`sill-plant-${x}`);
    if (original) { hidden.push(original); original.visible = false; }
    plant(x, floorY + 1.1, 6.53, .46);
  }
  // Alternate stationery and greenery on existing Directory desks; no new seats.
  const desks = root.children.filter(o => o.userData.officeAssetId === 'desk.modern');
  desks.sort((a, b) => String(a.userData.deskId).localeCompare(String(b.userData.deskId)));
  desks.forEach((desk, i) => {
    const x = desk.position.x, z = desk.position.z, y = floorY + .872;
    block([x + .55, y + .018, z + .05], [.27, .032, .22], bookMaterial, bookColors[i % 6]);
    if (i % 3 !== 1) plant(x + .56, y + .035, z - .21, .19);
    else for (let j = 0; j < 3; j++) block([x + .55, y + .05 + j * .018, z + .05], [.24, .012, .2], paper);
    // Solid timber edge and modest variation in tabletop width, without moving anchors.
    part(cushion, material('desk-oak'), [x, floorY + .777, z], [1.54 + (i % 3) * .045, .075, .76]);
  });

  // Actual picture-light rails reinforce the existing art and sconces.
  block([-10.46, floorY+3.55, -4.25],[.16,.045,1.12],bronze);
  part(cube,diffuser,[-10.43,floorY+3.52,-4.25],[.12,.018,1.03],[0,0,0],undefined,false);
  block([0,floorY+3.3,6.43],[.88,.045,.14],bronze);
  part(cube,diffuser,[0,floorY+3.27,6.41],[.8,.018,.1],[0,0,0],undefined,false);
  // The skyline stays behind the real apertures. Shallow architectural volumes
  // supply parallax and sunlit returns in front of the existing distant texture.
  const cityStone = new THREE.MeshStandardMaterial({ color: 0xc2b6a0, roughness: .93, emissive: 0x8e8170, emissiveIntensity: .2 });
  const cityGlass = new THREE.MeshStandardMaterial({ color: 0xa6aaa0, roughness: .48, metalness: .12 });
  const cityWindow = new THREE.MeshBasicMaterial({ color: 0xe7c690, transparent: true, opacity: .48 });
  materials.add(cityStone); materials.add(cityGlass); materials.add(cityWindow);
  for (const center of [-4.3, 4.3]) for (let i = 0; i < 7; i++) {
    const x = center - 3.1 + i * 1.02, height = .65 + Math.abs(Math.sin(i * 3.9 + center)) * 1.45, z = 7.65 + (i % 2) * .28;
    part(cube, i % 2 ? cityStone : cityGlass, [x, floorY + .6 + height / 2, z], [.64, height, .38], [0, 0, 0], undefined, false);
    if (i % 3 === 0) {
      part(cube, cityStone, [x, floorY + .72 + height, z], [.42, .24, .27], [0, 0, 0], undefined, false);
      part(cube, cityStone, [x, floorY + 1.03 + height, z], [.055, .4, .055], [0, 0, 0], undefined, false);
    }
    for (let row = 0; row < Math.floor(height / .26); row++) for (const dx of [-.19, 0, .19])
      part(cube, cityWindow, [x + dx, floorY + .76 + row * .26, z - .196], [.075, .12, .008], [0, 0, 0], undefined, false);
  }

  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.parts.length); mesh.name = `gfx31-${batch.cast ? 'shadow' : 'detail'}-batch`;
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
    batch.parts.forEach((p, index) => {
      quaternion.setFromEuler(new THREE.Euler(...p.rotation)); matrix.compose(new THREE.Vector3(...p.position), quaternion, new THREE.Vector3(...p.size));
      mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, p.color ?? new THREE.Color(0xffffff));
    });
    mesh.castShadow = batch.cast; mesh.receiveShadow = true; mesh.computeBoundingSphere(); group.add(mesh);
    if ([cityStone, cityGlass, cityWindow].includes(batch.material as THREE.MeshStandardMaterial)) {
      mesh.name = 'distant-skyline'; mesh.receiveShadow = false; mesh.raycast = THREE.InstancedMesh.prototype.raycast;
    }
  }
  root.add(group);
  return {
    group, solidBounds,
    cleanup() {
      if (disposed) return; disposed = true; group.removeFromParent();
      group.traverse(object => { if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose(); });
      for (const entry of transforms) { entry.object.position.copy(entry.position); entry.object.scale.copy(entry.scale); }
      for (const entry of assignments) entry.mesh.material = entry.original;
      for (const object of hidden) object.visible = true;
      for (const geometry of geometries) geometry.dispose(); for (const mat of materials) mat.dispose(); group.clear();
    },
  };
}
