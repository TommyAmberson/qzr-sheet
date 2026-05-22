/**
 * Shared schedule-grid types and helpers used by the read-only viewer
 * (apps/web) and the scoresheet picker (apps/scoresheet).
 *
 * Types are intentionally structural — both apps' API types satisfy
 * these without an explicit import, so neither needs to depend on the
 * other's `api.ts`.
 */

export interface ScheduleRoom {
  id: number
  name: string
  sortOrder: number
}

export interface ScheduleSlot {
  id: number
  startAt: string
  durationMinutes: number
  kind: 'quiz' | 'event'
  eventLabel?: string | null
  sortOrder: number
}

export interface ScheduledSeat {
  id: number
  seatNumber: number
  letter: string | null
  seedRef: string | null
}

export interface ScheduledQuiz {
  id: number
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  label: string
  seats: ScheduledSeat[]
}

export interface PrelimAssignmentRow {
  division: string
  letter: string
  teamId: number
}

export interface MeetTeamRow {
  id: number
  churchShortName: string
  number: number
}

/** Reserved event-label that marks the schedule's prelim/elim divider. */
export const STATS_BREAK_LABEL = 'Stats break'

export function isStatsBreak(slot: ScheduleSlot): boolean {
  return slot.kind === 'event' && slot.eventLabel === STATS_BREAK_LABEL
}

export interface GridRow<Q extends ScheduledQuiz, S extends ScheduleSlot> {
  slot: S
  /** Quiz at each room column (same order as `Grid.rooms`). null = empty cell.
   *  Always empty for event slots — the renderer spans those across columns. */
  cells: (Q | null)[]
}

export interface Grid<Q extends ScheduledQuiz, S extends ScheduleSlot, R extends ScheduleRoom> {
  rooms: R[]
  rows: GridRow<Q, S>[]
}

/**
 * Build the schedule grid: rooms sorted by sortOrder then id (column order),
 * slots sorted by sortOrder then id (row order), each quiz placed at its
 * (slot, room) cell. `divisionFilter` drops off-division quizzes to null
 * cells but keeps every slot row so empty rooms are still visible.
 */
export function buildGrid<R extends ScheduleRoom, S extends ScheduleSlot, Q extends ScheduledQuiz>(
  rooms: R[],
  slots: S[],
  quizzes: Q[],
  divisionFilter: string | null,
): Grid<Q, S, R> {
  const sortedRooms = [...rooms].sort(bySortOrder)
  const sortedSlots = [...slots].sort(bySortOrder)

  const byCell = new Map<number, Map<number, Q>>()
  for (const q of quizzes) {
    if (divisionFilter !== null && q.division !== divisionFilter) continue
    let perSlot = byCell.get(q.slotId)
    if (!perSlot) {
      perSlot = new Map()
      byCell.set(q.slotId, perSlot)
    }
    perSlot.set(q.roomId, q)
  }

  const rows: GridRow<Q, S>[] = sortedSlots.map((slot) => {
    if (slot.kind === 'event') return { slot, cells: [] }
    const perSlot = byCell.get(slot.id)
    return {
      slot,
      cells: sortedRooms.map((r) => perSlot?.get(r.id) ?? null),
    }
  })

  return { rooms: sortedRooms, rows }
}

export function hasAnyQuiz<Q extends ScheduledQuiz, S extends ScheduleSlot, R extends ScheduleRoom>(
  grid: Grid<Q, S, R>,
): boolean {
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
export function seatRef(seat: ScheduledSeat): string {
  return seat.letter ?? seat.seedRef ?? ''
}

/** Seats ordered by seatNumber. Server doesn't guarantee order. */
export function sortedSeats(seats: ReadonlyArray<ScheduledSeat>): ScheduledSeat[] {
  return [...seats].sort((a, b) => a.seatNumber - b.seatNumber)
}

/** Resolved team name for a seat: looks up the seat's letter in the
 *  prelim assignments table, then renders the matching team's
 *  `{shortName} {number}`. Returns `—` until Roll Teams has run for
 *  this division (or for elim seats, which seed lazily via seedRefs). */
export function seatTeam(
  seat: ScheduledSeat,
  ctx: {
    division: string
    assignments: ReadonlyArray<PrelimAssignmentRow>
    teams: ReadonlyArray<MeetTeamRow>
  },
): string {
  if (!seat.letter) return '—'
  const a = ctx.assignments.find((x) => x.division === ctx.division && x.letter === seat.letter)
  if (!a) return '—'
  const t = ctx.teams.find((tm) => tm.id === a.teamId)
  if (!t) return '—'
  return `${t.churchShortName} ${t.number}`
}

interface DayLabelInput {
  startAt: string
}

export interface DayGroup<Q extends ScheduledQuiz, S extends ScheduleSlot> {
  dateKey: string
  label: string
  rows: GridRow<Q, S>[]
}

/** Group grid rows by their slot's local date so the template can break
 *  the schedule into "Friday, May 15 / Saturday, May 16 / …" sections. */
export function groupRowsByDay<Q extends ScheduledQuiz, S extends ScheduleSlot & DayLabelInput>(
  rows: GridRow<Q, S>[],
): DayGroup<Q, S>[] {
  const map = new Map<string, DayGroup<Q, S>>()
  for (const row of rows) {
    const d = new Date(row.slot.startAt)
    if (Number.isNaN(d.getTime())) continue
    const key = dateKey(d)
    let group = map.get(key)
    if (!group) {
      group = { dateKey: key, label: dayLabel(d), rows: [] }
      map.set(key, group)
    }
    group.rows.push(row)
  }
  return Array.from(map.values())
}

function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}
