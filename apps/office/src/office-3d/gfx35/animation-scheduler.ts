import type {LocalActor,SimulationOptions,Point} from './types';
import {AnimationController} from './animation-controller';
import {excursionPaths} from './navigation-adapter';
import {deskLoungeDesk} from './demo-scenarios';

/** One finite local simulation, driven exclusively by OfficeScene3D's existing RAF. */
export class AnimationScheduler {
 readonly controllers=new Map<string,AnimationController>(); readonly errors:string[]=[];
 paused=false;reducedMotion=false;disposed=false;private last?:number;private leases=new Map<string,Set<string>>();
 constructor(readonly options:SimulationOptions){}
 add(actor:LocalActor){if(this.disposed)throw new Error('scheduler_disposed');if(this.controllers.has(actor.employeeId))throw new Error('duplicate_animation_employee');const c=new AnimationController(actor,(this.options.speed??1.05)*(.94+(cseed(actor.employeeId)%13)/100));this.controllers.set(actor.employeeId,c);return c;}
 remove(id:string){const c=this.controllers.get(id);if(c){c.dispose();this.controllers.delete(id);}this.leases.delete(id);}
 startExcursion(id:string,loungeBounds:{minX:number;maxX:number;minZ:number;maxZ:number}) {
  const c=this.controllers.get(id);if(!c||this.reducedMotion||this.disposed||c.active)return false;
  const seat=this.options.catalog.seats.find(s=>s.deskId===c.actor.deskId);
  if(!seat||c.snapshot.stand>.01||Math.hypot(c.actor.object.position.x-seat.chair.x,c.actor.object.position.z-seat.chair.z)>.04)return false;
  try{
   const paths=excursionPaths(this.options.catalog,c.actor.deskId,this.options.obstacles,loungeBounds);
   const cells=new Set(paths.walk.map(p=>`${Math.round(p.x/.6)}:${Math.round(p.z/.6)}`));
   if(this.leases.size>=(this.options.maxMoving??1)||[...this.leases.values()].some(lease=>[...cells].some(cell=>lease.has(cell))))return false;
   this.leases.set(id,cells);c.enqueue(deskLoungeDesk(paths));return true;
  }catch(error){this.errors.push(error instanceof Error?error.message:String(error));return false;}
 }
 activity(id:string,state:'SEATED_TYPING'|'SEATED_THINKING',duration=8){const c=this.controllers.get(id);if(!c||this.reducedMotion)return false;return c.request(state,duration);}
 tick(now:number){if(this.paused||this.disposed||this.reducedMotion){this.last=undefined;return false;}const dt=this.last===undefined?0:Math.max(0,Math.min(.05,(now-this.last)/1000));this.last=now;return this.step(dt);}
 step(dt:number){if(this.paused||this.disposed||this.reducedMotion)return false;dt=Math.max(0,Math.min(.05,Number.isFinite(dt)?dt:0));let changed=false;
  for(const [id,c]of this.controllers){changed=c.update(dt,p=>this.free(id,p))||changed;if(!c.active)this.leases.delete(id);}
  return changed;
 }
 /** Deterministic test clock; no wall clock, network or timers. */
 advance(seconds:number){if(!Number.isFinite(seconds)||seconds<0||seconds>180)throw new Error('invalid_simulation_delta');for(let t=0;t<seconds;t+=.05)this.step(Math.min(.05,seconds-t));}
 private free(id:string,p:Point){return [...this.controllers].every(([other,c])=>other===id||Math.hypot(c.actor.object.position.x-p.x,c.actor.object.position.z-p.z)>.62);}
 setHidden(hidden:boolean){this.paused=hidden;this.last=undefined;}
 setReducedMotion(reduced:boolean){this.reducedMotion=reduced;this.last=undefined;if(reduced)for(const c of this.controllers.values())c.cancel();this.leases.clear();}
 returnToDesk(id:string){const c=this.controllers.get(id);if(!c||this.reducedMotion||this.disposed)return false;
  if(!this.leases.has(id)&&this.leases.size>=(this.options.maxMoving??1))return false;
  const cells=new Set(c.returnPath.map(p=>`${Math.round(p.x/.6)}:${Math.round(p.z/.6)}`));
  if([...this.leases].some(([other,lease])=>other!==id&&[...cells].some(key=>lease.has(key))))return false;
  this.leases.set(id,cells);return c.returnToDesk();
 }
 cancel(id:string){this.controllers.get(id)?.cancel();this.leases.delete(id);}
 get active(){return !this.paused&&!this.reducedMotion&&!this.disposed&&[...this.controllers.values()].some(c=>c.active);}
 get snapshot(){return {simulation:true,active:this.active,paused:this.paused,reducedMotion:this.reducedMotion,errors:this.errors,actors:[...this.controllers.values()].map(c=>c.snapshot)};}
 dispose(){if(this.disposed)return;this.disposed=true;for(const c of this.controllers.values())c.dispose();this.controllers.clear();this.leases.clear();this.last=undefined;}
}
function cseed(id:string){let h=0;for(const char of id)h=Math.imul(h,31)+char.charCodeAt(0)|0;return h>>>0;}
