# OpenCode Runtime

Изолированный адаптер Open Agent Office для OpenCode CLI 1.19.5. Пакет запускает
неинтерактивный `opencode run` с JSONL-выводом и не включает автоматическое
подтверждение разрешений.

```ts
const result = await new OpenCodeRuntime().runTask({
  model: "provider/model",
  prompt: "...",
  cwd: "/absolute/worktree",
  title: "Office task",
  sessionId: "optional-existing-session",
});
```

Модели, рабочие каталоги и тайм-ауты задаются вызывающим кодом. Для тестов
`spawn` внедряется через конструктор, поэтому тестовый набор не обращается к
OpenCode или к платным моделям.

Собранный пакет импортируется из `dist` обычным Node.js ESM import. Исключение
из `onEvent` не выбрасывается из stream handler: Runtime безопасно завершает
процесс, ждёт `close` и отклоняет задачу типизированной
`RuntimeEventCallbackError`. Диагностика и события проходят ограничение размера
и редактирование распространённых секретов; это не гарантирует обнаружение всех
возможных форматов секретов.

## Usage-дельты

`onUsage(usage, event)` вызывается для каждого события, из которого извлечены
токены и стоимость. Пустые события и события без метрик callback не получают.
`usage` — дельта одного события. Сумма всех дельт совпадает с `result.usage`.
Callback вызывается до `onEvent`, поэтому исключение в `onEvent` не теряет
уже извлечённый usage. Событие, которое получает `onUsage`, уже очищено от
распространённых секретов.

Исключение в `onUsage` обрабатывается так же, как в `onEvent`: процесс получает
SIGTERM (при необходимости SIGKILL), Runtime ждёт `close` и отклоняет задачу
`RuntimeUsageCallbackError`.
