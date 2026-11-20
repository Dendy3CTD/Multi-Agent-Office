import * as T from 'three';
import type {CharacterRig,RigPose} from './types';
export const JOINTS={pelvis:0,torso:1,head:2,leftThigh:3,leftShin:4,leftFoot:5,rightThigh:6,rightShin:7,rightFoot:8,leftArm:9,leftForearm:10,leftHand:11,rightArm:12,rightForearm:13,rightHand:14} as const;
const vector=(x:number,y:number,z:number)=>new T.Vector3(x,y,z);
export const REST=[vector(0,.53,0),vector(0,.88,-.05),vector(0,1.24,-.105),vector(-.12,.53,0),vector(-.14,.47,-.4),vector(-.14,.09,-.45),vector(.12,.53,0),vector(.14,.47,-.4),vector(.14,.09,-.45),vector(-.23,1.08,-.08),vector(-.29,.83,-.32),vector(-.18,.87,-.7),vector(.23,1.08,-.08),vector(.29,.83,-.32),vector(.18,.87,-.7)];
/** Source-authoring roles give stable weights, avoiding unreliable spatial mesh splitting. */
export function skinWeights(g:T.BufferGeometry,role:string,head=false) {
 const p=g.getAttribute('position'),indices=new Uint16Array(p.count*4),weights=new Float32Array(p.count*4);
 for(let i=0;i<p.count;i++){
  let a=head?2:role==='pelvis'?0:1,b=a,w=0;
  const side=role.endsWith('-1')?-1:1;
  if(role.startsWith('leg:')){a=side<0?3:6;b=a+1;w=T.MathUtils.smoothstep(.49-p.getY(i),0,.13);}
  if(role.startsWith('foot:'))a=b=side<0?5:8;
  if(role.startsWith('arm:')){a=side<0?9:12;b=a+1;w=T.MathUtils.smoothstep(g.getAttribute('skinAuthorV')?.getX(i)??(1-p.getY(i)),.6,.92);}
  if(role.startsWith('forearm:'))a=b=side<0?10:13;
  if(role.startsWith('hand:'))a=b=side<0?11:14;
  indices.set([a,b,0,0],i*4);weights.set([1-w,w,0,0],i*4);
 }
 g.deleteAttribute('skinAuthorV');
 g.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
}

function knee(hip:T.Vector3,foot:T.Vector3) {
 const direction=foot.clone().sub(hip),distance=T.MathUtils.clamp(direction.length(),.08,.785);direction.normalize();
 const along=(.405*.405-.383*.383+distance*distance)/(2*distance),bend=Math.sqrt(Math.max(0,.405*.405-along*along));
 const forward=vector(0,0,-1).addScaledVector(direction,direction.z).normalize();
 return hip.clone().addScaledVector(direction,along).addScaledVector(forward,bend);
}
function armBend(shoulder:T.Vector3,wrist:T.Vector3,index:number) {
 const first=REST[index].distanceTo(REST[index+1]),second=REST[index+1].distanceTo(REST[index+2]);
 const direction=wrist.clone().sub(shoulder),distance=T.MathUtils.clamp(direction.length(),.05,first+second-.002);direction.normalize();
 const along=(first*first-second*second+distance*distance)/(2*distance),bend=Math.sqrt(Math.max(0,first*first-along*along));
 const forward=vector(0,0,-1).projectOnPlane(direction).normalize();
 return shoulder.clone().addScaledVector(direction,along).addScaledVector(forward,bend);
}
/** Flat GPU joint palette with explicit anatomical pivots; two original meshes share it. */
export function attachCharacterRig(body:T.SkinnedMesh,head:T.SkinnedMesh):CharacterRig {
 const bones=REST.map((p,i)=>{const b=new T.Bone();b.name=Object.keys(JOINTS)[i];b.position.copy(p);body.add(b);return b;});
 for(const mesh of [body,head]){mesh.boundingBox=new T.Box3(vector(-.65,0,-1.05),vector(.65,2.2,.55));mesh.boundingSphere=new T.Sphere(vector(0,1,-.2),1.5);}
 body.updateMatrixWorld(true);const skeleton=new T.Skeleton(bones);body.bind(skeleton);head.bind(skeleton,body.bindMatrix);
 const set=(index:number,target:T.Vector3,restAxis?:T.Vector3,axis?:T.Vector3)=>{const b=bones[index];b.position.copy(target);b.quaternion.identity();if(restAxis&&axis)b.quaternion.setFromUnitVectors(restAxis.clone().normalize(),axis.clone().normalize());};
 const mix=(a:T.Vector3,b:T.Vector3,t:number)=>a.clone().lerp(b,t);
 let disposed=false;
 return {bones,
  apply(p:RigPose){
   const s=T.MathUtils.clamp(p.stand,0,1),rise=.29*s,bob=p.walking?Math.sin(p.gait*2)*.009:0;
   const lift=vector(0,rise+bob,0),torso=REST[1].clone().add(lift);set(0,REST[0].clone().add(lift));set(1,torso);set(2,REST[2].clone().add(lift));
   bones[1].rotation.x=p.thinking*.025;bones[2].rotation.y=p.head;
   for(const side of [-1,1]){
    const leg=side<0?3:6,arm=side<0?9:12;
    const wave=Math.sin(p.gait+(side<0?0:Math.PI)),stride=p.walking?wave*.18:0;
    const hip=REST[leg].clone().add(lift),footTarget=vector(side*.14,.09+(p.walking?Math.max(0,-wave)*.085:0),-.07+stride);
    const foot=mix(REST[leg+2],footTarget,s),joint=mix(REST[leg+1],knee(hip,foot),s);
    set(leg,hip,REST[leg+1].clone().sub(REST[leg]),joint.clone().sub(hip));
    set(leg+1,joint,REST[leg+2].clone().sub(REST[leg+1]),foot.clone().sub(joint));set(leg+2,foot);
    const shoulder=REST[arm].clone().add(lift),relax=(p.relax??0)*(1-s);
    const seatedWrist=mix(REST[arm+2],vector(side*.16,.63,-.38),relax);
    const wrist=mix(seatedWrist,vector(side*.27,.76,-.05-stride*.65),s);
    const seatedElbow=mix(REST[arm+1],armBend(REST[arm],seatedWrist,arm),relax);
    const elbow=mix(seatedElbow,armBend(shoulder,wrist,arm),s);
    const tap=p.typing*(Math.sin(p.time*(side<0?9:10.7))*.009);wrist.y+=tap;
    set(arm,shoulder,REST[arm+1].clone().sub(REST[arm]),elbow.clone().sub(shoulder));
    set(arm+1,elbow,REST[arm+2].clone().sub(REST[arm+1]),wrist.clone().sub(elbow));set(arm+2,wrist);bones[arm+2].rotation.x=-Math.PI/2*s;
   }
   body.parent?.updateWorldMatrix(true,false);body.updateMatrixWorld(true);head.updateMatrixWorld(true);skeleton.update();
  },
  dispose(){if(disposed)return;disposed=true;skeleton.dispose();bones.forEach(b=>b.removeFromParent());}
 };
}
