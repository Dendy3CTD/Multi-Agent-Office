export interface Rect { minX:number; maxX:number; minZ:number; maxZ:number }
export interface Workplace { deskId:string; employeeId?:string; x:number; z:number; bounds?:Rect; approach?:{x:number;z:number} }
export interface Obstacle extends Rect { id:string }
export interface PlacementIssue { code:string; id:string; otherId?:string; x:number; z:number }
export interface Route { id:string; reachable:boolean; points:readonly {x:number;z:number}[] }
export interface ArchitectureDiagnostics {
  valid:boolean; workplaceCount:number; employeeCount:number; issues:PlacementIssue[]; routes:Route[];
  agentRadius:number; gridStep:number; obstacles:Obstacle[];
}
export const intersects=(a:Rect,b:Rect)=>a.minX<b.maxX-1e-5&&a.maxX>b.minX+1e-5&&a.minZ<b.maxZ-1e-5&&a.maxZ>b.minZ+1e-5;
export function workplaceRect(w:Workplace):Rect { return w.bounds??{minX:w.x-.82,maxX:w.x+.82,minZ:w.z-.42,maxZ:w.z+1.25}; }
/** Deterministic radius-inflated flood fill; diagnostics only, never changes external seat/layout state. */
export function diagnoseArchitecture(bounds:Rect, workplaces:readonly Workplace[], architecture:readonly Obstacle[], elevator:Obstacle, destinations:readonly {id:string;x:number;z:number}[], start:{x:number;z:number}):ArchitectureDiagnostics {
  const issues:PlacementIssue[]=[],radius=.27,step=.12;
  const within=(r:Rect)=>r.minX>=bounds.minX&&r.maxX<=bounds.maxX&&r.minZ>=bounds.minZ&&r.maxZ<=bounds.maxZ;
  for(const a of architecture) {
    if(!within(a))issues.push({code:'outside_floor',id:a.id,x:a.minX,z:a.minZ});
    if(intersects(a,elevator))issues.push({code:'elevator_collision',id:a.id,otherId:elevator.id,x:Math.max(a.minX,elevator.minX),z:Math.max(a.minZ,elevator.minZ)});
    for(const w of workplaces)if(intersects(a,workplaceRect(w)))issues.push({code:'workplace_collision',id:a.id,otherId:w.deskId,x:Math.max(a.minX,workplaceRect(w).minX),z:Math.max(a.minZ,workplaceRect(w).minZ)});
  }
  for(let i=0;i<workplaces.length;i++){
    const w=workplaces[i],r=workplaceRect(w);
    if(!within(r))issues.push({code:'workplace_outside_floor',id:w.deskId,x:w.x,z:w.z});
    if(intersects(r,elevator))issues.push({code:'workplace_elevator_collision',id:w.deskId,x:w.x,z:w.z});
    for(const v of workplaces.slice(i+1))if(intersects(r,workplaceRect(v)))issues.push({code:'workplaces_overlap',id:w.deskId,otherId:v.deskId,x:w.x,z:w.z});
  }
  const obstacles=[...architecture,elevator,...workplaces.map(w=>({...workplaceRect(w),id:w.deskId}))];
  const cols=Math.ceil((bounds.maxX-bounds.minX)/step),rows=Math.ceil((bounds.maxZ-bounds.minZ)/step);
  const point=(i:number)=>({x:bounds.minX+(i%cols+.5)*step,z:bounds.minZ+(Math.floor(i/cols)+.5)*step});
  const blocked=new Uint8Array(cols*rows),parents=new Int32Array(cols*rows);parents.fill(-1);
  for(let i=0;i<blocked.length;i++){
    const p=point(i);
    if(p.x-radius<bounds.minX||p.x+radius>bounds.maxX||p.z-radius<bounds.minZ||p.z+radius>bounds.maxZ||obstacles.some(o=>p.x>o.minX-radius&&p.x<o.maxX+radius&&p.z>o.minZ-radius&&p.z<o.maxZ+radius))blocked[i]=1;
  }
  const cell=(p:{x:number;z:number})=>{const x=Math.floor((p.x-bounds.minX)/step),z=Math.floor((p.z-bounds.minZ)/step);return x<0||x>=cols||z<0||z>=rows?-1:z*cols+x;};
  const origin=cell(start),queue:number[]=[];
  if(origin>=0&&!blocked[origin]){parents[origin]=origin;queue.push(origin);}else issues.push({code:'elevator_approach_blocked',id:'elevator-approach',...start});
  for(let q=0;q<queue.length;q++){
    const i=queue[q],x=i%cols,z=Math.floor(i/cols);
    for(const [nx,nz] of [[x-1,z],[x+1,z],[x,z-1],[x,z+1]])if(nx>=0&&nx<cols&&nz>=0&&nz<rows){const n=nz*cols+nx;if(!blocked[n]&&parents[n]===-1){parents[n]=i;queue.push(n);}}
  }
  const goals=[...destinations,...workplaces.map(w=>({id:w.employeeId??w.deskId,...(w.approach??{x:w.x,z:w.z+1.65})}))];
  const routes=goals.map(goal=>{
    const n=cell(goal),reachable=n>=0&&parents[n]!==-1,points:{x:number;z:number}[]=[];
    if(reachable){let i=n;while(i!==origin){points.push(point(i));i=parents[i];}points.push(point(origin));points.reverse();}
    else issues.push({code:'unreachable',id:goal.id,x:goal.x,z:goal.z});
    return {id:goal.id,reachable,points};
  });
  return {valid:issues.length===0,workplaceCount:workplaces.length,employeeCount:workplaces.filter(w=>w.employeeId).length,issues,routes,agentRadius:radius,gridStep:step,obstacles};
}
