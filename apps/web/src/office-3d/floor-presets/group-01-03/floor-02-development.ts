import { createFloorDesignPreset, floorItem, mountedItem } from './preset-builder';
import type { LayoutAisle } from '../../../office-layout';

const aisles: LayoutAisle[] = [
  { id: 'dev-review-approach', kind: 'main', bounds: { x: 4.2, z: 4.8, width: 15.8, depth: 0.55 } },
  { id: 'dev-row-crossing', kind: 'desk-row', bounds: { x: 3.5, z: 8.05, width: 15.4, depth: 0.6 } },
  { id: 'dev-north-crossing', kind: 'desk-row', bounds: { x: 4.8, z: 11.8, width: 12.5, depth: 0.55 } },
];

const reviewSeats = [16.6, 18.05, 19.5].flatMap(x => [1.65, 3.95].map(z =>
  floorItem(`review-chair-${x}-${z}`, 'chair.meeting', x, z, 0.48, 0.588),
));

export const FLOOR_02_DEVELOPMENT = createFloorDesignPreset({
  id: 'floor-02-software-development-v2', number: 2, uiFloorId: 'floor-02', worldFloorId: 'floor-3', departmentId: 'software-development',
  title: 'Разработка программного обеспечения',
  role: 'Продуктовые dev-поды, короткий путь к code review и отдельная тихая зона для фокусной работы.',
  profile: 'open-space',
  room: { meetingRooms: 1, restAreas: 0, serviceZones: 1, groupSize: 5 },
  positions: [
    [4.5, 6.0], [7.1, 6.0], [9.7, 6.0], [12.3, 6.0], [14.9, 6.0], [17.5, 6.0],
    [5.8, 9.8], [8.4, 9.8], [11.0, 9.8], [13.6, 9.8], [16.2, 9.8],
  ],
  extraAisles: aisles,
  zones: [
    { id: 'build-support', label: 'Сборка и техническое хранение', kind: 'support', bounds: { x: 1.2, z: 1.2, width: 3, depth: 1.8 }, finish: 'graphite-metal' },
    { id: 'code-review-room', label: 'Code review и планирование', kind: 'meeting', bounds: { x: 15.3, z: 1.2, width: 5.5, depth: 3.2 }, finish: 'smoked-glass' },
    { id: 'pairing-bank-a', label: 'Командный pod · шесть мест', kind: 'work', bounds: { x: 3.6, z: 5.45, width: 14.7, depth: 2.2 }, finish: 'ash-oak' },
    { id: 'pairing-bank-b', label: 'Фокусный pod · пять мест', kind: 'work', bounds: { x: 4.9, z: 9.25, width: 12.1, depth: 2.2 }, finish: 'ash-oak' },
    { id: 'quiet-focus-booth', label: 'Изолированный фокусный карман', kind: 'quiet', bounds: { x: 1.1, z: 5.1, width: 2.3, depth: 2.4 }, finish: 'blue-felt' },
    { id: 'cross-pod-route', label: 'Поперечный проход между pods', kind: 'circulation', bounds: { x: 3.5, z: 8.05, width: 15.4, depth: 0.6 }, finish: 'oak-light' },
  ],
  furniture: [
    floorItem('build-workbench', 'preview.workstation', 2.7, 2.1, 1.5, 1.285, 0, 'graphite'),
    { ...floorItem('focus-room', 'preview.office.group', 2.25, 6.3, 2.2, 2.0, 0, 'blue-felt'), scale: [0.66, 0.85, 0.7] },
    floorItem('reference-shelf', 'bookshelf', 2.2, 11.7, 1.305, 0.353, 0, 'light-oak'),
    floorItem('review-table', 'table.meeting', 18.05, 2.8, 2.8, 1.2, 0, 'dark-oak'),
    ...reviewSeats,
    ...Array.from({ length: 10 }, (_, index) => {
      const deskId = `desk-floor-3-${String(index + 1).padStart(2, '0')}`;
      const point = [
        [4.5, 6.0], [7.1, 6.0], [9.7, 6.0], [12.3, 6.0], [14.9, 6.0], [17.5, 6.0],
        [5.8, 9.8], [8.4, 9.8], [11.0, 9.8], [13.6, 9.8],
      ][index]!;
      return mountedItem(`dev-dual-monitor-${index + 1}`, 'monitor.dual', 'desk-top', point[0]!, 1.08, point[1]! + 0.24, deskId);
    }),
    mountedItem('review-whiteboard', 'wall.decoration', 'wall', 18.05, 2.7, 4.34),
    mountedItem('pod-light-rail-a', 'pendant.led', 'ceiling', 11.0, 4.8, 6.6),
    mountedItem('pod-light-rail-b', 'pendant.led', 'ceiling', 11.0, 4.8, 10.2),
  ],
  lighting: [
    { id: 'pairing-linear-a', kind: 'linear', position: { x: 11, y: 5.4, z: 6.8 }, target: { x: 11, y: 0, z: 6.8 }, color: '#D8E3E6', intensity: 720, temperatureK: 3900 },
    { id: 'pairing-linear-b', kind: 'linear', position: { x: 11, y: 5.4, z: 10.4 }, target: { x: 11, y: 0, z: 10.4 }, color: '#D8E3E6', intensity: 720, temperatureK: 3900 },
    { id: 'review-warm-pendant', kind: 'pendant', position: { x: 18.05, y: 4.55, z: 2.8 }, target: { x: 18.05, y: 0, z: 2.8 }, color: '#E8B66C', intensity: 500, temperatureK: 3000 },
    { id: 'focus-task-light', kind: 'task', position: { x: 2.25, y: 3.8, z: 6.3 }, target: { x: 2.25, y: 0, z: 6.3 }, color: '#E7F0F0', intensity: 320, temperatureK: 4200 },
    { id: 'brick-sconce', kind: 'sconce', position: { x: 2.8, y: 2.8, z: 6.85 }, color: '#F1BE78', intensity: 180, temperatureK: 2800 },
  ],
  palette: { plaster: '#D8D5CA', ash: '#BBAE9B', graphite: '#384247', blue: '#4E6A80', amber: '#D89A55', felt: '#74889A' },
});
