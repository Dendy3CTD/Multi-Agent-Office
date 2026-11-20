import type { DeskObject, FloorMetadata, WorldEmployee } from "./types";

const departments = [
  ["management", "Руководство и управление проектами", "sand"],
  ["software-development", "Разработка ПО", "blue"],
  ["quality-assurance", "Тестирование и контроль качества", "sage"],
  ["engineering-electronics", "Инженерия и электроника", "terracotta"],
  ["cad-3d", "CAD и 3D", "violet"],
  ["research-analytics", "Исследования и аналитика", "blue"],
  ["documentation", "Документация", "sand"],
  ["design", "Дизайн", "terracotta"],
  ["finance-estimates", "Финансы и сметы", "sage"],
  ["devops", "DevOps", "violet"],
  ["automation-integrations", "Автоматизация и интеграции", "blue"],
  ["security-review", "Безопасность и ревью", "sand"],
] as const;

const floorForDepartment: ReadonlyMap<string, string> = new Map(departments.map(([id], index): [string, string] => [id, `floor-${index + 2}`]));
const professionDepartments: Readonly<Record<string, string>> = {
  director: "management", "project-manager": "management", "backend-developer": "software-development", "frontend-developer": "software-development", "python-developer": "software-development",
  developer: "software-development", "qa-engineer": "quality-assurance", "embedded-developer": "engineering-electronics", "electronics-engineer": "engineering-electronics", engineer: "engineering-electronics",
  "cad-engineer": "cad-3d", "research-analyst": "research-analytics", analyst: "research-analytics", "technical-writer": "documentation", designer: "design", "cost-estimator": "finance-estimates",
  "devops-engineer": "devops", "integration-engineer": "automation-integrations", "security-reviewer": "security-review", assistant: "management",
};

export const FLOOR_METADATA: readonly FloorMetadata[] = [
  { id: "floor-1", number: 1, title: "Лобби и ресепшен", seatCount: 2, occupiedCount: 0, kind: "lobby", palette: "sand", decorAsset: "/floors/lobby-windows.svg" },
  ...departments.map(([departmentId, title, palette], index) => ({ id: `floor-${index + 2}`, number: index + 2, title, departmentId, seatCount: index === 0 ? 12 : index === 1 || index === 2 ? 11 : 10, occupiedCount: 0, kind: "department" as const, palette })),
  { id: "floor-14", number: 14, title: "Кухня и кафе", seatCount: 2, occupiedCount: 0, kind: "cafe", palette: "cafe", decorAsset: "/floors/cafe-wall.svg" },
  { id: "floor-15", number: 15, title: "Отдых и переговорные", seatCount: 4, occupiedCount: 0, kind: "rest", palette: "lounge", decorAsset: "/floors/lounge-wall.svg" },
];

const names = ["Алексей Орлов", "Борис Соколов", "Вера Волкова", "Галина Миронова", "Денис Кузнецов", "Елена Белова", "Илья Романов", "Кира Петрова", "Лев Смирнов", "Мария Лебедева", "Никита Федоров", "Жанна Иванова"];

/** Explicitly synthetic offline preview data. Server/API data can replace it. */
export function createDemoEmployees(): readonly WorldEmployee[] {
  const result: WorldEmployee[] = [];
  let number = 0;
  for (const [departmentId] of departments) {
    const floorId = floorForDepartment.get(departmentId)!;
    for (let i = 0; i < 9; i += 1) {
      number += 1;
      result.push({ employeeId: `employee-${String(number).padStart(3, "0")}`, displayName: `${names[number % names.length]} #${number}`, departmentId, professionId: "specialist", floorId, deskId: `desk-${floorId}-${String(i + 1).padStart(2, "0")}`, x: 2 + (i % 5) * 2.7, y: 2 + Math.floor(i / 5) * 4.2, active: true, status: i % 5 === 0 ? "idle" : "working", characterVariant: number % 8 });
    }
  }
  const extras: Array<[string, string, string]> = [["employee-director", "director", "management"], ["employee-developer", "developer", "software-development"], ["employee-engineer", "engineer", "engineering-electronics"], ["employee-analyst", "analyst", "research-analytics"], ["employee-helper", "assistant", "management"]];
  for (const [employeeId, professionId, departmentId] of extras) { const floorId = floorForDepartment.get(departmentId)!; const index = result.filter(employee => employee.floorId === floorId).length; result.push({ employeeId, displayName: `${professionId} (offline)`, departmentId, professionId, floorId, deskId: `desk-${floorId}-${String(index + 1).padStart(2, "0")}`, x: 2 + (index % 5) * 2.7, y: 2 + Math.floor(index / 5) * 4.2, active: true, status: "working", characterVariant: (number + index) % 8 }); }
  return result;
}

export function buildDesks(employees: readonly WorldEmployee[]): readonly DeskObject[] {
  const desks: DeskObject[] = [];
  for (const floor of FLOOR_METADATA) {
    const count = floor.seatCount;
    const occupants = employees.filter(employee => employee.floorId === floor.id);
    for (let i = 0; i < count; i += 1) {
      const occupant = occupants[i];
      desks.push({ deskId: occupant?.deskId ?? `desk-${floor.id}-${String(i + 1).padStart(2, "0")}`, floorId: floor.id, x: occupant?.x ?? 2 + (i % 5) * 2.7, y: occupant?.y ?? 2 + Math.floor(i / 5) * 4.2, occupiedBy: occupant?.employeeId, zone: floor.kind === "cafe" ? "kitchen" : floor.kind === "rest" ? "lounge" : floor.kind === "lobby" ? "reception" : "desk" });
    }
  }
  return desks;
}

export function withOccupancy(employees: readonly WorldEmployee[]): readonly FloorMetadata[] { return FLOOR_METADATA.map(floor => ({ ...floor, occupiedCount: employees.filter(employee => employee.floorId === floor.id).length })); }

export function departmentFloor(departmentId: string): string | undefined { return floorForDepartment.get(departmentId); }
export { departments as DEPARTMENT_CATALOG };
