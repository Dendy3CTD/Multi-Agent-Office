# MAO-GFX-29-D — CINEMATIC LIGHTING REPORT

> Исторический отчёт этапа I. Позже модуль подключён в этапе E; актуальная интеграция, роль `oak-floor` и `releaseMaterials` описаны в [INTEGRATED PREMIUM FLOOR REPORT](../integration/REPORT.md).

Статус: **PARTIAL**. Независимый модуль этапа I реализован и проверен. Файл `references/MAO-FLOOR02-APPROVED.png` отсутствует; поиск по `/home/danil` не обнаружил его. Поэтому анализ самого изображения, точное визуальное сравнение и окончательное художественное утверждение остаются незавершёнными. Этап II не запускался.

## 1. Анализ освещения референса

Доступно только текстовое описание задания: вечерний IT-лофт, естественный свет больших окон, локальные янтарные лампы, дуб, графит, читаемые лица и мебель. Из этого выведена схема с почти нейтральным дневным ключом, прохладным заполнением и ограниченными тёплыми пятнами. Числа ниже — самостоятельная настройка по описанию, а не измерения утверждённого PNG.

## 2. Предложенная схема света

Все позиции заданы в локальных Y-up координатах `floorRoot`, в метрах, для помещения 22 × 14. Группа следует трансформации корня. При интеграции желательно сохранить единичный масштаб корня.

| Источник | Цвет | Интенсивность | Позиция | Тени |
| --- | --- | ---: | --- | --- |
| Hemisphere | sky #e4edf4 / ground #8d9291 | 1.65 | глобальное заполнение | нет |
| Daylight Directional | #fff6e8 | 2.45 | (-8,13,8), target (0,0,0) | да |
| Front fill Directional | #d8e8f2 | 0.85 | (7,7,-8), target (0,0,0) | нет |
| Lounge Point | #ffd6a4 | 18 | (-9.2,2.5,4.6), distance 7 | нет |
| Meeting Point | #ffe6c4 | 22 | (7.1,3.5,-4.15), distance 8 | нет |
| Elevator Point | #dce7ed | 5 | (-5.4,2.4,-2.9), distance 4 | нет |
| Desk practicals Point | #ffdeb1 | 12 | (0,2.5,1), distance 6 | нет |

Итого семь источников, один shadow caster. PointLight используют decay 2. Desk practicals — один экономичный групповой источник; видимые лампы должны иметь собственный emissive материал. `lights` доступны интегратору для привязки к финальным светильникам. Существующие источники сцены модуль самостоятельно не удаляет.

## 3. Material adjustments

`PremiumMaterialPaletteV29` создаёт клон на пару исходный материал / семантическая роль и повторно использует его внутри сцены. Источники и текстуры не изменяются и не освобождаются. Сохраняются все карты, UV transform, vertex colours, alpha, side и параметры MeshPhysicalMaterial. Неизвестные и unlit материалы остаются исходными.

| Роль | Коррекция |
| --- | --- |
| Дуб | Linear RGB multiplier (.94,.98,1.04), roughness не ниже .70 |
| Кирпич | (.98,1,1.02), roughness не ниже .90 |
| Ткань | roughness не ниже .88, metalness 0 |
| Стекло | копия с сохранением opacity, transmission, depthWrite и цвета |
| Бронза / металл | metalness максимум .55, roughness .38–.65; остаётся diffuse составляющая без обязательной environment map |
| Кожа персонажей | исходный цвет, roughness не ниже .68, metalness 0 |
| Одежда / кожаные материалы | исходный цвет, roughness не ниже .88, metalness 0 |

Роли читаются из `mesh.userData.maoMaterialRoles[index]`, затем `material.userData.maoMaterialRole`, затем имени материала. Для финального пакета можно передать `resolveMaterialRole`. Нет глобальной замены wall материалов, обнуления цвета или подмены текстур, способных вернуть чёрные стены. Исправление ошибочного colorSpace в чужой текстуре сознательно не выполняется: цветовые карты должны приходить как sRGB, normal/roughness/metalness как NoColorSpace. Cleanup возвращает исходные material assignments, если их после применения не заменил другой владелец, и освобождает только собственные клоны.

## 4. Tone mapping

ACESFilmicToneMapping, output SRGBColorSpace, exposure **1.08**. Hex цвета интерпретируются штатным Color management Three; корректирующие множители материалов заданы в linear RGB. Глобальный `THREE.ColorManagement` модуль не меняет. Нет bloom, SSR, GI, LUT или дополнительных render targets для postprocessing.

Итерация 1: exposure 1.20, daylight 3.10, hemisphere 1.25, lounge 28, meeting 32. Визуально сильнее блики ламп и жёстче разделение света/тени.

Итерация 2: exposure 1.08, daylight 2.45, hemisphere 1.65, lounge 18, meeting 22. Снижен прямой и локальный свет, поднято заполнение. Светлые поверхности и лица сохраняют объём, тёмный металл читается, пол остаётся древесным. Дополнительно расширено кадрирование и уменьшен задний sky plane тестовой среды.

## 5. Тени

Один DirectionalLight с PCFSoftShadowMap 2048²; опция 1024² для слабых GPU. Shadow frustum: X ±17, Y ±14, near .5, far 48; bias -.00015, normalBias .035. PCF фильтрует края, но не имитирует широкие физические полутени: это осознанное ограничение лёгкой схемы. Основную мягкость контраста обеспечивает заполнение. AutoUpdate включён для движущихся людей; обновление происходит только при render вызывающей сцены. Модуль не меняет castShadow/receiveShadow чужих meshes. На тестовом рендере все углы объёма комнаты попадают в shadow frustum.

## 6. Фон

Нейтральный графит #30363c, без узоров и fog. Граница пола читается за счёт света и существующей геометрии цоколя, а не дополнительного пола или renderer. В preview здания стоят отдельными объёмами на нескольких глубинах за оконными проёмами; sky plane также вынесен за стену. В production модуль владеет только `scene.background`, а внешняя городская геометрия остаётся ответственностью архитектуры. Уменьшенный sky plane в fixture местами виден за силуэтом стены; окончательная маскировка и окружение проверяются на готовой архитектуре этапа II.

## 7. Камера

Предложение для hero shot: OrthographicCamera, position (19,20,-23), target (0,1.1,0), verticalSpan 23, default zoom 1, zoom .72–1.8, near .1, far 150. При aspect 1.5: left/right ±17.25, top/bottom ±11.5. При resize горизонтальный охват = verticalSpan × aspect; на узких окнах потребуется fit по проекции bounds. Для pan/zoom использовать существующий controller. Рекомендация предполагает корень в исходном мировом положении; при переносе корня преобразовать target и offset. Модуль принимает существующую camera, возвращает её ссылку и рекомендацию, но не изменяет ни её, ни controller. В preview все углы помещения 22 × 5.4 × 14 попадают в кадр; приближение zoom 1.8 намеренно допускает обрезку общего плана.

## 8. Скриншоты preview

Независимая процедурная сцена: дуб с sRGB текстурой, кирпич, столы, диван, люди-пробы, стекло, графит, бронза, лампы и восемь диагностических сфер. Никакие незавершённые модули A/B/C не импортируются. Геометрия служит проверке света и материалов, не заменяет финальный asset pack.

- [Итерация 1](screenshots/iteration-1.png)
- [Итерация 2](screenshots/iteration-2.png)
- [Метрики](screenshots/metrics.json)

Оба изображения просмотрены; визуально подтверждены текстура дуба, прозрачность стекла, читаемая кожа, металлические блики и различимые тени. Сравнение с утверждённым изображением пока невозможно: PNG отсутствует.

## 9. Тесты

Пройдено 7 Vitest tests: восстановление renderer/background, владение светом и shadow disposal, повторный cleanup/remount, валидация exposure, rollback при ошибке resolver, сохранность source textures/UV/physical glass, многоматериальные meshes и поздняя загрузка, отсутствие повторной коррекции, сохранение чужих назначений материалов, читаемый diffuse у металла и неизменность skin albedo.

TypeScript `tsc --noEmit` для apps/office проходит. Browser check на настоящем WebGL renderer в headless Chromium / SwiftShader проходит для обеих итераций. Проверены camera/shadow bounds, source material ownership, renderer restoration, удаление света и отсутствие продолжающихся кадров после cleanup.

| Метрика preview | Итерация 1 | Итерация 2 |
| --- | ---: | ---: |
| Draw calls (основной render, без shadow pass) | 95 | 95 |
| Triangles (основной render) | 16044 | 16044 |
| Renderer textures со светом | 2 | 2 |
| Доля полностью белых пикселей, RGB ≥254 | .02257% | 0% |
| Доля почти чёрных пикселей, luminance <8 | 0% | 0% |
| Средняя luminance всего кадра, 0–255 | 74.65 | 73.61 |
| Shadow casting lights | 1 | 1 |

После cleanup и повторного render textures уменьшаются с 2 до 1: остаётся исходная деревянная карта. Pixel метрики относятся ко всему изображению с тёмным фоном; они не являются оценкой яркости только офиса. Точный FPS/VRAM production GPU и финального asset pack не измерялся. Структурная стоимость: один shadow pass, четыре point lights без теней, никаких дополнительных renderer/postprocess passes или постоянных loops.

Повторить из корня репозитория:

```sh
apps/office/node_modules/.bin/vitest run apps/office/src/office-3d/gfx29/lighting/lighting.test.ts
node apps/office/src/office-3d/gfx29/lighting/preview.browser-check.mjs
```

Для typecheck выполнить `./node_modules/.bin/tsc --noEmit` из `apps/office`. Browser check временно поднимает Vite только на 127.0.0.1, рендерит обе версии, записывает PNG/JSON в этот каталог и закрывает сервер/Chromium.

## 10. Изменённые файлы

Только `apps/office/src/office-3d/gfx29/lighting/`:

- `index.ts` — публичный lighting API и palette.
- `lighting.test.ts` — lifecycle/material tests.
- `preview.ts` — изолированная fixture, один явный render.
- `preview.browser-check.mjs` — автоматическая визуальная проверка.
- `screenshots/iteration-1.png`, `screenshots/iteration-2.png`, `screenshots/metrics.json`.
- `REPORT.md` — этот отчёт.

OfficeScene3D.tsx, CSS, asset pack, архитектура, персонажи, integration, конфигурации и зависимости не редактировались. Существующие чужие изменения в рабочем дереве не затрагивались.

## 11. API модуля

```ts
import { createPremiumLightingV29 } from './gfx29/lighting';
const lighting = createPremiumLightingV29({
  scene, renderer, camera, floorRoot,
  // exposure: 1.08,
  // shadowMapSize: 1024,
  // resolveMaterialRole: (material, mesh, index) => 'oak',
});
lighting.setExposure(1.08);
lighting.applyMaterials(newlyLoadedSceneLocalClone);
lighting.lights.lounge.position.set(-9.2, 2.5, 4.6);
// Existing application owns rendering and camera/controller updates.
lighting.cleanup();
```

Возвращаются `group`, `camera`, `lights`, `cameraRecommendation`, `setExposure`, `applyMaterials`, `cleanup`. Исходные материалы корректируются при создании; поздние assets требуют явного applyMaterials. Один активный модуль на renderer: повторный вызов до cleanup отклоняется. На время владения renderer не следует параллельно менять те же параметры другим preset: cleanup возвращает сохранённый snapshot. Scene и подключённый floorRoot должны принадлежать вызывающей стороне. API не dispose-ит renderer, scene, geometry и исходные текстуры.

## 12. Что потребуется при финальной интеграции

Только после отдельного задания на этап II: получить утверждённый PNG и законченные результаты A/B/C; подключить lighting вместо прежней схемы, устранить суммирование старых источников; привязать локальные источники к фактическим светильникам; передать семантические роли пакета; применить palette после загрузки clones; установить castShadow/receiveShadow нужным meshes с отдельной проверкой прозрачных перегородок; согласовать skyline и видимость sky за окнами; перенести camera recommendation в существующий pan/zoom controller и выполнить responsive fit; проверить лица, стены и дерево на финальных assets, сделать реальные общие и крупные планы и сравнение с PNG, затем проверить GPU стоимость и cleanup в приложении.

До получения PNG и отдельного разрешения на этап II статус остаётся PARTIAL.
