import * as T from 'three';
import type { PremiumArchitecture } from '../gfx29/architecture';
/** Cheap projected ambient contacts; one shared alpha texture, one instanced draw. */
export function createAmbientContacts(root:T.Group,architecture:PremiumArchitecture,floorY:number) {
  const data=new Uint8Array(64*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const r=Math.hypot((x-31.5)/31.5,(y-31.5)/31.5),v=Math.round(Math.pow(Math.max(0,1-r),1.7)*255),i=(y*64+x)*4;
    data.set([v,v,v,255],i);
  }
  const texture=new T.DataTexture(data,64,64);texture.colorSpace=T.NoColorSpace;texture.magFilter=texture.minFilter=T.LinearFilter;texture.needsUpdate=true;
  const material=new T.MeshBasicMaterial({color:0x30251c,alphaMap:texture,transparent:true,opacity:.33,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  const geometry=new T.PlaneGeometry();geometry.rotateX(-Math.PI/2);
  const spots:{x:number;y:number;z:number;w:number;d:number}[]=[];
  for(const object of root.children.filter(o=>o.userData.officeAssetId==='chair.ergonomic'))spots.push({x:object.position.x,y:floorY+.008,z:object.position.z,w:.85,d:.85});
  for(const asset of architecture.assetBounds)if(/lounge-sofa|lounge-chair|lounge-table|meeting-chair|meeting-table|bookshelf/.test(asset.key)) {
    const size=asset.bounds.getSize(new T.Vector3()),center=asset.bounds.getCenter(new T.Vector3());
    spots.push({x:center.x,y:floorY+(/lounge|meeting/.test(asset.key)?.037:.008),z:center.z,w:size.x*1.2,d:size.z*1.2});
  }
  const mesh=new T.InstancedMesh(geometry,material,spots.length),matrix=new T.Matrix4();mesh.name='gfx33-ambient-contacts';mesh.raycast=()=>{};
  spots.forEach((s,i)=>{matrix.makeScale(s.w,1,s.d);matrix.setPosition(s.x,s.y,s.z);mesh.setMatrixAt(i,matrix);});mesh.computeBoundingSphere();root.add(mesh);
  let disposed=false;return {cleanup(){if(disposed)return;disposed=true;mesh.removeFromParent();mesh.dispose();geometry.dispose();material.dispose();texture.dispose();}};
}
