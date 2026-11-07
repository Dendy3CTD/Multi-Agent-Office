# MAO — DATA MODEL

Основные сущности, их поля, связи и физическое размещение. Типы верхнего
уровня будут объявлены в `packages/shared` (пока пустой) и служить единым
источником контрактов для C01–C16.

## 1. Соглашения

- Идентификаторы: строки `^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$` (согласовано с
  существующей валидацией `taskId` координатора).
- Время: ISO-строки UTC; месячные периоды бюджета — в `accountingTimeZone`
  политики C08.
- Денежные суммы: копейки/центы не используются; RUB — число (как в C08),
  USD — число reported cost из Runtime.
- Версии: semver-строки для профессий и Skills.
- Все сущности имеют `createdAt`/`updatedAt`; удаление — мягкое
  (`status: "archived"`), кроме append-only журналов.

## 2. Сущности

### 2.1. Каталоги (источник истины — файлы; SQLite — индекс)

**Profession** (C02, файлы `professions/<id>.md`)

| Поле | Тип | Назначение |
| --- | --- | --- |
| id | string | уникальный, напр. `developer`, `cad-engineer` |
| version | semver | версия профиля |
| name | string | отображаемое имя (ru) |
| role | string | краткая роль для контекста |
| responsibilities | string[] | зоны ответственности |
| departmentId | string | → Department (10–12 отделов, этап 1.3) |
| baseInstructions | string | системные инструкции (русские, по образцу `agentLanguage.ts`) |
| skillTags | string[] | теги для резолва Skills (C04) |
| capabilityRequirements | string[] | требуемые возможности модели (code, reasoning, vision, long-context) |
| modelHints | { tier: string; preferred?: string[] } | минимальный ярус и предпочтения для C07 |
| acceptancePolicy | { mode: "auto"\|"reviewer"\|"director"; checks: string[] } | политика приёмки |
| extends | string? | наследование профиля |
| status | "active"\|"disabled" | динамическое отключение |

**Employee** (C01, SQLite `employees`; начальные пять — из
`DEFAULT_AGENT_MODELS`)

| Поле | Тип | Назначение |
| --- | --- | --- |
| id | string | `director`, `developer`, … (совместимо с agentId C08) |
| professionId | string | → Profession |
| displayName | string | имя в UI |
| modelDefault | string | модель по умолчанию (нижняя граница для C07; НЕ постоянная привязка — ADR-MAO-011) |
| skillOverrides | string[] | индивидуальные Skills |
| visualCharacter | string? | спрайт в `apps/office` |
| status | "active"\|"disabled" |

**Department** (C01/C02; 10–12 отделов — справочник; этап 1.3)

| Поле | Тип | Назначение |
| --- | --- | --- |
| id | string | напр. `management`, `development` |
| name | string | название (ru) |
| description | string? | зона ответственности |
| status | "active"\|"disabled" |

Отдел — группировка профессий; не процесс, не бюджет, не слот.

**SkillDescriptor** (C03, файлы `skills/**/SKILL.md`)

| Поле | Тип | Назначение |
| --- | --- | --- |
| id | string | уникальный, напр. `web-research`, `cad-kompas-export` |
| version | semver | версия |
| description | string | краткое описание (используется при резолве) |
| category | string | категория (research, coding, docs, cad, media, …) |
| tags | string[] | теги для сопоставления подзадаче |
| requiredTools | string[] | инструменты исполнения (bash, browser, blender, …) |
| compatibleProfessions | string[] | professionId; пустое = общий Skill |
| dependencies | string[] | skillId, разрешаются C04 |
| estimatedTokens | number | оценка тела для бюджета контекста |
| status | "active"\|"disabled" |

**ModelDescriptor** (C07, файл `models.config.json`)

| Поле | Тип | Назначение |
| --- | --- | --- |
| id | string | `provider/model`, напр. `opencode-go/glm-5.3-flash` |
| provider | string | `opencode-go`, `chatgpt-plus` (подписка), будущие |
| runtimeIds | string[] | допустимые Runtime (`opencode`, `codex`); заполняется по capabilities C17 |
| tier | "free"\|"cheap"\|"standard"\|"strong" | ярус стоимости |
| capabilities | string[] | code, reasoning, vision, long-context |
| relativeCost | number | относительная цена (для сортировки) |
| maxContextTokens | number? | лимит контекста |
| enabled | boolean | доступность |
| paidExternal | boolean | true ⇒ запрещено без разрешения пользователя |
| expenseCategory | "money"\|"subscription"\|"free" | категория расхода (ADR-MAO-012); default = по признакам provider |

### 2.2. Задачи (SQLite `tasks`, `subtasks`)

**Task**

| Поле | Тип | Назначение |
| --- | --- | --- |
| id | string | taskId |
| projectId | string | → Project |
| title, brief | string | формулировка пользователя |
| complexity | "simple"\|"standard"\|"complex" | решение C05 |
| status | enum (см. TASK_LIFECYCLE.md) | состояние |
| acceptanceCriteria | string[] | критерии приёмки верхнего уровня |
| createdBy | "user"\|"system" | источник |
| resultSummary | string? | итог после приёмки |

**Subtask**

| Поле | Тип | Назначение |
| --- | --- | --- |
| id | string | subtaskId |
| taskId | string | → Task |
| professionId, employeeId | string | назначение |
| skillBundle | string[] | `skillId@version` (итог C04) |
| modelId | string? | фактический выбор C07 (записывается при запуске) |
| dependsOn | string[] | subtaskId (DAG) |
| acceptanceChecks | string[] | критерии C12 |
| status | enum | queued/running/validating/retrying/done/failed/cancelled |
| attempts | number | число попыток |
| sessionId | string? | → Session |
| resultRef | string? | → Artifact (итог) |

### 2.3. Исполнение (SQLite `sessions`, `executions`, `validation_reports`)

**Session**: id, employeeId, projectId, runtimeId (`opencode`/`codex`),
externalSessionId (адаптерно: opencodeSessionId или id сессии Codex), status
(open/closed/recovered), openedAt, closedAt.

**Execution**: id, subtaskId, attempt, modelId, runtimeId, startedAt,
finishedAt, runtimeReason (`stop`/`tool-calls` из C15; у C18 — собственные
значения), errorClass?, usageId→UsageRecord.

**UsageRecord** — зеркало журнала C08 в SQLite-индексе для агрегатов
(источник истины остаётся JSONL C08): eventId, agentId(=employeeId), modelId,
taskId, projectId, sessionId, input/output/reasoning/cacheRead/cacheWrite/
total/costUsd, timestamp. Схема уже зафиксирована в
`packages/budget-manager/src/types.ts` (`UsageEventInput`).

**ValidationReport**: id, subtaskId, attempt, checksRun[], verdict
(pass/fail/partial), reasons[], recommendation (accept/retry/escalate/
replan), createdAt.

### 2.4. Артефакты и проекты (SQLite `projects`, `artifacts`; файлы — ФС)

**Project** (C19 Portfolio, этап 1.3): id, name, rootDir (абсолютный путь),
gitRemote?, memoryFile (путь к Project Memory),
status (`active`/`paused`/`archived`), а также портфельные поля:
priority, budgetShare (доля месячного бюджета ≤ 2 000 ₽),
maxConcurrentExecutions (лимит исполнений проекта).

**Artifact**: id, subtaskId, kind (file/diff/report/image/dataset), path
(относительно `projects/<id>/`), sha256, sizeBytes, producerEmployeeId,
createdAt. Бинарное содержимое — только ФС.

### 2.5. События и архив (SQLite `events`, `outbox`)

**Event**: id (ulid/монотонный), ts, type (`task_created`, `subtask_started`,
`usage_recorded`, `validation_completed`, `artifact_registered`,
`plan_revised`, …), taskId?, subtaskId?, employeeId?, projectId?, payload
(JSON, без секретов — redaction на границе), exportedAt?

**Outbox**: eventId → status (pending/exported/failed), attempts,
lastError. Экспортёр C14 переводит в `exported` только после атомарной
записи Markdown.

**ModelStats** (агрегат для C05/C07, материализуется из Event+Usage+
Validation): modelId, professionId, taskType, attempts, successes,
avgCostUsd, avgDurationMs, updatedAt.

### 2.6. Runtime и финансовые категории (этап 1.3)

**RuntimeDescriptor** (C17; in-memory реестр, создан из конфигурации C16):

- id (`opencode`, `codex`), displayName, package (`runtime-opencode` /
  `runtime-codex`);
- capabilities: supportedProviders[], supportedModels[], session,
  sessionResume?, cancel?, streamEvents?, usage?, maxAdapterConcurrency?;
  каждое необязательное поведение — только по capability (ADR-MAO-010);
- status: available/unavailable.

**BudgetGuardView** (C08, снимок по категориям ADR-MAO-012):

| Категория | Что это | Где измеряется |
| --- | --- | --- |
| money | реальные RUB-расходы (платежи + reported cost) | JSONL ledger C08 |
| subscription | ChatGPT Plus: число запросов (requestCount) и приблизительный расход контекста (approxContextTokens — оценка C09/C07); НЕ API-баланс, точные токенные квоты не постулируются | политика C08 |
| free | наблюдаемый usage бесплатных моделей; факт квот провайдера не постулируется | зеркало C08/C14 |
| counts | число запросов и активных параллельных задач (слоты) | политика C08 |
| contextEstimate | приблизительный расход контекста отдельного исполнения | C09/C07 → C08 |

Подписочный ежемесячный платёж (ChatGPT Plus) — одна money-запись платежа
C08; подписочное использование — не деньги. Двойной учёт исключён:
ledger остаётся единственным финансовым журналом, категории — проекция.

## 3. Связи

```
Profession 1───n Employee; Department 1───n Profession
Employee   1───n Subtask 1───n Execution
Task       1───n Subtask (DAG через dependsOn)
Subtask    1───n ValidationReport
Subtask    1───n Artifact
Project    1───n Task; Project 1───n Session
Session    1───n Execution
Model      1───n Execution; Runtime 1───n Execution; (Model, Profession) 1───1 ModelStats
Skill      n───n Subtask (через skillBundle)
Event      n───1 Outbox
```

## 4. Физическое размещение

| Данные | Источник истины | Индекс/кэш | Примечание |
| --- | --- | --- | --- |
| Профессии | `professions/*.md` | SQLite | динамическая регистрация обновляет оба |
| Skills | `skills/**/SKILL.md` | SQLite | тела грузятся только при резолве |
| Модели | `models.config.json` | SQLite | статистика — в SQLite |
| Сотрудники | SQLite | — | инициализация из `DEFAULT_AGENT_MODELS` |
| Задачи/сессии/события | SQLite `office.db` | — | переживает перезапуск |
| Usage/платежи | JSONL C08 | SQLite-зеркало | ledger не переписывается (ADR-MAO-003) |
| Артефакты/код | ФС `projects/<id>/` + Git | SQLite-манифесты | — |
| Архив | Obsidian vault (Markdown) | SQLite-индекс поиска | экспорт идемпотентен |
| Project Memory | `<project>/PROJECT_MEMORY.md` | — | краткий контекст проекта для C09 |

## 5. Целостность и миграции

- SQLite: WAL-режим, миграции версионируются (таблица `schema_migrations`),
  внешние ключи включены.
- Конфликт файлового определения и индекса: файл выигрывает, индекс
  перестраивается; событие `registry_reindexed`.
- Зеркалирование usage из JSONL в SQLite — идемпотентный импорт по
  `eventId` (повтор не дублирует, как и `recordUsage` C08).
- Восстановление после сбоя: subtasks в `running`/`validating` при старте
  переводятся в `recovery`, оркестратор решает retry/replan по отчёту
  восстановления.
