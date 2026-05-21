import type { MeetRoom, MeetSlot, ScheduledQuiz, ScheduledQuizSeat } from './api'

/** Reserved event-label that marks the schedule's prelim/elim divider.
 *  Stats break is required for Populate to know where prelim quizzes
 *  end and elim quizzes begin; Skeleton treats it as un-deletable
 *  without an extra confirmation. */
export const STATS_BREAK_LABEL = 'Stats break'

export function isStatsBreak(slot: MeetSlot): boolean {
  return slot.kind === 'event' && slot.eventLabel === STATS_BREAK_LABEL
}

export interface GridRow {
  slot: MeetSlot
  /** Quiz at each room column (same order as `Grid.rooms`). null = empty cell.
   *  Always empty for event slots — the renderer spans those across columns. */
  cells: (ScheduledQuiz | null)[]
}

export interface Grid {
  rooms: MeetRoom[]
  rows: GridRow[]
}

/**
 * Build the schedule grid: rooms sorted by sortOrder then id (column order),
 * slots sorted by sortOrder then id (row order), each quiz placed at its
 * (slot, room) cell. `divisionFilter` drops off-division quizzes to null
 * cells but keeps every slot row so empty rooms are still visible.
 */
export function buildGrid(
  rooms: MeetRoom[],
  slots: MeetSlot[],
  quizzes: ScheduledQuiz[],
  divisionFilter: string | null,
): Grid {
  const sortedRooms = [...rooms].sort(bySortOrder)
  const sortedSlots = [...slots].sort(bySortOrder)

  const byCell = new Map<number, Map<number, ScheduledQuiz>>()
  for (const q of quizzes) {
    if (divisionFilter !== null && q.division !== divisionFilter) continue
    let perSlot = byCell.get(q.slotId)
    if (!perSlot) {
      perSlot = new Map()
      byCell.set(q.slotId, perSlot)
    }
    perSlot.set(q.roomId, q)
  }

  const rows: GridRow[] = sortedSlots.map((slot) => {
    if (slot.kind === 'event') return { slot, cells: [] }
    const perSlot = byCell.get(slot.id)
    return {
      slot,
      cells: sortedRooms.map((r) => perSlot?.get(r.id) ?? null),
    }
  })

  return { rooms: sortedRooms, rows }
}

export function hasAnyQuiz(grid: Grid): boolean {
  return grid.rows.some((r) => r.cells.some((c) => c !== null))
}

/** "8:00 AM" — local-time hh:mm; `startAt` is an ISO string from the API. */
export function formatSlotTime(startAt: string): string {
  const d = new Date(startAt)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Comparator for sorting slots and rooms by their canonical position. */
export function bySortOrder<T extends { sortOrder: number; id: number }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder || a.id - b.id
}

/** Letter for prelim seats, seedRef for elim seats. The canonical seat
 *  identifier shown in letter mode. */
export function seatRef(seat: ScheduledQuizSeat): string {
  return seat.letter ?? seat.seedRef ?? ''
}

/** Seats ordered by seatNumber. Server doesn't guarantee order. */
export function sortedSeats(seats: ReadonlyArray<ScheduledQuizSeat>): ScheduledQuizSeat[] {
  return [...seats].sort((a, b) => a.seatNumber - b.seatNumber)
}

/** Resolved team name for a seat: looks up the seat's letter in the
 *  prelim assignments table, then renders the matching team's
 *  `{shortName} {number}`. Returns `—` until Roll Teams has run for
 *  this division (or for elim seats, which seed lazily via seedRefs).
 *
 *  Prelim assignments and the team list are passed in rather than
 *  imported, so this stays pure and consumers (V1 grid, V2 review)
 *  can both call it. */
export function seatTeam(
  seat: ScheduledQuizSeat,
  ctx: {
    division: string
    assignments: ReadonlyArray<{ division: string; letter: string; teamId: number }>
    teams: ReadonlyArray<{ id: number; churchShortName: string; number: number }>
  },
): string {
  if (!seat.letter) return '—'
  const a = ctx.assignments.find((x) => x.division === ctx.division && x.letter === seat.letter)
  if (!a) return '—'
  const t = ctx.teams.find((tm) => tm.id === a.teamId)
  if (!t) return '—'
  return `${t.churchShortName} ${t.number}`
}
