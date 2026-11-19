import * as T from 'three';
import type { FloorLayout } from '../../office-layout';
import type { PremiumArchitecture } from '../gfx29/architecture';
import { diagnoseArchitecture, type Obstacle } from '../gfx29/architecture/navigation';
/** Snapshot of the authoritative layout and acquired geometry, never a second layout. */
export function buildNavigationCatalog(layout:FloorLayout,root:T.Group,architecture:PremiumArchitecture,extra:Obstacle[],floorY:number) {
  root.updateWorldMatrix(true,true);
  const point=(x:number,z:number)=>({x,y:floorY,z});
  const seats=layout.desks.map(desk=>{
    const chair=root.children.find(o=>o.userData.officeAssetId==='chair.ergonomic'&&o.userData.deskId===desk.deskId);
    if(!chair)throw new Error(`navigation_missing_chair:${desk.deskId}`);
    const bounds=new T.Box3().setFromObject(chair),center=bounds.getCenter(new T.Vector3());
    return {deskId:desk.deskId,employeeId:root.children.find(o=>o.userData.employeeId&&o.userData.deskId===desk.deskId)?.userData.employeeId as string | undefined,chair:point(chair.position.x,chair.position.z),stand:point(center.x,bounds.max.z+.4),desk:point(desk.position.x-layout.size.width/2,desk.position.z-layout.size.depth/2)};
  });
  const meeting=architecture.assetBounds.filter(a=>a.key.startsWith('meeting-chair-')).map(a=>{
    const center=a.bounds.getCenter(new T.Vector3());return {id:a.key,seat:point(center.x,center.z),approach:point(center.x<7.15?5.05:8.6,center.z)};
  });
  const lounge=architecture.assetBounds.filter(a=>a.key==='lounge-sofa'||a.key==='lounge-chair').map(a=>({id:a.key,seat:point(a.bounds.getCenter(new T.Vector3()).x,a.bounds.getCenter(new T.Vector3()).z)}));
  const destinations=[{id:'meeting-entry',x:3.65,z:-2.95},{id:'meeting-interior',x:5.5,z:-2.6},{id:'lounge-entry',x:-6.2,z:-5.9},{id:'elevator-wait',x:-8.1,z:3.0},...meeting.map(a=>({id:`approach:${a.id}`,x:a.approach.x,z:a.approach.z}))];
  const ids=new Set(seats.map(s=>s.deskId)),obstacles=architecture.diagnostics.obstacles.filter(o=>!ids.has(o.id)&&o.id!=='physical-elevator');
  const elevator=architecture.diagnostics.obstacles.find(o=>o.id==='physical-elevator')!;
  const diagnostics=diagnoseArchitecture({minX:-11,maxX:11,minZ:-7,maxZ:7},seats.map(s=>({deskId:s.deskId,x:s.desk.x,z:s.desk.z,approach:s.stand})),[...obstacles,...extra],elevator,destinations,{x:-8.9,z:3});
  return {schema:'mao-navigation-snapshot-v1',coordinateSystem:'Y-up world metres; layout minus half floor dimensions',agentRadius:diagnostics.agentRadius,seats,meeting,lounge,walkPoints:destinations.map(p=>({id:p.id,...point(p.x,p.z)})),routes:diagnostics.routes,issues:diagnostics.issues,ready:diagnostics.valid,notes:'Seat points are occupied furniture anchors, not walk targets. Approaches/routes are radius-checked static snapshots; GFX35 must refresh after geometry changes.'};
}
