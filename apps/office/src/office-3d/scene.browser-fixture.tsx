import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import OfficeScene3D from './OfficeScene3D';
import { showroomEmployees } from './scene-data';

if (new URLSearchParams(location.search).has('failWebGL')) {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
    return String(args[0]).includes('webgl') ? null : original.apply(this, args as any);
  } as typeof original;
}
const root = createRoot(document.getElementById('root')!);
let employees = showroomEmployees();
let manifest = { manifestUrl: '/office-art/v1/manifest.json' };
const state = { elevator: 0, employee: '', statuses: [] as string[] };
function render() {
  root.render(<StrictMode><OfficeScene3D employees={employees} assetManifest={manifest}
    onElevatorClick={() => state.elevator++} onEmployeeSelect={id => { state.employee = id; }}
    onSceneStatusChange={status => state.statuses.push(status)} /></StrictMode>);
}
function inspect(): any {
  let snapshot;
  document.querySelector('.office-scene-3d-mount')?.dispatchEvent(new CustomEvent('mao-3d-inspect', { detail: (value: unknown) => { snapshot = value; } }));
  return snapshot;
}
function point(kind: string) {
  const { scene, camera, artRoot, visibleDoors } = inspect();
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const targets: THREE.Object3D[] = [];
  if (kind === 'doors') targets.push(...visibleDoors.map((door: any) => door.object));
  else artRoot.traverse((object: THREE.Object3D) => {
    if (kind === 'employee' ? Boolean(object.userData.employeeId) : object.name.includes(kind) || String(object.userData.premiumAssetId ?? '').includes(kind)) targets.push(object);
  });
  const canvas = document.querySelector('canvas')!; const rect = canvas.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  const visible = (object: THREE.Object3D): boolean => object.visible && (!object.parent || visible(object.parent));
  for (const target of targets) {
    const box = new THREE.Box3().setFromObject(target);
    const corners = [box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].flatMap(y => [box.min.z, box.max.z].map(z => new THREE.Vector3(x,y,z).project(camera))));
    const left = Math.min(...corners.map(p=>p.x)), right = Math.max(...corners.map(p=>p.x));
    const bottom = Math.min(...corners.map(p=>p.y)), top = Math.max(...corners.map(p=>p.y));
    for (let y = 1; y <= 19; y++) for (let x = 1; x <= 19; x++) {
      const position = new THREE.Vector2(THREE.MathUtils.lerp(left,right,x/20),THREE.MathUtils.lerp(bottom,top,y/20));
      ray.setFromCamera(position, camera);
      const hit = ray.intersectObjects(artRoot.children, true).find(hit => visible(hit.object));
      let owner = hit?.object; while (owner && owner !== target) owner = owner.parent ?? undefined;
      if (owner === target) return { x: rect.left + (position.x + 1) * rect.width / 2, y: rect.top + (1 - position.y) * rect.height / 2, hit: hit?.object.name };
    }
  }
  throw new Error(`no visible raycast surface ${kind}`);
}
Object.assign(window, { sceneTest: {
  state, inspect, point,
  renderEquivalent() { employees = employees.map(employee => ({ ...employee })); manifest = { ...manifest }; render(); },
  updateEmployeeStatus(status: string) { employees = employees.map((employee,index)=>index?employee:{...employee,status:status as typeof employee.status});render(); },
  updateEmployee() { employees = employees.map((employee, index) => index ? employee : { ...employee, employeeId: 'directory-updated', deskId: 'desk-floor-2-12', status: 'blocked' }); render(); },
  changeManifest(url: string) { manifest = { manifestUrl: url }; render(); },
  unmount() { root.render(null); }, render,
} });
render();
