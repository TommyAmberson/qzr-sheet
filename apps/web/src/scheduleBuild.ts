import type { SeatInput } from './api'
import type { Cell } from './scheduleAlloc'
import type { Row } from './scheduleSort'

/**
 * Build the per-cell quiz definitions that Populate will hand to the
 * API. Two phases:
 *
 * * **Prelims** — zip cells (in row-major order from the allocator)
 *   with rule-book rows (already lateness-sorted by `scheduleSort`).
 *   Label = `D{div}-Q{cellIndex+1}`, seats = the row's three letters.
 *
 * * **Elims** — cells only; no rule-book input. Label =
 *   `D{div}-Q{LETTER}` (A, B, C, …) since elim slots are bracket
 *   positions, not ordered rounds. Seats are placeholder `A/B/C`
 *   letters until seed refs resolve.
 *
 * Both return plain quiz definitions; the caller is responsible for
 * actually creating them in the API.
 */

export interface QuizDef {
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  label: string
  seats: SeatInput[]
}

/** Build prelim quiz definitions for a division. Trailing cells with
 *  no row are dropped (occurs only when cells.length > rows.length,
 *  which means the division has unused capacity). */
export function buildPrelimPlan(
  division: string,
  cells: ReadonlyArray<Cell>,
  rows: ReadonlyArray<Row>,
): QuizDef[] {
  const out: QuizDef[] = []
  const n = Math.min(cells.length, rows.length)
  for (let i = 0; i < n; i++) {
    const cell = cells[i]!
    const row = rows[i]!
    out.push({
      slotId: cell.slotId,
      roomId: cell.roomId,
      division,
      phase: 'prelim',
      label: `D${division}-Q${i + 1}`,
      seats: [
        { seatNumber: 1, letter: row[0] },
        { seatNumber: 2, letter: row[1] },
        { seatNumber: 3, letter: row[2] },
      ],
    })
  }
  return out
}

/** Build elim quiz definitions for a division. No rule-book rows —
 *  labels are letters (QA, QB, QC, …) and seats are placeholder
 *  A/B/C until seed refs resolve in the elim builder. */
export function buildElimPlan(division: string, cells: ReadonlyArray<Cell>): QuizDef[] {
  return cells.map((cell, i) => ({
    slotId: cell.slotId,
    roomId: cell.roomId,
    division,
    phase: 'elim',
    label: `D${division}-Q${String.fromCharCode(65 + i)}`,
    seats: [
      { seatNumber: 1, letter: 'A' },
      { seatNumber: 2, letter: 'B' },
      { seatNumber: 3, letter: 'C' },
    ],
  }))
}
