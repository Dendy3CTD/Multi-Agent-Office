# OAO-RT-001 — Реализация OpenCode Runtime

Дата: 2026-11-01

## 1. Итог реализации

Создан независимый пакет `@open-agent-office/runtime-opencode`. Runtime запускает
OpenCode CLI 1.19.5 через `child_process.spawn` в неинтерактивном режиме,
принимает JSON Lines из stdout, собирает результат и диагностические события,
поддерживает продолжение сессии, AbortSignal и тайм-аут.

Реальные модели и платные запросы не запускались.

## 2. Созданные файлы

- `packages/runtime-opencode/package.json`
- `packages/runtime-opencode/tsconfig.json`
- `packages/runtime-opencode/src/index.ts`
- `packages/runtime-opencode/test/runtime.test.ts`
- `packages/runtime-opencode/README.md`
- `docs/reports/OAO-RT-001.md`

Изменений в `apps/office`, `references/`, `opencode.json`, Kilo-настройках и
других существующих пользовательских файлах для этой задачи не вносилось.

## 3. Архитектура пакета

`OpenCodeRuntime.runTask()` валидирует абсолютный `cwd`, формирует отдельный
массив аргументов и запускает:

```text
opencode run --dir CWD --model PROVIDER/MODEL --format json --title TITLE [--session SESSION_ID] PROMPT
```

Используются `shell: false`, `stdio: ["ignore", "pipe", "pipe"]`, отдельные
обработчики stdout/stderr и лимит буферов 8 MiB по умолчанию. Spawn-функция
внедряется через конструктор, что позволяет тестировать процесс без OpenCode.

## 4. Публичный API

Экспортированы `OpenCodeRuntime`, `RuntimeTaskOptions`, `RuntimeResult`,
`RuntimeEvent`, `RuntimeUsage` и ошибки:

- `OpenCodeLaunchError`
- `RuntimeTimeoutError`
- `RuntimeAbortError`
- `RuntimeProtocolError`
- `RuntimeExitError`
- `RuntimeIncompleteError`

`RuntimeResult` содержит `sessionId`, склеенный `text`, все `events`,
`exitCode`, финальную причину (`stop`) и usage: input/output/reasoning,
cache read/write, total и cost.

## 5. JSON-события

Парсер принимает произвольные stdout-фрагменты, включая JSON между чанками и
несколько JSON-событий в одном чанке. Поддержаны `step_start`, `text`,
`step_finish`, `error`, события инструментов и неизвестные типы без жёсткой
зависимости от единственной формы поля.

Текст берётся из `text`, `part.text` и совместимой вложенной формы. Session ID
извлекается из `sessionID`, `sessionId`, `session_id` и session object. Usage
суммируется по нескольким `step_finish`, включая вложенные `part.tokens`,
`tokens.cache.read/write` и стоимость из event/part/tokens.

`reason: tool-calls` сохраняется как промежуточный этап. Успешное выполнение
подтверждается только при `reason: stop`; ненулевой exit code и отсутствие
финального stop приводят к ошибке.

## 6. Ошибки, отмена и завершение процесса

Ошибки запуска и процесса разделены от protocol/exit/incomplete ошибок.
stderr сохраняется в диагностике с тем же лимитом и без записи окружения,
токенов или секретов. При AbortSignal, тайм-ауте или protocol error Runtime
отклоняет Promise ровно один раз, отправляет SIGTERM и после ограниченного
ожидания использует SIGKILL. Обработчики снимаются при завершении; двойное
завершение Promise защищено.

Автоматическое подтверждение разрешений не включается: `--auto` в аргументы не
добавляется.

## 7. Результаты тестирования

Команда:

```text
corepack pnpm --filter @open-agent-office/runtime-opencode test
```

Результат: 1 test file, 6 tests passed. Внутри сценариев проверены все 22
обязательных направления:

1. запуск и аргументы;
2. `shell: false`;
3. абсолютный `cwd`;
4. session ID;
5. сбор текста;
6. JSON, разделённый между чанками;
7. несколько событий в одном чанке;
8. токены;
9. суммирование cost;
10. промежуточный tool-calls step;
11. финальный stop step;
12. ошибка модели;
13. ненулевой exit code;
14. отсутствие финального события;
15. AbortSignal;
16. timeout;
17. ошибка запуска;
18. большой stderr;
19. отсутствие `--auto`;
20. отсутствие утечки секрета в результате;
21. неизвестные события;
22. фиктивный CLI без LLM.

## 8. Typecheck

Команда:

```text
corepack pnpm --filter @open-agent-office/runtime-opencode typecheck
```

Результат: успешно, `tsc --noEmit` завершился с кодом 0.

## 9. Git-проверки

Команда `git diff --check` завершилась успешно. Полный `git status` проверен до
работы и повторно после неё. Существующие изменения сохранены; новые файлы
runtime ограничены каталогом `packages/runtime-opencode`, а этот отчёт добавлен
в `docs/reports`.

Lockfile не обновлялся: установка зависимостей и `pnpm install` были запрещены
условиями задачи. В workspace пакет обнаруживается; команды package-level
проверок работают. При следующем плановом изменении зависимостей можно
синхронизировать lockfile штатным процессом проекта.

## 10. Ограничения и известные проблемы

- Интеграционный запуск настоящего OpenCode и проверка конкретного ответа
  `gpt-6-luna` ещё не выполнялись по требованию не делать платные запросы.
- Пакет пока не подключён к orchestrator/server/UI — это намеренно оставлено
  для следующего этапа.
- Фактическая форма новых JSON-событий OpenCode может расшириться; неизвестные
  события сохраняются, а извлечение известных полей сделано защитным.
- Синхронизация lockfile отложена, поскольку для неё потребовался бы запрещённый
  install/update workflow.

## 11. Следующий этап: реальный GPT-6 Luna

После явного разрешения на платный интеграционный smoke test:

```text
corepack pnpm --filter @open-agent-office/runtime-opencode typecheck
corepack pnpm --filter @open-agent-office/runtime-opencode test
```

Затем вызывающий код должен создать Runtime и передать только абсолютный
рабочий каталог, безопасный prompt и конфигурируемую модель:

```ts
const result = await new OpenCodeRuntime().runTask({
  model: "opencode-go/gpt-6-luna",
  prompt: "Ответь кратко: runtime smoke test успешно запущен.",
  cwd: "/absolute/path/to/safe/worktree",
  title: "OAO runtime smoke test",
  timeoutMs: 120_000,
});
```

Проверить `result.sessionId`, `result.reason === "stop"`, текст, usage и
отсутствие секретов в архивируемых событиях. Не запускать параллельно четыре
модели и не добавлять `--auto`.
