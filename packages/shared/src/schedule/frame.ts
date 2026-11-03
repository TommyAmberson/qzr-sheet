import type { FrameRow, ScheduleSettings } from './scheduleFile'

/** How many slots a frame needs: prelim rounds, elim rounds, and Finals one after another */
export interface FrameShape {
  prelimSlots: number
  elimSlots: number
  finalsSlots: number
}

/** The frame a schedule with no team counts starts from (FR-010) */
export const DEFAULT_SHAPE: FrameShape = { prelimSlots: 8, elimSlots: 9, finalsSlots: 3 }

const h = (hours: number, minutes = 0) => hours * 60 + minutes

/** Friday evening holds at most this many prelim rounds; the rest are Saturday morning */
const FRIDAY_ROUNDS = 5

/**
 * The rows of a preset's frame (FR-015), with as many slots as `shape` asks for. Events sit where
 * the org's meets put them; slots never overlap an event, and Finals start no earlier than
 * mid-afternoon, `finalsSpacing` minutes apart.
 */
export function buildFrame(
  preset: ScheduleSettings['framePreset'],
  slotMinutes: number,
  shape: FrameShape,
  finalsSpacing = 30,
): FrameRow[] {
  const rows: FrameRow[] = []
  // Ids follow what a row is for, not where it sits, so a quiz pinned to the 3rd elim slot keeps it
  // when the frame is rebuilt around it
  const count = new Map<string, number>()
  const next = (key: string) => {
    const n = count.get(key) ?? 0
    count.set(key, n + 1)
    return `${key}-${n}`
  }
  let use: 'prelim' | 'elim' | 'finals' = 'prelim'
  const day = (label: string) => rows.push({ kind: 'day', id: next(`day-${label}`), label })
  const event = (at: number, minutes: number, label: string) =>
    rows.push({ kind: 'event', id: next(`event-${label}`), at, minutes, label })
  const slot = (at: number, minutes = slotMinutes) =>
    rows.push({ kind: 'slot', id: next(use), at, minutes, use })

  /** Slots from `start` up to `count`, stopping before `until`; returns where it stopped and how many fit */
  const fill = (start: number, count: number, until = Infinity) => {
    let at = start
    let placed = 0
    while (placed < count && at + slotMinutes <= until) {
      slot(at)
      at += slotMinutes
      placed++
    }
    return { at, placed }
  }

  const finals = (start: number) => {
    use = 'finals'
    let at = Math.max(start, h(15, 15))
    for (let i = 0; i < shape.finalsSlots; i++) {
      slot(at)
      at += finalsSpacing
    }
    return shape.finalsSlots > 0 ? at - finalsSpacing + slotMinutes : start
  }

  /** Elims around Lunch at noon; returns when they end */
  const elimsAroundLunch = (start: number, count: number) => {
    const morning = fill(start, count, h(12))
    const lunch = Math.max(h(12), morning.at)
    event(lunch, 60, 'Lunch')
    return fill(lunch + 60, count - morning.placed).at
  }

  if (preset === 'oneDay') {
    day('Saturday')
    event(h(9, 30), 30, 'Assembly')
    const morning = fill(h(10), shape.prelimSlots, h(12))
    event(Math.max(h(12), morning.at), 60, 'Lunch')
    let at = fill(Math.max(h(12), morning.at) + 60, shape.prelimSlots - morning.placed).at
    use = 'elim'
    at = fill(at, shape.elimSlots).at
    finals(at)
    return rows
  }

  day('Friday')
  event(h(19), 30, 'Registration')
  event(h(19, 30), 30, 'Assembly')
  const friday = Math.min(shape.prelimSlots, FRIDAY_ROUNDS)
  fill(h(20), friday)

  day('Saturday')
  event(h(8), 60, 'Breakfast')
  let at = fill(h(9), shape.prelimSlots - friday).at
  if (shape.prelimSlots > friday) {
    event(at, 25, 'Stats break')
    at += 25
  }
  use = 'elim'
  const end = finals(elimsAroundLunch(at, shape.elimSlots))
  const supper = Math.max(h(17), end)
  event(supper, 60, 'Supper')
  event(supper + 60, 105, 'Social activities')
  event(Math.max(h(20), supper + 165), 60, 'Worship and awards')

  day('Sunday')
  event(h(11), 60, 'Worship service')
  event(h(12), 60, 'Lunch')
  return rows
}

/** The fewest rooms, at least 3, that fit every prelim quiz in the prelim slots (FR-018) */
export function defaultRoomCount(prelimQuizzes: number, prelimSlots: number): number {
  return Math.max(3, Math.ceil(prelimQuizzes / Math.max(1, prelimSlots)))
}

/**
 * The cells one-room events take (H-3), as `slot|room`: each slot on the event's own day whose
 * time overlaps it, in the event's room
 */
export function eventCells(frame: FrameRow[]): Set<string> {
  const cells = new Set<string>()
  const dayOf = new Map<string, number>()
  let day = 0
  for (const row of frame) {
    if (row.kind === 'day') day++
    dayOf.set(row.id, day)
  }
  for (const row of frame) {
    if (row.kind !== 'event' || !row.room) continue
    for (const s of frame) {
      if (
        s.kind === 'slot' &&
        dayOf.get(s.id) === dayOf.get(row.id) &&
        row.at < s.at + s.minutes &&
        s.at < row.at + row.minutes
      ) {
        cells.add(`${s.id}|${row.room}`)
      }
    }
  }
  return cells
}
