import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { createFloorCameraStore, DEFAULT_CAMERA, focusPoint, panCamera, zoomAtPoint, type CameraState } from "./camera";
import { buildDesks, createDemoEmployees, FLOOR_METADATA, withOccupancy } from "./floorData";
import type { DeskObject, FloorMetadata, WorldEmployee } from "./types";
import "./office-scene.css";

export interface SceneCameraAction {
  readonly type: "focus-employee" | "fit-floor" | "zoom-in" | "zoom-out" | "reset";
  readonly employeeId?: string;
}

export interface OfficeSceneProps {
  floorId: string;
  selectedEmployeeId?: string;
  onEmployeeSelect: (employeeId: string) => void;
  /** A Directory/API snapshot may be supplied by the host application. */
  employees?: readonly WorldEmployee[];
  cameraAction?: SceneCameraAction;
}

const VIEW_WIDTH = 1240;
const VIEW_HEIGHT = 760;
const FLOOR_WIDTH = 16;
const FLOOR_HEIGHT = 10;

function point(x: number, y: number) {
  return { x: (x - y) * 42, y: (x + y) * 22 };
}

function floorPolygon() {
  return [[0, 0], [FLOOR_WIDTH, 0], [FLOOR_WIDTH, FLOOR_HEIGHT], [0, FLOOR_HEIGHT]]
    .map(([x, y]) => { const p = point(x, y); return `${p.x},${p.y}`; }).join(" ");
}

function renderDesk(desk: DeskObject, selected: boolean, onSelect: () => void) {
  const p = point(desk.x, desk.y);
  const occupied = Boolean(desk.occupiedBy);
  return (
    <g key={desk.deskId} className={`world-desk${selected ? " is-selected" : ""}`} transform={`translate(${p.x} ${p.y})`}>
      <rect x="-24" y="-13" width="48" height="24" rx="4" className="desk-surface" />
      <rect x="-10" y="-19" width="20" height="10" rx="2" className="monitor" />
      <path d="M-18 12v8M18 12v8" className="desk-leg" />
      <circle cx="0" cy="2" r="22" className="desk-hit" onClick={onSelect} aria-label={`${desk.deskId}${occupied ? " occupied" : " available"}`} />
    </g>
  );
}

function EmployeeMarker({ employee, selected, onSelect }: { employee: WorldEmployee; selected: boolean; onSelect: () => void }) {
  const p = point(employee.x, employee.y - 0.65);
  const color = ["#e6a56c", "#8eb9b0", "#d58a78", "#9f9bcd", "#d7ba71", "#88a9ce", "#c18fa7", "#87b48e"][employee.characterVariant % 8];
  return (
    <g className={`world-employee${selected ? " is-selected" : ""}`} transform={`translate(${p.x} ${p.y})`} onClick={onSelect} role="button" aria-label={employee.displayName}>
      <circle r="17" className="employee-hit" />
      <circle r="11" className="employee-shadow" />
      <path d="M-8 14Q0 5 8 14v9h-16z" fill={color} className="employee-body" />
      <circle cy="0" r="7" fill="#f3c6a4" />
      <path d="M-7-1Q-5-10 0-9Q7-9 8-1" fill={color} />
      <circle cx="6" cy="-11" r="3.5" className={`status-${employee.status === "working" ? "active" : employee.status}`} />
      {selected && <circle r="20" className="employee-selection" />}
    </g>
  );
}

function isFloorId(value: string): value is string {
  return FLOOR_METADATA.some(floor => floor.id === value);
}

function interiorProfile(floor: FloorMetadata) {
  const profiles: Record<string, { label: string; detail: string; tone: string }> = {
    management: { label: "Проектный штаб", detail: "мягкая зона переговоров", tone: "management" },
    "software-development": { label: "Рабочие станции", detail: "мониторы и командные столы", tone: "development" },
    "quality-assurance": { label: "Лаборатория качества", detail: "стенд проверки сборок", tone: "quality" },
    "engineering-electronics": { label: "Инженерная мастерская", detail: "чертежи и технические места", tone: "engineering" },
    "cad-3d": { label: "3D-студия", detail: "макеты и материалы", tone: "cad" },
    "research-analytics": { label: "Аналитический зал", detail: "экраны и доски исследования", tone: "analytics" },
    documentation: { label: "Архив знаний", detail: "книги и документация", tone: "archive" },
    design: { label: "Дизайн-студия", detail: "материалы и moodboards", tone: "design" },
    "finance-estimates": { label: "Финансовая команда", detail: "спокойный кабинетный ритм", tone: "finance" },
    devops: { label: "Infrastructure", detail: "серверные стойки и наблюдение", tone: "infrastructure" },
    "automation-integrations": { label: "Integration Lab", detail: "схемы связей и прототипы", tone: "automation" },
    "security-review": { label: "Security Review", detail: "контроль и приватные переговоры", tone: "security" },
    lobby: { label: "Ресепшен", detail: "гостевая зона башни", tone: "lobby" },
    cafe: { label: "Кафе MAO", detail: "кофе, свет и короткие встречи", tone: "cafe" },
    rest: { label: "Lounge", detail: "диваны и переговорные", tone: "lounge" },
  };
  return profiles[floor.departmentId ?? floor.kind] ?? { label: floor.title, detail: "уютное рабочее пространство", tone: "office" };
}

export function OfficeScene({ floorId, selectedEmployeeId, onEmployeeSelect, employees = createDemoEmployees(), cameraAction }: OfficeSceneProps) {
  const floor = FLOOR_METADATA.find(item => item.id === floorId) ?? FLOOR_METADATA[0];
  const floorEmployees = useMemo(() => employees.filter(employee => employee.floorId === floor.id), [employees, floor.id]);
  const desks = useMemo(() => buildDesks(employees).filter(desk => desk.floorId === floor.id), [employees, floor.id]);
  const [camera, setCamera] = useState<CameraState>(() => DEFAULT_CAMERA);
  const cameras = useRef(createFloorCameraStore());
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean }>();
  const suppressClickUntil = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const previousFloor = useRef(floor.id);

  useEffect(() => {
    cameras.current.set(previousFloor.current, camera);
    const next = cameras.current.get(floor.id);
    setCamera(next);
    previousFloor.current = floor.id;
  }, [floor.id]);

  useEffect(() => () => { cameras.current.set(floor.id, camera); }, [camera, floor.id]);

  useEffect(() => {
    if (!cameraAction) return;
    if (cameraAction.type === "fit-floor") setCamera({ x: 0, y: 0, zoom: 0.92 });
    if (cameraAction.type === "reset") setCamera(DEFAULT_CAMERA);
    if (cameraAction.type === "zoom-in") setCamera(current => zoomAtPoint(current, 1.18, 0, 0));
    if (cameraAction.type === "zoom-out") setCamera(current => zoomAtPoint(current, 0.84, 0, 0));
    if (cameraAction.type === "focus-employee") {
      const employee = floorEmployees.find(item => item.employeeId === cameraAction.employeeId);
      if (employee) { const p = point(employee.x, employee.y); setCamera(focusPoint(p.x, p.y, 1.42)); }
    }
  }, [cameraAction, floorEmployees]);

  const screenPoint = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (event.clientX - rect.left) * VIEW_WIDTH / rect.width, y: (event.clientY - rect.top) * VIEW_HEIGHT / rect.height };
  };

  const zoom = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const screen = screenPoint(event);
    const worldX = (screen.x - VIEW_WIDTH / 2 - camera.x) / camera.zoom;
    const worldY = (screen.y - 150 - camera.y) / camera.zoom;
    const factor = Math.exp(-event.deltaY * 0.0015);
    setCamera(current => zoomAtPoint(current, factor, worldX, worldY));
  };

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) active.moved = true;
    active.x = event.clientX; active.y = event.clientY;
    setCamera(current => panCamera(current, dx, dy));
  };
  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId === event.pointerId) {
      if (drag.current.moved) suppressClickUntil.current = Date.now() + 250;
      drag.current = undefined;
    }
  };

  const focusEmployee = (employee: WorldEmployee) => {
    if (Date.now() < suppressClickUntil.current) return;
    const p = point(employee.x, employee.y);
    setCamera(focusPoint(p.x, p.y, 1.42));
    onEmployeeSelect(employee.employeeId);
  };
  const canSelect = () => Date.now() >= suppressClickUntil.current;
  const fitFloor = () => setCamera({ x: 0, y: 0, zoom: 0.92 });
  const floorPalette = `floor-palette-${floor.palette}`;
  const profile = interiorProfile(floor);
  const zones = floor.kind === "department"
    ? [{ label: "Стеклянная переговорная", x: 11.8, y: 2.1, w: 3.3, h: 2.3 }, { label: "Зона растений", x: 1.4, y: 8.1, w: 3.5, h: 1.1 }]
    : floor.kind === "cafe"
      ? [{ label: "Кухня", x: 3.5, y: 2, w: 5.3, h: 2.2 }, { label: "Кафе", x: 10.6, y: 6.5, w: 3.5, h: 2 }]
      : floor.kind === "rest"
        ? [{ label: "Переговорная", x: 3.2, y: 2.3, w: 4.5, h: 2.4 }, { label: "Лаунж", x: 11, y: 6.2, w: 3.2, h: 2.3 }]
        : [{ label: "Ресепшен", x: 6.3, y: 3.4, w: 3.4, h: 1.8 }];

  return (
    <section className="office-scene" aria-label={`Этаж ${floor.number}: ${floor.title}`}>
      <div className="scene-toolbar">
        <div><span className="scene-eyebrow">LIVE FLOOR VIEW · {profile.label}</span><h2>{floor.title}</h2></div>
        <div className="scene-toolbar-actions"><span className="scene-counter">{floorEmployees.length}/{floor.seatCount} мест занято</span><button onClick={fitFloor}>Показать этаж</button><button onClick={() => setCamera(DEFAULT_CAMERA)}>Сбросить</button></div>
      </div>
      <div className="scene-stage">
        <svg ref={svgRef} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label="Изометрическая сцена офиса" onWheel={zoom} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
          <defs>
            <linearGradient id="floor-laminate" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#e3c798" /><stop offset=".52" stopColor="#c99c70" /><stop offset="1" stopColor="#a87557" /></linearGradient>
            <pattern id="oak-grain" width="86" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(18)"><rect width="86" height="20" fill="url(#floor-laminate)" /><path d="M0 4q18-4 34 0t32 0t20 0M8 14q16-3 32 0t34 0" fill="none" stroke="#9b6d4f" strokeWidth=".8" opacity=".22" /></pattern>
            <linearGradient id="glass" x1="0" x2="1"><stop stopColor="#b9d8d5" stopOpacity=".58" /><stop offset="1" stopColor="#edf4e8" stopOpacity=".3" /></linearGradient>
            <linearGradient id="wall-light" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#fff3d0" stopOpacity=".9" /><stop offset="1" stopColor="#fff3d0" stopOpacity="0" /></linearGradient>
            <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#2c211b" floodOpacity=".2" /></filter>
            <filter id="lamp-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" /></filter>
            <pattern id="brick" width="36" height="18" patternUnits="userSpaceOnUse"><rect width="36" height="18" fill="#b77f6e" /><path d="M0 1h36M0 17h36M18 1v8M0 9h18M30 9h6" stroke="#8e5d55" strokeWidth="1.5" opacity=".45" /></pattern>
          </defs>
          <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="#f3eadc" />
          <g transform={`translate(${VIEW_WIDTH / 2 + camera.x} ${150 + camera.y}) scale(${camera.zoom})`} className={floorPalette}>
            <polygon points={floorPolygon()} fill="url(#oak-grain)" stroke="#6c5146" strokeWidth=".35" filter="url(#soft-shadow)" />
            <polygon points={"0,0 16,0 16,1.1 0,1.1"} fill="url(#brick)" opacity=".88" />
            <polygon points={"0,0 1.1,0 1.1,10 0,10"} fill="#d2b8a1" />
            <g className="world-windows"><path d="M2.2 .15h2.6v.78H2.2zM6 .15h2.6v.78H6zM9.8 .15h2.6v.78H9.8zM13.6 .15h1.5v.78h-1.5z" fill="#c9e0db" stroke="#f6f0df" strokeWidth=".1" /><path d="M2.2 .93h12.9" stroke="#6c7771" strokeWidth=".12" /><path d="M2.3 1.05v-.7M6.1 1.05v-.7M9.9 1.05v-.7M13.7 1.05v-.7" stroke="#f8f3e9" strokeWidth=".08" /></g>
            <g className="world-lamps"><ellipse cx="4.2" cy="1.35" rx=".72" ry=".18" fill="#f5c875" opacity=".35" filter="url(#lamp-glow)" /><ellipse cx="4.2" cy="1.35" rx=".22" ry=".08" fill="#ffe2a0" /><ellipse cx="10.4" cy="1.35" rx=".72" ry=".18" fill="#f5c875" opacity=".35" filter="url(#lamp-glow)" /><ellipse cx="10.4" cy="1.35" rx=".22" ry=".08" fill="#ffe2a0" /></g>
            <g className="world-rug"><ellipse cx="8" cy="5.2" rx="5.1" ry="2.45" fill="#b18f83" opacity=".43" /><ellipse cx="8" cy="5.2" rx="4.65" ry="2.05" fill="none" stroke="#d8c2ad" strokeWidth=".12" opacity=".65" /></g>
            <g className={`world-feature feature-${profile.tone}`} aria-label={profile.detail}>
              {profile.tone === "archive" && <><path d="M12 1.65h2.1v2.2H12zM14.2 1.65h1.1v2.2h-1.1z" fill="#7c513e" /><path d="M12.18 2h1.55M12.18 2.35h1.55M14.35 2h.75M14.35 2.35h.75" stroke="#e4c08e" strokeWidth=".11" /></>}
              {profile.tone === "infrastructure" && <><rect x="12.2" y="1.65" width=".7" height="2.4" rx=".08" fill="#39484c" /><rect x="13.05" y="1.65" width=".7" height="2.4" rx=".08" fill="#4d5b5b" /><path d="M12.38 2.05h.32M12.38 2.5h.32M13.23 2.05h.32M13.23 2.5h.32" stroke="#8fcfc2" strokeWidth=".12" /></>}
              {profile.tone === "cafe" && <><path d="M3 2.1h3.2v1.2H3z" fill="#8f604a" /><path d="M3.35 2.1v-.45h.55v.45M4.45 2.1v-.45H5v.45" stroke="#e1bd88" strokeWidth=".14" /><circle cx="7.2" cy="7.5" r=".7" fill="#d7a370" /><circle cx="8.7" cy="7.5" r=".7" fill="#d7a370" /></>}
              {profile.tone === "lounge" && <><path d="M11.1 6.8h2.9v1.15q0 .45-.45.45h-2.1q-.35 0-.35-.45z" fill="#8c6559" /><path d="M11.1 6.8v-.5h2.9v.5M11.3 8.4v.55M13.8 8.4v.55" stroke="#654a42" strokeWidth=".16" /></>}
              {(profile.tone === "engineering" || profile.tone === "cad" || profile.tone === "design") && <><path d="M2.1 7.2h2.6v1.4H2.1z" fill="#d4b187" /><path d="M2.35 7.45h2.1M2.35 7.8h1.5M2.35 8.15h1.9" stroke="#668e91" strokeWidth=".11" /></>}
              {(profile.tone === "analytics" || profile.tone === "quality" || profile.tone === "automation") && <><rect x="11.8" y="7.1" width="2.7" height="1.4" rx=".08" fill="#4c6467" /><path d="M12.15 8.05l.45-.45.35.2.55-.6.55.3" fill="none" stroke="#a8d5c1" strokeWidth=".12" /></>}
              {profile.tone === "lobby" && <><path d="M6.3 4h3.4v1.25H6.3z" fill="#815844" /><path d="M6.8 4v-.35h2.4V4" stroke="#e3c293" strokeWidth=".13" /></>}
            </g>
            {zones.map(zone => {
              const p = point(zone.x, zone.y);
              const q = point(zone.x + zone.w, zone.y);
              const r = point(zone.x + zone.w, zone.y + zone.h);
              const s = point(zone.x, zone.y + zone.h);
              return <g key={zone.label} className="world-zone" aria-label={zone.label}><polygon points={`${p.x},${p.y} ${q.x},${q.y} ${r.x},${r.y} ${s.x},${s.y}`} fill="url(#glass)" stroke="#789b99" strokeWidth=".12" /><text x={(p.x + r.x) / 2} y={(p.y + r.y) / 2} textAnchor="middle">{zone.label}</text></g>;
            })}
            {desks.map(desk => renderDesk(desk, desk.occupiedBy === selectedEmployeeId, () => { if (desk.occupiedBy && canSelect()) onEmployeeSelect(desk.occupiedBy); }))}
            {floorEmployees.map(employee => <EmployeeMarker key={employee.employeeId} employee={employee} selected={employee.employeeId === selectedEmployeeId} onSelect={() => focusEmployee(employee)} />)}
            <g className="world-decor" aria-label="Декор этажа"><circle cx="2" cy="8.8" r=".55" fill="#6d9b79" /><circle cx="1.6" cy="8.5" r=".55" fill="#89b58b" /><path d="M2 8.8v1" stroke="#805a40" strokeWidth=".12" /><path d="M14.2 0.3v-.65M14.2-.35l-.55-.4M14.2-.35l.6-.4" stroke="#d29c58" strokeWidth=".12" /></g>
          </g>
          <text x="34" y="40" className="scene-floor-label">ЭТАЖ {floor.number}</text>
          <text x="34" y="62" className="scene-help">перетаскивайте сцену · колесо / два пальца — масштаб</text>
        </svg>
        <div className="scene-status"><span className="status-dot" /> {floor.kind === "department" ? "Команда в работе" : "Открытая зона"}</div>
      </div>
      <div className="scene-footer"><span>Один этаж · {desks.length} рабочих мест</span><span>{floor.decorAsset ? "локальный интерьерный слой" : "модульная интерьерная сцена"}</span></div>
    </section>
  );
}

export const FLOOR_VIEW_METADATA: readonly FloorMetadata[] = withOccupancy(createDemoEmployees());
export type { DeskObject, FloorMetadata, WorldEmployee };
export { FLOOR_METADATA, isFloorId };
