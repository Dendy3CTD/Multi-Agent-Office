import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ScenePalette, rememberMaterialRoles } from './lighting';

describe('scene-local comfort palette', () => {
  it('shares scene overrides without changing GLB materials or color textures', () => {
    const map=new THREE.Texture();map.colorSpace=THREE.SRGBColorSpace;
    const source=new THREE.MeshStandardMaterial({name:'oak',color:new THREE.Color(.74,.62,.44),roughness:.72,map});
    const original=source.color.clone(),a=new THREE.Mesh(new THREE.BoxGeometry(),source),b=a.clone();
    rememberMaterialRoles(a);rememberMaterialRoles(b);
    const palette=new ScenePalette();palette.apply(a,'floor.oak.light');palette.apply(b,'floor.oak.light');
    const floor=a.material as THREE.MeshStandardMaterial;
    const once=floor.color.clone();palette.apply(a,'floor.oak.light');expect((a.material as THREE.MeshStandardMaterial).color).toEqual(once);
    expect(floor).not.toBe(source);expect(b.material).toBe(floor);expect(source.color).toEqual(original);expect(source.map).toBe(map);
    expect(floor.color.r/floor.color.b).toBeLessThan(original.r/original.b);expect(floor.roughness).toBeGreaterThan(source.roughness);
    expect(floor.map?.colorSpace).toBe(THREE.SRGBColorSpace);expect(floor.bumpMap).not.toBe(map);expect(floor.bumpMap?.colorSpace).toBe(THREE.NoColorSpace);
    const disposeSource=vi.spyOn(source,'dispose'),disposeMap=vi.spyOn(map,'dispose'),disposeBump=vi.spyOn(floor.bumpMap!,'dispose');
    palette.dispose();expect(disposeSource).not.toHaveBeenCalled();expect(disposeMap).not.toHaveBeenCalled();expect(disposeBump).toHaveBeenCalledOnce();
  });
  it('retains transparency, sidedness and monitor/skin colors', () => {
    const palette=new ScenePalette();
    for(const name of ['glass','darkglass','skin']) {
      const source=new THREE.MeshStandardMaterial({name,color:0x839c92,transparent:true,opacity:.22,side:THREE.DoubleSide});
      const object=new THREE.Mesh(new THREE.BoxGeometry(),source);rememberMaterialRoles(object);palette.apply(object,'window.frame');
      const result=object.material as THREE.MeshStandardMaterial;
      expect(result.color).toEqual(source.color);expect(result.opacity).toBe(source.opacity);expect(result.side).toBe(source.side);
    }
    palette.dispose();
  });
  it('moderates but preserves local lamp emission', () => {
    const source=new THREE.MeshStandardMaterial({name:'amber',emissive:0xff8844,emissiveIntensity:1});
    const object=new THREE.Mesh(new THREE.BoxGeometry(),source),palette=new ScenePalette();rememberMaterialRoles(object);palette.apply(object,'desk.lamp');
    const result=object.material as THREE.MeshStandardMaterial;
    expect(result.emissive).toEqual(source.emissive);expect(result.emissiveIntensity).toBeGreaterThan(0);expect(result.emissiveIntensity).toBeLessThan(source.emissiveIntensity);
    palette.dispose();
  });
});
