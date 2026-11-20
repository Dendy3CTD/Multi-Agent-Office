import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createOfficeArtRuntime } from "../office-art/loader";
import type { OfficeArtRuntime } from "../office-art/loader";
import type { OfficeAssetManifest as ArtManifest } from "../office-art/asset-manifest";
import { showroomEmployees, showroomLayout, SHOWROOM_FLOOR_ID, SHOWROOM_COMPOSITION } from "./scene-data";
import { validateFloorLayout } from "../office-layout";
import type { WorldEmployee } from "../world";
import "./office-scene-3d.css";
import { rememberMaterialRoles } from "./lighting";
import { createPremiumArchitectureV29, createArchitectureAssetAdapter, PREMIUM_ARCHITECTURE_METADATA, type PremiumArchitecture } from "./gfx29/architecture";
import { createPremiumLightingV29 } from "./gfx29/lighting";
import { finishPremiumInterior } from "./gfx29/integration/art-direction";
import { createVisualPolishV31 } from "./gfx31/polish";
import { applyPremiumFloorV31 } from "./gfx31/floor";
import { applyGfx30Materials } from "./gfx30/materials";
import { AnimationScheduler, type RiggedObject } from "./gfx35";
import { dressGameInterior } from "./gfx34/dressing";
import { buildNavigationCatalog } from "./gfx34/navigation";
import { createAmbientContacts } from "./gfx33/contacts";
import { recessElevator } from "./gfx33/elevator";
import { createArtCharacter } from "./gfx32/characters";
import { createPremiumCharacter, type PremiumCharacter } from "./gfx29/characters";
import { readConfirmedEmployeeStates, statusAppearance, statusBadgeVisual, type ConfirmedTaskStatus, type EmployeeTaskState } from "./gfx37";
import type { FloorDesignPreset } from './floor-presets/types';
import { applyFloorPresetMaterialPalette, buildFloorPresetGeometry } from './floor-presets/render';
import { floorPlanPointToWorld } from './floor-presets/coordinates';
import { isProceduralOfficeAsset } from '../office-art/procedural-asset-ids';
import type { ProceduralOfficeAssetLibrary } from '../office-art/procedural-library';
import { officeV4ReferenceForWorldFloor, officeV4ToWorldFloorId } from './office-v4/floor-id-adapter';

export interface OfficeAssetManifest {
  readonly models?: Readonly<Record<string, string>>;
  readonly textures?: Readonly<Record<string, string>>;
  readonly manifestUrl?: string;
}

export interface OfficeScene3DProps {
  employees?: readonly WorldEmployee[];
  floorPreset?: FloorDesignPreset;
  /** Named profile is the extension point for future floor-specific art direction. */
  visualProfile?: string;
  /** Only server/Directory mappings marked confirmed receive a 3D status badge. */
  confirmedEmployeeStates?: readonly EmployeeTaskState[];
  selectedEmployeeId?: string;
  onEmployeeSelect?: (employeeId: string) => void;
  /** Adapter to the existing MAO floor menu. The 3D scene does not own floor state. */
  onElevatorClick?: () => void;
  cameraAction?: "fit-floor" | "zoom-in" | "zoom-out" | "reset";
  cameraActionKey?: number;
  assetManifest?: OfficeAssetManifest;
  onRuntimeMetrics?: (metrics: OfficeSceneRuntimeMetrics) => void;
  onSceneStatusChange?: (status: "loading" | "ready" | "error") => void;
}

export interface OfficeSceneRuntimeMetrics {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly dpr: number;
  readonly frameActivity: "active" | "paused";
  readonly frameCount: number;
  readonly loadTimeMs?: number;
}

export function canRenderSceneFrame(hidden: boolean, disposed: boolean): boolean {
  return !hidden && !disposed;
}

export const CAMERA_ZOOM_MIN = 0.72;
export const CAMERA_ZOOM_MAX = 1.8;

/** Browser wheel units differ between Firefox/Linux mice, touchpads and pages. */
export function normalizeWheelDelta(event: Pick<WheelEvent, "deltaY" | "deltaMode">, viewportHeight = 800): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * Math.max(viewportHeight, 1);
  return event.deltaY;
}

export function clampSceneZoom(zoom: number): number {
  return THREE.MathUtils.clamp(zoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
}

export function pointerNdc(event: Pick<PointerEvent, "clientX" | "clientY">, rect: Pick<DOMRect, "left" | "top" | "width" | "height">): THREE.Vector2 {
  return new THREE.Vector2(
    ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
  );
}

export function interactiveAncestor(object: THREE.Object3D | undefined): THREE.Object3D | undefined {
  let current = object;
  while (current) {
    if (current.userData.employeeId || current.userData.interactive === "elevator" || current.userData.floorObjectInteraction) return current;
    current = current.parent ?? undefined;
  }
  return undefined;
}

export function isElevatorOwner(object: THREE.Object3D | undefined): boolean {
  return object?.userData.interactive === "elevator";
}

function createConfirmedStatusBadge(status: ConfirmedTaskStatus, camera: THREE.Camera): THREE.Mesh {
  const visual = statusBadgeVisual(status);
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("confirmed_status_badge_canvas_unavailable");
  context.fillStyle = visual.color;
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(4, 4, 248, 56, 18);
  else context.rect(4, 4, 248, 56);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "700 25px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(visual.label, 128, 33, 232);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  badge.name = "confirmed-task-status-badge";
  badge.position.set(0, 1.86, 0);
  badge.scale.set(1.02, .255, 1);
  badge.quaternion.copy(camera.quaternion);
  badge.renderOrder = 20;
  badge.userData.confirmedRuntimeStatus = status;
  badge.raycast = () => {};
  return badge;
}

function syncConfirmedStatusBadge(object: THREE.Object3D, status: ConfirmedTaskStatus | undefined, camera: THREE.Camera) {
  const previous = object.getObjectByName("confirmed-task-status-badge") as THREE.Mesh | undefined;
  if (previous) {
    previous.removeFromParent();
    previous.geometry.dispose();
    const previousMaterial = previous.material as THREE.MeshBasicMaterial;
    previousMaterial.map?.dispose();
    previousMaterial.dispose();
  }
  if (status) {
    object.userData.confirmedRuntimeStatus = status;
    object.userData.confirmedRuntimeStatusSource = "server-directory-mapping";
    object.add(createConfirmedStatusBadge(status, camera));
  } else {
    delete object.userData.confirmedRuntimeStatus;
    delete object.userData.confirmedRuntimeStatusSource;
  }
}

const SHOWROOM_LAYOUT = showroomLayout();
// The renderer contract is deliberately explicit. The layout adapter below is
// checked against this room before any object is placed, so no second origin or
// hidden renderer-only room dimensions can drift into the scene.
const ROOM = { width: 22, depth: 14, height: 5.8 };
if (SHOWROOM_LAYOUT.size.width !== ROOM.width || SHOWROOM_LAYOUT.size.depth !== ROOM.depth) throw new Error("showroom_layout_room_mismatch");
assertShowroomLayout(SHOWROOM_LAYOUT);
export type RenderQuality = 'low' | 'balanced' | 'high';
export const RENDER_QUALITY_SETTINGS = {
  low: { dpr: 1, shadowMapSize: 512, shadows: false },
  balanced: { dpr: 1.25, shadowMapSize: 1024, shadows: true },
  high: { dpr: 1.5, shadowMapSize: 1536, shadows: true },
} as const satisfies Record<RenderQuality, { dpr: number; shadowMapSize: 512 | 1024 | 1536 | 2048; shadows: boolean }>;
export function renderQualityFromSearch(search: string): RenderQuality {
  const value = new URLSearchParams(search).get('quality');
  return value === 'low' || value === 'high' ? value : 'balanced';
}
// Kept as a compatibility value for the pre-normalized v1 pack. At runtime the
// source is inspected, so a normalized Y-up pack receives no compensation.
export const ART_SOURCE_ROTATION_X = -Math.PI / 2;

export function detectArtSourceRotationX(object: THREE.Object3D): number {
  const bounds = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  // A floor is thin on Y in a normalized pack and thin on Z in the legacy pack.
  return bounds.y > bounds.z * 2 ? ART_SOURCE_ROTATION_X : 0;
}

export interface ArtPlacementOptions {
  readonly position: [number, number, number];
  readonly rotationY?: number;
  /** Additional scene-composition scale, applied once after manifest scale. */
  readonly fitScale?: [number, number, number];
  readonly employeeId?: string;
  readonly deskId?: string;
  readonly placementId?: string;
  readonly interaction?: { readonly kind: string; readonly targetId?: string };
}

export function artPlacementScale(manifestScale: number, fitScale: readonly [number, number, number] = [1, 1, 1]): [number, number, number] {
  return [manifestScale * fitScale[0], manifestScale * fitScale[1], manifestScale * fitScale[2]];
}

function gltfObjectName(name: string): string {
  // PropertyBinding.sanitizeNodeName removes only glTF track-reserved
  // characters. Hyphens remain valid and must not be stripped here.
  return name.replace(/\s/g, "_").replace(/\./g, "").replace(/:/g, "").replace(/\//g, "");
}

async function loadRendererManifest(manifestUrl: string): Promise<ArtManifest> {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("office_art_manifest_unavailable");
  const manifest = await response.json() as ArtManifest;
  return { ...manifest, assets: manifest.assets.map(asset => asset.node ? { ...asset, node: gltfObjectName(asset.node) } : asset) };
}


function worldPoint(point: { x: number; z: number; y?: number }, bounds = ROOM): [number, number, number] {
  return floorPlanPointToWorld(point, bounds);
}

export function assertShowroomLayout(layout: typeof SHOWROOM_LAYOUT): void {
  const validation = validateFloorLayout(layout);
  if (!validation.valid) throw new Error(`showroom_layout_invalid:${validation.issues.map(issue => issue.code).join(",")}`);
  if (SHOWROOM_COMPOSITION.brickWallSide !== "north" || SHOWROOM_COMPOSITION.windowWallSide !== "north") throw new Error("showroom_occlusion_wall_contract_invalid");
  if (!layout.windows.every(window => window.wallId === "wall-north")) throw new Error("showroom_windows_must_be_on_north_wall");
}

const DEFAULT_EMPLOYEES = showroomEmployees();
// Renderer teardown waits for the content effect's late async acquisitions.
const rendererCleanups = new WeakMap<THREE.WebGLRenderer, Promise<void>>();

// Semantic asset configuration, independent of object/property insertion identity.
export function manifestKey(manifest?: OfficeAssetManifest): string {
  const entries = (value?: Readonly<Record<string, string>>) => Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([manifest?.manifestUrl ?? "/office-art/v1/manifest.json", entries(manifest?.models), entries(manifest?.textures)]);
}

export default function OfficeScene3D({ employees = DEFAULT_EMPLOYEES, visualProfile = 'showroom-v2', floorPreset, confirmedEmployeeStates, selectedEmployeeId, onEmployeeSelect, onElevatorClick, cameraAction, cameraActionKey, assetManifest, onRuntimeMetrics, onSceneStatusChange }: OfficeScene3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const employeesRef = useRef(employees); employeesRef.current = employees;
  const confirmedStatesRef = useRef(confirmedEmployeeStates); confirmedStatesRef.current = confirmedEmployeeStates;
  const metricsRef = useRef(onRuntimeMetrics); metricsRef.current = onRuntimeMetrics;
  const syncRef = useRef<() => void>();
  const invalidateRef = useRef<() => void>();
  const configurationKey = manifestKey(assetManifest);
  const presetKey = JSON.stringify(floorPreset ?? null);
  const layoutKey = employees.map(employee => `${employee.employeeId}:${employee.deskId}`).join('|') + JSON.stringify(floorPreset?.workplaces ?? []);
  const selectedRef = useRef(selectedEmployeeId);
  const callbackRef = useRef(onEmployeeSelect);
  const statusRef = useRef(onSceneStatusChange);
  statusRef.current = onSceneStatusChange;
  const showroomElevatorFallback = () => {
    if (typeof window !== "undefined" && window.location.search.includes("showroom")) {
      window.dispatchEvent(new CustomEvent("mao-elevator-showroom-test", { detail: { floor: 2, action: "open-menu" } }));
      mountRef.current?.setAttribute("data-elevator-test", "menu-requested");
    }
  };
  const elevatorCallbackRef = useRef(onElevatorClick ?? showroomElevatorFallback);
  selectedRef.current = selectedEmployeeId; callbackRef.current = onEmployeeSelect; elevatorCallbackRef.current = onElevatorClick ?? showroomElevatorFallback;
  const sceneWorldFloorId = floorPreset ? (floorPreset.specialization || floorPreset.referenceImage ? officeV4ToWorldFloorId(floorPreset.floorId) : floorPreset.floorId) : SHOWROOM_FLOOR_ID;
  const mappedFloor = floorPreset ? officeV4ReferenceForWorldFloor(sceneWorldFloorId) : undefined;
  const floorTitle = floorPreset?.specialization?.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
    ?? (mappedFloor ? mappedFloor.specialization.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : 'Руководство и управление проектами');
  const floorNumber = mappedFloor?.uiNumber ?? (floorPreset?.floorId ? Number(floorPreset.floorId.replace('floor-', '')) + 1 : 2);
  const activeFloorEmployees = employees.filter(employee => employee.floorId === sceneWorldFloorId);

  // Renderer belongs to the mounted component, never to a Directory snapshot.
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    statusRef.current?.("loading");
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" }); }
    catch { statusRef.current?.("error"); return; }
    rendererRef.current = renderer;
    const quality = renderQualityFromSearch(window.location.search);
    const qualitySettings = RENDER_QUALITY_SETTINGS[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualitySettings.dpr)); renderer.shadowMap.enabled = qualitySettings.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    renderer.domElement.className = "office-scene-3d-canvas";
    renderer.domElement.style.opacity = '0';
    renderer.domElement.setAttribute("aria-label", `3D showroom profile ${visualProfile}`);
    mount.dataset.renderQuality = quality;
    mount.appendChild(renderer.domElement);
    return () => {
      if (rendererRef.current === renderer) rendererRef.current = undefined;
      renderer.domElement.remove();
      queueMicrotask(() => { void (rendererCleanups.get(renderer) ?? Promise.resolve()).finally(() => {
        renderer.dispose(); renderer.forceContextLoss();
      }); });
    };
  }, []);

  // A genuine manifest change explicitly replaces content, preserving WebGL ownership.
  useEffect(() => {
    const mount = mountRef.current; const renderer = rendererRef.current; if (!mount || !renderer) return;
    let disposed = false;
    let status: "loading" | "ready" | "error" = "loading";
    const report = (next: typeof status) => {
      if (disposed || (status === "error" && next === "ready")) return;
      status = next; mount.dataset.sceneStatus = next; statusRef.current?.(next);
    };
    delete mount.dataset.artPlacedAssets; delete mount.dataset.artLoadError;
    delete mount.dataset.renderedEmployeeIds; delete mount.dataset.renderedEmployeeDeskBindings;
    delete mount.dataset.floorPresetEmployeeBindings; mount.dataset.floorPresetBindingsMatchRoster = 'false';
    mount.dataset.visualProfile = visualProfile;
    mount.dataset.floorPresetSpecialization = floorPreset?.specialization ?? '';
    mount.dataset.floorPresetReferenceImage = floorPreset?.referenceImage ?? '';
    report("loading");
    const deadline = window.setTimeout(() => { abortController.abort(); root.visible = false; report("error"); }, 30000);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-12, 12, 8, -8, .1, 100); camera.position.set(17, 17, -18); camera.lookAt(0, 0, 0);
    const root = new THREE.Group(); root.name = "floor-02-root";
    const artRoot = new THREE.Group(); artRoot.name = "floor-02-assets"; root.add(artRoot); scene.add(root);
    // State holder only. All visible elevator surfaces are the seven mandatory GLB instances.
    const elevator = new THREE.Group(); elevator.name = "elevator-animation-state";
    const abortController = new AbortController();
    let architecture: PremiumArchitecture | undefined;
    let presetGeometry: THREE.Group | undefined;
    let finishing: ReturnType<typeof finishPremiumInterior> | undefined;
    let polish31: ReturnType<typeof createVisualPolishV31> | undefined;
    const demo35 = new URLSearchParams(location.search).get("gfx35") === "demo";
    const manual35 = import.meta.env.DEV && new URLSearchParams(location.search).get("gfx35Clock") === "manual";
    const reduced35 = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animation35: AnimationScheduler | undefined;
    let dressing34: ReturnType<typeof dressGameInterior> | undefined;
    let navigation34: ReturnType<typeof buildNavigationCatalog> | undefined;
    let contacts33: ReturnType<typeof createAmbientContacts> | undefined;
    let elevator33: ReturnType<typeof recessElevator> | undefined;
    let floor31: ReturnType<typeof applyPremiumFloorV31> | undefined;
    let gfx30: Awaited<ReturnType<typeof applyGfx30Materials>> | undefined;
    const presetLighting = floorPreset?.lighting;
    const presetLocalLights: THREE.Light[] = [];
    const presetLightTargets: THREE.Object3D[] = [];
    let floorY = .12;
    const quality = renderQualityFromSearch(window.location.search);
    const lighting = createPremiumLightingV29({ scene, renderer, camera, floorRoot: root, floorBounds: floorPreset?.bounds, shadowMapSize: RENDER_QUALITY_SETTINGS[quality].shadowMapSize, environment: true,
      ...(presetLighting ? { exposure: presetLighting.exposure, palette: { sky: Number.parseInt(presetLighting.ambient.replace('#', ''), 16), key: Number.parseInt(presetLighting.key.replace('#', ''), 16), fill: Number.parseInt(presetLighting.fill.replace('#', ''), 16), keyIntensity: presetLighting.keyIntensity, fillIntensity: presetLighting.fillIntensity } } : {}),
    });
    const lightZone = (kind: FloorDesignPreset['zones'][number]['kind']) => floorPreset?.zones.find(zone => zone.kind === kind);
    const zoneWorldCenter = (kind: FloorDesignPreset['zones'][number]['kind'], fallback: [number, number]) => {
      const zone = lightZone(kind); const bounds = floorPreset?.bounds ?? ROOM;
      return zone ? [zone.bounds.x + zone.bounds.width / 2 - bounds.width / 2, zone.bounds.z + zone.bounds.depth / 2 - bounds.depth / 2] as [number, number] : fallback;
    };
    const loungeLight = zoneWorldCenter('lounge', [-9.6, -5.6]);
    const meetingLight = zoneWorldCenter('meeting', [7.15, -4.15]);
    lighting.lights.lounge.position.set(loungeLight[0], 2.35, loungeLight[1]);
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    lighting.lights.daylight.position.set(-6, 10, 11);
    lighting.lights.daylight.shadow.normalBias = .025;
    lighting.lights.daylight.shadow.radius = 1.8;
    lighting.lights.daylight.shadow.bias = -.00012;
    scene.background = new THREE.Color(0x20272b);
    lighting.lights.hemisphere.intensity = .55;
    lighting.lights.hemisphere.color.set(0xf0e9dc);
    lighting.lights.hemisphere.groundColor.set(0x847767);
    lighting.lights.fill.intensity = presetLighting?.fillIntensity ?? .85;
    lighting.lights.fill.position.set(3, 6, -6);
    lighting.lights.fill.color.set(presetLighting?.fill ?? '#e8edf0');
    lighting.lights.lounge.intensity = 20;
    lighting.lights.lounge.position.set(loungeLight[0], 2.15, loungeLight[1]);
    lighting.lights.meeting.position.set(meetingLight[0], 3.5, meetingLight[1]);
    lighting.lights.meeting.intensity = presetLighting?.keyIntensity ? Math.min(26, presetLighting.keyIntensity * 9) : 26;
    const liftZone = zoneWorldCenter('service', [-9.3, 3]);
    lighting.lights.elevator.position.set(liftZone[0], 2.5, liftZone[1]);
    lighting.lights.elevator.color.set(0xffbf70);
    lighting.lights.elevator.intensity = 14;
    const workLight = zoneWorldCenter('work', [-1.45, -.55]);
    lighting.lights.lamps.position.set(workLight[0], 3.1, workLight[1]);
    lighting.lights.lamps.intensity = 26;
    for (const fixture of presetLighting?.fixtures ?? []) {
      const position = floorPlanPointToWorld(fixture, floorPreset?.bounds ?? ROOM, floorY);
      const light = fixture.kind === 'spot'
        ? new THREE.SpotLight(fixture.color, Math.min(fixture.intensity, 90), fixture.distance ?? 7, fixture.angle ?? Math.PI / 5, .55, 1.4)
        : new THREE.PointLight(fixture.color, Math.min(fixture.intensity, 65), fixture.distance ?? 6, 1.6);
      light.name = `preset-light:${fixture.id}`;
      light.position.set(position[0], position[1], position[2]);
      light.castShadow = false;
      if (light instanceof THREE.SpotLight && fixture.target) {
        const target = new THREE.Object3D();
        target.position.set(...floorPlanPointToWorld({ x: fixture.target[0], y: fixture.target[1], z: fixture.target[2] }, floorPreset?.bounds ?? ROOM, floorY));
        scene.add(target); light.target = target; presetLightTargets.push(target);
      }
      scene.add(light); presetLocalLights.push(light);
    }
    for (const [name, x, y, z] of [['brick-art',0,3.1,6.3],['lounge-art',-10.2,3.35,-4.25]] as const) {
      const accent = new THREE.PointLight(0xffcd8c, 5, 3.8, 2); accent.name=`gfx33-${name}`;
      accent.position.set(x,y,z); lighting.group.add(accent);
    }
    lighting.setExposure(presetLighting?.exposure ?? 1.02);
    const characterMode = import.meta.env.DEV && new URLSearchParams(location.search).get("gfx29Characters") === "procedural" ? "procedural" : "glb";
    const proceduralCharacters = new Set<PremiumCharacter>();
    const lifecycle = { disposed: false, released: false, geometries: -1, textures: -1 };
    let characterMotionStart = -Infinity;
    root.visible = false;
    let assetsReady = false;
    const hoverBounds = new THREE.Box3();
    const highlight = new THREE.Box3Helper(hoverBounds, 0xffc178);
    highlight.visible = false; highlight.raycast = () => {}; scene.add(highlight);
    const visibleDoors: { object: THREE.Object3D; baseX: number; direction: number }[] = [];
    const debugEnabled = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
    const debugInteraction = (stage: string, detail: Record<string, unknown> = {}) => {
      if (!debugEnabled) return;
      mount.dataset.interactionStage = stage;
      if (detail.semantic === "elevator") mount.dataset.elevatorInteraction = stage;
      console.debug(`[mao-3d] ${stage}`, detail);
    };
    // Layout slots, employee assignments, and the engine floor ID must share
    // the same public world-floor identity. The old showroom adapter hard-coded
    // floor-2 here, filtering every slot authored for floors 3–15 away.
    const layout = showroomLayout(employeesRef.current, floorPreset?.workplaces, sceneWorldFloorId);
    if (floorPreset) mount.dataset.floorPresetWorkplaceIds = JSON.stringify(layout.desks.map(desk => desk.deskId));
    if (floorPreset && activeFloorEmployees.length > 0) {
      const currentEmployeeIds = new Set(activeFloorEmployees.map(employee => employee.employeeId));
      const authoredBindingsMatchRoster = floorPreset.workplaces.every(workplace => {
        if (!workplace.employeeId) return true;
        const deskId = workplace.deskId ?? workplace.id;
        return currentEmployeeIds.has(workplace.employeeId) && layout.desks.find(desk => desk.deskId === deskId)?.occupiedBy === workplace.employeeId;
      });
      mount.dataset.floorPresetBindingsMatchRoster = String(authoredBindingsMatchRoster);
      for (const workplace of authoredBindingsMatchRoster ? floorPreset.workplaces : []) {
        if (!workplace.employeeId) continue;
        // When a deliberately selected development fixture uses another
        // catalogue, the directory's desk occupant remains authoritative.
        // Live snapshots validate the authored mapping when the whole roster
        // matches; a foreign fixture roster is never partly compared.
        const deskId = workplace.deskId ?? workplace.id;
        const assignment = layout.desks.find(desk => desk.deskId === deskId);
        if (assignment?.occupiedBy !== workplace.employeeId) throw new Error(`floor_preset_employee_binding_mismatch:${workplace.employeeId}:${deskId}`);
      }
      mount.dataset.floorPresetEmployeeBindings = JSON.stringify(floorPreset.workplaces.filter(workplace => workplace.employeeId).map(workplace => ({ employeeId: workplace.employeeId, deskId: workplace.deskId ?? workplace.id })));
    }
    const customAuthoredPreset = Boolean(floorPreset && floorPreset.presetId !== 'showroom-v2' && !floorPreset.presetId.startsWith('fallback:'));
    const chairsByDesk = new Map(layout.chairs.map(chair => [chair.deskId, chair]));
    if (assetManifest?.models || assetManifest?.textures) root.userData.assetManifest = assetManifest;
    const artManifestUrl = assetManifest?.manifestUrl ?? "/office-art/v1/manifest.json";
    let artRuntime: OfficeArtRuntime | undefined;
    let proceduralAssetLibrary: ProceduralOfficeAssetLibrary | undefined;
    let proceduralAssetLibraryPromise: Promise<ProceduralOfficeAssetLibrary> | undefined;
    const artInstances = new Set<THREE.Object3D>();
    const proceduralInstances = new Set<THREE.Object3D>();
    const releaseInstance = (object: THREE.Object3D) => {
      if (object.userData.employeeId) animation35?.remove(object.userData.employeeId);
      syncConfirmedStatusBadge(object, undefined, camera);
      lighting.releaseMaterials(object);
      finishing?.releaseCharacter(object);
      if (proceduralCharacters.delete(object as PremiumCharacter)) (object as PremiumCharacter).dispose();
      if (artInstances.delete(object)) artRuntime?.disposeInstance(object);
      if (proceduralInstances.delete(object)) object.removeFromParent();
    };
    let assetFailed = false;
    const pendingWork = new Set<Promise<unknown>>();
    const track = <T,>(promise: Promise<T>): Promise<T> => {
      pendingWork.add(promise);
      promise.then(() => pendingWork.delete(promise), () => pendingWork.delete(promise));
      return promise;
    };
    const loadStartedAt = performance.now();
    void track(loadRendererManifest(artManifestUrl).then(async normalizedManifest => {
      if (disposed) return;
      artRuntime = createOfficeArtRuntime({ manifestUrl: artManifestUrl, manifest: normalizedManifest });
      const runtime = artRuntime;
      if (disposed) return;

      let placedAssets = 0;
      let placedProceduralAssets = 0;
      let placedElevatorAssets = 0;
      const renderedPresetPlacementIds = new Set<string>();
      const placementPromises: Promise<void>[] = [];
      const presetBounds = floorPreset?.bounds ?? ROOM;
      const place = (id: string, options: ArtPlacementOptions) => {
        if (!customAuthoredPreset && (PREMIUM_ARCHITECTURE_METADATA.replaceLegacy as readonly string[]).includes(id)) throw new Error(`legacy_architecture_duplicate:${id}`);
        const pending = (async () => {
          let instance: THREE.Object3D | undefined;
          try {
            if (isProceduralOfficeAsset(id)) {
              if (!proceduralAssetLibrary) {
                proceduralAssetLibraryPromise ??= import('../office-art/procedural-library').then(module => module.createProceduralOfficeAssetLibrary());
                proceduralAssetLibrary = await proceduralAssetLibraryPromise;
              }
              await proceduralAssetLibrary!.ready();
              instance = proceduralAssetLibrary!.create(id);
              instance.position.set(...options.position);
              instance.rotation.y = options.rotationY ?? 0;
              instance.scale.set(...(options.fitScale ?? [1, 1, 1]));
              proceduralInstances.add(instance);
            } else {
              instance = await runtime.createInstance(id, {
                position: options.position,
                rotation: [0, options.rotationY ?? 0, 0],
                scale: options.fitScale ?? [1, 1, 1],
              });
              artInstances.add(instance);
            }
            // Register ownership before the asynchronous material phase so an
            // unmount during texture loading can release this instance too.
            if (disposed) { releaseInstance(instance); return; }
            if (!instance.userData.proceduralOfficeAsset) {
              rememberMaterialRoles(instance);
              await runtime.applyMaterials(instance);
            }
            if (disposed) { releaseInstance(instance); return; }
            if (id !== "floor.oak.light") instance.position.y += floorY;
            instance.userData.employeeId = options.employeeId;
            instance.userData.deskId = options.deskId;
            instance.userData.presetPlacementId = options.placementId;
            if (options.interaction) {
              instance.userData.floorObjectInteraction = { ...options.interaction };
              instance.userData.interactive = options.interaction.kind;
            }
            instance.userData.baseScale = instance.scale.clone();
            instance.traverse(object => {
              const mesh = object as THREE.Mesh;
              if (mesh.isMesh) {
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                const clearGlass = materials.every(material => material.transparent && material.opacity < .5);
                mesh.castShadow = !clearGlass; mesh.receiveShadow = true;
                // Clear architectural panes transmit pointer selection to employees
                // behind them. Opaque frames and furniture retain normal picking.
                if (clearGlass && ["partition.glass", "door.office.glass", "window.frame"].includes(id)) mesh.raycast = () => {};
              }
            });
            artRoot.add(instance);
            if (options.placementId) renderedPresetPlacementIds.add(options.placementId);
            placedAssets += 1;
            if (instance.userData.proceduralOfficeAsset) placedProceduralAssets += 1;
            if (id.startsWith("elevator.")) {
              placedElevatorAssets += 1;
              instance.userData.interactive = "elevator";
              instance.traverse(object => {
                if (id === "elevator.doors" && /(?:left|right)$/i.test(object.name)) {
                  const direction = /left$/i.test(object.name) ? -1 : 1;
                  visibleDoors.push({ object, baseX: object.position.x, direction });
                }
                if (id === "elevator.call-panel") object.userData.elevatorCallPanel = true;
              });
            }
          } catch (error) {
            assetFailed = true;
            if (instance) releaseInstance(instance);
            root.userData.artLoadError = error instanceof Error ? error.message : "office_art_asset_unavailable";
            mount.dataset.artLoadError = `${id}:${root.userData.artLoadError}`;
          }
        })();
        placementPromises.push(track(pending));
        return pending;
      };
      const elevatorAssetIds = ["elevator.cabin", "elevator.doors", "elevator.frame", "elevator.display", "elevator.call-panel", "elevator.floor-sign", "elevator.wall-lights"];
      if (elevatorAssetIds.every(id => normalizedManifest.assets.some(asset => asset.id === id))) {
        const lift = customAuthoredPreset ? floorPreset?.entrances.find(entrance => entrance.kind === 'elevator') : undefined;
        const liftCenter = lift ? lift.offset + lift.width / 2 : 0;
        const liftPoint = !lift ? [-11.76, 0, 3.0] as [number, number, number]
          : lift.wall === 'north' ? worldPoint({ x: liftCenter, z: presetBounds.depth }, presetBounds)
          : lift.wall === 'south' ? worldPoint({ x: liftCenter, z: 0 }, presetBounds)
          : lift.wall === 'east' ? worldPoint({ x: presetBounds.width, z: liftCenter }, presetBounds)
          : worldPoint({ x: 0, z: liftCenter }, presetBounds);
        const liftRotation = !lift || lift.wall === 'west' ? -Math.PI / 2 : lift.wall === 'east' ? Math.PI / 2 : lift.wall === 'north' ? Math.PI : 0;
        const elevatorPosition: [number, number, number] = liftPoint;
        for (const id of elevatorAssetIds) place(id, { position: elevatorPosition, rotationY: liftRotation });
      }
      for (const placement of [...(floorPreset?.furniture ?? []), ...(floorPreset?.decor ?? [])]) {
        const employeeWorkstation = Boolean(placement.deskId && layout.desks.some(desk => desk.deskId === placement.deskId));
        if (employeeWorkstation && ['desk.modern', 'desk.lab', 'desk.cad', 'desk.standing', 'desk.focus', 'chair.ergonomic', 'monitor.single', 'monitor.dual'].includes(placement.asset)) continue;
        // The authored cafe preset keeps its historical filing-cabinet IDs;
        // render its two cold-storage positions as purpose-built refrigerators.
        const asset = floorPreset?.specialization === 'kitchen-cafe' && placement.id.startsWith('cold-storage-cabinet-proxy-') ? 'equipment.refrigerator' : placement.asset;
        place(asset, { position: worldPoint({ x: placement.x, y: placement.y, z: placement.z }, floorPreset?.bounds), rotationY: placement.rotationY, fitScale: placement.scale, employeeId: placement.employeeId, deskId: placement.deskId, placementId: placement.id, interaction: placement.interaction });
      }
      await place("floor.oak.light", { position: [0, 0, 0], fitScale: [presetBounds.width / 12, 1, presetBounds.depth / 9] });
      const floor = artRoot.children.find(object => object.userData.officeAssetId === "floor.oak.light");
      if (disposed) return;
      if (!floor) throw new Error("floor_asset_missing");
      floorY = new THREE.Box3().setFromObject(floor).max.y;
      for (const [deskIndex, desk] of layout.desks.entries()) {
        const deskPosition = worldPoint(desk.position, presetBounds);
        const chair = chairsByDesk.get(desk.deskId);
        if (!chair) continue;
        const workplace = floorPreset?.workplaces[deskIndex];
        const scaleX = (workplace?.width ?? 1.5) / 1.5;
        const scaleZ = (workplace?.depth ?? 1.3) / 1.3;
        const chairDeltaX = (chair.position.x - desk.position.x) * scaleZ;
        const chairDeltaZ = (chair.position.z - desk.position.z) * scaleZ;
        const chairPosition = worldPoint({ x: desk.position.x + chairDeltaX, z: desk.position.z + chairDeltaZ }, presetBounds);
        const workplaceScale: [number, number, number] = [scaleX, 1, scaleZ];
        const workplaceDeskId = workplace?.deskId ?? workplace?.id ?? desk.deskId;
        const deskPlacement = [...(floorPreset?.furniture ?? []), ...(floorPreset?.decor ?? [])].find(item => item.deskId === desk.deskId && ['desk.modern', 'desk.lab', 'desk.cad', 'desk.standing', 'desk.focus'].includes(item.asset));
        const chairPlacement = [...(floorPreset?.furniture ?? []), ...(floorPreset?.decor ?? [])].find(item => item.deskId === desk.deskId && item.asset === 'chair.ergonomic');
        const deskAsset = deskPlacement?.asset ?? (workplace?.kind === 'lab' ? 'desk.lab' : workplace?.kind === 'cad' ? 'desk.cad' : workplace?.kind === 'standing' ? 'desk.standing' : workplace?.kind === 'focus' ? 'desk.focus' : 'desk.modern');
        place(deskAsset, { position: deskPosition, rotationY: desk.orientation, fitScale: deskPlacement?.scale ?? workplaceScale, deskId: workplaceDeskId, placementId: deskPlacement?.id });
        place("chair.ergonomic", { position: chairPosition, rotationY: chair.orientation, fitScale: workplaceScale, deskId: desk.deskId, placementId: chairPlacement?.id });
        const monitor = [...(floorPreset?.furniture ?? []), ...(floorPreset?.decor ?? [])].find(item => item.deskId === desk.deskId && (item.asset === 'monitor.single' || item.asset === 'monitor.dual'));
        const monitorPosition = monitor ? worldPoint({ x: monitor.x, y: monitor.y, z: monitor.z }, presetBounds) : deskPosition;
        place(monitor?.asset ?? "monitor.single", { position: monitorPosition, rotationY: monitor?.rotationY, fitScale: monitor?.scale ?? [scaleX, 1, 1], deskId: desk.deskId, placementId: monitor?.id });
        place("keyboard", { position: deskPosition, fitScale: [.78 * scaleX, 1, 1] });
        place("desk.lamp", { position: [deskPosition[0] - .7, 0, deskPosition[2]] });
        for (const [equipmentIndex, equipmentId] of (workplace?.equipment ?? []).entries()) {
          if (!isProceduralOfficeAsset(equipmentId)) continue;
          place(equipmentId, { position: [deskPosition[0] + .28 + equipmentIndex * .34, deskPosition[1] + .8, deskPosition[2] - .18], rotationY: desk.orientation, deskId: workplaceDeskId });
        }
      }
      await Promise.all(placementPromises);
      if (disposed) return;
      mount.dataset.floorPresetRenderedPlacementIds = JSON.stringify([...renderedPresetPlacementIds].sort());
      if (assetFailed || visibleDoors.length !== 2 || placedElevatorAssets !== elevatorAssetIds.length) throw new Error("mandatory_floor_assets_failed");
      architecture = await createPremiumArchitectureV29({
        floorBounds: { minX: -ROOM.width / 2, maxX: ROOM.width / 2, minZ: -ROOM.depth / 2, maxZ: ROOM.depth / 2 },
        occupiedWorkplaces: customAuthoredPreset ? [] : layout.desks.map(desk => ({ deskId: desk.deskId, employeeId: desk.occupiedBy, x: desk.position.x - 11, z: desk.position.z - 7 })),
        ...createArchitectureAssetAdapter(runtime), floorY, signal: abortController.signal, strictPlacement: true,
        elevatorBounds: { id: 'physical-elevator', minX: -10.80, maxX: -10.66, minZ: 1.45, maxZ: 4.55 },
        elevatorApproach: { x: -8.9, z: 3.0 },
      });
      if (disposed) { architecture.dispose(); architecture = undefined; return; }
      architecture.visible = !customAuthoredPreset;
      architecture.traverse(node => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          if (materials.every(material => material.transparent && material.opacity < .5)) mesh.raycast = () => {};
        }
      });
      artRoot.add(architecture);
      finishing = finishPremiumInterior(architecture, floor);
      finishing.group.visible = !customAuthoredPreset;
      artRoot.add(finishing.group);
      if (customAuthoredPreset && floorPreset) {
        presetGeometry = await buildFloorPresetGeometry(floorPreset, floorY);
        artRoot.add(presetGeometry);
        mount.dataset.floorPresetGeometry = JSON.stringify(presetGeometry.userData.presetElementCounts);
        mount.dataset.floorPresetCutawayWalls = JSON.stringify(presetGeometry.userData.cutawayWalls ?? []);
        mount.dataset.floorPresetWindowAudit = JSON.stringify(presetGeometry.userData.windowAudit ?? {});
        mount.dataset.floorPresetTextureCount = String(presetGeometry.userData.textureUrls?.length ?? 0);
        if (presetGeometry.userData.textureFailures?.length) mount.dataset.floorPresetTextureFailures = presetGeometry.userData.textureFailures.join(',');
      }
      const characters = new Map<string, { key: string; object: THREE.Object3D }>();
      let revision = 0;
      const syncEmployees = async () => {
        const current = ++revision;
        const snapshot = employeesRef.current.filter(employee => employee.floorId === sceneWorldFloorId);
        mount.dataset.renderedEmployeeIds = JSON.stringify(snapshot.map(employee => employee.employeeId));
        mount.dataset.renderedEmployeeDeskBindings = JSON.stringify(snapshot.map(employee => ({ employeeId: employee.employeeId, deskId: employee.deskId })));
        const confirmedStatuses = readConfirmedEmployeeStates(confirmedStatesRef.current, new Set(snapshot.map(employee => employee.employeeId)));
        const wanted = new Set(snapshot.map(employee => employee.employeeId));
        for (const [id, character] of characters) if (!wanted.has(id)) {
          releaseInstance(character.object); characters.delete(id);
        }
        const updates = await Promise.allSettled(snapshot.map(async employee => {
          const chair = layout.chairs.find(chair => chair.deskId === employee.deskId);
          // The reserve desk has no initial characterSpot; derive its position
          // from the same chair geometry rule used by the layout engine.
          const spot = layout.characterSpots.find(spot => spot.deskId === employee.deskId)
            ?? (chair ? { position: { ...chair.position, z: chair.position.z + chair.bounds.depth / 2 + .25 } } : undefined);
          if (!spot) { const old = characters.get(employee.employeeId); if (old) releaseInstance(old.object); characters.delete(employee.employeeId); return; }
          const confirmedStatus = confirmedStatuses.get(employee.employeeId);
          const visualStatus = statusAppearance(confirmedStatus) ?? employee.status;
          const key = `${employee.deskId}:${employee.status}:${confirmedStatus ?? "unconfirmed"}`;
          const previous = characters.get(employee.employeeId);
          if (previous?.key === key) return;
          // A real status update must not replace/teleport an actor mid-excursion.
          if (previous?.object.name === 'gfx32-tailored-character' && previous.object.userData.deskId === employee.deskId) {
            (previous.object as PremiumCharacter).updateData({employeeId:employee.employeeId,deskId:employee.deskId,status:visualStatus});
            previous.object.userData.status=employee.status;previous.object.userData.characterVisualStatus=visualStatus;previous.object.userData.departmentId=employee.departmentId;previous.key=key;
            syncConfirmedStatusBadge(previous.object, confirmedStatus, camera);
            characterMotionStart = performance.now();
            return;
          }
          const asset = visualStatus === "blocked" ? "character.base.blocked" : visualStatus === "working" ? "character.base.working" : "character.base.idle";
          const artMode = new URLSearchParams(location.search).get("gfx32");
          const art32 = characterMode !== "procedural" && artMode !== "legacy" && (artMode !== "prototypes" || snapshot.indexOf(employee) < 3);
          const object = art32 ? createArtCharacter({ employeeId: employee.employeeId, deskId: employee.deskId, status: visualStatus === "blocked" ? "blocked" : visualStatus === "offline" ? "offline" : visualStatus === "working" ? "working" : "idle" }, artMode === "prototypes" ? snapshot.indexOf(employee) : undefined, demo35) : characterMode === "procedural"
            ? createPremiumCharacter({ employeeId: employee.employeeId, deskId: employee.deskId, status: visualStatus === "blocked" ? "blocked" : visualStatus === "working" ? "working" : visualStatus === "offline" ? "offline" : "idle" })
            : await runtime.createInstance(asset, { position: worldPoint(spot.position, presetBounds) });
          if (art32 || characterMode === "procedural") proceduralCharacters.add(object as PremiumCharacter); else artInstances.add(object);
          object.position.set((chair?.position.x ?? spot.position.x) - 11, floorY, (chair?.position.z ?? spot.position.z) - 7);
          object.rotation.y = chair?.orientation ?? 0;
          if (disposed || current !== revision) { releaseInstance(object); return; }
          if (!art32 && characterMode === "glb") { rememberMaterialRoles(object); await runtime.applyMaterials(object); if (!disposed) finishing?.applyCharacter(object, employee.employeeId); }
          if (!disposed) lighting.applyMaterials(object);
          if (disposed || current !== revision) { releaseInstance(object); return; }
          if (previous) releaseInstance(previous.object);
          object.userData.employeeId = employee.employeeId;
          object.userData.deskId = employee.deskId;
          object.userData.sourceDeskId = (employee as WorldEmployee & { sourceDeskId?: string }).sourceDeskId ?? employee.deskId;
          object.userData.status = employee.status;
          object.userData.characterVisualStatus = visualStatus;
          object.userData.departmentId = employee.departmentId;
          object.userData.baseScale = object.scale.clone();
          syncConfirmedStatusBadge(object, confirmedStatus, camera);
          artRoot.add(object); characters.set(employee.employeeId, { key, object });
          if (animation35 && (object as unknown as RiggedObject).rig35) {
            const physicalChair=artRoot.children.find(o=>o.userData.officeAssetId==='chair.ergonomic'&&o.userData.deskId===employee.deskId);
            if(physicalChair)animation35.add({employeeId:employee.employeeId,deskId:employee.deskId,object:object as unknown as RiggedObject,chair:physicalChair});
          }
        }));
        const failed = updates.find(result => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        if (!disposed) {
          if (navigation34) for (const seat of navigation34.seats) seat.employeeId = snapshot.find(employee=>employee.deskId===seat.deskId)?.employeeId;
          characterMotionStart = performance.now(); invalidate();
        }
      };
      syncRef.current = () => { void track(syncEmployees().catch(() => report("error"))); };
      await Promise.all(placementPromises);
      if (disposed) return;
      await syncEmployees();
      if (disposed) return;
      // Shared runtime materials may be returned while another instance is still
      // loading their texture. Clone only after all initial material work settles.
      if (abortController.signal.aborted) throw new Error("scene_loading_timeout");
      lighting.applyMaterials(root);
      if (floorPreset) {
        mount.dataset.floorPresetMaterialRoleCount = String(applyFloorPresetMaterialPalette(root, floorPreset));
        mount.dataset.floorPresetCamera = JSON.stringify(floorPreset.camera);
      }
      gfx30 = await applyGfx30Materials(artRoot, architecture, abortController.signal);
      if (disposed) { gfx30.cleanup(); gfx30 = undefined; return; }
      elevator33 = recessElevator(artRoot);
      floor31 = applyPremiumFloorV31(floor);
      // These art passes contain showroom-fixed geometry. Authored layouts use
      // their own furniture/decor and receive shared materials, floor finish,
      // physically based lighting and shadows without showroom overlays.
      if (!customAuthoredPreset) {
        polish31 = createVisualPolishV31({ root: artRoot, architecture, material: gfx30.material, floorY });
        contacts33 = createAmbientContacts(artRoot, architecture, floorY);
        dressing34 = dressGameInterior(artRoot, gfx30.material, floorY);
      }
      if (!customAuthoredPreset && employeesRef.current.length > 0) {
        if (!polish31) throw new Error('showroom_navigation_polish_unavailable');
        navigation34 = buildNavigationCatalog(layout, artRoot, architecture, polish31.solidBounds, floorY);
        if (!navigation34.ready) throw new Error(`gfx34_navigation_conflict:${JSON.stringify(navigation34.issues)}`);
      }
      if (demo35 && navigation34 && polish31) {
        animation35 = new AnimationScheduler({catalog:navigation34,obstacles:[...architecture.diagnostics.obstacles,...polish31.solidBounds],floorY,maxMoving:1});
        for (const object of artRoot.children.filter(o=>Boolean((o as unknown as RiggedObject).rig35))) {
          const chair=artRoot.children.find(o=>o.userData.officeAssetId==='chair.ergonomic'&&o.userData.deskId===object.userData.deskId);
          if(chair)animation35.add({employeeId:object.userData.employeeId,deskId:object.userData.deskId,object:object as unknown as RiggedObject,chair});
        }
        animation35.setReducedMotion(reduced35.matches);animation35.setHidden(document.hidden);
        const actors=[...animation35.controllers.values()].sort((a,b)=>a.actor.deskId.localeCompare(b.actor.deskId));
        const lounge=architecture.assetBounds.find(a=>a.key==='lounge-chair');
        if(actors[0]&&lounge)animation35.startExcursion(actors[0].actor.employeeId,{minX:lounge.bounds.min.x,maxX:lounge.bounds.max.x,minZ:lounge.bounds.min.z,maxZ:lounge.bounds.max.z});
        if(actors[1])animation35.activity(actors[1].actor.employeeId,'SEATED_TYPING',14);
        if(actors[2])animation35.activity(actors[2].actor.employeeId,'SEATED_THINKING',6);
        mount.dataset.localSimulation='gfx35-demo';
      }
      if (assetFailed || !placedAssets || visibleDoors.length !== 2 || placedElevatorAssets !== elevatorAssetIds.length) { report("error"); clearTimeout(deadline); return; }
      // Do not create a blank showroom if a browser/GLTF loader rejects one
      // elevator node. The fallback is only replaced after every part arrives.

      artRoot.visible = placedAssets > 0;
      for (const object of artRoot.children) if (object.userData.interactive === "elevator") hoverBounds.union(new THREE.Box3().setFromObject(object));
      root.visible = true;
      requestAnimationFrame(() => { if (!disposed) renderer.domElement.style.opacity = '1'; });
      assetsReady = true;
      root.userData.artPack = "office-pack.glb";
      root.userData.architecture = "premium-v29";
      mount.dataset.architecture = "premium-v29";
      mount.dataset.characterMode = new URLSearchParams(location.search).get("gfx32") === "legacy" || characterMode === "procedural" ? characterMode : "gfx32";
      mount.dataset.artPlacedAssets = String(placedAssets);
      mount.dataset.proceduralAssetCount = String(placedProceduralAssets);
      mount.dataset.elevatorAssets = String(placedElevatorAssets);
      fit(); resize();
      emitMetrics(loadStartedAt);
      invalidate();
    }).catch(error => {
      if (disposed) return;
      report("error"); clearTimeout(deadline); root.visible = false;
      root.userData.artLoadError = error instanceof Error ? error.message : "office_art_unavailable";
      mount.dataset.artLoadError = root.userData.artLoadError;
    }));

    let frame = 0; let frameCount = 0; let hidden = document.hidden;
    const emitMetrics = (loadStartedAt?: number) => {
      const metrics: OfficeSceneRuntimeMetrics = {
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        dpr: renderer.getPixelRatio(),
        frameActivity: hidden ? "paused" : "active",
        frameCount,
        ...(loadStartedAt === undefined ? {} : { loadTimeMs: Math.round(performance.now() - loadStartedAt) }),
      };
      metricsRef.current?.(metrics);
      mount.dataset.drawCalls = String(metrics.drawCalls);
      mount.dataset.triangles = String(metrics.triangles);
      mount.dataset.dpr = String(metrics.dpr);
      mount.dataset.frameActivity = metrics.frameActivity;
    };
    const renderFrame = () => {
      frame = 0;
      if (!canRenderSceneFrame(hidden, disposed)) { emitMetrics(); return; }
      highlight.visible = renderer.domElement.classList.contains("is-elevator-hover");
      root.traverse(object => {
        if (object.userData.employeeId) {
          const base = object.userData.baseScale as THREE.Vector3 | undefined;
          const emphasis = object.userData.employeeId === selectedRef.current ? 1.12 : object === hovered ? 1.08 : 1;
          if (base) object.scale.copy(base).multiplyScalar(emphasis);
        }
      });
      const motionTime = (performance.now() - characterMotionStart) / 1000;
      const motionEnabled = !window.matchMedia('(prefers-reduced-motion: reduce)').matches && motionTime < .6;
      for (const character of proceduralCharacters) if (character.name === 'gfx32-tailored-character' && !(character as unknown as RiggedObject).rig35) character.updateAnimation(motionTime, { enabled: motionEnabled, reducedMotion: !motionEnabled });
      if (animation35 && !manual35) animation35.tick(performance.now());
      const opening = Number(elevator.userData.openProgress ?? 0);
      const targetOpening = Number(elevator.userData.openTarget ?? 0);
      const damped = THREE.MathUtils.damp(opening, targetOpening, 7, 1 / 60);
      const nextOpening = Math.abs(damped - targetOpening) < .001 ? targetOpening : damped;
      elevator.userData.openProgress = nextOpening;
      const leftDoor = elevator.children.find(child => child.userData.elevatorDoor === "left");
      const rightDoor = elevator.children.find(child => child.userData.elevatorDoor === "right");
      if (leftDoor) leftDoor.position.x = -.515 - nextOpening * .42;
      if (rightDoor) rightDoor.position.x = .515 + nextOpening * .42;
      for (const door of visibleDoors) door.object.position.x = door.baseX + door.direction * nextOpening * .95;
      try { renderer.render(scene, camera); } catch { report("error"); clearTimeout(deadline); return; }
      if (assetsReady) { assetsReady = false; clearTimeout(deadline); report("ready"); }
      frameCount += 1; emitMetrics();
      if (nextOpening !== targetOpening || motionEnabled || (animation35?.active && !manual35)) invalidate();
    };
    const invalidate = () => { if (disposed || hidden || frame) return; frame = requestAnimationFrame(renderFrame); };
    invalidateRef.current = invalidate;
    const onVisibilityChange = () => { hidden = document.hidden; animation35?.setHidden(hidden); if (hidden) { touches.clear(); pinching = false; releasePointer(activePointerId); if (frame) { cancelAnimationFrame(frame); frame = 0; } } else invalidate(); emitMetrics(); };
    // Look into the room from the south-east so the north wall/windows remain
    // a readable background instead of occluding the workstation bay.
    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let down = { x: 0, y: 0, moved: false }; const cameraTarget = floorPreset?.camera.target ?? [0, 1.6, 0]; const cameraPosition = floorPreset?.camera.position ?? [19, 16, -23]; const restTarget = new THREE.Vector3(cameraTarget[0], cameraTarget[1], cameraTarget[2]); let target = restTarget.clone(); const baseOffset = new THREE.Vector3(cameraPosition[0] - cameraTarget[0], cameraPosition[1] - cameraTarget[1], cameraPosition[2] - cameraTarget[2]);
    const clampPresetZoom = (zoom: number) => THREE.MathUtils.clamp(zoom, floorPreset?.camera.minZoom ?? CAMERA_ZOOM_MIN, floorPreset?.camera.maxZoom ?? CAMERA_ZOOM_MAX);
    const touches = new Map<number, THREE.Vector2>();
    let pinchDistance = 0, pinching = false;
    let activePointerId: number | undefined;
    let dragging = false;
    const cameraBounds = floorPreset?.bounds ?? ROOM;
    const clampTarget = () => { target.x = THREE.MathUtils.clamp(target.x, -cameraBounds.width * .18, cameraBounds.width * .18); target.z = THREE.MathUtils.clamp(target.z, -cameraBounds.depth * .18, cameraBounds.depth * .18); };
    const reportCameraState = () => {
      mount.dataset.cameraZoom = String(camera.zoom);
      mount.dataset.cameraTarget = JSON.stringify(target.toArray());
    };
    const updateCamera = () => { camera.position.copy(target).add(baseOffset); camera.lookAt(target); reportCameraState(); };
    const fit = () => { target.copy(restTarget); camera.zoom = floorPreset?.camera.zoom ?? 1; updateCamera(); camera.updateProjectionMatrix(); };
    const resize = () => {
      const rect = mount.getBoundingClientRect(), aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
      const fitCamera = new THREE.OrthographicCamera();
      fitCamera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]); fitCamera.lookAt(restTarget); fitCamera.updateMatrixWorld(true);
      let span = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      artRoot.updateMatrixWorld(true);
      artRoot.traverse(node => {
        const mesh = node as THREE.Mesh; if (!mesh.isMesh || !mesh.visible) return;
        for (let parent = mesh.parent; parent && parent !== artRoot; parent = parent.parent) if (!parent.visible) return;
        let bounds: THREE.Box3;
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
          const instanced = mesh as THREE.InstancedMesh; instanced.computeBoundingBox(); bounds = instanced.boundingBox!;
        } else { mesh.geometry.computeBoundingBox(); bounds = mesh.geometry.boundingBox!; }
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld).applyMatrix4(fitCamera.matrixWorldInverse);
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
        }
      });
      if (Number.isFinite(minX)) {
        span = Math.max((maxY - minY) / 2, (maxX - minX) / (2 * aspect));
        const right = new THREE.Vector3().setFromMatrixColumn(fitCamera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(fitCamera.matrixWorld, 1);
        const nextRest = restTarget.clone().addScaledVector(right, (minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2);
        target.add(nextRest).sub(restTarget); restTarget.copy(nextRest); updateCamera();
      }
      span = (span || 11) * 1.045;
      camera.left = -span * aspect; camera.right = span * aspect; camera.top = span; camera.bottom = -span;
      camera.updateProjectionMatrix(); renderer.setSize(rect.width, rect.height, false);
    };
    const releasePointer = (pointerId?: number) => {
      activePointerId = undefined;
      if (pointerId !== undefined && renderer.domElement.hasPointerCapture(pointerId)) renderer.domElement.releasePointerCapture(pointerId);
      dragging = false;
      down.moved = false;
      renderer.domElement.classList.remove("is-dragging");
      renderer.domElement.style.cursor = "grab";
    };
    const onPointerDown = (event: PointerEvent) => {
      if (status !== "ready" || event.button !== 0) return;
      if (event.pointerType === "touch") {
        touches.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
        if (touches.size === 2) {
          releasePointer(activePointerId); pinching = true;
          const points = [...touches.values()]; pinchDistance = points[0].distanceTo(points[1]);
          for (const id of touches.keys()) try { renderer.domElement.setPointerCapture(id); } catch { /* teardown */ }
          event.preventDefault(); return;
        }
      }
      if (activePointerId !== undefined || pinching) return;
      event.preventDefault();
      activePointerId = event.pointerId;
      down = { x: event.clientX, y: event.clientY, moved: false };
      debugInteraction("pointerdown", { pointerId: event.pointerId, x: event.clientX, y: event.clientY });
      try { renderer.domElement.setPointerCapture(event.pointerId); } catch { /* Firefox can reject capture during teardown. */ }
    };
    let hovered: THREE.Object3D | undefined;
    const pickHit = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.copy(pointerNdc(event, rect));
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      const visible = (object: THREE.Object3D): boolean => object.visible && (!object.parent || visible(object.parent));
      const hit = raycaster.intersectObjects(root.children, true).find(item => visible(item.object));
      const semanticHit = hit ? { ...hit, semantic: interactiveAncestor(hit.object) } : undefined;
      debugInteraction("raycast", { semantic: semanticHit?.semantic?.userData.interactive, object: hit?.object.name });
      return semanticHit;
    };
    const pickEmployee = (event: PointerEvent) => {
      const semantic = pickHit(event)?.semantic;
      return semantic?.userData.employeeId ? semantic : undefined;
    };
    const isElevatorHit = (hit: { semantic?: THREE.Object3D } | undefined) => hit?.semantic?.userData.interactive === "elevator";
    const floorPoint = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.copy(pointerNdc(event, rect));
      raycaster.setFromCamera(pointer, camera);
      const point = new THREE.Vector3();
      return raycaster.ray.intersectPlane(floorPlane, point) ? point : undefined;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (touches.has(event.pointerId)) touches.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
      if (pinching) {
        event.preventDefault();
        if (touches.size === 2) {
          const points = [...touches.values()], distance = points[0].distanceTo(points[1]);
          const center = points[0].clone().add(points[1]).multiplyScalar(.5);
          if (pinchDistance > 0) zoomAt(center.x, center.y, distance / pinchDistance);
          pinchDistance = distance;
        }
        return;
      }
      if (activePointerId === event.pointerId) {
        event.preventDefault();
        const previous = new THREE.Vector2(down.x, down.y);
        const dx = event.clientX - previous.x; const dy = event.clientY - previous.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { down.moved = true; dragging = true; debugInteraction("drag-start", { pointerId: event.pointerId }); renderer.domElement.classList.add("is-dragging"); }
        if (dragging) {
          const before = floorPoint({ ...event, clientX: down.x, clientY: down.y });
          const after = floorPoint(event);
          if (before && after) { target.add(before).sub(after); clampTarget(); updateCamera(); invalidate(); }
          down.x = event.clientX; down.y = event.clientY;
        }
        return;
      }
      const hit = pickHit(event); const next = pickEmployee(event); const elevatorHover = isElevatorHit(hit);
      const objectHover = Boolean(hit?.semantic?.userData.floorObjectInteraction);
      if (next !== hovered || elevatorHover !== renderer.domElement.classList.contains("is-elevator-hover") || objectHover !== (renderer.domElement.dataset.objectHover === 'true')) {
        hovered = next; renderer.domElement.classList.toggle("is-elevator-hover", elevatorHover); renderer.domElement.dataset.objectHover = String(objectHover); renderer.domElement.style.cursor = next || elevatorHover || objectHover ? "pointer" : "grab"; invalidate();
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      touches.delete(event.pointerId);
      if (pinching) {
        releasePointer(event.pointerId);
        if (!touches.size) { pinching = false; pinchDistance = 0; }
        return;
      }
      if (activePointerId !== event.pointerId) { debugInteraction("pointerup-ignored", { pointerId: event.pointerId }); return; }
      const wasDrag = down.moved || Math.abs(event.clientX - down.x) + Math.abs(event.clientY - down.y) > 3;
      releasePointer(event.pointerId);
      if (wasDrag) { debugInteraction("click-suppressed-after-drag", { pointerId: event.pointerId }); return; }
      const hit = pickHit(event);
      if (isElevatorHit(hit)) { elevator.userData.openTarget = Number(elevator.userData.openTarget ?? 0) > .5 ? 0 : 1; debugInteraction("elevator-click", { semantic: "elevator", object: hit?.object.name || hit?.object.type }); elevatorCallbackRef.current?.(); invalidate(); return; }
      const floorObject = hit?.semantic?.userData.floorObjectInteraction as { kind?: string; targetId?: string } | undefined;
      if (floorObject) {
        renderer.domElement.dispatchEvent(new CustomEvent('mao-floor-object-select', { bubbles: true, detail: { ...floorObject, assetId: hit?.semantic?.userData.officeAssetId, placementId: hit?.semantic?.userData.presetPlacementId } }));
        return;
      }
      const employee = pickEmployee(event); if (employee?.userData.employeeId) { debugInteraction("employee-click", { employeeId: employee.userData.employeeId }); callbackRef.current?.(employee.userData.employeeId); }
    };
    const clearHover = () => { hovered = undefined; renderer.domElement.classList.remove("is-elevator-hover"); renderer.domElement.style.cursor = "grab"; invalidate(); };
    const onPointerCancel = (event: PointerEvent) => { touches.delete(event.pointerId); if (!touches.size) pinching = false; if (activePointerId === event.pointerId) releasePointer(event.pointerId); clearHover(); };
    const onLostPointerCapture = (event: PointerEvent) => { if (activePointerId === event.pointerId) { releasePointer(); clearHover(); } };
    const onWindowBlur = () => { touches.clear(); pinching = false; releasePointer(activePointerId); clearHover(); };
    renderer.domElement.addEventListener("pointerleave", clearHover);
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const zoomAt = (clientX: number, clientY: number, factor: number) => {
      const rect = renderer.domElement.getBoundingClientRect(); pointer.copy(pointerNdc({ clientX, clientY }, rect)); raycaster.setFromCamera(pointer, camera);
      const before = new THREE.Vector3(); if (!raycaster.ray.intersectPlane(floorPlane, before)) return;
      camera.zoom = clampPresetZoom(camera.zoom * factor); camera.updateProjectionMatrix();
      raycaster.setFromCamera(pointer, camera); const after = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(floorPlane, after)) { target.add(before).sub(after); clampTarget(); updateCamera(); }
      reportCameraState();
      invalidate();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, Math.exp(-normalizeWheelDelta(event, renderer.domElement.clientHeight) * .0012));
    };
    const onFit = () => { fit(); invalidate(); };
    const onZoomIn = () => { camera.zoom = clampPresetZoom(camera.zoom * 1.18); camera.updateProjectionMatrix(); reportCameraState(); invalidate(); };
    const onZoomOut = () => { camera.zoom = clampPresetZoom(camera.zoom * .84); camera.updateProjectionMatrix(); reportCameraState(); invalidate(); };
    const onReset = () => { fit(); invalidate(); };
    const nonPassive: AddEventListenerOptions = { passive: false };
    renderer.domElement.addEventListener("pointerdown", onPointerDown, nonPassive); renderer.domElement.addEventListener("pointermove", onPointerMove, nonPassive); renderer.domElement.addEventListener("pointerup", onPointerUp, nonPassive); renderer.domElement.addEventListener("pointercancel", onPointerCancel, nonPassive); renderer.domElement.addEventListener("lostpointercapture", onLostPointerCapture); renderer.domElement.addEventListener("wheel", onWheel, nonPassive); window.addEventListener("blur", onWindowBlur); window.addEventListener("mao-3d-fit", onFit); window.addEventListener("mao-3d-zoom-in", onZoomIn); window.addEventListener("mao-3d-zoom-out", onZoomOut); window.addEventListener("mao-3d-reset", onReset); document.addEventListener("visibilitychange", onVisibilityChange);
    const inspect = (event: Event) => {
      if (debugEnabled) (event as CustomEvent).detail({ renderer, scene, camera, artRoot, visibleDoors, highlight, status, frameCount, architecture, lighting, lifecycle, characterMode, navigation34, animation35, advance35:(seconds:number)=>{animation35?.advance(seconds);invalidate();} });
    };
    mount.addEventListener("mao-3d-inspect", inspect);
    const onReduced35=()=>{animation35?.setReducedMotion(reduced35.matches);invalidate();}; reduced35.addEventListener('change',onReduced35);
    const observer = new ResizeObserver(() => { resize(); invalidate(); }); observer.observe(mount); updateCamera(); resize(); invalidate();
    return () => {
      disposed = true; lifecycle.disposed = true; animation35?.dispose(); reduced35.removeEventListener('change',onReduced35); abortController.abort();
      clearTimeout(deadline);
      syncRef.current = undefined; invalidateRef.current = undefined;
      mount.removeEventListener("mao-3d-inspect", inspect);
      renderer.domElement.removeEventListener("pointerleave", clearHover);
      releasePointer(activePointerId);
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("mao-3d-fit", onFit);
      window.removeEventListener("mao-3d-zoom-in", onZoomIn);
      window.removeEventListener("mao-3d-zoom-out", onZoomOut);
      window.removeEventListener("mao-3d-reset", onReset);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown, nonPassive);
      renderer.domElement.removeEventListener("pointermove", onPointerMove, nonPassive);
      renderer.domElement.removeEventListener("pointerup", onPointerUp, nonPassive);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel, nonPassive);
      renderer.domElement.removeEventListener("lostpointercapture", onLostPointerCapture);
      renderer.domElement.removeEventListener("wheel", onWheel, nonPassive);
      dressing34?.cleanup(); dressing34 = undefined;
      contacts33?.cleanup(); contacts33 = undefined;
      elevator33?.cleanup(); elevator33 = undefined;
      polish31?.cleanup(); polish31 = undefined;
      floor31?.cleanup(); floor31 = undefined;
      gfx30?.cleanup(); gfx30 = undefined;
      lighting.cleanup();
      for (const light of presetLocalLights) { light.removeFromParent(); if (light instanceof THREE.SpotLight) light.target.removeFromParent(); }
      for (const target of presetLightTargets) target.removeFromParent();
      finishing?.cleanup(); finishing = undefined;
      architecture?.dispose(); architecture = undefined;
      presetGeometry?.userData.dispose?.(); presetGeometry = undefined;
      artRoot.removeFromParent();
      const cleanup = Promise.allSettled([...pendingWork]).then(async () => {
        architecture?.dispose();
        for (const object of [...proceduralCharacters]) releaseInstance(object);
        for (const instance of [...artInstances]) releaseInstance(instance);
        for (const instance of [...proceduralInstances]) releaseInstance(instance);
        artRuntime?.disposeSharedResources();
        proceduralAssetLibrary?.dispose(); proceduralAssetLibrary = undefined;
        await Promise.resolve();
        lifecycle.released = true;
        lifecycle.geometries = renderer.info.memory.geometries;
        lifecycle.textures = renderer.info.memory.textures;
      });
      rendererCleanups.set(renderer, cleanup);
      highlight.geometry.dispose(); (highlight.material as THREE.Material).dispose();
    };
  }, [configurationKey, layoutKey, presetKey, visualProfile]);

  useEffect(() => { syncRef.current?.(); }, [employees, confirmedEmployeeStates]);

  useEffect(() => {
    if (!cameraAction) return;
    const eventName = cameraAction === 'fit-floor' ? 'mao-3d-fit' : `mao-3d-${cameraAction}`;
    window.dispatchEvent(new Event(eventName));
  }, [cameraAction, cameraActionKey]);

  useEffect(() => {
    const root = mountRef.current; if (!root) return;
    if (!selectedEmployeeId) delete root.dataset.selectedEmployee;
    invalidateRef.current?.();
    // Selection is intentionally kept in React state; the next render can be
    // upgraded to an outline pass without coupling the public world contract.
    if (selectedEmployeeId) root.dataset.selectedEmployee = selectedEmployeeId;
  }, [selectedEmployeeId]);

  return <section className="office-scene-3d" aria-label={`3D office: floor ${floorNumber}`}><div className="office-scene-3d-heading"><div><span>MAO HYBRID · FLOOR {String(floorNumber).padStart(2, '0')}</span><h1>{floorTitle}</h1></div><small>drag — pan · wheel / two fingers — zoom · click — select</small></div><div ref={mountRef} className="office-scene-3d-mount" />{typeof window !== "undefined" && new URLSearchParams(window.location.search).get("gfx35") === "demo" && <div data-gfx35-label="local-simulation" style={{position:"absolute",bottom:52,left:18,zIndex:3,pointerEvents:"none",padding:"6px 10px",borderRadius:6,background:"#182124e8",color:"#e7c693",fontSize:11}}>Локальная симуляция · GFX35 · без LLM</div>}<div className="office-scene-3d-controls"><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("mao-3d-fit"))}>Fit floor</button><span>{floorPreset?.workplaces.length ?? 12} desks · {activeFloorEmployees.length} employees</span><small>Elevator · Director · Live API</small></div></section>;
}
