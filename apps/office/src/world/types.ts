export type FloorKind = "lobby" | "department" | "cafe" | "rest";

export interface FloorMetadata {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly departmentId?: string;
  readonly seatCount: number;
  readonly occupiedCount: number;
  readonly kind: FloorKind;
  readonly palette: "sand" | "blue" | "sage" | "terracotta" | "violet" | "cafe" | "lounge";
  readonly decorAsset?: string;
}

export interface WorldEmployee {
  readonly employeeId: string;
  readonly displayName: string;
  readonly departmentId: string;
  readonly professionId: string;
  readonly floorId: string;
  readonly deskId: string;
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
  readonly status: "working" | "idle" | "blocked" | "offline";
  readonly characterVariant: number;
}

export interface DeskObject {
  readonly deskId: string;
  readonly floorId: string;
  readonly x: number;
  readonly y: number;
  readonly occupiedBy?: string;
  readonly zone: "desk" | "meeting" | "kitchen" | "lounge" | "reception";
}
