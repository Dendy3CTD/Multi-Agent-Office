import type { FloorDesignPreset } from '../../floor-presets/types'
import { FLOOR_09_DESIGN } from './floor-09-design'
import { FLOOR_10_FINANCE } from './floor-10-finance'
import { FLOOR_11_DEVOPS } from './floor-11-devops'
import { FLOOR_12_AUTOMATION } from './floor-12-automation'

/** Office V4 references 09–12 (logical floors 08–11, world floors 09–12). */
export const FLOOR_09_TO_12_PRESETS: readonly FloorDesignPreset[] = [
  FLOOR_09_DESIGN,
  FLOOR_10_FINANCE,
  FLOOR_11_DEVOPS,
  FLOOR_12_AUTOMATION,
]

export { FLOOR_09_DESIGN, FLOOR_10_FINANCE, FLOOR_11_DEVOPS, FLOOR_12_AUTOMATION }
