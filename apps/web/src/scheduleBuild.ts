import type { SeatInput } from './api'
import type { Cell } from './scheduleAlloc'
import { placeRowsInGrid, type Row } from './scheduleSort'

/**
 * Build the per-cell quiz definitions that Populate will hand to the
 * API. Two phases:
 *
 * * **Prelims** — feed the division's cells, the full rule-book row
 *   list, and the lateness mask into `placeRowsInGrid`. That single
 *   call sorts by lateness, places greedily to avoid letter conflicts,
 *   and returns the per-cell row assignment. Quiz numbers are then
 *   assigned sequentially per non-null cell.
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

/** Build prelim quiz definitions for a division. Pass an empty
 *  `lateLetters` set for the no-lateness Populate case; pass the
 *  division's late letters (from `prelim_assignments` × team
 *  lateness) for the Sort by Lateness case. */
export function buildPrelimPlan(
  division: string,
  cells: ReadonlyArray<Cell>,
  rows: ReadonlyArray<Row>,
  lateLetters: ReadonlySet<string>,
): QuizDef[] {
  const placement = placeRowsInGrid(cells, rows, lateLetters)
  const out: QuizDef[] = []
  let quizNum = 1
  for (let i = 0; i < cells.length; i++) {
    const row = placement[i]
    if (!row) continue
    const cell = cells[i]!
    out.push({
      slotId: cell.slotId,
      roomId: cell.roomId,
      division,
      phase: 'prelim',
      label: `D${division}-Q${quizNum}`,
      seats: [
        { seatNumber: 1, letter: row[0] },
        { seatNumber: 2, letter: row[1] },
        { seatNumber: 3, letter: row[2] },
      ],
    })
    quizNum++
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
