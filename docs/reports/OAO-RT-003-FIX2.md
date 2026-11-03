# OAO-RT-003-FIX2 — Проверка конкурирующих причин отмены

Дата: 2026-11-02
Статус: **PASS** (все тесты и проверки выполнены фактически, см. раздел 5)

## 1. Проверяемый сценарий

1. Пользователь вызывает `cancelTask(taskId)`.
2. `AbortController` отменяется с `OrchestratorError("cancelled")`. Runtime
   посылает SIGTERM и ждёт `close`.
3. До `close` в stdout приходит usage-событие.
4. `BudgetManager.recordUsage()` видит превышение лимита и выбрасывает
   `BudgetExceededError`.
5. Runtime завершается с `RuntimeAbortError`.

Ожидаемый результат: `TaskBudgetStopError` с исходным `BudgetExceededError` в
`cause` и `RuntimeAbortError` в `runtimeError`. Приоритет бюджетной блокировки
над обычной пользовательской отменой зафиксирован в FIX1.

## 2. Анализ текущего кода (до изменений)

Production-код не менялся, потому что проверка показала, что нужное поведение уже
обеспечивается.

- `cancelTask` вызывает `abort(...)` и не удаляет задачу из `running`.
- Runtime после `abort` переходит в режим завершения (`pendingFailure`), но
  продолжает обрабатывать stdout до `close`. Условие в `consume` проверяет только
  `settled` и `stdoutEnded`, а не `pendingFailure`. Поэтому usage-событие, пришедшее
  во время завершения, доходит до `onUsage`.
- `onUsage` ставит запись в очередь. Callback записи находит превышение и
  сохраняет его в `failure.budget` (FIX1). Повторный `abort` для уже отменённого
  сигнала не выполняется, что корректно: причина первой отмены остаётся в сигнале.
- После `close` Runtime возвращает `RuntimeAbortError`. Координатор ждёт
  `usageQueue.idle()`, освобождает `TaskHandle` один раз, затем принимает решение.
  Превышение из `failure.budget` имеет приоритет над ошибкой Runtime, поэтому
  возвращается `TaskBudgetStopError`.

Ошибок в production-коде не обнаружено, поэтому исправления не вносились.

## 3. Регрессионные тесты

Файл: `packages/orchestrator/test/coordinator.test.ts`, блок
`competing cancellation causes (OAO-RT-003-FIX2)`, 3 теста.

Для воспроизведения окна завершения добавлен режим `manualClose`: дочерний процесс
не закрывается при `kill`, а тест сам вызывает `close`. Это моделирует процесс,
который ещё завершается. Реальные процессы не запускаются.

| Требование | Тест | Результат |
| --- | --- | --- |
| Гонка отмены и превышения → `TaskBudgetStopError` | reports TaskBudgetStopError when a user cancel and a budget violation race during shutdown | PASS |
| `cause` содержит исходный `BudgetExceededError` | (тот же тест) | PASS |
| `runtimeError` содержит `RuntimeAbortError` | (тот же тест) | PASS |
| Usage-очередь завершена до возврата ошибки | (тот же тест): `eventCount === 1` в момент возврата | PASS |
| TaskHandle освобождён ровно один раз | (тот же тест) | PASS |
| Обычная отмена без превышения → `RuntimeAbortError` | keeps a plain user cancellation as RuntimeAbortError when no budget violation happened | PASS |
| Ошибка хранилища при гонке → `UsageRecordingError` (высший приоритет) | keeps a storage failure during a racing cancellation as UsageRecordingError (highest priority) | PASS |

### Проверка, что тест ловит регрессию

Временно удалено запоминание превышения (`failure.budget ??= error;`). Тест гонки
упал (`TaskBudgetStopError` не получен). Остальные 42 теста прошли. Файл
восстановлен из резервной копии, `diff` подтвердил идентичность.

## 4. Изменённые файлы

- `packages/orchestrator/test/coordinator.test.ts` — функция `fakeSpawn` получила
  параметр `autoClose`; `setup` — опцию `manualClose`; новый блок из 3 тестов.
- `docs/reports/OAO-RT-003-FIX2.md` — этот отчёт.

Production-код (`src/`), Budget Manager и Runtime не менялись.

## 5. Фактические результаты проверок

Команды запущены из каталогов пакетов с инструментами из
`apps/office/node_modules/.bin`. Зависимости не устанавливались, lockfile не менялся.

| Проверка | Результат |
| --- | --- |
| Budget Manager tests (`vitest run --cache=false`) | PASS, 76/76 |
| Runtime tests | PASS, 18/18 |
| Orchestrator tests, прогон 1 | PASS, 43/43 |
| Orchestrator tests, прогон 2 | PASS, 43/43 |
| Orchestrator tests, прогон 3 | PASS, 43/43 |
| Typecheck budget-manager | PASS, exit 0 |
| Typecheck runtime-opencode | PASS, exit 0 |
| Typecheck orchestrator | PASS, exit 0 |
| Build budget-manager | PASS, exit 0 |
| Build runtime-opencode | PASS, exit 0 |
| Build orchestrator | PASS, exit 0 |
| ESM orchestrator | PASS: `import("./dist/index.js")` с временными symlinks, 15 экспортов, `TaskBudgetStopError` и `UsageRecordingError` доступны |
| Очистка symlinks | выполнена, `packages/orchestrator/node_modules` отсутствует |
| `git diff --check` | PASS, exit 0 |
| Пробелы в конце строк (`packages/orchestrator/src`, `test`) | PASS, совпадений нет |

## 6. Оставшиеся ограничения

- Тест гонки детерминирован благодаря `manualClose` и явному ожиданию событий, но
  использует ожидание через `vi.waitFor` и `setImmediate`. Это не формальная
  проверка всех возможных порядков событий.
- Поведение с реальным OpenCode CLI не проверялось: все тесты используют fake spawn.
- `pnpm-lock.yaml` по-прежнему не содержит записей `workspace:*` для orchestrator.
