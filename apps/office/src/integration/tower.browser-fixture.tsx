import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MAOTower from './MAOTower';
import { createDemoEmployees } from '../world';
import type { OfficeScene3DProps } from '../office-3d/OfficeScene3D';

// Served only by tower.browser-check.mjs, which replaces WebGL with an instrumented scene.
declare global {
  interface Window {
    __towerScene: OfficeScene3DProps & { onSceneStatusChange?: (status: 'loading' | 'ready' | 'error') => void };
    __towerMounts: number;
    __towerUnmounts: number;
    __towerChecks: string[];
    __towerError?: string;
  }
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
window.__towerChecks = [];
window.__towerMounts = 0;
window.__towerUnmounts = 0;
const root = createRoot(document.getElementById('root')!);
function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  window.__towerChecks.push(message);
}
const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const key = async (value: string) => { await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))); };
const menuFloor = (number: string) => [...document.querySelectorAll<HTMLButtonElement>('.mao-floor-row')].find(row => row.querySelector('.mao-floor-number')?.textContent === number)!;

async function run() {
  await act(async () => root.render(<MAOTower />));
  const employees = window.__towerScene.employees!;
  const onEmployee = window.__towerScene.onEmployeeSelect;
  const onElevator = window.__towerScene.onElevatorClick;
  check(employees.length === 113, '113 employees');
  check($('.mao-office-ui').dataset.sceneRenderer === 'three', 'Floor 02 starts as Three.js');
  check($('.mao-scene-status').dataset.sceneStatus === 'loading', 'initial loading overlay');
  check(!document.querySelector('.office-root'), 'no legacy App in tower');
  await act(async () => window.__towerScene.onSceneStatusChange?.('ready'));
  check(!document.querySelector('.mao-scene-status'), 'ready removes overlay');
  await act(async () => window.__towerScene.onElevatorClick?.());
  check(!!document.querySelector('#mao-floor-menu'), 'physical scene callback opens existing ElevatorMenu');
  check(document.querySelectorAll('.mao-floor-row').length === 15, 'all 15 floors');
  check(window.__towerScene.employees === employees, 'elevator request preserves employee reference');
  check(window.__towerScene.onElevatorClick === onElevator, 'elevator callback is stable');
  await key('Escape');
  await act(async () => window.__towerScene.onElevatorClick?.());
  check(!!document.querySelector('#mao-floor-menu'), 'repeated callback opens menu');
  await key('Escape');
  const employee = employees.find(item => item.floorId === 'floor-2')!;
  await act(async () => window.__towerScene.onEmployeeSelect?.(employee.employeeId));
  check(window.__towerScene.selectedEmployeeId === employee.employeeId, 'employee selection updates');
  check(window.__towerScene.employees === employees, 'selection preserves employee reference');
  check(window.__towerScene.onEmployeeSelect === onEmployee, 'employee callback is stable');
  await click($('[aria-label="Увеличить масштаб"]'));
  check(window.__towerScene.cameraAction === 'zoom-in', 'camera action reaches scene');
  check(window.__towerScene.employees === employees, 'camera preserves employee reference');
  const input = $('input[aria-label="Поиск сотрудника"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'инженер');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click($('.mao-filter-row button:nth-child(2)'));
  await key('i');
  check(window.__towerMounts === 1 && window.__towerUnmounts === 0, 'selection/camera/search/filter/HUD keep scene mounted');
  check(window.__towerScene.employees === employees, 'UI controls preserve snapshot');
  await key('i');
  await act(async () => window.__towerScene.onElevatorClick?.());
  await click(menuFloor('03'));
  check($('.mao-office-ui').dataset.activeFloor === 'floor-02' && $('.mao-office-ui').dataset.sceneRenderer === 'svg', 'Floor 03 switches to its scene');
  check(!document.querySelector('.mao-scene-status'), 'no stale 3D status on Floor 03');
  check(window.__towerUnmounts === 1, 'leaving Floor 02 unmounts scene once');
  await key('e');
  await click(menuFloor('02'));
  check($('.mao-office-ui').dataset.sceneRenderer === 'three' && window.__towerMounts === 2, 'returning to Floor 02 mounts once');
  check($('.mao-scene-status').dataset.sceneStatus === 'loading', 'return starts fresh loading');
  check(window.__towerScene.employees === employees, 'floor round trip preserves demo snapshot');
  const oldStatusCallback = window.__towerScene.onSceneStatusChange;
  await act(async () => oldStatusCallback?.('error'));
  check($('.mao-scene-status').getAttribute('role') === 'alert', 'error is announced with recovery');
  await click($('.mao-scene-status button'));
  check(window.__towerMounts === 3 && $('.mao-scene-status').dataset.sceneStatus === 'loading', 'explicit retry remounts and resets status');
  await act(async () => oldStatusCallback?.('ready'));
  check($('.mao-scene-status').dataset.sceneStatus === 'loading', 'old renderer status cannot update the retry');
  await act(async () => window.__towerScene.onSceneStatusChange?.('ready'));
  check(!document.querySelector('.mao-scene-status'), 'retry ready clears status');
  const supplied = createDemoEmployees();
  await act(async () => root.render(<MAOTower employees={supplied} />));
  check(window.__towerScene.employees === supplied, 'supplied Directory snapshot is replaceable');
  const updated = supplied.map(item => item.employeeId === employee.employeeId ? { ...item, displayName: 'Updated' } : item);
  await act(async () => root.render(<MAOTower employees={updated} />));
  check(window.__towerScene.employees === updated, 'real employee updates propagate');
  check(window.__towerMounts === 3, 'new data does not change scene component identity');
  await act(async () => root.render(<MAOTower />));
  check(window.__towerScene.employees === employees, 'demo IDs and assignments survive supplied snapshots');
  await act(async () => root.render(<StrictMode><MAOTower /></StrictMode>));
  const strictEmployees = window.__towerScene.employees;
  const strictMounts = window.__towerMounts;
  const strictUnmounts = window.__towerUnmounts;
  await act(async () => window.__towerScene.onSceneStatusChange?.('ready'));
  await act(async () => window.__towerScene.onElevatorClick?.());
  await key('Escape');
  await click($('[aria-label="Увеличить масштаб"]'));
  check(window.__towerScene.employees === strictEmployees && window.__towerMounts === strictMounts && window.__towerUnmounts === strictUnmounts, 'StrictMode interactions preserve snapshot and mount after initial effect replay');
  document.body.dataset.checks = 'passed';
}
void run().catch(error => {
  window.__towerError = String(error.stack ?? error);
  document.body.dataset.checks = 'failed';
});
