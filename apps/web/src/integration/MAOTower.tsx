import { useCallback, useEffect, useMemo, useState } from "react";
import { OfficeUI, type OfficeCameraAction } from "../office-ui";
import { useLiveOfficeData, confirmedSceneStatesForConnection } from "../live";
import { OfficeScene, createDemoEmployees, FLOOR_METADATA, type SceneCameraAction, type WorldEmployee } from "../world";
import { employeeExecutionStatus, officeEmployeesWithTowerFloorIds, worldEmployeesFromLive } from "./live-adapter";
import { makeTowerEmployees, makeTowerFloors, uiToWorldFloorId, worldToUiFloorId } from "./tower-adapter";
import PremiumFloorScene from "./PremiumFloorScene";
import { traceTower } from "./diagnostics";
import { SHOWROOM_FLOOR_ID, showroomLayout } from "../office-3d/scene-data";
import type { LiveOfficeData } from "../live/types";

// Reuse empty UI collections without freezing future live/supplied snapshots.
const EMPTY_ITEMS: never[] = [];

/** Department floors use the preserved premium 3D renderer; lobby/cafe/lounge keep their authored room scene. */
export function isPremiumFloor(floorId: string): boolean {
  return /^floor-(0[1-9]|1[0-2])$/.test(floorId);
}

export interface MAOTowerProps {
  employees?: readonly ReturnType<typeof createDemoEmployees>[number][];
  /** Fixture is opt-in and never talks to the live task endpoints. */
  fixtureMode?: boolean;
  onToggleFixture?: () => void;
  liveState?: ReturnType<typeof useLiveOfficeData>;
}

function fixtureSnapshot(worldEmployees: readonly WorldEmployee[]): LiveOfficeData {
  const employees = makeTowerEmployees(worldEmployees);
  return {
    departments: FLOOR_METADATA.filter(floor => floor.departmentId).map(floor => ({ id: floor.departmentId!, name: floor.title })),
    professions: [], employees, floors: makeTowerFloors(worldEmployees), projects: [], tasks: [], events: [],
    runtimeStatus: { label: "DEVELOPMENT FIXTURE · Codex не подключён", available: false, kind: "fake", blockers: ["fixture_mode"] },
    budgetStatus: { label: "Fixture · бюджет не загружен" }, agentRoles: [], queueTasks: [], activeWorkers: [], queuePlans: [], queueAvailability: "unavailable",
    resourceData: { runtimes: [], models: [], allowanceLabel: "Fixture · нет данных", runningProcessCount: undefined, maxActiveLlm: 2 },
  };
}

function employeesOnFloor(source: readonly WorldEmployee[], uiFloorId: string): WorldEmployee[] {
  const worldFloorId = uiToWorldFloorId(uiFloorId);
  const rendererDesks = showroomLayout().desks;
  return source.filter(employee => employee.floorId === worldFloorId).map((employee, index) => ({
    ...employee,
    floorId: SHOWROOM_FLOOR_ID,
    deskId: rendererDesks[index]?.deskId ?? `desk-${SHOWROOM_FLOOR_ID}-reserve-${index}`,
  }));
}

export default function MAOTower({ employees: suppliedEmployees, fixtureMode = false, onToggleFixture, liveState: suppliedLiveState }: MAOTowerProps) {
  // Preserve IDs and desk assignments across ordinary state updates.
  const demoSnapshot = useMemo(() => createDemoEmployees(), []);
  const demoEmployees = suppliedEmployees ?? demoSnapshot;
  const fixtureData = useMemo(() => fixtureMode ? fixtureSnapshot(demoEmployees) : undefined, [fixtureMode, demoEmployees]);
  const liveOptions = useMemo(() => ({ demoData: fixtureData }), [fixtureData]);
  const internalLiveState = useLiveOfficeData(liveOptions);
  const liveState = suppliedLiveState ?? internalLiveState;
  const hasLiveSnapshot = !fixtureMode && (liveState.dataMode === 'live' || liveState.dataMode === 'stale');
  const employees = useMemo(() => hasLiveSnapshot ? worldEmployeesFromLive(liveState.employees) : fixtureMode ? demoEmployees : [], [demoEmployees, fixtureMode, hasLiveSnapshot, liveState.employees]);
  const officeEmployees = useMemo(() => hasLiveSnapshot
    ? officeEmployeesWithTowerFloorIds(liveState.employees).map(employee => ({ ...employee, executionStatus: employeeExecutionStatus(employee, liveState.queueTasks, liveState.dataMode) }))
    : fixtureMode ? makeTowerEmployees(employees) : [], [employees, fixtureMode, hasLiveSnapshot, liveState.dataMode, liveState.employees, liveState.queueTasks]);
  const floors = useMemo(() => makeTowerFloors(employees, hasLiveSnapshot ? liveState.floors : undefined), [employees, hasLiveSnapshot, liveState.floors]);
  const [activeFloorId, setActiveFloorId] = useState("floor-01");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>();
  const [cameraAction, setCameraAction] = useState<SceneCameraAction>();
  const sceneEmployees = useMemo(() => isPremiumFloor(activeFloorId) ? employeesOnFloor(employees, activeFloorId) : employees, [employees, activeFloorId]);

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

  const createTask = useCallback(async () => {
    throw new Error(fixtureMode ? 'development_fixture_is_read_only' : 'mao_hybrid_api_contract_pending');
  }, [fixtureMode]);
  const cancelTask = useCallback(async (taskId: string) => {
    void taskId;
    throw new Error(fixtureMode ? 'development_fixture_is_read_only' : 'mao_hybrid_api_contract_pending');
  }, [fixtureMode]);

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
    ? <PremiumFloorScene employees={sceneEmployees} confirmedEmployeeStates={confirmedSceneStatesForConnection(liveState.employees, liveState.dataMode)} selectedEmployeeId={selectedEmployeeId} onEmployeeSelect={selectEmployee} onElevatorClick={openPhysicalElevator} cameraAction={cameraAction && cameraAction.type !== "focus-employee" ? cameraAction.type : undefined} />
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
    runtimeStatus={hasLiveSnapshot ? liveState.runtimeStatus : fixtureMode ? fixtureData?.runtimeStatus ?? { label: 'DEVELOPMENT FIXTURE', available: false } : { label: 'MAO Hybrid backend · NOT CONNECTED', available: false, kind: "unknown", blockers: ['shared_api_contract_pending'] }}
    budgetStatus={hasLiveSnapshot ? liveState.budgetStatus : { label: "Budget status unavailable", status: "unknown", allowanceStatus: "unknown" }}
    resourceData={hasLiveSnapshot ? liveState.resourceData : { runtimes: [], models: [], allowanceLabel: 'Нет данных', maxActiveLlm: 2 }}
    events={hasLiveSnapshot ? liveState.events : EMPTY_ITEMS}
    onCameraAction={camera}
    elevatorRequest={elevatorRequest}
    onLocateEmployee={locateEmployee}
    connection={fixtureMode ? 'demo' : liveState.dataMode === 'live' ? 'live' : liveState.dataMode}
    connectionError={fixtureMode ? undefined : liveState.error}
    pendingFigmaCount={0}
    agentRoles={hasLiveSnapshot ? liveState.agentRoles : EMPTY_ITEMS}
    queueTasks={hasLiveSnapshot ? liveState.queueTasks : EMPTY_ITEMS}
    activeWorkers={hasLiveSnapshot ? liveState.activeWorkers : EMPTY_ITEMS}
    queuePlans={hasLiveSnapshot ? liveState.queuePlans : EMPTY_ITEMS}
    queueAvailability={hasLiveSnapshot ? liveState.queueAvailability : 'unavailable'}
    onCreateTask={createTask}
    onCancelTask={cancelTask}
    tasksReadOnly
    taskSubmissionEnabled={false}
    fixtureMode={fixtureMode}
    onToggleFixture={onToggleFixture}
    onRefresh={liveState.refresh}
    sceneKind={sceneKind}
    scene={scene}
  />;
}
