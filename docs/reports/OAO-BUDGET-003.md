# OAO-BUDGET-003 — Финальная защита Budget Manager

Дата: 2026-11-02
Статус: **PASS** (все обязательные проверки выполнены фактически, см. раздел 8)

Продолжение `OAO-BUDGET-002`. Существующая реализация доработана, с нуля не
переписывалась. Изменения ограничены `packages/budget-manager/` и этим отчётом.
Runtime, `packages/runtime-opencode`, сервер, orchestrator, `apps/office` и UI не
менялись. Зависимости не устанавливались, lockfile не менялся, commit не создан,
git reset/restore/clean не выполнялись, реальные LLM и сотрудники не запускались.

Пакет не отслеживается Git (`?? packages/`), поэтому `git diff` не показывает его
изменения. Проверка пробелов выполнена отдельно (раздел 8).

## 1. JsonlUsageStore

Файл: `packages/budget-manager/src/jsonl-store.ts` (переписан, формат JSONL тот же).

- **Запись через FileHandle.** Файл открывается `open(path, "a+", 0o600)`. Размер
  и права читаются через `handle.stat()`.
- **Защита от склейки.** Если файл не пуст и последний байт не `\n`, перед новой
  записью добавляется `\n`. Оборванная запись остаётся отдельной битой строкой,
  которая при чтении пропускается. Новая запись на ней не теряется.
- **fsync.** После каждой записи вызывается `handle.sync()`. Если файл был создан,
  также выполняется fsync каталога. Ошибка fsync каталога игнорируется, потому что
  на части платформ он не поддерживается.
- **Права.** Каталог создаётся с `0700`, журнал с `0600`. Для уже существующего
  журнала выполняется `chmod(0600)` при записи. Это best effort: если `chmod`
  не удался, запись всё равно выполняется. Существующий каталог не переназначается.
- **Whitelist.** На запись проходят только поля `UsageRecord`. Лишние поля
  (например, prompt или ключ) отбрасываются и не попадают в файл.
- **Проверка при чтении.** Каждая строка проходит `parseUsageRecord` в строгом
  режиме. Требуется: валидный `eventId`, `agentId`, `taskId`, `modelId`, ISO-дата
  с часовым поясом, конечные неотрицательные метрики, опциональные
  `projectId`/`sessionId` с валидными идентификаторами, отсутствие лишних полей.
  Невалидные и повреждённые строки пропускаются.
- **Конфликт eventId.** Одинаковый `eventId` с одинаковыми полями — no-op
  (`appendUsage` возвращает `false`). С другими полями — `UsageEventConflictError`
  (наследник `BudgetStoreError`), журнал не меняется. Два конфликтующих события в
  файле приводят к ошибке загрузки, молчаливого выбора одного из них нет.
- **Очередь.** Последовательная очередь и индекс `eventId` сохранены и разделяются
  экземплярами с одним путём в одном процессе. Межпроцессной синхронизации нет.

Обратная совместимость: файлы, записанные в формате 002, читаются без изменений.
Новые ограничения при чтении отвергают только строки, которые `BudgetManager`
никогда не писал бы (лишние поля, невалидные значения).

## 2. Единая очередь операций

`BudgetManager` (`src/budget-manager.ts`): `startTask()`, `recordCashPayment()` и
`recordUsage()` используют один `AsyncMutex`.

- `recordUsage()` взят в очередь. Внутри записи вызывается только store, а не
  другие операции очереди. Вложенного захвата нет, поэтому взаимного ожидания
  быть не может. Тест на отсутствие deadlock ставит все четыре вида операций в
  одну очередь и проверяет, что результат получен.
- `checkTaskStart()` и чтение снимков вне очереди. `checkTaskStart()` ничего не
  регистрирует.
- Для повторного usage (тот же `eventId`, идентичные данные) `recordUsage()`
  больше не пересчитывает лимиты: проверка выполняется только для принятого события.

## 3. Остановка при дополнительном денежном расходе

`recordCashPayment()` выполняет шаги в порядке задания:

1. Проверка дубликата. Идентичный повтор сразу возвращает результат, без записи,
   без пересчёта и без `abort()`.
2. Запись в `JsonlCashPaymentStore`.
3. Обновление памяти.
4. Если платёж относится к текущему календарному месяцу и снимок стал `blocked`,
   вызывается `abort(BudgetExceededError)` для всех активных задач, которые ещё
   не отменены. Причина: «extra RUB spend recorded for the current month: extra
   budget exhausted».

Задачи не удаляются из `activeTasks`. Runtime получает сигнал отмены и сам
завершает процесс, затем вызывает `release()`. Модуль процессы не останавливает.

Платёж прошлого месяца не вызывает остановки, даже если текущий месяц уже
`blocked` (проверка `inPeriod` перед пересчётом). Конфликтующий платёж отклоняется
до любых побочных эффектов.

## 4. Таймер длительности

- Таймер взводится на **оставшееся** время:
  `maxTaskDurationMs - (now - startedAt)`, где `now` — инъецируемые часы. Задержка
  регистрации расходует лимит и не продлевает его.
- Если лимит уже достигнут, `startTask()` отклоняет задачу (`BudgetExceededError`),
  таймер не взводится. `checkTaskStart()` возвращает `allowed: false` с причиной.
- `startedAt` в будущем отклоняется (причина `startedAt cannot be in the future`).
  Без этого правила будущее `startedAt` растягивало бы лимит.
- `release()` очищает таймер. Срабатывание сверяет ссылку на запись (`ActiveTask`),
  а не только `taskId`, поэтому старый таймер не отменяет новую задачу с тем же ID.
- Проверка на usage event использует инъецируемые часы: `remaining <= 0` при
  `>=`-семантике, что соответствует срабатыванию таймера.
- Таймер использует системное время процесса. Инъецируемые часы задают
  оставшееся время на момент старта и проверки usage events.

## 5. Валидация идентификаторов и дат

`validation.ts`:

- `eventId`, `projectId` и `sessionId` в usage и `projectId`/`sessionId` в задачах
  проверяются тем же правилом, что и `taskId`/`agentId`: 1-128 символов, первый
  символ буквенно-цифровой, далее буквы, цифры, `.`, `_`, `:`, `-`.
- Даты (`timestamp`, `startedAt`, `usage.timestamp`) принимаются только как ISO 8601
  date-time с часовым поясом (`Z` или `+hh:mm`). Дата без времени и произвольные
  строки отклоняются.
- Идентичность событий сравнивается по полям: `sameUsageRecord`.

## 6. Новые тесты

Файл: `test/hardening.test.ts`, 33 теста. Исходные 43 теста в
`test/budget-manager.test.ts` сохранены без изменений. Всего 76, все проходят.
Используются временные каталоги и fake timers.

| # | Требование | Тест |
| --- | --- | --- |
| 1 | Дозапись после оборванной usage-строки | appends after a torn usage line and does not glue the new record onto it |
| 2 | Отсутствие склейки | keeps every complete record on its own line |
| 3 | fsync | calls handle.sync() (fsync) on every append (spy на `FileHandle.prototype.sync`) |
| 4 | Права файла и каталога | creates the journal with mode 0600 and its directory with mode 0700; tightens an existing journal file to mode 0600 on append |
| 5 | Повреждённые записи | skips damaged, invalid and non-whitelisted records on read |
| 6 | Конфликт eventId | returns false for an identical repeat and throws UsageEventConflictError for different data; refuses to load a journal with two conflicting lines; surfaces an explicit-eventId conflict through BudgetManager without changing the ledger |
| 7 | recordUsage и startTask | serializes a usage event and a task start in call order (usage first blocks; start first is admitted) |
| 8 | recordUsage и recordCashPayment | serializes a usage event and a cash payment that aborts the same task |
| 9 | Отмена всех задач после платежа | aborts every active task when a current-month payment exhausts the extra budget |
| 10 | Платёж прошлого месяца не отменяет | does not abort current tasks for a payment that belongs to the previous month |
| 11 | Дубликат не отменяет повторно | does not repeat abort side effects for an identical duplicate payment |
| 12 | startedAt в прошлом | arms the timer for the remaining time counted from startedAt |
| 13 | Просроченная задача | rejects a task whose limit is already reached at start, without arming a timer |
| 14 | Очистка таймера | clears the timer on release even when startedAt was in the past |
| 15 | projectId/sessionId | rejects invalid projectId and sessionId in usage events; rejects invalid projectId and sessionId in task requests |

Дополнительно: очередь при конкурентных usage (20 уникальных и 5 дубликатов без
потерь и двойного учёта); лимит задачи против конкурентных usage в порядке очереди;
отсутствие deadlock; отсутствие отмены при конфликтующем платеже; таймер при
registration delay; защита от старого таймера с тем же `taskId`; будущий
`startedAt`; ISO-валидация дат; отклонение лишних полей и `eventId` с пробелами;
требование абсолютного пути; отсутствие payment store для платёжной остановки.

Прогоны: 3 подряд — 76/76 при каждом запуске.

## 7. Финансовая модель

Не изменена: месячный бюджет 1000 ₽, подписка 1000 ₽, дополнительный бюджет 0 ₽,
`extraUsageEnabled: false`, квотные задачи разрешены при отсутствии
зарегистрированного дополнительного расхода, любой дополнительный расход текущего
месяца переводит бюджет в `blocked`, reported USD cost учитывается отдельно,
`allowanceStatus: unknown`.

Локальная политика не гарантирует отсутствие списаний со стороны провайдера
OpenCode. Модуль знает только о платежах, которые внесены через
`recordCashPayment()`.

## 8. Результаты проверок

Команды запущены из `packages/budget-manager` с инструментами из
`apps/office/node_modules/.bin`.

| Проверка | Команда | Результат |
| --- | --- | --- |
| Тесты | `vitest run --cache=false` | PASS, 76/76 (2 файла), exit 0 |
| Тесты, стабильность | то же, 3 прогона подряд | PASS, 76/76 каждый раз |
| Typecheck | `tsc --noEmit -p tsconfig.json` | PASS, exit 0 |
| Build | `npm run build` | PASS, exit 0, 22 файла в `dist/` (11 модулей × `.js`/`.d.ts`) |
| ESM из каталога пакета | `import("@open-agent-office/budget-manager")` | PASS, 16 экспортов |
| ESM через dist | `import("./dist/index.js")` | PASS, 16 экспортов |
| ESM из корня репозитория | `import("@open-agent-office/budget-manager")` | FAIL `ERR_MODULE_NOT_FOUND`, ожидаемо: пакет не связан в корневом `node_modules`, `pnpm install` не выполнялся (то же, что в 001 и 002) |
| `git diff --check` | `git diff --check` | PASS, exit 0 (отслеживаемые файлы) |
| Пробелы в конце строк | `grep -rnE "[[:space:]]+$"` по `src`, `test`, `README.md` | PASS, совпадений нет |

## 9. Изменённые файлы

- `packages/budget-manager/src/jsonl-store.ts` — переписан `JsonlUsageStore`.
- `packages/budget-manager/src/validation.ts` — идентификаторы, ISO-даты,
  `parseUsageRecord`, `sameUsageRecord`.
- `packages/budget-manager/src/errors.ts` — `UsageEventConflictError`.
- `packages/budget-manager/src/budget-manager.ts` — единая очередь, остановка при
  `blocked`, таймер по `startedAt`, идемпотентность usage и платежей.
- `packages/budget-manager/test/hardening.test.ts` (новый) — 33 теста.
- `packages/budget-manager/README.md` — обновлён.
- `docs/reports/OAO-BUDGET-003.md` — этот отчёт.
- `packages/budget-manager/dist/` — пересобран (игнорируется Git).

`test/budget-manager.test.ts` и `cash-payment-store.ts` не менялись.

## 10. Решения, которые стоит подтвердить

1. **Будущий `startedAt` отклоняется** (с `BudgetExceededError`-причиной для
   `checkTaskStart` и исключением для `startTask`). Иначе лимит растягивался бы.
2. **Даты принимаются только как ISO date-time с зоной.** Дата без времени
   отклоняется. Это строже прежнего поведения.
3. **Идентификаторы `eventId`, `projectId`, `sessionId` ограничены тем же
   правилом.** Существующие данные такой проверке соответствуют, поскольку в
   репозитории нет внешних журналов.
4. **Остановка задач только при платеже текущего месяца**, когда статус стал
   `blocked`. Платёж прошлого месяца сам по себе задачи не трогает.

## 11. Оставшиеся ограничения

- Синхронизация работает только внутри одного процесса Node.js. Два процесса на
  одном журнале не координируются. Конфликт eventId или paymentId при этом
  обнаружится при записи или загрузке.
- Экземпляр не перечитывает журнал, если другой экземпляр в том же процессе
  записал данные после его загрузки. Внутри одного пути очередь и индекс общие,
  поэтому записи не теряются и не дублируются.
- `chmod` существующего журнала — best effort. Если он не удался, права не
  меняются, и это не является ошибкой записи.
- Существующий каталог журнала не переназначается. Права 0700 гарантируются только
  для каталога, созданного модулем.
- Fsync проверен через spy на `FileHandle.prototype.sync`, а не реальным сбоем
  питания. Порядок «запись → fsync» подтверждён кодом, но не моделированием
  отключения.
- Fsync каталога игнорирует ошибки, потому что на части платформ каталог нельзя
  открыть для fsync.
- Таймер использует системное время процесса. Инъецируемые часы задают только
  логическое время. При расхождении этих источников срабатывание может
  отличаться от логического лимита. Тесты используют fake timers и инъецируемые
  часы согласованно.
- Concurrency-тесты проверяют порядок FIFO и отсутствие потерь при конкурентных
  вызовах, но не доказывают отсутствие гонок статистически. Гарантия основана на
  структуре очереди.
- Модуль учитывает только вручную внесённые RUB-платежи. Списания, о которых не
  сообщено, он не обнаруживает. Локальная политика не гарантирует отсутствие
  доплаты на стороне OpenCode.
- Остаток квоты OpenCode Go неизвестен (`allowanceStatus: unknown`).
- Лимиты per-task считаются по всей истории `taskId` в журнале usage.
- Модуль не подключён к Runtime, orchestrator, server и office. Остановка
  активных задач фактически работает только тогда, когда Runtime подпишется на
  `abortController.signal`. Это задача интеграции, не модуля.
