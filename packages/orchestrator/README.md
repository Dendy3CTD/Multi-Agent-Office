# Orchestrator

`@open-agent-office/orchestrator` связывает Budget Manager и OpenCode Runtime
для одной задачи сотрудника. Пакет не копирует код этих библиотек, а получает их
через `workspace:*` зависимости. Пакет не подключён к серверу, UI и
`apps/office`.

## Схема

```
AgentExecutionCoordinator.runTask(request)
  1. validate request (taskId, cwd, estimates; modelId in request is rejected)
  2. modelFor(agentId)                      -> UnknownAgentError before any side effect
  3. budget.startTask({...})                -> BudgetExceededError / BudgetStoreError, Runtime not called
  4. runtime.runTask({ model, signal: handle.abortController.signal,
                       onUsage, onEvent, timeoutMs })
       onUsage(delta, event)  -> serial queue -> budget.recordUsage({ eventId, ... })
  5. await usage queue          (usage is durable before the slot is released)
  6. handle.release()           (exactly once, in finally)
  7. return RuntimeResult or the typed error
```

## Модели сотрудников

Таблица маршрутизации по умолчанию (`DEFAULT_AGENT_MODELS`, OAO-MODEL-002):
пять сотрудников на экономичных моделях. Модели не запускаются пакетом,
это только конфигурация.

| agentId | modelId |
| --- | --- |
| director | opencode-go/mimo-v2.6-flash |
| developer | opencode-go/glm-5.3-flash |
| engineer | opencode-go/qwen3.8-flash |
| analyst | opencode-go/mimo-v2.6-flash |
| helper | opencode-go/beam-free |

Модель нельзя передать в запросе: поле `modelId` отклоняется. Конфигурацию
можно заменить через опцию `agents`, но значения должны иметь вид `provider/model`.

### Helper — вспомогательный сотрудник

`helper` — пятый сотрудник на Beam Free. Он оказывает универсальную поддержку
четырём основным сотрудникам: краткие исследования и сбор справочной информации,
сводки, чек-листы и документация, объяснение ошибок и небольших фрагментов кода,
форматирование и структурирование данных, предварительная проверка небольших
результатов, подготовка вспомогательных материалов.

Helper не заменяет разработчика, инженера, аналитика или директора. Он
вспомогательный и не обязан участвовать в каждом проекте: его запускают только
по явному запросу для небольших поручений. Оркестратор не запускает его
автоматически — как и остальных сотрудников, Helper работает только через
явный `runTask`. Автоматическая передача подзадач между агентами появится
позже в Orchestrator и не имитируется.

## API

```ts
const { coordinator, budget } = createOrchestrator({
  budgetDirectory: "/absolute/path/optional", // default ~/.local/share/open-agent-office/budget
  maxConcurrentTasks: 1,                      // tunable, positive integer
  maxTaskDurationMs: 600_000,                 // tunable, <= 2^31-1
});

const result = await coordinator.runTask({
  taskId: "task-42",                 // unique, never reused by this coordinator
  agentId: "developer",
  prompt: "...",                     // never stored in Budget Manager
  cwd: "/absolute/worktree",
  title: "Office task",
  sessionId: "optional-existing-session",
  timeoutMs: 120_000,                // capped by maxTaskDurationMs
  estimatedCostUsd: 0.05,
  onEvent: (event) => {},
});

coordinator.cancelTask("task-42");   // true if cancellation was requested now
```

- `runTask` возвращает `RuntimeResult`.
- `cancelTask` отменяет реальную задачу через её `AbortController`. Runtime
  посылает SIGTERM (при необходимости SIGKILL) и ждёт `close`. Повторная отмена
  не вызывает ошибки.
- `modelFor(agentId)` возвращает модель или бросает `UnknownAgentError`.
- `activeTaskIds()` возвращает запущенные задачи.

## Usage

Каждая usage-дельта Runtime записывается отдельно. Идентификатор события:
`${taskId}:usage:${sequence}`. Итоговый `RuntimeResult.usage` не записывается:
это сумма уже учтённых дельт. Запись идёт через последовательную очередь, поэтому
порядок сохраняется. `onUsage` вызывается до `onEvent`, поэтому исключение в
`onEvent` не теряет usage.

## Ошибки

| Класс | Когда |
| --- | --- |
| `UnknownAgentError` | agentId нет в таблице моделей. Runtime не вызывается. |
| `InvalidTaskRequestError` | Некорректный запрос, включая `modelId` в запросе. |
| `DuplicateTaskError` | taskId уже использовался в этом координаторе. |
| `BudgetExceededError` (из budget) | Бюджет запретил запуск. Runtime не вызывается. |
| `BudgetStoreError` (из budget) | Не удалось прочитать журнал до старта. |
| `TaskBudgetStopError` | Бюджет остановил задачу (лимит или дополнительный платёж). `reason` — причина, `cause` — исходный `BudgetExceededError`, `runtimeError` — ошибка Runtime, если она была. |
| `UsageRecordingError` | Usage не записан (хранилище или валидация). Задача отменена. `cause` — исходная ошибка, `budgetStop` — превышение бюджета, если оно случилось одновременно. |
| `RuntimeAbortError`, `RuntimeTimeoutError`, `RuntimeExitError` и др. (из runtime) | Передаются без изменений. |

Превышение лимита, обнаруженное при записи usage, классифицируется как
`TaskBudgetStopError`, а не как `UsageRecordingError`.

Порядок решения после завершения Runtime и опустошения очереди usage:

1. ошибка сохранения usage → `UsageRecordingError` (с `budgetStop`, если превышение тоже было);
2. превышение бюджета (из записи usage или из сигнала отмены) → `TaskBudgetStopError`;
3. ошибка Runtime → передаётся как есть;
4. иначе → `RuntimeResult`.

Поэтому успешный `RuntimeResult` не возвращается, если бюджет зафиксировал превышение
до освобождения задачи, даже когда Runtime уже завершился. TaskHandle освобождается
ровно один раз, после опустошения очереди usage.

## Журналы

По умолчанию: `~/.local/share/open-agent-office/budget/`:

- `usage.jsonl` — `JsonlUsageStore`;
- `cash-payments.jsonl` — `JsonlCashPaymentStore`.

Пути можно задать абсолютными через `usagePath` и `cashPaymentsPath`. Относительные
пути отклоняются. Каталог журналов находится вне Git-репозитория.

## Фиксированная финансовая политика

`createOrchestrator` не принимает финансовые параметры. Политика фиксирована:

- месячный бюджет 1000 ₽;
- подписка OpenCode Go 1000 ₽ (дополнительный бюджет 0 ₽);
- `extraUsageEnabled: false`;
- `accountingTimeZone: "Europe/Amsterdam"`.

Это локальная политика приложения. Она не отключает дополнительное использование
на стороне провайдера OpenCode, для этого нужна настройка аккаунта.
Стоимость подписки не записывается через `recordCashPayment`, потому что
учитывается как `subscriptionCostRub`.

## Тесты

```sh
../../apps/office/node_modules/.bin/vitest run --cache=false
```

Тесты используют fake spawn и временные каталоги. OpenCode CLI и внешние LLM не
запускаются. `vitest.config.mjs` подключает исходники соседних пакетов, поэтому
связывание через pnpm для тестов не требуется.

## Ограничения

- `taskId` проверяется только внутри одного процесса. После перезапуска список
  использованных ID теряется. Повторный ID с другими данными отклонит журнал
  usage (`UsageEventConflictError`).
- Отмена во время admission (до регистрации задачи) невозможна: `cancelTask`
  вернёт `false`.
- Отрицательные значения usage из Runtime отклоняются Budget Manager и приводят
  к `UsageRecordingError`.
- Сам координатор не реализует планирование, повторы и восстановление после сбоя.
