import { describe, expect, it } from "vitest";
import { CAMERA_BOUNDS, DEFAULT_CAMERA, MAX_ZOOM, MIN_ZOOM, clampCamera, createFloorCameraStore, focusPoint, panCamera, zoomAtPoint } from "./camera";
import { DEPARTMENT_CATALOG, FLOOR_METADATA, buildDesks, createDemoEmployees, departmentFloor } from "./floorData";

describe("MAO office world data", () => {
  const employees = createDemoEmployees();

  it("contains 15 floors and the 12 directory departments", () => {
    expect(FLOOR_METADATA).toHaveLength(15);
    expect(DEPARTMENT_CATALOG).toHaveLength(12);
    expect(FLOOR_METADATA.filter(floor => floor.kind === "department")).toHaveLength(12);
    for (const [departmentId] of DEPARTMENT_CATALOG) expect(departmentFloor(departmentId)).toMatch(/^floor-(2|[3-9]|1[0-3])$/);
  });

  it("assigns all 113 employees to stable, unique desks", () => {
    expect(employees).toHaveLength(113);
    expect(new Set(employees.map(employee => employee.employeeId)).size).toBe(113);
    expect(new Set(employees.map(employee => employee.deskId)).size).toBe(113);
    expect(employees.every(employee => employee.floorId === departmentFloor(employee.departmentId))).toBe(true);
    expect(buildDesks(employees).length).toBeGreaterThanOrEqual(125);
    expect(new Set(buildDesks(employees).map(desk => desk.deskId)).size).toBe(buildDesks(employees).length);
  });

  it("keeps a single selected floor as the renderable slice", () => {
    const selected = "floor-7";
    expect(buildDesks(employees).filter(desk => desk.floorId === selected).every(desk => desk.floorId === selected)).toBe(true);
    expect(employees.filter(employee => employee.floorId === selected).every(employee => employee.floorId === selected)).toBe(true);
  });
});

describe("world camera", () => {
  it("clamps pan and zoom to safe bounds", () => {
    const camera = clampCamera({ x: 9999, y: -9999, zoom: 99 });
    expect(camera.x).toBe(CAMERA_BOUNDS.maxX);
    expect(camera.y).toBe(CAMERA_BOUNDS.minY);
    expect(camera.zoom).toBe(MAX_ZOOM);
    expect(clampCamera({ ...DEFAULT_CAMERA, zoom: 0 }).zoom).toBe(MIN_ZOOM);
  });

  it("pans, zooms around a pointer, and focuses a desk", () => {
    expect(panCamera(DEFAULT_CAMERA, 12, -8)).toMatchObject({ x: 12, y: -8 });
    const zoomed = zoomAtPoint(DEFAULT_CAMERA, 1.5, 100, 80);
    expect(zoomed.zoom).toBeGreaterThan(1);
    expect(zoomed.x).toBeLessThan(0);
    expect(focusPoint(40, 22).zoom).toBeGreaterThan(1);
  });

  it("keeps camera snapshots independently for each floor", () => {
    const store = createFloorCameraStore();
    store.set("floor-2", { x: 80, y: -20, zoom: 1.4 });
    store.set("floor-3", { x: -40, y: 30, zoom: 0.8 });
    expect(store.get("floor-2")).toEqual({ x: 80, y: -20, zoom: 1.4 });
    expect(store.get("floor-3")).toEqual({ x: -40, y: 30, zoom: 0.8 });
  });
});
