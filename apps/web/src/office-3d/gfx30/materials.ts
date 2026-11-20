import * as THREE from 'three';
import type { PremiumArchitecture } from '../gfx29/architecture';

export type SetName = 'oak-floor'|'terracotta-brick'|'desk-oak'|'walnut-shelf'|'warm-plaster'|'forest-upholstery'|'terracotta-upholstery'|'ivory-rug'|'brushed-bronze'|'graphite-metal'|'walnut-slats';
const definitions: Record<SetName, {repeat:[number,number];metalness:number}> = {
 'oak-floor':{repeat:[5,3],metalness:0},'terracotta-brick':{repeat:[1,1],metalness:0},'desk-oak':{repeat:[1,1],metalness:0},'walnut-shelf':{repeat:[1,1],metalness:0},'warm-plaster':{repeat:[2,2],metalness:0},'forest-upholstery':{repeat:[2,2],metalness:0},'terracotta-upholstery':{repeat:[2,2],metalness:0},'ivory-rug':{repeat:[3,3],metalness:0},'brushed-bronze':{repeat:[1,2],metalness:.7},'graphite-metal':{repeat:[2,2],metalness:.55},'walnut-slats':{repeat:[1,1],metalness:0},
};
/** One scene-scoped set of textures and materials. Call cleanup before other scene owners. */
export async function applyGfx30Materials(root:THREE.Object3D, architecture:PremiumArchitecture, signal:AbortSignal) {
 const textures:THREE.Texture[]=[]; const materials=new Map<SetName,THREE.MeshStandardMaterial>(); const geometries:THREE.BufferGeometry[]=[];
 const assignments=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>(); const hidden:THREE.Object3D[]=[];
 const additions=new THREE.Group(); additions.name='gfx30-finishing'; root.add(additions);
 let disposed=false;
 const cleanup=()=>{if(disposed)return;disposed=true;for(const [mesh,original] of assignments)mesh.material=original; for(const item of hidden)item.visible=true;additions.removeFromParent();for(const g of geometries)g.dispose();for(const m of materials.values())m.dispose();for(const m of extraMaterials)m.dispose();for(const t of textures)t.dispose();};
 const extraMaterials:THREE.Material[]=[];
 const loader=new THREE.TextureLoader();
 try {
  const load=async(url:string,srgb:boolean,repeat:[number,number])=>{const t=await loader.loadAsync(url);textures.push(t);if(signal.aborted)throw new Error('gfx30_aborted');t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(...repeat);t.anisotropy=4;return t;};
  for(const [name,settings] of Object.entries(definitions) as [SetName,typeof definitions[SetName]][]){
   const base=`/office-art/gfx30/materials/${name}`;
   const map=await load(`${base}/albedo.png`,true,settings.repeat);const normalMap=await load(`${base}/normal.png`,false,settings.repeat);const roughnessMap=await load(`${base}/roughness.png`,false,settings.repeat);
   const mat=new THREE.MeshStandardMaterial({name:`gfx30-${name}`,map,normalMap,roughnessMap,roughness:1,metalness:settings.metalness});mat.normalScale.set(.18,.18);materials.set(name,mat);
  }
  materials.get('brushed-bronze')!.color.set(0xb7b6b1); materials.get('brushed-bronze')!.normalScale.set(.045,.045); materials.get('brushed-bronze')!.metalness=.48;
  for (const name of ['forest-upholstery','terracotta-upholstery','ivory-rug'] as const) materials.get(name)!.normalScale.set(.065,.065);
  const city=await load('/office-art/gfx30/city-skyline-golden-hour.png',true,[1,1]);city.wrapS=city.wrapT=THREE.ClampToEdgeWrapping;
  const replace=(mesh:THREE.Mesh,material:THREE.Material)=>{if(!assignments.has(mesh))assignments.set(mesh,mesh.material);mesh.material=material;};
  const hasAncestor=(node:THREE.Object3D,key:string)=>{for(let p:THREE.Object3D|null=node;p;p=p.parent)if(p.name===key||p.userData.officeAssetId===key)return true;return false;};
  root.traverse(node=>{const mesh=node as THREE.Mesh;if(!mesh.isMesh)return;
   const names=[...(mesh.userData.maoMaterialRoles ?? []),...(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>m.name)].join(' ').toLowerCase();
   let key:SetName|undefined;
   if(hasAncestor(mesh,'floor.oak.light'))key='oak-floor';
   else if(mesh.name==='side-wall')key='warm-plaster';
   else if(hasAncestor(mesh,'desk.modern')&&/oak|wood/.test(names))key='desk-oak';
   else if((hasAncestor(mesh,'bookshelf--9.5')||hasAncestor(mesh,'bookshelf-9.5'))&&/oak|wood/.test(names))key='walnut-shelf';
   else if(hasAncestor(mesh,'lounge-sofa')&&/fabric/.test(names))key='forest-upholstery';
   else if(hasAncestor(mesh,'lounge-chair')&&/fabric/.test(names))key='terracotta-upholstery';
   else if((hasAncestor(mesh,'lounge-rug')||hasAncestor(mesh,'meeting-rug'))&&/carpet|linen/.test(names))key='ivory-rug';
   else if((hasAncestor(mesh,'elevator.doors')||hasAncestor(mesh,'elevator.frame'))&&/bronze/.test(names))key='brushed-bronze';
   else if(hasAncestor(mesh,'elevator.frame')&&/metal/.test(names))key='graphite-metal';
   if(key)replace(mesh,materials.get(key)!);
  });
  // Replace the instanced decorative brick units with five textured structural panels.
  for(const name of ['brick-wall','brick-wall-backing','sky','skyline','city-windows','distant-skyline','city-spires','city-canopies']){const o=architecture.getObjectByName(name);if(o){hidden.push(o);o.visible=false;}}
  const brick=materials.get('terracotta-brick')!;
  const panel=(x:number,y:number,w:number,h:number)=>{const geo=new THREE.BoxGeometry(w,h,.21);geometries.push(geo);const uv=geo.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*w/1.4,uv.getY(i)*h/1.3);const mesh=new THREE.Mesh(geo,brick);mesh.position.set(x,y+.12,6.88);mesh.receiveShadow=true;mesh.castShadow=true;additions.add(mesh);};
  panel(0,.55,22,1.1);panel(0,5.1,22,1.4);panel(-9.2,2.75,3.6,3.3);panel(0,2.75,2.4,3.3);panel(9.2,2.75,3.6,3.3);
  const cityMat=new THREE.MeshBasicMaterial({map:city,color:0xffecd4});extraMaterials.push(cityMat);
  for(const [index,x] of [-4.3,4.3].entries()) {
   const cityGeo=new THREE.PlaneGeometry(7.8,3.6);geometries.push(cityGeo);
   // A continuous panorama rather than the same compressed city in both windows.
   const uv=cityGeo.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,uv.getX(i)*.5+index*.5);
   const skyline=new THREE.Mesh(cityGeo,cityMat);skyline.name='skyline';skyline.position.set(x,2.72,8.35);skyline.rotation.y=Math.PI;additions.add(skyline);
  }
  // Shallow timber surround. Keep door and call-panel meshes unobstructed.
  const slats=materials.get('walnut-slats')!;
  const box=(size:[number,number,number],pos:[number,number,number],m:THREE.Material)=>{const g=new THREE.BoxGeometry(...size);geometries.push(g);const mesh=new THREE.Mesh(g,m);mesh.position.set(...pos);additions.add(mesh);};
  box([.08,3.65,.62],[-10.74,1.945,1.13],slats);box([.08,3.65,.62],[-10.74,1.945,4.87],slats);box([.08,.94,4.35],[-10.74,3.30,3],slats);
  const glow=new THREE.MeshStandardMaterial({color:0xffcf7b,emissive:0xffa438,emissiveIntensity:1.8});extraMaterials.push(glow);
  for(const z of [1.62,4.38])box([.035,2.85,.035],[-10.68,1.55,z],glow);
  return {cleanup,textureCount:textures.length, material: (name:SetName)=>materials.get(name)!};
 } catch(error){cleanup();throw error;}
}
