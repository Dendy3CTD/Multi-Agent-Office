import * as THREE from 'three'
import type { FloorDesignPreset } from './types'
import { buildFloorPresetGeometry } from './render'
import { createProceduralOfficeAssetLibrary } from '../../office-art/procedural-library'

/** Browser-only geometry probes. These are deliberately not registered as office floors. */
export const FLOOR_PRESET_GEOMETRY_FIXTURES: readonly FloorDesignPreset[] = [
  {
    schemaVersion: 1, floorId: 'fixture-geometry-a', presetId: 'fixture:atrium-a', theme: 'atrium', specialization: 'v4-contract-probe', referenceImage: '/design-references/office-v4/floor-01.png',
    bounds: { width: 22, depth: 14, height: 5.8 },
    zones: [{ id: 'fixture-a-zone', kind: 'meeting', bounds: { x: 1, z: 1, width: 7, depth: 5 }, label: 'TEST ATRIUM' }],
    rooms: [{ id: 'fixture-a-room', kind: 'meeting', bounds: { x: 13, z: 8, width: 6, depth: 4 }, capacity: 6, privacy: 'glass', door: { wall: 'east', offset: 1.2, width: 1.25 } }],
    barriers: [{ id: 'fixture-a-barrier', kind: 'glass', x: 9, z: 3, length: 5, height: 2.7, rotationY: Math.PI / 2, material: 'glass-tint', doorWidth: 1.2 }],
    windows: [{ id: 'fixture-a-window', wall: 'north', offset: 3, width: 8, sill: 1, height: 3, frameMaterial: 'graphite-metal' }],
    entrances: [{ id: 'fixture-a-entry', wall: 'south', offset: 2, width: 1.4, kind: 'door' }],
    materials: { floor: 'oak-floor', wall: 'warm-plaster', trim: 'bronze', glass: 'glass-tint' },
    lighting: { exposure: 1.04, ambient: '#e4edf4', key: '#fff6e8', fill: '#d8e8f2', keyIntensity: 2.2, fillIntensity: .8, fixtures: [{ id: 'probe-warm-pendant', kind: 'point', x: 6, y: 3.1, z: 7, color: '#ffd4a0', intensity: 18, distance: 5 }] },
    furniture: [{ id: 'fixture-a-table', asset: 'table.meeting', x: 7, z: 10, interaction: { kind: 'display', targetId: 'fixture-board' } }], decor: [{ id: 'fixture-a-plant', asset: 'plant.potted', x: 19, z: 2 }],
    workplaces: [{ id: 'fixture-a-seat', deskId: 'fixture-desk-a', employeeId: 'fixture-employee-a', x: 3, z: 10, width: 1.5, depth: 1.3, kind: 'lab', equipment: ['equipment.oscilloscope'] }], aisles: [{ x: 9, z: 1, width: 1.3, depth: 12 }],
    camera: { position: [18, 18, -22], target: [0, 1.5, 0], zoom: 1, minZoom: .72, maxZoom: 1.8 },
  },
  {
    schemaVersion: 1, floorId: 'fixture-geometry-b', presetId: 'fixture:studio-b', theme: 'studio',
    bounds: { width: 25, depth: 16, height: 6.2 },
    zones: [{ id: 'fixture-b-zone', kind: 'focus', bounds: { x: 2, z: 2, width: 8, depth: 6 }, label: 'TEST STUDIO' }],
    rooms: [{ id: 'fixture-b-room', kind: 'focus', bounds: { x: 15, z: 9, width: 7, depth: 5 }, capacity: 4 }],
    barriers: [{ id: 'fixture-b-barrier', kind: 'wall', x: 11, z: 3, length: 6, height: 3, rotationY: 0, material: 'walnut', doorWidth: 1.4 }],
    windows: [{ id: 'fixture-b-window', wall: 'east', offset: 4, width: 5, sill: 1.2, height: 3.2, frameMaterial: 'graphite-metal' }],
    entrances: [{ id: 'fixture-b-entry', wall: 'west', offset: 5, width: 1.6, kind: 'elevator' }],
    materials: { floor: 'dark-oak', wall: 'sand-plaster', trim: 'brushed-bronze', glass: 'sage-glass' },
    lighting: { exposure: 1.08, ambient: '#e4edf4', key: '#fff6e8', fill: '#d8e8f2', keyIntensity: 2.45, fillIntensity: .85 },
    furniture: [{ id: 'fixture-b-desk', asset: 'desk.modern', x: 5.8, z: 12 }], decor: [{ id: 'fixture-b-art', asset: 'wall.decoration', x: 22, z: 8 }],
    workplaces: [{ id: 'fixture-b-seat', x: 4, z: 12, width: 1.5, depth: 1.3 }], aisles: [{ x: 12, z: 1, width: 1.5, depth: 14 }],
    camera: { position: [20, 19, -24], target: [0, 1.6, 0], zoom: 1, minZoom: .72, maxZoom: 1.8 },
  },
]

/** WebGL raster check used by browser acceptance; this module stays out of the authored registry. */
export async function rasterizeFloorPresetFixture(preset: FloorDesignPreset) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setSize(320, 240); renderer.setPixelRatio(1)
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#293038')
  scene.add(new THREE.HemisphereLight('#f2eee5', '#58616a', 2.1))
  const key = new THREE.DirectionalLight('#fff2dc', 2.7); key.position.set(-8, 15, -10); scene.add(key)
  const camera = new THREE.OrthographicCamera(-16, 16, 12, -12, .1, 100); camera.position.set(20, 20, -25); camera.lookAt(0, 1.5, 0)
  const rendered = await buildFloorPresetGeometry(preset, .12)
  scene.add(rendered)
  camera.left = -Math.max(preset.bounds.width, preset.bounds.depth) * .75; camera.right = -camera.left
  camera.top = camera.right * .75; camera.bottom = -camera.top; camera.updateProjectionMatrix()
  document.body.appendChild(renderer.domElement)
  renderer.domElement.style.cssText = 'position:fixed;left:-400px;top:0;width:320px;height:240px;'
  renderer.render(scene, camera)
  const drawCalls = renderer.info.render.calls
  const triangleCount = renderer.info.render.triangles
  let meshCount = 0
  rendered.traverse(node => { if ((node as THREE.Mesh).isMesh) meshCount++ })
  rendered.updateMatrixWorld(true)
  // Window skyline is exterior environment geometry. Keep it visible in the
  // raster but exclude it from the floor plan's architectural bounds check.
  const bounds = new THREE.Box3()
  rendered.updateMatrixWorld(true)
  rendered.traverse(object => {
    if (object.userData.excludeFromFloorBounds || !(object as THREE.Mesh).isMesh) return
    bounds.union(new THREE.Box3().setFromObject(object))
  })
  const summary = {
    drawCalls, triangleCount, meshCount,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    elementCounts: rendered.userData.presetElementCounts,
    openings: rendered.userData.presetOpenings,
    camera: rendered.userData.presetCamera,
    lighting: rendered.userData.presetLighting,
    specialization: rendered.userData.floorPresetSpecialization,
    referenceImage: rendered.userData.floorPresetReferenceImage,
    localLights: rendered.userData.presetLocalLights,
    workplaceProfiles: rendered.userData.presetWorkplaceProfiles,
    interactions: rendered.userData.presetInteractions,
    placementCounts: rendered.userData.presetPlacementCounts,
    textureUrls: rendered.userData.textureUrls,
    textureFailures: rendered.userData.textureFailures,
  }
  scene.remove(rendered); rendered.userData.dispose(); renderer.domElement.remove(); renderer.dispose()
  return summary
}

/** Raster check for the shared assembled specialist props; fixtures are not registered floors. */
export async function rasterizeProceduralAssetFixtures() {
  const ids = [
    'desk.reception', 'desk.lab', 'desk.cad', 'desk.standing', 'desk.focus',
    'equipment.oscilloscope', 'equipment.test-bench', 'equipment.3d-printer',
    'equipment.server-rack', 'equipment.analytics-display', 'equipment.graphics-tablet',
    'equipment.espresso-machine', 'equipment.cafe-counter', 'equipment.refrigerator', 'equipment.security-console',
    'equipment.network-rack', 'equipment.archive-shelf', 'equipment.qa-device-wall',
    'equipment.whiteboard-display', 'furniture.pool-table', 'furniture.foosball',
    'furniture.acoustic-focus-pod', 'furniture.whiteboard', 'furniture.cafe-table',
    'furniture.banquette', 'furniture.moodboard', 'furniture.kiosk',
  ]
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setSize(960, 640); renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#20272e')
  scene.add(new THREE.HemisphereLight('#f4eee4', '#4b5156', 2.2))
  const key = new THREE.DirectionalLight('#fff1dc', 2.6); key.position.set(-10, 18, -14); scene.add(key)
  const camera = new THREE.PerspectiveCamera(38, 960 / 640, .1, 100); camera.position.set(15, 18, 27); camera.lookAt(0, 0, 0)
  const library = createProceduralOfficeAssetLibrary()
  await library.ready()
  const summaries: { id: string; meshCount: number; triangles: number; bounds: number[] }[] = []
  ids.forEach((id, index) => {
    const object = library.create(id)
    object.position.set((index % 5 - 2) * 4.2, 0, (Math.floor(index / 5) - 2) * 4.5)
    object.scale.setScalar(.78)
    scene.add(object)
    let meshCount = 0, triangles = 0
    object.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      meshCount++
      const indexCount = mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0
      triangles += Math.floor(indexCount / 3)
    })
    object.updateMatrixWorld(true)
    summaries.push({ id, meshCount, triangles, bounds: new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).toArray() })
  })
  renderer.render(scene, camera)
  const pixels = new Uint8Array(960 * 640 * 4)
  renderer.getContext().readPixels(0, 0, 960, 640, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels)
  const background = [pixels[0]!, pixels[1]!, pixels[2]!]
  let nonBackgroundPixels = 0
  for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i]! - background[0]!) > 4 || Math.abs(pixels[i + 1]! - background[1]!) > 4 || Math.abs(pixels[i + 2]! - background[2]!) > 4) nonBackgroundPixels++
  const drawCalls = renderer.info.render.calls
  const triangleCount = renderer.info.render.triangles
  for (const child of [...scene.children]) if (child.type === 'Group') scene.remove(child)
  library.dispose(); renderer.dispose()
  return { assets: summaries, drawCalls, triangleCount, nonBackgroundPixels }
}
