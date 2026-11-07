import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ART_SOURCE_ROTATION_X, artPlacementScale, canRenderSceneFrame, CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN, clampSceneZoom, interactiveAncestor, isElevatorOwner, manifestKey, normalizeWheelDelta, pointerNdc } from "./OfficeScene3D";
import { SHOWROOM_FLOOR_ID, showroomEmployees, showroomLayout, showroomSeats } from "./scene-data";
import { validateFloorLayout } from "../office-layout";

describe("3D floor showroom data", () => {
  it("uses the real floor-2 identities and unique desk assignments", () => {
    const employees = showroomEmployees();
    const seats = showroomSeats();
    expect(SHOWROOM_FLOOR_ID).toBe("floor-2");
    expect(employees).toHaveLength(11);
    expect(seats).toHaveLength(12);
    expect(new Set(seats.map(seat => seat.deskId)).size).toBe(12);
    expect(seats.filter(seat => seat.employeeId)).toHaveLength(11);
    const layout = showroomLayout();
    expect(validateFloorLayout(layout).valid).toBe(true);
    expect(layout.characterSpots).toHaveLength(11);
    expect(new Set(layout.desks.map(desk => desk.deskId)).size).toBe(12);
  });

  it("keeps layout points on the Y-up floor and leaves the reserve slot clear", () => {
    const layout = showroomLayout();
    expect(layout.desks.every(desk => desk.position.y === 0)).toBe(true);
    expect(layout.desks.every(desk => desk.bounds.x >= layout.bounds.x && desk.bounds.x + desk.bounds.width <= layout.bounds.x + layout.bounds.width)).toBe(true);
    expect(layout.desks.filter(desk => desk.occupiedBy)).toHaveLength(11);
    expect(layout.desks.filter(desk => !desk.occupiedBy)).toHaveLength(1);
  });

  it("converts the Z-up art pack once and applies manifest scale once", () => {
    expect(ART_SOURCE_ROTATION_X).toBe(-Math.PI / 2);
    expect(artPlacementScale(1.25, [2, 1, 0.5])).toEqual([2.5, 1.25, 0.625]);
  });

  it("keeps character spots beside their authoritative desk positions", () => {
    const layout = showroomLayout();
    for (const spot of layout.characterSpots) {
      const desk = layout.desks.find(item => item.deskId === spot.deskId);
      expect(desk).toBeDefined();
      expect(Math.abs(spot.position.x - desk!.position.x)).toBeLessThanOrEqual(0.01);
      expect(spot.position.z).toBeGreaterThan(desk!.position.z);
      expect(spot.position.y).toBe(0);
    }
    expect(layout.camera.target.x).toBeGreaterThanOrEqual(layout.bounds.x);
    expect(layout.camera.target.z).toBeGreaterThanOrEqual(layout.bounds.z);
  });

  it("detects the legacy Z-up pack without affecting normalized Y-up assets", async () => {
    const { detectArtSourceRotationX } = await import("./OfficeScene3D");
    const legacy = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 0.1));
    const normalized = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 4));
    expect(detectArtSourceRotationX(legacy)).toBe(ART_SOURCE_ROTATION_X);
    expect(detectArtSourceRotationX(normalized)).toBe(0);
  });

  it("pauses frame activity while hidden or disposed", () => {
    expect(canRenderSceneFrame(false, false)).toBe(true);
    expect(canRenderSceneFrame(true, false)).toBe(false);
    expect(canRenderSceneFrame(false, true)).toBe(false);
  });

  it("normalizes Firefox wheel units and keeps zoom inside camera bounds", () => {
    expect(normalizeWheelDelta({ deltaY: 2, deltaMode: 0 })).toBe(2);
    expect(normalizeWheelDelta({ deltaY: 2, deltaMode: 1 })).toBe(32);
    expect(normalizeWheelDelta({ deltaY: 1, deltaMode: 2 }, 600)).toBe(600);
    expect(clampSceneZoom(0)).toBe(CAMERA_ZOOM_MIN);
    expect(clampSceneZoom(99)).toBe(CAMERA_ZOOM_MAX);
  });

  it("uses canvas-relative pointer coordinates for zoom anchors and picks GLB owners", () => {
    expect(pointerNdc({ clientX: 150, clientY: 75 }, { left: 50, top: 25, width: 200, height: 100 }).toArray()).toEqual([0, 0]);
    const employee = new THREE.Group(); employee.userData.employeeId = "employee-1";
    const decorativeMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); employee.add(decorativeMesh);
    expect(interactiveAncestor(decorativeMesh)).toBe(employee);
    const elevator = new THREE.Group(); elevator.userData.interactive = "elevator";
    const hitArea = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); elevator.add(hitArea);
    expect(interactiveAncestor(hitArea)).toBe(elevator);
    expect(isElevatorOwner(interactiveAncestor(hitArea))).toBe(true);
    const employeeMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); employeeMesh.userData.employeeId = "employee-1";
    expect(isElevatorOwner(interactiveAncestor(employeeMesh))).toBe(false);
  });
});


describe("manifest content identity", () => {
  it("normalizes equivalent records and default URLs", () => {
    expect(manifestKey()).toBe(manifestKey({ manifestUrl: "/office-art/v1/manifest.json" }));
    expect(manifestKey({ models: { a: "1", b: "2" } })).toBe(manifestKey({ models: { b: "2", a: "1" } }));
    expect(manifestKey({ manifestUrl: "/new.json" })).not.toBe(manifestKey());
  });
});
