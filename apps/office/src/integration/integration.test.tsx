import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MAOTower, isPremiumFloor } from "./index";
import { makeTowerEmployees, makeTowerFloors, worldToUiFloorId } from "./tower-adapter";
import { createDemoEmployees, FLOOR_METADATA } from "../world";
import { isLegacyRoute, startupMode } from "./route";

describe("MAO Tower integration", () => {
  const employees = createDemoEmployees();

  it("composes OfficeUI and the premium Three.js floor scene into one screen", () => {
    const html = renderToStaticMarkup(<MAOTower />);
    expect(html).toContain('data-active-floor="floor-01"');
    expect(html).toContain("3D showroom: floor 2");
    expect(html).toContain("12 desks · 11 employees · offline showroom");
  });

  it("keeps premium rendering limited to public Floor 02", () => {
    expect(isPremiumFloor("floor-01")).toBe(true);
    expect(isPremiumFloor("floor-00")).toBe(false);
    expect(isPremiumFloor("floor-02")).toBe(false);
  });

  it("keeps the elevator catalog ordered as Lobby, departments, cafe and lounge", () => {
    const floors = makeTowerFloors(employees);
    expect(floors.map(floor => floor.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(floors[0]).toMatchObject({ id: "floor-00", name: "Лобби и ресепшен" });
    expect(floors[12]).toMatchObject({ id: "floor-12", name: "Безопасность и ревью" });
    expect(floors[13]).toMatchObject({ id: "floor-14", name: "Кухня и кафе" });
    expect(floors[14]).toMatchObject({ id: "floor-15", name: "Отдых и переговорные" });
  });

  it("keeps all tower floors and directory assignments in one identity model", () => {
    const floors = makeTowerFloors(employees);
    const uiEmployees = makeTowerEmployees(employees);
    expect(floors).toHaveLength(15);
    expect(uiEmployees).toHaveLength(113);
    expect(new Set(uiEmployees.map(employee => employee.id)).size).toBe(113);
    expect(floors.map(floor => floor.id)).toEqual(FLOOR_METADATA.map(floor => worldToUiFloorId(floor.id)));
    expect(uiEmployees.every(employee => floors.some(floor => floor.id === employee.floorId))).toBe(true);
  });

  it("does not expose a server token through the offline composition", () => {
    const html = renderToStaticMarkup(<MAOTower />);
    expect(html).not.toMatch(/Bearer|token=|api[_-]?key/i);
  });

  it("routes the root to MAO Tower and preserves explicit legacy modes", () => {
    expect(isLegacyRoute("")).toBe(false);
    expect(startupMode("")).toBe("tower");
    expect(startupMode("?utm_source=chatgpt.com")).toBe("tower");
    expect(startupMode("?world=1")).toBe("tower");
    expect(startupMode("?showroom=1")).toBe("showroom");
    expect(isLegacyRoute("?world=1&sim")).toBe(false);
    expect(startupMode("?world=1&sim")).toBe("tower");
    expect(isLegacyRoute("?legacy")).toBe(true);
    expect(startupMode("?legacy")).toBe("legacy");
    expect(isLegacyRoute("?sim")).toBe(true);
    expect(startupMode("?sim")).toBe("legacy");
    expect(isLegacyRoute("?video")).toBe(true);
    expect(startupMode("?video")).toBe("legacy");
  });

  it("keeps the tower HUD and elevator menu in the new composition", () => {
    const html = renderToStaticMarkup(<MAOTower />);
    expect(html).toContain('class="mao-office-ui ');
    expect(html).toContain('data-startup-screen="mao-tower"');
    expect(html).toContain('data-scene-renderer="three"');
    expect(html).toContain('class="mao-elevator-shell ');
    expect(html).toContain("Руководство и управление проектами");
    expect(html).not.toContain("office-root");
  });
});
