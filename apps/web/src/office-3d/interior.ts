import type { FloorLayout } from '../office-layout';

export interface InteriorPlacement {
  id: string;
  position: [number, number, number];
  fitScale?: [number, number, number];
  rotationY?: number;
  zone: 'windows' | 'meeting' | 'lounge' | 'detail';
}
export interface WallSegment { x: number; y: number; width: number; height: number }

/** Split an existing wall around frame apertures. This is scene assembly, not seat layout. */
export function northWindowAssembly(layout: FloorLayout) {
  const width = layout.size.width, height = layout.size.height ?? 5.8;
  const openings = layout.windows.map(window => ({ x: window.position.x - width / 2, width: 3.84, bottom: 1.05, top: 4.4 }));
  const segments: WallSegment[] = [];
  let cursor = -width / 2;
  for (const opening of [...openings].sort((a,b) => a.x-b.x)) {
    const left = opening.x - opening.width/2, right = opening.x + opening.width/2;
    if (left > cursor) segments.push({ x: (cursor+left)/2, y: height/2, width: left-cursor, height });
    segments.push({ x: opening.x, y: opening.bottom/2, width: opening.width, height: opening.bottom });
    segments.push({ x: opening.x, y: (opening.top+height)/2, width: opening.width, height: height-opening.top });
    cursor = right;
  }
  if (cursor < width/2) segments.push({ x:(cursor+width/2)/2,y:height/2,width:width/2-cursor,height });
  return { openings, segments };
}

export function interiorPlacements(layout: FloorLayout): InteriorPlacement[] {
  const result: InteriorPlacement[] = [];
  const add = (id: string, position: InteriorPlacement['position'], zone: InteriorPlacement['zone'], fitScale?: InteriorPlacement['fitScale'], rotationY?: number) => result.push({id,position,zone,fitScale,rotationY});
  for (const opening of northWindowAssembly(layout).openings) {
    add('window.frame',[opening.x,-.415,layout.size.depth/2-.04],'windows',[1.6,2.1,1]);
  }
  const room = layout.rooms.find(room => room.kind === 'meeting');
  if (room) {
    const left=room.bounds.x-layout.size.width/2, right=left+room.bounds.width;
    const front=room.bounds.z-layout.size.depth/2, back=front+room.bounds.depth;
    const x=(left+right)/2, z=(front+back)/2;
    // Three complete glazed sides. The fourth has a fixed pane and a real door.
    for (const side of [left,right]) add('partition.glass',[side,0,z],'meeting',[room.bounds.depth/2.4,1.12,1],Math.PI/2);
    add('partition.glass',[x,0,back],'meeting',[room.bounds.width/2.4,1.12,1]);
    add('partition.glass',[left+(room.bounds.width-1.06)/2,0,front],'meeting',[(room.bounds.width-1.06)/2.4,1.12,1]);
    add('door.office.glass',[right-.53,0,front],'meeting',[1,1.12,1]);
    add('rug.area',[x,.13,z],'meeting',[1.65,1,1.35]);
    add('table.meeting',[x,0,z],'meeting');
    for (const sign of [-1,1]) for (const offset of [-.85,.85]) add('chair.meeting',[x+offset,0,z+sign*.98],'meeting',undefined,sign<0?Math.PI:0);
    add('pendant.led',[x,1.6,z],'meeting');
    add('plant.potted',[right-.45,0,back-.45],'meeting',[.7,.7,.7]);
    add('wall.decoration',[right-.08,1.2,z],'meeting',[1,1,1],Math.PI/2);
  }
  const rest = layout.rooms.find(room=>room.kind==='rest');
  if (rest) {
    const x=rest.bounds.x-layout.size.width/2+rest.bounds.width/2;
    const z=rest.bounds.z-layout.size.depth/2+rest.bounds.depth/2;
    add('rug.area',[x,.13,z],'lounge',[1.35,1,1.5]);
    add('sofa.cozy',[x+.1,0,z-1.0],'lounge',undefined,Math.PI);
    add('armchair.cozy',[x-1.55,0,z+.35],'lounge',undefined,-Math.PI/2);
    add('table.coffee',[x-.15,0,z+.05],'lounge');
    add('lamp.standing',[x-1.9,0,z-1.0],'lounge');
    add('plant.potted',[x-1.9,0,z+1.05],'lounge',[.8,.8,.8]);
    add('plant.potted',[x+1.25,0,z-1.1],'lounge',[.7,.7,.7]);
  }
  add('bookshelf',[6.6,0,3.7],'detail');
  add('filing.cabinet',[8.25,0,4.25],'detail');
  add('wall.decoration',[0,2.6,6.82],'detail');
  return result;
}
