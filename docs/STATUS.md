# Статус проекта — 15 ноября 2026 года

Эта матрица отделяет локальные тесты, fake Runtime, host acceptance и обычное production execution. **PASS для тестового сценария не означает production-ready систему.** Stage A host результаты ниже отражают результаты приемки, заданные для этой редакции; их границы перечислены явно.

## Сводка этапов

| Этап | Результат | Что доказано | Что не следует из PASS |
| --- | --- | --- | --- |
| A — Supervisor containment | **A1–A4 PASS (host E2E)** | IPC/SO_PEERCRED; фиксированный non-LLM запуск через system-level Supervisor; identity и cgroup; termination evidence; Supervisor restart/replay незавершённого probe. | Не доказывает аварийное восстановление Core целиком и не подтверждает production dispatch обычных задач. |
| B — Core / Runtime | **PASS на fake Runtime; production в работе** | Test Core проходит сценарии Director/queue/runtime contracts с детерминированным fake. | Реальная обычная задача через production Core ещё не принята; повторные платные calls не подразумеваются. |
| C — Persistent Storage | **Тесты PASS** | Clean initialization, защищённое хранение и сохранение тестового состояния при перезапуске в изолированных rehearsal. | Это не означает, что реальные данные уже мигрированы или что production deployment автоматически настроен. |
| D — Multi-Project | **5/5 acceptance checks PASS на fake Runtime** | Два проекта и workspace, DAG, Reviewer/evidence flow, квоты и два execution slots, SQLite persistence/restart. | Real Codex multi-project E2E ещё не подтверждён. |
| E — Live Office | **28/28 тестов PASS** | 3 Status Adapter, 10 Employee Live State, 8 Office UI, 7 Office Integration. | Реальный UI → production Runtime E2E не подтверждён. |

## Stage A — проверка Supervisor на Debian

| Проверка | Результат | Доказательство и границы |
| --- | --- | --- |
| A1 — IPC и peer authentication | **PASS** | Host E2E проверил authenticated Supervisor IPC и `SO_PEERCRED` с разрешённой Core identity. |
| A2 — containment | **PASS** | Фиксированный non-LLM probe запущен через system-level Supervisor от `mao-exec`; сверены системная identity, эффективные systemd sandbox properties и фактическое членство в cgroup v2. |
| A3 — termination | **PASS** | Тестовый процесс штатно остановлен. Независимое termination evidence связано с исходными `InvocationID` и `ControlGroup`, а cgroup сообщил `populated=0`. |
| A4 — Supervisor restart/recovery | **PASS** | После рестарта Supervisor переподключился к тому же легитимному незавершённому probe; повторный launch не выполнялся. Это проверка восстановления Supervisor и reattach к живому unit. |

**Ограничение A4:** тест не моделирует полный crash/recovery Core. Он не подтверждает все варианты потери процесса Core, восстановления Core safety store, повторного запуска сервера и разрешения глобального quarantine.

Host acceptance использовал фиксированную безвредную задачу, не произвольную команду и не модель. PASS этого сценария не разрешает запуск обычных пользовательских задач и не является подтверждением production dispatch.

## Stage B — Production Dispatch

- Acceptance-тесты на **fake Runtime** ранее прошли.
- Подключение production Core к реальному system-level Supervisor находится в работе.
- Обычный task flow от HTTP confirmation до реального Codex execution через production Core пока **не подтверждён**.
- Неизвестный model allowance остаётся UNKNOWN; точная стоимость не выводится без фактических данных провайдера.

## Stage C — постоянное хранение

Тесты миграции и clean initialization ранее прошли на временных SQLite и каталогах: сохранение состояния, целостность, права, повторный запуск и rollback-путь. Реальные пользовательские базы не считаются перенесёнными этими тестами.

## Stage D — проекты и задания

**5/5 acceptance criteria PASS в harness с fake Runtime.** Проверены:

1. Два независимых проекта и workspace.
2. DAG и назначение реального Directory employee/profile в тестовом Core.
3. Предел двух активных исполнений и поведение третьей ожидающей задачи.
4. Раздельное сохранение состояний/событий/артефактов и статусов, Reviewer получает Evidence Package.
5. SQLite restart/recovery без повторного запуска завершённой задачи и с сохранением safety gate.

Fake Runtime не доказывает реальное выполнение Codex, доступность production модели или одновременную работу над двумя настоящими проектами.

## Stage E — Office UI

Итого **28/28 тестов PASS**:

- 3 — 3D Status Adapter;
- 10 — Employee Live State;
- 8 — Office UI;
- 7 — Office Integration.

Тесты подтверждают проекцию заданных live state и представление UI. Они не подтверждают, что production Runtime уже питает эти данные в полном браузерном E2E.

## Следующий критерий готовности

Система не считается готовой к продолжительной автономной эксплуатации, пока Production Dispatch не будет подключён и пока одна обычная real task не пройдёт через Core → Supervisor → Runtime → Reviewer → durable SQLite → API → Office UI. Затем требуется отдельный real two-project E2E и восстановление Core после рестарта. Подробный план: [ROADMAP.md](ROADMAP.md).
