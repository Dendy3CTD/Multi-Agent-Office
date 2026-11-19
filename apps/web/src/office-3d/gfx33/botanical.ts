import * as T from 'three';
type XYZ=[number,number,number];
export type Emit=(g:T.BufferGeometry,m:T.Material,p:XYZ,s:XYZ,r?:XYZ,color?:number,cast?:boolean)=>void;
/** Four botanical silhouettes share three curved leaf meshes and a ceramic profile. */
export function createBotanicalPalette() {
  const geometries:T.BufferGeometry[]=[],materials:T.Material[]=[];
  const foliage=new T.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.8,side:T.DoubleSide});
  const ceramic=new T.MeshStandardMaterial({color:0xffffff,roughness:.72});
  const stem=new T.MeshStandardMaterial({color:0x5a6840,roughness:.94});
  const soil=new T.MeshStandardMaterial({color:0x3d3027,roughness:1});materials.push(foliage,ceramic,stem,soil);
  const leaves=[0,1,2].map(type=>{
    const positions:number[]=[],colors:number[]=[],indices:number[]=[];
    for(let j=0;j<=10;j++)for(let i=0;i<=4;i++){
      const t=j/10,u=i/2-1;
      const shape=type===0?Math.pow(Math.sin(Math.PI*t),.7):type===1?Math.sin(Math.PI*t)*(.65+.35*t):Math.pow(Math.sin(Math.PI*t),.5)*(1-.45*t);
      const w=shape*(type===1?.15:.35)*(1+.06*Math.sin(t*26));
      positions.push(u*w,t,.13*Math.sin(t*Math.PI)+.16*t*t-.075*Math.abs(u)*Math.sin(t*Math.PI));
      const c=new T.Color().setHSL(.25+.035*t,.37,.23+.095*t+(Math.abs(u)<.1?.035:0));colors.push(c.r,c.g,c.b);
    }
    for(let j=0;j<10;j++)for(let i=0;i<4;i++){const a=j*5+i;indices.push(a,a+1,a+5,a+1,a+6,a+5);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();geometries.push(g);return g;
  });
  const planter=new T.LatheGeometry([[0,0],[.17,0],[.2,.035],[.235,.34],[.25,.37],[.25,.41],[.218,.41],[.212,.37]].map(([r,y])=>new T.Vector2(r,y)),24);
  const cylinder=new T.CylinderGeometry(1,1,1,7),earth=new T.CylinderGeometry(.213,.213,.018,20);geometries.push(planter,cylinder,earth);
  const line=(emit:Emit,a:T.Vector3,b:T.Vector3,r:number)=>{
    const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize()),e=new T.Euler().setFromQuaternion(q);
    emit(cylinder,stem,a.clone().add(b).multiplyScalar(.5).toArray() as XYZ,[r,a.distanceTo(b),r],[e.x,e.y,e.z],undefined,false);
  };
  const plant=(emit:Emit,x:number,y:number,z:number,scale=1,variant?:number)=>{
    const seed=Math.abs(Math.round(x*193+z*71)),type=variant??seed%3;
    emit(planter,ceramic,[x,y,z],[scale,scale,scale],[0,0,0],[0xd9c9ac,0xb38c6e,0xe5ddd0][seed%3]);
    emit(earth,soil,[x,y+.382*scale,z],[scale,scale,scale],undefined,undefined,false);
    const count=type===1?15:11;
    for(let i=0;i<count;i++){
      const angle=i*2.39996+seed*.1, tier=i%4, h=(type===2?.55:.67)+tier*.17;
      const radius=(type===1?.23:.17)+tier*.045;
      const base=new T.Vector3(x,y+.38*scale,z),tip=new T.Vector3(x+Math.cos(angle)*radius*scale,y+h*scale,z+Math.sin(angle)*radius*scale);
      line(emit,base,tip,.009*scale);
      const length=(type===1?.58:type===2?.38:.46)+(i%3)*.065;
      emit(leaves[type],foliage,tip.toArray() as XYZ,[scale*(type===0?1.1:1),scale*length,scale],[.45*Math.sin(angle),angle,.65*Math.cos(angle)],[0xd7e3a8,0xb4ce86,0xe8e5b6][i%3],false);
    }
  };
  const vine=(emit:Emit,x:number,y:number,z:number,seed=0)=>{
    for(let strand=0;strand<3;strand++)for(let i=0;i<11;i++){
      const t=i/10,xx=x+(strand-1)*.24+Math.sin(t*5+strand)*.1,yy=y-t*(.65+strand*.17),zz=z-.09*Math.sin(t*Math.PI);
      emit(leaves[2],foliage,[xx+(i%2?.06:-.06),yy,zz],[.28,.24,.28],[.3,seed+strand,(i%2?1:-1)*1.9],0xdce3ac,false);
    }
  };
  return {geometries,materials,plant,vine};
}
