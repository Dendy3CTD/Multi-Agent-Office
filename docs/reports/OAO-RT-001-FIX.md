# OAO-RT-001-FIX — Аудит и исправление OpenCode Runtime

Дата: 2026-11-01

## Итог

Исправлен lifecycle отмены и тайм-аута в `packages/runtime-opencode`.
AbortSignal и timeout теперь не отклоняют Promise немедленно: Runtime сначала
сохраняет typed failure, отправляет SIGTERM, ждёт событие `close`, а при
превышении grace period отправляет SIGKILL. Promise отклоняется только после
фактического `close` дочернего процесса.

Реальные OpenCode/LLM-запросы не выполнялись.

## Изменённые файлы

- `packages/runtime-opencode/src/index.ts`
- `packages/runtime-opencode/test/runtime.test.ts`
- `docs/reports/OAO-RT-001-FIX.md`

Существующие тесты не удалялись. Другие каталоги проекта не изменялись.

## Исправленный lifecycle

При AbortSignal или timeout выполняется последовательность:

```text
AbortSignal/timeout
        ↓
сохранить RuntimeAbortError/RuntimeTimeoutError
        ↓
SIGTERM
        ↓
ждать close
        ├─ close за grace period → reject сохранённой typed error
        └─ нет close → SIGKILL → ждать close → reject typed error
```

Для protocol error используется тот же безопасный путь завершения процесса.
При `close` таймер SIGKILL очищается, abort-listener снимается, а Promise
защищён от повторного завершения. Если процесс уже прислал `close` синхронно
во время `kill(SIGTERM)`, дополнительный kill-timer не устанавливается.

Ненулевой exit code и отсутствие финального `reason=stop` по-прежнему дают
`RuntimeExitError` и `RuntimeIncompleteError` соответственно, но pending
ошибка отмены/тайм-аута имеет приоритет после закрытия процесса.

## Тесты

Сохранены исходные 6 тестов и добавлен отдельный регрессионный тест:

```text
corepack pnpm --filter @open-agent-office/runtime-opencode test
```

Результат фактического запуска:

```text
Test Files  1 passed (1)
Tests       7 passed (7)
```

Новый тест проверяет:

- Promise остаётся незавершённым после `AbortSignal` до `close`;
- первым отправляется SIGTERM;
- при отсутствии `close` за grace period отправляется SIGKILL;
- после ручного `close` Promise отклоняется именно `RuntimeAbortError`.

Существующий тест дополнительно проверяет timeout и SIGTERM.

## Typecheck

```text
corepack pnpm --filter @open-agent-office/runtime-opencode typecheck
```

Фактический результат: `tsc --noEmit` завершился с кодом 0.

## Git и ограничения

```text
git diff --check
```

Проверка завершилась успешно. Изменения ограничены `packages/runtime-opencode`
и этим отчётом в `docs/reports`. Не изменялись `apps/office`, `references/`,
`opencode.json`, настройки Kilo и lockfile. Зависимости не устанавливались,
`pnpm install` не выполнялся, `--auto` не использовался, коммит не создавался.

## Остаток до интеграционного запуска

После отдельного разрешения на платный smoke test можно использовать
`OpenCodeRuntime` с моделью `opencode-go/gpt-6-luna`, абсолютным безопасным
worktree и ограниченным `timeoutMs`. До этого этапа Runtime проверен только
фиктивным CLI-процессом; четыре модели параллельно не запускались.
