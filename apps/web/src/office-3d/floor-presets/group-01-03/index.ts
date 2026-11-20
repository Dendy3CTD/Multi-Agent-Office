export { FLOOR_01_MANAGEMENT } from './floor-01-management';
export { FLOOR_02_DEVELOPMENT } from './floor-02-development';
export { FLOOR_03_QA } from './floor-03-qa';
export { validateFloorDesignPreset } from './preset-builder';
export type { FloorDesignPreset, FloorDesignValidation, FloorDesignValidationIssue, FloorZoneKind, FurnitureMount } from './schema';

import { FLOOR_01_MANAGEMENT } from './floor-01-management';
import { FLOOR_02_DEVELOPMENT } from './floor-02-development';
import { FLOOR_03_QA } from './floor-03-qa';

export const FLOOR_DESIGN_PRESETS = [FLOOR_01_MANAGEMENT, FLOOR_02_DEVELOPMENT, FLOOR_03_QA] as const;
