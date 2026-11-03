# Multi-Agent Office (MAO)

Локальная мультиагентная платформа с визуальным AI-офисом.
Цель — объединить виртуальных сотрудников, выполнение задач через
OpenCode, контроль бюджета и долговременный архив работы в Obsidian.

Проект находится в активной разработке. Desktop-интерфейс и базовые
пакеты Runtime, Budget Manager и Orchestrator уже реализованы.
Полноценный серверный backend и автономная работа команды пока отсутствуют.

## Целевая команда

- **Director** — планирование, распределение задач, бюджет и приёмка.
- **Coder + Tester** — разработка, Git, отладка и тестирование.
- **Engineer + Modeller** — расчёты, CAD и моделирование.
- **Analyst** — исследования и работа с браузером.

В текущем Orchestrator пока сохранены пять маршрутов моделей,
включая вспомогательного Helper. Это временное состояние прототипа.
Подробнее: `docs/reports/OAO-MODEL-002.md`.

## Архитектура

- OpenCode Go — выбранный провайдер моделей на текущем этапе.
- Orchestrator — координация выполнения задач.
- Budget Manager — лимиты, расходы и параллельность.
- SQLite — планируемое хранилище оперативного состояния.
- Obsidian — долговременный архив и база знаний.
- Git worktrees — планируемая изоляция параллельной работы.

## Реализовано

- Desktop-интерфейс React, Vite и Electron.
- Изометрическая сцена с четырьмя визуальными персонажами.
- Анимации, перемещение и проверка столкновений.
- Доска задач, чат, уведомления и демонстрационные события.
- Режим `?sim` без backend и вызовов LLM.
- OpenCode Runtime, Budget Manager и начальный Orchestrator.
- Автоматизированные тесты и production-сборка.

## Следующие этапы

- Серверный backend и WebSocket API.
- Task Manager и полноценный Director.
- Управление моделями, ролями и Skills.
- SQLite, Obsidian Archive и проектная память.
- Управление артефактами и полный цикл проверки результатов.

## Запуск

Требуется Debian 13 или совместимый Linux, Node.js 22+,
Corepack и pnpm.

Установка зависимостей: `corepack pnpm install`

Сборка: `corepack pnpm build`

Запуск: `corepack pnpm desktop`

## Проверки

- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm test:desktop`
- `corepack pnpm test:animations`
- `corepack pnpm build`

## Документация

- `docs/ARCHITECTURE.md` — архитектура.
- `docs/ROADMAP.md` — план разработки.
- `docs/CHANGELOG.md` — история изменений.
- `docs/OBSIDIAN-ARCHIVE.md` — концепция архива.
- `docs/reports/` — технические отчёты.
