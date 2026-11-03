# OAO-BUDGET-001-FINALIZE — Проверка Budget Manager

Дата: 2026-11-02
Статус: **PASS** (проверки выполнены повторно в текущем состоянии репозитория)

## Что проверено

Повторный независимый прогон по `packages/budget-manager/`: исходники
(`src/types.ts`, `budget-policy.ts`, `usage-ledger.ts`, `jsonl-store.ts`,
`budget-manager.ts`, `index.ts`), тесты, `package.json` с `exports`,
`tsconfig*.json`, README, фактический `dist/`, ESM-импорт и `git` состояние.

Исходный код **не изменялся**: финансовые инварианты и заявленные возможности
совпадают с реализацией. Единственное действие с файлами — пересборка `dist/`
(каталог игнорируется Git).

## Артефакт Vitest

Файл
`packages/budget-manager/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`
**отсутствует** — каталог `da39…` пуст до и после запуска тестов с
`--cache=false`. Поэтому удаление не выполнялось. Других файлов не удалялось.

## Финансовая модель (проверено по `budget-policy.ts`, `types.ts`, `budget-manager.ts`)

| Требование | Факт в коде | Статус |
| --- | --- | --- |
| Подписка OpenCode Go 1000 ₽ | `DEFAULT_BUDGET_POLICY.subscriptionCostRub = 1000` | OK |
| Месячный денежный бюджет 1000 ₽ | `monthlyBudgetRub = 1000` | OK |
| Дополнительных денег 0 ₽ | `extraBudgetRub = 1000 - 1000 = 0` | OK |
| Доп. платные расходы запрещены | `extraUsageEnabled = false`; `requiresExtraSpend` отклоняется | OK |
| Запросы внутри квоты Go разрешены | статус вычисляется только по RUB-платежам; подписка не блокирует | OK (см. ограничение 1) |
| USD reported cost отдельно от RUB | `reportedUsageUsd` агрегируется отдельно, не конвертируется | OK |
| Неизвестная квота Go = `unknown` | `allowanceStatus: "unknown"` (константа) | OK |

Валидация отклоняет `subscriptionCostRub > monthlyBudgetRub`.

## Остальные пункты проверки

- **JSONL-хранилище:** `JsonlUsageStore` требует абсолютный путь, создаёт
  каталог, пишет по одной JSON-строке на событие, пропускает повреждённые
  строки при чтении. Prompts и секреты в `UsageRecord` не попадают: валидация
  отклоняет нечисловые метрики, а тест проверяет отсутствие `private prompt` и
  `api-secret` в файле.
- **Учёт использования:** агрегация по agent, model, task, project, session,
  day и month; тесты покрывают суммирование и группировку.
- **Дедупликация:** по `eventId` или стабильному SHA-256 от метаданных и
  счётчиков; конкурентные записи в одном процессе сериализуются очередью.
- **Политика и блокировка задач:** monthly/extra статус, `maxConcurrentTasks`,
  лимиты стоимости, токенов, reasoning/output, длительности и per-agent;
  при нарушении активной задачи вызывается `abort`.
- **Тесты:** 11 тестов в одном файле, все проходят.
- **Сборка и ESM exports:** `exports` указывают на `dist/index.js` и
  `dist/index.d.ts`; публичный API экспортирует 10 значений (см. ниже).

## Фактические результаты (повторный запуск 2026-11-02)

Все команды запущены из `packages/budget-manager`, с инструментами из
`apps/office/node_modules/.bin`. Зависимости не устанавливались, lockfile не
менялся.

| Проверка | Команда | Результат |
| --- | --- | --- |
| Тесты | `vitest run --cache=false` | PASS, 1 файл, 11/11 тестов, exit 0 |
| Typecheck | `tsc --noEmit -p tsconfig.json` | PASS, exit 0 |
| Build | `tsc -p tsconfig.build.json` | PASS, exit 0 |
| ESM из каталога пакета | `import("@open-agent-office/budget-manager")` | PASS (self-reference через `exports`) |
| ESM через dist | `import("./dist/index.js")` | PASS, 10 экспортов |
| ESM из корня репозитория | `import("@open-agent-office/budget-manager")` | FAIL, `ERR_MODULE_NOT_FOUND` (ожидаемо: пакет не связан в корневом `node_modules`, `pnpm install` не выполнялся) |
| `git diff --check` (tracked) | `git diff --check` | PASS, exit 0 |
| Пробелы в новых файлах | ручная проверка | Срабатывания только в двух отчётах: двойной пробел в конце строк «Дата:» — это жёсткий перенос Markdown, не дефект |

Значения ESM-снимка по умолчанию: `status: normal`, `allowanceStatus: unknown`,
`subscriptionCostRub: 1000`, `extraBudgetRub: 0`, `extraSpendRub: 0`,
`actualSpendRub: 1000`, `reportedUsageUsd: 0`.

## Фактический `dist/` (12 файлов)

```text
budget-manager.js        budget-manager.d.ts
budget-policy.js         budget-policy.d.ts
index.js                 index.d.ts
jsonl-store.js           jsonl-store.d.ts
types.js                 types.d.ts
usage-ledger.js          usage-ledger.d.ts
```

Один `.js` и один `.d.ts` на каждый из шести модулей `src/`.

Публичный API (`index.js`): `BudgetExceededError`, `BudgetManager`,
`BudgetPolicyError`, `BudgetStoreError`, `DEFAULT_BUDGET_POLICY`,
`JsonlUsageStore`, `UsageLedger`, `mergeBudgetPolicy`, `usageEventId`,
`validateBudgetPolicy`. Типы экспортируются через `index.d.ts`.

## Ограничения (не исправлено, требует решения)

1. **Блокировка квотных задач при любом внесённом RUB-платеже.** При
   `extraBudgetRub = 0` любой зарегистрированный `recordCashPayment` переводит
   статус в `blocked`, и `checkTaskStart` запрещает все задачи, включая задачи
   внутри квоты Go. Это консервативная трактовка «бюджет исчерпан», но она
   расходится с буквальным требованием «запросы внутри квоты разрешены». Нужно
   решение пользователя: оставить блокировку или разрешать квотные задачи при
   `blocked`, запрещая только дополнительные расходы.
2. **Платежи не сохраняются.** `recordCashPayment` хранит данные в памяти
   экземпляра; после перезапуска они теряются. Также `extraSpendRub` не
   ограничен месяцем.
3. **Длительность задачи по `Date.now()`.** `enforceTaskLimits` использует
   системные часы, а не инъецируемый `now`. Это известное расхождение из
   `OAO-BUDGET-001.md`.
4. **Нет автоматической проверки аккаунта.** `extraUsageEnabled = false` —
   локальная политика приложения, а не подтверждённая настройка аккаунта
   OpenCode. Остаток квоты Go неизвестен (`unknown`).
5. **Нет таймера длительности.** Проверка идёт на следующем usage event.
6. **Зависимости берутся из `apps/office/node_modules`.** У пакета нет
   собственных `devDependencies`; `tsconfig.json` содержит относительные
   `typeRoots` и `paths`. Работает только с текущим окружением.
7. **Модуль не подключён** к Runtime, orchestrator, server или office.

Реальные LLM, сотрудники и платные интеграционные запросы не запускались.
Коммит не создавался.
