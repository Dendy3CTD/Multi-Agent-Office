import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createPremiumArchitectureV29, createArchitectureAssetAdapter, WINDOW_OPENINGS } from './index';
const floorBounds={minX:-11,maxX:11,minZ:-7,maxZ:7},geometry=new THREE.BoxGeometry(.1,.1,.1),material=new THREE.MeshStandardMaterial({name:'oak'});
const cloneAsset=()=>new THREE.Mesh(geometry,material),base={floorBounds,occupiedWorkplaces:[],cloneAsset};
describe('architecture production API',()=>{
  it('raycasts 40 interior/edge points, preserves solid piers and bounded glass',async()=>{
    const g=await createPremiumArchitectureV29(base);g.updateMatrixWorld(true);
    for(const o of WINDOW_OPENINGS)for(const x of [o.minX+.13,o.minX+.45,(o.minX+o.maxX)/2,o.maxX-.45,o.maxX-.13])for(const y of [1.4,2.2,3.4,4.15]){
      const hits=new THREE.Raycaster(new THREE.Vector3(x,y+.12,6.2),new THREE.Vector3(0,0,1)).intersectObject(g,true).map(h=>h.object.name);
      expect(hits).toContain('window-glass');expect(hits).toContain('sky');expect(hits).not.toContain('brick-wall');expect(hits).not.toContain('brick-wall-backing');
    }
    for(const x of [-8,0,8])expect(new THREE.Raycaster(new THREE.Vector3(x,2.2,6.2),new THREE.Vector3(0,0,1)).intersectObject(g,true).some(h=>h.object.name==='brick-wall')).toBe(true);
    const glass=g.getObjectByName('window-glass') as THREE.InstancedMesh;expect(glass.count).toBe(2);
    for(let i=0;i<2;i++){const m=new THREE.Matrix4();glass.getMatrixAt(i,m);const unit=new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5)).applyMatrix4(m);expect(unit.min.x).toBeGreaterThan(WINDOW_OPENINGS[i].minX);expect(unit.max.x).toBeLessThan(WINDOW_OPENINGS[i].maxX);}
    g.dispose();
  });
  it('batches static pieces and disposes own buffers/resources once',async()=>{
    const releaseAsset=vi.fn(),g=await createPremiumArchitectureV29({...base,releaseAsset});const brick=g.getObjectByName('brick-wall') as THREE.InstancedMesh,dispose=vi.spyOn(brick.geometry,'dispose'),instanceDispose=vi.spyOn(brick,'dispose'),shared=vi.spyOn(geometry,'dispose');
    expect(brick.isInstancedMesh).toBe(true);expect(brick.count).toBeGreaterThan(800);expect(g.children.filter(n=>(n as THREE.InstancedMesh).isInstancedMesh).length).toBeLessThan(25);
    const count=g.assetBounds.length;g.dispose();g.dispose();expect(releaseAsset).toHaveBeenCalledTimes(count);expect(dispose).toHaveBeenCalledOnce();expect(instanceDispose).toHaveBeenCalledOnce();expect(shared).not.toHaveBeenCalled();
  });
  it('validates bounds/workplaces before loading',async()=>{
    const create=vi.fn(cloneAsset);await expect(createPremiumArchitectureV29({...base,floorBounds:{...floorBounds,maxX:0},cloneAsset:create})).rejects.toThrow('22x14');await expect(createPremiumArchitectureV29({...base,occupiedWorkplaces:[{deskId:'a',x:NaN,z:0}],cloneAsset:create})).rejects.toThrow('invalid_workplaces');expect(create).not.toHaveBeenCalled();
  });
  it('rolls back acquired references on missing or failed asset with typed ID',async()=>{
    const releaseAsset=vi.fn();let count=0;await expect(createPremiumArchitectureV29({...base,releaseAsset,cloneAsset:async()=>++count===4?undefined:cloneAsset()})).rejects.toMatchObject({code:'asset_missing',assetId:'chair.meeting'});expect(releaseAsset).toHaveBeenCalledTimes(3);await expect(createPremiumArchitectureV29({...base,cloneAsset:async()=>{throw Error('network');}})).rejects.toMatchObject({code:'asset_load_failed',assetId:'door.office.glass'});
  });
  it('awaits and releases late loads after cancellation',async()=>{
    let resolve!:(object:THREE.Object3D)=>void;const signal=new AbortController(),releaseAsset=vi.fn(),pending=createPremiumArchitectureV29({...base,signal:signal.signal,releaseAsset,cloneAsset:()=>new Promise(r=>resolve=r)});signal.abort();resolve(cloneAsset());await expect(pending).rejects.toThrow('architecture_aborted');expect(releaseAsset).toHaveBeenCalledOnce();
  });
  it('rejects reused roots instead of reparenting existing furniture',async()=>{
    const a=cloneAsset(),releaseAsset=vi.fn();await expect(createPremiumArchitectureV29({...base,cloneAsset:()=>a,releaseAsset})).rejects.toThrow('not_independent');expect(releaseAsset).toHaveBeenCalledOnce();
  });
  it('adapts awaited runtime material loading, captures roles and releases failed material loads',async()=>{
    const object=cloneAsset(),runtime={createInstance:vi.fn(async()=>object),applyMaterials:vi.fn(async()=>{}),disposeInstance:vi.fn()},adapter=createArchitectureAssetAdapter(runtime);expect(await adapter.cloneAsset('sofa.cozy')).toBe(object);expect(object.userData.maoMaterialRoles).toEqual(['oak']);adapter.releaseAsset!(object);expect(runtime.disposeInstance).toHaveBeenCalledOnce();runtime.applyMaterials.mockRejectedValueOnce(Error('texture'));await expect(adapter.cloneAsset('rug.area')).rejects.toThrow('texture');expect(runtime.disposeInstance).toHaveBeenCalledTimes(2);
  });
});
