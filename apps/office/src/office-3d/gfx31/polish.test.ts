import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { setFloorWorldUV } from './floor';
import { createVisualPolishV31 } from './polish';
import type { PremiumArchitecture } from '../gfx29/architecture';
import type { SetName } from '../gfx30/materials';

describe('production visual polish ownership', () => {
  it('restores borrowed assets and releases only its own GPU allocations, once', () => {
    const root = new THREE.Group(), architecture = new THREE.Group() as PremiumArchitecture;
    root.add(architecture);
    const original = new THREE.Group(); original.name = 'sill-plant--6.55'; architecture.add(original);
    const chair = new THREE.Group(); chair.name = 'meeting-chair-test'; architecture.add(chair);
    const geometry = new THREE.BoxGeometry(), source = new THREE.MeshStandardMaterial();
    const fabric = new THREE.Mesh(geometry, source); fabric.name = 'fabric'; chair.add(fabric);
    const palette = new Map<SetName, THREE.MeshStandardMaterial>();
    let borrowedDisposals = 0, ownedDisposals = 0;
    geometry.addEventListener('dispose', () => borrowedDisposals++);
    source.addEventListener('dispose', () => borrowedDisposals++);
    const polish = createVisualPolishV31({ root, architecture, floorY: .12, material(name) {
      let mat = palette.get(name);
      if (!mat) { mat = new THREE.MeshStandardMaterial(); mat.addEventListener('dispose', () => borrowedDisposals++); palette.set(name, mat); }
      return mat;
    } });
    const owned = new Set<THREE.BufferGeometry>();
    polish.group.traverse(o => { if ((o as THREE.Mesh).isMesh) owned.add((o as THREE.Mesh).geometry); });
    for (const g of owned) g.addEventListener('dispose', () => ownedDisposals++);
    expect(original.visible).toBe(false); expect(fabric.material).not.toBe(source);
    polish.cleanup(); polish.cleanup();
    expect(original.visible).toBe(true); expect(fabric.material).toBe(source);
    expect(polish.group.parent).toBeNull(); expect(ownedDisposals).toBe(owned.size);
    expect(borrowedDisposals).toBe(0);
    geometry.dispose(); source.dispose(); for (const mat of palette.values()) mat.dispose();
  });

  it('projects floor UVs from physical world axes even on a rotated source mesh', () => {
    const geometry = new THREE.PlaneGeometry(22, 14);
    const matrix = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const bounds = new THREE.Box3(new THREE.Vector3(-11, 0, -7), new THREE.Vector3(11, 0, 7));
    const normals = Array.from(geometry.getAttribute('normal').array);
    setFloorWorldUV(geometry, matrix, bounds);
    const uv = geometry.getAttribute('uv');
    expect([uv.getX(0), uv.getX(1)]).toEqual([0, 1]);
    expect(uv.getY(0)).toBeCloseTo(0); expect(uv.getY(2)).toBeCloseTo(1);
    expect(Array.from(geometry.getAttribute('normal').array)).toEqual(normals);
    geometry.dispose();
  });
});
