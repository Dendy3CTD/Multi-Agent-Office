import { createFloorDesignPreset, floorItem, mountedItem } from './preset-builder';
import type { LayoutAisle } from '../../../office-layout';

const aisles: LayoutAisle[] = [
  { id: 'qa-central-lab-spine', kind: 'main', bounds: { x: 9.4, z: 4.7, width: 3.2, depth: 5.6 } },
  { id: 'qa-left-crossing', kind: 'desk-row', bounds: { x: 3.4, z: 7.25, width: 5.3, depth: 0.55 } },
  { id: 'qa-right-crossing', kind: 'desk-row', bounds: { x: 13.9, z: 7.25, width: 5.3, depth: 0.55 } },
  { id: 'qa-flex-approach', kind: 'entry', bounds: { x: 7.4, z: 10.65, width: 7.8, depth: 0.5 } },
];

const reviewSeats = [16.9, 18.05, 19.2].map(x =>
  floorItem(`qa-review-chair-${x}`, 'chair.meeting', x, 3.85, 0.48, 0.588),
);

export const FLOOR_03_QA = createFloorDesignPreset({
  id: 'floor-03-quality-assurance-v2', number: 3, uiFloorId: 'floor-03', worldFloorId: 'floor-4', departmentId: 'quality-assurance',
  title: 'Тестирование и контроль качества',
  role: 'QA-лабиринт без тупиков: две тестовые кромки вокруг центрального прохода и отдельный flex-пояс для triage.',
  profile: 'engineering',
  room: { meetingRooms: 1, restAreas: 0, serviceZones: 1, groupSize: 4 },
  positions: [
    [4.4, 5.2], [7.0, 5.2], [14.9, 5.2], [17.5, 5.2],
    [4.4, 8.5], [7.0, 8.5], [14.9, 8.5], [17.5, 8.5],
    [8.3, 11.5], [10.9, 11.5], [13.5, 11.5],
  ],
  extraAisles: aisles,
  zones: [
    { id: 'device-validation-bay', label: 'Небольшая стендовая зона тестирования', kind: 'test-lab', bounds: { x: 1.2, z: 1.2, width: 3, depth: 1.8 }, finish: 'sage-ceramic' },
    { id: 'defect-review-room', label: 'Разбор дефектов и приёмка', kind: 'meeting', bounds: { x: 15.3, z: 1.2, width: 5.5, depth: 3.2 }, finish: 'smoked-glass' },
    { id: 'qa-left-bank', label: 'Левая test-bank', kind: 'work', bounds: { x: 3.5, z: 4.7, width: 5.4, depth: 5.1 }, finish: 'ash-oak' },
    { id: 'qa-right-bank', label: 'Правая test-bank', kind: 'work', bounds: { x: 13.9, z: 4.7, width: 5.4, depth: 5.1 }, finish: 'ash-oak' },
    { id: 'qa-flex-belt', label: 'Свободный пояс для разбора результатов', kind: 'work', bounds: { x: 7.5, z: 11.1, width: 7.2, depth: 2.1 }, finish: 'teal-felt' },
    { id: 'qa-central-lab-spine', label: 'Непрерывный центральный тестовый проход', kind: 'circulation', bounds: { x: 9.4, z: 4.7, width: 3.2, depth: 5.6 }, finish: 'pale-concrete' },
  ],
  furniture: [
    floorItem('device-test-bench', 'preview.workstation', 2.7, 2.1, 1.5, 1.285, 0, 'sage-ceramic'),
    floorItem('test-equipment-rack', 'filing.cabinet', 3.8, 3.8, 0.75, 0.702, 0, 'graphite'),
    floorItem('defect-review-table', 'table.meeting', 18.05, 2.7, 2.8, 1.2, 0, 'light-oak'),
    ...reviewSeats,
    ...Array.from({ length: 9 }, (_, index) => {
      const deskId = `desk-floor-4-${String(index + 1).padStart(2, '0')}`;
      const point = [
        [4.4, 5.2], [7.0, 5.2], [14.9, 5.2], [17.5, 5.2],
        [4.4, 8.5], [7.0, 8.5], [14.9, 8.5], [17.5, 8.5], [8.3, 11.5],
      ][index]!;
      return mountedItem(`qa-monitor-${index + 1}`, 'monitor.single', 'desk-top', point[0]!, 1.05, point[1]! + 0.24, deskId);
    }),
    mountedItem('qa-triage-board', 'wall.decoration', 'wall', 11, 2.7, 6.82),
    mountedItem('qa-bank-linear-light-left', 'pendant.led', 'ceiling', 6.1, 4.8, 7.0),
    mountedItem('qa-bank-linear-light-right', 'pendant.led', 'ceiling', 16.2, 4.8, 7.0),
  ],
  lighting: [
    { id: 'qa-bank-left', kind: 'linear', position: { x: 6.1, y: 5.3, z: 7.0 }, target: { x: 6.1, y: 0, z: 7.0 }, color: '#D5E5DD', intensity: 680, temperatureK: 3900 },
    { id: 'qa-bank-right', kind: 'linear', position: { x: 16.2, y: 5.3, z: 7.0 }, target: { x: 16.2, y: 0, z: 7.0 }, color: '#D5E5DD', intensity: 680, temperatureK: 3900 },
    { id: 'triage-worklight', kind: 'pendant', position: { x: 10.9, y: 4.7, z: 12.1 }, target: { x: 10.9, y: 0, z: 12.1 }, color: '#E8F0E8', intensity: 460, temperatureK: 4100 },
    { id: 'bench-task-light', kind: 'task', position: { x: 2.7, y: 3.2, z: 2.1 }, target: { x: 2.7, y: 0, z: 2.1 }, color: '#FFF0D8', intensity: 380, temperatureK: 3600 },
    { id: 'review-pendant', kind: 'pendant', position: { x: 18.05, y: 4.5, z: 2.7 }, target: { x: 18.05, y: 0, z: 2.7 }, color: '#E6BB7E', intensity: 500, temperatureK: 3100 },
  ],
  palette: { plaster: '#E0DED4', ash: '#B8AC97', teal: '#4B7773', sage: '#7D9285', graphite: '#3F4846', ceramic: '#C9D2C8' },
});
