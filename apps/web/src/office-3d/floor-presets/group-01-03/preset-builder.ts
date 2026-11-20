import { buildDesks, createDemoEmployees, FLOOR_METADATA } from '../../../world';
import { createFloorLayout, validateFloorLayout } from '../../../office-layout';
import type { AisleParameters, DeskSlot, EmployeeAssignment, FloorProfile, LayoutAisle, LayoutPoint, LayoutRect, RoomConfiguration } from '../../../office-layout';
import type { FloorDesignPreset, FloorDesignValidation, FurnitureMount } from './schema';

export interface PresetDefinition {
  readonly id: string;
  readonly number: 1 | 2 | 3;
  readonly uiFloorId: 'floor-01' | 'floor-02' | 'floor-03';
  readonly worldFloorId: string;
  readonly departmentId: string;
  readonly title: string;
  readonly role: string;
  readonly profile: FloorProfile;
  readonly room: Partial<RoomConfiguration>;
  readonly positions: readonly (readonly [number, number])[];
  readonly extraAisles: readonly (LayoutAisle & { readonly id: string })[];
  readonly zones: FloorDesignPreset['zones'];
  readonly furniture: FloorDesignPreset['furniture'];
  readonly lighting: FloorDesignPreset['lighting'];
  readonly palette: FloorDesignPreset['palette'];
  readonly aisles?: AisleParameters;
}

export function createFloorDesignPreset(definition: PresetDefinition): FloorDesignPreset {
  const floor = FLOOR_METADATA.find(item => item.id === definition.worldFloorId);
  if (!floor || floor.departmentId !== definition.departmentId) throw new Error(`floor_department_mismatch:${definition.worldFloorId}`);
  const allEmployees = createDemoEmployees();
  const employees = allEmployees.filter(employee => employee.floorId === definition.worldFloorId);
  const deskRecords = buildDesks(allEmployees).filter(desk => desk.floorId === definition.worldFloorId);
  if (definition.positions.length !== deskRecords.length) throw new Error(`desk_position_count_mismatch:${definition.worldFloorId}`);

  const deskSlots: DeskSlot[] = deskRecords.map((desk, index) => ({
    deskId: desk.deskId,
    floorId: definition.worldFloorId,
    position: { x: definition.positions[index]![0], y: 0, z: definition.positions[index]![1] },
    orientation: 0,
    reserved: !desk.occupiedBy,
    zone: 'desk',
  }));
  const assignments: EmployeeAssignment[] = employees.map(employee => ({
    employeeId: employee.employeeId,
    deskId: employee.deskId,
    floorId: definition.worldFloorId,
    departmentId: employee.departmentId,
  }));
  const layout = createFloorLayout({
    floorId: definition.worldFloorId,
    size: { width: 22, depth: 14, height: 5.8 },
    deskSlots,
    assignments,
    room: { profile: definition.profile, meetingRooms: 0, restAreas: 0, serviceZones: 0, groupSize: 4, ...definition.room },
    aisles: { clearance: 0.22, chairDepth: 0.7, chairWidth: 0.64, deskWidth: 1.6, deskDepth: 0.8, edgePadding: 1.2, ...(definition.aisles ?? {}) },
  });
  const entryAisle = layout.aisles.find(aisle => aisle.id === 'main-entry');
  if (!entryAisle) throw new Error(`main_entry_aisle_missing:${definition.worldFloorId}`);
  const composedLayout = { ...layout, aisles: [entryAisle, ...definition.extraAisles] };
  const occupiedDeskIds = new Set(assignments.map(assignment => assignment.deskId));
  const preset: FloorDesignPreset = {
    schemaVersion: 1,
    id: definition.id,
    floor: { number: definition.number, uiFloorId: definition.uiFloorId, worldFloorId: definition.worldFloorId, departmentId: definition.departmentId, title: definition.title, role: definition.role },
    layout: composedLayout,
    roster: {
      employeeCount: employees.length,
      seatCount: deskRecords.length,
      employeeIds: employees.map(employee => employee.employeeId),
      deskIds: deskRecords.map(desk => desk.deskId),
      reservedDeskIds: deskRecords.filter(desk => !occupiedDeskIds.has(desk.deskId)).map(desk => desk.deskId),
    },
    zones: definition.zones,
    workstation: { deskAssetId: 'desk.modern', chairAssetId: 'chair.ergonomic' },
    furniture: definition.furniture,
    lighting: definition.lighting,
    palette: definition.palette,
  };
  const validation = validateFloorDesignPreset(preset);
  if (!validation.valid) throw new Error(`floor_design_invalid:${preset.id}:${validation.issues.map(issue => issue.code + ':' + issue.subject).join(',')}`);
  return preset;
}

export function validateFloorDesignPreset(preset: FloorDesignPreset): FloorDesignValidation {
  const issues: FloorDesignValidation['issues'][number][] = [];
  for (const issue of validateFloorLayout(preset.layout).issues) issues.push({ code: issue.code, subject: issue.subject ?? preset.layout.floorId });
  const bounds = preset.layout.bounds;
  const inside = (rect: LayoutRect) => rect.x >= bounds.x && rect.z >= bounds.z && rect.x + rect.width <= bounds.x + bounds.width && rect.z + rect.depth <= bounds.z + bounds.depth;
  const overlaps = (a: LayoutRect, b: LayoutRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.z < b.z + b.depth && a.z + a.depth > b.z;
  for (const zone of preset.zones) if (!inside(zone.bounds)) issues.push({ code: 'ZONE_OUT_OF_BOUNDS', subject: zone.id });
  const floorFurniture = preset.furniture.filter(item => item.mount === 'floor');
  const hostDeskIds = new Set(preset.layout.desks.map(desk => desk.deskId));
  for (const item of preset.furniture) {
    if (item.mount === 'floor' && !item.footprint) issues.push({ code: 'FLOOR_FURNITURE_FOOTPRINT_MISSING', subject: item.id });
    if (item.mount !== 'floor' && item.footprint) issues.push({ code: 'MOUNTED_FURNITURE_HAS_FLOOR_FOOTPRINT', subject: item.id });
    if (item.mount === 'desk-top' && (!item.hostDeskId || !hostDeskIds.has(item.hostDeskId))) issues.push({ code: 'DESK_TOP_HOST_MISSING', subject: item.id });
    if (item.footprint && !inside(item.footprint)) issues.push({ code: 'FURNITURE_OUT_OF_BOUNDS', subject: item.id });
    if (item.footprint && preset.layout.desks.some(desk => overlaps(item.footprint!, desk.bounds))) issues.push({ code: 'FURNITURE_DESK_OVERLAP', subject: item.id });
    if (item.footprint && preset.layout.chairs.some(chair => overlaps(item.footprint!, chair.bounds))) issues.push({ code: 'FURNITURE_CHAIR_OVERLAP', subject: item.id });
    if (item.footprint && preset.layout.aisles.some(aisle => overlaps(item.footprint!, aisle.bounds))) issues.push({ code: 'FURNITURE_AISLE_OVERLAP', subject: item.id });
    if (item.footprint && preset.zones.some(zone => zone.kind === 'circulation' && overlaps(item.footprint!, zone.bounds))) issues.push({ code: 'FURNITURE_CIRCULATION_OVERLAP', subject: item.id });
  }
  for (let i = 0; i < floorFurniture.length; i += 1) for (let j = i + 1; j < floorFurniture.length; j += 1) {
    if (overlaps(floorFurniture[i]!.footprint!, floorFurniture[j]!.footprint!)) issues.push({ code: 'FURNITURE_OVERLAP', subject: `${floorFurniture[i]!.id}|${floorFurniture[j]!.id}` });
  }
  for (const light of preset.lighting) {
    if (light.position.x < bounds.x || light.position.x > bounds.x + bounds.width || light.position.z < bounds.z || light.position.z > bounds.z + bounds.depth || light.position.y < 0 || light.position.y > (preset.layout.size.height ?? 5.8)) issues.push({ code: 'LIGHT_OUT_OF_BOUNDS', subject: light.id });
  }
  return { valid: issues.length === 0, issues };
}

export function floorItem(id: string, assetId: string, x: number, z: number, width: number, depth: number, y = 0, finish?: string, rotationY?: number) {
  return { id, assetId, mount: 'floor' as FurnitureMount, position: { x, y, z } satisfies LayoutPoint, footprint: { x: x - width / 2, z: z - depth / 2, width, depth }, ...(finish ? { finish } : {}), ...(rotationY === undefined ? {} : { rotationY }) };
}

export function mountedItem(id: string, assetId: string, mount: Exclude<FurnitureMount, 'floor'>, x: number, y: number, z: number, hostDeskId?: string) {
  return { id, assetId, mount, position: { x, y, z }, ...(hostDeskId ? { hostDeskId } : {}) };
}
