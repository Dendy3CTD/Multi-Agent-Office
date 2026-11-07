import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createPremiumLightingV29, PremiumMaterialPaletteV29 } from './index';
function fixture() {
  const renderer = {toneMapping:THREE.LinearToneMapping,toneMappingExposure:.7,outputColorSpace:THREE.LinearSRGBColorSpace,shadowMap:{enabled:false,type:THREE.BasicShadowMap,autoUpdate:false,needsUpdate:true}} as THREE.WebGLRenderer;
  const scene=new THREE.Scene(),floorRoot=new THREE.Group(),camera=new THREE.OrthographicCamera();scene.add(floorRoot);
  scene.background=new THREE.Color(0x223344);scene.backgroundIntensity=.8;scene.backgroundBlurriness=.2;
  return {renderer,scene,floorRoot,camera};
}
describe('premium lighting lifecycle',()=>{
  it('restores state exactly, preserves camera and foreign lights, handles repeat cleanup/remount',()=>{
    const o=fixture(),bg=o.scene.background,matrix=o.camera.matrixWorld.clone(),previous=new THREE.PointLight();o.scene.add(previous);
    const api=createPremiumLightingV29(o);
    expect(o.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);expect(o.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(Object.values(api.lights).filter(l=>l.castShadow)).toHaveLength(1);expect(api.lights.daylight.shadow.mapSize.x).toBe(2048);
    const dispose=vi.spyOn(api.lights.daylight.shadow,'dispose');expect(o.camera.matrixWorld).toEqual(matrix);
    expect(()=>createPremiumLightingV29(o)).toThrow('already_active');api.setExposure(1.1);expect(o.renderer.toneMappingExposure).toBe(1.1);expect(()=>api.setExposure(NaN)).toThrow();
    api.cleanup();api.cleanup();expect(dispose).toHaveBeenCalledOnce();expect(api.group.parent).toBeNull();expect(api.group.children).toHaveLength(0);expect(previous.parent).toBe(o.scene);
    expect(o.renderer.toneMapping).toBe(THREE.LinearToneMapping);expect(o.renderer.toneMappingExposure).toBe(.7);expect(o.renderer.outputColorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(o.renderer.shadowMap).toEqual({enabled:false,type:THREE.BasicShadowMap,autoUpdate:false,needsUpdate:true});
    expect(o.scene.background).toBe(bg);expect(o.scene.backgroundIntensity).toBe(.8);expect(o.scene.backgroundBlurriness).toBe(.2);
    expect(()=>api.applyMaterials()).toThrow('disposed');createPremiumLightingV29(o).cleanup();
  });
  it('rolls back renderer and lights if caller material resolver throws',()=>{
    const o=fixture(),source=new THREE.MeshStandardMaterial({name:'oak'}),mesh=new THREE.Mesh(new THREE.BoxGeometry(),source);o.floorRoot.add(mesh);
    expect(()=>createPremiumLightingV29({...o,resolveMaterialRole:()=>{throw new Error('bad role');}})).toThrow('bad role');
    expect(o.floorRoot.children).toEqual([mesh]);expect(mesh.material).toBe(source);expect(o.renderer.toneMappingExposure).toBe(.7);
    createPremiumLightingV29(o).cleanup();
  });
  it('validates before mutation and supports 1024 shadows',()=>{
    const o=fixture();expect(()=>createPremiumLightingV29({...o,exposure:Infinity})).toThrow();expect(o.renderer.toneMappingExposure).toBe(.7);
    const api=createPremiumLightingV29({...o,shadowMapSize:1024});expect(api.lights.daylight.shadow.mapSize.x).toBe(1024);api.cleanup();
  });
});
describe('scene material corrections',()=>{
  it('preserves maps, color spaces, UVs, glass properties and resource ownership',()=>{
    const map=new THREE.Texture();map.colorSpace=THREE.SRGBColorSpace;map.repeat.set(2,3);const normalMap=new THREE.Texture();
    const source=new THREE.MeshPhysicalMaterial({name:'glass',map,normalMap,transmission:.6,opacity:.2,transparent:true,side:THREE.DoubleSide,depthWrite:false});
    const a=new THREE.Mesh(new THREE.BoxGeometry(),source),palette=new PremiumMaterialPaletteV29();palette.apply(a);const clone=a.material as THREE.MeshPhysicalMaterial;
    expect(clone).not.toBe(source);expect(clone.map).toBe(map);expect(clone.normalMap).toBe(normalMap);expect(clone.transmission).toBe(.6);expect(clone.opacity).toBe(.2);expect(clone.depthWrite).toBe(false);expect(clone.side).toBe(THREE.DoubleSide);
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);expect(map.repeat.toArray()).toEqual([2,3]);expect(normalMap.colorSpace).toBe(THREE.NoColorSpace);
    const d=vi.spyOn(clone,'dispose'),s=vi.spyOn(source,'dispose'),t=vi.spyOn(map,'dispose');palette.dispose();palette.dispose();expect(a.material).toBe(source);expect(d).toHaveBeenCalledOnce();expect(s).not.toHaveBeenCalled();expect(t).not.toHaveBeenCalled();
  });
  it('shares by source/role, supports arrays and late assets without cumulative grading',()=>{
    const source=new THREE.MeshStandardMaterial({name:'oak',color:0xcba879}),color=source.color.clone();
    const a=new THREE.Mesh(new THREE.BoxGeometry(),[source,source]);a.userData.maoMaterialRoles=['oak','brick'];
    const root=new THREE.Group();root.add(a);const palette=new PremiumMaterialPaletteV29();palette.apply(root);const once=a.material;
    expect(once[0]).not.toBe(once[1]);expect(source.color).toEqual(color);palette.apply(root);expect(a.material).toBe(once);
    const late=new THREE.Mesh(new THREE.BoxGeometry(),source);root.add(late);palette.apply(root);expect(late.material).toBe(once[0]);palette.dispose();expect(a.material).toEqual([source,source]);expect(late.material).toBe(source);
  });
  it('leaves unknown/unlit materials and externally replaced assignments alone',()=>{
    const basic=new THREE.MeshBasicMaterial({name:'metal'}),unknown=new THREE.MeshStandardMaterial({name:'wall'}),a=new THREE.Mesh(new THREE.BoxGeometry(),[basic,unknown]),palette=new PremiumMaterialPaletteV29();palette.apply(a);expect(a.material).toEqual([basic,unknown]);palette.dispose();
    const b=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({name:'skin'})),p=new PremiumMaterialPaletteV29();p.apply(b);b.material=unknown;p.dispose();expect(b.material).toBe(unknown);
  });
  it('retains dark and skin albedos and a diffuse component on metal',()=>{
    for(const name of ['metal','bronze','skin','fabric','clothing']) {
      const source=new THREE.MeshStandardMaterial({name,color:0x20282e,metalness:1,roughness:.1}),a=new THREE.Mesh(new THREE.BoxGeometry(),source),p=new PremiumMaterialPaletteV29();p.apply(a);
      expect(a.material.color).toEqual(source.color);expect(a.material.metalness).toBeLessThanOrEqual(.55);expect(a.material.roughness).toBeGreaterThanOrEqual(.38);p.dispose();
    }
  });
  it('releases detached employees without retaining their cloned palette materials',()=>{
    const source=new THREE.MeshStandardMaterial({name:'skin'}),geometry=new THREE.BoxGeometry(),a=new THREE.Mesh(geometry,source),b=new THREE.Mesh(geometry,source),root=new THREE.Group(),p=new PremiumMaterialPaletteV29();root.add(a,b);p.apply(root);
    const shared=a.material,dispose=vi.spyOn(shared,'dispose'),disposeSource=vi.spyOn(source,'dispose');
    p.release(a);expect(a.material).toBe(source);expect(b.material).toBe(shared);expect(dispose).not.toHaveBeenCalled();
    p.release(b);p.release(b);expect(dispose).toHaveBeenCalledOnce();expect(b.material).toBe(source);
    const c=new THREE.Mesh(geometry,source);p.apply(c);expect(c.material).not.toBe(shared);p.dispose();expect(c.material).toBe(source);expect(disposeSource).not.toHaveBeenCalled();
  });
  it('separates floor oak from furniture grading without changing the runtime source map',()=>{
    const map=new THREE.Texture();map.colorSpace=THREE.SRGBColorSpace;
    const source=new THREE.MeshStandardMaterial({name:'oak',map}),floor=new THREE.Group(),a=new THREE.Mesh(new THREE.BoxGeometry(),source),b=new THREE.Mesh(new THREE.BoxGeometry(),source);floor.userData.officeAssetId='floor.oak.light';floor.add(a);
    const p=new PremiumMaterialPaletteV29();p.apply(floor);p.apply(b);expect(a.material).not.toBe(b.material);expect(a.material.map).toBe(map);expect(b.material.map).toBe(map);expect(a.material.roughness).toBeGreaterThanOrEqual(.82);expect(map.colorSpace).toBe(THREE.SRGBColorSpace);p.dispose();expect(a.material).toBe(source);expect(b.material).toBe(source);
  });

});
