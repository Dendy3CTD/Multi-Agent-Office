# Разработка и подготовка Runtime

Этот документ дополняет быстрый старт в [README](../README.md). Он описывает
проверенные команды разработки и границы подготовки реального Runtime. Не
считайте успешный запуск интерфейса или статус авторизации доказательством
production-выполнения задачи.

## Требования

- Debian/Linux для полного локального контура; для одного Office UI достаточно
  среды с Node.js и браузером WebGL.
- Node.js 22 или новее, Corepack и pnpm 12.16.1, заданный в `package.json`.
- Для защищённого Codex execution нужны systemd и cgroup v2, подготовленный
  system-level Supervisor, выделенная execution identity и операторское
  разрешение. Эти компоненты не устанавливаются командами быстрого старта.

## Установка и запуск Office UI

Из корня checkout:

```bash
corepack pnpm install
corepack pnpm --dir apps/office dev --host 127.0.0.1 --port 3333
```

Откройте `http://127.0.0.1:3333/`. UI привязан к loopback. Проверить workspace
сборкой можно командой:

```bash
corepack pnpm build
```

Корневой `build` собирает пакеты workspace; он не запускает сервер и не
исполняет LLM.

## Подготовка Codex Runtime

Активный путь разработки использует Codex CLI с авторизацией через ChatGPT.
OpenCode adapter остаётся в проекте, но в текущем production dispatch он
отключён. Codex должен запускаться через отдельный system-level Supervisor,
который проверяет IPC-клиента и binding исполнения и запускает CLI в systemd
sandbox с отдельной execution identity. Обычный запуск backend от root или
прямой `spawn` в обход Supervisor не является поддерживаемой заменой.

Для создания конфигурации Runtime предназначена команда onboarding:

```text
mao-local onboard-codex \
  --command PATH \
  --runtime-root PATH \
  --codex-home PATH \
  --workspace-root PATH \
  --model chatgpt-plus/ID
```

Текущая реализация требует отдельных явных подтверждений оператора:
`--operator-confirmed-authentication`,
`--operator-confirmed-subscription-availability`,
`--operator-confirmed-model`, `--operator-approved-workspace`,
`--operator-approved-budget-admission` и `--operator-approved-execution`.
Не подставляйте вымышленные значения и не подтверждайте условия, которые не
были проверены.

Отдельный `Codex Home` хранит состояние CLI для execution identity и не должен
указывать на личный профиль пользователя. Onboarding не копирует личные
credentials. Подтверждённый `codex login status` (`Logged in using ChatGPT`)
говорит только о состоянии входа. Он не доказывает успешное сетевое выполнение
модели; в отдельной попытке наблюдалась региональная ошибка HTTP 403, и её
устранение не подтверждено.

Runtime остаётся выключенным, пока оператор явно не разрешит необходимые
условия. Не отключайте sandbox, подтверждения, budget admission или fail-closed
проверки. При неизвестном allowance или стоимости система не должна
придумывать остаток либо переключаться на платный API. Целевой предел — два
одновременно выполняемых агента.

Команда `onboard-codex` и часть system-level Production Dispatch принадлежат
текущей интеграционной работе. Убедитесь, что эта реализация включена в ваш
checkout, прежде чем следовать её onboarding-интерфейсу. Настоящие production
задачи через защищённый dispatch пока ожидают Host E2E приёмки. Stage A Host
E2E подтверждает фиксированный non-LLM probe и не заменяет такую приёмку.

## Данные и секреты

Храните Runtime config, token и Codex Home в закрытых каталогах, доступных
только соответствующим системным пользователям. Не добавляйте токены,
`auth.json`, личный Codex Home, SQLite или приватные workspace в Git и не
печатайте их в логах. Не переносите существующие базы и не меняйте их права
вручную при настройке Runtime. Сначала проверьте документированную процедуру
deployment для выбранной версии checkout.

Не запускайте весь MAO от root: права supervisor ограничены его системной
границей, тогда как Core и Office должны работать под обычной учётной записью.
Не запускайте systemd units, onboarding с разрешениями или задачи с реальными
моделями без отдельного решения оператора.

## Проверяемость

- A1–A4 Host E2E PASS относится к фиксированному non-LLM probe.
- Multi-project, storage и Office acceptance содержат проверки с fake Runtime;
  их PASS не означает, что Codex выполнил production-задачу.
- Для Stage B требуется отдельный Host E2E через Core, authenticated Supervisor
  IPC и systemd sandbox с проверкой сохранённого результата и termination
  evidence.
