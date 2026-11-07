import * as T from 'three';
/** Reprofiles acquired instances, never their shared GLB source or local pivots. */
export function recessElevator(root: T.Object3D) {
  const entries: { mesh:T.Mesh; geometry:T.BufferGeometry }[]=[];
  root.updateWorldMatrix(true,true);
  for(const asset of root.children.filter(o=>String(o.userData.officeAssetId).startsWith('elevator.'))) {
    const id=asset.userData.officeAssetId;
    if(id==='elevator.wall-lights'||id==='elevator.floor-sign')continue;
    asset.updateWorldMatrix(true,true);
    const inverse=asset.matrixWorld.clone().invert();
    asset.traverse(node=>{
      const mesh=node as T.Mesh;if(!mesh.isMesh)return;
      const toAsset=new T.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld), toMesh=toAsset.clone().invert();
      const original=mesh.geometry,geometry=original.clone(),positions=geometry.getAttribute('position'),point=new T.Vector3();
      for(let i=0;i<positions.count;i++) {
        point.fromBufferAttribute(positions,i).applyMatrix4(toAsset);
        if(id==='elevator.display')point.z-=.07;
        else if(point.z<-.8)point.z=-.8+(point.z+.8)*.65;
        if(id==='elevator.call-panel')point.z-=.04;
        point.applyMatrix4(toMesh);positions.setXYZ(i,point.x,point.y,point.z);
      }
      geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
      entries.push({mesh,geometry:original});mesh.geometry=geometry;
    });
  }
  let disposed=false;
  return { cleanup(){if(disposed)return;disposed=true;for(const {mesh,geometry} of entries){mesh.geometry.dispose();mesh.geometry=geometry;}entries.length=0;} };
}
