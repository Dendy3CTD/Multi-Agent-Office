/** Russian UI vocabulary. Internal roles, event types and API fields stay English. */
export const DEFAULT_LOCALE = 'ru-RU'

export const ROLE_NAMES: Record<string, string> = {
  boss: 'Директор',
  director: 'Директор',
  developer: 'Разработчик',
  engineer: 'Инженер',
  analyst: 'Аналитик',
  assistant: 'Ассистент',
  debugger: 'Отладчик',
  'code-reviewer': 'Ревьюер',
  'frontend-developer': 'Frontend-разработчик',
  'fullstack-developer': 'Fullstack-разработчик',
  'test-engineer': 'Инженер по тестированию',
  'security-auditor': 'Аудитор безопасности',
  'architect-reviewer': 'Архитектор',
  'performance-engineer': 'Инженер производительности',
  'devops-engineer': 'DevOps-инженер',
  'database-architect': 'Архитектор базы данных',
  'typescript-pro': 'TypeScript-разработчик',
  'ai-engineer': 'Инженер ИИ',
  'prompt-engineer': 'Инженер промптов',
  'general-purpose': 'Специалист',
}

export const STATE_NAMES: Record<string, string> = {
  idle: 'Ожидает',
  walking: 'Перемещается',
  'walking-to-desk': 'Перемещается',
  'walking-to-manager': 'Перемещается',
  'talking-to-manager': 'Разговаривает',
  working: 'Работает',
  'coffee-break': 'Перерыв',
  completed: 'Завершено',
  'new-hire': 'Прибывает',
  'changing-room': 'Переходит',
  waiting: 'В ожидании',
  failed: 'Ошибка',
  resting: 'Отдыхает',
}

export const UI_TEXT: Record<string, string> = {
  'Task Board': 'Доска задач',
  'Task board': 'Доска задач',
  Inspector: 'Инспектор',
  Chat: 'Чат',
  Settings: 'Настройки',
  Status: 'Статус',
  Notifications: 'Уведомления',
  Events: 'События',
  Metrics: 'Показатели',
  Permissions: 'Разрешения',
  Working: 'Работает',
  Idle: 'Ожидает',
  Walking: 'Перемещается',
  Resting: 'Отдыхает',
  'Coffee break': 'Перерыв',
  Waiting: 'В ожидании',
  Completed: 'Завершено',
  Failed: 'Ошибка',
  'To do': 'К выполнению',
  'In progress': 'В работе',
  Done: 'Готово',
  'No tasks': 'Нет задач',
  'Send message': 'Отправить сообщение',
  'Mute': 'Выключить звук',
  'Unmute': 'Включить звук',
  'Allow': 'Разрешить',
  'Allow & remember': 'Разрешить и запомнить',
  'Deny': 'Отклонить',
  'Close': 'Закрыть',
}

export function roleName(role: string, fallback = role): string {
  return ROLE_NAMES[role] ?? fallback
}

export function stateName(state: string, fallback = state): string {
  return STATE_NAMES[state] ?? UI_TEXT[state] ?? fallback
}

export function uiText(value: string): string {
  return UI_TEXT[value] ?? value
}

export function formatRussianLocale(value: Date | number): string {
  return new Date(value).toLocaleString(DEFAULT_LOCALE)
}
