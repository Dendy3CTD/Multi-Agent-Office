/**
 * interactions.ts — Boss interaction definitions for clickable furniture
 *
 * Each interaction defines what happens when the boss clicks a furniture item:
 * - walkTo: position to walk to (near the item)
 * - effect: sprite to show above boss on arrival
 * - duration: how long the effect lasts (ms)
 * - chatMessage: what to post in office chat
 * - furnitureState: optional state change for the furniture item
 * - cooldown: minimum ms between interactions with this item
 */

import { boardChatLines, getShownBoard, type TaskBoardInfo } from './taskBoard'
import { workstationForRole } from './rooms'

export interface Interaction {
  walkTo: { x: number; y: number }
  effect: string
  duration: number
  chatMessage: string | string[]
  furnitureState?: { id: string; state: string; revertAfter?: number }
  cooldown: number
  sound?: string
}

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * What clicking a piece of furniture does. The kanban board (and the
 * whiteboard) reads out the task board on the wall when a session has one
 * (src/taskBoard.ts: "3 to do, 1 in progress: Fix the parser") and keeps its
 * flavour lines when none has; `board` is the shown board, passed in by tests.
 */
export function getInteraction(furnitureId: string, board: TaskBoardInfo | null = getShownBoard()): Interaction | null {
  switch (furnitureId) {
    // Workstations: the target is the standing point in front of the chair,
    // never the desk or chair collision rectangle itself.
    case 'desk-director':
    case 'chair-director':
      return { walkTo: workstationForRole('director')!.standingPoint, effect: '/sprites/effects/typing.png', duration: 2500, chatMessage: 'проверяю рабочее место директора', cooldown: 5000 }
    case 'desk-developer':
    case 'chair-developer':
      return { walkTo: workstationForRole('developer')!.standingPoint, effect: '/sprites/effects/typing.png', duration: 2500, chatMessage: 'проверяю рабочее место разработчика', cooldown: 5000 }
    case 'desk-engineer':
    case 'chair-engineer':
      return { walkTo: workstationForRole('engineer')!.standingPoint, effect: '/sprites/effects/typing.png', duration: 2500, chatMessage: 'проверяю рабочее место инженера', cooldown: 5000 }
    case 'desk-analyst':
    case 'chair-analyst':
      return { walkTo: workstationForRole('analyst')!.standingPoint, effect: '/sprites/effects/typing.png', duration: 2500, chatMessage: 'проверяю рабочее место аналитика', cooldown: 5000 }
    // Plants — water them
    case 'plant-1':
      return { walkTo: { x: 83.73, y: 76.52 }, effect: '/sprites/effects/watering-can.png', duration: 3000, chatMessage: ['watering the monstera', 'plant care time', 'stay green little guy'], cooldown: 30000 }
    case 'plant-2':
      return { walkTo: { x: 38.28, y: 27.63 }, effect: '/sprites/effects/watering-can.png', duration: 3000, chatMessage: ['watering the snake plant', 'hydration station', 'these leaves are looking good'], cooldown: 30000 }
    case 'plant-3':
      return { walkTo: { x: 8.97, y: 55.79 }, effect: '/sprites/effects/watering-can.png', duration: 3000, chatMessage: ['watering the money tree', 'grow baby grow', 'office jungle maintenance'], cooldown: 30000 }
    case 'plant-4':
      return { walkTo: { x: 83.73, y: 76.52 }, effect: '/sprites/effects/watering-can.png', duration: 3000, chatMessage: ['watering the plants', 'keeping the office green'], cooldown: 30000 }
    case 'plant-5':
      return { walkTo: { x: 83.73, y: 76.52 }, effect: '/sprites/effects/watering-can.png', duration: 3000, chatMessage: ['watering the monstera', 'this one is thriving'], cooldown: 30000 }

    // Coffee machine
    case 'coffee':
      return {
        walkTo: { x: 80.14, y: 39.32 },
        effect: '/sprites/effects/need-coffee.png',
        duration: 4000,
        chatMessage: ['brewing a fresh pot', 'coffee time!', 'fueling up', 'who else needs coffee?'],
        furnitureState: { id: 'coffee', state: 'on', revertAfter: 10000 },
        cooldown: 15000,
        sound: 'coffee',
      }

    // Filing cabinet
    case 'filing-1':
      return {
        walkTo: { x: 8.97, y: 77.58 },
        effect: '/sprites/effects/post-it.png',
        duration: 3000,
        chatMessage: ['проверяю документы', 'куда я положил этот отчёт…', 'проверяю картотеку', 'ищу отчёт за четвёртый квартал'],
        furnitureState: { id: 'filing-1', state: 'open', revertAfter: 8000 },
        cooldown: 10000,
      }

    // Printer
    case 'printer-1':
      return {
        walkTo: { x: 85.53, y: 39.32 },
        effect: '/sprites/effects/post-it.png',
        duration: 3000,
        chatMessage: ['printing something', 'please dont jam...', 'old faithful', 'who even prints anymore'],
        cooldown: 15000,
      }

    // Whiteboard / kanban board — use the board area
    case 'whiteboard':
      return {
        walkTo: { x: 52.03, y: 25.5 },
        effect: '/sprites/effects/post-it.png',
        duration: 4000,
        chatMessage: board ? boardChatLines(board) : ['updating the board', 'moving tickets to done', 'adding a post-it', 'sprint planning time'],
        cooldown: 20000,
      }

    // Background hotspots
    case 'fire-extinguisher':
      return { walkTo: { x: 6.88, y: 30.82 }, effect: '/sprites/effects/fire.png', duration: 3000, chatMessage: ['проверяю огнетушитель', 'безопасность прежде всего', 'срок годности в порядке', 'надеюсь, он не понадобится'], cooldown: 30000 }

    case 'water-cooler':
      return { walkTo: { x: 43.66, y: 23.38 }, effect: '/sprites/effects/glass-water.png', duration: 3000, chatMessage: ['filling up the bottle', 'hydration check', 'water break', 'staying hydrated'], cooldown: 10000 }

    case 'bell':
      return { walkTo: { x: 68.48, y: 18.07 }, effect: '/sprites/effects/star.png', duration: 2000, chatMessage: ['ding ding! standup time', 'ringing the bell', 'attention everyone!', 'all hands!'], cooldown: 20000, sound: 'bell' }

    case 'kanban-board':
      return {
        walkTo: { x: 52.03, y: 25.5 }, effect: '/sprites/effects/post-it.png', duration: 4000, cooldown: 15000,
        chatMessage: board ? boardChatLines(board) : ['updating the board', 'moving tickets to done', 'sprint looks good', 'who left this ticket in review?'],
      }

    case 'ship-it-poster':
      return { walkTo: { x: 8.37, y: 29.76 }, effect: '/sprites/effects/rocket.png', duration: 3000, chatMessage: ['ship it!', 'feeling motivated', 'that poster never gets old', 'lets gooo'], cooldown: 30000 }

    case 'tv-monitor':
      return { walkTo: { x: 80.14, y: 25.5 }, effect: '/sprites/effects/typing.png', duration: 3000, chatMessage: ['проверяю панель управления', 'все системы работают', 'слежу за показателями', 'время работы в норме'], cooldown: 15000 }

    default:
      return null
  }
}
