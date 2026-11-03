# Changelog

## 2026-11-01 — Fix V2: живые сотрудники и русский demo-чат

- Исправлена причина неподвижности `?sim`: `seatSimAgent` обнулял позиции,
  цели и маршруты всех сотрудников сразу после создания. Теперь четыре
  сотрудника проходят существующий маршрут от входа к рабочим местам.
- Добавлен локальный детерминированный demo-тур: каждый сотрудник посещает
  доску задач и возвращается к своей безопасной точке. События не используют
  WebSocket, LLM или фиктивные серверные ответы.
- AnimationController вынесен в независимый injectable clock с корректным
  lifecycle. Debug-режим показывает статус, позиции, цель, направление,
  анимацию, кадр, FPS, состояние clock и длину маршрута.
- Исправлен расчёт размера кадра: generated sheets используют реальные размеры
  исходников `Me-1`, `Frontend-dev-1`, `dev-2` и `employee-2`, а не общий
  `450×1024`. Это устраняет обрезание кадров у трёх персонажей.
- Demo-сценарии, сообщения чата, статусы и системные подписи переведены на
  русский; добавлены русскоязычные системные инструкции для четырёх ролей.

## 2026-11-01 — Desktop Polish V1

- Electron now computes its initial content area from the primary GNOME
  workarea, preserving the baked scene ratio `1672:941`, centering the window
  and accounting for the title bar while remaining resizable.
- Each of the four workstations now has separate desk bounds, chair bounds,
  standing point, approach point and interaction point. Initial `desk` spots
  remain compatible with the live reducer, but their coordinates are safe
  standing positions outside the furniture.
- Fixed generated sheet frame clearing: transparent frame translations used to
  composite over the old frame and could look static. Walking/idle/working/
  coffee sheets were regenerated with six or four actual frames respectively.
- Added Russian locale-by-default UI labels, role names and state labels;
  internal IDs and protocol fields remain unchanged. Debug labels now name all
  four employees in Russian.
- Added workstation geometry, route safety, frame-count/position and window
  sizing tests. Typecheck, Vitest and production build pass.

## 2026-11-01 — Electron production HTTP loading

- Replaced Electron production `loadFile()` with an ephemeral localhost HTTP
  server serving `apps/office/dist` on `127.0.0.1`.
- Added safe static-file resolution, traversal protection, MIME types, SPA
  fallback and clean server shutdown.
- Kept the existing `?sim` entrypoint and WebSocket behavior unchanged; sim
  mode does not connect to or fabricate backend activity.
- Added Electron load, renderer console and render-process diagnostics to the
  application log at Electron's normal per-user logs directory.

## 2026-11-01 — Debian desktop application

- Added an Electron main process with a single-instance, resizable 1000×700
  minimum window, local production loading and hardened web preferences.
- Production desktop launches the existing `?sim` mode, preserving the four
  staff members, room, animations, collisions, Task Board, events,
  notifications and Debug mode without fabricating LLM activity.
- Added a project-local pixel office icon in PNG sizes 32, 128, 256 and 512.
- Added `scripts/launch-desktop.sh`, `scripts/install-desktop.sh` and
  `scripts/uninstall-desktop.sh`, including GNOME favorite preservation and
  duplicate prevention.

## 2026-11-01 — Multi-frame character animations

- Added generated frame sheets under
  `apps/office/public/sprites/characters/animations/` for `Me-1`,
  `Frontend-dev-1`, `dev-2` and `employee-2`.
- Each direction has six walking frames and four working, idle and coffee
  frames. Frames preserve the source PNG palette, proportions and alpha.
- `Character.tsx` now renders the sheets with a state-independent timer and
  switches directional sheets from actual movement deltas.
- Added safe fallback to the original directional PNG for ungenerated themes
  or character bases.

## 2026-11-01 — Scene geometry and collision diagnostics

- Added a single 1672×941 scene-coordinate contract and measured collision
  shapes for desks, chairs, sofa, coffee table, kitchen, cabinets and plants.
- Added separate interaction hitboxes and workstation chair targets; the baked
  furniture renderer remains disabled.
- Added `?sim&debug=1` overlays for red obstacles, blue interaction areas,
  green destinations, routes, character anchors and source-image cursor pixels.
- Added route/resize/hitbox/animation-clock tests and captured
  `data/debug-collisions.png`, `data/debug-interactions.png` and
  `data/debug-animations.png`.
- Audited `references/claude-office-main`: its character assets are single
  directional PNGs, not walking/working sprite sheets. The frame-clock
  infrastructure is present, but true visible per-frame character animation
  remains blocked until actual multi-frame assets are supplied.

## 2026-11-01 — Four-person room texture

- Switched the office scene to `office-four-person.png` (1672×941), preserving
  its aspect ratio and using the baked four-desk composition as the visual
  source of truth.
- Repositioned desk, coffee, board, printer, plant and incident interaction
  anchors to the new room.
- Kept the original character states, movement, speech/effect bubbles, task
  board, notifications and incident overlays; removed the old furniture render
  layer from this scene to prevent duplicate tables and chairs.

## 2026-11-01 — Four-person isometric office

- Reworked the main room into exactly four desk spots: Director, Developer,
  Engineer and Analyst.
- Added per-station collision rectangles; the previously generated chair SVG
  assets remain available for other room variants but are not rendered over
  this texture because its four chairs are baked into the PNG.
- Replaced the unsafe waypoint-plus-final-line movement with collision-aware
  A* navigation, diagonal corner protection and per-tick swept checks.
- Added automated layout, route and diagonal collision tests.
- Preserved chat, inspector, task board, notifications, metrics and the
  original Claude Office assets; `references/claude-office-main/` is unchanged.
