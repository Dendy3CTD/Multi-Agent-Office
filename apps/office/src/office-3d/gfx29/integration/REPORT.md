# MAO-GFX-29-E — INTEGRATED PREMIUM FLOOR REPORT

**Статус: PARTIAL по художественной приёмке. Техническая интеграция выполнена.** Изменения находятся непосредственно в `OfficeScene3D`, видны на главной странице MAO Tower и в production build. Полное визуальное качество утверждённого PNG пока не достигнуто; точные оставшиеся ограничения перечислены в пункте 15. Функциональных блокеров в выполненных проверках не обнаружено.

Просмотр: **http://localhost:3003/** — запущен localhost Vite с обновлённой настоящей главной страницей. Доступен обычный pan/zoom; интерфейс, данные сотрудников и меню этажей существующие.

## 1. Какие модули подключены

- A: существующий `OfficeArtRuntime`, активный `v1/office-pack.glb`, manifest `mao-office-art-v2`: 79 IDs / 48 моделей. Повторной генерации или изменения pack нет.
- B: настоящий async `createPremiumArchitectureV29` и `createArchitectureAssetAdapter`, default artIteration 2, `strictPlacement: true`. Исходники architecture не редактировались.
- C: прочитан README и исходный код, выполнено сравнение на настоящей главной странице. Процедурный вариант сохранён как DEV-only comparative mode, default production использует проверенные GLB. Модуль C не редактировался.
- D: единственный `createPremiumLightingV29`, сценовая palette и cleanup. Добавлены отдельная коррекция пола `oak-floor` и освобождение palette assignments удалённых сотрудников.
- `gfx29/integration/art-direction.ts`: собственные сценовые finishing assets/materials — дубовый пол, индивидуальные рубашки, пейзажные вставки в существующие рамы, кольцевой подвес переговорной. Это живые Three.js объекты и текстуры, не изображение вместо сцены.

Один активный renderer/canvas. StrictMode корректно освобождает renderer предыдущего mount после завершения его pending acquisitions.

## 2. Какие старые группы заменены

До изменения OfficeScene3D создавал две архитектурные сборки: процедурные стены/четыре окна/город/переговорную/lounge в fallback и GLB архитектуру через `interiorPlacements`/`northWindowAssembly`. Свет также создавался в scene, environmentRoot, fallback и fallback-лифте.

Удалены из пути построения Floor 02:

- процедурные северная/западная стены, четыре старых окна и skyline;
- старые стеклянные перегородки, ковёр, столы/кресла переговорной, диван/lounge, растения и procedural pendants;
- GLB `wall.brick.loft`, `wall.painted`, `window.frame` и все старые `interiorPlacements`;
- fallback-пол, fallback-сотрудники/столы и видимый fallback-лифт: обязательные реальные assets загружаются до открытия сцены, при ошибке остаётся штатный error/retry overlay.

`metadata.replaceLegacy` используется как guard: общий asset placer отказывается создавать заменённые архитектурные IDs. Новая архитектура создаёт их сама. Устаревшие procedural Mesh были преимущественно без имён, поэтому убраны именно места их создания — не применён широкий фильтр к чужим объектам. `interior.ts` оставлен как существующий legacy utility, но OfficeScene3D больше его не вызывает.

Сохранены настоящий пол, 12 desk slots, резервное место, сотрудники, семь компонентов лифта, menu callback и controller. `elevator-animation-state` — пустой Group для состояния открытия, не второй физический лифт.

## 3. Как подключён asset pack и кому принадлежат ресурсы

Manifest загружается через существующую границу, имена узлов нормализуются по правилам GLTFLoader. Тот же runtime обслуживает рабочие места, архитектуру и лифт.

| Ресурс | Владелец | Освобождение |
| --- | --- | --- |
| WebGLRenderer / canvas | mounted OfficeScene3D | после content cleanup: dispose, forceContextLoss, removal |
| Пол, 12 рабочих мест и семь частей лифта | OfficeScene3D `artInstances` | ровно один release через `runtime.disposeInstance` |
| GLB-сотрудники | reconciler по employeeId/deskId/status | перед заменой palette release, finishing release, runtime release |
| 32 GLB архитектуры | модуль B | `architecture.dispose()` → adapter releaseAsset |
| Инстансинг/geometry/material/maps B | модуль B | только его собственный dispose |
| Свет, shadow map, palette clones | D | `lighting.cleanup()` с renderer state restoration |
| Кольцо, картины-вставки, пол/рубашки finishing | integration helper | собственные geometry/material/maps и восстановление source assignments |
| Shared documents/material library/maps runtime | runtime, управляемый сценой | disposeSharedResources после всех pending operations и возврата instances |

При cleanup сначала останавливаются события/RAF и abort-ится сборка, затем восстанавливаются palette и finishing assignments, освобождается B, ожидаются pending tasks, возвращаются оставшиеся late instances, очищается shared runtime. Только после этого уничтожается renderer. Так teardown не освобождает общий pack во время продолжающейся material/GLB загрузки.

Все параллельные placement operations зарегистрированы отдельно; employee updates используют allSettled, чтобы единичный отказ не оставлял незарегистрированные поздние acquisitions. Динамический palette release удаляет ссылки на старые meshes и освобождает clone, когда последний пользователь исчезает.

## 4. Как работает архитектура

Factory await-ится; неготовая/ошибочная комната не объявляется ready. Входные floorBounds: −11…11 / −7…7. Передаются настоящие 12 мест из SHOWROOM_LAYOUT с исходными deskId/employeeId. `floorY` измеряется из загруженного пола: около .12 м. Мебель и персонажи получают соответствующую поправку высоты опоры; X/Z и orientation рабочих мест не меняются.

Окна и рамы B согласованы с проёмами, двухслойный город стоит за стеной. Есть кремовая боковая стена, два стеллажа со шкафами/растениями/лианами, переговорная с открытым входом, четыре кресла и ковёр; lounge с зелёным диваном, терракотовым креслом, круглым столом, ковром, торшером и растением.

Прозрачные architectural panes пропускают picking к сотрудникам; непрозрачные профили и мебель сохраняют raycast. Физические размеры furniture вычисляются B через Box3; текущая diagnostics valid, 15 маршрутов доступны. Новый пол архитектура не создаёт.

## 5. Какие персонажи выбраны и почему

Выбран **GLB**. Сравнение выполнено в одном приложении, при одинаковом свете, ракурсе и размере viewport; сохранены общий план и одинаковые close-ups обеих систем.

C лучше различает лица/одежду, но округлые плечи, толстые воротники/лацканы и шарообразные суставы выглядят как мягкие фигурки. В отдельных позах плечи визуально тесно сидят в кресле. Силуэт отличается от более естественных пропорций PNG; цена C существенно выше.

| Система, финальный общий кадр | Draw calls | Triangles | Geometries | Textures |
| --- | ---: | ---: | ---: | ---: |
| GLB, выбранная | 445 | 208,372 | 104 | 17 |
| C, сравнительная | 694 | 351,512 | 416 | 16 |

GLB поставлен в центр реального кресла на высоте пола; сохранено штатное seeded variant selection runtime. Рубашки получают устойчивую, привязанную к employeeId палитру и нейтральную ткань на сценовых клонах. Global materials/maps не меняются. employeeId/deskId/status сохраняются. При Directory/status update reconciler заменяет только нужного сотрудника и не пересоздаёт renderer; проверено перемещение обновлённой Directory identity на резервный desk.

Микроанимации C не включены в production. DEV-only `?debug=1&gfx29Characters=procedural` служит статическому сравнительному рендеру. Поскольку production использует GLB, дополнительных постоянных RAF для C нет. Модуль остаётся доступен для будущей художественной доработки.

## 6. Освещение

Полностью отключены прежние hemisphere/sun, lounge/meeting/fill, skyline glow, window fills и fallback lamp/elevator lights. Новые источники не суммируются со старой схемой.

Единый pipeline D: семь lights, один caster, PCFSoftShadowMap 1024², ACESFilmicToneMapping, sRGB output, exposure **1.02**. Итоговая scene tuning: daylight 1.65, hemisphere 1.18, front fill .80, lounge/meeting practicals 26; lounge привязан к фактической зоне (−9,2.35,−4.5), остальные источники остаются D.

Меньше общего wash, больше локального тёплого света. Пол имеет собственную карту дуба, отдельную linear correction (.90,.90,.84), roughness ≥.82; мебель сохраняет собственные цвета/текстуры. Ковры B остаются светлыми тканевыми; source maps runtime не повреждаются. Стены не заменяются чёрным материалом, текстуры не исчезают. Global THREE.ColorManagement не меняется.

Нет postprocessing, GI, SSR, bloom, второго renderer или второй render loop. Shadow frustum покрывает все углы пола. Renderer tone mapping/output/shadow settings и background восстанавливаются D при content replacement/cleanup.

## 7. Сравнение с утверждённым референсом

`references/MAO-FLOOR02-APPROVED.png` открыт как изображение, а не заменён описанием или старыми screenshots. Визуально изучены дальняя кирпичная стена/два окна, положение переговорной, lounge справа от лифта, шкафы, растения, картины и светильники. HUD из PNG не копировался.

Выполнены реальные этапы:

1. Baseline настоящей главной страницы до правок (`before-1366x768.png`).
2. Итерация 1: B в OfficeScene3D, исходный D вместо старого света, оба варианта сотрудников. Выявлены большое поле вокруг сцены, жёлтый дуб, одинаковая одежда и несовпадающий подвес.
3. Итерация 2: локальные материалы пола/рубашек, кольцо переговорной и пейзажи в рамах, корректировка заполнения/экспозиции и footprint framing.
4. Итерация 3: центрирование по проекции настоящих meshes, более плотный hero framing; сохранение GLB после сравнения C; высоты опоры мебели/персонажей.
5. Финальная коррекция: вечерний баланс daylight/fill/practicals и сохранение штатных GLB hair variants. Снимки обновлены после коррекции.

[Утверждённый PNG и реальный MAO Tower](screenshots/final-comparison-approved.png).

Сцена стала ближе по планировке, зонам, цветовым акцентам и архитектурным деталям. При этом простота лиц/растительности/skyline и отсутствие сложного baked/indirect shading всё ещё заметно отличают её от PNG; полное художественное соответствие не заявляется.

## 8. Камера и композиция

Ортографический ракурс, offset (19,18.6,−23). Default target рассчитывается вокруг (0,1.6,0) с поправкой на центр проекции фактических bounds. Fit использует corners настоящих Mesh/InstancedMesh, а не огромный пустой прямоугольный объём над передним полом. Margin около 4.5%, aspect учитывается. Пустые поля уменьшены, все ключевые зоны видны на обоих разрешениях.

Сохранены pan, wheel anchoring, zoom .72…1.8, Fit Floor и Reset. Добавлен настоящий двухпальцевый PointerEvent pinch с подавлением случайного click после жеста; поддержка trackpad WheelEvent также сохранена. DeltaMode нормализован для Firefox line/page wheels.

Render остаётся invalidate-driven: redraw по событиям, состоянию или движущимся дверям. После завершения door damp animation frame count перестаёт расти. Нет множества RAF на сотрудников.

## 9. Коллизии

B проверяет 12 authoritative мест и существующий физический лифт. Для текущей сборки **0 placement issues**, **15/15 routes reachable**. Его radius-aware grid .12 м / radius .27 м не меняет внешний layout engine.

В настоящей сцене проверены оконные rays, bbox пола/мебели и попадание floor corners в shadow projection. Центры столов, 12 desk slots и 11 исходных employee assignments сохранены. Резервный desk используется динамическим reconciler без изменения layout engine.

Диагностика B статическая; это не проверка произвольной будущей перестановки или всех промежуточных состояний анимации. Отдельной физики столкновений персонажей сцена не вводит.

## 10. Интерактивность

**30 настоящих WebGL regression checks прошли** (`scene.browser-check.mjs`), включая:

- trusted pointer click по поверхности GLB дверей и call-panel; callback ровно один раз;
- door motion и возврат точных local base transforms;
- employee click, выбор без elevator callback; мебель/lounge не вызывает лифт;
- drag suppression, pan, subsequent click, wheel zoom, two-touch pinch, Fit и Reset;
- equivalent props сохраняют renderer/canvas; Directory identity/desk/status update;
- hover clear, loading/ready/error, slow-load unmount, missing mandatory GLB, WebGL creation failure;
- StrictMode/remount и ресурсный cleanup;
- реальное меню лифта и Floor 02 → 03 → 02 на главной странице.

Дополнительный premium runner намеренно отклонил GLB network request и нажал **настоящую кнопку «Повторить загрузку»**. Error → retry → ready прошло. Затем трижды переключил реальные этажи: в каждом retired renderer 0 geometries / 0 textures, новая сцена имеет одинаковые resident counters. При devicePixelRatio 2 после нового mount renderer DPR точно 1.5.

**Firefox 140 ESR** проверен отдельно на настоящей главной странице: WebGL ready, native wheel, Fit, trusted click по физическому лифту, анимация дверей, trusted employee click с открытием реального профиля. Это headless functional test, не benchmark desktop/Iris Xe. Runner использует стандартный [WebDriver BiDi Firefox](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection), без новых зависимостей и без изменений пользовательского browser profile.

## 11. Производительность до/после

Основной render pass, DPR 1, реальные counters одной и той же главной страницы. Shadow-pass triangles не включены: установленный Three сбрасывает info после shadow render.

| Метрика | До | Финальная GLB сцена |
| --- | ---: | ---: |
| Draw calls | 440 | 445 |
| Triangles | 171,100 | 208,372 |
| Geometries | 120 | 104 (105 после показа hover helper) |
| Textures | 12 | 17 |
| GLB bytes | 1,559,768 | 1,559,768 |
| Shadow-casting lights | 1 | 1 |
| DPR cap | 1.5 | 1.5 |

Calls +1.1%, triangles +21.8%; geometry count снизился. Дополнительные texture allocations относятся к архитектуре и сценовой отделке. GLB не увеличивался. Три floor round trips показали стабильные 104 geometries / 17 textures новых сцен и нулевые counters retired сцен. Выбор C добавил бы 249 calls и 143,140 triangles, поэтому он не включён по умолчанию.

Chromium тестировался с SwiftShader. Firefox — headless functional rendering. Никакие эти результаты не выдаются за FPS или VRAM Intel Iris Xe. Реальная производительность на Debian 13 / Iris Xe требует запуска на целевом устройстве.

## 12. Изменённые файлы

- `apps/office/src/office-3d/OfficeScene3D.tsx` — реальная интеграция, удаление старых сборок/света, ownership, employee reconciliation, camera fit и pinch.
- `apps/office/src/office-3d/office-scene-3d.css` — согласованная тёмная тема сцены.
- `apps/office/src/office-3d/scene.browser-check.mjs`, `scene.browser-fixture.tsx` — актуальные WebGL queries/assertions, pinch и cleanup checks; screenshots перенаправлены в разрешённую папку.
- `gfx29/lighting/index.ts`, `lighting.test.ts`, `REPORT.md` — palette release/refcounts, отдельная роль пола, два дополнительных tests и историческая ссылка на текущую интеграцию.
- `gfx29/integration/art-direction.ts`, `premium.browser-check.mjs`, `firefox.browser-check.mjs`, `verify-format.mjs`, этот `REPORT.md` и `screenshots/**`.

Production build обновила стандартные generated dist artifacts. Исходники architecture, characters, office-art, public/office-art, office-layout, application integration, office-ui, backend, package configs и lockfile не редактировались. Существующие чужие изменения не откатывались; commit/push/reset/clean и удаление untracked не выполнялись.

## 13. Результаты проверок

- Frontend: **22 test files, 145 tests PASS**.
- TypeScript: **PASS** (`tsc --noEmit`).
- Production build: **PASS** (`npm run build`). Vite сообщил о большом основном chunk (~831 kB, gzip ~233 kB) и смешанном static/dynamic import OfficeScene3D; build успешен, конфигурации/зависимости не менялись.
- Собранная production главная страница: **PASS**, ready, `architecture=premium-v29`, `characterMode=glb`, один canvas, семь elevator assets, 445 calls / 208,372 triangles. Debug inspection при этом не требуется.
- GFX-27R/WebGL regression: **30 checks PASS**.
- Main-page retry, три floor cycles, ресурсные invariants, DPR cap: **PASS**.
- Firefox native interactions: **PASS**.
- `git diff --check`: **PASS**. Отдельный `verify-format.mjs` проверяет task-owned TS/TSX/MJS/CSS/Markdown, включая untracked: trailing whitespace, LF, final newline и parsing. В репозитории нет отдельного configured formatter для этого scope; проверки не выдаются за Prettier.

Воспроизведение:

```sh
# apps/office
npm test
npm run typecheck
npm run build

# repository root
node apps/office/src/office-3d/scene.browser-check.mjs
node apps/office/src/office-3d/gfx29/integration/premium.browser-check.mjs --label=final
node apps/office/src/office-3d/gfx29/integration/premium.browser-check.mjs --production
node apps/office/src/office-3d/gfx29/integration/firefox.browser-check.mjs
node apps/office/src/office-3d/gfx29/integration/verify-format.mjs
```

Тестовые servers и browser profiles временные, только localhost. Browser checks не подменяют OfficeScene3D mockup-компонентом.

## 14. Скриншоты

Все обязательные изображения — из настоящего приложения:

1. [Floor 02 — 1366×768](screenshots/final-glb-1366x768.png).
2. [Floor 02 — 1920×1080](screenshots/final-glb-1920x1080.png).
3. [Переговорная крупно](screenshots/final-glb-meeting.png).
4. [Lounge и физический лифт](screenshots/final-glb-lounge.png).
5. [Сотрудники крупно](screenshots/final-glb-employees.png).
6. [Утверждённый PNG рядом с приложением](screenshots/final-comparison-approved.png).
7. [GLB и C при одинаковом свете/ракурсе](screenshots/final-comparison-characters.png).
8. [Firefox ESR](screenshots/firefox-floor02-1366x768.png).
9. [Production build](screenshots/production-floor02-1366x768.png).

Сохранены также before, iteration-1/2/3 кадры, обе системы сотрудников и JSON metrics/lifecycle/production/Firefox/format results. Comparison sheets лишь располагают рядом исходный PNG и уже полученные application screenshots; они не являются подменой сцены.

## 15. Оставшиеся визуальные отличия и блокеры полного художественного статуса

1. **Сотрудники:** выбранный GLB всё ещё low-poly, с простыми лицами и ограниченной позой рук; C имеет более развитые лица, но чрезмерно округлые плечи/воротники и гораздо больший draw budget. Ни один не достигает естественных людей PNG. Полная коррекция потребует отдельной доработки персонажного модуля/asset pack, которые здесь разрешено только подключать.
2. **Окружение:** skyline B остаётся геометрическим городом, растения и свисающая листва условнее референса. B подключён без скрытого изменения запрещённых исходников; качественный environment pass — отдельная работа его владельца.
3. **Свет/материалы:** реальные тени и локальные практические источники согласованы, но картинка PNG содержит значительно более сложное непрямое/контактное освещение и богатую поверхность материалов. Текущий быстрый pipeline намеренно не использует тяжёлые GI/SSR; полного совпадения нет.
4. **Композиция:** реальные неизменённые 12 slots дают другую плотность/размер центральной мебели относительно кадра. Camera fit улучшен, но столы/проходы не переставлялись ради копирования картинки.
5. **Целевая GPU:** desktop FPS/VRAM на Debian 13 / Intel Iris Xe не измерены. Headless/WebGL success не заменяет такую приёмку.

Интеграция технически полная и доступна на главной странице. Общий статус **PARTIAL** оставлен из-за существенной художественной разницы с утверждённым PNG и отсутствия аппаратной приёмки, а не из-за отсутствующего подключения модулей или незавершённых механических проверок.
