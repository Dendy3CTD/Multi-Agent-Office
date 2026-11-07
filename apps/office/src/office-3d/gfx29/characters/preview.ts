import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPremiumCharacter } from './index';
import { showroomLayout, showroomEmployees } from '../../scene-data';
const scene=new THREE.Scene(); scene.background=new THREE.Color(0xe2ddd3);
const camera=new THREE.PerspectiveCamera(34, 1440/960,.1,100); camera.position.set(10,11,-16); camera.lookAt(-1,.7,1);
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(1440,960); renderer.setPixelRatio(1); document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x857b71,2)); const light=new THREE.DirectionalLight(0xffe9d0,2);light.position.set(-3,8,5);scene.add(light);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:0xc9aa86}));floor.rotation.x=-Math.PI/2;scene.add(floor);
const gltf=await new GLTFLoader().loadAsync('/office-art/v1/office-pack.glb');
const layout=showroomLayout(); const employees=showroomEmployees();
for(const employee of employees){
 const desk=layout.desks.find(d=>d.deskId===employee.deskId)!; const chair=layout.chairs.find(c=>c.deskId===employee.deskId)!;
 const x=desk.position.x-11, z=desk.position.z-7, chairZ=chair.position.z-7;
 for(const [name,dz] of [['deskmodern',0],['chairergonomic',chairZ-z],['monitorsingle',0],['keyboard',0]] as const){const source=gltf.scene.getObjectByName(name); if(!source)throw new Error(`Missing GLB node ${name}`);const obj=source.clone();obj.position.set(x,0,z+dz);scene.add(obj);}
 const character=createPremiumCharacter(employee);character.position.set(x,0,chairZ);scene.add(character);
}
renderer.render(scene,camera);
