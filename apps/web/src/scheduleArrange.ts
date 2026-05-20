import type { MeetRoom, MeetSlot } from './api'
import { computeRoomOwnership } from './scheduleAlloc'
import { type QuizDef } from './scheduleBuild'
import { bySortOrder } from './scheduleGrid'
import { countLate, type Row } from './scheduleSort'

/**
 * Combined cell allocation + row placement for Populate / Sort by
 * Lateness.
 *
 * Each division gets exactly its team count of cells, each room hosts
 * at most two divisions, and within any slot no team letter appears
 * twice in the same division. The lateness-driven soft objective —
 * late rows land in higher-numbered cells — is a comparator
 * tiebreaker on top.
 *
 * Algorithm:
 *
 * 1. **Room ownership** (delegated to `computeRoomOwnership`): walk
 *    rooms column-major and assign cells to divisions until each
 *    division's team count is met. Output: per-(division, room) cell
 *    budget plus the room → divisions mapping. Each room ends up with
 *    1 or 2 owning divisions.
 *
 * 2. **Per-division row queues**, sorted by `(lateCount asc, rule-book
 *    index asc)`. Non-late rows come first; ties resolved by rule-book
 *    order for stability.
 *
 * 3. **Greedy cell-by-cell placement** in row-major order over the
 *    full grid. At each `(slot, room)` cell:
 *      a. The candidate divisions are this room's owners that still
 *         have remaining budget AND remaining rows.
 *      b. For each candidate, find the row in its queue with the
 *         fewest letter conflicts against rows already placed at the
 *         same slot for the same division.
 *      c. Pick the candidate with the lowest
 *         `(conflicts, lateCount, rowIndex, divisionOrder)`
 *         tuple — fewer conflicts > fewer late letters > earlier rule-
 *         book row > lower-numbered division.
 *      d. Place the winning row, decrement that division's room budget,
 *         remove from its queue.
 *
 * The greedy is single-pass; it doesn't backtrack or swap rows
 * between cells after placement. For typical meets this still
 * produces zero conflicts when the rule book permits one, and
 * minimises conflicts otherwise.
 */

export interface DivisionPlacementInput {
  division: string
  teamCount: number
  rows: ReadonlyArray<Row>
  lateLetters: ReadonlySet<string>
}

export interface ArrangementResult {
  /** Quiz definitions per division, in placement (row-major) order
   *  with sequential Q1..QN numbering. */
  perDivision: Map<string, QuizDef[]>
  /** Per-division array of late-letter counts in placement order. */
  lateCountByQuiz: Map<string, number[]>
  /** Grid cells left empty (rows < grid capacity). */
  emptyCellCount: number
  /** Cells beyond grid capacity (rows > grid capacity). */
  shortfall: number
}

interface QueueEntry {
  row: Row
  lateCount: number
}

/** Lex-compare two equal-length numeric tuples. Returns negative if a
 *  < b, positive if a > b, 0 if equal. */
function tupleCompare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!
    if (diff !== 0) return diff
  }
  return 0
}

export function arrangeAllDivisions(
  divisions: ReadonlyArray<DivisionPlacementInput>,
  slots: ReadonlyArray<MeetSlot>,
  rooms: ReadonlyArray<MeetRoom>,
): ArrangementResult {
  const sortedSlots = [...slots].sort(bySortOrder)
  const sortedRooms = [...rooms].sort(bySortOrder)
  const S = sortedSlots.length
  const R = sortedRooms.length

  const teamCounts: Record<string, number> = {}
  for (const d of divisions) teamCounts[d.division] = d.teamCount
  const divNames = divisions.map((d) => d.division)
  const divOrder = new Map(divNames.map((d, i) => [d, i]))
  const { ownership, shortfall } = computeRoomOwnership(divNames, teamCounts, S, R)

  // Per-(divIdx, roomIdx) remaining cell count.
  const budget: number[][] = divNames.map(() => new Array(R).fill(0))
  for (let r = 0; r < ownership.length; r++) {
    for (const entry of ownership[r]!) {
      budget[divOrder.get(entry.division)!]![r] = entry.count
    }
  }

  // Precompute per-room candidate division indices.
  const ownersByRoom: number[][] = ownership.map((entries) =>
    entries.map((e) => divOrder.get(e.division)!),
  )

  // Per-division row queues, each entry carrying its precomputed
  // lateCount so the placement loop never recomputes it.
  const queues: QueueEntry[][] = divisions.map((d) => {
    const scored = d.rows.map((row, idx) => ({
      row,
      idx,
      lateCount: countLate(row, d.lateLetters),
    }))
    scored.sort((a, b) => a.lateCount - b.lateCount || a.idx - b.idx)
    return scored.map((s) => ({ row: s.row, lateCount: s.lateCount }))
  })

  // Per-(divIdx, slotId) letters placed so far (for conflict checks).
  const placedLetters: Map<number, Set<string>>[] = divNames.map(() => new Map())

  const perDivision = new Map<string, QuizDef[]>()
  const lateCountByQuiz = new Map<string, number[]>()
  for (const d of divisions) {
    perDivision.set(d.division, [])
    lateCountByQuiz.set(d.division, [])
  }

  let totalCellsFilled = 0

  for (let s = 0; s < S; s++) {
    const slot = sortedSlots[s]!
    for (let r = 0; r < R; r++) {
      const room = sortedRooms[r]!
      const candidates = ownersByRoom[r]!.filter(
        (divIdx) => (budget[divIdx]![r] ?? 0) > 0 && queues[divIdx]!.length > 0,
      )
      if (candidates.length === 0) continue

      // For each candidate, find its best row at this cell. Track the
      // overall best (lowest comparator tuple) across candidates.
      let best: { divIdx: number; rowIdx: number; lateCount: number; score: number[] } | null = null

      for (const divIdx of candidates) {
        const queue = queues[divIdx]!
        const placed = placedLetters[divIdx]!.get(slot.id)

        // Earliest row with the fewest conflicts.
        let candIdx = -1
        let candConflicts = Infinity
        for (let i = 0; i < queue.length; i++) {
          const row = queue[i]!.row
          let conflicts = 0
          if (placed) {
            for (const letter of row) if (placed.has(letter)) conflicts++
          }
          if (conflicts < candConflicts) {
            candIdx = i
            candConflicts = conflicts
            if (conflicts === 0) break
          }
        }
        if (candIdx < 0) continue
        const candLate = queue[candIdx]!.lateCount
        const score = [candConflicts, candLate, candIdx, divIdx]
        if (!best || tupleCompare(score, best.score) < 0) {
          best = { divIdx, rowIdx: candIdx, lateCount: candLate, score }
        }
      }

      if (!best) continue

      const queue = queues[best.divIdx]!
      const { row } = queue[best.rowIdx]!
      queue.splice(best.rowIdx, 1)

      let placed = placedLetters[best.divIdx]!.get(slot.id)
      if (!placed) {
        placed = new Set<string>()
        placedLetters[best.divIdx]!.set(slot.id, placed)
      }
      for (const letter of row) placed.add(letter)

      const divBudget = budget[best.divIdx]!
      divBudget[r] = (divBudget[r] ?? 0) - 1

      const division = divNames[best.divIdx]!
      const list = perDivision.get(division)!
      list.push({
        slotId: slot.id,
        roomId: room.id,
        division,
        phase: 'prelim',
        label: `D${division}-Q${list.length + 1}`,
        seats: [
          { seatNumber: 1, letter: row[0] },
          { seatNumber: 2, letter: row[1] },
          { seatNumber: 3, letter: row[2] },
        ],
      })
      lateCountByQuiz.get(division)!.push(best.lateCount)
      totalCellsFilled++
    }
  }

  const totalGrid = S * R
  const emptyCellCount = totalGrid - totalCellsFilled - shortfall

  return { perDivision, lateCountByQuiz, emptyCellCount, shortfall }
}
