import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
export function studioGeometry(part) {
 const [w,d,h]=part.size
 const kind=part.kind
 if(kind==='cushion') {
  const g=new THREE.SphereGeometry(1,16,10),a=g.attributes.position
  const signed=(v,e)=>Math.sign(v)*Math.pow(Math.abs(v),e)
  for(let i=0;i<a.count;i++) {
   const x=signed(a.getX(i),.43),y=signed(a.getY(i),.43),z=signed(a.getZ(i),.43)
   const folds=.008*Math.sin(x*17+z*9)*Math.pow(Math.abs(x*z),2)
   a.setXYZ(i,x*w/2,y*h/2+folds,z*d/2)
  }
  g.computeVertexNormals();return g
 }
 if(kind==='shell') {
  const g=new THREE.BoxGeometry(w,h,d,8,10,1),a=g.attributes.position
  for(let i=0;i<a.count;i++) {
   const x=a.getX(i)/(w/2),y=a.getY(i)/(h/2)
   a.setXYZ(i,a.getX(i)*(.88+.12*Math.abs(y)),a.getY(i),a.getZ(i)+.065*x*x+.035*Math.sin(y*Math.PI))
  }
  g.computeVertexNormals();return g
 }
 if(kind==='deskTop') {
  const shape=new THREE.Shape(),x=-w/2,y=-d/2,r=.045
  shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+d-r);shape.quadraticCurveTo(x+w,y+d,x+w-r,y+d);shape.lineTo(x+r,y+d);shape.quadraticCurveTo(x,y+d,x,y+d-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y)
  for(const sign of [-1,1]){const hole=new THREE.Path();hole.absarc(sign*.5,-.21,.022,0,Math.PI*2,true);shape.holes.push(hole)}
  const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:true,bevelSize:.008,bevelThickness:.007,bevelSegments:2,steps:1,curveSegments:10})
  g.rotateX(-Math.PI/2);g.translate(0,-h/2,0);return g
 }
 if(kind==='bevelDisc') return new THREE.LatheGeometry([[0,0],[w-.012,0],[w,.012],[w,h-.012],[w-.012,h],[0,h]].map(p=>new THREE.Vector2(...p)),40)
 if(kind==='piping') {
  const shape=new THREE.Shape(),x=-w/2,y=-h/2,r=.045
  shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y)
  const points=shape.getPoints(6).map(p=>new THREE.Vector3(p.x,p.y,-d/2-.003))
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points,true),48,.0025,4,true)
 }
 if(kind==='keycap') { const g=new THREE.CylinderGeometry(.82,1,h,4,1,false);g.rotateY(Math.PI/4);g.scale(w/Math.SQRT2,1,d/Math.SQRT2);return g }
 if(kind==='ring'){const g=new THREE.TorusGeometry(w,.003,6,20);g.rotateX(Math.PI/2);return g}
 if(kind==='disc'){const g=new THREE.CylinderGeometry(w,w,h,32,1,false);g.translate(0,h/2,0);return g}
 if(kind==='wheel'){const g=new THREE.CylinderGeometry(w,w,d,12);g.rotateZ(Math.PI/2);return g}
 if(kind==='cup') {
  const cup=new THREE.LatheGeometry([[0,0],[w,0],[w,h],[w-.006,h],[w-.006,.012],[0,.012]].map(p=>new THREE.Vector2(...p)),24)
  const handle=new THREE.TorusGeometry(h*.26,.006,6,16);handle.translate(w+.014,h*.5,0)
  return mergeGeometries([cup.toNonIndexed(),handle.toNonIndexed()],false)
 }
 if(kind==='shade')return new THREE.LatheGeometry([[w,0],[d,h],[d-.008,h],[w-.008,0],[w,0]].map(p=>new THREE.Vector2(...p)),32)
 if(kind==='ribbedPot') {
  const g=new THREE.CylinderGeometry(w,d,h,48,5),a=g.attributes.position
  for(let i=0;i<a.count;i++){const x=a.getX(i),z=a.getZ(i),angle=Math.atan2(z,x),r=Math.hypot(x,z);if(r>.01){const offset=.007*Math.cos(angle*24);a.setX(i,x*(1+offset/r));a.setZ(i,z*(1+offset/r))}}
  g.translate(0,h/2,0);g.computeVertexNormals();return g
 }
 if(kind==='leaf29') {
  const g=new THREE.SphereGeometry(1,12,8),a=g.attributes.position
  for(let i=0;i<a.count;i++){const y=a.getY(i),x=a.getX(i);a.setXYZ(i,x*w/2*(1-Math.abs(y)*.5),y*h/2,a.getZ(i)*d/2+.06*Math.sin((y+1)*Math.PI/2)+.016*Math.abs(x))}
  g.computeVertexNormals();return g
 }
 return null
}
