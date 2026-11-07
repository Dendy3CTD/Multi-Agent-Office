/* MAO-GFX-21: reproducible, dependency-free stylized office asset generator.
 * Authoring coordinates are (x, depth, height); exported coordinates are Y-up.
 * Every asset is project-owned geometry. No external files are downloaded.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { createHash } from 'node:crypto'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { studioGeometry } from './studio-geometry.mjs'
import { studioParts } from './studio-models.mjs'
import { premiumParts, premiumCharacter } from './premium-models.mjs'

const root = resolve(new URL('../../public/office-art/v1/', import.meta.url).pathname)
const materials = [
  ['oak', [0.74, 0.62, 0.44, 1], 0.72, 0.02, 'oak-light.svg'],
  ['brick', [0.72, 0.46, 0.34, 1], 0.84, 0, 'brick-warm.svg'],
  ['wall', [0.86, 0.83, 0.76, 1], 0.9, 0, 'cream-wall.svg'],
  ['metal', [0.14, 0.17, 0.18, 1], 0.34, 0.78, null],
  ['bronze', [0.58, 0.37, 0.18, 1], 0.29, 0.82, 'bronze-brushed.svg'],
  ['glass', [0.66, 0.83, 0.85, 0.22], 0.14, 0.04, 'glass-tint.svg'],
  ['darkglass', [0.08, 0.15, 0.18, 0.92], 0.12, 0.18, null],
  ['fabric', [0.38, 0.48, 0.42, 1], 0.94, 0, 'fabric-sage.svg'],
  ['fabric-forest', [0.065,0.18,0.11,1],0.97,0,'studio-fabric.svg'],
  ['fabric-clay', [0.62,0.25,0.15,1],0.96,0,'studio-fabric.svg'],
  ['fabric-blue', [0.25, 0.43, 0.48, 1], 0.92, 0, 'fabric-blue.svg'],
  ['carpet', [0.13, 0.16, 0.15, 1], 0.98, 0, 'carpet-woven.svg'],
  ['leaf', [0.13, 0.3, 0.17, 1], 0.82, 0, null],
  ['amber', [1, 0.52, 0.16, 1], 0.28, 0.08, null],
  ['skin', [0.72, 0.42, 0.27, 1], 0.9, 0, null],
  ['skin-deep', [0.32, 0.15, 0.085, 1], 0.86, 0, null],
  ['skin-light', [0.88, 0.66, 0.48, 1], 0.88, 0, null],
  ['hair', [0.055, 0.038, 0.028, 1], 0.82, 0, null],
  ['shoe', [0.035, 0.045, 0.05, 1], 0.55, 0.1, null],
  ['ceramic', [0.72, 0.68, 0.58, 1], 0.42, 0.02, 'ceramic-speckle.svg'],
]
const nodes = [], sceneNodes = [], meshes = [], bufferViews = [], accessors = [], chunks = []
const assetRecords = [], animations = []
let byteOffset = 0
const align = value => (value + 3) & ~3
const materialIndex = name => materials.findIndex(([id]) => id === name)
function append(data) { const offset = align(byteOffset); if (offset > byteOffset) chunks.push(Buffer.alloc(offset - byteOffset)); const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength); chunks.push(buf); byteOffset = offset + buf.byteLength; return { offset, length: buf.byteLength } }
function geometry(positions, normals, uvs, indices, material) {
  const p = append(new Float32Array(positions)), n = append(new Float32Array(normals)), u = append(new Float32Array(uvs)), i = append((positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)))
  const pv = bufferViews.push({ buffer: 0, byteOffset: p.offset, byteLength: p.length, target: 34962 }) - 1
  const nv = bufferViews.push({ buffer: 0, byteOffset: n.offset, byteLength: n.length, target: 34962 }) - 1
  const uv = bufferViews.push({ buffer: 0, byteOffset: u.offset, byteLength: u.length, target: 34962 }) - 1
  const iv = bufferViews.push({ buffer: 0, byteOffset: i.offset, byteLength: i.length, target: 34963 }) - 1
  const px = positions.filter((_, k) => k % 3 === 0), py = positions.filter((_, k) => k % 3 === 1), pz = positions.filter((_, k) => k % 3 === 2)
  const pa = accessors.push({ bufferView: pv, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [Math.min(...px), Math.min(...py), Math.min(...pz)], max: [Math.max(...px), Math.max(...py), Math.max(...pz)] }) - 1
  const na = accessors.push({ bufferView: nv, componentType: 5126, count: normals.length / 3, type: 'VEC3' }) - 1
  const ua = accessors.push({ bufferView: uv, componentType: 5126, count: uvs.length / 2, type: 'VEC2' }) - 1
  const ia = accessors.push({ bufferView: iv, componentType: positions.length / 3 > 65535 ? 5125 : 5123, count: indices.length, type: 'SCALAR', min: [0], max: [Math.max(...indices)] }) - 1
  return meshes.push({ name: `${material}-mesh-${meshes.length}`, primitives: [{ attributes: { POSITION: pa, NORMAL: na, TEXCOORD_0: ua }, indices: ia, material: materialIndex(material) }] }) - 1
}
const shapeCache = new Map()
function shape(part) {
  const { size, kind = 'round', extra = {} } = part
  const [w,d,h] = size
  const key = JSON.stringify([size,kind,extra])
  if (shapeCache.has(key)) return shapeCache.get(key).clone()
  let geometry=studioGeometry(part)
  if (geometry) { /* Authored curved/closed studio surface. */ }
  else if (kind === 'box') geometry = new THREE.BoxGeometry(w,h,d)
  else if (kind === 'round') geometry = new RoundedBoxGeometry(w,h,d,1,Math.min(w,h,d)*.18)
  else if (kind === 'sphere' || kind === 'ellipsoid' || kind === 'leaf') {
    geometry = new THREE.SphereGeometry(1,12,8)
    geometry.scale(w/2,h/2,d/2)
    if(kind === 'leaf') { const a=geometry.attributes.position; for(let i=0;i<a.count;i++) a.setX(i,a.getX(i)*(1-Math.abs(a.getY(i)/(h/2))*.6)); geometry.computeVertexNormals() }
  } else if (kind === 'cylinder' || kind === 'taper') {
    geometry = new THREE.CylinderGeometry(kind === 'taper' ? d : w,w,h,12,1,false)
    geometry.translate(0,h/2,0)
  } else if (kind === 'rod') {
    const [start,end]=extra.between.map(([x,z,y])=>new THREE.Vector3(x,y,z))
    const axis=end.clone().sub(start)
    geometry = new THREE.CylinderGeometry(w,w,axis.length(),10,1,false)
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize()))
    geometry.translate(...start.clone().add(end).multiplyScalar(.5).toArray())
  } else throw new Error(`unknown shape ${kind}`)
  if (geometry.index) geometry = geometry.toNonIndexed()
  if(extra.rotation) geometry.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...extra.rotation)))
  shapeCache.set(key,geometry.clone())
  return geometry
}
const meshCache=new Map()
function meshFor(geometryData,material,key) {
  const indexed=mergeVertices(geometryData,1e-6)
  key=material+createHash("sha256").update(Buffer.from(indexed.attributes.position.array.buffer)).update(Buffer.from(indexed.attributes.normal.array.buffer)).update(Buffer.from(indexed.attributes.uv.array.buffer)).update(Buffer.from(indexed.index.array.buffer)).digest("hex")
  if(meshCache.has(key))return meshCache.get(key)
  const a=indexed.attributes, count=a.position.count
  const mesh=geometry(Array.from(a.position.array),Array.from(a.normal.array),Array.from(a.uv.array),indexed.index ? Array.from(indexed.index.array) : Array.from({length:count},(_,i)=>i),material)
  meshCache.set(key,mesh);return mesh
}
function part(assetName, descriptor) {
  const {id,size,material,translation=[0,0,0],extra={}}=descriptor
  const data=shape(descriptor)
  const mesh=meshFor(data,material,JSON.stringify([size,descriptor.kind,extra,material]))
  if(assetName==='elevator.doors') {
    const accents=mergeGeometries([...[-.46,.46].map(x=>{const g=shape({size:[.012,.014,2.2],kind:'round'});g.translate(x,0,-.042);return g}),...[-.75,0,.75].map(y=>{const g=shape({size:[.86,.006,.008],kind:'round'});g.translate(0,y,-.042);return g})],false)
    const trim=meshFor(accents,'metal',`door-inlay`)
    if(meshes[mesh].primitives.length===1) meshes[mesh].primitives.push(...meshes[trim].primitives)
  }
  const [x,z,y]=translation
  return nodes.push({ name:`${assetName}.${id}`,mesh,translation:[x,y,z],...(extra.extras?{extras:extra.extras}:{}) })-1
}
function asset(name, original, bounds, anchor='floor-center', variants) {
  const parts=studioParts(name,premiumParts(name,original))
  // Preserve interaction pivots and audited floor/wall/torso nodes. Batch other
  // stationary parts per material; no runtime or renderer changes are required.
  const preserve=p=>name==='elevator.doors'||p.id==='slab'||p.id==='brick'||p.id==='wall'||p.id==='body'&&name.startsWith('character.')
  const children=parts.filter(preserve).map(p=>part(name,p))
  const buckets=new Map()
  for(const p of parts.filter(p=>!preserve(p))) {
    const g=shape(p),[x,z,y]=p.translation??[0,0,0];g.translate(x,y,z)
    const bucket=buckets.get(p.material)??[];bucket.push(g);buckets.set(p.material,bucket)
  }
  for(const [material,list] of buckets) {
    const data=mergeGeometries(list,false)
    const mesh=meshFor(data,material,`${name}:${material}`)
    children.push(nodes.push({name:`${name}.detail-${material}`,mesh})-1)
  }
  const root=nodes.push({name,children})-1;sceneNodes.push(root)
  const measured=new THREE.Box3()
  for(const child of children) {
    const node=nodes[child],mesh=meshes[node.mesh]
    for(const primitive of mesh.primitives) {
      const a=accessors[primitive.attributes.POSITION], offset=new THREE.Vector3(...(node.translation??[0,0,0]))
      measured.union(new THREE.Box3(new THREE.Vector3(...a.min).add(offset),new THREE.Vector3(...a.max).add(offset)))
    }
  }
  assetRecords.push({id:name,url:'/office-art/v1/office-pack.glb',node:name,type:'model',scale:1,origin:[0,0,0],anchor,bounds:measured.getSize(new THREE.Vector3()).toArray(),license:'Project-owned',source:'MAO-GFX-29 authored studio geometry',...(variants?{variants}: {})})
  return {root,children}
}
const leg=(x,y,z=.7,m='metal')=>({id:`leg-${x}-${y}`,size:[.08,.08,z],material:m,translation:[x,y,z/2]})
asset('floor.oak.light',[{id:'slab',size:[12,9,.12],material:'oak',translation:[0,0,.06]}],[12,.12,9],'bottom-center')
asset('wall.brick.loft',[{id:'brick',size:[12,.22,3.5],material:'brick',translation:[0,0,1.75]}],[12,3.5,.22],'bottom-center')
asset('wall.painted',[{id:'wall',size:[12,.18,3.5],material:'wall',translation:[0,0,1.75]}],[12,3.5,.18],'bottom-center')
asset('desk.modern',[{id:'top',size:[1.5,.72,.1],material:'oak',translation:[0,0,.78]},{id:'edge',size:[1.42,.05,.08],material:'oak',translation:[0,-.36,.75]},{id:'cable-tray',size:[.82,.16,.05],material:'metal',translation:[0,.08,.67]},leg(-.62,-.25),leg(.62,-.25),leg(-.62,.25),leg(.62,.25)],[1.5,.82,.72],undefined,['light-oak','graphite'])
asset('chair.ergonomic', [
  { id:'seat', size:[.55,.55,.12], material:'fabric', translation:[0,0,.48] },
  { id:'back', size:[.5,.12,.68], material:'fabric', translation:[0,.22,.83] },
  { id:'headrest', size:[.3,.08,.16], material:'fabric', translation:[0,.2,1.18] },
  { id:'arm-left', size:[.06,.34,.06], material:'metal', translation:[-.25,.02,.68] },
  { id:'arm-right', size:[.06,.34,.06], material:'metal', translation:[.25,.02,.68] },
  { id:'stem', size:[.07,.07,.42], material:'metal', translation:[0,0,.22] },
  { id:'base', size:[.5,.08,.04], material:'metal', translation:[0,0,.03] },
  { id:'wheel-a', size:[.07,.07,.07], material:'metal', translation:[-.2,-.18,.03], kind:'cylinder' },
  { id:'wheel-b', size:[.07,.07,.07], material:'metal', translation:[.2,-.18,.03], kind:'cylinder' },
], [.55,1.2,.55], undefined, ['graphite','sage'])
asset('monitor.single',[{id:'bezel',size:[.64,.06,.4],material:'metal',translation:[0,0,1.04]},{id:'screen',size:[.54,.015,.3],material:'darkglass',translation:[0,-.034,1.04]},{id:'stand',size:[.07,.07,.22],material:'metal',translation:[0,0,.84]},{id:'foot',size:[.28,.18,.025],material:'metal',translation:[0,0,.73]}],[.64,.5,.06],'desk-top')
asset('monitor.dual',[{id:'left-bezel',size:[.6,.06,.38],material:'metal',translation:[-.31,0,1.04]},{id:'right-bezel',size:[.6,.06,.38],material:'metal',translation:[.31,0,1.04]},{id:'display-left',size:[.5,.015,.28],material:'darkglass',translation:[-.31,-.034,1.04]},{id:'display-right',size:[.5,.015,.28],material:'darkglass',translation:[.31,-.034,1.04]},{id:'stand',size:[.07,.07,.22],material:'metal',translation:[0,0,.84]},{id:'foot',size:[.5,.18,.025],material:'metal',translation:[0,0,.73]}],[1.2,.5,.06],'desk-top')
asset('keyboard',[{id:'body',size:[.5,.2,.035],material:'metal',translation:[0,0,.84]},{id:'keys',size:[.42,.14,.012],material:'wall',translation:[0,-.012,.865]},{id:'mouse',size:[.09,.14,.025],material:'darkglass',translation:[.35,0,.85]}],[.5,.04,.2],'desk-top')
asset('desk.lamp',[{id:'base',size:[.2,.2,.04],material:'metal',translation:[0,0,.84]},{id:'stem',size:[.035,.035,.34],material:'bronze',translation:[0,0,1.02]},{id:'shade',size:[.22,.18,.12],material:'amber',translation:[0,0,1.2]}],[.22,.42,.2],'desk-top')
asset('bookshelf',[{id:'case',size:[1.3,.35,2.1],material:'oak',translation:[0,0,1.05]},{id:'shelf-a',size:[1.08,.3,.05],material:'oak',translation:[0,0,.62]},{id:'shelf-b',size:[1.08,.3,.05],material:'oak',translation:[0,0,1.12]},{id:'books',size:[.25,.22,.38],material:'brick',translation:[-.35,-.04,.84]},{id:'books2',size:[.22,.22,.32],material:'leaf',translation:[.05,-.04,1.32]},{id:'books3',size:[.18,.22,.4],material:'bronze',translation:[.32,-.04,1.32]}],[1.3,2.1,.35])
asset('filing.cabinet',[{id:'body',size:[.75,.65,1.25],material:'metal',translation:[0,0,.62]},{id:'drawer-a',size:[.55,.03,.08],material:'wall',translation:[0,-.34,.82]},{id:'drawer-b',size:[.55,.03,.08],material:'wall',translation:[0,-.34,.57]},{id:'handle',size:[.18,.03,.025],material:'bronze',translation:[0,-.37,.84]}],[.75,1.25,.65])
asset('table.meeting',[{id:'top',size:[2.8,1.2,.12],material:'oak',translation:[0,0,.75]},leg(-1.1,-.42,.7),leg(1.1,-.42,.7),leg(-1.1,.42,.7),leg(1.1,.42,.7)],[2.8,1.45,1.2])
asset('chair.meeting',[{id:'seat',size:[.48,.48,.1],material:'fabric-blue',translation:[0,0,.48]},{id:'back',size:[.46,.08,.62],material:'fabric-blue',translation:[0,.2,.82]},leg(0,0,.42)],[.48,1.1,.48])
asset('sofa.cozy',[{id:'seat',size:[2.2,.78,.42],material:'fabric',translation:[0,0,.35]},{id:'back',size:[2.2,.2,.95],material:'fabric',translation:[0,.28,.8]},{id:'arm-left',size:[.16,.8,.62],material:'fabric',translation:[-1.02,0,.58]},{id:'arm-right',size:[.16,.8,.62],material:'fabric',translation:[1.02,0,.58]},{id:'cushion-a',size:[.72,.15,.42],material:'fabric-blue',translation:[-.55,.13,.48]},{id:'cushion-b',size:[.72,.15,.42],material:'fabric-blue',translation:[.55,.13,.48]}],[2.2,1.2,.78])
asset('table.coffee',[{id:'top',size:[1.1,.65,.09],material:'oak',translation:[0,0,.42]},leg(-.35,-.18,.4,'bronze'),leg(.35,-.18,.4,'bronze'),leg(-.35,.18,.4,'bronze'),leg(.35,.18,.4,'bronze')],[1.1,.45,.65])
asset('lamp.standing',[{id:'base',size:[.4,.4,.05],material:'metal',translation:[0,0,.03]},{id:'pole',size:[.06,.06,2.1],material:'bronze',translation:[0,0,1.08]},{id:'shade',size:[.5,.35,.2],material:'amber',translation:[0,0,2.2]}],[.5,2.3,.4])
asset('plant.potted',[{id:'pot',size:[.45,.45,.45],material:'ceramic',translation:[0,0,.22]},{id:'trunk',size:[.08,.08,.65],material:'bronze',translation:[0,0,.75]},{id:'leaves',size:[.8,.5,1.3],material:'leaf',translation:[0,0,1.05]}],[.8,1.7,.5])
asset('rug.area',[{id:'woven',size:[2.8,1.8,.025],material:'carpet',translation:[0,0,.015]}],[2.8,.025,1.8],'bottom-center')
asset('armchair.cozy',[{id:'seat',size:[.82,.78,.4],material:'fabric',translation:[0,0,.34]},{id:'back',size:[.82,.18,1.0],material:'fabric',translation:[0,.28,.78]},{id:'arm-left',size:[.14,.7,.58],material:'fabric',translation:[-.4,0,.55]},{id:'arm-right',size:[.14,.7,.58],material:'fabric',translation:[.4,0,.55]}],[.96,1.1,.9])
asset('pendant.led',[{id:'wire',size:[.025,.025,1.1],material:'metal',translation:[0,0,1.75]},{id:'shade',size:[.7,.35,.16],material:'metal',translation:[0,0,1.18]},{id:'glow',size:[.48,.12,.025],material:'amber',translation:[0,-.02,1.08]}],[.7,1.1,.35],'floor-center')
asset('wall.decoration',[{id:'frame',size:[.9,.06,.65],material:'bronze',translation:[0,0,.5]},{id:'art',size:[.75,.02,.5],material:'fabric-blue',translation:[0,-.04,.5]}],[.9,.65,.06],'wall-center')
asset('partition.glass',[{id:'glass',size:[2.4,.06,2.2],material:'glass',translation:[0,0,1.1]},{id:'frame',size:[.08,.08,2.3],material:'metal',translation:[-1.2,0,1.1]},{id:'frame2',size:[.08,.08,2.3],material:'metal',translation:[1.2,0,1.1]}],[2.4,2.3,.08])
asset('window.frame',[{id:'glass',size:[2.4,.08,1.5],material:'glass',translation:[0,0,1.5]},{id:'left',size:[.08,.12,1.7],material:'metal',translation:[-1.2,0,1.5]},{id:'right',size:[.08,.12,1.7],material:'metal',translation:[1.2,0,1.5]},{id:'cross',size:[2.4,.12,.06],material:'metal',translation:[0,0,1.5]}],[2.4,1.7,.12],'wall-center')
function character(name,shirt,status) {
 const alternatives=[`${name}.variant-1`,`${name}.variant-2`]
 asset(name,premiumCharacter(name,shirt,status),[.6,1.62,.8],undefined,[name,...alternatives])
 for(let index=0;index<2;index++) {
   const palette=index?'fabric':'brick'
   const parts=premiumCharacter(alternatives[index],palette,status,index+2).map(part=>({...part,material:part.material==='skin'?(index?'skin-light':'skin-deep'):part.material}))
   asset(alternatives[index],parts,[.6,1.62,.8])
 }
}
character('character.base.idle','fabric-blue','idle'); character('character.base.working','fabric-blue','working'); character('character.base.selected','fabric','selected'); character('character.base.blocked','brick','blocked')
assetRecords.push({id:'character.base',url:'/office-art/v1/office-pack.glb',node:'character.base.idle',type:'model',scale:1,origin:[0,0,0],anchor:'floor-center',bounds:[.42,1.62,.3],license:'Project-owned',source:'MAO-GFX-21 procedural geometry',variants:['character.base.idle','character.base.working','character.base.selected','character.base.blocked']})
asset('preview.workstation',[{id:'desk',size:[1.5,.72,.09],material:'oak',translation:[0,0,.78]},{id:'chair',size:[.55,.55,.12],material:'fabric',translation:[0,.65,.48]},{id:'monitor',size:[.64,.06,.4],material:'metal',translation:[0,0,1.04]},{id:'screen',size:[.54,.015,.3],material:'darkglass',translation:[0,-.04,1.04]},{id:'keyboard',size:[.5,.2,.035],material:'metal',translation:[0,0,.84]}],[1.5,1.2,1.4])
asset('preview.office.group',[{id:'desk-a',size:[1.5,.72,.1],material:'oak',translation:[-1,0,.78]},{id:'desk-b',size:[1.5,.72,.1],material:'oak',translation:[1,0,.78]},{id:'desk-c',size:[1.5,.72,.1],material:'oak',translation:[-1,1.3,.78]},{id:'desk-d',size:[1.5,.72,.1],material:'oak',translation:[1,1.3,.78]}],[4,.85,2.2])
asset('preview.meeting.room',[{id:'table',size:[2.8,1.2,.12],material:'oak',translation:[0,0,.75]},{id:'partition',size:[3.5,.06,2.4],material:'glass',translation:[0,1,1.2]}],[3.5,2.4,2.2])
// Elevator parts have explicit parent pivots; doors are animated around their inner edges.
const elevator = asset('elevator.cabin',[{id:'floor',size:[2.2,1.8,.08],material:'oak',translation:[0,0,.04]},{id:'back',size:[2.2,.08,2.6],material:'bronze',translation:[0,.82,1.3]},{id:'ceiling',size:[2.2,1.8,.08],material:'metal',translation:[0,0,2.64]},{id:'side-left',size:[.08,1.8,2.6],material:'metal',translation:[-1.06,0,1.3]},{id:'side-right',size:[.08,1.8,2.6],material:'metal',translation:[1.06,0,1.3]}],[2.2,2.64,1.8])
asset('elevator.frame',[{id:'header',size:[2.5,.18,.18],material:'bronze',translation:[0,-.92,2.55]},{id:'left',size:[.18,.18,2.55],material:'bronze',translation:[-1.16,-.92,1.28]},{id:'right',size:[.18,.18,2.55],material:'bronze',translation:[1.16,-.92,1.28]}],[2.5,2.55,.18])
const doorParts = [{id:'left',kind:'round',size:[1.08,.07,2.38],material:'bronze',translation:[-.54,-.96,1.25],extra:{extras:{animationPivot:'inner-edge',openTranslation:[-.95,0,0]}}},{id:'right',kind:'round',size:[1.08,.07,2.38],material:'bronze',translation:[.54,-.96,1.25],extra:{extras:{animationPivot:'inner-edge',openTranslation:[.95,0,0]}}}]
const doors = asset('elevator.doors',doorParts,[2.16,2.38,.07]); const leftDoor=doors.children[0], rightDoor=doors.children[1]
const times=append(new Float32Array([0,1]))
const tv=bufferViews.push({buffer:0,byteOffset:times.offset,byteLength:times.length})-1
const ta=accessors.push({bufferView:tv,componentType:5126,count:2,type:'SCALAR',min:[0],max:[1]})-1
const samplers=[],channels=[]
for(const [index,node] of [leftDoor,rightDoor].entries()) {
 const base=nodes[node].translation, end=[base[0]+(index? .95:-.95),base[1],base[2]]
 const data=append(new Float32Array([...base,...end])), view=bufferViews.push({buffer:0,byteOffset:data.offset,byteLength:data.length})-1
 const output=accessors.push({bufferView:view,componentType:5126,count:2,type:'VEC3'})-1
 samplers.push({input:ta,output,interpolation:'LINEAR'});channels.push({sampler:index,target:{node,path:'translation'}})
}
animations.push({name:'elevator.doors.open',samplers,channels})
asset('elevator.display',[{id:'housing',size:[.42,.05,.22],material:'metal',translation:[0,-1.03,2.77]},{id:'screen',size:[.28,.015,.1],material:'darkglass',translation:[0,-1.06,2.77]}],[.42,.22,.05],'wall-center')
asset('elevator.call-panel',[{id:'plate',size:[.3,.04,.6],material:'metal',translation:[-1.38,-.98,1.15]},{id:'button',size:[.08,.03,.08],material:'amber',translation:[-1.38,-1.01,1.3],kind:'cylinder'}],[.3,.6,.04],'wall-center')
asset('elevator.floor-sign',[{id:'plate',size:[.6,.04,.22],material:'bronze',translation:[0,-1.02,2.28]},{id:'number',size:[.3,.015,.1],material:'amber',translation:[0,-1.05,2.28]}],[.6,.22,.04],'wall-center')
asset('elevator.wall-lights',[{id:'left',size:[.08,.05,1.8],material:'amber',translation:[-1.27,.0,1.3]},{id:'right',size:[.08,.05,1.8],material:'amber',translation:[1.27,.0,1.3]}],[.08,1.8,.05])
asset('door.office.glass',[
 {id:'glazing',size:[.84,.035,2.1],material:'glass',translation:[0,0,1.12]},
 ...[-1,1].map(s=>({id:`jamb-${s}`,size:[.045,.07,2.25],material:'metal',translation:[s*.46,0,1.125]})),
 {id:'header',size:[.96,.07,.045],material:'metal',translation:[0,0,2.25]},
 {id:'handle',size:[.025,.065,.3],material:'bronze',translation:[.32,-.07,1.1]}
],[.96,2.3,.14])
asset('decor.wall.sconce',[{id:'backplate',size:[.14,.05,.3],material:'metal',translation:[0,0,.15]},{id:'shade',size:[.12,.08,.18],kind:'shade',material:'bronze',translation:[0,-.14,.12]},{id:'diffuser',size:[.11,.11,.008],kind:'disc',material:'amber',translation:[0,-.14,.12]}],[.24,.3,.3],'wall-center')
const legacyMaterialIds={oak:'material.floor.oak.light',brick:'material.wall.brick',wall:'material.wall.painted',metal:'material.black.metal',glass:'material.clear.glass',fabric:'material.upholstery.fabric',carpet:'material.carpet',leaf:'material.plant.leaf',amber:'material.light.amber',skin:'material.character.skin','fabric-blue':'material.character.shirt'}
for(const record of assetRecords) if(record.id==='character.base') record.bounds=assetRecords.find(asset=>asset.id==='character.base.idle').bounds
const materialAssets = materials.map(([id])=>({id:legacyMaterialIds[id]??`material.${id}`,url:'/office-art/v1/materials.json',type:'material',scale:1,origin:[0,0,0],anchor:'surface',bounds:[0,0,0],license:'Project-owned',source:'Local PBR material library'}))
const textureIds={ 'oak-light.svg':'texture.oak.light','brick-warm.svg':'texture.wall.brick.warm','fabric-sage.svg':'texture.fabric.sage','fabric-blue.svg':'texture.fabric.blue','carpet-woven.svg':'texture.carpet.charcoal' }
const textureAssets = materials.filter(m=>m[4]).map(m=>({id:textureIds[m[4]]??`texture.${m[0]}`,url:`/office-art/v1/textures/${m[4]}`,type:'material',scale:1,origin:[0,0,0],anchor:'surface',bounds:[0,0,0],license:'Project-owned',source:'Local procedural SVG texture'}))
const document={asset:{version:'2.0',generator:'MAO-GFX-29 premium studio pack'},scene:0,scenes:[{nodes:sceneNodes}],nodes,meshes,materials:materials.map(([id,c,r,m])=>({name:id,pbrMetallicRoughness:{baseColorFactor:c,metallicFactor:m,roughnessFactor:r},alphaMode:c[3]<1?'BLEND':'OPAQUE',...(id==='glass'?{doubleSided:true}:{}),...(id==='amber'?{emissiveFactor:[.8,.34,.08]}:{})})),accessors,bufferViews,buffers:[{byteLength:byteOffset}],animations}
const json=Buffer.from(JSON.stringify(document)), jp=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]), binary=Buffer.concat(chunks), bp=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]), glb=Buffer.concat([Buffer.from([0x67,0x6c,0x54,0x46,2,0,0,0,0,0,0,0]),Buffer.alloc(8),jp,Buffer.alloc(8),bp]); glb.writeUInt32LE(glb.length,8); glb.writeUInt32LE(jp.length,12); glb.writeUInt32LE(0x4e4f534a,16); glb.writeUInt32LE(bp.length,20+jp.length); glb.writeUInt32LE(0x004e4942,24+jp.length)
await mkdir(resolve(root,'textures'),{recursive:true}); await writeFile(resolve(root,'office-pack.glb'),glb)
const textureSvg={ 'oak-light.svg':'<rect width="256" height="256" fill="#c79762"/><g stroke="#8a5e36" opacity=".42"><path d="M0 34h256M0 86h256M0 142h256M0 202h256"/><path d="M32 0v256M160 0v256"/></g>', 'brick-warm.svg':'<rect width="256" height="128" fill="#a9573d"/><g stroke="#e0a080" stroke-width="4" fill="none"><path d="M0 42h256M0 86h256M64 0v42M192 0v42M128 42v44M32 86v42M224 86v42"/></g>', 'cream-wall.svg':'<rect width="64" height="64" fill="#e4dfd2"/><path d="M0 32h64M32 0v64" stroke="#d5d0c3" opacity=".3"/>', 'bronze-brushed.svg':'<rect width="128" height="128" fill="#c6a67c"/><path d="M0 12h128M0 40h128M0 72h128M0 104h128" stroke="#d7a26b" opacity=".35"/>', 'glass-tint.svg':'<rect width="128" height="128" fill="#3d7180" fill-opacity=".22"/><path d="M0 128L128 0" stroke="#d2f1e9" opacity=".28"/>', 'fabric-sage.svg':'<rect width="128" height="128" fill="#526b65"/><path d="M0 0l128 128M-32 0l160 160M0 128L128 0" stroke="#a0b8ae" opacity=".25"/>', 'fabric-blue.svg':'<rect width="128" height="128" fill="#315663"/><path d="M0 0l128 128M-32 0l160 160" stroke="#8fb0b6" opacity=".22"/>', 'carpet-woven.svg':'<rect width="128" height="128" fill="#293331"/><path d="M0 4h128M0 12h128M4 0v128M12 0v128" stroke="#718078" opacity=".2"/>', 'ceramic-speckle.svg':'<rect width="128" height="128" fill="#b8ad96"/><circle cx="24" cy="32" r="2" fill="#817967"/><circle cx="84" cy="76" r="2" fill="#817967"/><circle cx="48" cy="108" r="1.5" fill="#817967"/>' }
textureSvg['oak-light.svg']='<rect width="256" height="256" fill="#e1c39a"/><g stroke="#765d42" opacity=".22"><path d="M0 34h256M0 86h256M0 142h256M0 202h256"/><path d="M32 0v256M160 0v256"/></g>'
textureSvg['brick-warm.svg']='<rect width="256" height="256" fill="#bc765c"/><g stroke="#e2aa8f" stroke-width="3" opacity=".42" fill="none"><path d="M0 42h256M0 86h256M0 130h256M0 174h256M0 218h256M64 0v42M192 0v42M128 42v44M64 86v44M192 130v44M128 174v44"/></g>'
textureSvg['cream-wall.svg']='<rect width="256" height="256" fill="#e4dfd2"/><path d="M0 32h256M32 0v256M0 96h256M96 0v256M0 160h256M160 0v256M0 224h256M224 0v256" stroke="#d5d0c3" opacity=".3"/>'
textureSvg['glass-tint.svg']='<rect width="256" height="256" fill="#d6e7e6" fill-opacity="1"/><path d="M0 256L256 0M64 256L256 64" stroke="#e0f6ed" opacity=".38"/>'
textureSvg['bronze-brushed.svg']='<rect width="256" height="256" fill="#c6a67c"/><path d="M0 24h256M0 80h256M0 136h256M0 192h256" stroke="#d7a26b" opacity=".35"/>'
textureSvg['fabric-sage.svg']='<rect width="256" height="256" fill="#79958a"/><path d="M0 0l256 256M-64 0l320 320M0 256L256 0" stroke="#d8e4dc" opacity=".28"/>'
textureSvg['fabric-blue.svg']='<rect width="256" height="256" fill="#487b88"/><path d="M0 0l256 256M-64 0l320 320" stroke="#c2e0df" opacity=".25"/>'
textureSvg['carpet-woven.svg']='<rect width="256" height="256" fill="#293331"/><path d="M0 8h256M0 24h256M8 0v256M24 0v256" stroke="#718078" opacity=".2"/>'
textureSvg['ceramic-speckle.svg']='<rect width="256" height="256" fill="#b8ad96"/><circle cx="24" cy="32" r="2" fill="#817967"/><circle cx="84" cy="76" r="2" fill="#817967"/><circle cx="48" cy="108" r="1.5" fill="#817967"/><circle cx="190" cy="158" r="2" fill="#817967"/>'
textureSvg['oak-light.svg']='<rect width="256" height="256" fill="#e1c39a"/><g fill="none" stroke="#98784e" opacity=".18" stroke-width="1">'+Array.from({length:16},(_,i)=>`<path d="M0 ${i*16} Q64 ${i*16-9} 128 ${i*16} T256 ${i*16}"/>`).join('')+'</g><path d="M0 0h256v256H0zM0 128h256" fill="none" stroke="#aa875d" opacity=".22"/>'
textureSvg['studio-fabric.svg']='<rect width="256" height="256" fill="#cdc7bb"/><g stroke="#79756e" opacity=".16" stroke-width="1">'+Array.from({length:64},(_,i)=>`<path d="M${i*4} 0v256M0 ${i*4}h256"/>`).join('')+'</g>'
for(const [file,body] of Object.entries(textureSvg)) await writeFile(resolve(root,'textures',file),`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">${body}</svg>`)
const mappingIds={oak:'material.floor.oak.light',brick:'material.wall.brick',wall:'material.wall.painted',metal:'material.black.metal',glass:'material.clear.glass',fabric:'material.upholstery.fabric',carpet:'material.carpet',leaf:'material.plant.leaf',amber:'material.light.amber',skin:'material.character.skin','fabric-blue':'material.character.shirt'}
const mappings={}; for(const [id,, , ,texture] of materials) mappings[mappingIds[id]??`material.${id}`]={glbMaterialName:id,libraryKey:id,...(texture?{textureUrl:`/office-art/v1/textures/${texture}`}:{})}
const descriptors=Object.fromEntries(materials.map(([id,c,r,m,t])=>[id,{baseColorFactor:c,roughness:r,metallic:m,...(id==='glass'?{doubleSided:true}:{}),...(id==='amber'?{emissiveFactor:[.8,.34,.08]}:{}),...(t?{baseColorTexture:{url:`/office-art/v1/textures/${t}`,colorSpace:'srgb',wrapS:'repeat',wrapT:'repeat',repeat:[4,4]}}:{})}]))
await writeFile(resolve(root,'materials.json'),JSON.stringify({version:2,units:'linear-srgb',colorSpace:'srgb',materials:descriptors,mappings},null,2))
await writeFile(resolve(root,'manifest.json'),JSON.stringify({schemaVersion:1,packId:'mao-office-art-v2',coordinateSystem:'right-handed, Y-up, metres',defaultScale:1,assets:[...assetRecords,...materialAssets,...textureAssets]},null,2))
