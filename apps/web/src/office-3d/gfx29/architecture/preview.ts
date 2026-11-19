import * as THREE from 'three';
import { createOfficeArtRuntime, type OfficeAssetManifest } from '../../../office-art';
import { showroomSeats, showroomLayout } from '../../scene-data';
import { createPremiumLightingV29 } from '../lighting';
import { createPremiumArchitectureV29, createArchitectureAssetAdapter, WINDOW_OPENINGS } from './index';

async function run(){
  const scene=new THREE.Scene(),root=new THREE.Group();scene.add(root);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1600,1100);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
  const camera=new THREE.OrthographicCamera(-17.45,17.45,12,-12,.1,150);camera.position.set(19,20,-23);camera.lookAt(0,1.4,0);
  const response=await fetch('/office-art/v1/manifest.json');if(!response.ok)throw Error('manifest load failed');
  const raw=await response.json() as OfficeAssetManifest;
  // GLTFLoader sanitizes '.' from node names. This is the same boundary adapter as OfficeScene3D.
  const manifest={...raw,assets:raw.assets.map(a=>({...a,node:a.node?.replace(/\s/g,'_').replace(/[.:/]/g,'')}))};
  const runtime=createOfficeArtRuntime({manifest,manifestUrl:'/office-art/v1/manifest.json'}),external:THREE.Object3D[]=[];
  const adapter=createArchitectureAssetAdapter(runtime);
  const put=async(id:string,x:number,z:number,rotation=0,scale:[number,number,number]=[1,1,1])=>{
    const a=(await adapter.cloneAsset(id))!;external.push(a);a.position.set(x,.12,z);a.rotation.y=rotation;a.scale.multiply(new THREE.Vector3(...scale));
    a.traverse(n=>{const m=n as THREE.Mesh;if(m.isMesh){const materials=Array.isArray(m.material)?m.material:[m.material];m.castShadow=!materials.every(v=>v.transparent&&v.opacity<.5);m.receiveShadow=true;}});root.add(a);return a;
  };
  let architecture:Awaited<ReturnType<typeof createPremiumArchitectureV29>>|undefined;
  let lighting:ReturnType<typeof createPremiumLightingV29>|undefined;
  try {
    const floor=await put('floor.oak.light',0,0,0,[22/12,1,14/9]);floor.position.y=0;
    const seats=showroomSeats(),layout=showroomLayout();
    for(const seat of seats){
      await put('desk.modern',seat.x,seat.z);await put('monitor.single',seat.x,seat.z+.1);await put('keyboard',seat.x,seat.z-.15);
      const chair=layout.chairs.find(c=>c.deskId===seat.deskId)!;await put('chair.ergonomic',chair.position.x-11,chair.position.z-7,chair.orientation);
      if(seat.employeeId){const spot=layout.characterSpots.find(s=>s.employeeId===seat.employeeId)!;await put('character.base.working',spot.position.x-11,spot.position.z-7,spot.orientation);}
    }
    for(const id of ['elevator.cabin','elevator.frame','elevator.doors','elevator.display','elevator.call-panel','elevator.floor-sign','elevator.wall-lights'])await put(id,-5.4,-2.9);
    const iteration=new URLSearchParams(location.search).get('iteration')==='1'?1:2;
    architecture=await createPremiumArchitectureV29({floorBounds:{minX:-11,maxX:11,minZ:-7,maxZ:7},occupiedWorkplaces:seats,...adapter,artIteration:iteration});root.add(architecture);
    lighting=createPremiumLightingV29({scene,renderer,camera,floorRoot:root});
    lighting.lights.lounge.position.set(-9,2.3,-4.5);lighting.lights.daylight.intensity=2.1;lighting.lights.hemisphere.intensity=1.85;lighting.setExposure(1.04);
    // The side wall must not erase lounge fill. Shadow only from room contents in this fixture.
    const side=architecture.getObjectByName('side-wall') as THREE.Mesh;side.castShadow=false;
    renderer.render(scene,camera);
    const probes=[];architecture.updateMatrixWorld(true);
    for(const o of WINDOW_OPENINGS)for(const x of [o.minX+.13,o.minX+.45,(o.minX+o.maxX)/2,o.maxX-.45,o.maxX-.13])for(const y of [1.4,2.2,3.4,4.15]){
      const hits=new THREE.Raycaster(new THREE.Vector3(x,y+.12,6.2),new THREE.Vector3(0,0,1)).intersectObject(architecture,true);
      probes.push({x,y,glass:hits.some(h=>h.object.name==='window-glass'),brick:hits.some(h=>h.object.name==='brick-wall'||h.object.name==='brick-wall-backing'),skyline:hits.some(h=>h.object.name==='sky'||h.object.name==='skyline')});
    }
    let meshCount=0,instanced=0;architecture.traverse(n=>{if((n as THREE.Mesh).isMesh)meshCount++;if((n as THREE.InstancedMesh).isInstancedMesh)instanced++;});
    const fullSceneCalls=renderer.info.render.calls,fullSceneTriangles=renderer.info.render.triangles;
    // Main-pass cost only, same isolation method as baseline (lights remain).
    const visible=root.children.filter(o=>o!==architecture&&o!==lighting!.group);visible.forEach(o=>o.visible=false);renderer.render(scene,camera);
    const architectureCalls=renderer.info.render.calls,architectureTriangles=renderer.info.render.triangles;visible.forEach(o=>o.visible=true);renderer.render(scene,camera);
    const metrics={iteration,pack:raw.packId,architectureMeshes:meshCount,instanced,architectureCalls,architectureTriangles,fullSceneCalls,fullSceneTriangles,diagnostics:architecture.diagnostics,assets:architecture.assetBounds.map(a=>({...a,bounds:{min:a.bounds.min.toArray(),max:a.bounds.max.toArray()}})),probes};
    function view(name:string){
      camera.zoom=1;
      if(name==='windows'){camera.position.set(12,10,-14);camera.lookAt(0,2.8,6.8);camera.zoom=1.65;}
      else if(name==='meeting'){camera.position.set(17,12,-18);camera.lookAt(7.1,1.3,-4);camera.zoom=2.9;}
      else if(name==='lounge'){camera.position.set(5,10,-17);camera.lookAt(-8.8,1.3,-4.1);camera.zoom=3.2;}
      else {camera.position.set(19,20,-23);camera.lookAt(0,1.4,0);}
      camera.updateProjectionMatrix();renderer.render(scene,camera);
    }
    Object.assign(window,{architecturePreview:{ready:true,metrics,renderer,scene,camera,architecture,view,async cleanup(){lighting!.cleanup();architecture!.dispose();for(const a of external)runtime.disposeInstance(a);runtime.disposeSharedResources();await Promise.resolve();renderer.render(scene,camera);renderer.dispose();}}});
  }catch(error){lighting?.cleanup();architecture?.dispose();for(const a of external)runtime.disposeInstance(a);runtime.disposeSharedResources();renderer.dispose();throw error;}
}
void run().catch(error=>{console.error(error);Object.assign(window,{architecturePreview:{error:String(error.stack??error)}});});
