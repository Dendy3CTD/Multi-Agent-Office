/** Office V4 reference numbering is zero-offset from the public tower route. */
export interface OfficeV4FloorReference {
  readonly uiNumber: number
  readonly logicalFloorId: string
  readonly worldFloorId: string
  readonly specialization: string
  readonly referenceFile: string
}

const specializations = [
  'lobby-reception', 'management', 'software-development', 'quality-assurance',
  'engineering-electronics', 'cad-3d', 'research-analytics', 'documentation',
  'design', 'finance-estimates', 'devops', 'automation-integrations',
  'security-review', 'kitchen-cafe', 'lounge-meeting-rooms',
] as const

export const OFFICE_V4_FLOOR_REFERENCES: readonly OfficeV4FloorReference[] = specializations.map((specialization, index) => {
  const logicalNumber = index
  const worldNumber = index + 1
  return {
    uiNumber: index + 1,
    logicalFloorId: `floor-${String(logicalNumber).padStart(2, '0')}`,
    worldFloorId: `floor-${worldNumber}`,
    specialization,
    referenceFile: `floor-${String(index + 1).padStart(2, '0')}.png`,
  }
})

const officeV4LogicalIds = new Map(OFFICE_V4_FLOOR_REFERENCES.map(entry => [entry.logicalFloorId, entry.worldFloorId]))
const officeV4WorldIds = new Map(OFFICE_V4_FLOOR_REFERENCES.map(entry => [entry.worldFloorId, entry.logicalFloorId]))

/** Explicitly convert an Office V4 logical ID. Do not use this for current world IDs. */
export function officeV4ToWorldFloorId(floorId: string): string {
  return officeV4LogicalIds.get(floorId) ?? floorId
}

export function worldToOfficeV4FloorId(floorId: string): string | undefined {
  return officeV4WorldIds.get(floorId)
}

export function officeV4ReferenceForWorldFloor(floorId: string): OfficeV4FloorReference | undefined {
  return OFFICE_V4_FLOOR_REFERENCES.find(entry => entry.worldFloorId === floorId)
}
