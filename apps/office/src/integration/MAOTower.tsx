import { useCallback, useEffect, useMemo, useState } from "react";
import { OfficeUI, type OfficeCameraAction } from "../office-ui";
import { useLiveOfficeData, type LiveTransport } from "../live";
import { OfficeScene, createDemoEmployees, type SceneCameraAction } from "../world";
import { officeEmployeesWithTowerFloorIds, worldEmployeesFromLive } from "./live-adapter";
import { makeTowerEmployees, makeTowerFloors, uiToWorldFloorId, worldToUiFloorId } from "./tower-adapter";
import PremiumFloorScene from "./PremiumFloorScene";
import { traceTower } from "./diagnostics";

// Reuse empty UI collections without freezing future live/supplied snapshots.
const EMPTY_ITEMS: never[] = [];

/** UI floor 01 is the public Floor 02 (Lobby is UI floor 00). */
export function isPremiumFloor(floorId: string): boolean {
  return floorId === "floor-01";
}

export interface MAOTowerProps {
  employees?: readonly ReturnType<typeof createDemoEmployees>[number][];
  /** Trusted host injection point. No browser storage, env or URL token is read here. */
  liveTransport?: LiveTransport;
}

export default function MAOTower({ employees: suppliedEmployees, liveTransport }: MAOTowerProps) {
  // Preserve IDs and desk assignments across ordinary state updates.
  const demoSnapshot = useMemo(() => createDemoEmployees(), []);
  const demoEmployees = suppliedEmployees ?? demoSnapshot;
  const liveOptions = useMemo(() => ({ transport: liveTransport }), [liveTransport]);
  const liveState = useLiveOfficeData(liveOptions);
  const hasLiveSnapshot = Boolean(liveTransport && ['live', 'stale'].includes(liveState.dataMode) && liveState.employees.length);
  const employees = useMemo(() => hasLiveSnapshot ? worldEmployeesFromLive(liveState.employees) : demoEmployees, [demoEmployees, hasLiveSnapshot, liveState.employees]);
  const officeEmployees = useMemo(() => hasLiveSnapshot ? officeEmployeesWithTowerFloorIds(liveState.employees) : makeTowerEmployees(employees), [employees, hasLiveSnapshot, liveState.employees]);
  const floors = useMemo(() => makeTowerFloors(employees, hasLiveSnapshot ? liveState.floors : undefined), [employees, hasLiveSnapshot, liveState.floors]);
  const [activeFloorId, setActiveFloorId] = useState("floor-01");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>();
  const [cameraAction, setCameraAction] = useState<SceneCameraAction>();

  const selectFloor = useCallback((floorId: string) => {
    if (!floors.some(floor => floor.id === floorId)) return;
    setActiveFloorId(floorId);
    setCameraAction(undefined);
    if (selectedEmployeeId && !employees.some(employee => employee.employeeId === selectedEmployeeId && worldToUiFloorId(employee.floorId) === floorId)) setSelectedEmployeeId(undefined);
  }, [floors, selectedEmployeeId, employees]);
  const selectEmployee = useCallback((employeeId: string) => {
    const employee = employees.find(item => item.employeeId === employeeId);
    if (!employee) return;
    setActiveFloorId(worldToUiFloorId(employee.floorId));
    setSelectedEmployeeId(employeeId);
  }, [employees]);
  const camera = useCallback((action: OfficeCameraAction) => setCameraAction({ type: action.type, employeeId: action.employeeId }), []);
  const locateEmployee = (employeeId: string, requestedFloorId: string) => {
    const employee = employees.find(item => item.employeeId === employeeId);
    if (!employee) return;
    const floorId = worldToUiFloorId(employee.floorId);
    setActiveFloorId(floorId || requestedFloorId);
    setSelectedEmployeeId(employeeId);
    setCameraAction({ type: "focus-employee", employeeId });
  };

  const [elevatorRequest, setElevatorRequest] = useState(0);
  const openPhysicalElevator = useCallback(() => {
    traceTower("elevator-request");
    setElevatorRequest(value => value + 1);
  }, []);
  const closeEmployee = useCallback(() => setSelectedEmployeeId(undefined), []);

  useEffect(() => {
    traceTower("tower-mount");
    return () => traceTower("tower-unmount");
  }, []);
  useEffect(() => {
    traceTower("employee-snapshot", { count: employees.length });
  }, [employees]);

  useEffect(() => {
    traceTower("active-floor", { floorId: activeFloorId, renderer: isPremiumFloor(activeFloorId) ? "three" : "svg" });
  }, [activeFloorId]);

  const scene = isPremiumFloor(activeFloorId)
    ? <PremiumFloorScene employees={employees} selectedEmployeeId={selectedEmployeeId} onEmployeeSelect={selectEmployee} onElevatorClick={openPhysicalElevator} cameraAction={cameraAction && cameraAction.type !== "focus-employee" ? cameraAction.type : undefined} />
    : <OfficeScene floorId={uiToWorldFloorId(activeFloorId)} employees={employees} selectedEmployeeId={selectedEmployeeId} onEmployeeSelect={selectEmployee} cameraAction={cameraAction} />;
  const sceneKind = isPremiumFloor(activeFloorId) ? "three" : "svg" as const;

  return <OfficeUI
    floors={floors}
    activeFloorId={activeFloorId}
    onFloorSelect={selectFloor}
    employees={officeEmployees}
    selectedEmployeeId={selectedEmployeeId}
    onEmployeeSelect={selectEmployee}
    onCloseEmployee={closeEmployee}
    projects={hasLiveSnapshot ? liveState.projects : EMPTY_ITEMS}
    currentTasks={hasLiveSnapshot ? liveState.tasks : EMPTY_ITEMS}
    runtimeStatus={hasLiveSnapshot ? liveState.runtimeStatus : { label: liveTransport ? `Live: ${liveState.dataMode}` : "Offline preview", available: false, kind: "fake", blockers: liveTransport ? [liveState.error ?? "live_data_loading"] : ["server_not_connected"] }}
    budgetStatus={hasLiveSnapshot ? liveState.budgetStatus : { label: liveTransport ? "Budget status loading" : "offline preview", status: "unknown", allowanceStatus: "unknown" }}
    events={hasLiveSnapshot ? liveState.events : EMPTY_ITEMS}
    onCameraAction={camera}
    elevatorRequest={elevatorRequest}
    onLocateEmployee={locateEmployee}
    sceneKind={sceneKind}
    scene={scene}
  />;
}
