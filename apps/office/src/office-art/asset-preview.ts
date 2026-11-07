import * as THREE from 'three'
import { createOfficeArtRuntime } from './loader'
import type { OfficeAssetManifest } from './asset-manifest'

const ids = ['desk.modern', 'chair.ergonomic', 'armchair.cozy', 'sofa.cozy', 'plant.potted', 'table.coffee', 'lamp.standing', 'elevator.display']
const canvas = document.createElement('canvas')
document.body.style.cssText = 'margin:0;background:#eee5d8;font:14px system-ui;color:#302e29'
document.body.innerHTML = '<h1 style="margin:16px 24px">MAO — actual GLB geometry / BEFORE · AFTER</h1>'
document.body.append(canvas)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(1600, 1280)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1
const stats: Record<string, unknown>[] = []
async function load(version: string) {
  const prefix = version === 'before' ? '/office-art/studio-29/before' : '/office-art/v1'
  const rewrite = (json: unknown) => JSON.parse(JSON.stringify(json).split('/office-art/v1').join(prefix))
  const fetcher = async (url: string) => { const r = await fetch(url); return { ok: r.ok, json: async () => rewrite(await r.json()) } }
  const manifest = rewrite(await (await fetch(`${prefix}/manifest.json`)).json()) as OfficeAssetManifest
  const runtime = createOfficeArtRuntime({ manifestUrl: `${prefix}/manifest.json`, manifest: { ...manifest, assets: manifest.assets.map(asset => ({ ...asset, node: asset.node?.split('.').join('') })) }, fetcher })
  const groups = await Promise.all(ids.map(async id => {
    const group = new THREE.Group()
    const instance = await runtime.createInstance(id)
    await runtime.applyMaterials(instance)
    group.add(instance)
    if (id === 'desk.modern') for (const asset of ['monitor.single','keyboard','desk.lamp']) { const object=await runtime.createInstance(asset);await runtime.applyMaterials(object);if(asset==='desk.lamp')object.position.x=-.6;group.add(object) }
    if (id.startsWith('character')) { const chair=await runtime.createInstance('chair.ergonomic');await runtime.applyMaterials(chair);group.add(chair) }
    return group
  }))
  for (const group of groups) for (const instance of group.children) await runtime.applyMaterials(instance)
  return groups
}
async function run() {
  const [before, after] = await Promise.all([load('before'), load('after')])
  renderer.setScissorTest(true)
  for (let index = 0; index < ids.length; index++) for (let version=0;version<2;version++) {
    const group = (version ? after : before)[index]
    const scene=new THREE.Scene();scene.background=new THREE.Color('#e5dccc');scene.add(group)
    scene.add(new THREE.HemisphereLight(0xe6edf2,0x727f86,2))
    const light=new THREE.DirectionalLight(0xfff5ee,2);light.position.set(-3,7,-5);scene.add(light)
    const bounds=new THREE.Box3().setFromObject(group), center=bounds.getCenter(new THREE.Vector3())
    // Same camera and framing per pair, based on the union of old/new geometry.
    const pair=new THREE.Box3().setFromObject(before[index]).union(new THREE.Box3().setFromObject(after[index]))
    const size=pair.getSize(new THREE.Vector3()), span=Math.max(size.y,size.x*.85,size.z,1)*.72
    const camera=new THREE.OrthographicCamera(-span*1.25,span*1.25,span,-span,.01,100)
    camera.position.copy(center).add(new THREE.Vector3(4,3,-5));camera.lookAt(center)
    const column=index%4, row=Math.floor(index/4)*2+version, x=column*400,y=1280-(row+1)*320
    renderer.setViewport(x,y,400,320);renderer.setScissor(x,y,400,320);renderer.render(scene,camera)
    const label=document.createElement('div');label.textContent=`${ids[index]} · ${version?'AFTER':'BEFORE'}`;label.style.cssText=`position:absolute;left:${x+10}px;top:${64+row*320}px;font-size:12px;font-weight:700;pointer-events:none`;document.body.append(label)
    stats.push({id:ids[index],version:version?'after':'before',calls:renderer.info.render.calls,triangles:renderer.info.render.triangles})
  }
  Object.assign(window,{artPreview:{ready:true,stats}})
}
void run().catch(error => { Object.assign(window,{artPreview:{error:String(error.stack??error)}}) })
