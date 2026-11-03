# OAO-RT-001-FIX2 — Завершение аудита OpenCode Runtime

Дата: 2026-11-01

## Итог

Аудит `packages/runtime-opencode` завершён без реальных запросов к OpenCode или
LLM. Исправлены JSONL edge cases, строгая финализация, типизация ошибок модели
и callback, bounded diagnostics, redaction секретов и production ESM build.
Предыдущий lifecycle AbortSignal/timeout сохранён и дополнительно проверен.

## Найденные проблемы

- Последняя JSONL-запись без LF ошибочно считалась incomplete.
- Обработка последнего stdout-фрагмента могла использовать decoder после
  `StringDecoder.end()`.
- Любое событие с `reason=stop` могло влиять на финальный статус; `tool-calls`
  не был ограничен типом `step_finish`.
- Событие OpenCode `error` классифицировалось как protocol error.
- Исключение `onEvent` могло выйти из stream handler.
- stderr добавлял marker повторно и мог превышать лимит.
- Не было валидации `maxBufferBytes` и `terminateGraceMs`.
- Package entrypoint указывал на TypeScript source и не имел production build.
- Диагностические строки и события не имели общего redaction распространённых
  форматов секретов.

## Исправления

### JSONL и финализация

- Последний непустой фрагмент без LF теперь парсится как полноценная JSON-строка.
- Повреждённый последний фрагмент даёт `RuntimeProtocolError`.
- `StringDecoder.write()` вызывается только до `end()`, а хвост обрабатывается
  отдельно через `StringDecoder.end()`.
- UTF-8, разорванный между stdout chunks, собирается через `StringDecoder`.
- Несколько событий в одном chunk сохраняются.
- Успех возможен только при `type=step_finish` и `reason=stop`.
- `reason=tool-calls` остаётся промежуточным; reason других типов событий не
  меняет финальный статус.

### Ошибки

Добавлены:

- `RuntimeModelError` — событие `type=error` от OpenCode;
- `RuntimeEventCallbackError` — исключение пользовательского `onEvent`.

Повреждённый JSON, model error, ненулевой exit code и incomplete execution
остаются разными классами ошибок. Ошибка callback перехватывается внутри
обработчика stream, процесс безопасно завершается и typed error возвращается
после `close`.

### Память и lifecycle

- stdout выше `maxBufferBytes` останавливает обработку и запускает protocol
  termination.
- stderr ограничивается тем же byte budget.
- `[stderr truncated]` добавляется не более одного раза и входит в общий лимит.
- Очень длинные строки обрабатываются в пределах stdout budget.
- `maxBufferBytes` должен быть положительным safe integer.
- `terminateGraceMs` должен быть неотрицательным safe integer.
- Abort/timeout/protocol failure сначала сохраняют pending error, отправляют
  SIGTERM, затем при отсутствии `close` отправляют SIGKILL.
- Promise завершается ровно один раз и только после `close` для terminating
  failures; timers и AbortSignal listener очищаются.

### Redaction

Перед сохранением событий и в `RuntimeError` обрабатываются распространённые
форматы:

- `Authorization: Bearer ...`;
- `api_key=...`, `apiKey: ...`;
- `access_token=...`;
- JSON/object keys `token`, `password`, `secret`, а также authorization/API key
  variants.

Redaction применён к `RuntimeError.message`, `RuntimeError.stderr`,
`RuntimeError.events` и `RuntimeResult.events`. Это не гарантирует обнаружение
всех возможных форматов секретов.

## Сборка пакета

Package теперь использует:

- `main: ./dist/index.js`;
- `types: ./dist/index.d.ts`;
- `exports` с ESM import и types;
- `files: ["dist", "README.md"]`;
- `build` script;
- `tsconfig.build.json` с `outDir=dist`, declaration output и `rootDir=src`.

`dist` исключён из тестового TypeScript context. Фактическая сборка выполнена
существующим TypeScript binary без установки зависимостей.

## Файлы

Изменены или созданы в рамках FIX2:

- `packages/runtime-opencode/src/index.ts`
- `packages/runtime-opencode/test/runtime.test.ts`
- `packages/runtime-opencode/package.json`
- `packages/runtime-opencode/tsconfig.json`
- `packages/runtime-opencode/tsconfig.build.json`
- `packages/runtime-opencode/README.md`
- `packages/runtime-opencode/dist/index.js`
- `packages/runtime-opencode/dist/index.d.ts`
- `docs/reports/OAO-RT-001-FIX2.md`

Другие пользовательские изменения сохранены. `apps/office`, `references/`,
`opencode.json`, Kilo settings и lockfile не изменялись.

## Фактические проверки

Typecheck:

```text
../../apps/office/node_modules/.bin/tsc --noEmit -p tsconfig.json
PASS, exit code 0
```

Тесты:

```text
../../apps/office/node_modules/.bin/vitest run
PASS: 1 test file, 14 tests passed
```

Проверено 14 тестами и 30+ assertions/scenarios, включая JSONL без LF,
damaged final line, split UTF-8, multiple events, strict final event,
RuntimeModelError, callback failure, stdout/stderr overflow, bounded marker,
option validation, redaction, Abort/timeout, SIGTERM/SIGKILL, protocol
termination, no `--auto` и отсутствие LLM calls.

Build:

```text
../../apps/office/node_modules/.bin/tsc -p tsconfig.build.json
PASS, dist/index.js и dist/index.d.ts созданы
```

Node ESM import:

```text
node --input-type=module -e 'const mod = await import("@open-agent-office/runtime-opencode"); ...'
PASS: esm-import-ok; OpenCodeRuntime, RuntimeModelError и RuntimeEventCallbackError экспортированы
```

Git:

```text
git diff --check
PASS
```

Зависимости не устанавливались, `pnpm install` не выполнялся, реальные модели
не запускались, `--auto` не использовался, коммиты не создавались.

## Ограничения и оставшиеся проблемы

- Runtime не проверялся на фактическом платном OpenCode smoke test; это остаётся
  следующим этапом только после отдельного разрешения.
- Redaction основан на известных форматах и не является универсальным secret
  detector.
- Workspace lockfile по-прежнему не синхронизирован с ранее созданным package
  manifest, поскольку `pnpm install` запрещён условиями задачи. Package-level
  build/test/typecheck и обычный Node import фактически выполнены.
- Runtime всё ещё не подключён к orchestrator/server/UI.
