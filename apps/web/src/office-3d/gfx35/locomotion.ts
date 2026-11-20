import type {Point} from './types';
export function facing(from:Point,to:Point){return Math.atan2(-(to.x-from.x),-(to.z-from.z));}
export function turnTowards(current:number,target:number,amount:number){const d=Math.atan2(Math.sin(target-current),Math.cos(target-current));return current+Math.max(-amount,Math.min(amount,d));}
export class PathFollower {
 index=1;distance=0;done=false;
 constructor(readonly points:readonly Point[],readonly speed:number){if(points.length<2)throw new Error('path_too_short');}
 update(position:Point,dt:number,canMove:(point:Point)=>boolean){
  let remaining=this.speed*dt,changed=false,heading:number|undefined;
  while(remaining>0&&!this.done){const goal=this.points[this.index],dx=goal.x-position.x,dz=goal.z-position.z,length=Math.hypot(dx,dz);if(length<.00001){if(++this.index>=this.points.length)this.done=true;continue;}
   const step=Math.min(length,remaining),next={x:position.x+dx/length*step,z:position.z+dz/length*step};if(!canMove(next))break;
   heading=facing(position,next);position.x=next.x;position.z=next.z;this.distance+=step;remaining-=step;changed=true;
   if(step>=length-.000001&&++this.index>=this.points.length)this.done=true;
  }return {changed,heading};
 }
}
