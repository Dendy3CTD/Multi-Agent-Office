import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OfficeArtRuntime } from './loader'
const root = resolve(process.cwd(), 'public/office-art')
const bytes = readFileSync(resolve(root, 'v1/office-pack.glb'))
const json = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString())
const manifest = JSON.parse(readFileSync(resolve(root,'v1/manifest.json'),'utf8'))
const original = JSON.parse(readFileSync(resolve(root,'comparison/before/manifest.json'),'utf8'))
const parse = () => new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
describe('premium geometry and interaction contracts',()=>{
 it('preserves all public IDs and elevator pivots',()=>{
  for(const asset of original.assets)expect(manifest.assets.some((a:any)=>a.id===asset.id)).toBe(true)
  for(const [name,x,offset] of [['left',-.54,-.95],['right',.54,.95]] as const){
   const node=json.nodes.find((n:any)=>n.name===`elevator.doors.${name}`)
   expect(node.translation).toEqual([x,1.25,-.96]);expect(node.extras.openTranslation).toEqual([offset,0,0])
  }
 })
 it('loads real GLB with valid animation sampler dimensions',async()=>{
  const gltf=await parse();expect(gltf.scene.getObjectByName('elevatordoorsleft')).toBeDefined()
  expect(gltf.animations[0].tracks).toHaveLength(2)
  for(const sampler of json.animations[0].samplers)expect(json.accessors[sampler.input].count).toBe(json.accessors[sampler.output].count)
  expect(bytes.length).toBeLessThan(2*1024*1024)
 })
 it('has finite unit normals and bounded mesh indices',()=>{
  const binaryOffset=28+bytes.readUInt32LE(12)
  for(const mesh of json.meshes)for(const p of mesh.primitives){
   const normal=json.accessors[p.attributes.NORMAL],v=json.bufferViews[normal.bufferView]
   for(let i=0;i<normal.count;i++)expect(Math.hypot(...[0,1,2].map(a=>bytes.readFloatLE(binaryOffset+v.byteOffset+i*12+a*4)))).toBeCloseTo(1,4)
   expect(json.accessors[p.indices].max[0]).toBeLessThan(json.accessors[p.attributes.POSITION].count)
  }
 })
 it('batches richer chair geometry by material',()=>{
  const node=json.nodes.find((n:any)=>n.name==='chair.ergonomic');expect(node.children.length).toBeLessThanOrEqual(4)
  const triangles=node.children.flatMap((i:number)=>json.meshes[json.nodes[i].mesh].primitives).reduce((n:number,p:any)=>n+json.accessors[p.indices].count/3,0)
  expect(triangles).toBeGreaterThan(1000)
 })
 it('preserves employee identities with independent, deterministic visual clones',async()=>{
  const gltf=await parse();const runtime=new OfficeArtRuntime({manifest,modelLoader:async()=>({scene:gltf.scene,animations:gltf.animations})})
  const a=await runtime.createCharacter('employee-a','working',{position:[1,0,2]})
  const b=await runtime.createCharacter('employee-b','working',{position:[1,0,2]})
  expect(a).not.toBe(b);expect(a.name).toBe(b.name)
  expect(a.userData.employeeId).toBe('employee-a');expect(b.userData.employeeId).toBe('employee-b')
  expect(manifest.assets.find((a:any)=>a.id==='character.base.working').variants).toHaveLength(3)
  runtime.disposeInstance(a);runtime.disposeInstance(b);runtime.disposeSharedResources()
 })
})
