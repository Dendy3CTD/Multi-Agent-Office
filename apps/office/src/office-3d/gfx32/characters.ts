import * as T from 'three';
import { skinWeights, attachCharacterRig } from '../gfx35/character-rig';
import type { RiggedObject } from '../gfx35/types';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharacterData, PremiumCharacter } from '../gfx29/characters';

type V = [number, number, number];
type Section = [number, number, number, number]; // y, half width, half depth, z centre
export function appearanceSeed(id: string): number { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; }
const palette = new T.MeshStandardMaterial({ name: 'gfx32-vertex-tailoring', vertexColors: true, roughness: .78, metalness: 0 });
let references = 0;
const cache = new Map<string, { body: T.BufferGeometry; head: T.BufferGeometry; refs: number }>();
/** Authored contour surfaces, merged into two meshes. No per-part materials or textures. */
export function createArtCharacter(data: CharacterData, prototype?: number, rigged = false): PremiumCharacter {
  const seed = appearanceSeed(data.employeeId), style = prototype ?? seed % 7;
  const key = `${seed}:${style}:${rigged?'rig35':'static'}`;
  let model = cache.get(key);
  if (!model) {
    const body: T.BufferGeometry[] = [], head: T.BufferGeometry[] = [];
    let role = "torso";
    const skin = [0xe3b18b, 0xbc805c, 0xf0c5a5, 0x89563d][(seed >>> 8) % 4];
    const cloth = [0x283e50, 0xe0d5c0, 0x647a69, 0x794d43, 0x4c6077, 0xb9afa0, 0x484455][style];
    const hair = [0x31241e, 0x543522, 0x9d683b, 0x24232a][(seed >>> 12) % 4];
    const trousers = 0x303c46, shoe = 0x302c29;
    const paint = (geo: T.BufferGeometry, color: number, target = body) => {
      const c = new T.Color(color), p = geo.getAttribute('position'), colors = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const variation = 1 + .018 * Math.sin(p.getY(i) * 73 + p.getX(i) * 31); colors.set([c.r * variation, c.g * variation, c.b * variation], i * 3); }
      geo.setAttribute('color', new T.BufferAttribute(colors, 3)); skinWeights(geo,role,target===head); target.push(geo); return geo;
    };
    const surface = (rows: number, cols: number, point: (v: number, u: number) => V, color: number, target = body) => {
      const vertices: number[] = [], indices: number[] = [], jointParameters: number[] = [];
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { vertices.push(...point(j / rows, i / cols)); jointParameters.push(j/rows); }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + cols + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); g.setIndex(indices); if(role.startsWith('arm:'))g.setAttribute('skinAuthorV',new T.Float32BufferAttribute(jointParameters,1));g.computeVertexNormals(); return paint(g.toNonIndexed(), color, target);
    };
    const loft = (sections: Section[], color: number, target = body, wrinkles = 0) => surface((sections.length - 1) * 3, 24, (v, u) => {
      const t = v * (sections.length - 1), i = Math.min(sections.length - 2, Math.floor(t)), f = t - i;
      const a = sections[i], b = sections[i + 1], s = a.map((x, k) => T.MathUtils.lerp(x, b[k], f)), angle = u * Math.PI * 2;
      const fold = 1 + wrinkles * Math.sin(v * 40 + angle * 3) * Math.sin(v * Math.PI);
      return [Math.sin(angle) * s[1] * fold, s[0], s[3] - Math.cos(angle) * s[2] * fold];
    }, color, target);
    const tube = (points: V[], widths: number[], depths: number[], color: number, target = body) => {
      const path = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p))), frames = path.computeFrenetFrames(12, false);
      surface(12, 8, (v, u) => {
        const index = Math.min(11, Math.floor(v * 12)), t = v * (widths.length - 1), k = Math.min(widths.length - 2, Math.floor(t)), f = t - k;
        const w = T.MathUtils.lerp(widths[k], widths[k + 1], f), d = T.MathUtils.lerp(depths[k], depths[k + 1], f), angle = (1-u) * Math.PI * 2;
        const p = path.getPointAt(v).addScaledVector(frames.normals[index], Math.cos(angle) * w).addScaledVector(frames.binormals[index], Math.sin(angle) * d);
        return p.toArray() as V;
      }, color, target);
    };
    const patch = (points: V[], color: number, target = body) => {
      const g = new T.BufferGeometry(); const out: number[] = [];
      for (let i = 1; i < points.length - 1; i++) out.push(...points[0], ...points[i], ...points[i + 1]);
      g.setAttribute('position', new T.Float32BufferAttribute(out, 3)); const p=g.getAttribute("position"); for(let i=0;i<p.count;i+=3){const a=new T.Vector3().fromBufferAttribute(p,i),b=new T.Vector3().fromBufferAttribute(p,i+1),c=new T.Vector3().fromBufferAttribute(p,i+2);if(b.clone().sub(a).cross(c.clone().sub(a)).z>0){p.setXYZ(i+1,c.x,c.y,c.z);p.setXYZ(i+2,b.x,b.y,b.z);}} g.computeVertexNormals(); paint(g, color, target);
    };
    // Pelvis rests on the measured seat; torso bends toward local -Z.
    role="pelvis"; loft([[.46,.01,.01,.01],[.49,.21,.15,.01],[.6,.22,.15,-.015],[.63,.17,.12,-.04]], trousers);
    role="torso"; loft([[.57,.18,.13,-.015],[.7,.195,.14,-.025],[.89,.23,.15,-.05],[1.08,.255,.14,-.085],[1.16,.18,.105,-.09],[1.185,.075,.065,-.09]], cloth, body, .018);
    loft([[1.15,.065,.06,-.09],[1.29,.064,.055,-.11]], skin);
    for (const side of [-1, 1]) {
      role=`leg:${side}`; tube([[side*.12,.53,0],[side*.13,.52,-.2],[side*.14,.47,-.4],[side*.14,.22,-.44],[side*.14,.09,-.45]], [.105,.102,.079,.06], [.095,.09,.075,.055], trousers);
      role=`foot:${side}`; tube([[side*.14,.07,-.32],[side*.14,.07,-.46],[side*.14,.065,-.6]], [.025,.085,.055], [.02,.067,.025], shoe);
      role=`arm:${side}`; tube([[side*.17,1.12,-.08],[side*.25,1.065,-.1],[side*.285,.98,-.15],[side*.29,.83,-.32]], [.04,.085,.08,.065], [.04,.08,.075,.06], cloth);
      // The original open sleeve tubes need a small merged joint cover when articulated.
      role=`forearm:${side}`;
      if(rigged)paint(new T.SphereGeometry(.069,12,6).deleteAttribute('uv').translate(side*.29,.83,-.32).toNonIndexed(),style===1||style===4?skin:cloth);
      tube([[side*.29,.83,-.32],[side*.25,.85,-.48],[side*.18,.87,-.7]], [.066,.056,.044], [.06,.053,.038], style === 1 || style === 4 ? skin : cloth);
      role=`hand:${side}`; tube([[side*.18,.87,-.68],[side*.17,.875,-.745],[side*.16,.865,-.8]], [.04,.053,.035], [.03,.025,.012], skin);
      // Cuffs and fingers are shaped strips merged into the same surface batch.
      for(let finger=0;finger<4;finger++) tube([[side*.16+(finger-1.5)*.019,.873,-.76],[side*.16+(finger-1.5)*.019,.86,-.815]], [.009,.007], [.008,.006], skin);
      role="torso";
      if(style === 0 || style === 3 || style === 6) {
        patch([[side*.07,1.16,-.222],[side*.18,1.1,-.239],[side*.08,.86,-.232],[side*.025,1.05,-.24]], new T.Color(cloth).multiplyScalar(1.25).getHex());
        patch([[0,1.16,-.226],[side*.072,1.16,-.231],[side*.065,1.065,-.238]], 0xe8ddc9);
      } else if(style===1 || style===4) patch([[0,1.17,-.223],[side*.08,1.15,-.22],[side*.055,1.07,-.223]], 0xf0e4d3);
    }
    for(const side of [-1,1]) {
      role="torso"; tube([[side*.185,.89,-.16],[side*.15,.87,-.188],[side*.21,.85,-.158]],[.004,.006,.002],[.003,.005,.002],cloth);
      role=`hand:${side}`; tube([[side*.19,.87,-.65],[side*.18,.87,-.69]],[.05,.05],[.043,.043], style===1?0xd5c7ad:cloth);
    }
    role="torso";
    if(style===1 || style===4) {
      tube([[0,.68,-.174],[0,.91,-.208],[0,1.13,-.219]],[.007,.007,.005],[.004,.004,.003],0xc9bda7);
      for(const y of [.74,.84,.94,1.04]) tube([[0,y,-.217],[0,y+.009,-.217]],[.008,.007],[.005,.005],0xf1e8d8);
    }
    if(style===0 || style===3 || style===6) surface(8,6,(v,u)=>[ (u-.5)*.13, .86+v*.295, -.218-.012*Math.sin(v*Math.PI)-.006*Math.cos((u-.5)*Math.PI) ],0xd9d2c3);
    // Sculpted head: jaw taper, cheek planes, eye sockets, nasal bridge and lips
    // are displacements of ONE continuous surface rather than attached spheres.
    const jaw = style === 2 ? 1.1 : style === 1 ? .92 : 1;
    const faceWidth = .95 + ((seed >>> 5) % 4) * .035;
    const face = (v: number, u: number): V => {
      const angle=u*Math.PI*2, y=1.24+v*.4, t=Math.sin(v*Math.PI), radius=Math.pow(Math.max(t,0),.48);
      const w=(.122+.035*Math.sin(v*Math.PI))*(v<.35?jaw:1), x=Math.sin(angle)*radius*w*faceWidth;
      let z=-.105-Math.cos(angle)*radius*.132;
      const front=Math.pow(Math.max(0,Math.cos(angle)),12);
      z-=front*(.038*Math.exp(-Math.pow((v-.48)/.14,2))*Math.exp(-Math.pow(x/.039,2))+.015*Math.exp(-Math.pow((v-.26)/.07,2)));
      z+=front*.013*Math.exp(-Math.pow((v-.57)/.07,2))*(1-Math.exp(-Math.pow(x/.035,2)));
      return [x,y,z];
    };
    surface(28,40,face,skin,head);
    for(const side of [-1,1]) {
      tube([[side*.14,1.4,-.09],[side*.166,1.43,-.105],[side*.169,1.37,-.1],[side*.145,1.355,-.105]],[.018,.021,.012],[.012,.014,.009],skin,head);
      // almond eyes and brow ribbons embedded in the facial plane
      const x=side*.058, z=-.226;
      patch([[x-.028,1.468,z],[x,1.479,z-.006],[x+.028,1.465,z],[x,1.456,z-.005]],0xe4dcd0,head);
      patch([[x-.01,1.47,z-.007],[x+.009,1.471,z-.008],[x+.009,1.458,z-.007],[x-.009,1.458,z-.007]],0x303430,head);
      tube([[x-.029,1.495,z+.005],[x,1.502,z],[x+.03,1.494,z+.005]],[.004,.006,.003],[.003,.004,.002],hair,head);
    }
    tube([[-.033,1.352,-.245],[0,1.347,-.25],[.033,1.353,-.245]],[.003,.004,.002],[.003,.003,.002],0x9c6555,head);
    const hairStyle = prototype ?? (seed >>> 16) % 7;
    // Hairline follows forehead and temples, with combed ridges in the surface.
    surface(20,40,(v,u)=>{
      v=1-v; const a=u*Math.PI*2, fringe=(hairStyle===2?.86:.72)+.12*Math.sin(a+(hairStyle===3?1.7:.7)), theta=v*(Math.cos(a)>0?fringe:1.25)*Math.PI/2;
      const ridge=1+(hairStyle===5?.085:hairStyle===6?.065:.025)*Math.sin(a*(hairStyle===6?24:15)+v*(hairStyle===5?12:6)), r=Math.sin(theta);
      return [Math.sin(a)*r*.167*ridge,1.572+Math.cos(theta)*(.105+(hairStyle===0?.02:0)),-.092-Math.cos(a)*r*.15*ridge];
    },hair,head);
    if(hairStyle===1 || hairStyle===4 || hairStyle===5) {
      loft([[1.13,.12,.07,.005],[1.2,.17,.09,.006],[1.36,.176,.105,.003],[1.53,.15,.11,-.01],[1.59,.09,.075,-.04]],hair,head,.045);
    }
    if(hairStyle===4) tube([[0,1.52,.04],[.01,1.48,.15],[.01,1.4,.18]], [.06,.095,.04],[.055,.08,.03],hair,head);
    if(hairStyle===2) loft([[1.125,.07,.07,-.09],[1.19,.075,.075,-.09],[1.21,.065,.06,-.09]],cloth);
    const merge = (parts: T.BufferGeometry[]) => { const merged=mergeGeometries(parts); parts.forEach(g=>g.dispose()); if(!merged) throw new Error('character_merge_failed'); return merged; };
    model={body:merge(body),head:merge(head),refs:0}; cache.set(key,model);
  }
  model.refs++; references++;
  const root = new T.Group() as PremiumCharacter; root.name='gfx32-tailored-character';
  root.userData.appearance={seed,style};
  const bodyMesh=rigged?new T.SkinnedMesh(model.body,palette):new T.Mesh(model.body,palette),headMesh=rigged?new T.SkinnedMesh(model.head,palette):new T.Mesh(model.head,palette);
  bodyMesh.name='gfx32-tailored-body';headMesh.name='gfx32-sculpted-head';
  bodyMesh.castShadow=headMesh.castShadow=true;bodyMesh.receiveShadow=headMesh.receiveShadow=true;root.add(bodyMesh,headMesh);
  const rig=rigged?attachCharacterRig(bodyMesh as unknown as T.SkinnedMesh,headMesh as unknown as T.SkinnedMesh):undefined;
  (root as unknown as RiggedObject).rig35=rig;
  let current=data;
  root.updateData=next=>{if(next.employeeId!==data.employeeId)throw new Error('character_identity_changed');current=next;Object.assign(root.userData,next);};root.updateData(data);
  // Static contact pose deliberately preferred to continuous per-character loops.
  root.updateAnimation=(_time,state={})=>{const tilt=state.reducedMotion||state.enabled===false?0:Math.sin(Math.max(0,Math.min(.6,_time))*Math.PI/.6)*.025;const changed=headMesh.rotation.y!==tilt;headMesh.rotation.y=tilt;return changed;};
  let disposed=false;root.dispose=()=>{if(disposed)return;disposed=true;rig?.dispose();root.removeFromParent();root.clear();if(--model!.refs===0){model!.body.dispose();model!.head.dispose();cache.delete(key);}if(--references===0)palette.dispose();};
  return root;
}
