import type {AnimationState,LocalActor,Point,RigPose} from './types';
import {appearanceSeed} from '../gfx32/characters';
import {PathFollower,turnTowards} from './locomotion';
import {canTransition,seatedPose,smooth} from './pose-controller';
export interface Phase {state:AnimationState;duration?:number;path?:Point[];stand?:number;relax?:number;yaw?:number;chairRoll?:boolean;restoreChair?:boolean;label?:string}
/** Owns game pose only. Never writes employee status or Directory state. */
export class AnimationController {
 readonly seed:number;state:AnimationState='SEATED_IDLE';elapsed=0;time=0;active=false;completed=false;cancelled=false;stopReason?:'cancelled'|'movement_blocked';
 private breadcrumbs:Point[]=[];
 readonly history:{state:AnimationState;time:number;x:number;z:number}[]=[];
 private queue:Phase[]=[];private phase?:Phase;private follower?:PathFollower;private startStand=0;private startRelax=0;private blockedTime=0;private pose:RigPose;private chairBase:{x:number;y:number;z:number};
 constructor(readonly actor:LocalActor,readonly speed=1.05){if(!actor.object.rig35)throw new Error('missing_character_rig');this.seed=appearanceSeed(actor.employeeId);this.pose=seatedPose(this.state,0,this.seed);this.chairBase=actor.chair.position.clone();this.apply();}
 enqueue(phases:Phase[]){
  // Validate the whole append before touching a running queue.
  let state=this.queue[this.queue.length-1]?.state??this.phase?.state??this.state;
  let endpoint:Point=this.actor.object.position;
  for(const phase of [this.phase,...this.queue])if(phase?.path)endpoint=phase.path[phase.path.length-1];
  for(const phase of phases){
   if(phase.state==='SEATED_DRINKING')throw new Error('unsupported_action:cup_attachment_not_implemented');
   if(!canTransition(state,phase.state))throw new Error(`invalid_animation_transition:${state}:${phase.state}`);
   if(phase.duration!==undefined&&(!Number.isFinite(phase.duration)||phase.duration<=0))throw new Error('invalid_phase_duration');
   if(['WALKING','RETURNING_TO_DESK'].includes(phase.state)&&!phase.path)throw new Error('missing_animation_path');
   if(phase.path){
    if(phase.path.length<2||phase.path.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z)))throw new Error('invalid_animation_path');
    if(Math.hypot(phase.path[0].x-endpoint.x,phase.path[0].z-endpoint.z)>.04)throw new Error('animation_path_start_mismatch');
    endpoint=phase.path[phase.path.length-1];
   }
   state=phase.state;
  }
  if(!phases.length)return this;
  this.cancelled=false;this.stopReason=undefined;this.queue.push(...phases);this.active=true;this.completed=false;return this;
 }
 request(state:AnimationState,duration=2){
  if(this.active||!canTransition(this.state,state)||['SEATED_DRINKING','WALKING','RETURNING_TO_DESK'].includes(state))return false;
  this.enqueue([{state,duration,...(state==='SIT_DOWN'?{stand:0}:{})}]);return true;
 }
 private enter(){const next=this.queue.shift();if(!next){this.phase=undefined;this.active=false;this.completed=!this.cancelled;return;}
  if(!canTransition(this.state,next.state))throw new Error(`invalid_animation_transition:${this.state}:${next.state}`);
  this.state=next.state;this.phase=next;this.elapsed=0;this.startStand=this.pose.stand;this.startRelax=this.pose.relax??0;this.blockedTime=0;this.follower=next.path?new PathFollower(next.path,this.speed):undefined;
  this.history.push({state:this.state,time:this.time,x:this.actor.object.position.x,z:this.actor.object.position.z});
 }
 update(dt:number,canMove:(point:Point)=>boolean=()=>true){if(!this.active)return false;if(!this.phase)this.enter();if(!this.phase)return false;
  const p=this.phase;
  if(this.follower&&!this.breadcrumbs.length)this.breadcrumbs.push({x:this.actor.object.position.x,z:this.actor.object.position.z});
  this.time+=dt;this.elapsed+=dt;
  if(this.follower){const result=this.follower.update(this.actor.object.position,dt,canMove);if(result.heading!==undefined)this.actor.object.rotation.y=turnTowards(this.actor.object.rotation.y,result.heading,dt*4.8);if(!result.changed&&!this.follower.done){this.blockedTime+=dt;if(this.blockedTime>=2){this.cancel('movement_blocked');return false;}}else this.blockedTime=0;if(result.changed){const at=this.actor.object.position,last=this.breadcrumbs[this.breadcrumbs.length-1];if(!last||Math.hypot(at.x-last.x,at.z-last.z)>.08)this.breadcrumbs.push({x:at.x,z:at.z});}this.pose={...this.pose,stand:1,relax:0,walking:result.changed,gait:this.follower.distance*7,time:this.time,typing:0,head:0};}
  else {
   const raw=this.elapsed/(p.duration??1),t=smooth(p.restoreChair?Math.max(0,(raw-.3)/.7):raw);
   if(['SEATED_IDLE','SEATED_TYPING','SEATED_THINKING','LOUNGE_IDLE'].includes(p.state)){this.pose=seatedPose(p.state,this.time,this.seed);}
   else {this.pose={...this.pose,stand:this.startStand+((p.stand??1)-this.startStand)*t,relax:this.startRelax+((p.relax??0)-this.startRelax)*t,walking:false,typing:0,thinking:0,time:this.time,head:0};}
   if(p.yaw!==undefined)this.actor.object.rotation.y=turnTowards(this.actor.object.rotation.y,p.yaw,dt*3.8);
  }
  if(p.chairRoll){const t=smooth(this.elapsed/(p.duration??1));this.actor.chair.position.z=this.chairBase.z+.35*t;}
  else if(p.restoreChair)this.actor.chair.position.z=this.chairBase.z+.35*(1-smooth(this.elapsed/(p.duration??1)*2));
  else if(p.label==='desk-exit'&&this.pose.stand> .95&&Math.abs(this.actor.object.position.x-this.chairBase.x)>.58)this.actor.chair.position.copy(this.chairBase);
  this.apply();
  if(this.follower?.done||(!this.follower&&this.elapsed>=(p.duration??1))){this.phase=undefined;this.follower=undefined;if(!this.queue.length){this.active=false;this.completed=!this.cancelled;}}
  return true;
 }
 private apply(){this.actor.object.rig35!.apply(this.pose);this.actor.object.userData.localAnimation={simulation:true,state:this.state};}
 cancel(reason:'cancelled'|'movement_blocked'='cancelled'){this.stopReason=reason;this.queue=[];this.phase=undefined;this.follower=undefined;this.active=false;this.cancelled=true;this.actor.chair.position.copy(this.chairBase);/* Keep current transforms and pose, never snap to a desk. */}
 get returnPath(){return [{x:this.actor.object.position.x,z:this.actor.object.position.z},...this.breadcrumbs.slice().reverse(),{x:this.chairBase.x,z:this.chairBase.z}];}
 returnToDesk(){
  const path=this.returnPath;this.cancel();
  if(this.state==='LOUNGE_IDLE'||this.pose.stand<.99){if(!canTransition(this.state,'STAND_UP'))this.state='STAND_UP';this.enqueue([{state:'STAND_UP',duration:1,stand:1},{state:'STANDING_IDLE',duration:.1,stand:1}]);}
  else this.state='STANDING_IDLE';
  this.enqueue([{state:'RETURNING_TO_DESK',path,label:'desk-approach'},{state:'TURNING',duration:.6,yaw:0,stand:1},{state:'SIT_DOWN',duration:1.3,stand:0,restoreChair:true},{state:'SEATED_TYPING',duration:2}]);return true;
 }
 dispose(){this.cancel();delete this.actor.object.userData.localAnimation;}
 get snapshot(){return {employeeId:this.actor.employeeId,deskId:this.actor.deskId,state:this.state,active:this.active,completed:this.completed,cancelled:this.cancelled,stopReason:this.stopReason,elapsed:this.elapsed,label:this.phase?.label,stand:this.pose.stand,position:this.actor.object.position.toArray(),yaw:this.actor.object.rotation.y,history:this.history};}
}
