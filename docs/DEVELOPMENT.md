# Разработка и локальный запуск

## Требования

- Linux; Debian 13 рекомендуется для host/Supervisor проверки.
- Node.js 22 или новее (`package.json` содержит `engines.node`).
- Corepack и pnpm 12.16.1 (`packageManager` в корневом `package.json`).
- Git; браузер с WebGL для 3D интерфейса.
- Для полной проверки system-level Supervisor дополнительно нужны systemd 257+, cgroup v2 и заранее подготовленные account/group. Эта проверка не нужна для сборки UI.

## Получение кода и зависимости

```bash
git clone https://github.com/Dendy3CTD/Multi-Agent-Office.git
cd Multi-Agent-Office
corepack pnpm install
```

## Сборка и проверки

```bash
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
```

Root scripts в `package.json` выполняют соответствующие workspace-команды. Тесты с fake Runtime подтверждают программные контракты, но не являются real LLM или production E2E.

## Запуск Office UI

Из корня репозитория:

```bash
corepack pnpm --dir apps/office dev --host 127.0.0.1 --port 3333
```

Откройте <http://127.0.0.1:3333/>. Vite dev server не поднимает production backend автоматически. Не публикуйте dev server в локальную сеть, если для этого нет отдельной задачи и настройки.

## Локальный Server

Существующие package scripts:

```bash
corepack pnpm --filter @open-agent-office/server build
corepack pnpm --filter @open-agent-office/server start
```

Server по умолчанию слушает `127.0.0.1:3000`. При первом запуске он создаёт локальный token-файл `~/.config/open-agent-office/token` с закрытыми правами; token не должен попадать в Git, frontend build, URL, Markdown-отчёт или shell history. Поля `MAO_HOST`, `MAO_PORT`, `MAO_TOKEN_FILE`, `MAO_RUNTIME_CONFIG`, `MAO_ARCHIVE_ROOT` и `MAO_DELIVERY_JOURNAL` описаны в [`apps/server/README.md`](../apps/server/README.md).

Server startup не является разрешением на LLM-вызов. Production Runtime требует явной проверки executable, модели, авторизации, доступности, workspace, budget admission и execution approval. Локальный runtime JSON не хранит provider credentials.

## Supervisor и host acceptance

Stage A A1–A4 проверял фиксированный non-LLM probe, отдельный scratch SQLite/journal, system-level Supervisor и systemd/cgroup evidence. Эти результаты не означают, что в обычном локальном запуске подключён production dispatch.

Не запускайте весь Server от root. Production Supervisor должен быть отдельным root-owned компонентом; model execution работает от ограниченной identity. Приложение не должно вызывать `sudo`, автоматически устанавливать или включать systemd service. На этой стадии используйте только deployment-инструкцию, проверенную для конкретного релиза; тестовый host probe не является командой установки Supervisor.

Не направляйте acceptance-тесты на рабочую SQLite/journal и не используйте production port 3335. При любом отсутствии binding, supervisor identity, InvocationID, cgroup membership или положительного termination observation тест обязан оставаться BLOCKED.

## Где читать дальше

- [README проекта](../README.md) — обзор и текущая готовность.
- [Архитектура](ARCHITECTURE.md) — компоненты, trust boundaries и storage.
- [Статус](STATUS.md) — результаты тестов и host acceptance.
- [Roadmap](ROADMAP.md) — следующие проверяемые этапы.
