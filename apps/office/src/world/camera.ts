export interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface CameraBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export const DEFAULT_CAMERA: CameraState = { x: 0, y: 0, zoom: 1 };
export const CAMERA_BOUNDS: CameraBounds = { minX: -260, maxX: 260, minY: -170, maxY: 170 };
export const MIN_ZOOM = 0.72;
export const MAX_ZOOM = 1.85;

export interface FloorCameraStore {
  get(floorId: string): CameraState;
  set(floorId: string, state: CameraState): void;
}

export function createFloorCameraStore(): FloorCameraStore {
  const states = new Map<string, CameraState>();
  return {
    get: floorId => states.get(floorId) ?? DEFAULT_CAMERA,
    set: (floorId, state) => states.set(floorId, clampCamera(state)),
  };
}

export function clampCamera(state: CameraState, bounds: CameraBounds = CAMERA_BOUNDS): CameraState {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, state.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, state.y)),
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom)),
  };
}

export function panCamera(state: CameraState, dx: number, dy: number): CameraState {
  return clampCamera({ ...state, x: state.x + dx, y: state.y + dy });
}

export function zoomAtPoint(state: CameraState, factor: number, pointX: number, pointY: number): CameraState {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor));
  const ratio = zoom / state.zoom;
  return clampCamera({ x: pointX - (pointX - state.x) * ratio, y: pointY - (pointY - state.y) * ratio, zoom });
}

export function focusPoint(pointX: number, pointY: number, zoom = 1.3): CameraState {
  return clampCamera({ x: -pointX, y: -pointY, zoom });
}
