import { createFloorDesignPreset, floorItem, mountedItem } from './preset-builder';
import type { LayoutAisle } from '../../../office-layout';

const aisles: LayoutAisle[] = [
  { id: 'visitor-spine', kind: 'entry', bounds: { x: 10, z: 1.3, width: 2, depth: 3.1 } },
  { id: 'leadership-approach', kind: 'main', bounds: { x: 6.9, z: 4.45, width: 8.6, depth: 0.36 } },
  { id: 'management-row-1', kind: 'desk-row', bounds: { x: 6.9, z: 6.95, width: 9.2, depth: 0.55 } },
  { id: 'management-row-2', kind: 'desk-row', bounds: { x: 6.9, z: 10.1, width: 9.2, depth: 0.55 } },
];

const meetingSeats = [16.6, 18.05, 19.5].flatMap(x => [1.65, 3.95].map(z =>
  floorItem(`board-chair-${x}-${z}`, 'chair.meeting', x, z, 0.48, 0.588),
));

export const FLOOR_01_MANAGEMENT = createFloorDesignPreset({
  id: 'floor-01-management-v2', number: 1, uiFloorId: 'floor-01', worldFloorId: 'floor-2', departmentId: 'management',
  title: 'Руководство и управление проектами',
  role: 'Управленческий suite: кабинет, гостевой вход, переговорная и открытая команда управления.',
  profile: 'management',
  room: { meetingRooms: 1, restAreas: 1, serviceZones: 0 },
  positions: [
    [7.8, 5.0], [10.2, 5.0], [12.6, 5.0], [15.0, 5.0],
    [7.8, 8.2], [10.2, 8.2], [12.6, 8.2], [15.0, 8.2],
    [7.8, 11.1], [10.2, 11.1], [12.6, 11.1], [15.0, 11.1],
  ],
  extraAisles: aisles,
  zones: [
    { id: 'visitor-spine', label: 'Свободный вход и подход к переговорной', kind: 'circulation', bounds: { x: 10, z: 1.3, width: 2, depth: 3.1 }, finish: 'oak-light' },
    { id: 'leadership-office', label: 'Кабинет руководителя', kind: 'leadership', bounds: { x: 1.2, z: 4, width: 5.6, depth: 2.4 }, finish: 'walnut' },
    { id: 'boardroom', label: 'Стеклянная переговорная', kind: 'meeting', bounds: { x: 15.3, z: 1.2, width: 5.5, depth: 3.2 }, finish: 'bronze-glass' },
    { id: 'team-suite', label: 'Рабочие места управления', kind: 'work', bounds: { x: 7, z: 4.8, width: 9, depth: 7.1 }, finish: 'oak-light' },
    { id: 'quiet-lounge', label: 'Тихая зона для коротких встреч', kind: 'lounge', bounds: { x: 1.2, z: 1.2, width: 4.5, depth: 2.4 }, finish: 'sage-wool' },
  ],
  furniture: [
    floorItem('visitor-console-west', 'desk.modern', 8.5, 2.4, 1.516, 0.736, 0, 'light-oak'),
    floorItem('visitor-console-east', 'desk.modern', 13.6, 2.4, 1.516, 0.736, 0, 'light-oak'),
    floorItem('visitor-seat-west', 'chair.ergonomic', 8.5, 3.25, 0.626, 0.675, 0, 'sage'),
    floorItem('visitor-seat-east', 'chair.ergonomic', 13.6, 3.25, 0.626, 0.675, 0, 'sage'),
    floorItem('leadership-desk', 'desk.modern', 3.8, 5.15, 1.516, 0.736, 0, 'walnut'),
    floorItem('leadership-chair', 'chair.ergonomic', 5.25, 5.25, 0.626, 0.675, 0, 'graphite'),
    floorItem('lounge-sofa', 'sofa.cozy', 3.3, 2.0, 2.25, 0.81, 0, 'forest'),
    floorItem('lounge-table', 'table.coffee', 3.3, 3.05, 0.8, 0.8, 0, 'walnut'),
    floorItem('lounge-chair', 'armchair.cozy', 5.0, 2.6, 0.92, 0.75, 0, 'sage'),
    floorItem('lounge-plant', 'plant.potted', 1.8, 2.1, 0.7, 0.7),
    floorItem('board-table', 'table.meeting', 18.05, 2.8, 2.8, 1.2, 0, 'walnut'),
    ...meetingSeats,
    ...Array.from({ length: 11 }, (_, index) => {
      const desk = `desk-floor-2-${String(index + 1).padStart(2, '0')}`;
      const x = [7.8, 10.2, 12.6, 15.0][index % 4]!;
      const z = [5.0, 8.2, 11.1][Math.floor(index / 4)]!;
      return mountedItem(`management-monitor-${index + 1}`, 'monitor.single', 'desk-top', x, 1.05, z + 0.24, desk);
    }),
    mountedItem('boardroom-pendant', 'pendant.led', 'ceiling', 18.05, 4.25, 2.8),
    mountedItem('entry-sconce-west', 'decor.wall.sconce', 'wall', 7.15, 2.65, 6.7),
    mountedItem('entry-sconce-east', 'decor.wall.sconce', 'wall', 14.85, 2.65, 6.7),
  ],
  lighting: [
    { id: 'visitor-ring-1', kind: 'pendant', position: { x: 8.5, y: 4.7, z: 2.4 }, color: '#E5B978', intensity: 460, temperatureK: 2900 },
    { id: 'visitor-ring-2', kind: 'pendant', position: { x: 13.6, y: 4.7, z: 2.4 }, color: '#E5B978', intensity: 460, temperatureK: 2900 },
    { id: 'management-linear-1', kind: 'linear', position: { x: 11.4, y: 5.25, z: 6.2 }, target: { x: 11.4, y: 0, z: 6.2 }, color: '#F0D7AA', intensity: 620, temperatureK: 3200 },
    { id: 'management-linear-2', kind: 'linear', position: { x: 11.4, y: 5.25, z: 9.5 }, target: { x: 11.4, y: 0, z: 9.5 }, color: '#F0D7AA', intensity: 620, temperatureK: 3200 },
    { id: 'boardroom-pendant', kind: 'pendant', position: { x: 18.05, y: 4.55, z: 2.8 }, target: { x: 18.05, y: 0, z: 2.8 }, color: '#F0C787', intensity: 520, temperatureK: 3000 },
    { id: 'desk-task-wash', kind: 'task', position: { x: 11.4, y: 3.4, z: 9.0 }, target: { x: 11.4, y: 0, z: 9.0 }, color: '#FFF0D2', intensity: 280, temperatureK: 3500 },
  ],
  palette: { plaster: '#E4D9C9', oak: '#B99169', walnut: '#50382E', bronze: '#A77A4E', sage: '#75877B', textile: '#D6C5AD' },
});
