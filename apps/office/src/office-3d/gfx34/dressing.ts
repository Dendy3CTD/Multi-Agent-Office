import * as T from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SetName } from '../gfx30/materials';
/** Supported tabletop details only: this pass adds no floor obstacles. */
export function dressGameInterior(root:T.Group,material:(name:SetName)=>T.MeshStandardMaterial,floorY:number) {
 const group=new T.Group();group.name='gfx34-supported-details';root.add(group);
 const cube=new RoundedBoxGeometry(1,1,1,2,.08);
 const paper=new T.MeshStandardMaterial({color:0xffffff,roughness:.94}),metal=material('graphite-metal'),wood=material('walnut-shelf');
 type Part={p:[number,number,number];s:[number,number,number];color:number;angle:number};
 const batches=new Map<T.Material,{g:T.BufferGeometry;parts:Part[]}>();
 const add=(m:T.Material,p:Part['p'],s:Part['s'],color=0xffffff,angle=0)=>{let b=batches.get(m);if(!b){b={g:cube,parts:[]};batches.set(m,b);}b.parts.push({p,s,color,angle});};
 const desks=root.children.filter(o=>o.userData.officeAssetId==='desk.modern').sort((a,b)=>String(a.userData.deskId).localeCompare(String(b.userData.deskId)));
 const assignments:{mesh:T.Mesh;original:T.Material|T.Material[]}[]=[],mats:T.Material[]=[];
 const padColors=[0x3d5556,0x786b56,0x575d6c,0x77584b];
 const pads=padColors.map(color=>{const m=new T.MeshStandardMaterial({color,roughness:.95});mats.push(m);return m;});
 desks.forEach((desk,i)=>{
  const x=desk.position.x,z=desk.position.z,y=floorY+.87;
  desk.traverse(o=>{const mesh=o as T.Mesh;if(mesh.isMesh&&mesh.name.includes('fabric-blue')){assignments.push({mesh,original:mesh.material});mesh.material=pads[i%4];}});
  // Raised document tray, two sheets, phone and coloured binder; each stays on its own desk.
  if(i%2===0){
   add(metal,[x-.52,y+.045,z+.13],[.28,.07,.24]);
   add(paper,[x-.52,y+.085,z+.13],[.24,.008,.20],0xe7dfca,-.08);
   add(paper,[x-.51,y+.097,z+.13],[.24,.008,.20],0xf5efdf,.04);
  }else{
   add(paper,[x-.51,y+.026,z+.16],[.24,.045,.20],[0x9e7150,0x60736b,0x7d7b62][i%3],.12);
   add(paper,[x-.51,y+.055,z+.16],[.20,.006,.18],0xece3d0,.12);
  }
  add(metal,[x+.37,y+.02,z+.26],[.095,.027,.17],0x788382,-.16);
 });
 // Books and small ceramic vessels sit on the console's existing support.
 for(let i=0;i<3;i++)add(paper,[-10.34,floorY+1.19+i*.045,-.05],[.32,.04,.43],[0x51655d,0xaa865f,0xd4c6a7][i],.04*i);
 add(wood,[-8.32,floorY+.75,-2.83],[.38,.04,.29]);
 for(const [m,b]of batches){const mesh=new T.InstancedMesh(b.g,m,b.parts.length),matrix=new T.Matrix4(),q=new T.Quaternion();b.parts.forEach((p,i)=>{q.setFromAxisAngle(new T.Vector3(0,1,0),p.angle);matrix.compose(new T.Vector3(...p.p),q,new T.Vector3(...p.s));mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new T.Color(p.color));});mesh.name='gfx34-tabletop-batch';mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);}
 // A scene-owned woven albedo uses the existing rug material, one small shared texture.
 const rug=material('ivory-rug'),originalMap=rug.map;
 const data=new Uint8Array(128*128*4);
 for(let y=0;y<128;y++)for(let x=0;x<128;x++){const weave=(x%4<2?5:-5)+(y%4<2?4:-4),noise=Math.sin(x*53.1+y*71.2)*3,i=(y*128+x)*4;data.set([207+weave+noise,195+weave+noise,174+weave+noise,255],i);}
 const texture=new T.DataTexture(data,128,128);texture.colorSpace=T.SRGBColorSpace;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(12,10);texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.anisotropy=4;texture.needsUpdate=true;rug.map=texture;
 let disposed=false;return {cleanup(){if(disposed)return;disposed=true;group.removeFromParent();group.traverse(o=>{if((o as T.InstancedMesh).isInstancedMesh)(o as T.InstancedMesh).dispose();});assignments.forEach(a=>a.mesh.material=a.original);rug.map=originalMap;texture.dispose();cube.dispose();paper.dispose();mats.forEach(m=>m.dispose());group.clear();}};
}
