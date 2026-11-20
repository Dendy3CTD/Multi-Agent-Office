# MAO Hybrid Office V4 — Reference Map

All 15 approved references are local PNGs in `design-references/office-v4/`.
They are visual and spatial references only: the renderer must build real
Three.js geometry and must not use these images as textures, billboards, or
scene backgrounds. The common visual language is a cutaway loft: warm oak
flooring, exposed terracotta brick along the window side, black steel
panoramic windows, warm plaster, dark walnut storage, graphite metal, bronze
lighting, sage/clay upholstery, plants, and a dark exterior void. The
department-specific work areas below are the distinguishing features to
recreate.

| Reference / UI | Logical floorId | MAO Hybrid department or use | Plan and distinctive 3D content |
|---|---|---|---|
| `floor-01.png` / 01 | `floor-00` | Lobby & Reception | Reception desk against the branded plaster wall; a check-in kiosk in the central approach; coffee point by the window wall; glass meeting room at the front-left; guest lounge seating at the right. |
| `floor-02.png` / 02 | `floor-01` | Management | Enclosed executive office at the rear-right; management work desks in the center; glass boardroom at front-left; guest/lounge corner, storage and coffee counter. |
| `floor-03.png` / 03 | `floor-02` | Software Development | Several paired-monitor developer desk pods; open stand-up/huddle area with whiteboard; code-review screen on the right; quiet focus pod; glass team room at front-left and lounge at rear-right. |
| `floor-04.png` / 04 | `floor-03` | Quality Assurance | Device and test benches on the window side; central QA desk banks; triage table and board; review display on the rear/right wall; small test/review zone and glass meeting room. |
| `floor-05.png` / 05 | `floor-04` | Engineering Electronics | Electronics benches with scopes and test equipment along the windows; component storage; central engineering desks; shared prototype/board bench; glass review room and lounge. |
| `floor-06.png` / 06 | `floor-05` | CAD & 3D | CAD workstations with large displays; model/prototype workbench; dedicated 3D-printer island at the front-right; glass meeting room and lounge. |
| `floor-07.png` / 07 | `floor-06` | Research & Analytics | Analytics wall display; analyst desks and dashboard screens; insight/whiteboard area; quiet research or library nook at front-right; glass meeting room and lounge. |
| `floor-08.png` / 08 | `floor-07` | Documentation | Archive shelving and document storage; writing/editing desks; shared documentation table; review display and reading nook; glass meeting room. |
| `floor-09.png` / 09 | `floor-08` | Design | Collaborative design tables; moodboard/gallery wall with task lighting; individual digital design stations; material/reference shelving; review lounge and glass collaboration room. |
| `floor-10.png` / 10 | `floor-09` | Finance & Estimates | Finance and estimating desk pods; budgeting/planning table and display; approval/estimate meeting area; secure filing/storage; smaller discussion nook and glass meeting room. |
| `floor-11.png` / 11 | `floor-10` | DevOps | Monitoring wall with CI/CD, service and telemetry panels; central multi-monitor operations desks; enclosed server room with illuminated racks; glass incident/meeting room and lounge. The reference includes UI overlays; do not reproduce those overlays as scene artwork. |
| `floor-12.png` / 12 | `floor-11` | Automation & Integrations | Large workflow/integration dashboard wall; automation desk pods; integration diagram boards and a mobile whiteboard; glass collaboration room; planted lounge. |
| `floor-13.png` / 13 | `floor-12` | Security Review | SOC dashboards and alert display; separated security analyst desk rows; secure glass research room; threat-analysis board and a small recovery/lounge zone. |
| `floor-14.png` / 14 | `floor-13` | Kitchen & Cafe | Continuous cafe counter against the right wall with espresso machine, grinders and refrigerated case; back-bar shelves; bar seating; cafe tables, banquette/lounge seating and a foosball table. The reference itself indicates zero assigned employees; do not invent staff. |
| `floor-15.png` / 15 | `floor-14` | Lounge & Meeting Rooms | Multiple glass meeting rooms and informal conversation nooks; central sofa/coffee-table lounge; cafe-height counter and seating; recreation zone with pool and foosball tables; plants and book/display shelves. Do not invent employees. |

## Identity and routing notes

The UI numbering and logical `floorId` mapping above follow the Office V4
brief. Employee `employeeId`, `departmentId` and `deskId` remain owned by the
existing company directory. Preset authors may provide spatial positions and
specialized prop IDs, but must not create or rename employees. Reserve desks
are explicit unoccupied workplace records. Lobby, cafe and lounge props do not
imply staffing.

The current MAO Hybrid world/tower route has its own legacy floor numbering.
The integration adapter is responsible for translating this V4 logical map
to the existing route without changing directory data. Keep that translation
in the shared registry/adapter; do not encode legacy offsets into individual
group presets.

Reference PNGs contain illustrative people, text, UI panels and counts that
may not match the live directory. Render only actual directory employees and
directory counts. Screen content and signage are scene props, not authoritative
company or task data.
