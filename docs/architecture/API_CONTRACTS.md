# MAO — API CONTRACTS

Этап 1.2 (MAO-ARCH-02). Минимальные интерфейсы взаимодействия модулей и
контракты Server API. Описание декларативное (TypeScript-подобная нотация);
реализация — по волнам IMPLEMENTATION_MAP.md. Код на этом этапе не создан.

## 1. Структура `packages/shared`

Единственный пакет без зависимостей; импортируется всеми (D-02).

```
packages/shared/src/
├── ids.ts          # IDENTIFIER_PATTERN, TASK_ID_PATTERN, assertIdentifier,
│                   # assertOptionalIdentifier (канонизация трёх существующих regex)
├── usage.ts        # UsageMetrics (канонический, поле costUsd), UsageTotals
├── session.ts      # sessionIdFromEvent(event): string | undefined
├── redaction.ts    # redactSecrets, sanitizeValue (перенос из runtime-opencode;
│                   # runtime-opencode реэкспортирует для обратной совместимости)
├── registry.ts     # ProfessionProfile, EmployeeProfile (и departmentId),
│                   # Department, SkillDescriptor, ModelDescriptor,
│                   # SkillBundle, ModelSelection
├── tasks.ts        # Task, Subtask, TaskPlan, статусы (enum-union типы)
├── results.ts      # ExecutionContext, ValidationReport, ArtifactManifest
├── events.ts       # OfficeEvent (конверт), EventType (union), EventBus interface
└── runtime.ts      # RuntimeAdapter, RuntimeTask, RuntimeResult, RuntimeEvent,
                    # RuntimeCapabilities, ExpenseCategory, BudgetGuardView (этап 1.3)
```

Обратная совместимость: `runtime-opencode` и `budget-manager` сохраняют свои
экспорты; канонические типы shared внедряются постепенно (волна 1 — только
новые типы + redaction; замена типов usage в существующих пакетах — отдельное
решение, чтобы не ломать публичные API).

## 2. Контракты компонентов (пакетные интерфейсы)

Все интерфейсы допускают fake-реализации. Методы возвращают Promise, если
не указано иное.

### 2.1. C02 Profession Registry (`packages/directory`)

```ts
interface ProfessionRegistry {
  loadFromDirectory(dir: string): Promise<{ loaded: number; rejected: Rejection[] }>;
  register(profile: ProfessionProfile): void;            // валидация; событие
  get(professionId: string): ProfessionProfile;          // UnknownProfessionError
  list(filter?: { status?: "active" | "disabled" }): ProfessionProfile[];
  disable(professionId: string): void;
  onChange(listener: (e: RegistryEvent) => void): Unsubscribe;
}
```

### 2.2. C01 Employee Registry (`packages/directory`)

```ts
interface EmployeeRegistry {
  initFromDefaults(defaults: Readonly<Record<string, string>>): void; // DEFAULT_AGENT_MODELS
  register(profile: EmployeeProfile): void;
  update(employeeId: string, patch: Partial<EmployeeProfile>): void;
  get(employeeId: string): EmployeeProfile;              // UnknownEmployeeError
  list(filter?: { professionId?: string; status?: string }): EmployeeProfile[];
  deactivate(employeeId: string): void;
  onChange(listener: (e: RegistryEvent) => void): Unsubscribe;
}
```

### 2.3. C03 Skill Registry (`packages/skills`)

```ts
interface SkillRegistry {
  scan(rootDir: string): Promise<{ loaded: number; rejected: Rejection[] }>;
  getDescriptor(skillId: string): SkillDescriptor;       // UnknownSkillError
  list(filter?: { category?: string; professionId?: string; status?: string }): SkillDescriptor[];
  loadBody(skillId: string, version?: string): string;   // чтение файла; не кэширует в индексе
  onChange(listener: (e: RegistryEvent) => void): Unsubscribe;
}
```

### 2.4. C04 Skill Resolver (`packages/skills`)

```ts
interface SkillResolver {
  resolve(input: {
    subtask: SubtaskBrief;
    profession: ProfessionProfile;
    tokenBudget: number;            // из Context Manager
    availableTools: string[];       // инструменты среды проекта
  }): SkillBundle;                  // { skills: SkillRef[]; bodies: string[]; rejected: Rejection[] }
}
```

Ограничения: ≤ 5 Skills и ≤ ~4000 токенов тела на исполнение (значения
конфигурируемы); разрешение зависимостей топологически, цикл → Rejection.

### 2.5. C07 Model Gateway (`packages/model-manager`)

```ts
interface ModelRouter {
  loadCatalog(path: string): Promise<void>;              // models.config.json
  select(input: {
    subtask: SubtaskBrief;
    profession: ProfessionProfile;
    estimatedInputTokens: number;
    employeeDefault?: string;       // modelDefault сотрудника: модель-предпочтение,
                                    // задающая минимально допустимый уровень
                                    // (tier + capabilities); выбор ниже — запрещён
    attempt: number;                // номер попытки (1..политика retry C06);
                                    // при attempt > 1 — семантика из §2.5.2
    lastFailure?: {                 // результат предыдущей попытки (attempt > 1);
      verdict: "fail" | "partial";  // нужен для правил повторов (§2.5.2)
      errorClass?: string;
    };
    runtimes: RuntimeCapabilities[];        // доступные адаптеры (C17, этап 1.3);
                                            // Runtime-нейтральность: кандидаты —
                                            // только поддерживаемые адаптером модели
    stats: ModelStatsView;          // read-only проекция из C14
    budget: BudgetSnapshotView;     // read-only проекция из C08 (категории — §2.19)
  }): ModelSelection;               // { modelId, runtimeId, provider,
                                    //  expenseCategory, rationale,
                                    //  fallbacks: string[] }
  listModels(): ModelDescriptor[];
}
```

#### 2.5.1. Семантика `employeeDefault`

- Это **конкретная модель-предпочтение сотрудника** (`modelDefault` из
  EmployeeProfile), которая одновременно отсекает степень свободы «взять
  дешевле»: кандидат должен иметь tier не ниже и не иметь capabilities,
  отсутствующих относительно неё. То есть `employeeDefault` — это и
  предпочтительная модель, и **минимально допустимый уровень возможностей**.
- Более сильная модель — допустима, но только по обоснованной необходимости
  (требования возможностей, провал предыдущих попыток, риск задачи),
  обоснование фиксируется в `rationale` (MODEL_ROUTING §1).
- Если после фильтров (§3 MODEL_ROUTING) не осталось кандидатов,
  `employeeDefault` — резервный выбор и последний элемент fallback-цепочки.

#### 2.5.2. Правила повторных попыток (attempt > 1)

Число попыток — политика C06 (по умолчанию: до 2 повторов,
TASK_LIFECYCLE §2, шаг 7). C07 не хранит состояние попыток, а
интерпретирует `attempt` + `lastFailure`:

1. **Та же модель** (attempt 2): вердикт/ошибка указывают на контекстную
   причину, а не на неспособность модели (нечёткие критерии, шумный вход,
   сбой инструмента/среды) — модель не меняется, контекст уточняется
   причинами от C12 (поле `lastFailure`).
2. **Другая модель того же яруса**: ошибка — модель-специфичный класс
   (нестабильный формат ответа, повторяющиеся отказы модели) — следующий
   кандидат fallback-цепочки того же яруса.
3. **Эскалация на ярус выше**: предыдущие попытки провалились по
   capability-причинам. Эскалация выше `modelHints.tier` профессии более чем
   на один шаг за задачу требует режима complex или подтверждения
   пользователя; каждая эскалация — событие `model_escalated` с причиной
   (MODEL_ROUTING §4). Альтернатива шагам 2–3 — смена сотрудника той же
   профессии (решение C06).
4. **Платные внешние API недостижимы автоматически**: ни `select`, ни
   fallback-цепочка, ни эскалация не рассматривают модели с
   `paidExternal: true`; таких моделей нет в цепочке fallback и в
   статистическом ранжировании. Использование платного внешнего API
   возможно только по явному разрешению пользователя на конкретную
   операцию, вне правил повторов (MODEL_ROUTING §1, пункты 3–4).

### 2.6. C05 Task Router (модуль `packages/orchestrator`)

```ts
interface TaskRouter {
  plan(request: UserTaskRequest): TaskPlan;   // rules-first; LLM-планирование — отдельная операция
  classify(request: UserTaskRequest): "simple" | "standard" | "complex";
}
```

### 2.7. C09 Context Manager (модуль `packages/orchestrator`)

```ts
interface ContextManager {
  build(input: {
    subtask: Subtask; profession: ProfessionProfile; bundle: SkillBundle;
    projectMemoryPath?: string; artifacts?: ArtifactManifest[];
    modelMaxTokens: number;
  }): ExecutionContext;             // { prompt, sections, tokenEstimate, trimmed: Rejection[] }
}
```

### 2.8. C10 Session Manager (модуль `packages/orchestrator`)

```ts
interface SessionManager {
  acquire(employeeId: string, projectId: string): SessionHandle;   // новая или продолжение
  noteExternalSessionId(handle: SessionHandle, opencodeSessionId: string): void;
  release(handle: SessionHandle): void;
  recoverOnBoot(): { recovered: SessionHandle[] };  // running→recovery
}
```

### 2.9. C11 Concurrency Manager (модуль `packages/orchestrator`)

```ts
interface ConcurrencyManager {
  enqueue(subtaskId: string, priority: "interactive" | "normal"): void; // D-06: интерактивные — выше в общей очереди
  next(): string | undefined;       // следующий subtaskId при свободном слоте
  onSlotFreed(listener: () => void): Unsubscribe;
  depth(): number;
}
```

Разделение ответственности (D-05/D-06 в редакции этапа 1.3, ADR-MAO-005,
ADR-MAO-014): C11 — только очередь, порядок и приоритеты; enforcement
параллельности — **исключительно C08** (`maxConcurrentTasks`) — целевое
значение (старт 2, до 20 рабочих слотов) вычисляет C20 и подаёт в политику
C08 через единственный аддитивный канал; 20 слотов ≠ гарантированные 20
одновременных LLM-вызовов.

**Атомарное резервирование слота.** Двойное выделение исключается
конструкцией:

- `next()` выдаёт из очереди ровно одну подзадачу одному диспетчеру; диспетчер
  запуска в C06 единственный (одноисполнительный цикл допуска), поэтому
  выдача не может быть продублирована;
- слот фактически резервируется только после **успешного атомарного**
  `BudgetManager.startTask` (in-memory ledger + файловая блокировка пути
  журнала — существующий механизм C08); проверкой «есть ли слот» C11 сам
  не занимается — истинное состояние знает только C08;
- если последний слот разыгрывают две подзадачи, выигравшая получает
  выделение C08, вторая получает отказ бюджета и **возвращается в очередь
  без потери приоритета** (тот же класс приоритета, позиция — та же).

**Интерактивные задачи.** `priority: "interactive"` ставит подзадачу впереди
подзадач `normal` (FIFO внутри каждого класса), но не создаёт и не
резервирует отдельный слот: при обоих занятых слотах интерактивная подзадача
ожидает освобождения, вытеснение выполняющихся исполнений приоритетом
не допускается — отмена выполняющейся задачи возможна только явно через
`POST /v1/tasks/:id/cancel`. Третьего слота нет (D-06). Для защиты
normal-класса от голодания политика C11 допускает ограничение числа
подряд интерактивных выдач (конфигурируемо); изменение приоритета
подзадачи — только с событием.

### 2.10. C12 Result Validator (модуль `packages/orchestrator`)

```ts
interface ResultValidator {
  validate(input: {
    subtask: Subtask; result: SubtaskResult; artifacts: ArtifactManifest[];
    runToolCheck: (check: string) => Promise<ToolCheckResult>;  // инъекция среды
  }): Promise<ValidationReport>;    // verdict: pass | fail | partial; recommendation
}
```

### 2.11. C13 Artifact Handoff (модуль `packages/orchestrator`)

```ts
interface ArtifactHandoff {
  register(subtaskId: string, files: ArtifactInput[]): Promise<ArtifactManifest[]>;
  forSubtask(subtaskId: string): ArtifactManifest[];
  inputsFor(subtaskId: string): ArtifactManifest[];   // артефакты зависимостей
}
```

### 2.12. C14 Knowledge Manager (`packages/archive`)

```ts
interface KnowledgeStore {          // движок SQLite скрыт (M-07)
  appendEvent(e: OfficeEvent): void;                    // + outbox в той же транзакции
  mirrorUsageFromLedger(read: () => AsyncIterable<UsageRecord>): Promise<number>; // идемпотентно
  queryEvents(filter: EventFilter): OfficeEvent[];
  searchArchive(query: string, limit?: number): ArchiveHit[];  // FTS
  modelStats(): ModelStatsView;                          // для C05/C07 (D-08)
  backup(targetDir: string): Promise<BackupReport>;
}
interface ArchiveExporter {
  exportPending(limit?: number): Promise<{ exported: number; failed: number }>; // идемпотентно
}
```

### 2.13. C08 Budget Manager — без изменений API (+ Budget Guard, этап 2)

Существующий интерфейс (`startTask`, `recordUsage`, `recordCashPayment`,
`getSnapshot`, `getUsageSummary`, `checkTaskStart`, `releaseTask`) является
стабильным контрактом. Изменение: значение дефолта фабрики
`maxConcurrentTasks: 2` (волна 6). Этап 1.3: значение лимита становится
динамическим — целевое значение готовит C20 и подаёт через единственный
аддитивный канал обновления политики; Guard — §2.19 (аддитивно, без
ломки списка методов выше).

### 2.14. C15 Runtime — без изменений API

Стабильный контракт: `OpenCodeRuntime.runTask(RuntimeTaskOptions)` и типы
`RuntimeTaskOptions/RuntimeResult/RuntimeEvent/RuntimeUsage` + иерархия
ошибок. Fake Runtime реализует `Pick<OpenCodeRuntime, "runTask">`
(существующий тип `CoordinatorRuntime`). Этап 1.3: адаптер C15
(§2.16) маппит эти типы в унифицированные `RuntimeTask/RuntimeResult`
слоем поверх — без переименования и ломки экспортов. C18 Codex реализует
§2.16 независимо, в `packages/runtime-codex`.

### 2.15. Шина событий (в C06, тип в shared)

```ts
interface EventBus {
  publish(e: OfficeEvent): void;                 // синхронно: сначала durable-запись в C14, потом остальные
  subscribe(l: (e: OfficeEvent) => void, opts?: { durableFirst?: boolean }): Unsubscribe;
}
```

`OfficeEvent`: `{ id, ts, type, taskId?, subtaskId?, employeeId?,
projectId?, payload: unknown }` — payload прошёл redaction до publish;
`id` — ULID/монотонный, уникален глобально.

Семантика доставки (ADR-MAO-008):

- **Durable-first.** Ровно один подписчик зарегистрирован как `durableFirst`
  (C14): `publish` синхронно выполняет его запись (`appendEvent` — событие +
  outbox в одной SQLite-транзакции, §2.12) и только после подтверждения
  доставляет событие остальным. Ошибка durable-записи останавливает
  доставку: событие **не попадает в UI/WS/иных подписчиков**; публикующий
  компонент обязан повторить публикацию того же события (см. идемпотентность
  ниже).
- **Ошибка подписчика не останавливает остальных.** Каждый недюрабельный
  подписчик вызывается в отдельной обработке ошибок: исключение подписчика
  логируется событием `subscriber_failed` (eventId, id подписчика) и не
  влияет на доставку другим подписчикам и на уже произошедшую запись C14.
- **Идемпотентность и повторная доставка.** Подписчики идемпотентны по
  `eventId` (дедупликация); повторная публикация того же события после сбоя
  не создаёт дубликатов в C14 (PK eventId), в зеркале usage (импорт по
  eventId) и в outbox. Доставка недюрабельным подписчикам в пределах
  процесса — at-least-once (допустим повтор); восстановление после
  перезапуска выполняется из SQLite (истина — БД), а не реплеем шины;
  WS-клиенты после пересоединения получают `snapshot` (§6).
- Redaction применяется до `publish`, поэтому ни один подписчик не получает
  неотредактированный payload.

## 2.16. Контракт RuntimeAdapter (тип в shared; ADR-MAO-010)

Унифицированные типы этапа 1.3 — **не заменяют** существующие типы C15
(`RuntimeTaskOptions/RuntimeResult/...`): C15 сохраняет публичный API, его
адаптерная обёртка маппит эти типы. Codex-адаптер (C18) реализует контракт
напрямую.

```ts
interface RuntimeAdapter {
  readonly id: string;                       // "opencode" | "codex"
  capabilities(): RuntimeCapabilities;       // объявленные возможности
  execute(task: RuntimeTask, callbacks: {    // только через C17
    onEvent(e: RuntimeEvent): void;
    onUsage(u: UsageMetrics): void;
  }): Promise<RuntimeResult>;                // или типизированная ошибка Runtime*
  cancel(handle: RuntimeExecutionHandle): Promise<void>;  // если capability cancel
  resume?(sessionId: string, task: RuntimeTask): Promise<RuntimeResult>;
                                             // только если sessionResume
}

interface RuntimeCapabilities {
  runtimeId: string;
  supportedProviders: string[];              // напр. ["opencode-go"] / ["chatgpt-plus"]
  supportedModels: string[] | "*";           // префиксные шаблоны по каталогу
  session: boolean;                          // поддержка сессий
  sessionResume?: boolean;                   // восстановление (не гарантировано)
  cancel?: boolean;
  streamEvents?: boolean;
  usage?: boolean;
  maxAdapterConcurrency?: number;            // ёмкость адаптера (учитывается C20)
  notes?: string[];                          // уточнения возможностей (не для парсинга)
}

interface RuntimeTask {                      // унифицированное задание
  executionId: string; attempt: number;
  modelId: string; runtimeId?: string;       // runtimeId проверяется адаптером
  prompt: string; cwd: string; title?: string;
  sessionId?: string;                        // возобновление, если поддержано
  signal: AbortSignal; timeoutMs?: number;
}

interface RuntimeResult {                    // унифицированный результат
  runtimeId: string; externalSessionId?: string;
  text: string; events: RuntimeEvent[]; usage?: UsageMetrics;
  exitCode?: number; reason?: string;
}
```

Правила: все возможные поведения, кроме «запуск/результат/ошибка», —
опциональные capabilities; проверяются C17 до использования и не
предполагаются равными между OpenCode и Codex. Восстановление сессий —
только при `sessionResume`; иначе новая сессия с кратким контекстом (C09).
Отмена — задача-специфична: механизм отмены — собственность адаптера;
capability `cancel` лишь фиксирует её наличие (OpenCode —
AbortSignal→SIGTERM→SIGKILL, уже реализовано; Codex — собственный механизм).

### 2.17. C17 Runtime Manager (модуль `packages/orchestrator`, этапы 2; контракт — `packages/shared`, S2-2)

```ts
interface RuntimeManager {       // контракт уточнён волной S2-2 (см. ниже)
  register(adapter: RuntimeAdapter): void;               // + событие в шину
  list(): RuntimeCapabilities[];
  resolveFor(modelId: string, runtimeIdHint?: string): RuntimeAdapter;   // UnknownRuntimeError / UnsupportedModelError
  execute(selection: ModelSelection, task: RuntimeTask, callbacks: {
    onEvent(e: RuntimeEvent): void; onUsage(u: UsageMetrics): void;
  }): Promise<RuntimeResult>;
  checkCapabilities(runtimeId: string, need: RuntimeRequirement[]): CapabilityReport;
}
```

Уточнение (волна S2-2, `packages/shared/src/runtime.ts`):

- `execute(task, callbacks)` использует явно выбранный `task.runtimeId`
  (так же, как контракт `RuntimeAdapter`); параметр `selection: ModelSelection`
  появляется в S2-4 вместе с самим типом `ModelSelection` (Model Gateway).
  Интеллектуальная маршрутизация между провайдерами — не зона C17.
- Дополнены операции активных исполнений (`cancel(handle)`,
  `listActiveExecutions()`) и привязки сессий (`bindSession`,
  `resumeSession` — отказ при попытке продолжить сессию через чужой Runtime).
- Коды `runtime_failed` (детерминированный fallback для неопознанной
  ошибки) и `unsupported_capability` (проверка контракта/gate, а не сбой
  исполнения) зафиксированы в `RuntimeErrorCode`.

### 2.18. C19 Portfolio Manager и C20 Resource Allocator (этап 2)

```ts
interface ProjectPortfolio {        // C19
  register(project: ProjectRegistration): void;
  list(): PortfolioEntry[];         // статусы active/paused/quotaExhausted
  setPolicy(projectId: string, policy: { priority: number;
    budgetShare: number; maxConcurrentExecutions: number }): void;
  admission(): ProjectPortfolioDecision;   // какие проекты исполняются сейчас
  onPolicyChange(listener: (e: PortfolioEvent) => void): Unsubscribe;
}

interface ResourceAllocator {       // C20 — единственный источник целевого лимита
  computeTargetSlots(): { slots: number; perProject: Record<string, number> };  // старт 2, цель ≤ 20
  applyToPolicy(): void;            // аддитивный канал обновления политики C08
  history(): ResourceDecision[];    // события `resource_target_changed`
}
```

### 2.19. C08 Budget Guard — аддитивные интерфейсы поверх стабильного ядра

Существующий контракт §2.13 не меняется. Добавляются (этап 2):

```ts
interface BudgetGuard {
  classify(input: TaskBudgetRequest): ExpenseCategory;   // money/subscription/free
  precheck(req: TaskBudgetRequest): BudgetGuardDecision; // первый шаг startTask
  view(): BudgetGuardView;          // по категориям DATA_MODEL §2.6
}
```

Правила: подписка — не API-баланс (учёт числа запросов и приблизительного
контекста; точные квоты не постулируются); подписочная авторизация Codex
недоступна OpenCode; платные fallback/пополнения — только по явному
действию пользователя; двойной учёт исключён (категории — проекция
политики, JSONL ledger — единственный финансовый журнал).

## 3. Каркас Orchestrator (C06) — границы с Router'ами

Чтобы не дублировать ответственность (проверка D задания):

- Координатор **не планирует** и **не выбирает модели**: получает готовую
  подзадачу с `modelId` от C07 и контекст от C09.
- Task Router **не запускает**: отдаёт `TaskPlan`; запуск — C06 через C11.
- Model Gateway **не исполняет и не знает Runtime изнутри**: получает
  capabilities от C17, возвращает `ModelSelection` (модель + runtimeId);
  использование — C06/C17.
- Retry-логика живёт в C06 (планировщик), политика числа попыток и
  эскалации — конфигурацией; C07 лишь отвечает «какая модель на попытке N».

## 4. Контракт устойчивости к перезапуску

Все реестры и состояние читаются при старте C16 (composition root):
C02→C03→C01 (init из defaults при пустой БД) → C07 → C14 (открытие БД,
миграции) → C10.recoverOnBoot() → C06 (recovery-подзадачи) → слушатели
шины → HTTP/WS.

## 5. Импорт типов между пакетами (разрешённые)

- `archive` может импортировать тип `UsageRecord` из `budget-manager`
  (вместо дублирования), но не его рантайм-код.
- `orchestrator` импортирует типы реестров из `directory`/`skills`/
  `model-manager`; обратные импорты запрещены (D-03).
- `apps/server` импортирует всё; ничто не импортирует `apps/server`.

## 6. Server API (минимальные контракты, `/v1`)

Общие: JSON; `error`: `{ code, message, details? }`; аутентификация —
токен (WebSocket subprotocol / `Authorization: Bearer` для HTTP), сервер
только 127.0.0.1. Идентификаторы и поля сущностей — по DATA_MODEL.md.

| Метод | Назначение | Ответ |
| --- | --- | --- |
| `GET /v1/health` | проверка | `{ status: "ok", version, uptimeMs }` |
| `GET /v1/employees` | список сотрудников | `{ employees: EmployeeProfile[] }` |
| `GET /v1/professions` | список профессий | `{ professions: ProfessionProfile[] }` |
| `GET /v1/projects` | список рабочих пространств реестра проектов | `{ projects: Project[] }` |
| `GET /v1/skills?category=&professionId=` | список Skills (дескрипторы, без тел) | `{ skills: SkillDescriptor[] }` |
| `POST /v1/tasks` | создание задачи `{ projectId, title, brief, priority? }`; заголовок `Idempotency-Key` (см. ниже) | `202 { task: Task }`; `422 { error }` (валидация); `429 { error, retryAfter }` (временный отказ) |
| `GET /v1/tasks/:id` | состояние задачи | `{ task: Task, subtasks: Subtask[] }` |
| `POST /v1/tasks/:id/cancel` | отмена | `{ cancelled: true }` |
| `GET /v1/events?taskId=&type=&from=&limit=` | журнал событий | `{ events: OfficeEvent[] }` |
| `GET /v1/usage/models` | статистика моделей | `{ stats: ModelStatsView[], totals: UsageTotals }` |
| `GET /v1/budget/snapshot` | снимок бюджета | `BudgetSnapshot` (тип C08) |
| `GET /v1/models` | каталог моделей | `{ models: ModelDescriptor[] }` |
| `GET /v1/runtimes` | список Runtime-адаптеров и их capabilities (этап 2) | `{ runtimes: RuntimeCapabilities[] }` |
| `WS /v1/ws` | поток событий шины | сообщения `{ type: "event", event: OfficeEvent }`, `{ type: "snapshot", ... }` при подключении |

Дополнительные контракты `POST /v1/tasks` и `GET /v1/projects`:

- **Идемпотентность создания задач.** Запрос может содержать заголовок
  `Idempotency-Key` (строка ≤ 128 символов). Пара «ключ → ответ» сохраняется
  в C14 вместе с `taskId` на 24 часа; повторный запрос с тем же ключом
  возвращает исходный ответ (`202 { task }` или сохранённую ошибку) **без
  создания новой задачи** (дедупликация по ключу, не по содержимому).
  Запрос без заголовка сохраняет прежнее поведение (не идемпотентен); ключ
  генерирует клиент.
- **Разделение 422 и 429.**
    - `422` — детерминированный отказ по содержимому запроса: нарушение
      схемы полей, неизвестные `projectId`/`employeeId`, оценки превышают
      жёсткие лимиты политики бюджета. Повтор с теми же полями даст тот же
      результат — исправлять нужно запрос.
    - `429` — временный отказ из-за состояния системы: бюджет временно
      заблокирован (ожидание платежа/решения пользователя), очередь C11
      переполнена сверх допустимой глубины, подсистема приёма ещё не готова.
      Ответ содержит `Retry-After`; повтор разрешён после устранения
      причины. Отсутствие свободного слота ошибкой не является — запрос
      принимается `202` и попадает в очередь C11.
- **Источник списка проектов для UI.** `projectId` обязателен при создании
  задачи, поэтому список проектов клиент берёт только из реестра проектов:
  источник истины — конфигурация зарегистрированных рабочих пространств
  (файлы `~/.agent-office/`, загружается C16 при старте), зеркало — SQLite
  `projects` (C14); `GET /v1/projects` читает это зеркало и не выводит
  список из истории задач. Этап 1.3 (многопроектность, C19): реестр
  пополняется полями портфеля (priority, budgetShare,
  maxConcurrentExecutions — DATA_MODEL §2.4); создание/удаление проектов
  через API по-прежнему не добавляются.
- **Runtime-наблюдаемость (этап 2).** `GET /v1/runtimes` возвращает
  зарегистрированные адаптеры C17 и их capabilities — минимально
  необходимый маршрут для диагностики доступности Runtime и причин
  недоступности моделей; управление адаптерами через API не добавляется.

Сознательно исключены из минимума: CRUD реестров через API (пока — файлы +
reindex), платежи, экспорт архива, поиск (добавляются после волны 7 без
изменения существующих маршрутов). `GET /v1/projects` (этап 1.2) и
`GET /v1/runtimes` (этап 1.3) — единственные добавляемые маршруты при
обоснованной необходимости; далее API не расширяется без основания.

## 7. Соответствие решениям пользователя

Определения D-01…D-08 — ARCHITECTURE_DECISIONS.md, раздел
«Подтверждённые решения пользователя».

D-01 → §2.1–2.2 (отдельный пакет). D-02 → §1. D-03 → §5 и граф зависимостей.
D-04 → M-06 (IMPLEMENTATION_MAP). D-05 → §2.9 (enforcement только в C08) и
§2.13; **пересмотрен этапом 1.3 (ADR-MAO-014)**: старт 2, динамическая цель
до 20 рабочих слотов. D-06 → §2.9 (приоритет без вытеснения; «третий слот»
аннулирован в связи с эластичным пулом). D-07 → §2.12 (режим метаданных по
умолчанию). D-08 → §2.5/§2.12 (ModelStatsView с минимальной выборкой и
категориями, не только порог).
Уточнения этапа 1.2: retry-политика и запрет авто-перехода на платные API —
§2.5.2; атомарность слота — §2.9; семантика шины — §2.15; Idempotency-Key и
422/429 — §6. Этап 1.3: RuntimeAdapter/Manager — §2.16–2.17; портфель и
аллокатор — §2.18; Budget Guard и категории расходов — §2.19; Model Gateway
(runtime-aware выбор) — §2.5; `GET /v1/runtimes` — §6.
