import * as THREE from 'three'
import { PROCEDURAL_OFFICE_ASSET_IDS, isProceduralOfficeAsset } from './procedural-asset-ids'

/**
 * Small shared model kit for department-specific office props missing from the
 * authored GLB pack. These are assembled models (frame, controls, screens,
 * shelves, legs and fittings), not generic placeholder cubes.
 */
const PROCEDURAL_IDS = new Set<string>(PROCEDURAL_OFFICE_ASSET_IDS)
export { isProceduralOfficeAsset } from './procedural-asset-ids'

export interface ProceduralOfficeAssetLibrary {
  ready(): Promise<void>
  create(id: string): THREE.Group
  dispose(): void
}

export function createProceduralOfficeAssetLibrary(): ProceduralOfficeAssetLibrary {
  const geometries = new Map<string, THREE.BufferGeometry>()
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  const textures = new Map<string, THREE.Texture>()
  let textureReady: Promise<void> | undefined
  const geometry = (key: string, create: () => THREE.BufferGeometry) => {
    let value = geometries.get(key)
    if (!value) { value = create(); geometries.set(key, value) }
    return value
  }
  const material = (key: string, color: string, roughness = .72, metalness = .04, emissive?: string) => {
    let value = materials.get(key)
    if (!value) {
      value = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...(emissive ? { emissive, emissiveIntensity: .55 } : {}) })
      const mapKey = key === 'walnut' || key === 'oak' || key === 'oak-light' ? 'wood' : key === 'fabric' || key === 'sage' ? 'fabric' : key === 'plaster' ? 'plaster' : undefined
      const map = mapKey ? textures.get(mapKey) : undefined
      if (map) value.map = map
      materials.set(key, value)
    }
    return value
  }
  const m = {
    walnut: material('walnut', '#72513f', .72), oak: material('oak', '#b88a5f', .68), oakLight: material('oak-light', '#d1ae82', .72),
    graphite: material('graphite', '#24272e', .52, .48), steel: material('steel', '#747c80', .34, .76), bronze: material('bronze', '#b58b5c', .4, .62),
    sage: material('sage', '#668378', .88), fabric: material('fabric', '#455b54', .93), plaster: material('plaster', '#d8c7af', .88),
    blackGlass: material('black-glass', '#111a20', .16, .15), screen: material('screen', '#172c36', .22, .08), screenGlow: material('screen-glow', '#315a65', .38, .04, '#183a42'),
    ivory: material('ivory', '#eee5d7', .7), rubber: material('rubber', '#33363a', .92), red: material('signal-red', '#c25f49', .5, .05, '#38110b'),
    green: material('signal-green', '#5a9b79', .45, .08, '#173a26'), blue: material('signal-blue', '#5280a4', .4, .1, '#13283f'),
    white: material('white', '#e9e7e1', .82), ceramic: material('ceramic', '#d2cec5', .29, .08),
  }
  const box = geometry('unit-box', () => new THREE.BoxGeometry(1, 1, 1))
  const cylinder = (radiusTop: number, radiusBottom: number, height: number, radial = 16) => geometry(`cylinder:${radiusTop}:${radiusBottom}:${height}:${radial}`, () => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radial))
  const sphere = geometry('sphere', () => new THREE.SphereGeometry(1, 12, 8))
  const torus = (radius: number, tube: number) => geometry(`torus:${radius}:${tube}`, () => new THREE.TorusGeometry(radius, tube, 8, 24))
  const make = (id: string) => {
    const root = new THREE.Group()
    root.name = `procedural-office-asset:${id}`
    root.userData.officeAssetId = id
    const addBox = (name: string, size: [number, number, number], pos: [number, number, number], mat: THREE.Material, rotY = 0) => {
      const mesh = new THREE.Mesh(box, mat)
      mesh.name = name; mesh.scale.set(...size); mesh.position.set(...pos); mesh.rotation.y = rotY
      mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh
    }
    const addCylinder = (name: string, radiusTop: number, radiusBottom: number, height: number, pos: [number, number, number], mat: THREE.Material, radial = 16) => {
      const mesh = new THREE.Mesh(cylinder(radiusTop, radiusBottom, height, radial), mat)
      mesh.name = name; mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh
    }
    const addSphere = (name: string, scale: [number, number, number], pos: [number, number, number], mat: THREE.Material) => {
      const mesh = new THREE.Mesh(sphere, mat); mesh.name = name; mesh.scale.set(...scale); mesh.position.set(...pos); mesh.castShadow = true; root.add(mesh); return mesh
    }
    const screen = (name: string, x: number, y: number, z: number, width: number, height: number, mat: THREE.Material = m.screen) => {
      addBox(`${name}:bezel`, [width + .12, height + .12, .09], [x, y, z], m.graphite)
      addBox(`${name}:panel`, [width, height, .025], [x, y, z + .052], mat)
      addBox(`${name}:stand`, [.11, .28, .12], [x, y - height / 2 - .19, z], m.steel)
      addBox(`${name}:base`, [.42, .045, .24], [x, y - height / 2 - .34, z], m.steel)
    }
    const legs = (width: number, depth: number, topY: number, legMat = m.graphite, countX = 2, countZ = 2) => {
      for (let ix = 0; ix < countX; ix++) for (let iz = 0; iz < countZ; iz++) {
        const x = (ix / (countX - 1 || 1) - .5) * width * .82
        const z = (iz / (countZ - 1 || 1) - .5) * depth * .78
        addBox(`leg-${ix}-${iz}`, [.075, topY, .075], [x, topY / 2, z], legMat)
      }
    }
    const table = (width: number, depth: number, height: number, topMat = m.oak, legMat = m.graphite) => {
      addBox('table-top', [width, .09, depth], [0, height, 0], topMat)
      legs(width, depth, height, legMat)
    }
    const rack = (height: number, width: number, depth: number, lit = false) => {
      addBox('rack-base', [width, .12, depth], [0, .06, 0], m.graphite)
      for (const x of [-width / 2 + .06, width / 2 - .06]) addBox('rack-upright', [.09, height, .09], [x, height / 2 + .12, 0], m.steel)
      for (const z of [-depth / 2, depth / 2]) addBox('rack-side', [width - .12, height, .055], [0, height / 2 + .12, z], m.graphite)
      const units = Math.max(3, Math.floor(height / .24))
      for (let index = 0; index < units; index++) {
        const y = .25 + index * ((height - .35) / units)
        addBox(`rack-server-${index}`, [width - .22, .17, depth - .1], [0, y, 0], index % 3 === 0 ? m.steel : m.graphite)
        addBox(`rack-vent-${index}`, [width * .47, .025, .012], [0, y, depth / 2 + .03], m.rubber)
        for (let led = 0; led < 3; led++) addSphere(`rack-led-${index}-${led}`, [.022, .022, .022], [width * .18 + led * .07, y, depth / 2 + .045], lit ? (led === 1 ? m.green : m.blue) : m.ivory)
      }
    }

    switch (id) {
      case 'desk.reception': {
        addBox('reception-core', [2.8, .94, .86], [0, .47, 0], m.walnut)
        addBox('guest-counter-cap', [3.08, .12, .98], [0, 1.02, 0], m.oakLight)
        addBox('raised-staff-counter', [2.2, .2, .34], [0, 1.18, -.38], m.oak)
        for (let i = 0; i < 28; i++) addBox(`fluted-front-${i}`, [.035, .78, .018], [-1.32 + i * .098, .48, .445], i % 2 ? m.walnut : m.oak)
        addBox('bronze-plinth', [2.7, .08, .82], [0, .08, 0], m.bronze)
        break
      }
      case 'desk.lab': case 'desk.cad': case 'desk.standing': case 'desk.focus': {
        const h = id === 'desk.standing' ? 1.02 : .78
        const w = id === 'desk.lab' ? 1.8 : 1.65
        addBox('worktop', [w, .075, .82], [0, h, 0], id === 'desk.lab' ? m.graphite : m.oak)
        legs(w, .82, h, id === 'desk.lab' ? m.steel : m.graphite)
        addBox('cable-tray', [w * .7, .11, .13], [0, h - .17, -.22], m.graphite)
        if (id === 'desk.lab') addBox('instrument-shelf', [w * .72, .06, .22], [0, h + .42, -.23], m.steel)
        if (id === 'desk.cad') addBox('wrist-rest', [.52, .035, .09], [0, h + .05, .24], m.rubber)
        if (id === 'desk.focus') {
          addBox('focus-wing-left', [.06,.58,.52], [-w/2+.03,h+.31,-.12], m.fabric)
          addBox('focus-wing-right', [.06,.58,.52], [w/2-.03,h+.31,-.12], m.fabric)
          addBox('focus-back-panel', [w*.72,.54,.045], [0,h+.29,-.37], m.sage)
        }
        break
      }
      case 'equipment.oscilloscope': {
        addBox('instrument-case', [.52, .34, .38], [0, .23, 0], m.graphite)
        addBox('instrument-bezel', [.34, .21, .025], [-.045, .27, .202], m.blackGlass)
        addBox('waveform-display', [.29, .15, .012], [-.045, .28, .22], m.screenGlow)
        for (let i = 0; i < 4; i++) addCylinder(`control-${i}`, .045, .045, .045, [.17, .35 - (i % 2) * .15, .215], m.bronze, 12).rotation.x = Math.PI / 2
        addBox('probe-port', [.12, .045, .035], [.17, .08, .214], m.steel)
        break
      }
      case 'equipment.test-bench': {
        table(1.85, .82, .88, m.graphite, m.steel)
        for (let i = 0; i < 3; i++) {
          const x = -.58 + i * .58
          addBox(`test-device-${i}`, [.38, .34, .3], [x, 1.08, -.06], m.graphite)
          screen(`test-screen-${i}`, x, 1.12, .105, .24, .17, i === 1 ? m.screenGlow : m.screen)
          addBox(`test-device-slot-${i}`, [.22, .07, .06], [x, .98, .13], m.steel)
        }
        break
      }
      case 'equipment.3d-printer': {
        addBox('printer-base', [.9, .18, .78], [0, .12, 0], m.graphite)
        for (const x of [-.39, .39]) for (const z of [-.32, .32]) addBox('printer-post', [.045, .92, .045], [x, .65, z], m.steel)
        addBox('printer-top', [.9, .08, .78], [0, 1.12, 0], m.graphite)
        for (const z of [-.35, .35]) addBox('printer-glazing', [.72, .78, .018], [0, .65, z], m.blackGlass)
        addBox('print-bed', [.56, .035, .48], [0, .42, 0], m.oak)
        addBox('gantry', [.56, .045, .08], [0, .96, 0], m.steel)
        addBox('print-head', [.14, .14, .13], [0, .83, 0], m.bronze)
        break
      }
      case 'equipment.server-rack': case 'equipment.network-rack': {
        rack(id === 'equipment.server-rack' ? 2.05 : 1.75, .82, .8, true)
        addBox('rack-glass-door', [.76, 1.98, .035], [0, 1.12, .43], m.blackGlass)
        for (let y = .35; y < 2.05; y += .14) addBox(`door-mesh-${y.toFixed(2)}`, [.68, .012, .012], [0, y, .455], m.steel)
        addBox('rack-handle', [.025, .26, .035], [.3, 1.12, .48], m.bronze)
        break
      }
      case 'equipment.analytics-display': case 'equipment.security-console': case 'equipment.whiteboard-display': {
        const width = id === 'equipment.security-console' ? 3.4 : 2.8
        const count = id === 'equipment.security-console' ? 3 : 2
        addBox('display-backplate', [width, 1.65, .12], [0, 1.7, 0], m.graphite)
        for (let i = 0; i < count; i++) {
          const x = (i - (count - 1) / 2) * (width / count)
          screen(`wall-display-${i}`, x, 1.75, .075, width / count - .11, 1.42, i % 2 ? m.screen : m.screenGlow)
          for (let bar = 0; bar < 5; bar++) addBox(`chart-${i}-${bar}`, [.035, .12 + (bar % 3) * .1, .008], [x - .32 + bar * .14, 1.38 + (bar % 3) * .05, .087], bar % 2 ? m.green : m.blue)
        }
        addBox('display-cabinet', [width, .48, .48], [0, .25, -.02], m.walnut)
        break
      }
      case 'equipment.graphics-tablet': {
        addBox('tablet-body', [.62, .055, .42], [0, .035, 0], m.graphite)
        addBox('tablet-surface', [.54, .018, .34], [0, .072, 0], m.blackGlass)
        for (let i = 0; i < 3; i++) addBox(`shortcut-${i}`, [.035, .018, .035], [-.25 + i * .08, .08, -.18], m.bronze)
        addCylinder('stylus', .014, .014, .3, [.37, .1, .02], m.graphite, 8).rotation.z = Math.PI / 2
        break
      }
      case 'equipment.espresso-machine': {
        addBox('espresso-body', [.86, .74, .56], [0, .39, 0], m.steel)
        addBox('espresso-top', [.92, .07, .6], [0, .79, 0], m.graphite)
        addBox('control-panel', [.55, .22, .035], [0, .56, .3], m.graphite)
        for (let i = 0; i < 3; i++) addCylinder(`espresso-button-${i}`, .035, .035, .035, [-.18 + i * .18, .57, .326], i === 1 ? m.green : m.bronze, 12).rotation.x = Math.PI / 2
        addBox('drip-tray', [.64, .055, .2], [0, .12, .32], m.steel)
        for (let i = 0; i < 2; i++) addCylinder(`group-head-${i}`, .09, .07, .14, [-.2 + i * .4, .34, .31], m.bronze, 12).rotation.x = Math.PI / 2
        break
      }
      case 'equipment.cafe-counter': {
        addBox('counter-carcass', [3.1, .94, .86], [0, .47, 0], m.walnut)
        addBox('counter-stone-top', [3.22, .11, .96], [0, .98, 0], m.ceramic)
        addBox('toe-kick', [3.0, .12, .78], [0, .08, .02], m.graphite)
        addBox('warm-front-panel', [2.85, .5, .025], [0, .53, .44], m.oak)
        for (let i = 0; i < 23; i++) addBox(`counter-flute-${i}`, [.035, .46, .016], [-1.35 + i * .122, .52, .46], m.bronze)
        break
      }
      case 'equipment.refrigerator': {
        addBox('refrigerator-shell', [.92, 2.02, .82], [0, 1.01, 0], m.ceramic)
        addBox('refrigerator-crown', [.96, .06, .86], [0, 2.04, 0], m.white)
        addBox('refrigerator-plinth', [.82, .12, .74], [0, .08, .015], m.graphite)
        addBox('upper-door', [.82, 1.02, .035], [0, 1.52, .423], m.white)
        addBox('lower-door', [.82, .78, .035], [0, .61, .423], m.white)
        addBox('freezer-seam', [.84, .035, .045], [0, 1.02, .431], m.steel)
        addBox('upper-door-inset', [.68, .86, .014], [0, 1.52, .446], m.ceramic)
        addBox('lower-door-inset', [.68, .62, .014], [0, .61, .446], m.ceramic)
        for (const [y, height] of [[1.48, .54], [.65, .4]] as const) {
          addBox(`door-handle-${y}`, [.035, height, .045], [.31, y, .48], m.steel)
          addBox(`handle-mount-upper-${y}`, [.06, .055, .05], [.31, y + height / 2, .47], m.graphite)
          addBox(`handle-mount-lower-${y}`, [.06, .055, .05], [.31, y - height / 2, .47], m.graphite)
        }
        addBox('temperature-display', [.16, .055, .018], [-.25, 1.78, .458], m.screenGlow)
        break
      }
      case 'equipment.archive-shelf': {
        for (const x of [-.72, .72]) addBox('shelf-upright', [.08, 2.12, .38], [x, 1.06, 0], m.walnut)
        for (let y = .13, level = 0; y < 2.02; y += .47, level++) {
          addBox(`shelf-board-${level}`, [1.52, .07, .43], [0, y, 0], m.oak)
          for (let file = 0; file < 4; file++) addBox(`archive-box-${level}-${file}`, [.26, .32, .33], [-.51 + file * .34, y + .19, .015], file % 2 ? m.plaster : m.walnut)
        }
        break
      }
      case 'equipment.qa-device-wall': {
        addBox('qa-workbench', [2.65, .1, .72], [0, .88, 0], m.oak)
        legs(2.65, .72, .86, m.graphite, 3, 2)
        for (let i = 0; i < 5; i++) {
          const x = -.98 + i * .49
          addBox(`device-station-${i}`, [.36, .34, .28], [x, 1.1, -.02], m.graphite)
          addBox(`device-screen-${i}`, [.27, .17, .022], [x, 1.14, .13], i % 2 ? m.screenGlow : m.screen)
          addBox(`device-pad-${i}`, [.22, .035, .17], [x, .96, .2], m.rubber)
        }
        break
      }
      case 'furniture.pool-table': {
        addBox('pool-apron', [2.25, .28, 1.28], [0, .74, 0], m.walnut)
        addBox('pool-felt', [2.14, .04, 1.16], [0, .91, 0], material('pool-felt', '#315b4d', .86))
        for (const x of [-.98, .98]) for (const z of [-.48, .48]) addCylinder('pool-leg', .08, .11, .72, [x, .36, z], m.walnut, 12)
        for (const [x, z] of [[-1.03,-.53],[0,-.53],[1.03,-.53],[-1.03,.53],[0,.53],[1.03,.53]] as const) addCylinder('pool-pocket', .085, .085, .035, [x, .94, z], m.graphite, 16)
        for (let i = 0; i < 5; i++) addSphere(`billiard-ball-${i}`, [.055,.055,.055], [-.35 + i * .17, .99, .12], i % 2 ? m.ivory : m.red)
        break
      }
      case 'furniture.foosball': {
        addBox('foosball-cabinet', [1.35, .42, .78], [0, .77, 0], m.walnut)
        addBox('foosball-field', [1.25, .035, .68], [0, 1, 0], m.sage)
        for (const x of [-.52, -.17, .17, .52]) {
          addCylinder('foosball-rod', .018, .018, 1.18, [x, 1.16, 0], m.steel, 8).rotation.z = Math.PI / 2
          for (let player = 0; player < (Math.abs(x) < .2 ? 2 : 3); player++) addBox(`foosball-player-${x}-${player}`, [.08,.2,.07], [x,1.12,-.22 + player * .22], (player + Math.round((x + .52)*10)) % 2 ? m.red : m.ivory)
        }
        for (const x of [-.56, .56]) for (const z of [-.27, .27]) addBox('foosball-leg', [.08,.7,.08], [x,.35,z], m.graphite)
        break
      }
      case 'furniture.acoustic-focus-pod': {
        addBox('pod-base', [1.55, .11, 1.35], [0, .055, 0], m.graphite)
        for (const x of [-.72,.72]) addBox('pod-side', [.12,2.25,1.34], [x,1.18,0], m.fabric)
        addBox('pod-back', [1.5,2.25,.12], [0,1.18,.62], m.fabric)
        addBox('pod-roof', [1.55,.12,1.36], [0,2.3,0], m.graphite)
        addBox('pod-door-glass', [.72,1.95,.035], [0,1.12,-.675], m.blackGlass)
        addBox('pod-door-handle', [.035,.34,.04], [.3,1.1,-.71], m.bronze)
        addBox('pod-seat', [.72,.43,.62], [0,.39,.17], m.sage)
        break
      }
      case 'furniture.whiteboard': case 'furniture.moodboard': {
        addBox('board-frame', [1.55,1.16,.075], [0,1.45,0], m.graphite)
        addBox('board-surface', [1.44,1.05,.025], [0,1.45,.05], mivory())
        for (let i = 0; i < 5; i++) addBox(`board-note-${i}`, [.19,.15,.012], [-.52 + (i % 3) * .28, 1.68 - Math.floor(i / 3) * .3,.069], [m.ivory,m.sage,m.oakLight,m.plaster,m.blue][i]!)
        if (id === 'furniture.whiteboard') for (const x of [-.56,.56]) addBox('board-foot', [.06,.58,.06], [x,.29,0], m.steel)
        break
      }
      case 'furniture.cafe-table': case 'table': {
        addBox('cafe-top', [1.12,.07,.78], [0,.76,0], m.oakLight)
        addCylinder('cafe-pedestal', .08,.14,.7,[0,.38,0],m.graphite,16)
        addBox('cafe-foot', [.62,.07,.46],[0,.06,0],m.graphite)
        break
      }
      case 'furniture.banquette': {
        addBox('banquette-base', [2.25,.5,.72],[0,.28,0],m.walnut)
        addBox('banquette-seat', [2.3,.2,.76],[0,.62,-.02],m.sage)
        addBox('banquette-back', [2.3,.82,.18],[0,1.08,.28],m.fabric)
        for (let i=0;i<4;i++) addBox(`banquette-stitch-${i}`, [.012,.52,.012],[-.75+i*.5,1.06,.377],m.ivory)
        break
      }
      case 'furniture.kiosk': {
        addBox('kiosk-base', [.58,.16,.48],[0,.08,0],m.graphite)
        addBox('kiosk-column', [.18,.92,.16],[0,.61,0],m.steel)
        addBox('kiosk-display-case', [.72,.58,.2],[0,1.28,-.03],m.graphite)
        addBox('kiosk-touchscreen', [.6,.44,.025],[0,1.29,.085],m.screenGlow)
        addBox('kiosk-reader', [.24,.12,.08],[.45,.22,.07],m.bronze)
        break
      }
      default: return root
    }
    const boxGroups = new Map<string, THREE.Mesh[]>()
    for (const child of [...root.children]) {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || mesh.geometry !== box || Array.isArray(mesh.material)) continue
      const key = `${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}`
      const group = boxGroups.get(key) ?? []; group.push(mesh); boxGroups.set(key, group)
    }
    for (const [key, meshes] of boxGroups) {
      if (meshes.length < 3) continue
      const first = meshes[0]!
      const instances = new THREE.InstancedMesh(box, first.material, meshes.length)
      instances.name = `instanced-details:${key}`
      instances.castShadow = first.castShadow; instances.receiveShadow = first.receiveShadow
      meshes.forEach((mesh, index) => {
        mesh.updateMatrix(); instances.setMatrixAt(index, mesh.matrix); root.remove(mesh)
      })
      instances.instanceMatrix.needsUpdate = true
      root.add(instances)
    }
    root.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) mesh.userData.assetPart = true })
    return root
  }
  function mivory() { return m.ivory }
  return {
    ready() {
      if (!textureReady) {
        const loader = new THREE.TextureLoader()
        textureReady = Promise.allSettled([
          loader.loadAsync('/office-art/v1/textures/oak-light.svg').then(texture => ['wood', texture] as const),
          loader.loadAsync('/office-art/v1/textures/fabric-sage.svg').then(texture => ['fabric', texture] as const),
          loader.loadAsync('/office-art/v1/textures/cream-wall.svg').then(texture => ['plaster', texture] as const),
        ]).then(results => {
          for (const result of results) if (result.status === 'fulfilled') {
            const [key, texture] = result.value
            texture.colorSpace = THREE.SRGBColorSpace
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping
            texture.repeat.set(key === 'fabric' ? 1.4 : 1.8, key === 'fabric' ? 1.4 : 1.2)
            texture.anisotropy = 4
            textures.set(key, texture)
            for (const [materialKey, target] of materials) {
              const matches = key === 'wood' ? ['walnut', 'oak', 'oak-light'].includes(materialKey) : key === 'fabric' ? ['fabric', 'sage'].includes(materialKey) : materialKey === 'plaster'
              if (matches) { target.map = texture; target.needsUpdate = true }
            }
          }
        })
      }
      return textureReady
    },
    create(id: string) {
      if (!PROCEDURAL_IDS.has(id)) throw new Error(`unknown_procedural_office_asset:${id}`)
      const root = make(id)
      root.userData.proceduralOfficeAsset = true
      return root
    },
    dispose() {
      for (const value of geometries.values()) value.dispose()
      for (const value of materials.values()) value.dispose()
      for (const value of textures.values()) value.dispose()
      geometries.clear(); materials.clear()
      textures.clear()
    },
  }
}
