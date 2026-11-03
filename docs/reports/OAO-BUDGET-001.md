# OAO-BUDGET-001 — Budget Manager

Дата: 2026-11-02

## Итог

Создан независимый `@open-agent-office/budget-manager`. Модуль учитывает
reported model usage, агрегирует его по сотруднику, модели, задаче, проекту,
сессии и времени, применяет конфигурируемую локальную политику, контролирует
активные задачи и сохраняет минимальные usage metadata в JSONL.

Финансовая политика приведена к фактической модели: подписка OpenCode Go уже
оплачена, стоит 1000 ₽, месячный денежный лимит 1000 ₽, дополнительный
денежный бюджет 0 ₽. Дополнительные платные расходы запрещены. Запросы внутри
включённой квоты разрешены.
Это локальная политика Budget Manager, а не доказательство, что дополнительное
использование отключено в аккаунте OpenCode.

Budget Manager не подключён к Runtime, orchestrator, server или office и не
выполняет внешних сетевых или LLM-запросов.

## Исправления в этой финализации

1. Удалён созданный Vitest-артефакт
   `packages/budget-manager/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`.
   Пустые каталоги `node_modules/.vite/vitest/da39…` оставлены: удалялся только файл.
2. Структура `dist` в отчёте исправлена (см. ниже).
3. Найден дефект политики: `subscriptionCostRub` по умолчанию был `null`, а
   статус считался от суммы «подписка + платежи» относительно 1000 ₽. При
   подписке 1000 ₽ статус становился `blocked`, и `checkTaskStart` запрещал
   все задачи, включая задачи внутри оплаченной квоты. Исправлено: подписка
   уменьшает дополнительный бюджет, статус вычисляется только по внесённым
   дополнительным RUB-платежам.
4. Тесты обновлены под новую модель, добавлен тест дефолтной политики.

## Структура

```text
packages/budget-manager/
├── src/
│   ├── types.ts
│   ├── budget-policy.ts
│   ├── usage-ledger.ts
│   ├── jsonl-store.ts
│   ├── budget-manager.ts
│   └── index.ts
├── test/budget-manager.test.ts
├── dist/                      (генерируется tsconfig.build.json)
│   ├── types.js, types.d.ts
│   ├── budget-policy.js, budget-policy.d.ts
│   ├── usage-ledger.js, usage-ledger.d.ts
│   ├── jsonl-store.js, jsonl-store.d.ts
│   ├── budget-manager.js, budget-manager.d.ts
│   └── index.js, index.d.ts
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── README.md
```

Сборка `tsc -p tsconfig.build.json` создаёт JS и declaration-файл для каждого
модуля из `src/`: всего 12 файлов (6 `.js` и 6 `.d.ts`). `dist/` игнорируется Git.
Source maps и declaration maps отключены.

Уточнение к описанию сборки: TypeScript создаёт пары JS/declaration для всех
шести модулей `src/`, а не только для `index.ts`. `index.js`/`index.d.ts` —
публичный package entrypoint; остальные десять файлов — модули пакета.

Этот отчёт фиксирует исходную реализацию Budget Manager. Итоговая независимая
проверка описана в `docs/reports/OAO-BUDGET-001-FINALIZE.md`.

## Public API

Экспортируются:

- `BudgetManager`;
- `JsonlUsageStore` и `UsageStore`;
- `UsageLedger`;
- `DEFAULT_BUDGET_POLICY`, `mergeBudgetPolicy`, `validateBudgetPolicy`, `usageEventId`;
- типы `BudgetPolicyConfig`, `BudgetSnapshot`, `BudgetDecision`, `UsageEventInput`, `UsageRecord`, `UsageSummary`, `CashPayment`;
- `BudgetExceededError`, `BudgetPolicyError`, `BudgetStoreError`.

Основные операции:

```ts
const manager = new BudgetManager(new JsonlUsageStore("/absolute/path/usage.jsonl"));
const decision = await manager.checkTaskStart({ taskId, agentId, modelId });
const handle = await manager.startTask({ taskId, agentId, modelId });
await manager.recordUsage({ agentId, modelId, taskId, input, output, reasoning, cacheRead, cacheWrite, total, costUsd });
handle.release();
```

`TaskHandle.abortController` предназначен для передачи его `signal` в будущую
интеграцию Runtime. При нарушении лимита активной задачи менеджер вызывает
abort и выбрасывает `BudgetExceededError`.

## Финансовая модель

Дефолтная политика:

- `monthlyBudgetRub = 1000` — месячный денежный лимит;
- `subscriptionCostRub = 1000` — оплаченная подписка OpenCode Go;
- `extraUsageEnabled = false` — дополнительные платные расходы запрещены;
- дополнительный бюджет `extraBudgetRub = monthlyBudgetRub - subscriptionCostRub = 0`;
- `warningThreshold = 0.70`, `criticalThreshold = 0.90`;
- остальные лимиты отключены (`null`) до явной настройки;
- per-agent limits задаются через `agentLimits`.

Валидация отклоняет `subscriptionCostRub > monthlyBudgetRub`.

Поля снимка (`BudgetSnapshot`):

- `subscriptionCostRub` — 1000 по умолчанию;
- `extraBudgetRub` — 0 по умолчанию;
- `extraSpendRub` — сумма внесённых дополнительных RUB-платежей (0, если их нет);
- `extraBudgetRemainingRub` = `extraBudgetRub - extraSpendRub`;
- `actualSpendRub` = подписка + внесённые платежи (`null`, если подписка неизвестна и платежей нет);
- `allowanceStatus` всегда `unknown`.

Статус cash-budget вычисляется только по внесённым дополнительным RUB-платежам
относительно `extraBudgetRub`:

- `normal` — ниже warning threshold или платежей нет;
- `warning` — от 70% дополнительного бюджета;
- `critical` — от 90%;
- `blocked` — `extraSpendRub >= extraBudgetRub`; при нулевом дополнительном
  бюджете любой внесённый платёж переводит статус в `blocked`;
- `unknown` — `subscriptionCostRub = null`.

Подписка не блокирует задачи. Задачи внутри включённой квоты разрешены.
Задача с `requiresExtraSpend: true` отклоняется, пока `extraUsageEnabled = false`.

`usage.costUsd` — reported model usage. Это не фактическое списание из
подписки. Он агрегируется отдельно в `reportedUsageUsd` и не конвертируется в
RUB. Курса RUB/USD в модуле нет.

## Policy и контроль задач

Поддержаны:

- месячный денежный лимит и блокировка при исчерпании дополнительного бюджета;
- запрет `requiresExtraSpend`, если `extraUsageEnabled = false`;
- `maxReportedCostUsdPerTask`, `maxTotalTokensPerTask`, `maxOutputTokensPerTask`,
  `maxReasoningTokensPerTask`, `maxTaskDurationMs`, `maxConcurrentTasks`;
- per-agent reported cost и token limits;
- preflight-оценки стоимости, токенов и длительности;
- проверка активных задач после каждого принятого usage event.

Usage проверяется на границе переданного события, обычно соответствующего
`step_finish`. Уже выполняющийся шаг может допустить перерасход до следующего
события. Абсолютное предотвращение превышения не гарантируется, если провайдер
не поддерживает предварительный cap по токенам или стоимости.

## JSONL storage

`JsonlUsageStore` требует абсолютный путь, создаёт родительский каталог при
первой записи и последовательно пишет только usage metadata:

- agent, model, task, project и session IDs;
- timestamp;
- input, output, reasoning, cacheRead, cacheWrite, total;
- reported `costUsd`;
- `eventId` для дедупликации.

Prompts, полные ответы, stderr, API keys, passwords, tokens и приватный контекст
не входят в `UsageRecord` и не сериализуются. Повреждённые JSONL-строки при
чтении пропускаются. Повторные event IDs не добавляются. Очередь операций и
общий state по абсолютному пути защищают concurrent writes в одном процессе
Node.js.

Usage event без `eventId` получает стабильный SHA-256 fingerprint по своим
метаданным и counters.

## Тесты

Тесты используют только временные каталоги и фиктивные данные. Реальные LLM не
вызываются, сеть не используется.

Файл `test/budget-manager.test.ts` содержит 11 тестов. Они покрывают 20
сценариев из исходного задания, часть сценариев объединена в один тест:

1. один usage event и суммирование событий;
2. группировка по employee, model, project, task и session;
3. дедупликация, включая конкурентные записи;
4. monthly summary, отдельный USD reported cost и RUB-платежи;
5. unknown allowance;
6. warning, critical и blocked на дополнительном бюджете;
7. дефолтная политика: подписка 1000 ₽, дополнительный бюджет 0 ₽, задачи в квоте разрешены, дополнительные расходы запрещены;
8. блокировка новых задач при исчерпании дополнительного бюджета и `maxConcurrentTasks`;
9. лимиты стоимости, токенов, reasoning/output, длительности и per-agent;
10. abort активной задачи при нарушении лимита;
11. запись JSONL, перезагрузка журнала, пропуск повреждённых строк, отсутствие prompts и secrets;
12. валидация политики, включая `subscriptionCostRub > monthlyBudgetRub`, и отрицательные метрики;
13. прямая агрегация `UsageLedger` без storage.

## Фактические проверки

Команды запущены из `packages/budget-manager` с уже установленным toolchain из
`apps/office/node_modules`:

```text
tsc --noEmit -p tsconfig.json
  PASS, exit code 0

vitest run --cache=false
  PASS, 1 test file, 11 tests passed

tsc -p tsconfig.build.json
  PASS, exit code 0, 12 файлов в dist/

ESM import из каталога пакета:
  import("@open-agent-office/budget-manager") -> PASS (self-reference через exports)
  import("./dist/index.js") -> PASS, дефолтный снимок: status normal,
    subscriptionCostRub 1000, extraBudgetRub 0, extraSpendRub 0,
    задача в квоте allowed, requiresExtraSpend denied

ESM import из корня репозитория:
  import("@open-agent-office/budget-manager") -> FAIL, ERR_MODULE_NOT_FOUND.
  Пакет не связан в node_modules корня, потому что pnpm install не выполнялся.

git diff --check (tracked изменения в packages/budget-manager и docs/reports): PASS
Проверка trailing whitespace и пустых строк в конце новых файлов: PASS
```

Примечание: в предыдущем прогоне Codex в `node_modules/.vite/vitest/.../results.json`
появился артефакт. Для запусков без побочных файлов используйте `--cache=false`
(в этой финализации проверено, что с ним файл не создаётся/не обновляется).

Зависимости не устанавливались, `pnpm install` не выполнялся, сеть и реальные
модели не использовались, `--auto` не включался, коммиты не создавались.

## Изменённые файлы

Задача затрагивает только:

- `packages/budget-manager/src/types.ts`;
- `packages/budget-manager/src/budget-policy.ts`;
- `packages/budget-manager/src/budget-manager.ts`;
- `packages/budget-manager/test/budget-manager.test.ts`;
- `packages/budget-manager/README.md`;
- `docs/reports/OAO-BUDGET-001.md`.

Также в этой задаче пересобран `packages/budget-manager/dist/` (игнорируется Git) и
удалён один Vitest-артефакт.

Файлы `apps/office`, `references/`, `opencode.json`, Kilo-конфигурация и
`packages/runtime-opencode` в этой задаче не редактировались. В Git уже были
незакоммиченные изменения в `apps/office` (94 записи) и `packages/runtime-opencode/`
(untracked, созданы до этой задачи для OAO-RT-001). Их не сбрасывали.

## Ограничения и оставшиеся задачи

- `extraSpendRub` учитывает только внесённые вручную RUB-платежи. Незарегистрированные
  списания модуль не обнаружит.
- Cash payments хранятся в экземпляре `BudgetManager` и не сохраняются между запусками.
  Для долговременного payment ledger нужен отдельный store/API.
- Нет курса RUB/USD и намеренно нет автоматической конвертации.
- Нет достоверного API остатка квоты OpenCode Go, поэтому allowance всегда `unknown`.
- Duration limit проверяется при preflight и при следующем usage event. Таймера нет:
  интегратор должен связать `abortController.signal` с Runtime и добавить внешний таймер.
- `enforceTaskLimits` использует `Date.now()` для длительности, а не инъецируемые часы
  `now`. Это расхождение нужно устранить до тестирования длительности с фиктивным временем.
- Сборка зависит от TypeScript и Vitest из `apps/office/node_modules`, потому что
  пакет не имеет собственных `devDependencies`. Это работает без установки, но связывает
  пакет с офисным приложением. Решение: отдельная установка зависимостей на этапе,
  который явно разрешит `pnpm install`.
- `tsconfig.json` использует `typeRoots` и `paths` с относительными путями в другие пакеты.
  Это временное решение для текущего окружения.
- Модуль пока не подключён к Runtime, orchestrator, server или office.
