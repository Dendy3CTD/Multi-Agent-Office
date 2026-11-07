import type {AnimationState,RigPose} from './types';
export const smooth=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export function seatedPose(state:AnimationState,time:number,seed:number):RigPose {
 const phase=seed%100/17;
 return {relax:state==='LOUNGE_IDLE'?1:0,stand:0,gait:0,walking:false,typing:state==='SEATED_TYPING'&&Math.sin(time*1.8+phase)>-.55?1:0,thinking:state==='SEATED_THINKING'?1:0,time:time+phase,head:Math.sin(time*.9+phase)*(state==='SEATED_THINKING'?.13:.025)};
}
export const STATES:readonly AnimationState[]=['SEATED_IDLE','SEATED_TYPING','SEATED_THINKING','SEATED_DRINKING','STAND_UP','STANDING_IDLE','WALKING','TURNING','SIT_DOWN','LOUNGE_IDLE','RETURNING_TO_DESK'];
export function canTransition(from:AnimationState,to:AnimationState):boolean {
 if(from===to)return true;
 const seated=['SEATED_IDLE','SEATED_TYPING','SEATED_THINKING','SEATED_DRINKING'];
 if(seated.includes(from))return seated.includes(to)||to==='STAND_UP';
 const edges:Partial<Record<AnimationState,AnimationState[]>>={STAND_UP:['STANDING_IDLE'],STANDING_IDLE:['TURNING','WALKING','RETURNING_TO_DESK','SIT_DOWN'],WALKING:['STANDING_IDLE','TURNING','SIT_DOWN'],RETURNING_TO_DESK:['STANDING_IDLE','TURNING','SIT_DOWN'],TURNING:['STANDING_IDLE','WALKING','RETURNING_TO_DESK','SIT_DOWN'],SIT_DOWN:['SEATED_IDLE','SEATED_TYPING','LOUNGE_IDLE'],LOUNGE_IDLE:['STAND_UP']};
 return edges[from]?.includes(to)??false;
}
