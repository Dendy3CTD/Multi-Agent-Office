export { FLOOR_01_LOBBY_RECEPTION } from './floor-01-lobby-reception'
export { FLOOR_02_MANAGEMENT } from './floor-02-management'
export { FLOOR_03_SOFTWARE_DEVELOPMENT } from './floor-03-software-development'
export { FLOOR_04_QUALITY_ASSURANCE } from './floor-04-quality-assurance'
export { validateFloorDesignPreset } from '../../floor-presets/validate'

import { FLOOR_01_LOBBY_RECEPTION } from './floor-01-lobby-reception'
import { FLOOR_02_MANAGEMENT } from './floor-02-management'
import { FLOOR_03_SOFTWARE_DEVELOPMENT } from './floor-03-software-development'
import { FLOOR_04_QUALITY_ASSURANCE } from './floor-04-quality-assurance'

/** Authored V4 presets only. The shared registry owner performs registration. */
export const FLOOR_01_TO_04_PRESETS = [
  FLOOR_01_LOBBY_RECEPTION,
  FLOOR_02_MANAGEMENT,
  FLOOR_03_SOFTWARE_DEVELOPMENT,
  FLOOR_04_QUALITY_ASSURANCE,
] as const
