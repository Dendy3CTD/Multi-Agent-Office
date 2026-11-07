import type {NavigationCatalog,Point} from './types';
import type {Obstacle} from '../gfx29/architecture/navigation';
export function clearSegment(a:Point,b:Point,obstacles:readonly Obstacle[],radius=.27,ignore=new Set<string>()):boolean {
 const count=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.035));
 for(let i=0;i<=count;i++){const t=i/count,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;if(x-radius< -11||x+radius>11||z-radius< -7||z+radius>7)return false;
  if(obstacles.some(o=>!ignore.has(o.id)&&x>o.minX-radius&&x<o.maxX+radius&&z>o.minZ-radius&&z<o.maxZ+radius))return false;
 }return true;
}
export function checkedPath(points:Point[],obstacles:readonly Obstacle[],ignore=new Set<string>()) {
 if(points.length<2||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z)))throw new Error('invalid_animation_path');
 for(let i=1;i<points.length;i++)if(!clearSegment(points[i-1],points[i],obstacles,.27,ignore))throw new Error(`blocked_animation_segment:${i}`);
 return points.map(p=>({...p}));
}
/** Join two existing hub routes at their last common prefix. Never invent another floor map. */
export function joinCatalogRoutes(catalog:NavigationCatalog,from:string,to:string):Point[] {
 const a=catalog.routes.find(r=>r.id===from),b=catalog.routes.find(r=>r.id===to);
 if(!a?.reachable||!b?.reachable)throw new Error(`missing_animation_route:${from}:${to}`);
 let common=0;while(common<Math.min(a.points.length,b.points.length)&&Math.hypot(a.points[common].x-b.points[common].x,a.points[common].z-b.points[common].z)<.001)common++;
 if(!common)throw new Error('navigation_routes_have_no_shared_hub');
 return [...a.points.slice(common-1).reverse(),...b.points.slice(common)].map(p=>({...p}));
}
export function excursionPaths(catalog:NavigationCatalog,deskId:string,obstacles:readonly Obstacle[],loungeBounds:{minX:number;maxX:number;minZ:number;maxZ:number}) {
 const seat=catalog.seats.find(s=>s.deskId===deskId),entry=catalog.walkPoints.find(p=>p.id==='lounge-entry'),lounge=catalog.lounge.find(p=>p.id==='lounge-chair');
 if(!seat||!entry||!lounge)throw new Error('missing_desk_or_lounge_anchor');
 const seatPoint={x:seat.chair.x,z:seat.chair.z},stand={x:seat.stand.x,z:seat.stand.z};
 // Chair is rolled back while rising. Exit sideways, restore chair, then reach the existing stand point.
 const exit=checkedPath([seatPoint,{x:seatPoint.x+.70,z:seatPoint.z},{x:seatPoint.x+.70,z:stand.z},stand],obstacles,new Set([deskId]));
 const route=joinCatalogRoutes(catalog,deskId,'lounge-entry');
 const work=checkedPath([stand,...route,{x:entry.x,z:entry.z}],obstacles);
 // GFX34 stops at lounge entry, not inside furniture. Derive a south-side connector from the actual chair bounds.
 const south=loungeBounds.minZ-.27-.13,approach={x:lounge.seat.x,z:south};
 const connector=checkedPath([{x:entry.x,z:entry.z},{x:entry.x,z:south},approach],obstacles);
 const sit=checkedPath([approach,{x:lounge.seat.x,z:lounge.seat.z}],obstacles,new Set(['lounge-chair']));
 return {seat:seatPoint,stand,exit,walk:[...work,...connector.slice(1)],loungeApproach:approach,loungeSeat:{x:lounge.seat.x,z:lounge.seat.z},loungeSit:sit};
}
