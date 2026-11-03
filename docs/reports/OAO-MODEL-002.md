# OAO-MODEL-002 — Переход на экономичные модели и добавление пятого сотрудника Helper

Дата: 2026-11-02
Статус: **PASS** (все обязательные проверки выполнены фактически, см. раздел 6)

Обновлены назначения моделей четырёх основных сотрудников и добавлен пятый
вспомогательный сотрудник Helper на Beam Free. Изменена только таблица
маршрутизации, тесты и документация: механизмы Budget Manager, Runtime,
финансовая политика, сервер, UI и Electron не менялись.

Не выполнялось: реальный OpenCode CLI, реальные LLM и платные запросы, запуск
сотрудников, автоматический запуск Helper, имитация делегирования между
агентами, fallback-модели, Agent Terminal, изменения анимаций и персонажей,
изменения `packages/budget-manager`, `packages/runtime-opencode`, сервера и
`apps/office`, изменения privacy/region, `--auto`, установка зависимостей,
обновление lockfile, commit, git reset/restore/clean.

## 1. Итоговые назначения моделей

`packages/orchestrator/src/agents.ts`, `DEFAULT_AGENT_MODELS` (формат exports
и механизм проверки `provider/model` сохранены, таблица осталась замороженной
через `Object.freeze`):

| agentId | modelId | Примечание |
| --- | --- | --- |
| director | opencode-go/mimo-v2.6-flash | экономичная модель вместо opencode-go/gpt-6-luna |
| developer | opencode-go/glm-5.3-flash | вместо opencode-go/claude-haiku-5-5 |
| engineer | opencode-go/qwen3.8-flash | вместо opencode-go/minimax-m3.1-flash |
| analyst | opencode-go/mimo-v2.6-flash | без изменений |
| helper | opencode-go/beam-free | новый пятый сотрудник |

`modelFor("helper")` возвращает `opencode-go/beam-free`; маршрутизация всех
пяти сотрудников проверена тестами и ESM-импортом собранного `dist`
(раздел 6). Идентификатор `opencode-go/beam-free` проходит существующую
проверку `MODEL_ID_PATTERN`; отдельные механизмы проверки моделей не менялись.

## 2. Роль Helper

Идентификатор: `helper`. Название: Helper / Помощник. Модель:
`opencode-go/beam-free`.

- Универсальная помощь всем четырём основным сотрудникам.
- Краткие исследования и сбор справочной информации.
- Подготовка сводок, чек-листов и документации.
- Объяснение ошибок и небольших фрагментов кода.
- Форматирование и структурирование данных.
- Предварительная проверка небольших результатов.
- Подготовка вспомогательных материалов для других сотрудников.

Helper не заменяет разработчика, инженера, аналитика или директора. Он
вспомогательный сотрудник и не обязан участвовать в каждом проекте: его
используют по необходимости для небольших вспомогательных поручений.

Helper не запускается автоматически при каждой задаче: как и остальные
сотрудники, он работает только через явный `runTask`. В Orchestrator нет
механизма автоматического запуска, искусственная активность и имитация
делегирования между агентами не создавались. Полноценная автоматическая
передача подзадач будет реализована отдельно в последующих версиях
Orchestrator.

Визуальное добавление пятого персонажа в игровой интерфейс не выполнялось
и остаётся задачей Stage 9: офисная сцена и `?sim` показывают четыре
персонажа.

## 3. Изменения в Orchestrator

- `src/agents.ts`: новая таблица `DEFAULT_AGENT_MODELS` из пяти сотрудников
  (раздел 1); комментарий документирует вспомогательный статус Helper и
  отсутствие автоматического запуска.
- `src/agent-execution-coordinator.ts`: обновлён только комментарий опции
  `agents` (defaults — пять назначений). Логика координатора не менялась:
  `modelId` в запросе по-прежнему отклоняется (`InvalidTaskRequestError`),
  `taskId`, `sessionId` и usage каждого сотрудника независимы.
- Budget Manager и фиксированная финансовая политика (`FIXED_BUDGET_POLICY`)
  не менялись.

### Тесты (`test/coordinator.test.ts`, `test/factory.test.ts`)

Обновлён тест, ожидавший ровно четырёх сотрудников: теперь «selects the
configured model for each of the five employees» проверяет маршрутизацию всех
пяти agentId через fake Runtime (`--model` в аргументах spawn) и
`coordinator.modelFor`. Ссылка на старую модель developer
(`opencode-go/claude-haiku-5-5`) заменена на `opencode-go/glm-5.3-flash`.

Новые тесты (3):

1. «launches helper on Beam Free through the fake Runtime and records its
   usage» — запуск helper через fake Runtime: `--model opencode-go/beam-free`,
   сохранение сессии в результате и usage-записи с `agentId: helper`,
   `modelId: opencode-go/beam-free`, корректными `taskId`/`sessionId`.
2. «keeps taskId, sessionId and usage of helper independent from other
   employees» — последовательные задачи helper и developer: независимые
   `taskId`, продолженные `--session`, отдельные usage-записи с
   детерминированными `eventId` и разными `agentId`/`modelId`/`sessionId`;
   ровно два spawn без лишних запусков.
3. «defaults to the economical five-employee table with helper on Beam Free»
   (factory.test.ts) — состав таблицы по умолчанию (5 записей), заморозка и
   прохождение `normalizeAgentModels`.

Передача произвольного `modelId` в запросе по-прежнему отклоняется до любых
побочных эффектов (существующий тест «rejects invalid requests, including a
per-task model override»).

## 4. Ручная модель OpenCode

Корневой `opencode.json`: `"model"` изменён с `opencode-go/claude-haiku-5-5`
на `opencode-go/glm-5.3-flash` — единственное изменение. Provider Kilo, его
модель `cohere/north-mini-code:free`, `baseURL`, `$schema` и остальные
настройки сохранены. Корректность JSON проверена `JSON.parse` (раздел 6).

## 5. Изменённые и новые файлы

Новые:
- `docs/reports/OAO-MODEL-002.md` (этот отчёт).

Изменённые:
- `packages/orchestrator/src/agents.ts` — таблица пяти моделей;
- `packages/orchestrator/src/agent-execution-coordinator.ts` — комментарий;
- `packages/orchestrator/test/coordinator.test.ts` — пять сотрудников,
  2 новых helper-теста, обновлённая ссылка на модель developer;
- `packages/orchestrator/test/factory.test.ts` — тест таблицы по умолчанию;
- `packages/orchestrator/README.md` — таблица моделей, раздел про Helper;
- `docs/ARCHITECTURE.md` — раздел «Team composition (OAO-MODEL-002)»;
- `docs/ROADMAP.md` — раздел OAO-MODEL-002, обновление Stage 9 (пять
  сотрудников, визуальное добавление Helper);
- `docs/SESSION_HANDOFF.md` — новая верхняя секция о пяти сотрудниках;
- `opencode.json` — модель по умолчанию.

`packages/budget-manager`, `packages/runtime-opencode`, `apps/office`, сервер
и Electron не менялись. `dist/` orchestrator пересобран (игнорируется Git).
Зависимости не устанавливались, `pnpm-lock.yaml` не менялся.

## 6. Проверки и результаты

Команды запускались из `packages/orchestrator` инструментами из
`apps/office/node_modules/.bin`.

| Проверка | Команда | Результат |
| --- | --- | --- |
| Тесты Orchestrator | `vitest run --cache=false`, 2 прогона | PASS, 46/46 каждый раз (43 прежних + 3 новых) |
| Маршрутизация всех пяти сотрудников | тест «selects the configured model for each of the five employees» | PASS: `--model` и `modelFor` для director, developer, engineer, analyst, helper |
| Запуск и независимость Helper | 2 новых теста через fake Runtime | PASS |
| Typecheck orchestrator | `tsc --noEmit -p tsconfig.json` | PASS, exit 0 |
| Build orchestrator | `tsc -p tsconfig.build.json` | PASS, exit 0, dist пересобран |
| ESM import | временные symlinks `@open-agent-office/budget-manager` и `@open-agent-office/runtime-opencode` → `import("./dist/index.js")` | PASS: 15 экспортов, `DEFAULT_AGENT_MODELS` из пяти записей, `modelFor` всех пяти сотрудников; symlinks и `node_modules` удалены после проверки |
| opencode.json | `JSON.parse` + проверка структуры | PASS: валидный JSON, модель `opencode-go/glm-5.3-flash`, provider Kilo и его модель сохранены |
| `git diff --check` | `git diff --check` | PASS, exit 0 (отслеживаемые файлы) |
| Пробелы в конце строк | `grep -rnE "[[:space:]]+$"` по изменённым файлам | PASS, совпадений нет |

## 7. Ограничения и оставшиеся работы

- Визуальное добавление пятого сотрудника (персонаж, рабочее место, сцена)
  не выполнялось — задача Stage 9; офис по-прежнему показывает четыре
  персонажа.
- Автоматическая передача подзадач между агентами не реализована и не
  имитировалась; Helper запускается только явным запросом.
- Автоматические fallback-модели не включены.
- Корневой `README.md` и `AGENTS.md` по-прежнему упоминают Kimi K3 как
  директора по умолчанию (исторические тексты); в эти документы задача
  изменения не вносила, таблица `DEFAULT_AGENT_MODELS` — источник текущих
  назначений.
- ESM-импорт из корня репозитория по пакетному имени по-прежнему требует
  `pnpm install` (lockfile не обновлялся, см. ограничения OAO-RT-003).
- Реальный OpenCode CLI и Beam Free не проверялись: все тесты используют
  fake spawn; реальные сотрудники и платные запросы не запускались.
