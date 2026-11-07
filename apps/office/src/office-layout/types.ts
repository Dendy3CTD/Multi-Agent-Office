/** Layout coordinates use metres: X/Z are floor-plane axes and Y is height. */
export interface LayoutPoint {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface FloorSize {
  readonly width: number
  readonly depth: number
  readonly height?: number
  readonly origin?: LayoutPoint
}

export type FloorProfile =
  | 'open-space'
  | 'management'
  | 'engineering'
  | 'research'
  | 'design'
  | 'infrastructure'
  | 'archive'
  | 'lobby'
  | 'kitchen'
  | 'lounge'

export interface EmployeeAssignment {
  readonly employeeId: string
  readonly deskId: string
  readonly floorId: string
  readonly departmentId?: string
}

export interface DeskSlot {
  readonly deskId: string
  readonly floorId: string
  readonly position?: LayoutPoint
  readonly orientation?: number
  readonly reserved?: boolean
  readonly zone?: 'desk' | 'meeting' | 'kitchen' | 'lounge' | 'reception'
}

export interface RoomConfiguration {
  readonly profile: FloorProfile
  readonly meetingRooms?: number
  readonly restAreas?: number
  readonly serviceZones?: number
  readonly groupSize?: number
}

export interface AisleParameters {
  readonly deskWidth?: number
  readonly deskDepth?: number
  readonly chairWidth?: number
  readonly chairDepth?: number
  readonly rowGap?: number
  readonly columnGap?: number
  readonly roomGap?: number
  readonly clearance?: number
  readonly edgePadding?: number
}

export interface LayoutRect {
  readonly x: number
  readonly z: number
  readonly width: number
  readonly depth: number
}

export interface LayoutDesk {
  readonly deskId: string
  readonly floorId: string
  readonly position: LayoutPoint
  readonly orientation: number
  readonly bounds: LayoutRect
  readonly groupId: string
  readonly reserved: boolean
  readonly zone: 'desk' | 'meeting' | 'kitchen' | 'lounge' | 'reception'
  readonly occupiedBy?: string
}

export interface LayoutChair {
  readonly deskId: string
  readonly position: LayoutPoint
  readonly orientation: number
  readonly bounds: LayoutRect
}

export interface LayoutCharacterSpot {
  readonly employeeId: string
  readonly deskId: string
  readonly position: LayoutPoint
  readonly orientation: number
}

export interface LayoutAisle {
  readonly id: string
  readonly bounds: LayoutRect
  readonly kind: 'main' | 'desk-row' | 'entry'
}

export interface LayoutRoom {
  readonly id: string
  readonly kind: 'meeting' | 'rest' | 'leadership' | 'service' | 'reception' | 'kitchen' | 'archive'
  readonly privacy?: 'glass' | 'solid' | 'open'
  readonly bounds: LayoutRect
}

export interface LayoutWall {
  readonly id: string
  readonly bounds: LayoutRect
  readonly height: number
  readonly side: 'north' | 'south' | 'east' | 'west' | 'partition'
}

export interface LayoutDoor {
  readonly id: string
  readonly wallId: string
  readonly position: LayoutPoint
  readonly bounds: LayoutRect
}

export interface LayoutWindow {
  readonly id: string
  readonly wallId: string
  readonly position: LayoutPoint
  readonly bounds: LayoutRect
}

export interface LayoutPlant {
  readonly id: string
  readonly position: LayoutPoint
  readonly bounds: LayoutRect
}

export interface FloorLayout {
  readonly floorId: string
  readonly profile: FloorProfile
  readonly size: FloorSize
  readonly bounds: LayoutRect
  readonly floorBounds: LayoutRect
  readonly desks: readonly LayoutDesk[]
  readonly chairs: readonly LayoutChair[]
  readonly characterSpots: readonly LayoutCharacterSpot[]
  readonly rooms: readonly LayoutRoom[]
  readonly aisles: readonly LayoutAisle[]
  readonly entryPoints: readonly LayoutPoint[]
  readonly serviceZones: readonly LayoutRoom[]
  readonly walls: readonly LayoutWall[]
  readonly doors: readonly LayoutDoor[]
  readonly windows: readonly LayoutWindow[]
  readonly plants: readonly LayoutPlant[]
  readonly partitions: readonly LayoutWall[]
  readonly camera: { readonly position: LayoutPoint; readonly target: LayoutPoint }
  readonly focusTarget: LayoutPoint
  readonly collisionBounds: readonly LayoutRect[]
}

export interface FloorLayoutInput {
  readonly floorId: string
  readonly size: FloorSize
  readonly assignments: readonly EmployeeAssignment[]
  readonly deskSlots: readonly DeskSlot[]
  readonly room?: Partial<RoomConfiguration>
  readonly aisles?: AisleParameters
  readonly seed?: number
}

export interface OfficeFloorSource {
  readonly floorId: string
  readonly profile: FloorProfile
  readonly size: FloorSize
  readonly departmentId?: string
  readonly meetingRooms?: number
  readonly restAreas?: number
  readonly serviceZones?: number
  readonly groupSize?: number
}

export interface OfficeLayoutSource {
  readonly floors: readonly OfficeFloorSource[]
  readonly employees: readonly EmployeeAssignment[]
  readonly deskSlots: readonly DeskSlot[]
  readonly departmentIds: readonly string[]
  readonly aisles?: AisleParameters
}

export interface OfficeLayoutCollection {
  readonly layouts: ReadonlyMap<string, FloorLayout>
  readonly employees: number
  readonly desks: number
  readonly floors: number
}

export interface LayoutValidationIssue {
  readonly code: string
  readonly message: string
  readonly subject?: string
}

export interface FloorLayoutValidation {
  readonly valid: boolean
  readonly issues: readonly LayoutValidationIssue[]
}

export class FloorLayoutError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'FloorLayoutError'
    this.code = code
  }
}
