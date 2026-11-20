import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import PremiumFloorScene from '../../integration/PremiumFloorScene';
import { showroomEmployees } from '../scene-data';
import { confirmedSceneStatesForConnection, type EmployeeLiveStatus } from '../../live/employeeLiveState';
import type { EmployeeTaskState } from './status-adapter';

const employees = showroomEmployees();
let setConfirmedStates: (states: readonly EmployeeTaskState[]) => void = () => {};
type Connection = 'live' | 'stale' | 'disconnected';
interface ProjectedSnapshot { connection: Connection; statuses: ReadonlyMap<string, EmployeeLiveStatus> }
let setProjectedSnapshot: Dispatch<SetStateAction<ProjectedSnapshot | undefined>> = () => {};
let lifecycle: { released: boolean; geometries: number; textures: number } | undefined;
const root = createRoot(document.getElementById('root')!);

function inspect() {
  let snapshot: any;
  document.querySelector('.office-scene-3d-mount')?.dispatchEvent(new CustomEvent('mao-3d-inspect', { detail: (value: unknown) => { snapshot = value; } }));
  return snapshot;
}

function Fixture() {
  const [states, update] = useState<readonly EmployeeTaskState[]>([]);
  const [projection, updateProjection] = useState<ProjectedSnapshot>();
  useEffect(() => { setConfirmedStates = update; }, []);
  useEffect(() => { setProjectedSnapshot = updateProjection; }, []);
  const projectedStates = confirmedSceneStatesForConnection(employees.map(employee => {
    const status = projection?.statuses.get(employee.employeeId);
    return { id: employee.employeeId, employeeLiveState: status ? { employeeId: employee.employeeId, status, source: 'REAL' as const } : undefined };
  }), projection?.connection ?? 'disconnected');
  return <PremiumFloorScene employees={employees} confirmedEmployeeStates={projection ? projectedStates : states} />;
}

Object.assign(window, {
  gfx37Test: {
    employees,
    inspect,
    setStates(states: readonly EmployeeTaskState[]) { setProjectedSnapshot(undefined); setConfirmedStates(states); },
    setLiveSnapshot(states: readonly { employeeId: string; status: EmployeeLiveStatus }[]) {
      setProjectedSnapshot({ connection: 'live', statuses: new Map(states.map(state => [state.employeeId, state.status])) });
    },
    setLiveStatus(employeeId: string, status: EmployeeLiveStatus) {
      setProjectedSnapshot(previous => {
        const next = new Map(previous?.statuses ?? []);
        next.set(employeeId, status);
        return { connection: previous?.connection ?? 'live', statuses: next };
      });
    },
    setConnection(connection: Connection) {
      setProjectedSnapshot(previous => ({ connection, statuses: previous?.statuses ?? new Map() }));
    },
    unmount() { lifecycle = inspect()?.lifecycle; root.unmount(); },
    lifecycle: () => lifecycle,
  },
});
root.render(<Fixture />);
