import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {showroomLayout,showroomSeats} from '../scene-data';
import {createPremiumArchitectureV29} from '../gfx29/architecture';
import {buildNavigationCatalog} from './navigation';
import {dressGameInterior} from './dressing';
import type {SetName} from '../gfx30/materials';

describe('game-art layout and GFX35 handoff',()=>{
 it('derives every chair/stand point from real GLB and keeps 20 destinations reachable',async()=>{
  const bytes=await readFile(new URL('../../../public/office-art/v1/office-pack.glb',import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const clone=(id:string)=>{const object=gltf.scene.getObjectByName(id.replace(/\./g,''))!.clone(true);object.userData.officeAssetId=id;return object;};
  const architecture=await createPremiumArchitectureV29({floorBounds:{minX:-11,maxX:11,minZ:-7,maxZ:7},occupiedWorkplaces:showroomSeats(),cloneAsset:clone,strictPlacement:true});
  const root=new T.Group(),layout=showroomLayout();root.add(architecture);
  for(const chair of layout.chairs){const object=clone('chair.ergonomic');object.position.set(chair.position.x-11,.12,chair.position.z-7);object.userData.deskId=chair.deskId;root.add(object);}
  for(const desk of layout.desks)if(desk.occupiedBy){const employee=new T.Group();employee.userData={employeeId:desk.occupiedBy,deskId:desk.deskId};root.add(employee);}
  const catalog=buildNavigationCatalog(layout,root,architecture,[],.12);
  expect(catalog.ready).toBe(true);expect(catalog.routes).toHaveLength(20);expect(catalog.routes.every(r=>r.reachable)).toBe(true);
  expect(catalog.seats.filter(s=>s.employeeId)).toHaveLength(11);expect(catalog.seats).toHaveLength(12);
  for(const seat of catalog.seats){const chair=layout.chairs.find(c=>c.deskId===seat.deskId)!;expect(seat.chair.x).toBe(chair.position.x-11);expect(seat.chair.z).toBe(chair.position.z-7);expect(seat.stand.z).toBeGreaterThan(seat.chair.z+.6);}
  const blocked=buildNavigationCatalog(layout,root,architecture,[{id:'temporary-blockade',minX:-11,maxX:11,minZ:-1,maxZ:0}],.12);
  expect(blocked.ready).toBe(false);expect(blocked.issues.some(i=>i.code==='unreachable')).toBe(true);architecture.dispose();
 });
 it('restores borrowed materials and rug maps without disposing shared assets',()=>{
  const root=new T.Group(),desk=new T.Group();desk.userData.officeAssetId='desk.modern';desk.userData.deskId='test';root.add(desk);
  const geometry=new T.BoxGeometry(),original=new T.MeshStandardMaterial(),mesh=new T.Mesh(geometry,original);mesh.name='fabric-blue';desk.add(mesh);
  const palette=new Map<SetName,T.MeshStandardMaterial>(),oldMap=new T.Texture();
  const material=(name:SetName)=>{let m=palette.get(name);if(!m){m=new T.MeshStandardMaterial();palette.set(name,m);}return m;};
  material('ivory-rug').map=oldMap;let borrowed=0;geometry.addEventListener('dispose',()=>borrowed++);oldMap.addEventListener('dispose',()=>borrowed++);palette.forEach(m=>m.addEventListener('dispose',()=>borrowed++));
  const pass=dressGameInterior(root,material,.12),map=material('ivory-rug').map!;let own=0;map.addEventListener('dispose',()=>own++);
  expect(mesh.material).not.toBe(original);pass.cleanup();pass.cleanup();expect(mesh.material).toBe(original);expect(material('ivory-rug').map).toBe(oldMap);expect(borrowed).toBe(0);expect(own).toBe(1);
  geometry.dispose();original.dispose();oldMap.dispose();palette.forEach(m=>m.dispose());
 });
});
