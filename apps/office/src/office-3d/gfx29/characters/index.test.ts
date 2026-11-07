import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {createPremiumCharacter} from './index';
import { showroomEmployees, showroomLayout } from '../../scene-data';
const data={employeeId:'emp-1',deskId:'desk-1',status:'working' as const};
describe('premium characters',()=>{
 it('preserves identity and appearance through status and desk changes',()=>{const a=createPremiumCharacter(data),b=createPremiumCharacter(data); expect(a.userData.appearance).toEqual(b.userData.appearance); const appearance=JSON.stringify(a.userData.appearance); a.updateData({...data,deskId:'desk-2',status:'idle'}); expect(a.userData).toMatchObject({employeeId:'emp-1',deskId:'desk-2',status:'idle'});expect(JSON.stringify(a.userData.appearance)).toBe(appearance);expect(()=>a.updateData({...data,employeeId:'other'})).toThrow();a.dispose();b.dispose();});
 it('animates on shared time and stops cleanly',()=>{const a=createPremiumCharacter(data);expect(a.updateAnimation(1)).toBe(true);expect(a.updateAnimation(1)).toBe(false);expect(a.updateAnimation(2,{reducedMotion:true})).toBe(true);expect(a.updateAnimation(3,{reducedMotion:true})).toBe(false);expect(a.updateAnimation(4,{enabled:false})).toBe(false);a.dispose();});
 it('provides semantic ownership and disposes geometries once',()=>{const a=createPremiumCharacter(data); const face=a.getObjectByName('nose') as THREE.Mesh;expect(face.parent?.parent).toBe(a);expect(a.userData.employeeId).toBe('emp-1');const spy=vi.spyOn(face.geometry,'dispose');a.dispose();a.dispose();expect(spy).toHaveBeenCalledTimes(1);});
 it('maps the eleven showroom employees to their assigned chairs',()=>{const employees=showroomEmployees(), layout=showroomLayout();expect(employees).toHaveLength(11); expect(new Set(employees.map(e=>e.employeeId)).size).toBe(11); for(const employee of employees){expect(layout.desks.find(d=>d.deskId===employee.deskId)?.occupiedBy).toBe(employee.employeeId); expect(layout.chairs.find(c=>c.deskId===employee.deskId)).toBeDefined();}});
});
