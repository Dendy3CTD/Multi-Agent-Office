import { describe, expect, it } from 'vitest'
import { MAIN_OFFICE_WORKSTATIONS, ROOMS, workstationForRole } from './rooms'
import { findOfficePath, segmentIsClear } from './navigation'
import { scenePoint, sceneRect } from './sceneGeometry'
import { getInteraction } from './interactions'
import { advanceAnimationFrame, spriteFrameSize, startAnimationClock } from './characterAnimation'
import { getAnimatedSpritePath } from './theme'
import { frameCountForAnimation, framePositionPercent } from './characterAnimation'
import { DEFAULT_LOCALE, roleName, stateName } from './i18n'
import { ALL_RUSSIAN_AGENT_ROLES, russianInstructionFor } from './agentLanguage'
import { SIM_MOVEMENT_PLAN, SIM_BOARD_POINT, simMovementTarget, simUsesOnlyLocalMovement } from './simMovement'

const room = ROOMS['main-office']

describe('main office layout', () => {
  it('uses Russian as the default visible locale without changing role IDs', () => {
    expect(DEFAULT_LOCALE).toBe('ru-RU')
    expect(roleName('director')).toBe('Директор')
    expect(roleName('developer')).toBe('Разработчик')
    expect(roleName('engineer')).toBe('Инженер')
    expect(roleName('analyst')).toBe('Аналитик')
    expect(stateName('working')).toBe('Работает')
    expect(stateName('walking')).toBe('Перемещается')
  })

  it('defines Russian system instructions for all four visible employees', () => {
    expect(ALL_RUSSIAN_AGENT_ROLES).toHaveLength(4)
    for (const role of ALL_RUSSIAN_AGENT_ROLES) {
      expect(russianInstructionFor(role)).toMatch(/русском языке/i)
      expect(russianInstructionFor(role)).toMatch(/рабочие записи/i)
      expect(russianInstructionFor(role)).toMatch(/API/i)
    }
  })

  it('defines a local movement tour for all four employees', () => {
    expect(SIM_MOVEMENT_PLAN.map(step => step.role)).toEqual(['boss', 'developer', 'engineer', 'analyst'])
    expect(SIM_MOVEMENT_PLAN.every(step => step.delayMs > 0 && step.dwellMs > 0)).toBe(true)
    expect(simMovementTarget('engineer', true, { x: 1, y: 1 })).toEqual(SIM_BOARD_POINT)
    expect(simMovementTarget('engineer', false, { x: 40, y: 60 })).toEqual({ x: 40, y: 60 })
    expect(simUsesOnlyLocalMovement()).toBe(true)
  })

  it('has exactly four desks, four chairs and four desk spots', () => {
    expect(room.furniture.filter(item => item.type === 'desk-standing')).toHaveLength(4)
    expect(room.furniture.filter(item => item.type === 'chair')).toHaveLength(4)
    expect(room.agentSpots.filter(spot => spot.workstationId)).toHaveLength(4)
    expect(new Set(room.agentSpots.filter(spot => spot.workstationId).map(spot => spot.id)).size).toBe(4)
  })

  it('keeps each chair directly in front of its matching desk', () => {
    const desks = room.furniture.filter(item => item.type === 'desk-standing')
    const chairs = room.furniture.filter(item => item.type === 'chair')
    for (const chair of chairs) {
      const nearestDesk = desks.reduce((best, desk) =>
        Math.hypot(desk.x - chair.x, desk.y - chair.y) < Math.hypot(best.x - chair.x, best.y - chair.y) ? desk : best)
      expect(Math.abs(nearestDesk.x - chair.x)).toBeLessThanOrEqual(0.1)
      expect(chair.y).toBeGreaterThan(nearestDesk.y)
    }
  })

  it('defines independent standing, approach, interaction and collision geometry', () => {
    expect(MAIN_OFFICE_WORKSTATIONS).toHaveLength(4)
    for (const workstation of MAIN_OFFICE_WORKSTATIONS) {
      const standing = workstation.standingPoint
      const inRect = (point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) =>
        point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
      expect(inRect(standing, workstation.deskBounds), workstation.role).toBe(false)
      expect(inRect(standing, workstation.chairBounds), workstation.role).toBe(false)
      expect(standing).not.toEqual(workstation.interactionPoint)
      expect(standing).not.toEqual(workstation.approachPoint)
      expect(workstationForRole(workstation.role)?.id).toBe(workstation.id)
    }
  })
})

describe('collision-aware office navigation', () => {
  it('finds a safe route from the door to every desk', () => {
    const entry = room.entryPoint
    for (const spot of room.agentSpots.filter(item => item.type === 'desk')) {
      const result = findOfficePath(room, entry, spot)
      expect(result.reachable, spot.id).toBe(true)
      let cursor = entry
      for (const point of result.points) {
        expect(segmentIsClear(room, cursor, point, true), `${spot.id}: ${cursor.x},${cursor.y} -> ${point.x},${point.y}`).toBe(true)
        cursor = point
      }
    }
  })

  it('does not allow a diagonal segment through a desk corner', () => {
    const desk = room.obstacles!.find(obstacle => obstacle.id === 'obstacle-developer-desk')!
    const from = { x: desk.x - 5, y: desk.y - 5 }
    const to = { x: desk.x + desk.width + 5, y: desk.y + desk.height + 5 }
    expect(segmentIsClear(room, from, to)).toBe(false)
    expect(findOfficePath(room, from, to).reachable).toBe(true)
  })

  it('routes around a table instead of crossing it', () => {
    const table = room.obstacles!.find(obstacle => obstacle.id === 'obstacle-coffee-table')!
    const from = { x: table.x - 5, y: table.y + table.height / 2 }
    const to = { x: table.x + table.width + 5, y: table.y + table.height / 2 }
    const path = findOfficePath(room, from, to)
    expect(path.reachable).toBe(true)
    let cursor = from
    for (const point of path.points) {
      expect(segmentIsClear(room, cursor, point, point === path.points[path.points.length - 1])).toBe(true)
      cursor = point
    }
  })

  it('can reach each chair through its approach side', () => {
    for (const chair of room.obstacles!.filter(obstacle => obstacle.kind === 'chair')) {
      const destination = { x: chair.x + chair.width / 2, y: chair.y + chair.height / 2 }
      const result = findOfficePath(room, room.entryPoint, destination)
      expect(result.reachable, chair.id).toBe(true)
    }
  })

  it('keeps the source-image geometry aligned after resizing', () => {
    const desk = sceneRect(505, 278, 270, 130)
    const resized = { width: 836, height: 470.5 }
    expect((desk.x / 100) * resized.width).toBeCloseTo(252.5)
    expect((desk.y / 100) * resized.height).toBeCloseTo(139)
  })

  it('uses the safe standing target for workstation interactions', () => {
    const standing = workstationForRole('developer')!.standingPoint
    expect(getInteraction('desk-developer')?.walkTo).toEqual(standing)
    expect(getInteraction('chair-developer')?.walkTo).toEqual(standing)
    const route = findOfficePath(room, room.entryPoint, standing)
    expect(route.reachable).toBe(true)
    let cursor = room.entryPoint
    for (const point of route.points) {
      expect(segmentIsClear(room, cursor, point, point === standing)).toBe(true)
      cursor = point
    }
  })

  it('advances walking and working animation clocks independently of messages', () => {
    expect(advanceAnimationFrame(0, 2)).toBe(1)
    expect(advanceAnimationFrame(1, 2)).toBe(0)
    expect(advanceAnimationFrame(0, 1)).toBe(0)
  })

  it('keeps an animation clock alive until explicit cleanup', () => {
    let callback: (() => void) | undefined
    let cleared = false
    const clock = startAnimationClock('idle', () => {}, (handler) => {
      callback = handler
      return 1 as unknown as ReturnType<typeof setInterval>
    }, () => { cleared = true })
    expect(callback).toBeTypeOf('function')
    callback!()
    clock.stop()
    expect(cleared).toBe(true)
  })

  it('uses the real sheet frame counts and moves between visual frames', () => {
    expect(frameCountForAnimation('walking')).toBe(6)
    expect(frameCountForAnimation('working')).toBe(4)
    expect(framePositionPercent(0, 6)).toBe(0)
    expect(framePositionPercent(1, 6)).toBeCloseTo(20)
    expect(framePositionPercent(5, 6)).toBe(100)
    expect(spriteFrameSize('Me-1')).toEqual({ width: 450, height: 1024 })
    expect(spriteFrameSize('Frontend-dev-1')).toEqual({ width: 402, height: 845 })
    expect(spriteFrameSize('dev-2')).toEqual({ width: 374, height: 1029 })
    expect(spriteFrameSize('employee-2')).toEqual({ width: 324, height: 844 })
  })

  it('resolves generated sheets for Director and the three sim employees', () => {
    expect(getAnimatedSpritePath('boss', 'Me-1', 'front-left', 'walking')).toContain('/animations/Me-1-walking-front-left.png')
    expect(getAnimatedSpritePath('developer', 'Frontend-dev-1', 'front-right', 'working')).toContain('/animations/Frontend-dev-1-working-front-right.png')
    expect(getAnimatedSpritePath('engineer', 'dev-2', 'rear-left', 'idle')).toContain('/animations/dev-2-idle-rear-left.png')
    expect(getAnimatedSpritePath('analyst', 'employee-2', 'rear-right', 'coffee')).toContain('/animations/employee-2-coffee-rear-right.png')
  })
})
