import * as THREE from 'three';
import type { OfficeArtRuntime } from '../../../office-art/loader';
import { diagnoseArchitecture, type Rect, type Workplace, type Obstacle, type ArchitectureDiagnostics } from './navigation';
export type { Rect, Workplace, ArchitectureDiagnostics } from './navigation';
export interface ArchitectureAssetAdapter {
  cloneAsset(id:string):THREE.Object3D|undefined|Promise<THREE.Object3D|undefined>;
  /** Release runtime references, not individual shared geometry or textures. */
  releaseAsset?(object:THREE.Object3D):void;
}
export interface PremiumArchitectureOptions extends ArchitectureAssetAdapter {
  floorBounds:Readonly<Rect>;
  occupiedWorkplaces:readonly Workplace[];
  /** Floor GLB top, in world metres. */
  floorY?:number;
  /** Existing physical elevator; default matches the recessed production lift on the west wall. */
  elevatorBounds?:Obstacle;
  elevatorApproach?:{x:number;z:number};
  signal?:AbortSignal;
  strictPlacement?:boolean;
  /** Retains iteration one composition for reproducible visual comparison. */
  artIteration?:1|2;
}
export interface PremiumArchitecture extends THREE.Group {
  dispose():void;
  metadata:typeof PREMIUM_ARCHITECTURE_METADATA;
  diagnostics:ArchitectureDiagnostics;
  assetBounds:{key:string;id:string;size:[number,number,number];bounds:THREE.Box3;supportY:number}[];
}
export class ArchitectureError extends Error {
  constructor(readonly code:string,readonly assetId?:string,readonly diagnostics?:ArchitectureDiagnostics){super(`${code}${assetId?':'+assetId:''}`);this.name='ArchitectureError';}
}
export const PREMIUM_ARCHITECTURE_METADATA={
  camera:{target:[0,1.4,0] as const,position:[19,20,-23] as const,verticalSpan:23},
  replaceLegacy:['wall.brick.loft','wall.painted','window.frame','partition.glass','door.office.glass','table.meeting','chair.meeting','sofa.cozy','table.coffee','rug.area','armchair.cozy','lamp.standing','bookshelf','filing.cabinet','wall.decoration','pendant.led','decor.wall.sconce'] as const,
  // Logical assembly labels for the integrator; legacy primitives are mostly unnamed.
  replaceLegacyAssemblies:['north-wall-segments','daylight-sky','city-backdrop','skyline','fallback-meeting','fallback-lounge','fallback-pendants'] as const,
  legacyProceduralSelection:{named:['daylight-sky','city-backdrop','skyline','skyline-glow'] as const,unnamed:'Use construction-site references for wall/window/meeting/lounge/pendant primitives; never hide the entire fallbackRoot because it also holds desks and staff.'},
  preserveLegacy:['floor.oak.light','elevator.*','desk.*','monitor.*','keyboard','chair.ergonomic','character.*','camera-controls','floor-layout-engine'] as const,
  coordinateSystem:'Y-up metres; floorBounds/world workplaces; architecture local origin at bounds centre',
} as const;
export const WINDOW_OPENINGS=[{minX:-7.4,maxX:-1.2,bottom:1.1,top:4.4},{minX:1.2,maxX:7.4,bottom:1.1,top:4.4}] as const;

/** Exact runtime API adapter. On material failure the acquired reference is returned immediately. */
export function createArchitectureAssetAdapter(runtime:Pick<OfficeArtRuntime,'createInstance'|'applyMaterials'|'disposeInstance'>):ArchitectureAssetAdapter {
  return {async cloneAsset(id){
    const object=await runtime.createInstance(id);
    try {
      object.traverse(n=>{const m=n as THREE.Mesh;if(m.isMesh)m.userData.maoMaterialRoles=(Array.isArray(m.material)?m.material:[m.material]).map(v=>v.name);});
      await runtime.applyMaterials(object);return object;
    } catch(error){runtime.disposeInstance(object);throw error;}
  },releaseAsset:object=>runtime.disposeInstance(object)};
}

/** Transactional async factory: detached until every required asset is loaded. No partial success. */
export async function createPremiumArchitectureV29(options:PremiumArchitectureOptions):Promise<PremiumArchitecture> {
  const b=options.floorBounds;
  if(!Object.values(b).every(Number.isFinite)||b.maxX-b.minX<21.9||b.maxZ-b.minZ<13.9)throw new ArchitectureError('premium_architecture_requires_22x14_floor');
  if(new Set(options.occupiedWorkplaces.map(w=>w.deskId)).size!==options.occupiedWorkplaces.length||options.occupiedWorkplaces.some(w=>!Number.isFinite(w.x)||!Number.isFinite(w.z)))throw new ArchitectureError('invalid_workplaces');
  const validRect=(r:Rect)=>Object.values(r).every(v=>typeof v!=='number'||Number.isFinite(v))&&Number.isFinite(r.minX)&&Number.isFinite(r.maxX)&&Number.isFinite(r.minZ)&&Number.isFinite(r.maxZ)&&r.minX<r.maxX&&r.minZ<r.maxZ;
  if(options.occupiedWorkplaces.some(w=>(w.bounds&&!validRect(w.bounds))||(w.approach&&(!Number.isFinite(w.approach.x)||!Number.isFinite(w.approach.z))))||(options.elevatorBounds&&!validRect(options.elevatorBounds))||(options.elevatorApproach&&(!Number.isFinite(options.elevatorApproach.x)||!Number.isFinite(options.elevatorApproach.z))))throw new ArchitectureError('invalid_collision_bounds');
  const cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2,y0=options.floorY??.12,iteration=options.artIteration??2;
  if(!Number.isFinite(y0))throw new ArchitectureError('invalid_floor_y');
  const group=new THREE.Group() as PremiumArchitecture;group.name='premium-architecture-v29';group.position.set(cx,0,cz);group.metadata=PREMIUM_ARCHITECTURE_METADATA;group.assetBounds=[];
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>(),assets=new Set<THREE.Object3D>(),obstacles:Obstacle[]=[];
  let disposed=false;
  group.dispose=()=>{if(disposed)return;disposed=true;group.removeFromParent();for(const a of assets){a.removeFromParent();options.releaseAsset?.(a);}assets.clear();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();group.traverse(n=>{if((n as THREE.InstancedMesh).isInstancedMesh)(n as THREE.InstancedMesh).dispose();});group.clear();};
  const check=()=>{if(options.signal?.aborted)throw new ArchitectureError('architecture_aborted');};
  const obstacle=(id:string,x:number,z:number,w:number,d:number)=>obstacles.push({id,minX:cx+x-w/2,maxX:cx+x+w/2,minZ:cz+z-d/2,maxZ:cz+z+d/2});
  const mat=(name:string,color:number,extra:THREE.MeshStandardMaterialParameters={})=>{const m=new THREE.MeshStandardMaterial({name,color,roughness:.85,...extra});materials.add(m);return m;};
  // One reusable unit cube and InstancedMesh batches for compatible static pieces.
  const cube=new THREE.BoxGeometry();geometries.add(cube);
  type Part={size:[number,number,number];pos:[number,number,number];color?:THREE.Color};
  const batches=new Map<string,{material:THREE.Material;parts:Part[];cast:boolean}>();
  const part=(name:string,size:Part['size'],pos:Part['pos'],material:THREE.Material,cast=false,color?:THREE.Color)=>{
    let batch=batches.get(name);if(!batch){batch={material,parts:[],cast};batches.set(name,batch);}batch.parts.push({size,pos,color});
  };
  const brick=mat('brick',0xffffff),mortar=mat('mortar',0x835c4b),graphite=mat('metal',0x3b4141,{metalness:.35,roughness:.46}),oak=mat('oak',0xb68e63),plaster=mat('wall',0xd0c3b0),glass=mat('glass',0xc6dddd,{transparent:true,opacity:.12,depthWrite:false,side:THREE.DoubleSide,roughness:.16}),sky=mat('sky',0xb9cbd1,{emissive:0x536771,emissiveIntensity:.35}),city=mat('city',0x71838d),windowGlow=mat('city-glazing',0xc9d0c8),amber=mat('amber',0xf2cb85,{emissive:0xffc578,emissiveIntensity:.65});
  const texture=(kind:'weave'|'wood'|'brick')=>{
    const size=128,data=new Uint8Array(size*size*4);
    for(let z=0;z<size;z++)for(let x=0;x<size;x++){
      const i=(z*size+x)*4,noise=Math.sin(x*93.1+z*71.7)*.5+.5;
      const base=kind==='weave'?[185,170,146]:kind==='wood'?[179,140,99]:[240,240,240];
      const grain=kind==='weave'?((x%4<2?1:-1)+(z%4<2?1:-1))*5:kind==='wood'?Math.sin(z*.7+Math.sin(x*.03)*.8)*6:(noise-.5)*12;
      for(let c=0;c<3;c++)data[i+c]=base[c]+grain+(noise-.5)*4;data[i+3]=255;
    }
    const t=new THREE.DataTexture(data,size,size);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(kind==='weave'?6:2,kind==='weave'?5:2);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;textures.add(t);return t;
  };
  const woven=texture('weave'),wood=texture('wood');if(iteration===2)brick.map=texture('brick');
  try {
    check();
    // Actual running-bond masonry: cubes clipped at openings, tiny varied bevel-like joints.
    const pitchY=.22,pitchX=.48;
    for(let row=0;row<27;row++){
      const bottom=row*pitchY,top=Math.min(5.8,bottom+pitchY);if(top<=bottom)continue;
      const segments=bottom>=1.1-1e-6&&top<=4.4+1e-6?[[-11,-7.4],[-1.2,1.2],[7.4,11]]:[[-11,11]];
      for(const [left,right] of segments){
        // Mortar backing is also split at apertures, not a plane behind the glass.
        part('brick-wall-backing',[right-left,top-bottom,.21],[(left+right)/2,y0+(bottom+top)/2,6.9],mortar);
        for(let x=-11-(row%2)*pitchX/2;x<11;x+=pitchX){const a=Math.max(left,x),c=Math.min(right,x+pitchX);if(c-a<.02)continue;
          const colour=iteration===1?new THREE.Color().setHSL(.038+((row*13+Math.round(x*100))%7)*.001,.38,.34+Math.abs(Math.sin(row*19+x*17))*.075):new THREE.Color(0x994a30).multiplyScalar(.85+Math.abs(Math.sin(row*19+x*17))*.35);
          part('brick-wall',[c-a-.012,top-bottom-.012,.045],[(a+c)/2,y0+(bottom+top)/2,6.778],brick,false,colour);
        }
      }
    }
    part('skirting',[22,.17,.12],[0,y0+.085,6.69],graphite);
    // The side wall is behind lounge, as in the approved image; no foreground occluding wall.
    // The right rear wall has a real opening for the physical lift.
    for(const [z,depth] of [[-2.775,8.45],[5.775,2.45]] as const){
      part('side-wall',[.2,5.8,depth],[-10.9,y0+2.9,z],plaster,true);
      obstacle('side-wall',-10.9,z,.2,depth);
      part('side-skirting',[.1,.17,depth],[-10.74,y0+.085,z],oak);
    }
    part('side-wall',[.2,3.1,3.1],[-10.9,y0+4.25,3],plaster,true);
    obstacle('north-wall',0,6.9,22,.2);
    for(const o of WINDOW_OPENINGS){
      const x=(o.minX+o.maxX)/2,w=o.maxX-o.minX,h=o.top-o.bottom;
      part('window-glass',[w-.16,h-.14,.025],[x,y0+(o.top+o.bottom)/2,6.91],glass);
      for(const xx of [o.minX+.06,o.maxX-.06,x-w/6,x+w/6])part('window-frame',[.08,h,.19],[xx,y0+(o.top+o.bottom)/2,6.75],graphite,true);
      for(const yy of [o.bottom+.04,o.top-.04,2.65])part('window-frame',[w,.08,.19],[x,y0+yy,6.75],graphite,true);
      part('window-sill',[w+.24,.12,.56],[x,y0+1.04,6.63],oak,true);
      part('window-apron',[w+.16,.13,.08],[x,y0+.9,6.73],oak);
      // Environment has real depth and does not cast shadows through the windows.
      part('sky',[w,3.5,.04],[x,y0+2.7,8.4],sky);
      for(let i=0;i<12;i++){
        const xx=o.minX+.2+i*.5,h=.8+Math.abs(Math.sin(i*6.7+x))*2.4,z=7.6+(i%3)*.2;
        part('skyline',[.32+(i%3)*.06,h,.25],[xx,y0+.55+h/2,z],city);
        for(let row=0;row<Math.floor(h/.25);row++)part('city-windows',[.18,.09,.012],[xx,y0+.7+row*.25,z-.14],windowGlow);
      }
    }
    if(iteration===2){
      for(const o of WINDOW_OPENINGS)for(let i=0;i<9;i++){
        const x=o.minX+.25+i*.7,h=1.3+Math.abs(Math.sin(i*13+(o.minX)))*2.2;
        part('distant-skyline',[.24,h,.16],[x,y0+.7+h/2,8.05],city);
        if(i%3===0)part('city-spires',[.045,.5,.045],[x,y0+.95+h,8.05],city);
      }
    }
    const glaze=(name:string,x:number,z:number,length:number,alongX:boolean)=>{
      part(name,alongX?[length,2.85,.025]:[.025,2.85,length],[x,y0+1.475,z],glass);
      for(const y of [.05,2.9])part('meeting-profile',alongX?[length,.065,.075]:[.075,.065,length],[x,y0+y,z],graphite);
      for(const d of [-length/2,length/2])part('meeting-profile',[.065,2.9,.065],[x+(alongX?d:0),y0+1.45,z+(alongX?0:d)],graphite);
      obstacle(name,x,z,alongX?length:.075,alongX?.075:length);
    };
    glaze('meeting-rear-glass',7.15,-1.9,5.5,true);glaze('meeting-east-glass',9.9,-4.05,4.3,false);
    glaze('meeting-front-glass',7.15,-6.2,5.5,true);
    // 1.35 m clear doorway on the west side, oriented toward the central aisle.
    glaze('meeting-west-glass',4.4,-4.95,2.5,false);glaze('meeting-west-return',4.4,-2.125,.45,false);
    const asset=async(key:string,id:string,x:number,z:number,angle=0,support=y0,scale:[number,number,number]=[1,1,1],collision=true)=>{
      check();let a:THREE.Object3D|undefined;
      try{a=await options.cloneAsset(id);}catch{throw new ArchitectureError('asset_load_failed',id);}
      if(!a)throw new ArchitectureError('asset_missing',id);
      if(assets.has(a)||a.parent)throw new ArchitectureError('asset_instance_not_independent',id);
      assets.add(a);check();
      if(iteration===2)a.traverse(n=>{
        const mesh=n as THREE.Mesh;if(!mesh.isMesh)return;
        const adjust=(source:THREE.Material,index:number)=>{
          const role=String(mesh.userData.maoMaterialRoles?.[index]??source.name);
          const rug=id==='rug.area'&&role==='carpet',top=id==='table.meeting'&&role==='glass';
          if(!(source instanceof THREE.MeshStandardMaterial)||(!rug&&!top))return source;
          const m=source.clone();materials.add(m);m.color.set(0xffffff);m.map=rug?woven:wood;m.roughness=rug?.98:.72;m.metalness=0;m.transparent=false;m.opacity=1;m.depthWrite=true;m.name=rug?'architecture-linen':'architecture-oak';return m;
        };
        mesh.material=Array.isArray(mesh.material)?mesh.material.map(adjust):adjust(mesh.material,0);
      });
      const holder=new THREE.Group();holder.name=key;holder.userData.premiumAssetId=id;holder.add(a);a.position.set(0,0,0);a.rotation.set(0,0,0);a.scale.multiply(new THREE.Vector3(...scale));
      holder.rotation.y=angle;holder.updateMatrixWorld(true);
      let bb=new THREE.Box3().setFromObject(holder);if(bb.isEmpty())throw new ArchitectureError('asset_empty_geometry',id);
      const center=bb.getCenter(new THREE.Vector3());holder.position.set(x-center.x,support-bb.min.y,z-center.z);group.add(holder);
      a.traverse(n=>{const m=n as THREE.Mesh;if(m.isMesh){const mats=Array.isArray(m.material)?m.material:[m.material];m.castShadow=!mats.every(v=>v.transparent&&v.opacity<.5);m.receiveShadow=true;}});
      group.updateMatrixWorld(true);bb=new THREE.Box3().setFromObject(holder);const size=bb.getSize(new THREE.Vector3());
      group.assetBounds.push({key,id,bounds:bb.clone(),size:size.toArray() as [number,number,number],supportY:support});
      if(collision)obstacles.push({id:key,minX:bb.min.x,maxX:bb.max.x,minZ:bb.min.z,maxZ:bb.max.z});
      return holder;
    };
    await asset('meeting-door','door.office.glass',3.92,-3.7,0,y0,[1,1.27,1]);
    await asset('meeting-rug','rug.area',7.15,-4.1,0,y0+.006,[1.55,1,1.7],false);
    await asset('meeting-table','table.meeting',7.15,-4.25,0,y0+.035,[1.12,1,1.08]);
    for(const [x,z,a]of [[6.4,-5.25,Math.PI],[7.9,-5.25,Math.PI],[6.4,-3.2,0],[7.9,-3.2,0]])await asset(`meeting-chair-${x}-${z}`,'chair.meeting',x,z,a,y0+.035,[1.24,1,1.18]);
    await asset('meeting-pendant','pendant.led',7.15,-4.25,0,y0+2.85,[1.35,1,1.35],false);
    await asset('meeting-plant','plant.potted',9.35,-2.4,0,y0,[.55,.55,.55]);
    // Lounge moved from rear to front/west: green sofa faces the round table.
    const loungeZ=iteration===1?-4.0:-4.35;
    await asset('lounge-rug','rug.area',-8.5,loungeZ,Math.PI/2,y0+.006,[1.6,1,1.95],false);
    await asset('lounge-sofa','sofa.cozy',-10.0,loungeZ,iteration===1?Math.PI/2:-Math.PI/2,y0+.035,[1.5,1.22,1.4]);
    await asset('lounge-table','table.coffee',-8.5,loungeZ,0,y0+.035,[1.15,1,1.15]);
    await asset('lounge-chair','armchair.cozy',-7.3,loungeZ-.85,iteration===1?-Math.PI/2:Math.PI/2,y0+.035,[1.15,1.12,1.15]);
    await asset('lounge-lamp','lamp.standing',-10.1,-6.55,0,y0);
    await asset('lounge-plant','plant.potted',-10,-2.2,0,y0,[1.05,1.05,1.05]);
    // Storage flanks the two panoramic windows, with plants and local sconces.
    for(const x of [-9.5,9.5]){
      await asset(`bookshelf-${x}`,'bookshelf',x,6.3,0,y0,[1.35,1.45,1.1]);
      await asset(`shelf-plant-${x}`,'plant.potted',x,6.22,0,y0+3.07,[.62,.62,.62],false);
      if(iteration===2)await asset(`cabinet-${x}`,'filing.cabinet',x+(x>0?-.95:.95),5.95,0,y0,[.8,.8,.8]);
    }
    for(const x of [-6.55,-1.95,1.95,6.55])await asset(`sill-plant-${x}`,'plant.potted',x,6.53,0,y0+1.1,[.38,.38,.38],false);
    await asset('brick-art','wall.decoration',0,6.65,0,y0+2.0,[1.35,1.55,1],false);
    await asset('brick-sconce','decor.wall.sconce',0,6.57,0,y0+3.35,[1.25,1.25,1],false);
    await asset('lounge-art','wall.decoration',-10.69,-4.25,iteration===1?Math.PI/2:-Math.PI/2,y0+2.25,[1.65,1.65,1],false);
    await asset('lounge-sconce','decor.wall.sconce',-10.6,-4.25,iteration===1?Math.PI/2:-Math.PI/2,y0+3.55,[1.2,1.2,1],false);
    for(const [i,x]of [-4.7,0,4.5].entries()){
      await asset(`office-pendant-${i}`,'pendant.led',x,3.9,0,y0+3.55,[1.2,1,1.2],false);
      part('pendant-cable',[.012,1.1,.012],[x,y0+5.32,3.9],graphite);
    }
    if(iteration===2){
      // Discreet shelf lighting and picture-light bars, one shared emissive batch.
      for(const x of [-9.5,9.5])for(const y of [.75,1.45,2.15])part('decor-emission',[1.6,.018,.025],[x,y0+y,6.05],amber);
      part('decor-emission',[.7,.025,.08],[0,y0+3.25,6.46],amber);
    }
    if(iteration===2){
      // Trailing foliage supplements the real GLB planters; one instanced draw for all leaves.
      const leafGeometry=new THREE.SphereGeometry(1,8,5);geometries.add(leafGeometry);
      const leafMaterial=mat('hanging-foliage',0x526d35,{roughness:.96});
      const leaves=new THREE.InstancedMesh(leafGeometry,leafMaterial,160);leaves.name='hanging-foliage';
      const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();let index=0;
      for(const shelfX of [-9.5,9.5])for(let strand=0;strand<4;strand++)for(let j=0;j<20;j++){
        const t=j/19,x=shelfX+(strand<2?-.76:.76)+Math.sin(t*5+strand)*.06,y=y0+3.55-t*(.65+(strand%2)*.55),z=6.08-Math.sin(t*Math.PI)*.08;
        rotation.setFromEuler(new THREE.Euler(.3*Math.sin(j),0,(j%2?1:-1)*.55));matrix.compose(new THREE.Vector3(x+(j%2?.055:-.055),y,z),rotation,new THREE.Vector3(.085,.14,.035));leaves.setMatrixAt(index++,matrix);
      }
      leaves.castShadow=false;leaves.receiveShadow=true;leaves.computeBoundingSphere();group.add(leaves);
      const treeMaterial=mat('city-canopy',0x718152,{roughness:1}),trees=new THREE.InstancedMesh(leafGeometry,treeMaterial,60);trees.name='city-canopies';
      let tree=0;for(const o of WINDOW_OPENINGS)for(let i=0;i<30;i++){
        const x=o.minX+.15+(i%15)*.42,y=y0+.95+Math.sin(i*9)*.15,z=7.55+Math.floor(i/15)*.35;
        matrix.compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(.22,.28,.2));trees.setMatrixAt(tree++,matrix);
      }
      trees.castShadow=false;trees.receiveShadow=false;trees.computeBoundingSphere();group.add(trees);
    }
    for(const [name,batch]of batches){const m=new THREE.InstancedMesh(cube,batch.material,batch.parts.length);m.name=name;const matrix=new THREE.Matrix4(),q=new THREE.Quaternion();batch.parts.forEach((p,i)=>{matrix.compose(new THREE.Vector3(...p.pos),q,new THREE.Vector3(...p.size));m.setMatrixAt(i,matrix);if(p.color)m.setColorAt(i,p.color);});m.castShadow=batch.cast;m.receiveShadow=!['sky','skyline','city-windows','decor-emission'].includes(name);m.computeBoundingSphere();group.add(m);}
    group.updateMatrixWorld(true);
    const elevator=options.elevatorBounds??{id:'physical-elevator',minX:cx-10.80,maxX:cx-10.66,minZ:cz+1.45,maxZ:cz+4.55};
    const approach=options.elevatorApproach??{x:cx-8.9,z:cz+3.0};
    group.diagnostics=diagnoseArchitecture(b,options.occupiedWorkplaces,obstacles,elevator,[{id:'meeting-entry',x:cx+3.65,z:cz-2.95},{id:'meeting-interior',x:cx+5.5,z:cz-2.6},{id:'lounge-entry',x:cx-7.5,z:cz-6.25}],approach);
    for(const a of group.assetBounds)if(a.bounds.min.x<b.minX-1e-4||a.bounds.max.x>b.maxX+1e-4||a.bounds.min.z<b.minZ-1e-4||a.bounds.max.z>b.maxZ+1e-4)group.diagnostics.issues.push({code:'asset_outside_floor',id:a.key,x:a.bounds.min.x,z:a.bounds.min.z});
    group.diagnostics.valid=group.diagnostics.issues.length===0;
    if(options.strictPlacement&&!group.diagnostics.valid)throw new ArchitectureError('architecture_placement_conflict',undefined,group.diagnostics);
    check();return group;
  }catch(error){group.dispose();throw error;}
}
