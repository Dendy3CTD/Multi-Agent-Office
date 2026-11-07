import type { OfficeEmployee, OfficeFloor } from "../office-ui";
import { FLOOR_METADATA } from "../world";
import type { FloorMetadata, WorldEmployee } from "../world";

const specialDepartment: Record<string, string> = { "floor-1": "lobby", "floor-14": "cafe", "floor-15": "rest" };

export function worldToUiFloorId(worldFloorId: string): string {
  const number = Number(worldFloorId.replace("floor-", ""));
  if (number === 1) return "floor-00";
  if (number >= 2 && number <= 13) return `floor-${String(number - 1).padStart(2, "0")}`;
  return `floor-${String(number).padStart(2, "0")}`;
}

export function uiToWorldFloorId(uiFloorId: string): string {
  const number = Number(uiFloorId.replace("floor-", ""));
  if (number === 0) return "floor-1";
  if (number >= 1 && number <= 12) return `floor-${number + 1}`;
  return `floor-${number}`;
}

export function toOfficeEmployee(employee: WorldEmployee): OfficeEmployee {
  const status: OfficeEmployee["status"] = employee.status === "blocked" ? "waiting" : employee.status === "offline" ? "offline" : employee.status;
  return { id: employee.employeeId, name: employee.displayName, profession: employee.professionId, professionId: employee.professionId, departmentId: employee.departmentId, floorId: worldToUiFloorId(employee.floorId), status, seatId: employee.deskId };
}

export function toOfficeFloor(floor: FloorMetadata, employees: readonly WorldEmployee[]): OfficeFloor {
  const floorEmployees = employees.filter(employee => employee.floorId === floor.id);
  const occupiedSeats = floorEmployees.filter(employee => employee.status !== "offline").length;
  return {
    id: worldToUiFloorId(floor.id),
    number: floor.number,
    departmentId: floor.departmentId ?? specialDepartment[floor.id] ?? floor.id,
    name: floor.title,
    employeeCount: floorEmployees.length,
    occupiedSeats,
    availableSeats: Math.max(0, floor.seatCount - occupiedSeats),
    state: floorEmployees.some(employee => employee.status === "working") ? "busy" : floorEmployees.length ? "active" : "quiet",
  };
}

export function makeTowerFloors(employees: readonly WorldEmployee[], liveFloors?: readonly OfficeFloor[]): OfficeFloor[] {
  const liveByDepartment = new Map((liveFloors ?? []).map(floor => [floor.departmentId, floor]));
  return FLOOR_METADATA.map(floor => {
    const base = toOfficeFloor(floor, employees);
    const live = liveByDepartment.get(floor.departmentId ?? "");
    return live ? { ...base, name: live.name, state: live.state, kind: live.kind, icon: live.icon } : base;
  });
}

export function makeTowerEmployees(employees: readonly WorldEmployee[]): OfficeEmployee[] {
  return employees.map(toOfficeEmployee);
}
