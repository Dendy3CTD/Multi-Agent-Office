import type { CollisionRect, Room } from './rooms'
import type { Position } from './types'

export interface NavigationPath {
  points: Position[]
  reachable: boolean
}

const GRID = 2

function insideObstacle(point: Position, obstacle: CollisionRect, radius: number, target?: Position): boolean {
  // A chair is occupied at the destination, so the final swept segment may
  // enter that one chair. Desks and cabinets remain solid all the way through.
  if (target && obstacle.kind === 'chair' &&
      target.x >= obstacle.x && target.x <= obstacle.x + obstacle.width &&
      target.y >= obstacle.y && target.y <= obstacle.y + obstacle.height) return false
  return point.x >= obstacle.x - radius && point.x <= obstacle.x + obstacle.width + radius &&
    point.y >= obstacle.y - radius && point.y <= obstacle.y + obstacle.height + radius
}

export function isWalkable(room: Room, point: Position, target?: Position): boolean {
  const area = room.walkableArea
  if (!area || area.length < 3) return false
  const minX = Math.min(...area.map(p => p.x))
  const maxX = Math.max(...area.map(p => p.x))
  const minY = Math.min(...area.map(p => p.y))
  const maxY = Math.max(...area.map(p => p.y))
  if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) return false
  const targetChair = target && (room.obstacles ?? []).find(obstacle =>
    obstacle.kind === 'chair' &&
    target.x >= obstacle.x && target.x <= obstacle.x + obstacle.width &&
    target.y >= obstacle.y && target.y <= obstacle.y + obstacle.height,
  )
  return !(room.obstacles ?? []).some(obstacle => {
    // The visual chair overlaps the desk's projected footprint. Once the
    // destination is that chair, the final samples inside its seat are valid
    // even though the desk rectangle remains solid everywhere else.
    if (targetChair && point.x >= targetChair.x && point.x <= targetChair.x + targetChair.width &&
        point.y >= targetChair.y && point.y <= targetChair.y + targetChair.height) return false
    return insideObstacle(point, obstacle, room.agentRadius ?? 2, target)
  })
}

/** Swept-footprint check used both by A* and by every animation tick. */
export function segmentIsClear(room: Room, from: Position, to: Position, allowTarget = false): boolean {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const samples = Math.max(1, Math.ceil(distance / 0.8))
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
    if (!isWalkable(room, point, allowTarget ? to : undefined)) return false
  }
  return true
}

function key(x: number, y: number): string { return `${x}:${y}` }

function gridPoint(x: number, y: number): Position { return { x: x * GRID, y: y * GRID } }

/** A small 8-neighbour A* router. Diagonal corner cutting is explicitly disallowed. */
export function findOfficePath(room: Room, from: Position, to: Position): NavigationPath {
  if (segmentIsClear(room, from, to, true)) return { points: [], reachable: true }

  // Chairs are destinations, not walkable floor. Route to a free approach
  // point first, then allow only the final swept segment to enter the chair.
  // This matters for the lower workstations where the desk footprint touches
  // the back of the chair and a rounded A* goal otherwise has no neighbour.
  const targetChair = (room.obstacles ?? []).find(obstacle =>
    obstacle.kind === 'chair' &&
    to.x >= obstacle.x && to.x <= obstacle.x + obstacle.width &&
    to.y >= obstacle.y && to.y <= obstacle.y + obstacle.height,
  )
  if (targetChair) {
    const radius = room.agentRadius ?? 2
    const approaches: Position[] = [
      { x: targetChair.x + targetChair.width / 2, y: targetChair.y + targetChair.height + radius + 0.8 },
      { x: targetChair.x - radius - 0.8, y: targetChair.y + targetChair.height / 2 },
      { x: targetChair.x + targetChair.width + radius + 0.8, y: targetChair.y + targetChair.height / 2 },
    ]
    for (const approach of approaches) {
      if (!isWalkable(room, approach) || !segmentIsClear(room, approach, to, true)) continue
      if (segmentIsClear(room, from, approach)) return { points: [{ ...approach }, { ...to }], reachable: true }
      const route = findOfficePath(room, from, approach)
      if (route.reachable) return { points: [...route.points, { ...to }], reachable: true }
    }
  }

  const area = room.walkableArea ?? []
  const minX = Math.floor(Math.min(...area.map(p => p.x)) / GRID)
  const maxX = Math.ceil(Math.max(...area.map(p => p.x)) / GRID)
  const minY = Math.floor(Math.min(...area.map(p => p.y)) / GRID)
  const maxY = Math.ceil(Math.max(...area.map(p => p.y)) / GRID)
  const start = { x: Math.round(from.x / GRID), y: Math.round(from.y / GRID) }
  const goal = { x: Math.round(to.x / GRID), y: Math.round(to.y / GRID) }
  const open = [{ x: start.x, y: start.y, f: 0 }]
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>([[key(start.x, start.y), 0]])
  const h = (x: number, y: number) => Math.hypot(x - goal.x, y - goal.y)
  const directions = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => ({ dx, dy }))).filter(d => d.dx || d.dy)

  while (open.length) {
    open.sort((a, b) => a.f - b.f)
    const current = open.shift()!
    if (current.x === goal.x && current.y === goal.y) {
      const cells = [{ x: current.x, y: current.y }]
      let cursor = key(current.x, current.y)
      while (cameFrom.has(cursor)) {
        const previous = cameFrom.get(cursor)!
        const [x, y] = previous.split(':').map(Number)
        cells.unshift({ x, y })
        cursor = previous
      }
      const points = cells.slice(1).map(cell => gridPoint(cell.x, cell.y))
      points.push({ ...to })
      return { points: points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0.2), reachable: true }
    }
    const currentKey = key(current.x, current.y)
    const currentG = gScore.get(currentKey) ?? Infinity
    for (const direction of directions) {
      const nx = current.x + direction.dx
      const ny = current.y + direction.dy
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue
      const next = gridPoint(nx, ny)
      const isGoal = nx === goal.x && ny === goal.y
      if (!isWalkable(room, next, isGoal ? to : undefined)) continue
      if (direction.dx && direction.dy) {
        if (!isWalkable(room, gridPoint(current.x + direction.dx, current.y)) || !isWalkable(room, gridPoint(current.x, current.y + direction.dy))) continue
      }
      // Cells are already inflated by the character radius. The two
      // orthogonal checks above make diagonal transitions corner-safe; the
      // final real segment is swept-tested again by the reducer.
      const nextKey = key(nx, ny)
      const tentative = currentG + Math.hypot(direction.dx, direction.dy)
      if (tentative >= (gScore.get(nextKey) ?? Infinity)) continue
      cameFrom.set(nextKey, currentKey)
      gScore.set(nextKey, tentative)
      open.push({ x: nx, y: ny, f: tentative + h(nx, ny) })
    }
  }

  // Visibility-graph fallback for narrow isometric aisles where a rounded
  // grid goal can sit just inside a chair footprint. It still uses the same
  // swept segment predicate, so it cannot introduce a furniture crossing.
  const radius = room.agentRadius ?? 2
  const candidates: Position[] = [
    { x: minX * GRID, y: minY * GRID }, { x: maxX * GRID, y: minY * GRID },
    { x: minX * GRID, y: maxY * GRID }, { x: maxX * GRID, y: maxY * GRID },
    // The original room has a narrow but intentional cross-aisle at the door.
    { x: 78, y: 49 }, { x: 60, y: 49 }, { x: 50, y: 49 },
    ...(room.obstacles ?? []).flatMap(obstacle => [
      { x: obstacle.x - radius - 0.8, y: obstacle.y - radius - 0.8 },
      { x: obstacle.x + obstacle.width + radius + 0.8, y: obstacle.y - radius - 0.8 },
      { x: obstacle.x - radius - 0.8, y: obstacle.y + obstacle.height + radius + 0.8 },
      { x: obstacle.x + obstacle.width + radius + 0.8, y: obstacle.y + obstacle.height + radius + 0.8 },
    ]),
  ].filter(point => isWalkable(room, point))
  const nodes = [from, ...candidates, to]
  const distances = new Map<number, number>([[0, 0]])
  const previous = new Map<number, number>()
  const visited = new Set<number>()
  while (distances.size) {
    let current = -1
    let best = Infinity
    for (const [index, distance] of distances) if (!visited.has(index) && distance < best) { current = index; best = distance }
    if (current < 0) break
    visited.add(current)
    if (current === nodes.length - 1) {
      const indices = [current]
      while (previous.has(indices[0])) indices.unshift(previous.get(indices[0])!)
      return { points: indices.slice(1).map(index => nodes[index]), reachable: true }
    }
    for (let next = 1; next < nodes.length; next++) {
      if (visited.has(next)) continue
      const target = next === nodes.length - 1
      if (!segmentIsClear(room, nodes[current], nodes[next], target)) continue
      const distance = best + Math.hypot(nodes[current].x - nodes[next].x, nodes[current].y - nodes[next].y)
      if (distance < (distances.get(next) ?? Infinity)) { distances.set(next, distance); previous.set(next, current) }
    }
  }
  return { points: [], reachable: false }
}
