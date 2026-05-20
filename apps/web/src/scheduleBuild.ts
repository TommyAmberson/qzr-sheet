import type { SeatInput } from './api'
import type { Cell } from './scheduleAlloc'

/** Per-cell quiz definition the Populate API consumes. Shared with
 *  `scheduleArrange` so both prelim and elim plan builders return the
 *  same shape. */
export interface QuizDef {
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  label: string
  seats: SeatInput[]
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
