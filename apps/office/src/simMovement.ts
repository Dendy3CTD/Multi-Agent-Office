import type { Position } from './types'

/** Deterministic, movement-only tour used by ?sim. It never emits LLM events. */
export const SIM_MOVEMENT_PLAN = Object.freeze([
  { role: 'boss', delayMs: 9000, dwellMs: 2600, label: 'Идёт к доске задач' },
  { role: 'developer', delayMs: 15000, dwellMs: 2600, label: 'Идёт к доске задач' },
  { role: 'engineer', delayMs: 21000, dwellMs: 2600, label: 'Идёт к доске задач' },
  { role: 'analyst', delayMs: 27000, dwellMs: 2600, label: 'Идёт к доске задач' },
] as const)

export const SIM_BOARD_POINT: Position = Object.freeze({ x: 52.03, y: 25.5 })

export function simMovementTarget(role: string, atBoard: boolean, desk: Position): Position {
  return atBoard ? { ...SIM_BOARD_POINT } : { ...desk }
}

export function simUsesOnlyLocalMovement(): boolean {
  return true
}
