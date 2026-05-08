import type { MeetRoom, MeetSlot, ScheduledQuiz } from './api'

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
  const sortedRooms = [...rooms].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  const sortedSlots = [...slots].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

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
