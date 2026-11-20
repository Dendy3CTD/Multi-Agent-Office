import * as THREE from 'three';

export type EmployeeStatus = 'working' | 'idle' | 'blocked' | 'offline';
export interface CharacterData { readonly employeeId: string; readonly deskId: string; readonly status: EmployeeStatus; }
export interface AnimationState { readonly enabled?: boolean; readonly reducedMotion?: boolean; readonly status?: EmployeeStatus; }
export interface PremiumCharacter extends THREE.Group {
  updateData(data: CharacterData): void;
  /** Returns true when the pose changed and the shared renderer should redraw. Time is seconds. */
  updateAnimation(time: number, state?: AnimationState): boolean;
  dispose(): void;
}
/** The root is floor-level at the chair centre; local -Z faces the desk. */
export function createPremiumCharacter(data: CharacterData): PremiumCharacter {
  if (!data.employeeId || !data.deskId) throw new Error('employeeId and deskId are required');
  const root = new THREE.Group() as PremiumCharacter;
  root.name = 'premium-character';
  const initialId = data.employeeId;
  let hash = 2166136261;
  for (const ch of initialId) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  const choose = <T>(items: readonly T[], shift: number): T => items[(hash >>> shift) % items.length];
  const outfit = hash % 5;
  const hairStyle = (hash >>> 5) % 4;
  root.userData.appearance = { outfit, hairStyle, seed: hash };
  const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>();
  const material = (color: number, roughness = .8) => { const m = new THREE.MeshStandardMaterial({ color, roughness }); materials.add(m); return m; };
  const skin = material(choose([0xf0c39f,0xdba77f,0xc18b69,0x9a654c,0x744b3b], 9));
  const hair = material(choose([0x302724,0x4b3025,0x73513b,0x9a5832,0xc5a477,0x242528], 14));
  const cloth = material(choose([0x344d53,0x344961,0xede3d2,0x718579,0x985c48,0x777985], 18));
  const trousers = material(choose([0x303c49,0x3a3837,0x515452,0x263542], 23));
  const shoes = material(0x292927); const white = material(0xeee7db); const detail = material(0x27272b);
  const sphere = (parent: THREE.Object3D, name: string, xyz: [number,number,number], scale: [number,number,number], m: THREE.Material) => {
    const geo = new THREE.SphereGeometry(1,20,14); geometries.add(geo); const mesh = new THREE.Mesh(geo,m); mesh.name=name; mesh.position.set(...xyz); mesh.scale.set(...scale); mesh.castShadow=true; parent.add(mesh); return mesh;
  };
  const limb = (parent: THREE.Object3D, name: string, a: THREE.Vector3, b: THREE.Vector3, radius: number, m: THREE.Material) => {
    const middle = a.clone().add(b).multiplyScalar(.5); const mesh = sphere(parent,name,[middle.x,middle.y,middle.z],[radius,a.distanceTo(b)/2+radius*.4,radius],m);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), b.clone().sub(a).normalize()); return mesh;
  };
  // Seat ~0.47 m; the actual GLB desk is 0.915 m tall, chair 1.302 m.
  sphere(root,'hips',[0,.53,.02],[.245,.13,.18],trousers);
  sphere(root,'torso',[0,.88,.035],[.25,.36,.145],cloth);
  sphere(root,'shoulders',[0,1.08,.035],[.275,.13,.145],cloth);
  sphere(root,'neck',[0,1.205,.025],[.07,.10,.07],skin);
  const head = new THREE.Group(); head.name='head-pivot'; head.position.set(0,1.24,.02); root.add(head);
  sphere(head,'head',[0,.15,0],[.145,.19,.135],skin);
  sphere(head,'nose',[0,.135,-.135],[.035,.045,.04],skin);
  for (const side of [-1,1]) {
    sphere(head,'ear',[side*.146,.14,0],[.026,.047,.024],skin);
    sphere(head,'eye',[side*.055,.18,-.125],[.012,.014,.009],detail);
    sphere(head,'brow',[side*.055,.207,-.122],[.03,.008,.008],hair);
  }
  sphere(head,'hair-cap',[0,.29,.015],[.15,.095,.14],hair);
  if(hairStyle===1 || hairStyle===3) sphere(head,'hair-back',[0,.13,.095],[.15,.19,.085],hair);
  if(hairStyle===2 || hairStyle===3) sphere(head,'hair-sweep',[-.055,.27,-.08],[.105,.07,.075],hair);
  if(hairStyle===3) sphere(head,'hair-bun',[0,.29,.15],[.08,.075,.075],hair);
  if(outfit===0 || outfit===3){
    sphere(root,'shirt-front',[0,.95,-.106],[.09,.22,.015],white);
    for(const s of [-1,1]) { const lapel=sphere(root,'collar',[s*.075,1.11,-.10],[.07,.075,.016],white); lapel.rotation.z=s*.4; }
  }
  if(outfit===2 || outfit===3) for(const s of [-1,1]) sphere(root,'lapel',[s*.09,.99,-.11],[.035,.16,.018],cloth).rotation.z=s*.25;
  if(outfit===1) sphere(root,'sweater-neck',[0,1.15,-.01],[.09,.035,.08],cloth);
  for(const side of [-1,1]) {
    const shoulder=new THREE.Vector3(side*.23,1.05,.02), elbow=new THREE.Vector3(side*.29,.80,-.27), wrist=new THREE.Vector3(side*.18,.90,-.72);
    limb(root,'upper-arm',shoulder,elbow,.075,cloth);
    const forearm=new THREE.Group(); forearm.name=side<0?'left-arm':'right-arm'; root.add(forearm);
    limb(forearm,'forearm',elbow,wrist,.06,cloth); sphere(forearm,'hand',[wrist.x,wrist.y,wrist.z-.035],[.055,.026,.075],skin);
    const hip=new THREE.Vector3(side*.12,.51,0), knee=new THREE.Vector3(side*.13,.47,-.36), ankle=new THREE.Vector3(side*.13,.12,-.38);
    limb(root,'thigh',hip,knee,.105,trousers); limb(root,'shin',knee,ankle,.075,trousers);
    sphere(root,'shoe',[side*.13,.08,-.44],[.09,.065,.16],shoes);
  }
  if((hash>>>27)%3===0){ for(const s of [-1,1]) { const frame=sphere(head,'glasses',[s*.058,.18,-.138],[.047,.036,.007],detail); sphere(head,'lens',[s*.058,.18,-.145],[.035,.025,.004],skin); frame.name='glasses'; } }
  const left=root.getObjectByName('left-arm')!; const right=root.getObjectByName('right-arm')!;
  let current = data; let last = '';
  const sync = (next: CharacterData) => { if(next.employeeId!==initialId) throw new Error('employeeId cannot change on an existing character'); if(!next.deskId) throw new Error('deskId is required'); current=next; root.userData.employeeId=next.employeeId; root.userData.deskId=next.deskId; root.userData.status=next.status; };
  sync(data);
  root.updateData = sync;
  root.updateAnimation = (time, state = {}) => {
    const active = state.enabled !== false && !state.reducedMotion && Number.isFinite(time);
    const status=state.status ?? current.status;
    const phase=(hash%1000)/1000*Math.PI*2;
    const h=active ? Math.sin(time*.7+phase)*.035 : 0;
    const l=active && status==='working' ? Math.sin(time*7+phase)*.015 : 0;
    const r=active && status==='working' ? Math.sin(time*7.7+phase+1)*.015 : 0;
    const signature=`${h.toFixed(5)},${l.toFixed(5)},${r.toFixed(5)}`;
    if(signature===last) return false; last=signature;
    head.rotation.y=h; left.position.y=l; right.position.y=r; return true;
  };
  let disposed=false; root.dispose=()=>{if(disposed)return; disposed=true; root.removeFromParent(); geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose()); root.clear();};
  return root;
}
