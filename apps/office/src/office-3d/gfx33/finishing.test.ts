import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { recessElevator } from './elevator';
import { createBotanicalPalette } from './botanical';
import { createAmbientContacts } from './contacts';
import type { PremiumArchitecture } from '../gfx29/architecture';

describe('GFX33 actual geometry and ownership',()=>{
 it('recesses the real GLB frame and doors, preserving anchor, pivot, source and call-panel access',async()=>{
  const bytes=await readFile(new URL('../../../public/office-art/v1/office-pack.glb',import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const root=new T.Group();
  for(const id of ['elevator.cabin','elevator.frame','elevator.doors','elevator.call-panel','elevator.display']){
   const object=gltf.scene.getObjectByName(id.replace(/\./g,''))!.clone(true);object.position.set(-11.76,.12,3);object.rotation.y=-Math.PI/2;object.userData.officeAssetId=id;root.add(object);
  }
  const doors=root.children.find(o=>o.userData.officeAssetId==='elevator.doors')!,frame=root.children.find(o=>o.userData.officeAssetId==='elevator.frame')!;
  const transforms:string[]=[],sources:T.BufferGeometry[]=[];
  root.traverse(o=>{transforms.push(JSON.stringify([o.position.toArray(),o.quaternion.toArray(),o.userData]));if((o as T.Mesh).isMesh)sources.push((o as T.Mesh).geometry);});
  const sourcePositions=sources.map(g=>Array.from(g.getAttribute('position').array));let sourceDisposals=0;sources.forEach(g=>g.addEventListener('dispose',()=>sourceDisposals++));
  const before=new T.Box3().setFromObject(frame),pass=recessElevator(root),after=new T.Box3().setFromObject(frame);
  expect(before.max.x).toBeCloseTo(-10.704,3);expect(after.max.x).toBeCloseTo(-10.7936,3);
  expect(new T.Box3().setFromObject(doors).max.x).toBeLessThan(-10.8);
  expect(new T.Box3().setFromObject(root.children.find(o=>o.userData.officeAssetId==='elevator.call-panel')!).max.x).toBeGreaterThan(-10.8);
  const next:string[]=[];root.traverse(o=>next.push(JSON.stringify([o.position.toArray(),o.quaternion.toArray(),o.userData])));expect(next).toEqual(transforms);
  sources.forEach((g,i)=>expect(Array.from(g.getAttribute('position').array)).toEqual(sourcePositions[i]));
  pass.cleanup();pass.cleanup();expect(sourceDisposals).toBe(0);expect(new T.Box3().setFromObject(frame).max.x).toBeCloseTo(before.max.x,5);
 });
 it('shares bounded curved leaves and planters between varied silhouettes',()=>{
  const palette=createBotanicalPalette(),used=new Set<T.BufferGeometry>();let parts=0;
  for(let style=0;style<3;style++)palette.plant((g,m,p,s)=>{used.add(g);expect(p.every(Number.isFinite)&&s.every(v=>v>0)).toBe(true);parts++;},0,0,0,1,style);
  expect(used.size).toBe(6);expect(parts).toBeGreaterThan(60);
  const widths=palette.geometries.slice(0,3).map(g=>{g.computeBoundingBox();expect(Array.from(g.getAttribute('normal').array).every(Number.isFinite)).toBe(true);return g.boundingBox!.getSize(new T.Vector3()).x;});
  expect(widths[1]).toBeLessThan(widths[0]);palette.geometries.forEach(g=>g.dispose());palette.materials.forEach(m=>m.dispose());
 });
 it('removes contacts and releases its single data texture exactly once',()=>{
  const root=new T.Group(),architecture=new T.Group() as PremiumArchitecture;architecture.assetBounds=[];
  const chair=new T.Group();chair.userData.officeAssetId='chair.ergonomic';root.add(chair);
  const contacts=createAmbientContacts(root,architecture,.12),mesh=root.getObjectByName('gfx33-ambient-contacts') as T.Mesh;
  let released=0;((mesh.material as T.MeshBasicMaterial).alphaMap!).addEventListener('dispose',()=>released++);
  expect(mesh.castShadow).toBe(false);contacts.cleanup();contacts.cleanup();expect(released).toBe(1);expect(root.children).toEqual([chair]);
 });
});
