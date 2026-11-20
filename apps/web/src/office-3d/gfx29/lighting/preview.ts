import * as THREE from 'three';
import { createPremiumLightingV29, PREMIUM_LIGHTING_V29 } from './index';

// Independent procedural fixture; does not import work in progress from agents A/B/C.
const scene = new THREE.Scene(), floorRoot = new THREE.Group(); scene.add(floorRoot);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1440, 960); renderer.setPixelRatio(1); document.body.append(renderer.domElement);
const camera = new THREE.OrthographicCamera(-17.25,17.25,11.5,-11.5,.1,150);
camera.position.set(...PREMIUM_LIGHTING_V29.camera.position); camera.lookAt(...PREMIUM_LIGHTING_V29.camera.target); camera.updateMatrixWorld();
const mat = (name: string, color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ name, color, roughness: .8, ...extra });
const oak = mat('oak',0xc6a37b), brick = mat('brick',0x9d6250), metal = mat('metal',0x515e65,{metalness:.8,roughness:.25}), fabric = mat('fabric',0x617e79), white = mat('white',0xe8e6de), skin = mat('skin',0xb77d60), clothing = mat('clothing',0x344958), bronze = mat('bronze',0xb48a56,{metalness:.85,roughness:.3});
const glass = mat('glass',0xb8d9dd,{transparent:true,opacity:.2,depthWrite:false,roughness:.15,side:THREE.DoubleSide});
function woodMap() {
  const canvas=document.createElement('canvas'); canvas.width=256;canvas.height=256;
  const c=canvas.getContext('2d')!;c.fillStyle='#d2b28e';c.fillRect(0,0,256,256);
  for(let y=0;y<256;y+=32){c.fillStyle=y%64===0?'#c9aa85':'#ddc3a2';c.fillRect(0,y,256,30);c.strokeStyle='#ac8d6d';c.lineWidth=.6; for(let j=0;j<4;j++){c.beginPath();c.moveTo(0,y+5+j*6);c.bezierCurveTo(70,y+j*6,160,y+12+j*6,256,y+6+j*6);c.stroke();}}
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3,4);return t;
}
oak.map=woodMap();
function box(name: string, size: [number,number,number], pos: [number,number,number], material: THREE.Material) {
  const m=new THREE.Mesh(new THREE.BoxGeometry(...size),material);m.name=name;m.position.set(...pos);m.castShadow=true;m.receiveShadow=true;floorRoot.add(m);return m;
}
box('floor',[22,.24,14],[0,-.12,0],oak);
box('plinth',[22.3,.3,14.3],[0,-.39,0],metal);
box('brick-base',[22,1,.25],[0,.5,6.9],brick);box('brick-lintel',[22,.65,.25],[0,5,6.9],brick);
for(const x of [-10.5,0,10.5]) box('brick-pier',[1,4.4,.25],[x,2.5,6.9],brick);
for(const x of [-5.25,5.25]) {
  box('window',[9.4,3.3,.03],[x,2.8,6.9],glass);
  for(const dx of [-4.7,0,4.7]) box('mullion',[.08,3.4,.15],[x+dx,2.8,6.75],metal);
  box('sill',[9.6,.14,.55],[x,1.1,6.65],oak);
}
// Separate depth layers outside the window openings, not painted onto the wall.
box('distant-sky',[22,4.5,.05],[0,2.25,8.8],mat('sky',0x889faa));
for(let i=0;i<15;i++) {const h=1.2+(i*1.37%3);box('city',[.7,h,.55],[-10.5+i*1.5,h/2,7.8+(i%3)*.25],mat('city',0x536671));}
for(const x of [-3,2]) for(const z of [-2,2]) {
  box('desk',[3,.15,1.5],[x,1.25,z],oak);
  for(const dx of [-1.25,1.25]) box('desk-leg',[.08,1.2,1.3],[x+dx,.6,z],metal);
  box('monitor',[1,.65,.08],[x,1.8,z+.3],metal);box('screen',[.9,.53,.01],[x,1.8,z+.25],mat('screen',0x709fba,{emissive:0x325976,emissiveIntensity:.4}));
  box('chair',[.9,.18,.85],[x,.7,z-1.1],fabric);box('chair-back',[.9,.85,.14],[x,1.1,z-1.5],fabric);
}
box('sofa-seat',[2,.45,3],[-8,.55,3.7],fabric);box('sofa-back',[.4,1.2,3],[-9,.95,3.7],fabric);
box('coffee-table',[1.3,.15,1.8],[-6.4,.7,3.7],oak);
box('meeting-table',[3.6,.18,2],[7,1.25,-4],oak);
box('meeting-glass',[.04,3.8,4],[9,1.9,-4],glass);
box('elevator',[2.4,3.1,.2],[-5.4,1.55,-4.8],metal);
function person(x:number,z:number) {
  box('torso',[.55,.8,.32],[x,1.35,z],clothing);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.23,20,16),skin);head.position.set(x,2,z);head.castShadow=true;floorRoot.add(head);
  for(const dx of [-.16,.16]) box('leg',[.2,.9,.24],[x+dx,.5,z],clothing);
}
person(-3,-3.1);person(2,1);person(6,-3);
for(const [x,z] of [[-9.2,4.6],[7.1,-4.15]]) {
  box('lamp-stem',[.05,2.7,.05],[x,1.35,z],bronze);
  box('lamp-shade',[.65,.3,.65],[x,2.8,z],mat('lamp',0xf0d9b1,{emissive:0xffd49a,emissiveIntensity:.35}));
}
// Labelled diagnostic row, including near-white, graphite, skin and reflective metal.
const swatches=[white,metal,fabric,glass,skin,bronze,oak,clothing];
swatches.forEach((m,i)=>{const s=new THREE.Mesh(new THREE.SphereGeometry(.48,32,24),m);s.name='swatch-'+m.name;s.position.set(-8.4+i*2.4,.65,-6);s.castShadow=true;s.receiveShadow=true;floorRoot.add(s);});
const sourceColor=oak.color.clone(), sourceMap=oak.map;
const mode=new URLSearchParams(location.search).get('iteration') ?? '2';
const lighting=createPremiumLightingV29({scene,renderer,camera,floorRoot,exposure:mode==='1'?1.2:1.08});
if(mode==='1'){lighting.lights.hemisphere.intensity=1.25;lighting.lights.daylight.intensity=3.1;lighting.lights.lounge.intensity=28;lighting.lights.meeting.intensity=32;}
renderer.render(scene,camera);
const readPixels=()=>{const gl=renderer.getContext(),pixels=new Uint8Array(1440*960*4);gl.readPixels(0,0,1440,960,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let high=0,dark=0,sum=0;for(let i=0;i<pixels.length;i+=4){const l=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];sum+=l;if(pixels[i]>=254&&pixels[i+1]>=254&&pixels[i+2]>=254)high++;if(l<8)dark++;}return {mean:sum/(1440*960),whiteClipFraction:high/(1440*960),blackFraction:dark/(1440*960)};};
const roomCorners=[];
for(const x of [-11,11]) for(const y of [0,5.4]) for(const z of [-7,7]) roomCorners.push(new THREE.Vector3(x,y,z).project(camera));
const framed=roomCorners.every(p=>Math.abs(p.x)<1 && Math.abs(p.y)<1 && Math.abs(p.z)<1);
const shadowCorners=[];
for(const x of [-11,11]) for(const y of [0,5.4]) for(const z of [-7,7]) shadowCorners.push(new THREE.Vector3(x,y,z).project(lighting.lights.daylight.shadow.camera));
const shadowFramed=shadowCorners.every(p=>Math.abs(p.x)<1 && Math.abs(p.y)<1 && Math.abs(p.z)<1);
const metrics={framed,shadowFramed,iteration:mode,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textures:renderer.info.memory.textures,pixels:readPixels(),shadowCasters:Object.values(lighting.lights).filter(l=>l.castShadow).length,sourceIntact:oak.color.equals(sourceColor)&&oak.map===sourceMap,swatches:swatches.map(m=>m.name)};
Object.assign(window,{lightingPreview:{scene,renderer,camera,floorRoot,lighting,metrics,render:()=>renderer.render(scene,camera),cleanup:()=>lighting.cleanup()}});
document.documentElement.dataset.ready='true';
