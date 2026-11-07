import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { appearanceSeed, createArtCharacter } from './characters';
const data = {employeeId:'employee-001',deskId:'desk-floor-2-01',status:'working' as const};
describe('tailored production characters',()=>{
 it('preserves appearance across status and desk changes, and shares cached geometry safely',()=>{
  const a=createArtCharacter(data), b=createArtCharacter({...data,status:'blocked'});
  expect(a.userData.appearance).toEqual(b.userData.appearance);expect(a.children).toHaveLength(2);
  const geo=(a.children[0] as T.Mesh).geometry;expect(geo).toBe((b.children[0] as T.Mesh).geometry);
  let released=0;geo.addEventListener('dispose',()=>released++);
  a.updateData({...data,deskId:'reserve',status:'idle'});expect(a.userData.appearance.seed).toBe(appearanceSeed(data.employeeId));
  a.dispose();a.dispose();expect(released).toBe(0);b.dispose();expect(released).toBe(1);
 });
 it('has finite sculpted surfaces, floor contact and keyboard-height hands',()=>{
  for(let style=0;style<7;style++){
   const c=createArtCharacter(data,style);const bounds=new T.Box3().setFromObject(c);
   expect(bounds.min.y).toBeGreaterThanOrEqual(0);expect(bounds.max.y).toBeLessThan(1.75);
   for(const mesh of c.children as T.Mesh[]) for(const attr of ['position','normal','color']) expect(Array.from(mesh.geometry.getAttribute(attr).array).every(Number.isFinite)).toBe(true);
   const p=(c.children[0] as T.Mesh).geometry.getAttribute('position');let hand=false;
   for(let i=0;i<p.count;i++)if(p.getZ(i)<-.77 && p.getY(i)>.84 && p.getY(i)<.92)hand=true;
   expect(hand).toBe(true);c.dispose();
  }
 });
 it('restores a static pose under reduced motion and rejects identity mutation',()=>{
  const c=createArtCharacter(data);expect(()=>c.updateData({...data,employeeId:'other'})).toThrow();
  c.updateAnimation(.2,{enabled:true});c.updateAnimation(.2,{reducedMotion:true});
  expect(c.children[1].rotation.y).toBe(0);c.dispose();
 });
});
