import { createDemoEmployees } from "../world";
import type { WorldEmployee } from "../world";
import { createFloorLayout } from "../office-layout";
import type { FloorLayout } from "../office-layout";

export const SHOWROOM_FLOOR_ID = "floor-2";

export const SHOWROOM_COMPOSITION = {
  cameraSide: "south-east",
  brickWallSide: "north",
  windowWallSide: "north",
  loungeSide: "south-west",
  managementSide: "north-east",
  elevatorSide: "south-east",
} as const;

export interface ShowroomSeat {
  readonly employeeId?: string;
  readonly deskId: string;
  readonly x: number;
  readonly z: number;
}

export function showroomEmployees(): readonly WorldEmployee[] {
  return createDemoEmployees().filter(employee => employee.floorId === SHOWROOM_FLOOR_ID);
}

export function showroomSeats(): readonly ShowroomSeat[] {
  const layout = showroomLayout();
  return layout.desks.map(desk => ({
    employeeId: desk.occupiedBy,
    deskId: desk.deskId,
    x: desk.position.x - layout.size.width / 2,
    z: desk.position.z - layout.size.depth / 2,
  }));
}

/** The showroom consumes the public layout engine; employee and desk identities remain authoritative. */
export function showroomLayout(): FloorLayout {
  const employees = showroomEmployees();
  const deskIds = [...employees.map(employee => employee.deskId), `desk-${SHOWROOM_FLOOR_ID}-12`];
  const deskSlots = deskIds.map((deskId, index) => ({
    deskId,
    floorId: SHOWROOM_FLOOR_ID,
    // Keep the management meeting room on the right side of the floor and
    // place the three desk rows in the remaining open-space bay.
    // The management/meeting rooms occupy the lower part of the floor. Keep
    // the desk bay in the clear upper area and leave room for each chair.
    // Keep the twelve authoritative slots in the central bay. The right rear
    // remains available for the glass meeting room and leadership office.
    position: { x: 5.8 + (index % 4) * 2.5, y: 0, z: 2.9 + Math.floor(index / 4) * 3.55 },
    orientation: 0,
  }));
  const layout = createFloorLayout({
    floorId: SHOWROOM_FLOOR_ID,
    size: { width: 22, depth: 14, height: 5.8 },
    deskSlots,
    assignments: employees.map(employee => ({ employeeId: employee.employeeId, deskId: employee.deskId, floorId: SHOWROOM_FLOOR_ID, departmentId: employee.departmentId })),
    room: { profile: "management", meetingRooms: 1, restAreas: 1, serviceZones: 1, groupSize: 4 },
    aisles: { clearance: 0.02, chairDepth: 0.1 },
  });
  // The generic management profile is intentionally rearranged for the
  // approved showroom composition while keeping all desk/employee identities.
  const rooms = layout.rooms.map(room => {
    if (room.kind === "leadership") return { ...room, bounds: { x: 15.2, z: 8.0, width: 5.6, depth: 2.4 } };
    if (room.kind === "meeting") return { ...room, bounds: { x: 15.2, z: 4.5, width: 5.6, depth: 3.2 } };
    if (room.kind === "rest") return { ...room, bounds: { x: .2, z: .15, width: 4.2, depth: 5.1 } };
    return room;
  });
  // Derive the circulation bands from the same actual rows, not the engine's
  // generic generated-grid assumptions for explicit slots.
  const rowZ = [...new Set(layout.desks.map(desk => desk.position.z))].sort((a,b)=>a-b);
  const aisles = [layout.aisles[0], ...rowZ.map((z,index)=>({
    id: `row-${index+1}`, kind: 'desk-row' as const,
    bounds: {x:4.4,z:z+1.55,width:10.2,depth:.8},
  }))];
  return { ...layout, rooms, aisles };
}
