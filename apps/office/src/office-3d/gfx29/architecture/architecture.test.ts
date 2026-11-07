import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createOfficeArtRuntime } from '../../../office-art';
import { showroomSeats } from '../../scene-data';
import { createPremiumArchitectureV29, createArchitectureAssetAdapter } from './index';
import { diagnoseArchitecture, workplaceRect } from './navigation';
const floorBounds={minX:-11,maxX:11,minZ:-7,maxZ:7};
async function realRuntime(){
  const root=new URL('../../../../public/office-art/v1/',import.meta.url),raw=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  const bytes=await readFile(new URL('office-pack.glb',root)),document=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const manifest={...raw,assets:raw.assets.map((a:any)=>({...a,node:a.node?.replace(/\./g,'')}))};
  return createOfficeArtRuntime({manifest,modelLoader:async()=>document,fetcher:async()=>({ok:true,json:async()=>JSON.parse(await readFile(new URL('materials.json',root),'utf8'))}),textureLoader:async()=>new THREE.Texture()});
}
describe('real GFX29 GLB architecture',()=>{
  it('loads genuine models at support planes, preserves identities and routes to 12 places/11 employees',async()=>{
    const runtime=await realRuntime(),seats=showroomSeats(),snapshot=JSON.stringify(seats),g=await createPremiumArchitectureV29({floorBounds,occupiedWorkplaces:seats,...createArchitectureAssetAdapter(runtime)});
    expect(g.diagnostics.issues).toEqual([]);expect(g.diagnostics.workplaceCount).toBe(12);expect(g.diagnostics.employeeCount).toBe(11);expect(g.diagnostics.routes).toHaveLength(15);expect(g.diagnostics.routes.every(r=>r.reachable)).toBe(true);expect(JSON.stringify(seats)).toBe(snapshot);
    const byKey=(k:string)=>g.assetBounds.find(a=>a.key===k)!;expect(byKey('lounge-sofa').size[2]).toBeCloseTo(3.375,2);expect(byKey('meeting-table').size[0]).toBeCloseTo(3.136,2);
    for(const a of g.assetBounds)expect(a.bounds.min.y).toBeCloseTo(a.supportY,5);
    expect(byKey('meeting-rug').bounds.min.y).toBeGreaterThan(.12);expect(byKey('lounge-rug').bounds.max.y).toBeLessThan(byKey('lounge-sofa').bounds.min.y);
    expect(g.assetBounds.every(a=>a.bounds.min.x>=-11&&a.bounds.max.x<=11&&a.bounds.min.z>=-7&&a.bounds.max.z<=7)).toBe(true);
    let oakTop=false;g.getObjectByName('meeting-table')!.traverse(n=>{const m=n as THREE.Mesh;if(m.isMesh&&!Array.isArray(m.material)&&m.material.name==='architecture-oak')oakTop=true;});expect(oakTop).toBe(true);g.dispose();g.dispose();expect(()=>runtime.disposeSharedResources()).not.toThrow();
  });
  it('diagnoses exact workplace conflicts and strict failure releases runtime references',async()=>{
    const runtime=await realRuntime(),occupiedWorkplaces=[{deskId:'do-not-rename',employeeId:'employee-original',x:-10,z:-4.35}],g=await createPremiumArchitectureV29({floorBounds,occupiedWorkplaces,...createArchitectureAssetAdapter(runtime)});
    expect(g.diagnostics.valid).toBe(false);expect(g.diagnostics.issues.some(i=>i.code==='workplace_collision'&&i.otherId==='do-not-rename'&&Number.isFinite(i.x))).toBe(true);g.dispose();runtime.disposeSharedResources();
    const r=await realRuntime();await expect(createPremiumArchitectureV29({floorBounds,occupiedWorkplaces,strictPlacement:true,...createArchitectureAssetAdapter(r)})).rejects.toMatchObject({code:'architecture_placement_conflict'});expect(()=>r.disposeSharedResources()).not.toThrow();
  });
  it('supports translated bounds and world-space seats',async()=>{
    const runtime=await realRuntime(),occupiedWorkplaces=showroomSeats().map(w=>({...w,x:w.x+30,z:w.z-20})),g=await createPremiumArchitectureV29({floorBounds:{minX:19,maxX:41,minZ:-27,maxZ:-13},occupiedWorkplaces,...createArchitectureAssetAdapter(runtime)});expect(g.position.toArray()).toEqual([30,0,-20]);expect(g.diagnostics.valid).toBe(true);g.dispose();runtime.disposeSharedResources();
  });
});
describe('radius-aware navigation diagnostics',()=>{
  it('detects a real blocked passage',()=>{
    const r=diagnoseArchitecture(floorBounds,[],[{id:'barrier',minX:-11,maxX:11,minZ:0,maxZ:.3}],{id:'lift',minX:-2,maxX:-1,minZ:-2,maxZ:-1},[{id:'meeting',x:4,z:4}],{x:0,z:-4});expect(r.routes[0].reachable).toBe(false);expect(r.issues).toContainEqual({code:'unreachable',id:'meeting',x:4,z:4});
  });
  it('detects outside bounds, overlapping seats and obstructed elevator',()=>{
    const r=diagnoseArchitecture(floorBounds,[{deskId:'a',x:0,z:0},{deskId:'b',x:0,z:0}],[{id:'lounge',minX:-12,maxX:-10,minZ:0,maxZ:1}],{id:'lift',...workplaceRect({deskId:'a',x:0,z:0})},[],{x:0,z:0});expect(r.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['outside_floor','workplaces_overlap','workplace_elevator_collision','elevator_approach_blocked']));
  });
});
