# MAO Hybrid — Multi-Agent Office

MAO Hybrid — локальный офис специализированных ИИ-агентов для программирования и инженерных задач. Вы регистрируете рабочую папку проекта и описываете результат. Director назначает исполнителей, Codex Runtime запускает этапы, а Task Store сохраняет план, результаты и события.

**Статус v0.1.0 — Working MVP / Production E2E v7 PASSED.** Подтверждена автономная цепочка Analyst → Developer → QA Engineer на задаче разработки Python-библиотеки. Инженерные адаптеры и интерфейсы имеют собственные сценарии проверки.

## Архитектура

| Компонент | Что делает |
| --- | --- |
| **Company и Director** | Company хранит каталог ролей и сотрудников. Director внутри Company выбирает специалиста по запросу, назначает исполнителей и строит план с зависимостями. Сложность `simple` даёт один этап, `standard` добавляет анализ, `complex` добавляет заключительную проверку QA. |
| **Codex Runtime** | Запускает локальный Codex CLI для каждого этапа в рабочем каталоге проекта и преобразует JSONL-вывод в события и структурированные результаты. |
| **Coding Tools и MCP** | API выдаёт инструменты с учётом роли и workspace. Coding Tools выполняет проверки и операции Git в рамках разрешённых возможностей. Отдельные пакеты предоставляют инструменты электроники, CAD, поиска технических данных и проверки согласованности. |
| **Task Store и API** | SQLite хранит проекты, планы, зависимости, попытки и события. Локальный HTTP API регистрирует проекты, запускает задачи и отдаёт состояние. SSE передаёт события текущего процесса API, сохранённая история доступна в деталях задачи. |
| **Pixel Office** | Показывает офис, сотрудников и состояние задач. В рабочем режиме использует локальный API. Режим `?mode=fixture` открывает демонстрационные данные. |
| **Agent Terminal** | Веб-интерфейс ветки `feat/agent-terminal` для отправки задач, просмотра этапов, инструментов и событий. Маршрут `/terminal` появляется при запуске web из этой ветки. |

## Как проходит задача Analyst → Developer → QA

1. **Analyst** формулирует контракт и критерии. Company сохраняет результат в Task Store и передаёт его Developer.
2. **Developer** реализует код и тесты. Если запрос требует запуска проверок, API требует фактический структурированный результат `coding.check.run`. Developer может исправить ошибки и повторить проверку. Приёмка учитывает порядок вызовов и результат последней обязательной проверки. Все попытки остаются в истории.
3. **API** требует `passed` с кодом выхода `0` и сверяет отпечаток workspace. Отпечаток учитывает содержимое исходников, тестов, документации и конфигурации. Служебные Python-кэши исключены. Правка значимых файлов после PASS требует нового запуска.
4. **QA Engineer** получает контракт, результат Developer и данные прогона. Он запускается отдельным этапом Codex Runtime в режиме чтения, самостоятельно изучает файлы и возвращает структурированный вердикт. Замечания или неподтверждённые результаты приводят к `needs_review`. До завершения Developer этап QA остаётся в очереди.

Вложенный MCP-инструмент `coding.review.diff` доступен по явному требованию задачи. Обычная приёмка использует независимый этап QA.

## Установка на Debian/Linux

Нужны Node.js от 22.5, Corepack и версия pnpm из поля `packageManager` в [package.json](package.json), локальный Codex CLI с действующим входом в аккаунт и Git. Для примера ниже нужны `curl`, Python 3 и Bubblewrap. Bubblewrap используется для изоляции команд Coding Tools. Хост должен разрешать запуск песочницы.

```bash
sudo apt install git curl python3 bubblewrap
node --version
corepack pnpm --version
codex --version
git clone --branch mao-hybrid https://github.com/Dendy3CTD/Multi-Agent-Office.git
cd Multi-Agent-Office
corepack pnpm install
```

Команды pnpm выполняются из корня worktree. KiCad, ngspice, PlatformIO и FreeCAD нужны для соответствующих инженерных операций. Их настройка описана в документации [Electronics Tools](packages/tools-electronics/README.md) и [CAD Tools](packages/tools-cad/README.md).

### Конфигурация и запуск Backend

```bash
cp -n mao-hybrid.config.example.json mao-hybrid.config.json
```

Укажите в `codexPath` путь к вашему Codex CLI, например результат `command -v codex`. Можно убрать это поле, тогда запуск использует `MAO_HYBRID_CODEX_CLI` или команду `codex` из `PATH`. Runtime наследует вход Codex CLI от пользователя, запускающего API.

```json
{
  "host": "127.0.0.1",
  "port": 8765,
  "dataDirectory": "./data",
  "maxConcurrent": 2,
  "codexPath": "codex",
  "sandbox": "workspace-write"
}
```

`host` принимает loopback-адрес `127.0.0.1` или `::1`. `maxConcurrent` принимает `1` или `2`. В `sandbox` доступны `workspace-write` и `read-only`. Опциональное поле `model` передаётся Codex CLI. Относительный `dataDirectory` разрешается из рабочей папки API. При запуске командой ниже SQLite хранится в `apps/api/data/tasks.sqlite`.

```bash
corepack pnpm build
MAO_HYBRID_CONFIG="$PWD/mao-hybrid.config.json" corepack pnpm start
```

### Запуск Pixel Office и Agent Terminal

В другом терминале запустите frontend:

```bash
corepack pnpm --filter @mao-hybrid/web dev
```

Отдельный worktree Agent Terminal можно подготовить из клона Hybrid:

```bash
git fetch origin
git worktree add --track -b feat/agent-terminal ../mao-hybrid-terminal origin/feat/agent-terminal
cd ../mao-hybrid-terminal
corepack pnpm install
```

- Pixel Office открывается по адресу [http://127.0.0.1:3333/](http://127.0.0.1:3333/).
- Для Agent Terminal запустите ту же команду из worktree ветки `feat/agent-terminal` и откройте [http://127.0.0.1:3333/terminal](http://127.0.0.1:3333/terminal). Этот frontend может использовать уже запущенный Backend ветки `mao-hybrid`. Перед запуском второго frontend освободите порт `3333`.
- Vite проксирует `/mao-api` на `http://127.0.0.1:8765`. Если порт API отличается, задайте `VITE_MAO_API_ORIGIN` при запуске Vite.

## HTTP API

| Метод и путь | Назначение |
| --- | --- |
| `GET /health` | Проверка доступности HTTP API |
| `GET /api/status` | Доступность Runtime, счётчики и предел параллелизма |
| `GET /api/tools` | Каталог инструментов |
| `GET /api/employees` | Каталог сотрудников |
| `GET /api/projects`, `POST /api/projects` | Список и регистрация проектов |
| `GET /api/tasks`, `POST /api/tasks` | История и отправка задач |
| `GET /api/tasks/:taskId` | План, итоги этапов, попытки и сохранённая история |
| `GET /api/tasks/:taskId/events` | SSE с поддержкой `Last-Event-ID` |
| `POST /api/tasks/:taskId/steps/:stepId/retry` | Повтор этапа, если Task Store разрешает его |
| `POST /api/engineering/projects` | Регистрация инженерного проекта и запуск workflow |
| `POST /api/engineering/test-runs` | Ограниченный прогон Research → BOM с явным подтверждением |
| `GET /api/projects/:projectId/manifest` | Манифест инженерных артефактов и статусов |

### Пример программной задачи

Создайте отдельную папку для работы агента. В примере `workspaceRoot` вычисляется с помощью `pwd -P`.

```bash
mkdir -p mao-python-demo
workspace="$(cd mao-python-demo && pwd -P)"

curl -fsS http://127.0.0.1:8765/api/projects \
  -H 'Content-Type: application/json' \
  --data-binary "$(node -e 'console.log(JSON.stringify({id:"python-demo",name:"Python demo",workspaceRoot:process.argv[1]}))' "$workspace")"

curl -fsS http://127.0.0.1:8765/api/tasks \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: python-demo-01' \
  --data-binary @- <<'JSON'
{
  "projectId": "python-demo",
  "title": "Разработать небольшую Python-библиотеку",
  "brief": "Определи контракт функции сложения, реализуй её в engineering.py, добавь unittest в tests/ и README.md. Запусти тесты через coding.check.run с python-test. Передай результат независимому QA.",
  "complexity": "complex",
  "acceptanceCriteria": [
    "Код и тесты соответствуют контракту.",
    "coding.check.run вернул passed с кодом выхода 0.",
    "QA проверил файлы и сохранённый результат запуска."
  ]
}
JSON
```

`POST /api/tasks` ждёт выполнения доступных этапов. В ответе есть `task.id`, `task.status`, `steps` и `directorPlan`. При повторе того же запроса используйте тот же ключ идемпотентности. Детали задачи можно получить по `GET /api/tasks/:taskId`.

## Тестирование

```bash
corepack pnpm test
corepack pnpm --filter @mao-hybrid/api test
corepack pnpm --filter @mao-hybrid/runtime test
corepack pnpm --filter @mao-hybrid/tools-coding test
corepack pnpm typecheck
```

Корневой `test` сначала собирает backend-пакеты, затем запускает тесты Company, Task Store и корневого каталога `tests/`. Пакетные тесты API, Runtime и Coding Tools используют собранные модули. Тесты реального Codex CLI, объявленные в `apps/api/test/*e2e.test.mjs`, требуют `MAO_HYBRID_CODEX_CLI` и зависимости соответствующего сценария. Эти тесты отличаются от зафиксированного ниже прогона v7.

## Подтверждённый Production E2E v7

20 ноября 2026 года задача `task-1cb8a56ac5e3207fbcaf4df4ecacc707` завершилась со статусом `completed`. Это первый подтверждённый автономный E2E всей цепочки Analyst → Developer → QA Engineer.

| Этап или проверка | Результат |
| --- | --- |
| Analyst, Developer, QA Engineer | Все три этапа `completed` |
| `coding.check.run` | Вызовы `item_8` и `item_14` вернули `passed`, код выхода `0` |
| Python unittest | **11/11 PASS** |
| QA | `approved`, `findings: []` |

QA прочитал `engineering.py`, `tests/test_engineering.py`, `README.md` и сохранённый MCP-отчёт, затем сверил отчёт с обоими вызовами инструмента. История сохранена в Task Store. Перед этим для FIX-10 зафиксированы успешная сборка, **43/43** интеграционных теста и **9/9** групп проверок.

## Границы MVP и безопасность

- В каталоге 113 профилей. v7 подтверждает один программный сценарий с тремя ролями. Для остальных сотрудников, инженерных подсистем и параллельного выполнения сложных проектов нужны отдельные E2E.
- API слушает loopback и рассчитан на доверенное локальное использование. Регистрируйте только папки, которые готовы предоставить агентам. Runtime запускается в workspace, а MCP доступен по роли и проверяет границы путей.
- Команды Coding Tools выполняются изолированно. Запись во внешние системы через task-scoped Coding MCP отключена. QA программной цепочки получает режим чтения.
- Инженерные проверки программных артефактов не подтверждают физические испытания. Несостоявшиеся, заблокированные и непроверенные операции требуют отдельной обработки.
- Если исход предыдущего запуска нельзя установить, задача может остаться в `needs_review`. API предоставляет ограниченный повтор этапа. Отмена исполнения через HTTP API пока не реализована.
- Локальная конфигурация, SQLite и рабочие папки проектов могут содержать пользовательские данные. Храните их вне публикации.

## Структура репозитория

| Путь | Назначение |
| --- | --- |
| `apps/api/` | Локальный HTTP API, подключение Runtime и MCP, интеграционные тесты |
| `apps/web/` | Pixel Office. В ветке `feat/agent-terminal` также находится `src/terminal/` |
| `packages/company/`, `packages/task-store/` | Director, каталог, планирование и долговременное состояние |
| `packages/runtime/`, `packages/contracts/`, `packages/events/` | Codex CLI, общие контракты и события |
| `packages/tools-*/`, `packages/engineering-consistency/` | Инструменты и инженерная проверка согласованности |
| `tests/`, `docs/` | Общие проверки и документация |

## Roadmap

1. Согласовать объединение Agent Terminal и Hybrid, затем проверить оба интерфейса с одним Backend.
2. Сделать программный E2E воспроизводимым на чистом Linux-окружении и включить его в проверки релиза.
3. Проверить восстановление, параллельные сложные задачи и передачу результатов между проектами.
4. Добавить отдельные E2E для электроники, CAD, исследования и инженерного workflow.
