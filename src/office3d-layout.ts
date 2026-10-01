import type { OfficeStation } from './types.ts'

// Layout of the 3D office (world units ≈ metres, y up, +z towards the street).
// Kept apart from the scene so it can be tested. The office adapts to the crew: there is one
// unlabeled desk per agent (hot desking), and the building grows to the left to fit them.
//
//   z -5 ┌──────────── back wall ────────────┬────┬───────────┐
//   gang │ desks (one per agent, two rows,   │ lounge │ game room │
//  bakso │  growing to the left)             │(TV,sofa)│          │
//   kopi │ meeting table                     │  pantry ├──────────┘
//   z  4 └── low front wall ─── entrance ───────────┘
//        sidewalk · flag      (street food sits in the gang left of the building)
//        road

export type Vec3 = [number, number, number]

/** Glass wall between the workspace and the lounge (back part, up to LOUNGE_PARTITION_END_Z). */
export const PARTITION_X = 0.4
export const LOUNGE_PARTITION_END_Z = -0.5
/** Game room wing right of the building, entered through a door in the lounge wall. */
export const GAME_ROOM = { minX: 9.5, maxX: 15.5, minZ: -5.2, maxZ: 0.6 }
/** Walking line from the lounge lane through the game room door, and the door's extent. */
export const GAME_LANE_Z = -3.7
export const GAME_DOOR = { fromZ: -4.4, toZ: -3.0 }
export const PING_PONG: Vec3 = [12.6, 0, -1.4]
export const ARCADES: Vec3[] = [[10.6, 0, -4.75], [11.6, 0, -4.75]]
export const GAME_TV: Vec3 = [14.2, 0, -5.05]
export const BEANBAGS: Vec3[] = [[13.7, 0, -4.35], [14.7, 0, -4.35]]
export const CARROM: Vec3 = [10.6, 0, -0.1]

/** Walkway in front of the desks; agents walk along it between areas instead of through furniture. */
export const AISLE_Z = 0.4
export const MEETING_TABLE: Vec3 = [-5.2, 0, 2.2]
/** The TV hangs on the back wall; the sofa faces it (backrest towards the aisle). */
export const TV: Vec3 = [4.6, 0, -4.8]
export const SOFA: Vec3 = [4.6, 0, -1.3]
export const LOUNGE_SEATS: Vec3[] = [[4, 0, -1.8], [2.5, 0, -2.9], [6.7, 0, -2.9]]
const LOUNGE_FACING = [Math.PI, Math.PI / 2, -Math.PI / 2]
export const COFFEE_TABLE: Vec3 = [4.6, 0, -2.9]
/** Gap in the low front wall, and the walking line along the sidewalk just outside it. */
export const ENTRANCE_X = 5.8
export const SIDEWALK_Z = 5.4
/** Lounge agents step to this lane first, so they pass between the armchair and the TV. */
export const LOUNGE_LANE_X = 3.1
export const STALL_ROTATION = Math.PI / 2
/** The flag stands at the front-right corner of the grounds, clear of the rooms in view. */
export const FLAG: Vec3 = [16.4, 0, 2.6]

/** Hot desking: one unlabeled desk per agent, in two rows that grow to the left. */
const DESK_RIGHT_X = -2
const DESK_PITCH = 2.6
const DESK_ROWS_Z = [-3.5, -1]
const MIN_DESK_COLUMNS = 3
/** The stock building (up to six agents) and the scene width the camera is framed for. */
const BASE_MIN_X = -9.5
const BASE_SCENE_WIDTH = 28.7
const CAMERA_OFFSET_BASE: Vec3 = [-3.9, 15.2, 18.8]

export interface Placement { position: Vec3; facing: number; seated: boolean; label?: string }
export interface IdleStop { key: string; label: string; spots: Placement[] }

export interface OfficeLayout {
  deskCount: number
  building: { minX: number; maxX: number; minZ: number; maxZ: number }
  desks: Vec3[]
  /** Walking line up the gang (alley) along the left outside wall, between the wall and the carts. */
  sideLaneX: number
  /** Street food parks in the gang, turned so its stools and customers face the building. */
  baksoCart: Vec3
  kopiBike: Vec3
  gangCenterX: number
  camera: { target: Vec3; offset: Vec3 }
  /** How far the view may be panned (camera target bounds), so the office never leaves the screen. */
  pan: { minX: number; maxX: number; minZ: number; maxZ: number }
  idleStops: IdleStop[]
}

const spot = (x: number, z: number, facing: number, seated = false, label?: string): Placement => ({ position: [x, 0, z], facing, seated, ...(label ? { label } : {}) })
/** A spot given in a stall's own coordinates (as if unrotated), placed in the world. */
function stallSpot(stall: Vec3, x: number, z: number, facing: number, seated = false): Placement {
  const cos = Math.cos(STALL_ROTATION)
  const sin = Math.sin(STALL_ROTATION)
  return spot(stall[0] + x * cos + z * sin, stall[2] - x * sin + z * cos, facing + STALL_ROTATION, seated)
}

/**
 * Where idle agents spend their time. Each stop has a few spots; idlePlan spreads agents so that
 * no two share a spot while free ones remain.
 */
function idleStops(building: OfficeLayout['building'], baksoCart: Vec3, kopiBike: Vec3): IdleStop[] {
  return [
    { key: 'lounge', label: 'Relaxing in the lounge', spots: LOUNGE_SEATS.map(([x, , z], index) => spot(x, z, LOUNGE_FACING[index], true)) },
    { key: 'galon', label: 'Getting water from the galon', spots: [spot(8.35, -0.4, Math.PI / 2), spot(8.2, -1.05, 2.2), spot(8.2, 0.3, 1.1)] },
    // On the gerobak's plastic stools, facing the cart.
    { key: 'bakso', label: 'Eating bakso', spots: [stallSpot(baksoCart, 0.5, 1.1, Math.PI, true), stallSpot(baksoCart, -0.3, 1.2, Math.PI, true), stallSpot(baksoCart, 1.3, 0.9, -2.4)] },
    { key: 'dapur', label: 'In the kitchen', spots: [spot(8.25, 2.6, Math.PI / 2), spot(8.3, 0.65, Math.PI / 2), spot(8.25, 3.3, Math.PI / 2)] },
    { key: 'kopi', label: 'Coffee at the kopi bike', spots: [stallSpot(kopiBike, -0.5, 0.85, Math.PI), stallSpot(kopiBike, 0.5, 0.85, Math.PI), stallSpot(kopiBike, 1.45, 0.3, -Math.PI / 2)] },
    { key: 'game', label: 'Playing ping-pong', spots: [spot(PING_PONG[0] - 1.75, PING_PONG[2], Math.PI / 2), spot(PING_PONG[0] + 1.75, PING_PONG[2], -Math.PI / 2), spot(BEANBAGS[0][0], BEANBAGS[0][2], Math.PI, true, 'Gaming on the console')] },
    { key: 'arcade', label: 'Playing arcade games', spots: [spot(ARCADES[0][0], ARCADES[0][2] + 0.8, Math.PI), spot(ARCADES[1][0], ARCADES[1][2] + 0.8, Math.PI), spot(BEANBAGS[1][0], BEANBAGS[1][2], Math.PI, true, 'Gaming on the console')] },
    { key: 'jalan', label: 'Taking a stroll', spots: [spot(FLAG[0] - 0.8, FLAG[2] + 0.3, Math.PI / 2), spot(building.minX + 0.95, -0.9, -Math.PI / 2), spot(1.3, -4.4, Math.PI)] },
  ]
}

/** The office for a given number of agents: one desk each, and a building wide enough for them. */
export function createLayout(agentCount: number): OfficeLayout {
  const deskCount = Math.max(1, agentCount)
  const columns = Math.max(MIN_DESK_COLUMNS, Math.ceil(deskCount / DESK_ROWS_Z.length))
  // The back row fills first (right to left), then the front row.
  const desks: Vec3[] = Array.from({ length: deskCount }, (_, index) => {
    const row = index < columns ? 0 : 1
    const column = row === 0 ? index : index - columns
    return [DESK_RIGHT_X - column * DESK_PITCH, 0, DESK_ROWS_Z[row]]
  })
  const minX = DESK_RIGHT_X - (columns - 1) * DESK_PITCH - 2.3
  const shift = minX - BASE_MIN_X
  const building = { minX, maxX: 9.5, minZ: -5.2, maxZ: 4.2 }
  const baksoCart: Vec3 = [-11.9 + shift, 0, -2.3]
  const kopiBike: Vec3 = [-11.9 + shift, 0, 1.6]
  const sceneMinX = minX - 3.7
  const scale = (GAME_ROOM.maxX - sceneMinX) / BASE_SCENE_WIDTH
  return {
    deskCount, building, desks, baksoCart, kopiBike,
    sideLaneX: -10.15 + shift,
    gangCenterX: -11.4 + shift,
    camera: { target: [(sceneMinX + GAME_ROOM.maxX) / 2 - 0.15, 0.6, 0.2], offset: CAMERA_OFFSET_BASE.map((value) => value * scale) as Vec3 },
    pan: { minX: sceneMinX - 0.3, maxX: 17, minZ: -7, maxZ: 11 },
    idleStops: idleStops(building, baksoCart, kopiBike),
  }
}

const MEETING_RINGS = [
  { radius: 1.4, angles: [Math.PI, 2 * Math.PI, 1.5 * Math.PI, 1.25 * Math.PI, 1.75 * Math.PI] },
  { radius: 2.1, angles: [1.2 * Math.PI, 1.8 * Math.PI, 1.5 * Math.PI, 1.35 * Math.PI, 1.65 * Math.PI] },
]

/** The n-th place at the meeting table (0-based), all on the aisle side so paths never cross it. */
export function meetingSeat(index: number): Placement {
  const slots = MEETING_RINGS.flatMap((ring) => ring.angles.map((angle) => ({ radius: ring.radius, angle })))
  const { radius, angle } = slots[index % slots.length]
  const x = MEETING_TABLE[0] + radius * Math.cos(angle)
  const z = MEETING_TABLE[2] + radius * Math.sin(angle)
  return { position: [x, 0, z], facing: Math.atan2(MEETING_TABLE[0] - x, MEETING_TABLE[2] - z), seated: false }
}

/**
 * Where a station stands: a desk (seat n uses desk n; desks have no names), a place at the
 * meeting table (`meetingIndex` counts the agents already there), or a lounge seat.
 */
export function placementFor(station: OfficeStation, layout: OfficeLayout = DEFAULT_LAYOUT, meetingIndex = 0): Placement {
  const seat = Math.max(station.seat, 1) - 1
  // CLI tools are a stationary computer station: always at the desk, never in a room or meeting.
  if (station.isTool) {
    const [x, y, z] = layout.desks[seat % layout.desks.length]
    return { position: [x, y, z - 0.75], facing: 0, seated: true }
  }
  if (station.room === 'Lounge') {
    const [x, y, z] = LOUNGE_SEATS[seat % LOUNGE_SEATS.length]
    return { position: [x, y, z], facing: LOUNGE_FACING[seat % LOUNGE_SEATS.length], seated: true }
  }
  if (station.roomPosition === 'meeting-area') return meetingSeat(meetingIndex)
  const [x, y, z] = layout.desks[seat % layout.desks.length]
  return { position: [x, y, z - 0.75], facing: 0, seated: station.state === 'Working' || station.state === 'Reviewing' }
}

const inGameRoom = ([x, z]: [number, number]) => x > GAME_ROOM.minX && x < GAME_ROOM.maxX && z > GAME_ROOM.minZ && z < GAME_ROOM.maxZ
const inLounge = ([x, z]: [number, number]) => x > 1.5 && x < 7.8 && z < -0.6

/**
 * Waypoints from one spot to another, so agents walk around furniture instead of through it:
 * inside along the aisle (lounge spots via the lounge lane), in or out through the entrance,
 * along the sidewalk, and up the gang's lane to the street food. The last point is always the
 * destination.
 */
export function walkPath(from: [number, number], to: [number, number], layout: OfficeLayout = DEFAULT_LAYOUT): [number, number][] {
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 0.3) return [to]
  const { building, sideLaneX } = layout
  const outside = (point: [number, number]) => point[1] > building.maxZ || point[0] < building.minX || (point[0] > building.maxX && !inGameRoom(point))
  const inGang = ([x]: [number, number]) => x < building.minX
  const route: [number, number][] = [from]
  const toAisle = (point: [number, number]): [number, number][] => inGameRoom(point) ? [[point[0], GAME_LANE_Z], [LOUNGE_LANE_X, GAME_LANE_Z], [LOUNGE_LANE_X, AISLE_Z]]
    : inLounge(point) ? [[LOUNGE_LANE_X, point[1]], [LOUNGE_LANE_X, AISLE_Z]] : [[point[0], AISLE_Z]]
  const toSidewalk = (point: [number, number]): [number, number][] => inGang(point) ? [[sideLaneX, point[1]], [sideLaneX, SIDEWALK_Z]] : [[point[0], SIDEWALK_Z]]
  if (!outside(from) && !outside(to)) {
    route.push(...toAisle(from), ...toAisle(to).reverse())
  } else if (inGang(from) && inGang(to)) {
    route.push([sideLaneX, from[1]], [sideLaneX, to[1]])
  } else if (outside(from) && outside(to)) {
    route.push(...toSidewalk(from), ...toSidewalk(to).reverse())
  } else if (outside(to)) {
    route.push(...toAisle(from), [ENTRANCE_X, AISLE_Z], [ENTRANCE_X, SIDEWALK_Z], ...toSidewalk(to).reverse())
  } else {
    route.push(...toSidewalk(from), [ENTRANCE_X, SIDEWALK_Z], [ENTRANCE_X, AISLE_Z], ...toAisle(to).reverse())
  }
  route.push(to)
  // Drop waypoints that do not move the agent somewhere new, then any middle point of three on
  // one straight line (so going out to the aisle and straight back becomes one straight walk).
  const points: [number, number][] = [from]
  for (const point of route.slice(1)) {
    const last = points[points.length - 1]
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.2) points.push(point)
  }
  const aligned = (a: [number, number], b: [number, number], c: [number, number]) => (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c[0]) < 0.01) || (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c[1]) < 0.01)
  for (let index = 1; index < points.length - 1;) {
    if (aligned(points[index - 1], points[index], points[index + 1])) points.splice(index, 1)
    else index += 1
  }
  const path = points.slice(1)
  if (path.length === 0 || path[path.length - 1] !== to) path.push(to)
  return path
}

/** How long an idle agent stays at one stop (walking included). */
export const IDLE_STOP_MS = 32_000
export const IDLE_ROUTE = ['lounge', 'galon', 'game', 'bakso', 'jalan', 'arcade', 'kopi', 'dapur', 'game', 'lounge']

export interface IdleAssignment { stop: IdleStop; placement: Placement }

/**
 * Where each idle agent is at a given time. Purely decorative and deterministic (only the clock
 * and the seats matter, never agent data): each seat starts at a different point of the route, and
 * an agent whose stop is already full moves on along the route, so nobody shares a spot while
 * free ones remain.
 */
export function idlePlan(seats: number[], time: number, layout: OfficeLayout = DEFAULT_LAYOUT): Map<number, IdleAssignment> {
  const plan = new Map<number, IdleAssignment>()
  const taken = new Map<string, number>()
  const step = Math.floor(time / IDLE_STOP_MS)
  const stopAt = (index: number) => layout.idleStops.find((item) => item.key === IDLE_ROUTE[index % IDLE_ROUTE.length])!
  for (const seat of [...seats].sort((a, b) => a - b)) {
    const start = step + (Math.max(seat, 1) - 1) * 3
    let stop = stopAt(start)
    for (let offset = 0; offset < IDLE_ROUTE.length; offset += 1) {
      const candidate = stopAt(start + offset)
      if ((taken.get(candidate.key) ?? 0) < candidate.spots.length) { stop = candidate; break }
    }
    const used = taken.get(stop.key) ?? 0
    taken.set(stop.key, used + 1)
    plan.set(seat, { stop, placement: stop.spots[used % stop.spots.length] })
  }
  return plan
}

/** One idle agent on its own. */
export function idleStop(seat: number, time: number, layout: OfficeLayout = DEFAULT_LAYOUT): IdleAssignment {
  return idlePlan([seat], time, layout).get(seat)!
}

/** Keeps a panned camera target inside the office grounds. */
export function clampTarget(x: number, z: number, bounds: OfficeLayout['pan'] = DEFAULT_LAYOUT.pan): [number, number] {
  return [Math.min(Math.max(x, bounds.minX), bounds.maxX), Math.min(Math.max(z, bounds.minZ), bounds.maxZ)]
}

/** The stock office (three agents), for callers that do not know the crew size. */
export const DEFAULT_LAYOUT = createLayout(3)
export const BUILDING = DEFAULT_LAYOUT.building
export const SIDE_LANE_X = DEFAULT_LAYOUT.sideLaneX
export const PAN_BOUNDS = DEFAULT_LAYOUT.pan
export const IDLE_STOPS = DEFAULT_LAYOUT.idleStops
export const DESKS = DEFAULT_LAYOUT.desks
