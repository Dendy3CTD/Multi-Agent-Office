import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { showroomLayout } from './scene-data';
import { northWindowAssembly, interiorPlacements } from './interior';
const layout = showroomLayout();

describe('built Floor 02 interior', () => {
  it('constructs masonry only outside real window apertures', () => {
    const {segments, openings} = northWindowAssembly(layout);
    expect(openings).toHaveLength(layout.windows.length);
    for (const opening of openings) for (const wall of segments) {
      const overlapX = Math.min(opening.x+opening.width/2,wall.x+wall.width/2)-Math.max(opening.x-opening.width/2,wall.x-wall.width/2);
      const overlapY = Math.min(opening.top,wall.y+wall.height/2)-Math.max(opening.bottom,wall.y-wall.height/2);
      expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false);
    }
    const area=segments.reduce((n,s)=>n+s.width*s.height,0);
    expect(area).toBeCloseTo(layout.size.width*layout.size.height!-openings.reduce((n,o)=>n+o.width*(o.top-o.bottom),0));
  });
  it('builds enclosing glass, a real door, four seats and meeting lighting', () => {
    const placements=interiorPlacements(layout).filter(p=>p.zone==='meeting');
    expect(placements.filter(p=>p.id==='partition.glass')).toHaveLength(4);
    expect(placements.filter(p=>p.id==='door.office.glass')).toHaveLength(1);
    expect(placements.filter(p=>p.id==='chair.meeting')).toHaveLength(4);
    expect(placements.some(p=>p.id==='pendant.led')).toBe(true);
  });
  it('keeps actual GLB lounge/meeting bounds inside the floor and out of workstations', async () => {
    const bytes=readFileSync(resolve(process.cwd(),'public/office-art/v1/office-pack.glb'));
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    for (const p of interiorPlacements(layout).filter(p=>p.zone==='lounge'||p.zone==='meeting')) {
      const source=gltf.scene.getObjectByName(p.id.replace(/\./g,''));expect(source, p.id).toBeDefined();
      const object=source!.clone(true);object.position.set(...p.position);object.rotation.y=p.rotationY??0;object.scale.set(...(p.fitScale??[1,1,1]));
      const bounds=new THREE.Box3().setFromObject(object);
      expect(bounds.min.x,p.id).toBeGreaterThanOrEqual(-layout.size.width/2);
      expect(bounds.max.x,p.id).toBeLessThanOrEqual(layout.size.width/2);
      expect(bounds.min.z,p.id).toBeGreaterThanOrEqual(-layout.size.depth/2);
      expect(bounds.max.z,p.id).toBeLessThanOrEqual(layout.size.depth/2);
      for(const desk of layout.desks) {
        const b=desk.bounds;
        const deskBounds=new THREE.Box3(new THREE.Vector3(b.x-11,.2,b.z-7),new THREE.Vector3(b.x+b.width-11,1.3,b.z+b.depth-7));
        expect(bounds.intersectsBox(deskBounds),`${p.id} vs ${desk.deskId}`).toBe(false);
      }
      if(p.zone==='lounge' && p.id!=='rug.area') {
        const approach=new THREE.Box3(new THREE.Vector3(-7.1,0,-4.9),new THREE.Vector3(-3.8,2.5,-3.85));
        expect(bounds.intersectsBox(approach),`elevator clearance: ${p.id}`).toBe(false);
      }
    }
  });
});
