# OAO-RT-003 — Интеграция Budget Manager и OpenCode Runtime через Orchestrator

Дата: 2026-11-02
Статус: **PASS** (все обязательные тесты и проверки выполнены фактически, см. раздел 9)

Первый рабочий слой координации: `AgentExecutionCoordinator` соединяет
`@open-agent-office/budget-manager` и `@open-agent-office/runtime-opencode`.
Код обеих библиотек не скопирован, пакет подключает их через `workspace:*`.

Не выполнялось: реальный OpenCode CLI, реальные LLM и платные запросы, запуск
сотрудников, подключение к серверу, UI и `apps/office`, Agent Terminal,
изменения анимаций и персонажей, глобальный `opencode.json`, `--auto`, commit,
git reset/restore/clean. Зависимости не устанавливались, `pnpm-lock.yaml` не менялся.

## 1. Аудит существующих API

Проверено по исходникам:

- `runtime-opencode/src/index.ts`: `OpenCodeRuntime.runTask(RuntimeTaskOptions)`
  принимает `model`, `prompt`, `cwd`, `title`, `sessionId`, `timeoutMs`, `signal`,
  `onEvent`. Возвращает `RuntimeResult` (`sessionId`, `text`, `events`, `exitCode`,
  `reason`, `usage`). `RuntimeUsage` содержит `input`, `output`, `reasoning`,
  `cacheRead`, `cacheWrite`, `total`, `cost`. Все ошибки типизированы
  (`RuntimeAbortError`, `RuntimeTimeoutError`, `RuntimeExitError`, …).
- `budget-manager/src/budget-manager.ts`: `startTask(request)` → `TaskHandle`
  (`abortController`, `release()`), `recordUsage(input)`, `recordCashPayment(p)`,
  `getSnapshot()`, `policy`. Ошибки: `BudgetExceededError` (`reason`),
  `BudgetStoreError`, `CashPaymentConflictError`, `UsageEventConflictError`.
- `JsonlUsageStore`, `JsonlCashPaymentStore` — экспорт из `index.ts`.
- В `packages/` до задачи были пустые каталоги `orchestrator`, `model-manager`,
  `shared`. `pnpm-workspace.yaml` включает `packages/*`.

## 2. Изменения в Runtime (`packages/runtime-opencode`)

Обратная совместимость сохранена; существующие 14 тестов проходят без изменений.

- `RuntimeTaskOptions.onUsage?: (usage: RuntimeUsage, event: RuntimeEvent) => void`.
- `addUsage()` заменена на чистую `usageDeltaFrom(event)`, которая возвращает
  дельту или `undefined` (если у события нет токенов), и `accumulateUsage()`.
  `result.usage` — сумма тех же дельт.
- Порядок в `processLine`: извлечение и агрегация usage → `onUsage` → `onEvent`.
  Поэтому исключение в `onEvent` не теряет usage уже обработанного события.
- Исключение в `onUsage` обрабатывается тем же механизмом, что и в `onEvent`:
  SIGTERM, при необходимости SIGKILL, ожидание `close`, ошибка
  `RuntimeUsageCallbackError` (новый класс).
- Событие, передаваемое в `onUsage`, уже очищено `sanitizeValue`.
- Тесты (4 новых, всего 18): дельты по одной на событие и их сумма равна
  `result.usage`; порядок `usage` → `event` и редакция секрета в событии; ошибка
  `onUsage` → типизированная ошибка после `close`; события без метрик не вызывают
  callback и не дают двойного подсчёта.

## 3. Пакет `packages/orchestrator`

Файлы: `package.json` (`@open-agent-office/orchestrator`, зависимости
`workspace:*`), `tsconfig.json`, `tsconfig.build.json`, `vitest.config.mjs`,
`src/`, `test/`, `README.md`.

| Файл | Назначение |
| --- | --- |
| `src/agent-execution-coordinator.ts` | `AgentExecutionCoordinator`: жизненный цикл задачи, отмена, usage-очередь |
| `src/agents.ts` | Таблица моделей четырёх сотрудников и проверка её формата |
| `src/errors.ts` | Типизированные ошибки оркестратора |
| `src/serial-queue.ts` | FIFO-очередь промисов для usage |
| `src/factory.ts` | `createOrchestrator`, фиксированная финансовая политика, пути журналов |
| `src/index.ts` | Публичный API |

Конфигурация tsconfig: для typecheck и тестов `paths` ведут на исходники
соседних пакетов; для `build` — на их `dist/index.d.ts`. `vitest.config.mjs`
содержит alias на исходники. Поэтому тесты и typecheck работают без `pnpm link`.
В собранном `dist` импорты используют пакетные имена, а не пути к `src`.

## 4. API оркестратора

```ts
const { coordinator, budget, paths } = createOrchestrator({ budgetDirectory?, usagePath?, cashPaymentsPath?, maxConcurrentTasks?, maxTaskDurationMs?, runtimeCommand?, spawn?, agents?, now? });

coordinator.runTask({ taskId, agentId, prompt, cwd, title, projectId?, sessionId?, timeoutMs?, estimatedCostUsd?, estimatedTotalTokens?, estimatedOutputTokens?, estimatedReasoningTokens?, estimatedDurationMs?, requiresExtraSpend?, onEvent? }): Promise<RuntimeResult>
coordinator.cancelTask(taskId): boolean
coordinator.modelFor(agentId): string
coordinator.activeTaskIds(): string[]
```

Правила:
- `taskId`: 1-100 символов (ограничение нужно, чтобы `taskId:usage:N` оставался
  валидным идентификатором Budget Manager). Повторное использование отклоняется
  даже после завершения задачи (`DuplicateTaskError`). ID резервируется до первого
  `await`, поэтому конкурентный дубликат тоже отклоняется.
- `modelId` в запросе отклоняется (`InvalidTaskRequestError`): модель выбирается
  только из конфигурации.
- `timeoutMs` ограничивается сверху `maxTaskDurationMs`. По умолчанию 10 минут.

## 5. Поток AbortSignal

```
runTask
  -> budget.startTask()           -> TaskHandle { abortController }
  -> runtime.runTask({ signal: handle.abortController.signal })
```

Источники отмены, все через один `AbortController`:

1. `cancelTask(taskId)` → `abort(OrchestratorError("cancelled"))`. Runtime получает
   сигнал, посылает SIGTERM, ждёт `close` и отклоняет задачу `RuntimeAbortError`.
2. Бюджет: лимит или дополнительный платёж текущего месяца вызывают
   `abort(BudgetExceededError)`. Оркестратор возвращает `TaskBudgetStopError`
   с исходной причиной.
3. Ошибка записи usage: `abort(UsageRecordingError)`. Возвращается
   `UsageRecordingError`.

Первая отмена побеждает: повторный `abort` не меняет причину.

## 6. Поток Usage и защита от двойного учёта

```
Runtime event (с токенами)
  -> onUsage(delta, event)         синхронно
  -> usageQueue.enqueue(() => budget.recordUsage({
        eventId: `${taskId}:usage:${seq}`, agentId, modelId, taskId,
        projectId, sessionId, input, output, reasoning, cacheRead,
        cacheWrite, total, costUsd: delta.cost }))
  -> onEvent(event)                пользовательский callback
...
Runtime settled
  -> await usageQueue.idle()       все записи завершены
  -> running.delete(taskId); handle.release()    (один раз, в finally)
  -> return result | throw typed error
```

Защита от двойного учёта:
- В бюджет попадают только дельты событий. `RuntimeResult.usage` не записывается
  как отдельное событие: это сумма уже учтённых дельт (тест сравнивает сумму
  записей журнала с `result.usage` по всем полям).
- Каждое usage-событие получает уникальный детерминированный `eventId` в пределах
  задачи. Повторный идентичный `eventId` в `JsonlUsageStore` — no-op.
- `onUsage` вызывается ровно один раз для каждого события с токенами.

Классификация ошибок при записи usage:
- `BudgetExceededError` (лимит, поднятый при записи): не ошибка хранилища. Бюджет
  уже отменил задачу, оркестратор ничего не отменяет повторно.
- Любая другая ошибка (`BudgetStoreError`, валидация): первая сохраняется,
  задача отменяется через `AbortController`, оркестратор возвращает
  `UsageRecordingError` с `cause`. Последующие события продолжают записываться
  (попытка), но первая ошибка не перезаписывается.

Порядок гарантирует, что slot не освобождается раньше записи usage. Если Runtime
уже завершился успешно, а хранилище дало сбой, результат не возвращается.

## 7. Модели сотрудников

| agentId | modelId | Примечание |
| --- | --- | --- |
| director | opencode-go/gpt-6-luna | только конфигурация, не запускается |
| developer | opencode-go/claude-haiku-5-5 | |
| engineer | opencode-go/minimax-m3.1-flash | |
| analyst | opencode-go/mimo-v2.6-flash | |

- Таблица заморожена (`Object.freeze`), модель нельзя подменить через запрос.
- Неизвестный `agentId` → `UnknownAgentError` до обращения к бюджету и Runtime.
- Опция `agents` заменяет таблицу, но значения проверяются на формат `provider/model`.

## 8. Расположение журналов и фабрика

По умолчанию: `~/.local/share/open-agent-office/budget/`:
- `usage.jsonl` — `JsonlUsageStore`;
- `cash-payments.jsonl` — `JsonlCashPaymentStore`.

Пути задаются абсолютными через `usagePath` / `cashPaymentsPath` или каталогом
`budgetDirectory`. Относительные пути отклоняются (`OrchestratorConfigError`).
Фабрика не создаёт файлы до первой записи.

Фиксированная политика (не принимается из опций):

```ts
monthlyBudgetRub: 1000, subscriptionCostRub: 1000, extraUsageEnabled: false,
accountingTimeZone: "Europe/Amsterdam"
```

Настраиваемые параметры: `maxConcurrentTasks` (по умолчанию 1, целое ≥ 1),
`maxTaskDurationMs` (по умолчанию 600000, не больше 2^31-1).

Стоимость подписки не записывается через `recordCashPayment`. Локальная политика
не утверждает, что дополнительное использование отключено на стороне OpenCode.

## 9. Тесты и результаты проверок

Все команды запущены из соответствующих каталогов пакетов с инструментами из
`apps/office/node_modules/.bin`. Зависимости не устанавливались.

| Проверка | Команда | Результат |
| --- | --- | --- |
| Budget Manager tests | `vitest run --cache=false` (budget-manager) | PASS, 76/76 |
| Runtime tests | `vitest run --cache=false` (runtime-opencode) | PASS, 18/18 (14 старых + 4 новых) |
| Orchestrator tests | `vitest run --cache=false` (orchestrator), 3 прогона | PASS, 34/34 каждый раз |
| Typecheck budget-manager | `npm run typecheck` | PASS, exit 0 |
| Typecheck runtime-opencode | `npm run typecheck` | PASS, exit 0 |
| Typecheck orchestrator | `npm run typecheck` | PASS, exit 0 |
| Build budget-manager | `npm run build` | PASS, exit 0, 22 файла в dist |
| Build runtime-opencode | `npm run build` | PASS, exit 0 |
| Build orchestrator | `npm run build` | PASS, exit 0, 12 файлов в dist |
| ESM orchestrator | временные symlinks `packages/orchestrator/node_modules/@open-agent-office/*` → `import("./dist/index.js")` и пакетные имена | PASS, 15 экспортов |
| ESM runtime / budget | то же, через symlinks | PASS |
| ESM из корня репозитория | `import("@open-agent-office/orchestrator")` | FAIL `ERR_MODULE_NOT_FOUND` — ожидаемо, без `pnpm install` пакеты не связаны в корневом `node_modules` |
| Очистка symlinks | `rm` созданных symlinks и `rmdir node_modules` | выполнено, `packages/orchestrator/node_modules` отсутствует |
| `git diff --check` | `git diff --check` | PASS, exit 0 (отслеживаемые файлы) |
| Пробелы в конце строк | `grep -rnE "[[:space:]]+$"` по новым и изменённым файлам | PASS, совпадений нет |

### 9.1 Сценарии интеграционных тестов (`test/coordinator.test.ts`, 26 тестов)

Все сценарии из задания покрыты. Fake spawn внедряется через `OpenCodeRuntime`
(`spawn` option), реальный OpenCode CLI не вызывается.

| # | Требование | Тест |
| --- | --- | --- |
| 1 | Задача проходит Budget Manager до Runtime | admits the task through Budget Manager before Runtime spawns a process |
| 2 | Заблокированная задача не вызывает spawn | does not call Runtime or spawn when Budget Manager blocks the task |
| 3 | Модель для каждого из четырёх agentId | selects the configured model for each of the four employees |
| 4 | Неизвестный сотрудник отклоняется | rejects an unknown employee before admission or Runtime |
| 5 | AbortSignal Budget Manager передаётся Runtime | passes the budget AbortSignal to Runtime |
| 6 | cancelTask вызывает SIGTERM | cancelTask terminates the real child with SIGTERM and waits for close |
| 7 | Ошибка Runtime → release | releases the task when Runtime fails |
| 8 | Timeout → release | releases the task on Runtime timeout |
| 9 | Usage-дельта по одной на событие | records one usage event per usage-bearing Runtime event with deterministic IDs |
| 10 | RuntimeResult.usage не записывается повторно | sums recorded usage to RuntimeResult.usage and never records the aggregate as an extra event |
| 11 | Сумма записей = RuntimeResult.usage | (тот же тест, сравнение всех полей) |
| 12 | Ошибка JSONL-записи отменяет реальный Runtime | cancels the real Runtime when a usage write fails, and reports UsageRecordingError |
| 13 | BudgetExceededError не storage error | treats a budget limit raised during usage recording as a budget stop, not a storage error |
| 14 | Платёж текущего месяца останавливает задачу | stops an active task when a current-month extra payment blocks the budget |
| 15 | Usage сохраняется до завершения задачи | keeps the slot until usage writes are durable, then releases it |
| 16 | После завершения activeTaskCount = 0 | does not leave active tasks behind after a normal completion (и тесты 7, 8, 14) |
| 17 | Сессия OpenCode сохраняется | preserves the OpenCode session in the result and in usage records, and continues a given session |
| 18 | Данные не теряются при новом BudgetManager | keeps usage and budget totals after a new BudgetManager is created with the same paths |
| 19 | taskId нельзя переиспользовать | rejects a taskId that was already used, even after the task finished; rejects a concurrent duplicate taskId |
| 20 | maxConcurrentTasks при параллельном запуске | enforces maxConcurrentTasks for parallel starts |

Дополнительно: отмена неизвестной и уже отменённой задачи не даёт ошибок;
`onEvent`, который бросает исключение, не теряет usage; промпт и ответ сотрудника
не попадают в Budget Manager и журнал; некорректные запросы (включая
`modelId` в запросе, относительный `cwd`, NaN в оценках) отклоняются до любого
побочного эффекта; пользовательская таблица агентов работает; `usage.timestamp`
берётся из часов бюджета.

### 9.2 Фабрика и очередь (`test/factory.test.ts`, 8 тестов)

Путь по умолчанию внутри домашнего каталога; `usage.jsonl` и
`cash-payments.jsonl` в каталоге журналов; отклонение относительных путей;
фиксированная политика при попытке передать финансовые поля из JS; отклонение
некорректных tunables; проверка таблицы моделей; очередь сохраняет порядок и
продолжает работу после ошибки.

### 9.3 Runtime (`packages/runtime-opencode/test/runtime.test.ts`, 18 тестов)

Четыре новых теста: дельты и их сумма; порядок `onUsage` → `onEvent` и редакция
события; `RuntimeUsageCallbackError` с SIGTERM и ожиданием `close`; отсутствие
callback для событий без метрик и отсутствие двойного подсчёта.

## 10. Изменённые и новые файлы

Новые:
- `packages/orchestrator/` (весь пакет, см. раздел 3);
- `docs/reports/OAO-RT-003.md`.

Изменённые:
- `packages/runtime-opencode/src/index.ts` — `onUsage`, дельты, `RuntimeUsageCallbackError`;
- `packages/runtime-opencode/test/runtime.test.ts` — 4 новых теста;
- `packages/runtime-opencode/README.md` — раздел про usage-дельты;
- `docs/ARCHITECTURE.md` — Orchestrator отмечен как реализованный частично.

`packages/budget-manager` не менялся. Пересобраны `dist/` трёх пакетов
(игнорируются Git). `pnpm-lock.yaml` и корневые `package.json` не менялись.

## 11. Оставшиеся ограничения

- **Lockfile.** `workspace:*` зависимости `orchestrator` не отражены в
  `pnpm-lock.yaml`. Это нужно сделать при следующем `pnpm install` (разрешено
  только по явному указанию). До этого сборка и тесты работают через `paths` и alias,
  а ESM-импорт из корня не работает.
- **Перезапуск процесса.** Список использованных `taskId` хранится в памяти.
  После перезапуска повторный ID с теми же eventId и другими данными отклонит
  журнал usage (`UsageEventConflictError`), но ID с новыми данными пройдёт. Постоянный
  реестр ID не реализован.
- **Отмена на стадии admission.** `cancelTask` возвращает `false` до регистрации
  задачи. Это окно очень короткое, но оно существует.
- **Отрицательные значения usage** из Runtime (`finiteNumber` их допускает)
  отклоняются Budget Manager, и задача завершается `UsageRecordingError`. Runtime
  не нормализует такие значения.
- **Поздний успех при нарушении (исправлено в OAO-RT-003-FIX1).** Ранее, если Runtime
  успешно завершился, а бюджет позже зафиксировал превышение, результат возвращался.
  Теперь возвращается `TaskBudgetStopError`. См. `docs/reports/OAO-RT-003-FIX1.md`.
- **Таймер.** Лимит длительности работает через `setTimeout` процесса. В тестах
  часть сценариев использует реальные таймеры (timeout 20 мс).
- **Реальный OpenCode не проверен.** Все тесты используют fake spawn. Формат
  событий соответствует существующему парсеру Runtime, но не проверялся на
  реальном CLI 1.19.5 в этой задаче.
- **Финансовая политика.** Локальная. Она не отключает дополнительное использование
  на стороне провайдера OpenCode.
- **Сервер, UI, Agent Terminal** не подключены. Оркестратор пока вызывается только из кода.
