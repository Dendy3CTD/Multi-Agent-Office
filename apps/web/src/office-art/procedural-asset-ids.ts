export const PROCEDURAL_OFFICE_ASSET_IDS = [
  'desk.reception', 'desk.lab', 'desk.cad', 'desk.standing', 'desk.focus',
  'equipment.oscilloscope', 'equipment.test-bench', 'equipment.3d-printer',
  'equipment.server-rack', 'equipment.analytics-display', 'equipment.graphics-tablet',
  'equipment.espresso-machine', 'equipment.cafe-counter', 'equipment.refrigerator', 'equipment.security-console',
  'equipment.network-rack', 'equipment.archive-shelf', 'equipment.qa-device-wall',
  'equipment.whiteboard-display', 'furniture.pool-table', 'furniture.foosball',
  'furniture.acoustic-focus-pod', 'furniture.whiteboard', 'furniture.cafe-table',
  'furniture.banquette', 'furniture.moodboard', 'furniture.kiosk',
] as const

const ids = new Set<string>(PROCEDURAL_OFFICE_ASSET_IDS)
export function isProceduralOfficeAsset(id: string): boolean { return ids.has(id) }
