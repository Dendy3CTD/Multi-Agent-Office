/** Coordinates used by the baked 1672×941 room texture. */
export const SCENE_WIDTH = 1672
export const SCENE_HEIGHT = 941

export interface ScenePoint { x: number; y: number }
export interface SceneRect extends ScenePoint { width: number; height: number }

/** Convert source-image pixels to the normalized coordinates used by the UI. */
export function scenePoint(x: number, y: number): ScenePoint {
  return { x: (x / SCENE_WIDTH) * 100, y: (y / SCENE_HEIGHT) * 100 }
}

export function sceneRect(x: number, y: number, width: number, height: number): SceneRect {
  return { ...scenePoint(x, y), width: (width / SCENE_WIDTH) * 100, height: (height / SCENE_HEIGHT) * 100 }
}

export function scenePixelPoint(x: number, y: number, width: number, height: number): ScenePoint {
  return { x: (x / width) * SCENE_WIDTH, y: (y / height) * SCENE_HEIGHT }
}
