import type { FloorLayout, LayoutPoint, LayoutRect } from '../../../office-layout';

export type FurnitureMount = 'floor' | 'desk-top' | 'wall' | 'ceiling';
export type FloorZoneKind = 'work' | 'leadership' | 'meeting' | 'support' | 'quiet' | 'circulation' | 'lounge' | 'test-lab';

/** Standalone v1 contract. Coordinates are metres in the local floor plane (0..width, 0..depth). */
export interface FloorDesignPreset {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly floor: {
    readonly number: 1 | 2 | 3;
    readonly uiFloorId: 'floor-01' | 'floor-02' | 'floor-03';
    readonly worldFloorId: string;
    readonly departmentId: string;
    readonly title: string;
    readonly role: string;
  };
  readonly layout: FloorLayout;
  readonly roster: {
    readonly employeeCount: number;
    readonly seatCount: number;
    readonly employeeIds: readonly string[];
    readonly deskIds: readonly string[];
    readonly reservedDeskIds: readonly string[];
  };
  readonly zones: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: FloorZoneKind;
    readonly bounds: LayoutRect;
    readonly finish: string;
  }[];
  readonly workstation: { readonly deskAssetId: string; readonly chairAssetId: string };
  readonly furniture: readonly {
    readonly id: string;
    readonly assetId: string;
    readonly mount: FurnitureMount;
    readonly position: LayoutPoint;
    readonly rotationY?: number;
    readonly scale?: readonly [number, number, number];
    /** Floor-plane footprint for collision checks; absent on wall, ceiling and desk-top assets. */
    readonly footprint?: LayoutRect;
    readonly hostDeskId?: string;
    readonly finish?: string;
  }[];
  readonly lighting: readonly {
    readonly id: string;
    readonly kind: 'linear' | 'pendant' | 'sconce' | 'task';
    readonly position: LayoutPoint;
    readonly target?: LayoutPoint;
    readonly color: string;
    readonly intensity: number;
    readonly temperatureK: number;
  }[];
  readonly palette: Readonly<Record<string, string>>;
}

export interface FloorDesignValidationIssue {
  readonly code: string;
  readonly subject: string;
}

export interface FloorDesignValidation {
  readonly valid: boolean;
  readonly issues: readonly FloorDesignValidationIssue[];
}
