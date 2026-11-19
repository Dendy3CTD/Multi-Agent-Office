import type {Phase} from './animation-controller';
import type {excursionPaths} from './navigation-adapter';
export function deskLoungeDesk(paths:ReturnType<typeof excursionPaths>):Phase[] {
 const reverse=(p:typeof paths.walk)=>p.slice().reverse().map(v=>({...v}));
 return [
  {state:'SEATED_TYPING',duration:3},{state:'SEATED_THINKING',duration:1},
  {state:'STAND_UP',duration:1.25,stand:1,chairRoll:true},{state:'STANDING_IDLE',duration:.2,stand:1},
  {state:'WALKING',path:paths.exit,label:'desk-exit'},{state:'WALKING',path:paths.walk,label:'to-lounge'},
  {state:'TURNING',duration:.6,yaw:Math.PI/2,stand:1},
  {state:'WALKING',path:paths.loungeSit,label:'lounge-seat'},
  {state:'TURNING',duration:.6,yaw:Math.PI/2,stand:1},
  {state:'SIT_DOWN',duration:1.25,stand:0,relax:1,yaw:Math.PI/2},{state:'LOUNGE_IDLE',duration:2.5},
  {state:'STAND_UP',duration:1.25,stand:1},{state:'STANDING_IDLE',duration:.2,stand:1},
  {state:'RETURNING_TO_DESK',path:reverse(paths.loungeSit),label:'leave-lounge'},
  {state:'RETURNING_TO_DESK',path:reverse(paths.walk),label:'return'},
  {state:'STANDING_IDLE',duration:.4,stand:1,chairRoll:true},
  {state:'RETURNING_TO_DESK',path:reverse(paths.exit),label:'desk-approach'},
  {state:'TURNING',duration:.6,yaw:0,stand:1},
  {state:'SIT_DOWN',duration:1.4,stand:0,yaw:0,restoreChair:true},
  {state:'SEATED_TYPING',duration:3},
 ];
}
