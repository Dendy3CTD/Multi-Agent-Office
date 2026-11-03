# OAO-RT-003-FIX1 — Исправление позднего превышения бюджета

Дата: 2026-11-02
Статус: **PASS** (все тесты и проверки выполнены фактически, см. раздел 6)

## 1. Найденная ошибка

`AgentExecutionCoordinator.runTask()` получал usage через `onUsage`, ставил запись в
последовательную очередь и вызывал `BudgetManager.recordUsage()`. Если запись
обнаруживала превышение лимита, callback записи делал так:

```ts
if (error instanceof BudgetExceededError) return;
```

Причина превышения терялась: она не сохранялась и не проверялась после завершения
Runtime. Дальше код возвращал результат так:

```ts
if (hasRuntimeError) { /* ... */ }
return result as RuntimeResult;
```

Поэтому, если Runtime успел успешно завершиться, а отложенная запись usage
выявила превышение, координатор возвращал **успешный `RuntimeResult`**. Превышение
при этом было зафиксировано в Budget Manager, но оркестратор его не видел.

Ошибка проявлялась только при позднем превышении: Runtime завершился успешно, а
запись usage ещё не закончилась. Когда превышение обнаруживалось во время работы
Runtime, отмена через `AbortSignal` приводила к `RuntimeAbortError`, и
`TaskBudgetStopError` возвращался правильно.

## 2. Исправление

Файл: `packages/orchestrator/src/agent-execution-coordinator.ts`.

1. Состояние исхода задачи вынесено в объект `failure`, который заполняют callbacks
   записи usage (присваивание внутри callback не сужает тип в TypeScript).
2. `BudgetExceededError` из записи usage сохраняется в `failure.budget`
   (первая причина). Он **не** классифицируется как `UsageRecordingError`.
   Если сигнал ещё не отменён, координатор вызывает `abort(error)`.
3. Ошибки хранилища и валидации по-прежнему сохраняются в `failure.storage`
   (первая ошибка), задача отменяется с `UsageRecordingError`.
4. После завершения Runtime выполняется `await usageQueue.idle()`, затем
   `running.delete()` и `handle.release()` ровно один раз (в `finally`).
5. Решение принимается **после** опустошения очереди. Явный порядок приоритетов:
   1. ошибка сохранения usage → `UsageRecordingError` (с полем `budgetStop`,
      если превышение тоже было);
   2. превышение бюджета (из `failure.budget` или из причины сигнала отмены
      `BudgetExceededError`) → `TaskBudgetStopError`;
   3. ошибка Runtime → передаётся как есть;
   4. иначе → `RuntimeResult`.

Причина превышения сохраняется:
- `TaskBudgetStopError.cause` — исходный `BudgetExceededError`;
- `TaskBudgetStopError.runtimeError` — ошибка Runtime, если она была (например, `RuntimeAbortError`).

### Изменения API ошибок (`src/errors.ts`)

| Класс | Было | Стало |
| --- | --- | --- |
| `TaskBudgetStopError` | `(reason, cause)`, `cause` — ошибка Runtime | `(reason, cause: BudgetExceededError, runtimeError?)`, поле `runtimeError` |
| `UsageRecordingError` | `(eventId, cause)` | `(eventId, cause, budgetStop?)`, поле `budgetStop` |

Изменение `TaskBudgetStopError` меняет смысл `cause`. Внешних потребителей в
репозитории нет, все места использования находятся в пакете и его тестах.

## 3. Что не менялось

- `packages/budget-manager` не менялся.
- `packages/runtime-opencode` не менялся.
- Фабрика, финансовая политика и пути журналов не менялись.
- Очередь (`serial-queue.ts`) не менялась: она уже ожидала все записи и не
  прерывала очередь при ошибке.
- Серверы, UI, `apps/office`, `pnpm-lock.yaml` не менялись.

## 4. Регрессионные тесты

Файл: `packages/orchestrator/test/coordinator.test.ts`, новый блок
`late budget violation (OAO-RT-003-FIX1)`, 5 тестов. До исправления четыре из них
падали (тесты на поздний успех, AbortSignal, очередь и смешанную ошибку). Тест на
однократное освобождение и тест на обычный успех проходят и до, и после исправления,
потому что защищают поведение, которое не должно было измениться.

| Требование задания | Тест | Результат до исправления |
| --- | --- | --- |
| 1. Runtime успешен, поздняя запись usage нашла превышение → `TaskBudgetStopError` | returns TaskBudgetStopError when Runtime succeeded but a deferred usage write exposed a violation | FAIL (возвращался успех) |
| 2. Превышение во время работы → Runtime получает AbortSignal | gives Runtime the budget AbortSignal when the violation is seen during the run | FAIL (нет `runtimeError`) |
| 3. Runtime успешен, запись задержана → ждём очередь | waits for the usage queue after a successful Runtime run before deciding the result | FAIL (исход — успех) |
| 4. Превышение → результат не возвращается как успешный | покрыт тестами 1 и 3 | FAIL |
| 5. TaskHandle освобождается ровно один раз | releases the TaskHandle exactly once on success, budget stop and storage failure | PASS (защитный тест) |
| 6. Ошибка хранилища → `UsageRecordingError` | cancels the real Runtime when a usage write fails... (существующий) и keeps a storage failure as UsageRecordingError and attaches the budget violation... | существующий PASS; новый FAIL (нет `budgetStop`) |
| 7. Обычная успешная задача → `RuntimeResult` | still returns the RuntimeResult for a normal task... | PASS |
| 8. Сумма usage = `RuntimeResult.usage`, без двойного учёта | sums recorded usage to RuntimeResult.usage... (существующий) и тест 7 | PASS |

Тесты используют fake spawn и временные каталоги. OpenCode и LLM не запускаются.

### Проверка, что тесты ловят регрессию (мутации)

Временные изменения вносились в файл, затем файл восстанавливался из резервной
копии, после чего `diff` подтвердил идентичность.

- Отключена проверка `budgetStop` в решении (возврат к прежнему поведению для
  позднего успеха): упали **5** тестов (новые и связанные).
- Удалено `await usageQueue.idle()`: упали **7** тестов, включая все регрессионные.

## 5. Сохранение поведения

Проверено существующими тестами (все проходят):
- успешные задачи возвращают `RuntimeResult`;
- обычная отмена пользователя → `RuntimeAbortError` без `TaskBudgetStopError`;
- `RuntimeTimeoutError` и `RuntimeAbortError` передаются как есть;
- `UsageRecordingError` при ошибке хранилища;
- уникальность `eventId` (`taskId:usage:N`);
- сохранение usage при отмене задачи (записи дожидаются очереди);
- `RuntimeResult.usage` не записывается повторно.

## 6. Фактические результаты проверок

Команды запущены из каталогов пакетов с инструментами из
`apps/office/node_modules/.bin`. Зависимости не устанавливались, lockfile не менялся.

| Проверка | Результат |
| --- | --- |
| Budget Manager tests (`vitest run --cache=false`) | PASS, 76/76 |
| Runtime tests | PASS, 18/18 |
| Orchestrator tests, 1-й прогон | PASS, 40/40 |
| Orchestrator tests, 2-й прогон | PASS, 40/40 |
| Orchestrator tests, 3-й прогон | PASS, 40/40 |
| Typecheck budget-manager | PASS, exit 0 |
| Typecheck runtime-opencode | PASS, exit 0 |
| Typecheck orchestrator | PASS, exit 0 |
| Build budget-manager | PASS, exit 0 |
| Build runtime-opencode | PASS, exit 0 |
| Build orchestrator | PASS, exit 0 |
| ESM orchestrator | PASS: `import("./dist/index.js")` с временными symlinks, экспорты `TaskBudgetStopError`, `UsageRecordingError` доступны |
| Очистка symlinks | выполнена, `packages/orchestrator/node_modules` отсутствует |
| `git diff --check` | PASS, exit 0 |
| Пробелы в конце строк (новые и изменённые файлы orchestrator) | PASS, совпадений нет |

## 7. Изменённые файлы

- `packages/orchestrator/src/agent-execution-coordinator.ts` — исправление обработки и порядка решения.
- `packages/orchestrator/src/errors.ts` — `TaskBudgetStopError.runtimeError`, `UsageRecordingError.budgetStop`.
- `packages/orchestrator/test/coordinator.test.ts` — блок `late budget violation`, 5 тестов.
- `packages/orchestrator/README.md` — таблица ошибок и порядок решения.
- `docs/reports/OAO-RT-003.md` — ограничение про поздний успех помечено как исправленное.
- `docs/reports/OAO-RT-003-FIX1.md` — этот отчёт.
- `packages/orchestrator/dist/` — пересобран (игнорируется Git).

## 8. Оставшиеся ограничения

- **Изменение поведения при позднем платеже.** Если дополнительный платёж текущего
  месяца блокирует бюджет после завершения Runtime, но до освобождения задачи,
  координатор теперь возвращает `TaskBudgetStopError`. Раньше возвращался успех.
  Это соответствует правилу «не возвращать успех при превышении», но меняет
  результат для такого редкого случая.
- **Отмена пользователем и превышение одновременно.** Если пользователь отменил
  задачу, а запись usage затем нашла превышение, возвращается `TaskBudgetStopError`,
  а не `RuntimeAbortError`. Причина превышения важнее для учёта. Отдельного теста
  на это сочетание нет; решение описано здесь и в README.
- **Блокировка admission на время записи.** Пока запись usage ждёт хранилища,
  `startTask` и `recordCashPayment` ждут в той же очереди Budget Manager. Это
  корректно, но медленное хранилище замедляет запуск других задач.
- **Тесты на fake spawn.** Поведение с реальным OpenCode CLI не проверялось.
- **`pnpm-lock.yaml`** по-прежнему не содержит `workspace:*` записей orchestrator.
  Это нужно сделать при следующем разрешённом `pnpm install`.
