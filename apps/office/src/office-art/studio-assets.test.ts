import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, it, expect } from 'vitest';
const root=resolve(process.cwd(),'public/office-art');
const bytes=readFileSync(resolve(root,'v1/office-pack.glb'));
const json=(data:Buffer)=>JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
const current=json(bytes),before=json(readFileSync(resolve(root,'studio-29/before/office-pack.glb')));
describe('GFX-29 studio production contracts',()=>{
 it('retains all 74 GFX-28 asset IDs and exact door pivots/extras',()=>{
  const manifest=JSON.parse(readFileSync(resolve(root,'v1/manifest.json'),'utf8'));
  const old=JSON.parse(readFileSync(resolve(root,'studio-29/before/manifest.json'),'utf8'));
  expect(old.assets).toHaveLength(74);
  for(const asset of old.assets)expect(manifest.assets.some((a:any)=>a.id===asset.id)).toBe(true);
  for(const name of ['elevator.doors.left','elevator.doors.right']){
   const a=current.nodes.find((n:any)=>n.name===name),b=before.nodes.find((n:any)=>n.name===name);
   expect(a.translation).toEqual(b.translation);expect(a.rotation).toEqual(b.rotation);expect(a.scale).toEqual(b.scale);expect(a.extras).toEqual(b.extras);
  }
 });
 it('has actual cable apertures through the oak tabletop',async()=>{
  const document=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const desk=document.scene.getObjectByName('deskmodern')!;desk.updateMatrixWorld(true);
  for(const x of [-.5,.5]){
   const ray=new THREE.Raycaster(new THREE.Vector3(x,2,.21),new THREE.Vector3(0,-1,0));
   const wood=ray.intersectObject(desk,true).filter(hit=>(hit.object as THREE.Mesh).material && ((hit.object as THREE.Mesh).material as THREE.Material).name==='oak');
   expect(wood).toHaveLength(0);
  }
  expect(new THREE.Raycaster(new THREE.Vector3(0,2,.22),new THREE.Vector3(0,-1,0)).intersectObject(desk,true).length).toBeGreaterThan(0);
 });
 it('keeps embedded opening animation endpoints and compact geometry budget',()=>{
  const animation=current.animations.find((a:any)=>a.name==='elevator.doors.open');expect(animation.channels).toHaveLength(2);
  for(const sampler of animation.samplers)expect(current.accessors[sampler.input].count).toBe(current.accessors[sampler.output].count);
  expect(bytes.length).toBeLessThan(2*1024*1024);
 });
});
