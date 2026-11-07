import { useState } from "react";
import { FLOOR_METADATA, OfficeScene, createDemoEmployees } from "./index";
import "./world-preview.css";

export default function WorldPreview() {
  const employees = createDemoEmployees();
  const [floorId, setFloorId] = useState("floor-2");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>();
  return (
    <main className="world-preview">
      <nav className="world-floor-nav" aria-label="Этажи">
        <div><strong>MAO / OFFICE WORLD</strong><small>offline scene preview · synthetic directory</small></div>
        <div className="world-floor-buttons">{FLOOR_METADATA.map(floor => <button key={floor.id} className={floor.id === floorId ? "is-active" : ""} onClick={() => setFloorId(floor.id)}>{floor.number}</button>)}</div>
      </nav>
      <OfficeScene floorId={floorId} employees={employees} selectedEmployeeId={selectedEmployeeId} onEmployeeSelect={setSelectedEmployeeId} />
    </main>
  );
}
