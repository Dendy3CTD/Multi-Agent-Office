# OAO-BUDGET-002 — Повышение надёжности Budget Manager

Дата: 2026-11-02
Статус: **PASS** (все обязательные проверки выполнены фактически, см. раздел 9)

Продолжение `OAO-BUDGET-001`. Существующая реализация доработана, с нуля не
переписывалась. Изменения ограничены `packages/budget-manager/` и этим отчётом.
Runtime, сервер, orchestrator, `apps/office` и `packages/runtime-opencode` не
менялись. Зависимости не устанавливались, lockfile не менялся, commit не создан.

Примечание о Git: `packages/` в текущем репозитории не отслеживается
(`?? packages/`), поэтому `git diff` не показывает изменения пакета. Проверка
пробелов для новых файлов выполнена отдельно (`grep` по trailing whitespace).

## 1. Архитектура payment store

```
BudgetManager
 ├── UsageStore            (JsonlUsageStore, без изменений по сути)
 ├── CashPaymentStore      (интерфейс, types.ts)
 │    └── JsonlCashPaymentStore   (cash-payment-store.ts)
 ├── AsyncMutex            (async-mutex.ts) — admission: startTask + recordCashPayment
 └── accounting-period.ts  — границы календарного месяца в IANA-зоне
```

`CashPaymentStore`:
- `appendPayment(payment): Promise<boolean>` — `true`, если записано новое;
  `false`, если идентичная запись уже есть; `CashPaymentConflictError`, если
  тот же `paymentId` с другими данными.
- `readPayments(): Promise<CashPayment[]>`.

`JsonlCashPaymentStore`:
- Путь обязан быть абсолютным (`TypeError` иначе), открывается через `node:fs/promises`.
- Одна JSON-строка на платёж. В файл пишутся только `paymentId`, `amountRub`,
  `timestamp` (whitelist в `normalizeCashPayment`). Поле `description`
  удалено из модели: свободный текст мог бы содержать секреты или prompts.
- Файл создаётся с правами `0600`, каталог — `0700`. После записи выполняется `fsync`.
- Если предыдущая запись оборвалась без `\n`, новая запись начинается с новой
  строки и не склеивается с обрывком.
- Чтение: битый JSON, невалидные поля и обрезанные строки пропускаются. Два
  конфликтующих платежа с одним ID в журнале приводят к ошибке загрузки. Модуль
  не выбирает одну из двух записей молча.
- Все операции в одном процессе идут через очередь по абсолютному пути. Экземпляры
  с одним путём разделяют состояние и очередь.

## 2. Изменения API

| Метод / поведение | Было | Стало |
| --- | --- | --- |
| `recordCashPayment(p)` | `void`, память | `Promise<CashPayment>`, журнал |
| `getCashPayments()` | `CashPayment[]` | `Promise<CashPayment[]>` |
| Без `paymentStore` | платежи молча в памяти | `BudgetStoreError: Cash payment store is not configured` для платежей, `getSnapshot`, `checkTaskStart`, `startTask` |
| `new BudgetManager(store, options)` | `options: {policy, now}` | добавлено `options.paymentStore` |
| `CashPayment.description` | было | удалено (не сохраняется) |
| `BudgetPolicyConfig.accountingTimeZone` | — | новое, по умолчанию `"UTC"` |
| `checkTaskStart(request)` | при пустых id — `reason` | при невалидном вводе — `TypeError` |
| `TaskHandle.abortController.abort(reason)` | `abort()` без причины | `abort(BudgetExceededError)` |
| `getMonthlySummary(month?)` | по умолчанию текущий UTC-месяц | текущий период в `accountingTimeZone` |

Новые экспорты: `CashPaymentStore` (тип), `JsonlCashPaymentStore`,
`CashPaymentConflictError`, `BudgetStoreError` и `BudgetExceededError` (вынесены
в `errors.ts`, публичное имя не изменилось), `currentAccountingPeriod`,
`monthAccountingPeriod`, `assertTimeZone`.

Внешних вызовов этих методов в репозитории нет. Поиск по всему проекту
(`recordCashPayment`, `getCashPayments`, `startTask`, `getSnapshot`,
`checkTaskStart`, `budget-manager`) нашёл только сам пакет, его тесты и
документацию, поэтому сторонние компоненты не затронуты.

Конструктор остаётся синхронным, поэтому журналы загружаются при первом
обращении или явным `load()`, а не в момент `new`. Загрузка повторяется, если
предыдущая попытка упала.

## 3. Mutex и атомарный запуск

`AsyncMutex` — FIFO-очередь на промисах (`async-mutex.ts`). Через неё проходят
`startTask()` и `recordCashPayment()`:

1. `startTask`: `load` → `buildSnapshot` → проверка блокировок (дубликат ID,
   `maxConcurrentTasks`, статус `blocked`, политика, оценки, месячный лимит
   сотрудника) → регистрация в `activeTasks` → запуск таймера.
2. `recordCashPayment`: валидация → проверка дубликата → `appendPayment` → обновление памяти.

`checkTaskStart()` — только предпросмотр, слот не резервирует (тест это проверяет).
Гарантия действует только в пределах одного процесса Node.js.

Порядок FIFO сохраняется, потому что `run()` вызывается синхронно при вызове
`startTask()`. Поэтому гонка «платёж → старт» и «старт → платёж» разрешается
детерминированно.

## 4. Таймер длительности

- При `startTask` с `maxTaskDurationMs` запускается `setTimeout`. Таймер
  `unref()`, поэтому не держит процесс.
- По истечении: `abortController.abort(new BudgetExceededError("maximum task duration exceeded"))`.
  Слот остаётся занятым до `release()`.
- `release()` (и `releaseTask`) вызывает `clearTimeout`. Операция идемпотентна.
  Таймер сравнивает ссылку на запись, поэтому не отменяет задачу с тем же ID,
  запущенную после release.
- Usage-проверка использует `now()` (инъецируемые часы), а не `Date.now()`.
  Условие: `elapsed >= maxTaskDurationMs` (достижение лимита, как у таймера).
- `maxTaskDurationMs` ограничен 2^31-1 мс: больший `setTimeout` срабатывает сразу.
  Такое значение отклоняется `BudgetPolicyError`.

## 5. Месячные расчёты

- Период `[from, to)`: `from` — первый момент месяца, `to` — первый момент
  следующего, в `accountingTimeZone` (по умолчанию `UTC`). Границы считаются
  через `Intl.DateTimeFormat` без внешних зависимостей. Смещение зоны
  вычисляется для конкретного момента, поэтому DST учитывается.
- `extraSpendRub` и `actualSpendRub` — только платежи текущего периода.
- `monthlyUsage` и `reportedUsageUsd` — только usage текущего периода.
- Исторические платежи и usage не удаляются; `getCashPayments()` возвращает все.
- Лимиты сотрудника (`agentLimits`) — месячные. Проверка при старте
  использует `текущее использование + оценка`. Раньше использовалась только оценка,
  а `enforceTaskLimits` суммировал всю историю.
- Сравнение времени в `UsageLedger` переведено на `Date.parse`, а не на строки.
  Строковое сравнение ломалось бы для ISO-строк с другим форматом.

Статус по-прежнему зависит только от RUB-платежей текущего месяца. При
нулевом дополнительном бюджете любой такой платёж даёт `blocked`, и новые задачи
(включая квотные) не стартуют до смены месяца. Это соответствует пункту 7
задания. Ограничение 1 из `OAO-BUDGET-001` тем самым закрыто в пользу
консервативной трактовки. Если нужна другая трактовка, её надо задать явно.

## 6. Валидация входных данных

Отклоняются с `TypeError` (до любой проверки бюджета):
- NaN, Infinity, отрицательные значения: usage metrics, все `estimated*`, суммы
  платежей;
- невалидные `taskId`, `agentId`, `paymentId` (1-128 символов: буквы, цифры,
  `.`, `_`, `:`, `-`; первый символ буквенно-цифровой);
- невалидный `startedAt`, `timestamp` платежа и usage (нормализуются в ISO UTC);
- нестрогий `requiresExtraSpend` (не boolean);
- пустой `modelId`, `eventId`, `projectId`, `sessionId`.

Невалидный вход не может обойти лимит: сравнение с NaN не выполняется, потому
что значение отклоняется раньше.

## 7. Результаты тестов

Файл: `test/budget-manager.test.ts`, 43 теста, все проходят. Исходные 11 тестов
сохранены и адаптированы под async API и `paymentStore`. Новые 32 теста:

Обязательные 15 сценариев:

| # | Сценарий | Тест |
| --- | --- | --- |
| 1 | Сохранение платежа в JSONL | persists payments to a JSONL file with whitelisted fields only |
| 2 | Восстановление после нового экземпляра | restores payments after a new BudgetManager instance is created |
| 3 | Дедупликация paymentId | deduplicates identical repeats without increasing spend |
| 4 | Конфликт одинакового ID | rejects the same paymentId with different data and leaves the journal unchanged |
| 5 | Повреждённый payment JSONL | skips damaged, invalid and partially written payment lines |
| 6 | Суммирование текущего месяца | counts only current-month payments and keeps historical records |
| 7 | Игнорирование прошлого месяца | does not let a previous month's payment block the new month |
| 8 | Декабрь → январь | rolls over December to January in UTC, including the exact boundary instant |
| 9 | Параллельные startTask при maxConcurrentTasks=1 | never exceeds maxConcurrentTasks under parallel startTask calls |
| 10 | Платёж и старт одновременно | orders a payment and a task start that race each other deterministically |
| 11 | Автоотмена по таймеру | aborts an active task when maxTaskDurationMs is reached |
| 12 | Очистка таймера после release | clears the timer on release so a finished task is never aborted |
| 13 | Инъецируемые часы | uses the injected clock for duration checks on usage events |
| 14 | Месячный лимит сотрудника | applies per-agent limits to the current month only |
| 15 | NaN, Infinity, отрицательные оценки | rejects NaN, Infinity and negative estimates so they cannot bypass limits |

Дополнительно:
- сохранение и восстановление, конфликт при загрузке журнала
  (refuses to load a journal that contains conflicting records);
- дописывание после оборванной строки (appends after a partially written line);
- параллельные записи разных платежей (serializes concurrent appends);
- абсолютный путь и отсутствие `paymentStore` (явная ошибка, usage работает);
- часовой пояс: `Europe/Moscow` vs `UTC` на одной и той же границе;
- границы периодов и неизвестная зона (`BudgetPolicyError`);
- `checkTaskStart` не резервирует слот;
- нет утечки таймеров при 20 циклах start/release;
- одновременные usage event и срабатывание таймера (оба порядка, без двойного
  учёта и без выброса из таймера);
- `maxTaskDurationMs` больше 2^31-1 отклоняется;
- валидация task, payment и usage входа.

Прогоны: 3 подряд и 1 подробный — 43/43, без нестабильности.

## 8. Изменённые файлы

- `packages/budget-manager/src/errors.ts` (новый): ошибки, вынесены из budget-manager.
- `packages/budget-manager/src/async-mutex.ts` (новый).
- `packages/budget-manager/src/accounting-period.ts` (новый).
- `packages/budget-manager/src/validation.ts` (новый).
- `packages/budget-manager/src/cash-payment-store.ts` (новый): `JsonlCashPaymentStore`.
- `packages/budget-manager/src/budget-manager.ts`: переписан с сохранением публичных методов.
- `packages/budget-manager/src/types.ts`: `CashPaymentStore`, `accountingTimeZone`, без `description`.
- `packages/budget-manager/src/budget-policy.ts`: проверка зоны и таймера.
- `packages/budget-manager/src/usage-ledger.ts`: сравнение времени через `Date.parse`.
- `packages/budget-manager/src/index.ts`: новые экспорты.
- `packages/budget-manager/test/budget-manager.test.ts`: 43 теста.
- `packages/budget-manager/README.md`: обновлён.
- `docs/reports/OAO-BUDGET-002.md`: этот отчёт.
- `packages/budget-manager/dist/`: пересобран (игнорируется Git).

`jsonl-store.ts` (JSONL usage) не менялся.

## 9. Проверки

Все команды запущены из `packages/budget-manager` с инструментами из
`apps/office/node_modules/.bin`.

| Проверка | Команда | Результат |
| --- | --- | --- |
| Тесты | `vitest run --cache=false` | PASS, 43/43, exit 0 |
| Тесты (повтор ×3) | то же | PASS, 43/43 при каждом запуске |
| Typecheck | `tsc --noEmit -p tsconfig.json` | PASS, exit 0 |
| Build | `npm run build` (`tsc -p tsconfig.build.json`) | PASS, exit 0, 22 файла в dist |
| ESM из каталога пакета | `import("@open-agent-office/budget-manager")` | PASS, 15 экспортов |
| ESM через dist | `import("./dist/index.js")` + `new JsonlCashPaymentStore` | PASS |
| ESM из корня репозитория | `import("@open-agent-office/budget-manager")` | FAIL `ERR_MODULE_NOT_FOUND` — ожидаемо, как в 001: `pnpm install` не выполнялся, пакет не связан в корневом `node_modules` |
| `git diff --check` | `git -C ../.. diff --check` | PASS, exit 0 (отслеживаемые файлы; пакет не отслеживается) |
| Пробелы в конце строк (новые файлы) | `grep -rnE "[[:space:]]+$"` по `src`, `test`, `README.md`, конфигам | PASS, совпадений нет |

## 10. Решения, требующие подтверждения

1. **Часовой пояс по умолчанию — `UTC`.** Это совпадает с прежним поведением
   модуля. Если месяцы должны считаться по Москве, задайте
   `accountingTimeZone: "Europe/Moscow"`. Это влияет на то, в какой месяц попадёт
   платёж ночью на границе месяца.
2. **Блокировка всех задач при `blocked`.** Трактовка принята по пункту 7 задания
   (квотные задачи разрешены только без дополнительного расхода).
3. **Месячные лимиты сотрудника вместо накопительных.** Поведение изменено
   намеренно, по пункту 5 задания.
4. **Удалено поле `description`** из `CashPayment`. Это breaking-изменение модели,
   но внешних потребителей нет.

## 11. Оставшиеся ограничения

- Синхронизация (mutex и очередь записи) работает только в одном процессе
  Node.js. Межпроцессной блокировки нет. Два процесса на одном журнале могут
  записать конфликтующие данные, и тогда второй увидит ошибку
  `CashPaymentConflictError` при записи или загрузке.
- Экземпляр не перечитывает журнал платежей, если другой экземпляр в том же процессе
  записал платёж после его загрузки. Такой платёж появится после пересоздания
  экземпляра. Дедупликация на уровне журнала при этом сохраняется.
- `JsonlUsageStore` не менялся. У него нет защиты от оборванной строки и нет
  `fsync`. Это то же самое, что исправлено в `JsonlCashPaymentStore`, и требует
  отдельной задачи.
- Лимиты per-task считаются по всей истории `taskId` в журнале usage. Повторное
  использование `taskId` в разных месяцах накапливает расход.
- Промежуточные usage events проверяются на границах событий. Уже выполняющийся
  шаг может дать перерасход до следующего события.
- Модуль не знает остатка квоты OpenCode Go (`allowanceStatus: unknown`) и не
  подтверждает, что доплата отключена на стороне аккаунта OpenCode.
- Модуль учитывает только вручную внесённые RUB-платежи. Неотражённые списания
  он не обнаруживает.
- Модуль не подключён к Runtime, orchestrator, server и office.
- Импорт из корня репозитория не работает до `pnpm install` (см. раздел 9).
- `assertTimeZone` экспортирован публично. Это вспомогательная функция, её API
  может измениться.
