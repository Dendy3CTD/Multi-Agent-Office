import type { AgentState } from './types'

export type CharacterAnimation = 'idle' | 'walking' | 'working' | 'coffee'

/** Original frame dimensions for the four generated character families. */
export const GENERATED_SPRITE_FRAME_SIZE: Record<string, { width: number; height: number }> = Object.freeze({
  'Me-1': { width: 450, height: 1024 },
  'Frontend-dev-1': { width: 402, height: 845 },
  'dev-2': { width: 374, height: 1029 },
  'employee-2': { width: 324, height: 844 },
})

export function spriteFrameSize(base: string): { width: number; height: number } | undefined {
  return GENERATED_SPRITE_FRAME_SIZE[base]
}

export function animationForState(state: AgentState): CharacterAnimation {
  if (state === 'walking-to-desk' || state === 'walking-to-manager' || state === 'new-hire' || state === 'completed' || state === 'changing-room') return 'walking'
  if (state === 'working') return 'working'
  if (state === 'coffee-break') return 'coffee'
  return 'idle'
}

/** Frame clock is deliberately independent from React/server event delivery. */
export function advanceAnimationFrame(frame: number, frameCount: number): number {
  return frameCount <= 1 ? 0 : (frame + 1) % frameCount
}

export function frameIntervalMs(animation: CharacterAnimation): number {
  switch (animation) {
    case 'walking': return 135
    case 'working': return 180
    case 'coffee': return 420
    case 'idle': return 650
  }
}

export function frameCountForAnimation(animation: CharacterAnimation): number {
  return animation === 'walking' ? 6 : 4
}

/** CSS background-position percentage for a frame in an equal-width sheet. */
export function framePositionPercent(frame: number, frameCount: number): number {
  return frameCount <= 1 ? 0 : (frame / (frameCount - 1)) * 100
}

export interface AnimationClock {
  stop(): void
}

type AnimationTimer = ReturnType<typeof setInterval>

/**
 * A small injectable clock keeps frame delivery independent from React
 * renders. The component owns one clock per animation state and only stops it
 * when that state actually changes or the component unmounts.
 */
export function startAnimationClock(
  animation: CharacterAnimation,
  onFrame: (frame: number) => void,
  setTimer: (handler: () => void, timeout: number) => AnimationTimer = (handler, timeout) => globalThis.setInterval(handler, timeout),
  clearTimer: (timer: AnimationTimer) => void = timer => globalThis.clearInterval(timer),
): AnimationClock {
  const count = frameCountForAnimation(animation)
  let frame = 0
  const timer = setTimer(() => {
    frame = advanceAnimationFrame(frame, count)
    onFrame(frame)
  }, frameIntervalMs(animation))
  return { stop: () => clearTimer(timer) }
}
