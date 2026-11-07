# MAO — IMPLEMENTATION MAP

Этапы 1.2–1.3 (MAO-ARCH-02/03). Карта соответствия архитектуры
MAO-ARCH-01…03 и существующего кода. Код на этом этапе не изменялся;
документ — основа для последовательной реализации без архитектурных
переделок (волны 1–8 — этап 2, см. §6a — этап 2).

Учитывает подтверждённые решения пользователя D-01…D-08
(ARCHITECTURE_DECISIONS.md, раздел «Подтверждённые решения пользователя»)
и их пересмотр этапом 1.3 (D-05/D-06, ADR-MAO-014).

## 1. Таблица соответствия компонентов

Статусы: ✅ реализовано · 🟡 частично · ❌ отсутствует.

| Компонент | Существующие файлы | Статус | Что требуется |
| --- | --- | --- | --- |
| C01 Employee Registry | `packages/orchestrator/src/agents.ts` (только таблица моделей) | 🟡 | Новый пакет `packages/directory` (D-01): реестр, CRUD, инициализация из `DEFAULT_AGENT_MODELS`, события аудита |
| C02 Profession Registry | нет (пустые `skills/roles/*` — не профессии) | ❌ | `packages/directory`: загрузчик `professions/*.md`, валидация схемы, версии, наследование |
| C03 Skill Registry | `skills/roles/` — 9 пустых каталогов | ❌ | `packages/skills`: сканер `SKILL.md`, валидация метаданных, SQLite-индекс, события |
| C04 Skill Resolver | нет | ❌ | `packages/skills`: интерфейс резолвера (контракт в API_CONTRACTS.md); реализация — после реестра |
| C05 Task Router | нет | ❌ | `packages/orchestrator`: модуль маршрутизации/планирования (rules-first), DAG подзадач |
| C06 Orchestrator | `packages/orchestrator/src/agent-execution-coordinator.ts`, `serial-queue.ts`, `factory.ts`, `errors.ts` | 🟡 | Координатор сохраняется как ядро; добавить планировщик, retry/эскалацию, восстановление, шину событий; приём `modelId` от C07 (ADR-MAO-004) |
| C07 Model Router | `DEFAULT_AGENT_MODELS` (статическая таблица) | 🟡 | `packages/model-manager`: `models.config.json`, каталог, фильтры, ранжирование, эскалация, статистика (D-08); этап 2: Model Gateway — runtime-aware выбор (ADR-MAO-011) |
| C08 Budget Manager | `packages/budget-manager/**` (376+ строк, тесты) | ✅ | Без изменений ядра; динамический лимит слотов от C20 (ADR-MAO-014, аддитивный канал); этап 2: Budget Guard + подписочные категории (ADR-MAO-012) — аддитивные интерфейсы |
| C09 Context Manager | `apps/office/src/agentLanguage.ts` (только инструкции 4 ролей) | 🟡 | `packages/orchestrator`: сборка контекста, токен-бюджет, секции; инструкции мигрируют в профили профессий |
| C10 Session Manager | поддержка `sessionId` в `runtime-opencode` и координаторе | 🟡 | `packages/orchestrator`: реестр сессий (SQLite), политика одной активной сессии на сотрудника, восстановление |
| C11 Concurrency Manager | `maxConcurrentTasks` в C08 (enforcement), `SerialQueue` (только usage) | 🟡 | `packages/orchestrator`: очередь с приоритетами; повышенный приоритет интерактивных запросов в общей очереди (D-06 в редакции 1.3); динамический пул: старт 2, цель до 20 (ADR-MAO-014) |
| C12 Result Validator | нет | ❌ | `packages/orchestrator`: детерминированные проверки → LLM-review по политике (ADR-MAO-007) |
| C13 Artifact Handoff | нет | ❌ | `packages/orchestrator`: манифесты артефактов, хэши, передача ссылок зависимым подзадачам |
| C14 Knowledge Manager | `docs/OBSIDIAN-ARCHIVE.md` (только спецификация) | ❌ | `packages/archive`: SQLite (better-sqlite3 или node:sqlite — решение при реализации), event store, outbox, экспортёр, FTS-поиск, бэкап |
| C15 OpenCode Runtime | `packages/runtime-opencode/**` (416 строк, тесты) | ✅ | Без изменений; интерфейс `CoordinatorRuntime` — контракт для Fake Runtime |
| C16 Server API | `apps/server/` — пустой каталог | ❌ | HTTP+WS сервер (127.0.0.1, токен), composition root, маршруты по API_CONTRACTS.md §6; этап 2: + `GET /v1/runtimes` и статусы портфеля |
| C17 Runtime Manager | нет | ❌ | модуль `packages/orchestrator` (этап 2): реестр адаптеров, capabilities, выбор по ModelSelection (ADR-MAO-010) |
| C18 Codex Runtime | нет | ❌ | новый `packages/runtime-codex` (этап 2): реализация `RuntimeAdapter` поверх авторизации ChatGPT; собственный парсер событий и ошибки |
| C19 Project Portfolio Manager | нет (реестр `projects` только в данных) | ❌ | модуль `packages/orchestrator` (этап 2): портфель 2–5 проектов, per-project политики, допуски (ADR-MAO-013) |
| C20 Resource Allocator | нет | ❌ | модуль `packages/orchestrator` (этап 2): динамическая цель слотов (старт 2 → до 20) и per-project квоты; подача в политику C08 (ADR-MAO-014) |
| — Общие типы | нет (`packages/shared` пуст) | ❌ | `packages/shared` (D-02): типы, события, redaction + `runtime.ts` (типы RuntimeAdapter, этап 1.3); см. раздел 2 |
| — Fake Runtime | инъекция `spawn` в тестах C15 | 🟡 | Оформить поставляемый fake `CoordinatorRuntime` (экспорт из `runtime-opencode/testing` либо `orchestrator/testing`); этап 2: fake-реализации для каждого RuntimeAdapter |

## 2. Что уже реализовано (сохраняется)

- Полный контур исполнения одной задачи: допуск C08 → запуск C15 →
  usage-дельты → запись в ledger → освобождение слота
  (`agent-execution-coordinator.ts: runTask`).
- Отмена: `cancelTask` → AbortController → SIGTERM/SIGKILL в C15
  (`coordinator.cancelTask`, `runtime terminate()`).
- Идемпотентный финансовый ledger: `JsonlUsageStore` с sha256-eventId,
  блокировкой на уровне пути и очередью на файл (`jsonl-store.ts`).
- Лимиты: на задачу (стоимость/токены/длительность), на агента в месяц,
  блокировка extra-бюджета, abort активных задач при блокировке
  (`budget-manager.ts: enforceTaskLimits, abortActiveTasksIfBlocked`).
- Редактирование секретов: `redactSecrets`/`sanitizeValue` в C15 —
  переносится в `packages/shared` как единый модуль (см. раздел 4, проблема
  M-01).
- Тестовая инфраструктура: vitest во всех трёх пакетах, fake через инъекцию
  `spawn` (runtime.test.ts), временные каталоги для JSONL.

## 3. Дублирование и пробелы в типах (вход для `packages/shared`)

Проверено по исходникам (без полного аудита):

| Дублирование | Где | Решение в shared |
| --- | --- | --- |
| Метрики usage: `RuntimeUsage` (поле `cost`) vs `UsageMetrics` (поле `costUsd`) — одинаковый набор из 7 полей | `runtime-opencode/src/index.ts:8-16`, `budget-manager/src/types.ts:3-11` | Канонический `UsageMetrics` в shared; адаптеры-мапперы остаются в своих пакетах (подробности M-01, раздел 4) |
| Паттерны идентификаторов (3 разных regex) | `orchestrator/…coordinator.ts:46-47`, `budget-manager/src/validation.ts:5`, `orchestrator/src/agents.ts:17-19` | `ids.ts`: единые паттерны и `assertIdentifier` |
| Извлечение sessionId из события | `runtime-opencode/src/index.ts: sessionFrom`, `orchestrator/…coordinator.ts: sessionFromEvent` | shared: `sessionIdFromEvent(event)` |
| Схема ошибок | runtime (9 классов), budget (4), orchestrator (7) — отдельные иерархии | Сохраняются (типизированность ценнее единообразия); shared объявляет только интерфейс `errorClass`-кодов для событий |

Типы, которых нет нигде (создаются в shared): `ProfessionProfile`,
`EmployeeProfile`, `SkillDescriptor`, `ModelDescriptor`, `Task`, `Subtask`,
`TaskPlan`, `ExecutionContext`, `SkillBundle`, `ModelSelection`,
`ValidationReport`, `ArtifactManifest`, `OfficeEvent` (конверт событий шины).

## 4. Выявленные проблемы и решения

- **M-01. Расхождение `cost` vs `costUsd`.** Поле стоимости названо
  по-разному в двух пакетах; координатор маппит вручную
  (`costUsd: usage.cost`). Решение: канонический тип shared использует
  `costUsd`; маппер `runtimeUsageToMetrics()` экспортируется из
  `runtime-opencode` (владелец формата событий CLI), маппер в `UsageRecord`
  остаётся в координаторе. Публичные API пакетов не ломаются.
- **M-02. Единая точка записи usage.** Чтобы избежать двойного учёта,
  единственный писатель в ledger C08 — координатор (как сейчас). Зеркало
  usage в SQLite (для ModelStats) заполняется импортёром C14, читающим
  JSONL в режиме только-чтение по `eventId` (идемпотентно). Никакой второй
  записи «напрямую в SQLite» из исполнения.
- **M-03. Статистика успешности — не функция C08.** Budget Manager не знает
  о вердиктах валидации. ModelStats материализуется C14 из событий
  `usage_recorded` + `validation_completed` (D-08: минимальный размер
  выборки, категория задачи, а не только порог 0.6). C07 читает агрегат из
  C14, а не из журналов.
- **M-04. Лимиты провайдера OpenCode Go недоступны.** В C08 уже есть
  `allowanceStatus: "unknown"` — остаётся unknown; система опирается на
  reported usage и RUB-политику, а не на запросы к провайдеру (соответствует
  запрету лишних API).
- **M-05. Каталога моделей нет.** `models.config.json` отсутствует;
  единственный источник — `DEFAULT_AGENT_MODELS`. При инициализации C07
  генерирует начальный каталог из этой таблицы (4 модели), далее файл —
  источник истины.
- **M-06. `skills/roles/*` пустые и не в формате SKILL.md.** Сохраняются
  (D-04) до проверки наполнения; сканер C03 обрабатывает только
  `skills/**/SKILL.md` и не падает на пустых/несоответствующих каталогах.
- **M-07. Свободный Node SQLite.** Выбор между `node:sqlite` (Node 22,
  экспериментальный) и `better-sqlite3` (новая зависимость) откладывается
  на реализацию C14; в обоих случаях интерфейс хранилища — за интерфейсом
  `KnowledgeStore` (API_CONTRACTS.md), замена движка не трогает компоненты.
- **M-08. Сборка пакетов.** Существующие пакеты вызывают tsc из
  `apps/office/node_modules/.bin` — хрупкая связь. При добавлении новых
  пакетов сохранить тот же подход (не устанавливая зависимости) либо
  вынести toolchain в корень отдельным решением.

## 5. Зависимости пакетов (целевые, без циклов)

```
shared            ← (не зависит ни от чего)
runtime-opencode  ← shared
runtime-codex     ← shared (этап 2; структура как у runtime-opencode)
budget-manager    ← shared (только типы usage/ids; опционально)
directory         ← shared
skills            ← shared, directory (только типы Profession)
model-manager     ← shared
archive           ← shared
orchestrator      ← shared, runtime-opencode, runtime-codex (этап 2),
                    budget-manager, directory, skills, model-manager, archive
apps/server       ← orchestrator, directory, skills, model-manager,
                    budget-manager, archive, shared
apps/office       ← (клиент C16; на этом этапе не меняется)
```

Правило: реестры (directory, skills, model-manager) не импортируют
orchestrator (D-03); orchestrator зависит от них односторонне; адаптеры
Runtime реализуют контракт из shared и импортируются только orchestrator'ом
(C17) — циклов нет (ADR-MAO-009). archive не импортирует budget-manager
(читает его файлы, не его код) — исключение допустимо: импорт типов
`UsageRecord` из budget-manager вместо дублирования (фиксируется в
API_CONTRACTS.md §5).

## 6. Порядок реализации (волны)

Каждая волна завершается зелёными тестами всех пакетов и не требует вызовов
LLM (проверка на Fake Runtime).

**Волна 0 — синхронизация документации.** Корректировка отметок ROADMAP
(P-03), фиксация D-решений (выполнено в этом этапе документально).

**Волна 1 — `packages/shared`.** ids, usage-типы, события, реестровые типы,
redaction (перенос из C15 с re-export для совместимости). Тесты типов и
redaction.

**Волна 2 — `packages/directory` (C01+C02).** Форматы `professions/*.md`,
загрузчик, валидация, инициализация 5 сотрудников из `DEFAULT_AGENT_MODELS`,
5 стартовых файлов профессий (director, developer, engineer, analyst,
assistant). Тесты.

**Волна 3 — `packages/skills` (C03).** Сканер SKILL.md, валидация,
SQLite-индекс (первая запись в БД может быть в файл-индексе до появления
C14 — решение реализации), 2–3 пробных Skills, включая один общий. Тесты
валидации и зависимостей. (C04-резолвер — волна 6.)

**Волна 4 — `packages/archive` (C14, базовая часть).** SQLite event store,
outbox, экспортёр в Obsidian (режим метаданных по умолчанию, D-07), бэкап.
Тесты идемпотентности и восстановления.

**Волна 5 — `packages/model-manager` (C07).** Каталог моделей, фильтры,
ранжирование, эскалационные цепочки; начальная генерация из
`DEFAULT_AGENT_MODELS`. Тесты выбора.

**Волна 6 — расширение `packages/orchestrator`.** Модули: task-router
(rules), concurrency (очередь + приоритеты D-06 в редакции 1.3,
атомарное резервирование через C08, динамический пул: старт 2),
context-manager, session-manager, skill-resolver (C04), result-validator
(детерминированные проверки), artifact-handoff, шина событий
(durable-first; изоляция сбоя подписчика; идемпотентность по eventId),
приём `modelId` от C07 (ADR-MAO-004). Интеграционные тесты на Fake Runtime.

**Волна 7 — `apps/server` (C16).** Composition root, REST по
API_CONTRACTS.md §6, WS-трансляция шины, токен-аутентификация. Smoke-тесты.

**Волна 8 — сквозной прогон на Fake Runtime.** Simple/standard/complex
сценарии end-to-end без LLM; проверка лимитов, retry, эскалации, архива.

Далее (этап 2): волны §6a; вне обеих карт: адаптация UI к C16, пилот на
реальных моделях, наполнение профессий и Skills.

## 6a. Порядок реализации Stage 2 (этапы 1.3–1.4; ADR-MAO-009…014)

Общие правила всех волн: зелёные тесты каждого пакета; **без вызовов
реальных LLM** — исполнение имитируется Fake-реализациями; Fake для каждого
нового `RuntimeAdapter` обязателен; зависимости не добавляются без явного
решения (M-07 для SQLite); публичные API C08/C15 не ломаются. Граница
S2-0/S2-1: S2-0 создаёт **только типы и контракты** в `shared` (поле «код
адаптера не пишется»); S2-1 — первая реализация контракта поверх
существующего C15. Реализация начинается только после подтверждения
технического руководителя (STAGE 1 ACCEPTED).

| Волна | Цель | Ожидаемый результат | Зависимости | Критерии завершения | Ограничения |
| --- | --- | --- | --- | --- | --- |
| **S2-0** Контракты (продолжение волны 1) | Типы и контракты этапа 1.3 в `packages/shared` | `runtime.ts` (RuntimeAdapter, RuntimeTask/RuntimeResult, RuntimeEvent, RuntimeCapabilities), `ExpenseCategory`, `BudgetGuardView`, поля Department/Portfolio; тесты типов | Волна 1 (ids, usage, redaction); API_CONTRACTS §2.16/§2.19 | Тесты типов зелёные; типы импортируются без violations D-03; код адаптеров **не пишется** | Без зависимостей; без ломки существующих экспортов |
| **S2-1** RuntimeAdapter для C15 | Первая реализация контракта поверх стабильного API C15 | Адаптерная обёртка `runtime-opencode`: маппинг `RuntimeTaskOptions` ↔ `RuntimeTask`; conformance-тест контракта (переиспользуемый C18) | S2-0; API_CONTRACTS §2.14/§2.16 | Conformance-тест зелёный на C15; экспорты `runtime-opencode` не изменены (diff по списку экспортов пуст) | Без рефакторинга ядра C15; без запуска реальных процессов (инъекция `spawn`) |
| **S2-2** C17 Runtime Manager | Единая точка исполнения | Модуль orchestrator: реестр, capabilities, `resolveFor`, унификация; интеграция с C06 на opt-in-пути (прямой путь C06→C15 сохраняется) | S2-1 | Интеграционные тесты на двух fakes адаптеров; событие `runtime_adapter_registered` в шине | Координатор не переключается на C17 по умолчанию (открытый вопрос №4) |
| **S2-3** C18 Codex Runtime | Второй независимый адаптер | `packages/runtime-codex`: запуск через поддерживаемую авторизацию ChatGPT, парсер событий, типизированные ошибки; fake-реализация | S2-0/S2-1 (conformance), S2-2 (реестр) | Conformance-тест зелёный; capabilities явно объявлены (session/sessionResume/cancel/usage); секреты в код/логи не попадают | Без реальных вызовов Codex (fake); без изменений opencode.json; форма авторизации — открытый вопрос №1 |
| **S2-4** Model Gateway (C07, часть этапа 2) | Runtime-aware выбор моделей | Поле `runtimeIds` в каталоге; фильтр Runtime (MODEL_ROUTING §3.1); `expenseCategory`+`runtimeId` в `ModelSelection` | S2-2 (capabilities); волна 5 (базовый C07) | Тесты выбора: бесплатные модели проходят, подписочные отклоняются без включённой подписки; переменные повторов не тронуты | Платные записи каталога — только после явного включения пользователем |
| **S2-5** Budget Guard и подписочный учёт | Финансовая модель ADR-MAO-012 | Аддитивные интерфейсы C08 (classify/precheck/view, §2.19); категории money/subscription/free/counts/contextEstimate; канал обновления политики | Волна 6 (ядро orchestrator); DATA_MODEL §2.6 | Тесты: двойной учёт исключён (классификация ≠ запись); JSONL не переписан; блокировка без авторешений | Публичные методы ядра C08 не изменяются; форма канала — открытый вопрос №3 |
| **S2-6** Масштаб организации | 100+ сотрудников, отделы | Department в directory; пагинация API C01; filler-данные 100+ сотрудников для perf-тестов | Волна 2 (базовый directory) | Perf-тест на fakes: реестр/выборка без деградации; 10–12 отделов в справочнике | Отделы — не бюджетные единицы; UI не меняется |
| **S2-7** Динамическая параллельность и многопроектность | ADR-MAO-013/014 в коде | C11: динамическая ёмкость; C19 Portfolio; C20 Allocator (цель ≤ 20, per-project квоты); события `resource_target_changed` | S2-5 (Guard), S2-6 (справочник) | Тесты: старт 2, безопасный рост до 20 под политикой; изоляция проектов; enforcement только в C08 | 20 слотов ≠ 20 LLM-вызовов; C11/C06 лимиты не меняют |
| **S2-8** Server API дополнения | C16 по API_CONTRACTS §6 | `GET /v1/runtimes`, расширенные `GET /v1/projects` (портфель), статусы Guard в снимке | Волна 7 (базовый C16), S2-2, S2-7 | Smoke-тесты маршрутов; токен/127.0.0.1 сохранены | Без новых маршрутов сверх обоснованных (§6) |
| **S2-9** E2E на fakes | Сквозная валидация этапа 2 | Мультипроектный прогон: 2–3 проекта параллельно, два Runtime (fake), retry/эскалация, подписочные лимиты, Obsidian-архив, восстановление | Все предыдущие | E2E зелёный; переключение координатора на C17 (закрыт вопрос №4) — по результатам | Только fakes; отчёт с метриками для калибровки (вопрос №5) |

Открытые вопросы этапа 2 (подробно — ARCHITECTURE_DECISIONS «Открытые
вопросы»): механизм авторизации Codex (S2-3), реальные лимиты подписки
(наблюдение, S2-5), форма канала политики (S2-5/S2-7), момент
переключения на C17 (S2-2→S2-9), калибровка слотов (S2-7), выбор
SQLite-драйвера (M-07).

## 7. Реестр противоречий (актуализация)

P-01…P-06 из ARCHITECTURE_DECISIONS.md остаются; новых противоречий
проверка совместимости не выявила, включая уточнения этапа 1.2
(API_CONTRACTS: retry-политика C07, атомарность слотов C11/C08, семантика
шины, Idempotency-Key и 422/429 в Server API) и этапа 1.3
(RuntimeAdapter/Manager, Model Gateway, Budget Guard, портфеля,
динамический пул) — они фиксируют поведение без изменений существующих
API C08/C15. P-01 и P-02 закрываются в волне 6 (контекст этапа 2 — волна
S2-4/S2-7), P-04 — в волне 2, P-05 — после волны 7 (отдельный этап UI),
P-03 — волна 0, P-06 — закрыто решением ADR-MAO-003 (код не требуется).
