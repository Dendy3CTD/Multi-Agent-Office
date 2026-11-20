import type * as T from 'three';
import type { buildNavigationCatalog } from '../gfx34/navigation';
import type { Obstacle } from '../gfx29/architecture/navigation';
export type AnimationState = 'SEATED_IDLE'|'SEATED_TYPING'|'SEATED_THINKING'|'SEATED_DRINKING'|'STAND_UP'|'STANDING_IDLE'|'WALKING'|'TURNING'|'SIT_DOWN'|'LOUNGE_IDLE'|'RETURNING_TO_DESK';
export type NavigationCatalog=ReturnType<typeof buildNavigationCatalog>;
export interface Point {x:number;z:number}
export interface RigPose {stand:number;gait:number;walking:boolean;typing:number;thinking:number;time:number;head:number;relax?:number}
export interface CharacterRig { apply(pose:RigPose):void;dispose():void; readonly bones:readonly T.Bone[] }
export interface RiggedObject extends T.Group {rig35?:CharacterRig;dispose?():void}
export interface LocalActor {employeeId:string;deskId:string;object:RiggedObject;chair:T.Object3D}
export interface SimulationOptions {catalog:NavigationCatalog;obstacles:readonly Obstacle[];floorY:number;maxMoving?:number;speed?:number}
