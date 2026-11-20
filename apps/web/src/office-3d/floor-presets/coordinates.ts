import type { FloorDesignPreset } from './types'

export interface FloorPlanPoint { x: number; y?: number; z: number }
export interface FloorPlanBounds extends Pick<FloorDesignPreset['bounds'], 'width' | 'depth'> {}

/** Maps south-west-origin plan metres to the centered Three.js scene. */
export function floorPlanPointToWorld(point: FloorPlanPoint, bounds: FloorPlanBounds, floorY = 0): [number, number, number] {
  return [point.x - bounds.width / 2, floorY + (point.y ?? 0), point.z - bounds.depth / 2]
}
