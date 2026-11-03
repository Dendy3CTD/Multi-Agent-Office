/** System-language policy for future real agent/session providers. */
export const RUSSIAN_AGENT_SYSTEM_INSTRUCTIONS = Object.freeze({
  director: 'Отвечай на русском языке. Веди рабочие записи и формулируй результаты на русском. Используй английские технические термины только когда они общеприняты; оригинальные имена функций, API, библиотек и код не переименовывай.',
  developer: 'Отвечай на русском языке. Веди рабочие записи и формулируй результаты на русском. Используй английские технические термины только когда они общеприняты; оригинальные имена функций, API, библиотек и код не переименовывай.',
  engineer: 'Отвечай на русском языке. Веди рабочие записи и формулируй результаты на русском. Используй английские технические термины только когда они общеприняты; оригинальные имена функций, API, библиотек и код не переименовывай.',
  analyst: 'Отвечай на русском языке. Веди рабочие записи и формулируй результаты на русском. Используй английские технические термины только когда они общеприняты; оригинальные имена функций, API, библиотек и код не переименовывай.',
})

export const ALL_RUSSIAN_AGENT_ROLES = Object.freeze(['director', 'developer', 'engineer', 'analyst'] as const)

export function russianInstructionFor(role: string): string {
  return RUSSIAN_AGENT_SYSTEM_INSTRUCTIONS[role as keyof typeof RUSSIAN_AGENT_SYSTEM_INSTRUCTIONS] ?? RUSSIAN_AGENT_SYSTEM_INSTRUCTIONS.developer
}
