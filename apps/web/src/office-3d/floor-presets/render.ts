import * as THREE from 'three'
import type { FloorDesignPreset, FloorWindowPreset } from './types'
import { floorPlanPointToWorld } from './coordinates'

const PALETTE = {
  graphite: 0x24272e,
  walnut: 0x72513f,
  bronze: 0xb58b5c,
  sand: 0xd8c7af,
  sage: 0x668378,
  glass: 0xa7c8c3,
  plaster: 0xe6ded1,
  brick: 0x86523d,
} as const
const sharedPresetTextures = new Map<string, Promise<THREE.Texture>>()

function sharedTexture(url: string): Promise<THREE.Texture> {
  let texture = sharedPresetTextures.get(url)
  if (!texture) {
    texture = new THREE.TextureLoader().loadAsync(url).then(value => {
      value.colorSpace = THREE.SRGBColorSpace
      value.wrapS = value.wrapT = THREE.RepeatWrapping
      value.repeat.set(3, 2)
      value.anisotropy = 4
      return value
    })
    sharedPresetTextures.set(url, texture)
  }
  return texture
}

function textureFor(role: string, id: string): string | undefined {
  const key = `${role} ${id}`.toLowerCase()
  if (/texture\.oak\.light/.test(key) || role === 'floor' || /oak|wood|walnut/.test(key)) return '/office-art/v1/textures/oak-light.svg'
  if (/texture\.wall\.brick\.warm|brick/.test(key)) return '/office-art/v1/textures/brick-warm.svg'
  if (/texture\.wall|plaster|paint|sand/.test(key)) return '/office-art/v1/textures/cream-wall.svg'
  if (/texture\.glass|glass|glaz|window/.test(key)) return '/office-art/v1/textures/glass-tint.svg'
  if (/texture\.fabric|fabric|textile|sage|upholstery/.test(key)) return '/office-art/v1/textures/fabric-sage.svg'
  if (/texture\.bronze|metal|graphite|bronze|brass|trim/.test(key)) return '/office-art/v1/textures/bronze-brushed.svg'
  return undefined
}

export function presetMaterialColor(id: string, role: string, theme: FloorDesignPreset['theme']): number {
  const directHex = id.match(/^#?([0-9a-f]{6})$/i)
  if (directHex) return Number.parseInt(directHex[1]!, 16)
  if (role === 'theme-accent') return theme === 'industrial' ? PALETTE.graphite : theme === 'library' ? PALETTE.walnut : theme === 'studio' || theme === 'atrium' ? PALETTE.sage : PALETTE.bronze
  if (role === 'floor') return PALETTE.sand
  const key = `${role} ${id}`.toLowerCase()
  if (/graphite|charcoal|metal|bronze|brass/.test(key)) return /bronze|brass/.test(key) ? PALETTE.bronze : PALETTE.graphite
  if (/glass|glaz|window/.test(key)) return PALETTE.glass
  if (/sage|plant|fabric|textile|upholstery/.test(key)) return PALETTE.sage
  if (/brick|walnut|wood|oak|timber/.test(key)) return /brick/.test(key) ? PALETTE.brick : PALETTE.walnut
  if (/sand|plaster|wall|paint|cream|textile/.test(key)) return PALETTE.sand
  if (role === 'zone-meeting' || role === 'zone-focus') return PALETTE.sage
  if (role === 'zone-lounge' || role === 'zone-reception') return PALETTE.bronze
  if (role === 'zone-circulation') return PALETTE.graphite
  if (role === 'floor') return PALETTE.sand
  if (role === 'wall') return PALETTE.plaster
  if (role === 'glass') return PALETTE.glass
  if (role === 'frame' || role === 'metal') return PALETTE.graphite
  return PALETTE.walnut
}

type Opening = { offset: number; width: number; bottom: number; top: number; kind: 'window' | 'entrance' }

/** Builds the architectural plan layer. Called only for authored non-showroom presets. */
export async function buildFloorPresetGeometry(preset: FloorDesignPreset, floorY = 0): Promise<THREE.Group> {
  const group = new THREE.Group()
  group.name = `floor-preset-geometry:${preset.presetId}`
  const { width, depth, height } = preset.bounds
  const uniqueGeometries = new Set<THREE.BufferGeometry>()
  const uniqueMaterials = new Set<THREE.Material>()
  const uniqueTextures = new Set<THREE.Texture>()
  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  uniqueGeometries.add(unitBox)
  const materialCache = new Map<string, THREE.MeshStandardMaterial>()
  const textureBindings = new Map<string, THREE.MeshStandardMaterial[]>()
  const makeMaterial = (role: string, source: string, alpha = 1) => {
    const cacheKey = `${role}:${source}:${alpha}`
    let material = materialCache.get(cacheKey)
    if (!material) {
      const glass = role === 'glass'
      const paletteSource = glass ? (preset.materials.glazing ?? 'glass-tint') : source
      material = new THREE.MeshStandardMaterial({
        name: `preset-${role}:${source}`,
        color: presetMaterialColor(paletteSource, role, preset.theme),
        roughness: glass ? .13 : /metal|frame/.test(role) ? .43 : /floor|zone/.test(role) ? .86 : .74,
        metalness: /metal|frame/.test(role) ? .28 : glass ? .025 : .035,
        transparent: alpha < 1 || glass,
        opacity: glass ? Math.min(alpha, .24) : alpha,
        depthWrite: alpha >= .9 && !glass,
        side: glass ? THREE.DoubleSide : THREE.FrontSide,
      })
      if (role === 'city-sky') {
        material.emissive.set('#718d98')
        material.emissiveIntensity = .34
        material.roughness = 1
      }
      if (role === 'city-building') {
        material.emissive.set('#283c40')
        material.emissiveIntensity = .22
        material.roughness = .96
      }
      materialCache.set(cacheKey, material)
      uniqueMaterials.add(material)
      const url = textureFor(role, source)
      if (url) {
        const bindings = textureBindings.get(url) ?? []
        bindings.push(material)
        textureBindings.set(url, bindings)
      }
    }
    return material
  }
  const addBox = (id: string, role: string, size: [number, number, number], position: [number, number, number], source = preset.materials[role] ?? role, alpha = 1, rotationY = 0) => {
    const mesh = new THREE.Mesh(unitBox, makeMaterial(role, source, alpha))
    mesh.name = `preset:${id}`
    mesh.scale.set(...size)
    mesh.position.set(...position)
    mesh.rotation.y = rotationY
    mesh.castShadow = role === 'wall' || role === 'partition' || role === 'frame' || role === 'entrance-frame'
    mesh.receiveShadow = role !== 'glass'
    mesh.userData.floorPresetId = id
    mesh.userData.floorPresetRole = role
    group.add(mesh)
    return mesh
  }
  const p = (x: number, y: number, z: number): [number, number, number] => floorPlanPointToWorld({ x, y, z }, preset.bounds, floorY)
  const addLabel = (id: string, label: string, x: number, z: number, tint: number) => {
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = `#${tint.toString(16).padStart(6, '0')}`
    ctx.globalAlpha = .9
    ctx.beginPath(); ctx.roundRect(8, 12, 496, 104, 24); ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = '#f6f1e9'; ctx.font = '600 34px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(label, 256, 65, 460)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    uniqueTextures.add(texture)
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    uniqueMaterials.add(material)
    const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.1, .52), material)
    uniqueGeometries.add(labelMesh.geometry)
    labelMesh.name = `preset-zone-label:${id}`
    labelMesh.position.set(...p(x, .035, z))
    labelMesh.rotation.x = -Math.PI / 2
    labelMesh.renderOrder = 2
    labelMesh.userData.floorPresetId = id
    group.add(labelMesh)
  }

  if (preset.specialization) {
    const canvas = document.createElement('canvas')
    canvas.width = 768; canvas.height = 192
    const context = canvas.getContext('2d')
    if (context) {
      context.fillStyle = '#24272e'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#b58b5c'; context.fillRect(0, 0, 15, canvas.height)
      context.fillStyle = '#d8c7af'; context.font = '600 54px system-ui, sans-serif'; context.textAlign = 'left'; context.textBaseline = 'middle'
      const title = preset.specialization.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
      context.fillText(title, 52, 96, 680)
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
      uniqueTextures.add(texture)
      const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide })
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, .9), material)
      sign.name = `preset:specialization-sign:${preset.specialization}`
      sign.position.set(width / 2 - .22, Math.min(height - .72, 3.8), depth / 2 - 1.65)
      sign.rotation.y = -Math.PI / 2
      sign.userData.floorPresetSpecialization = preset.specialization
      sign.raycast = () => {}
      group.add(sign); uniqueGeometries.add(sign.geometry); uniqueMaterials.add(material)
    }
  }

  // Zones and aisles are shallow material inlays on the shared floor surface.
  for (const zone of preset.zones) {
    const color = presetMaterialColor('', `zone-${zone.kind}`, preset.theme)
    const { x, z, width: w, depth: d } = zone.bounds
    addBox(`zone:${zone.id}`, 'zone', [w, .012, d], p(x + w / 2, .009, z + d / 2), zone.material ?? `zone-${zone.kind}`, zone.kind === 'circulation' ? .17 : .25)
    if (zone.label) addLabel(zone.id, zone.label, x + w / 2, z + d / 2, color)
  }
  for (const [index, aisle] of preset.aisles.entries()) {
    addBox(`aisle:${index}`, 'aisle', [aisle.width, .008, aisle.depth], p(aisle.x + aisle.width / 2, .007, aisle.z + aisle.depth / 2), 'aisle-marking', .1)
  }

  // Room doors are modeled as real openings. v1 presets without a door keep
  // the original centered 1.15 m opening on the south wall.
  for (const room of preset.rooms) {
    const { x, z, width: w, depth: d } = room.bounds
    const roomIsOpen = room.privacy === 'open'
    const wallHeight = roomIsOpen ? .14 : Math.min(2.75, height * .58)
    const thickness = .12
    const defaultDoorWidth = Math.min(1.15, w * .36)
    const door = room.door ?? { wall: 'south' as const, width: defaultDoorWidth }
    const doorWidth = Math.min(door.width, door.wall === 'north' || door.wall === 'south' ? w : d)
    const west = x - width / 2, east = west + w, south = z - depth / 2, north = south + d
    const cx = (west + east) / 2, cz = (south + north) / 2
    const roomRole = room.privacy === 'glass' ? 'glass' : 'wall'
    const roomAlpha = room.privacy === 'glass' ? .3 : 1
    const roomFinish = room.material ?? preset.materials.wall ?? room.kind
    if (door.wall !== 'north') addBox(`room:${room.id}:north`, roomRole, [w, wallHeight, thickness], [cx, floorY + wallHeight / 2, north], roomFinish, roomAlpha)
    if (door.wall !== 'west') addBox(`room:${room.id}:west`, roomRole, [thickness, wallHeight, d], [west, floorY + wallHeight / 2, cz], roomFinish, roomAlpha)
    if (door.wall !== 'east') addBox(`room:${room.id}:east`, roomRole, [thickness, wallHeight, d], [east, floorY + wallHeight / 2, cz], roomFinish, roomAlpha)
    const horizontal = door.wall === 'north' || door.wall === 'south'
    const wallStart = door.wall === 'north' || door.wall === 'south' ? west : south
    const wallSpan = horizontal ? w : d
    const doorOffset = THREE.MathUtils.clamp(door.offset ?? (wallSpan - doorWidth) / 2, 0, wallSpan - doorWidth)
    const clearStart = wallStart + doorOffset, clearEnd = clearStart + doorWidth
    const wallZ = door.wall === 'north' ? north : south
    const wallX = door.wall === 'east' ? east : west
    const segment = (start: number, end: number, suffix: string) => {
      if (end - start <= .05) return
      if (horizontal) addBox(`room:${room.id}:south:${suffix}`, roomRole, [end - start, wallHeight, thickness], [(start + end) / 2, floorY + wallHeight / 2, wallZ], roomFinish, roomAlpha)
      else addBox(`room:${room.id}:side:${suffix}`, roomRole, [thickness, wallHeight, end - start], [wallX, floorY + wallHeight / 2, (start + end) / 2], roomFinish, roomAlpha)
    }
    segment(wallStart, clearStart, 'a'); segment(clearEnd, wallStart + wallSpan, 'b')
    const doorCenter = (clearStart + clearEnd) / 2
    if (!roomIsOpen && horizontal) addBox(`room:${room.id}:door-header`, 'wall', [doorWidth, .22, thickness], [doorCenter, floorY + wallHeight - .11, wallZ], preset.materials.trim ?? 'bronze')
    else if (!roomIsOpen) addBox(`room:${room.id}:door-header`, 'wall', [thickness, .22, doorWidth], [wallX, floorY + wallHeight - .11, doorCenter], preset.materials.trim ?? 'bronze')
    if (!roomIsOpen && door.kind !== 'open') {
      const jamb = .055
      if (horizontal) for (const edge of [clearStart, clearEnd]) addBox(`room:${room.id}:door-jamb:${edge}`, 'frame', [jamb, wallHeight, thickness + .035], [edge, floorY + wallHeight / 2, wallZ], preset.materials.trim ?? 'graphite-metal')
      else for (const edge of [clearStart, clearEnd]) addBox(`room:${room.id}:door-jamb:${edge}`, 'frame', [thickness + .035, wallHeight, jamb], [wallX, floorY + wallHeight / 2, edge], preset.materials.trim ?? 'graphite-metal')
    }
    addBox(`room:${room.id}:floor`, 'room-floor', [Math.max(.1, w - .16), .018, Math.max(.1, d - .16)], [cx, floorY + .018, cz], preset.materials.floor ?? room.kind, .46)
    if (room.capacity) addLabel(room.id, `${room.kind} · ${room.capacity}`, x + w / 2, z + d / 2, PALETTE.graphite)
  }

  // Partition centerline begins at (x,z) and extends along +X rotated by rotationY.
  for (const barrier of preset.barriers) {
    const gap = Math.min(barrier.doorWidth ?? 0, barrier.length * .58)
    const halfSegment = (barrier.length - gap) / 2
    const dirX = Math.cos(barrier.rotationY), dirZ = Math.sin(barrier.rotationY)
    const midpoint = (distance: number, y = barrier.height / 2): [number, number, number] => [barrier.x - width / 2 + dirX * distance, floorY + y, barrier.z - depth / 2 + dirZ * distance]
    const spans = gap > 0 ? [[0, halfSegment], [barrier.length - halfSegment, barrier.length]] as const : [[0, barrier.length]] as const
    for (const [side, [start, end]] of spans.entries()) {
      const spanLength = end - start
      if (spanLength <= .05) continue
      const center = (start + end) / 2
      if (barrier.kind === 'railing') {
        const railHeight = Math.min(barrier.height, .1)
        for (const y of [Math.min(.38, barrier.height * .38), Math.max(.48, barrier.height - .14)]) addBox(`barrier:${barrier.id}:rail:${side}:${y}`, 'frame', [spanLength, railHeight, .09], midpoint(center, y), barrier.material, 1, barrier.rotationY)
        for (const distance of [start, end]) addBox(`barrier:${barrier.id}:post:${side}:${distance}`, 'frame', [.1, barrier.height, .1], midpoint(distance), barrier.material, 1, barrier.rotationY)
      } else {
        addBox(`barrier:${barrier.id}:${side}`, barrier.kind === 'glass' ? 'glass' : 'partition', [spanLength, barrier.height, barrier.kind === 'glass' ? .08 : .14], midpoint(center), barrier.material, barrier.kind === 'glass' ? .32 : 1, barrier.rotationY)
        if (barrier.kind === 'glass') {
          const frameMaterial = preset.materials.trim ?? 'graphite-metal'
          for (const y of [.055, barrier.height - .055]) addBox(`barrier:${barrier.id}:glass-rail:${side}:${y}`, 'frame', [spanLength, .07, .12], midpoint(center, y), frameMaterial, 1, barrier.rotationY)
          for (const distance of [start, end]) addBox(`barrier:${barrier.id}:glass-post:${side}:${distance}`, 'frame', [.07, barrier.height, .12], midpoint(distance), frameMaterial, 1, barrier.rotationY)
        }
      }
    }
    if (gap > 0 && barrier.height > 2.2) addBox(`barrier:${barrier.id}:header`, 'partition', [gap, .18, .14], midpoint(barrier.length / 2, barrier.height - .09), barrier.material, .92, barrier.rotationY)
  }

  const wallLength = (wall: FloorWindowPreset['wall']) => wall === 'north' || wall === 'south' ? width : depth
  const wallPosition = (wall: FloorWindowPreset['wall'], offset: number, span: number, y: number, inset: number) => {
    const along = offset + span / 2
    if (wall === 'north') return [along - width / 2, floorY + y, depth / 2 - inset] as [number, number, number]
    if (wall === 'south') return [along - width / 2, floorY + y, -depth / 2 + inset] as [number, number, number]
    if (wall === 'east') return [width / 2 - inset, floorY + y, along - depth / 2] as [number, number, number]
    return [-width / 2 + inset, floorY + y, along - depth / 2] as [number, number, number]
  }
  const wallBox = (wall: FloorWindowPreset['wall'], span: number, h: number, thickness: number): [number, number, number] => wall === 'north' || wall === 'south' ? [span, h, thickness] : [thickness, h, span]
  const windowsByWall = new Map<FloorWindowPreset['wall'], Opening[]>()
  const entrancesByWall = new Map<FloorWindowPreset['wall'], Opening[]>()
  for (const window of preset.windows) {
    const openings = windowsByWall.get(window.wall) ?? []
    openings.push({ offset: window.offset, width: window.width, bottom: window.sill, top: window.sill + window.height, kind: 'window' })
    windowsByWall.set(window.wall, openings)
    const centerY = window.sill + window.height / 2
    const pane = addBox(`window:${window.id}:glass`, 'glass', wallBox(window.wall, window.width - .1, window.height - .1, .045), wallPosition(window.wall, window.offset, window.width, centerY, .075), window.frameMaterial, .3)
    pane.userData.windowWall = window.wall
    for (const edge of [0, window.width - .08]) addBox(`window:${window.id}:jamb:${edge}`, 'frame', wallBox(window.wall, .075, window.height, .13), wallPosition(window.wall, window.offset + edge, .075, centerY, .02), window.frameMaterial)
    for (const y of [window.sill, window.sill + window.height]) addBox(`window:${window.id}:rail:${y}`, 'frame', wallBox(window.wall, window.width, .07, .15), wallPosition(window.wall, window.offset, window.width, y, .02), window.frameMaterial)
    const mullionCount = Math.max(1, Math.floor(window.width / 2.1))
    for (let index = 1; index < mullionCount; index++) addBox(`window:${window.id}:mullion:${index}`, 'frame', wallBox(window.wall, .045, window.height, .11), wallPosition(window.wall, window.offset + window.width * index / mullionCount, .045, centerY, .015), window.frameMaterial)
  }
  // The old city silhouettes sat directly in front of the glass on the room
  // side, turning every window into a dark rectangle. Put a small procedural
  // daylight field and instanced skyline beyond each actual window instead.
  // This is geometry, not a reference image or a background texture.
  const cameraDx = preset.camera.position[0] - preset.camera.target[0]
  const cameraDz = preset.camera.position[2] - preset.camera.target[2]
  const cutawayWalls = [
    Math.abs(cameraDx) > .25 ? (cameraDx > 0 ? 'east' : 'west') : undefined,
    Math.abs(cameraDz) > .25 ? (cameraDz > 0 ? 'north' : 'south') : undefined,
  ].filter((wall): wall is FloorWindowPreset['wall'] => wall !== undefined)
  const cityMaterial = makeMaterial('city-building', '#77888b')
  const skyMaterial = makeMaterial('city-sky', '#b9cbd1')
  const cityInstances: THREE.InstancedMesh[] = []
  let cityOutside = true
  for (const window of preset.windows) {
    const horizontal = window.wall === 'north' || window.wall === 'south'
    const direction = window.wall === 'north' || window.wall === 'east' ? 1 : -1
    const boundary = horizontal ? depth / 2 : width / 2
    const centerAlong = window.offset + window.width / 2 - (horizontal ? width : depth) / 2
    const skyCenter = direction * (boundary + 1.45)
    const skySize = wallBox(window.wall, window.width, window.height, .06)
    const skyPosition = horizontal
      ? [centerAlong, floorY + window.sill + window.height / 2, skyCenter] as [number, number, number]
      : [skyCenter, floorY + window.sill + window.height / 2, centerAlong] as [number, number, number]
    const sky = addBox(`window:${window.id}:procedural-daylight`, 'city-sky', skySize, skyPosition, '#b9cbd1')
    sky.castShadow = false; sky.receiveShadow = false; sky.raycast = () => {}; sky.renderOrder = -1; sky.userData.excludeFromFloorBounds = true
    const columns = Math.max(4, Math.floor(window.width / .72))
    const city = new THREE.InstancedMesh(unitBox, cityMaterial, columns * 3)
    city.name = `preset:procedural-city-view:${window.id}`
    city.castShadow = false; city.receiveShadow = false; city.raycast = () => {}
    city.userData.excludeFromFloorBounds = true
    const matrix = new THREE.Matrix4(); const rotation = new THREE.Quaternion(); const scale = new THREE.Vector3(); const position = new THREE.Vector3()
    let instance = 0
    for (let index = 0; index < columns; index++) {
      const seed = [...window.id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, index + 7)
      const random = (salt: number) => ((seed * (salt * 1664525 + 1013904223)) >>> 0) / 0xffffffff
      for (let depthRow = 0; depthRow < 3; depthRow++) {
        const buildingWidth = .36 + random(depthRow + 1) * .42
        const buildingHeight = .7 + random(depthRow + 4) * Math.max(.4, window.height - .85)
        const along = window.offset + (index + .5) * window.width / columns - (horizontal ? width : depth) / 2
        const outward = direction * (boundary + .35 + depthRow * .38)
        const y = window.sill + buildingHeight / 2
        if (Math.abs(outward) <= boundary) cityOutside = false
        if (horizontal) {
          position.set(along, floorY + y, outward); scale.set(buildingWidth, buildingHeight, .22)
        } else {
          position.set(outward, floorY + y, along); scale.set(.22, buildingHeight, buildingWidth)
        }
        matrix.compose(position, rotation, scale); city.setMatrixAt(instance++, matrix)
      }
    }
    city.count = instance; city.instanceMatrix.needsUpdate = true; city.computeBoundingSphere(); group.add(city)
    cityInstances.push(city); uniqueGeometries.add(city.geometry)
  }
  uniqueMaterials.add(cityMaterial)
  uniqueMaterials.add(skyMaterial)
  for (const entrance of preset.entrances) {
    const openings = entrancesByWall.get(entrance.wall) ?? []
    openings.push({ offset: entrance.offset, width: entrance.width, bottom: 0, top: Math.min(2.45, height * .55), kind: 'entrance' })
    entrancesByWall.set(entrance.wall, openings)
    const h = Math.min(2.45, height * .55)
    const kindColor = entrance.kind === 'elevator' ? 'bronze' : 'graphite'
    for (const edge of [0, entrance.width - .09]) addBox(`entrance:${entrance.id}:jamb:${edge}`, 'entrance-frame', wallBox(entrance.wall, .09, h, .2), wallPosition(entrance.wall, entrance.offset + edge, .09, h / 2, .02), preset.materials.trim ?? kindColor)
    addBox(`entrance:${entrance.id}:header`, 'entrance-frame', wallBox(entrance.wall, entrance.width, .12, .2), wallPosition(entrance.wall, entrance.offset, entrance.width, h - .06, .02), preset.materials.trim ?? kindColor)
    if (entrance.kind !== 'open') addBox(`entrance:${entrance.id}:threshold`, 'entrance-threshold', wallBox(entrance.wall, entrance.width, .035, .32), wallPosition(entrance.wall, entrance.offset, entrance.width, .018, .02), preset.materials.trim ?? kindColor)
    if (entrance.kind === 'door') {
      const leafSpan = Math.max(.6, entrance.width - .16)
      const door = addBox(`entrance:${entrance.id}:door-leaf`, 'wall', wallBox(entrance.wall, leafSpan, h - .1, .075), wallPosition(entrance.wall, entrance.offset + .08, leafSpan, (h - .1) / 2, .03), preset.materials.door ?? 'dark-walnut')
      door.userData.floorPresetDoor = entrance.id
      if (entrance.wall === 'north' || entrance.wall === 'south') addBox(`entrance:${entrance.id}:handle`, 'frame', [.035, .19, .045], wallPosition(entrance.wall, entrance.offset + entrance.width - .24, .035, h * .48, .09), preset.materials.trim ?? 'brushed-bronze')
      else addBox(`entrance:${entrance.id}:handle`, 'frame', [.045, .19, .035], wallPosition(entrance.wall, entrance.offset + entrance.width - .24, .035, h * .48, .09), preset.materials.trim ?? 'brushed-bronze')
    }
  }

  // Segmented outer walls keep real openings around declared windows and doors.
  const walls: FloorWindowPreset['wall'][] = ['north', 'south', 'east', 'west']
  for (const wall of walls) {
    if (cutawayWalls.includes(wall)) continue
    const length = wallLength(wall)
    const openings = [...(windowsByWall.get(wall) ?? []), ...(entrancesByWall.get(wall) ?? [])].sort((a, b) => a.offset - b.offset)
    let cursor = 0
    const addWallSpan = (from: number, to: number) => {
      if (to - from <= .08) return
      const pos = wallPosition(wall, from, to - from, height / 2, .12)
    const role = wall === 'north' ? 'featureWall' : 'wall'
      const finish = wall === 'north' ? preset.materials.featureWall ?? preset.materials.wall ?? 'terracotta-brick' : preset.materials.wall ?? 'warm plaster'
      addBox(`exterior:${wall}:${from.toFixed(2)}`, role, wallBox(wall, to - from, height, .24), pos, finish)
      const accentPos = wallPosition(wall, from, to - from, height - .12, .105)
      addBox(`exterior:${wall}:theme-accent:${from.toFixed(2)}`, 'theme-accent', wallBox(wall, to - from, .12, .27), accentPos, preset.materials.trim ?? preset.theme)
    }
    for (const opening of openings) {
      const start = THREE.MathUtils.clamp(opening.offset, cursor, length)
      const end = THREE.MathUtils.clamp(opening.offset + opening.width, start, length)
      addWallSpan(cursor, start)
      const sillTop = opening.kind === 'window' ? opening.bottom : 0
      const headBottom = opening.kind === 'window' ? opening.top : Math.min(2.45, height * .55)
      const role = wall === 'north' ? 'featureWall' : 'wall'
      const finish = wall === 'north' ? preset.materials.featureWall ?? preset.materials.wall ?? 'terracotta-brick' : preset.materials.wall ?? 'warm plaster'
      if (sillTop > .08) addBox(`exterior:${wall}:sill:${start.toFixed(2)}`, role, wallBox(wall, end - start, sillTop, .24), wallPosition(wall, start, end - start, sillTop / 2, .12), finish)
      if (height - headBottom > .08) addBox(`exterior:${wall}:head:${start.toFixed(2)}`, role, wallBox(wall, end - start, height - headBottom, .24), wallPosition(wall, start, end - start, headBottom + (height - headBottom) / 2, .12), finish)
      cursor = Math.max(cursor, end)
    }
    addWallSpan(cursor, length)
  }

  const textureFailures: string[] = []
  await Promise.all([...textureBindings].map(async ([url, materials]) => {
    try {
      const texture = await sharedTexture(url)
      for (const material of materials) material.map = texture
    } catch {
      // Geometry remains useful and visible when a local art texture is temporarily unavailable.
      textureFailures.push(url)
    }
  }))

  const paneMeshes = group.children.filter(object => object.name.startsWith('preset:window:') && object.name.endsWith(':glass')) as THREE.Mesh[]
  const windowAudit = {
    count: paneMeshes.length,
    clearGlass: paneMeshes.length === preset.windows.length && paneMeshes.every(pane => {
      const material = pane.material as THREE.MeshStandardMaterial
      return material.transparent && material.opacity <= .24 && material.depthWrite === false && material.color.r > .25 && material.color.g > .25 && material.color.b > .25
    }),
    cityOutside: cityInstances.length === preset.windows.length && cityOutside,
  }
  const elementCounts = { zones: preset.zones.length, rooms: preset.rooms.length, barriers: preset.barriers.length, windows: preset.windows.length, entrances: preset.entrances.length, aisles: preset.aisles.length, exteriorWalls: 4 - cutawayWalls.length, materialRoles: Object.keys(preset.materials).length }
  group.userData.presetElementCounts = elementCounts
  group.userData.cutawayWalls = [...cutawayWalls]
  group.userData.windowAudit = windowAudit
  group.userData.presetBounds = { width, depth, height }
  group.userData.presetMaterials = { ...preset.materials }
  group.userData.presetCamera = preset.camera
  group.userData.presetLighting = preset.lighting
  group.userData.presetPlacementCounts = { furniture: preset.furniture.length, decor: preset.decor.length, workplaces: preset.workplaces.length }
  group.userData.presetOpenings = {
    windows: preset.windows.map(({ id, wall, offset, width: openingWidth, sill, height: openingHeight }) => ({ id, wall, offset, width: openingWidth, sill, height: openingHeight })),
    entrances: preset.entrances.map(({ id, wall, offset, width: openingWidth, kind }) => ({ id, wall, offset, width: openingWidth, kind })),
    roomDoors: preset.rooms.filter(room => room.door).map(room => ({ roomId: room.id, ...room.door })),
  }
  group.userData.presetLocalLights = preset.lighting.fixtures ?? []
  group.userData.presetWorkplaceProfiles = preset.workplaces.map(({ id, deskId, employeeId, kind, equipment }) => ({ id, deskId: deskId ?? id, employeeId, kind: kind ?? 'standard', equipment: equipment ?? [] }))
  group.userData.presetInteractions = [...preset.furniture, ...preset.decor].filter(item => item.interaction).map(item => ({ placementId: item.id, ...item.interaction }))
  group.userData.floorPresetTheme = preset.theme
  group.userData.floorPresetFloorId = preset.floorId
  group.userData.floorPresetSpecialization = preset.specialization
  group.userData.floorPresetReferenceImage = preset.referenceImage
  group.userData.floorPresetStatus = 'authored'
  group.userData.textureUrls = [...textureBindings.keys()]
  group.userData.textureFailures = textureFailures
  group.userData.dispose = () => { for (const geometry of uniqueGeometries) geometry.dispose(); for (const material of uniqueMaterials) material.dispose(); for (const texture of uniqueTextures) texture.dispose() }
  return group
}

/** Applies named material roles to this floor's already-owned material instances. */
export function applyFloorPresetMaterialPalette(root: THREE.Object3D, preset: FloorDesignPreset): number {
  const roleFor = (mesh: THREE.Mesh, material: THREE.Material): [string, string] | undefined => {
    if (mesh.userData.floorPresetId) return undefined
    let assetId = ''
    for (let owner: THREE.Object3D | null = mesh; owner; owner = owner.parent) {
      if (owner.userData.officeAssetId) { assetId = String(owner.userData.officeAssetId); break }
    }
    const name = `${assetId} ${material.name} ${mesh.name}`.toLowerCase()
    if (/floor\.oak|oak-floor/.test(name)) return ['floor', preset.materials.floor ?? 'oak-floor']
    if (/brick/.test(name)) return ['featureWall', preset.materials.featureWall ?? preset.materials.wall ?? 'walnut-brick']
    if (/wall\.paint|plaster|wall/.test(name)) return ['wall', preset.materials.wall ?? 'warm-plaster']
    if (/desk/.test(name)) return ['desk', preset.materials.desk ?? 'dark-walnut']
    if (/chair|sofa|fabric|carpet|rug/.test(name)) return ['textile', preset.materials.textile ?? 'sage-upholstery']
    if (/glass|glaz|window/.test(name)) return ['glazing', preset.materials.glazing ?? 'sage-glass']
    if (/metal|graphite|frame|bronze|brass/.test(name)) return ['trim', preset.materials.trim ?? 'graphite-metal']
    return undefined
  }
  let changed = 0
  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach(material => {
      const mapping = roleFor(mesh, material)
      if (!mapping) return
      const [role, id] = mapping
      // Runtime material clones are floor-owned; source GLB materials remain shared and immutable.
      if (!material.name.startsWith('premium-v29:')) return
      const pbr = material as THREE.MeshStandardMaterial
      pbr.color.setHex(presetMaterialColor(id, role, preset.theme))
      if (role === 'floor' || role === 'wall' || role === 'featureWall') pbr.roughness = Math.max(pbr.roughness, .78)
      if (role === 'desk') { pbr.roughness = Math.max(pbr.roughness, .68); pbr.metalness = Math.min(pbr.metalness, .08) }
      if (role === 'textile') { pbr.roughness = Math.max(pbr.roughness, .86); pbr.metalness = 0 }
      changed++
    })
  })
  root.userData.presetMaterialRoleCount = changed
  root.userData.presetMaterialValues = { ...preset.materials }
  return changed
}
