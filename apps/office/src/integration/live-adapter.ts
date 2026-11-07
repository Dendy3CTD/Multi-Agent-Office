import type { OfficeEmployee, OfficeFloor } from "../office-ui";
import { departmentFloor, FLOOR_METADATA } from "../world";
import type { WorldEmployee } from "../world";
import type { LiveEmployeeDTO } from "../live";
import { worldToUiFloorId } from "./tower-adapter";

function hashId(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 8;
}

function liveFloorToWorld(employee: Pick<OfficeEmployee, "departmentId" | "floorId">): string {
  const fromDepartment = departmentFloor(employee.departmentId);
  if (fromDepartment) return fromDepartment;
  if (employee.floorId === "floor-00") return "floor-1";
  if (/^floor-(14|15)$/.test(employee.floorId)) return employee.floorId;
  return FLOOR_METADATA.find(floor => floor.id === employee.floorId)?.id ?? "floor-1";
}

/** Converts the live OfficeUI snapshot into the world identity/coordinate model. */
export function worldEmployeesFromLive(records: readonly OfficeEmployee[]): WorldEmployee[] {
  const counters = new Map<string, number>();
  const usedDesks = new Set<string>();
  return records.map(record => {
    const floorId = liveFloorToWorld(record);
    const index = counters.get(floorId) ?? 0;
    counters.set(floorId, index + 1);
    const requestedDesk = record.seatId?.trim();
    const baseDesk = requestedDesk ? `desk-${requestedDesk}` : `desk-${floorId}-${String(index + 1).padStart(2, "0")}`;
    const deskId = usedDesks.has(baseDesk) ? `desk-${floorId}-${String(index + 1).padStart(2, "0")}` : baseDesk;
    usedDesks.add(deskId);
    const status: WorldEmployee["status"] = record.status === "working" ? "working" : record.status === "blocked" || record.status === "waiting" ? "blocked" : record.status === "offline" || record.status === "disabled" ? "offline" : "idle";
    return {
      employeeId: record.id,
      displayName: record.name,
      departmentId: record.departmentId,
      professionId: record.professionId ?? record.profession,
      floorId,
      deskId,
      x: 2 + (index % 5) * 2.7,
      y: 2 + Math.floor(index / 5) * 4.2,
      active: status !== "offline",
      status,
      characterVariant: hashId(record.id),
    };
  });
}

/** Remaps live floor IDs to the UI's public tower IDs without mutating the snapshot. */
export function officeEmployeesWithTowerFloorIds(records: readonly OfficeEmployee[]): OfficeEmployee[] {
  return records.map(record => ({ ...record, floorId: worldToUiFloorId(liveFloorToWorld(record)) }));
}

export function liveFloorsByTowerId(floors: readonly OfficeFloor[]): ReadonlyMap<string, OfficeFloor> {
  return new Map(floors.map(floor => [worldToUiFloorId(liveFloorToWorld({ departmentId: floor.departmentId, floorId: floor.id })), floor]));
}

export type { LiveEmployeeDTO };
