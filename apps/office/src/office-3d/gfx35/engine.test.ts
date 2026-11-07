import {readFile} from 'node:fs/promises';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createArtCharacter} from '../gfx32/characters';
import {showroomLayout,showroomSeats,showroomEmployees} from '../scene-data';
import {createPremiumArchitectureV29,type PremiumArchitecture} from '../gfx29/architecture';
import {createVisualPolishV31} from '../gfx31/polish';
import {buildNavigationCatalog} from '../gfx34/navigation';
import {AnimationScheduler} from './animation-scheduler';
import {canTransition} from './pose-controller';
import {joinCatalogRoutes,excursionPaths,clearSegment} from './navigation-adapter';
import {PathFollower} from './locomotion';
import {JOINTS} from './character-rig';
import type {NavigationCatalog,RiggedObject,LocalActor} from './types';
let root:T.Group,architecture:PremiumArchitecture,catalog:NavigationCatalog,polish:ReturnType<typeof createVisualPolishV31>;
const materials=new Map<string,T.MeshStandardMaterial>();
beforeAll(async()=>{
 const bytes=await readFile(new URL('../../../public/office-art/v1/office-pack.glb',import.meta.url)),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const clone=(id:string)=>{const object=gltf.scene.getObjectByName(id.replace(/\./g,''))!.clone(true);object.userData.officeAssetId=id;return object;};
 architecture=await createPremiumArchitectureV29({floorBounds:{minX:-11,maxX:11,minZ:-7,maxZ:7},occupiedWorkplaces:showroomSeats(),cloneAsset:clone,strictPlacement:true});root=new T.Group();root.add(architecture);
 for(const chair of showroomLayout().chairs){const object=clone('chair.ergonomic');object.position.set(chair.position.x-11,.12,chair.position.z-7);object.userData.deskId=chair.deskId;root.add(object);}
 for(const employee of showroomEmployees()){const object=new T.Group();object.userData={employeeId:employee.employeeId,deskId:employee.deskId};root.add(object);}
 polish=createVisualPolishV31({root,architecture,floorY:.12,material(name){let m=materials.get(name);if(!m){m=new T.MeshStandardMaterial();materials.set(name,m);}return m;}});
 catalog=buildNavigationCatalog(showroomLayout(),root,architecture,polish.solidBounds,.12);
});
afterAll(()=>{polish.cleanup();architecture.dispose();materials.forEach(m=>m.dispose());});
function simulation(){return new AnimationScheduler({catalog,obstacles:[...architecture.diagnostics.obstacles,...polish.solidBounds],floorY:.12,maxMoving:1});}
function actor(id='employee-001',deskId='desk-floor-2-01'):LocalActor{
 const seat=catalog.seats.find(s=>s.deskId===deskId)!,object=createArtCharacter({employeeId:id,deskId,status:'working'},undefined,true) as unknown as RiggedObject;
 object.position.set(seat.chair.x,.12,seat.chair.z);const chair=new T.Group();chair.position.copy(object.position);return {employeeId:id,deskId,object,chair};
}
const lounge=()=>{const b=architecture.assetBounds.find(a=>a.key==='lounge-chair')!.bounds;return {minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z};};
function finish(s:AnimationScheduler){for(let i=0;i<2400&&s.active;i++)s.step(.05);expect(s.active).toBe(false);}
function release(s:AnimationScheduler,...a:LocalActor[]){s.dispose();a.forEach(actor=>actor.object.dispose?.());}

describe('local living-office engine',()=>{
 it('allows anatomical transitions and rejects incompatible seated/walking states',()=>{expect(canTransition('SEATED_TYPING','WALKING')).toBe(false);expect(canTransition('SEATED_TYPING','STAND_UP')).toBe(true);expect(canTransition('STAND_UP','STANDING_IDLE')).toBe(true);expect(canTransition('LOUNGE_IDLE','STAND_UP')).toBe(true);});
 it('keeps a normalized GPU skin palette and changes real vertices when standing',()=>{
  const a=actor(),mesh=a.object.children[0] as T.SkinnedMesh,weights=mesh.geometry.getAttribute('skinWeight'),index=mesh.geometry.getAttribute('skinIndex');
  let foot=-1;for(let i=0;i<index.count;i++){expect(weights.getX(i)+weights.getY(i)).toBeCloseTo(1);if(index.getX(i)===JOINTS.leftFoot)foot=i;}
  const before=mesh.getVertexPosition(foot,new T.Vector3()).clone();a.object.rig35!.apply({stand:1,gait:0,walking:false,typing:0,thinking:0,time:0,head:0});
  const after=mesh.getVertexPosition(foot,new T.Vector3());expect(after.distanceTo(before)).toBeGreaterThan(.2);expect(after.y).toBeGreaterThanOrEqual(-.01);a.object.dispose?.();
 });
 it('uses the existing 20 routes, validates connectors and refuses missing paths',()=>{
  expect(catalog.routes).toHaveLength(20);const points=joinCatalogRoutes(catalog,'desk-floor-2-01','lounge-entry');expect(points.length).toBeGreaterThan(10);
  expect(()=>joinCatalogRoutes(catalog,'missing','lounge-entry')).toThrow('missing_animation_route');
  const paths=excursionPaths(catalog,'desk-floor-2-01',[...architecture.diagnostics.obstacles,...polish.solidBounds],lounge());expect(paths.walk.length).toBeGreaterThan(points.length);
  expect(clearSegment({x:0,z:0},{x:2,z:0},[{id:'wall',minX:.5,maxX:1,minZ:-1,maxZ:1}])).toBe(false);
 });
 it('completes a genuine desk/lounge/desk sequence on one object and retains status',()=>{
  const s=simulation(),a=actor(),object=a.object,c=s.add(a);expect(s.startExcursion(a.employeeId,lounge())).toBe(true);finish(s);
  expect(c.actor.object).toBe(object);expect(c.snapshot.position[0]).toBeCloseTo(catalog.seats[0].chair.x);expect(c.snapshot.position[2]).toBeCloseTo(catalog.seats[0].chair.z);
  expect(c.state).toBe('SEATED_TYPING');expect(c.completed).toBe(true);expect(c.history.some(h=>h.state==='LOUNGE_IDLE')).toBe(true);expect(object.userData.status).toBe('working');release(s,a);
 });
 it('rejects duplicate employee controllers and reserves shared corridors',()=>{
  const s=simulation(),a=actor(),b=actor('employee-002','desk-floor-2-02');s.add(a);s.add(b);expect(()=>s.add(a)).toThrow('duplicate');
  expect(s.startExcursion(a.employeeId,lounge())).toBe(true);expect(s.startExcursion(b.employeeId,lounge())).toBe(false);expect(s.activity(b.employeeId,'SEATED_TYPING',5)).toBe(true);s.advance(1);expect(s.controllers.get(b.employeeId)!.state).toBe('SEATED_TYPING');release(s,a,b);
 });
 it('cancels movement without teleporting and safely retraces to the desk',()=>{
  const s=simulation(),a=actor(),c=s.add(a);s.startExcursion(a.employeeId,lounge());s.advance(9);const position=a.object.position.clone();s.cancel(a.employeeId);s.advance(4);expect(a.object.position.distanceTo(position)).toBe(0);expect(s.active).toBe(false);
  expect(s.returnToDesk(a.employeeId)).toBe(true);finish(s);expect(c.state).toBe('SEATED_TYPING');expect(a.object.position.z).toBeCloseTo(catalog.seats[0].chair.z);release(s,a);
 });
 it('clamps large delta, pauses hidden time, and restores without a time jump',()=>{
  const s=simulation(),a=actor(),c=s.add(a);s.activity(a.employeeId,'SEATED_TYPING',3);s.tick(0);s.tick(100000);expect(c.time).toBeCloseTo(.05);s.setHidden(true);s.tick(200000);expect(c.time).toBeCloseTo(.05);s.setHidden(false);s.tick(300000);expect(c.time).toBeCloseTo(.05);release(s,a);
 });
 it('disables optional motion and scheduling under reduced motion and disposes cleanly',()=>{
  const s=simulation(),a=actor();s.add(a);s.startExcursion(a.employeeId,lounge());s.setReducedMotion(true);const p=a.object.position.clone();s.advance(5);expect(a.object.position.distanceTo(p)).toBe(0);expect(s.active).toBe(false);expect(s.startExcursion(a.employeeId,lounge())).toBe(false);release(s,a);expect(s.controllers.size).toBe(0);expect(s.step(.05)).toBe(false);
 });
 it('is deterministic with fixed time and ID',()=>{
  const first=simulation(),second=simulation(),a=actor(),b=actor();first.add(a);second.add(b);first.startExcursion(a.employeeId,lounge());second.startExcursion(b.employeeId,lounge());first.advance(10);second.advance(10);expect(first.snapshot.actors).toEqual(second.snapshot.actors);release(first,a);release(second,b);
 });
 it('reaches the exact last waypoint and supports interruption without overshoot',()=>{
  const path=new PathFollower([{x:0,z:0},{x:1,z:0},{x:1,z:1}],1),position={x:0,z:0};for(let i=0;i<50;i++)path.update(position,.05,()=>true);expect(path.done).toBe(true);expect(position).toEqual({x:1,z:1});
 });
 it('stops a blocked route safely instead of rendering a stationary walker forever',()=>{
  const s=simulation(),a=actor(),c=s.add(a);s.startExcursion(a.employeeId,lounge());
  for(let i=0;i<150&&c.state!=='WALKING';i++)s.step(.05);
  const position=a.object.position.clone();for(let i=0;i<45;i++)c.update(.05,()=>false);
  expect(c.active).toBe(false);expect(c.snapshot.stopReason).toBe('movement_blocked');expect(a.object.position.distanceTo(position)).toBe(0);release(s,a);
 });
 it('rejects invalid authored queues atomically, including discontinuous path starts',()=>{
  const s=simulation(),a=actor(),c=s.add(a);
  expect(()=>c.enqueue([{state:'WALKING',path:[{x:0,z:0},{x:1,z:0}]}])).toThrow('invalid_animation_transition');
  expect(c.active).toBe(false);
  expect(()=>c.enqueue([{state:'STAND_UP',duration:1},{state:'STANDING_IDLE',duration:.1},{state:'WALKING',path:[{x:0,z:0},{x:1,z:0}]}])).toThrow('path_start_mismatch');
  expect(c.active).toBe(false);expect(c.state).toBe('SEATED_IDLE');release(s,a);
 });
 it('will not restart an excursion from a cancelled location in the aisle',()=>{
  const s=simulation(),a=actor();s.add(a);s.startExcursion(a.employeeId,lounge());s.advance(9);s.cancel(a.employeeId);expect(s.startExcursion(a.employeeId,lounge())).toBe(false);release(s,a);
 });
 it('rejects unavailable cup attachment without producing a fake drinking action',()=>{
  const s=simulation(),a=actor(),c=s.add(a);expect(c.request('SEATED_DRINKING')).toBe(false);expect(()=>c.enqueue([{state:'SEATED_DRINKING',duration:2}])).toThrow('cup_attachment');expect(c.active).toBe(false);release(s,a);
 });
 it('has no model/network/process entry points in the simulation runtime modules',async()=>{
  for(const file of ['animation-controller.ts','animation-scheduler.ts','character-rig.ts','locomotion.ts','navigation-adapter.ts','pose-controller.ts','demo-scenarios.ts']){const source=await readFile(new URL(file,import.meta.url),'utf8');expect(source).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|setInterval|requestAnimationFrame)\s*\(|child_process|openai\/|runtime-opencode/);}
 });
});
