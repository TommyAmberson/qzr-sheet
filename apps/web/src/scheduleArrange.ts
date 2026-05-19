import type { SeatInput, MeetRoom, MeetSlot } from './api'
import { computeRoomOwnership, type Cell } from './scheduleAlloc'
import { bySortOrder } from './scheduleGrid'
import type { Row } from './scheduleSort'

/**
 * Combined cell allocation + row placement, with per-(slot, room)
 * division ownership chosen during placement instead of fixed up
 * front.
 *
 * The simpler pipeline (`allocateCells` + `placeRowsInGrid`) fixes the
 * shared-room slot ownership before placement runs — so if D2 owns
 * r3 at slots 1, 3, 4, 6, 7, 9 and D3 owns r3 at slots 2, 5, 8, that
 * mapping is locked in regardless of what would help disjointness or
 * lateness. This function instead defers per-slot ownership to a
 * greedy walk: at each (slot, room) cell, both candidate divisions
 * compete for the cell and the one with the better-fitting row wins.
 *
 * Per-(division, room) cell budgets are still respected — the room
 * ownership step decides how many cells each division gets in each
 * room, just like before — so each division still gets exactly its
 * team count of cells, and each room still hosts ≤2 divisions. The
 * flexibility is only in *which* slots within a shared room each
 * division uses.
 *
 * Algorithm:
 *
 * 1. **Room ownership** (unchanged from `allocateCells`): column-major
 *    walk over rooms; each division claims cells until its team count
 *    is met. Output: per-room list of {division, cellCount} entries
 *    (1 or 2 entries per room).
 *
 * 2. **Per-division row queues**, sorted by lateness ascending then
 *    rule-book index. Non-late rows go to the front.
 *
 * 3. **Greedy cell-by-cell placement** in row-major order. At each
 *    (slot, room) cell:
 *      a. Find candidate divisions: room owners with remaining
 *         budget in this room AND remaining rows in their queue.
 *      b. For each candidate, find the earliest row from its queue
 *         that is letter-disjoint with rows already placed at the
 *         same slot for the same division. If none, fall back to the
 *         earliest row with the minimum conflict count.
 *      c. Score each candidate by (conflicts, lateCount, rowIdx,
 *         divisionOrder) — lex ascending, lower wins. So we prefer:
 *         no conflict > fewer-late-letters > earlier-rule-book-row >
 *         lower-numbered division.
 *      d. Place the winning row, decrement that division's room
 *         budget, advance its queue.
 *
 * Trade-offs vs the simpler pipeline:
 *   * Better — produces fewer letter conflicts in late slots, because
 *     it can shift shared-room ownership to keep late rows aligned
 *     with cells where they fit cleanly.
 *   * Worse — the per-cell scoring lets the lower-numbered division
 *     "win" a cell even when ceding it would benefit the higher
 *     division more. A backtracking search or local optimisation
 *     could improve further, but the greedy is fast and good enough
 *     for typical meets.
 */

export interface QuizDef {
  slotId: number
  roomId: number
  division: string
  phase: 'prelim' | 'elim'
  label: string
  seats: SeatInput[]
}

export interface DivisionPlacementInput {
  division: string
  teamCount: number
  rows: ReadonlyArray<Row>
  lateLetters: ReadonlySet<string>
}

export interface ArrangementResult {
  /** Generated prelim quiz definitions per division, ready for the
   *  API. Quiz numbers are sequential per non-empty cell. */
  perDivision: Map<string, QuizDef[]>
  /** Per-division Q-number → late letter count in that quiz's row.
   *  Useful for diagnostics. */
  lateCountByQuiz: Map<string, number[]>
  /** Cells the allocator couldn't fill (rows < budget × slot count). */
  emptyCellCount: number
  /** Cells beyond grid capacity (sum of team counts > rows × slots). */
  shortfall: number
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

  // Layer 1 — room ownership (mirrors allocateCells).
  const teamCounts: Record<string, number> = {}
  for (const d of divisions) teamCounts[d.division] = d.teamCount
  const divNames = divisions.map((d) => d.division)
  const { ownership, shortfall } = computeRoomOwnership(divNames, teamCounts, S, R)

  // Budget per (division, roomIdx).
  const budget = new Map<string, number>()
  for (let r = 0; r < ownership.length; r++) {
    for (const entry of ownership[r]!) {
      budget.set(`${entry.division}|${r}`, entry.count)
    }
  }

  // Per-division row queue sorted by (lateCount asc, original index asc).
  const queue = new Map<string, Row[]>()
  const lateLettersByDiv = new Map<string, ReadonlySet<string>>()
  for (const d of divisions) {
    lateLettersByDiv.set(d.division, d.lateLetters)
    const scored = d.rows.map((row, idx) => ({
      row,
      idx,
      lateCount:
        d.lateLetters.size === 0 ? 0 : row.reduce((n, l) => n + (d.lateLetters.has(l) ? 1 : 0), 0),
    }))
    scored.sort((a, b) => a.lateCount - b.lateCount || a.idx - b.idx)
    queue.set(
      d.division,
      scored.map((s) => s.row),
    )
  }

  // Per-(division, slotId) placed letters (for conflict checking).
  const placedLetters = new Map<string, Set<string>>()

  // Per-division output.
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
      const owners = (ownership[r] ?? []).map((e) => e.division)

      // Candidate divisions: own this room, have budget, have rows.
      const candidates = owners.filter(
        (div) => (budget.get(`${div}|${r}`) ?? 0) > 0 && (queue.get(div) ?? []).length > 0,
      )
      if (candidates.length === 0) continue

      // For each candidate, find best row at this cell.
      let best: {
        div: string
        rowIdx: number
        conflicts: number
        lateCount: number
      } | null = null

      for (const div of candidates) {
        const lateLetters = lateLettersByDiv.get(div)!
        const placed = placedLetters.get(`${div}|${slot.id}`)
        const divQueue = queue.get(div)!

        let candIdx = -1
        let candConflicts = Infinity
        for (let i = 0; i < divQueue.length; i++) {
          const row = divQueue[i]!
          let conflicts = 0
          if (placed) {
            for (const letter of row) if (placed.has(letter)) conflicts++
          }
          if (conflicts < candConflicts) {
            candIdx = i
            candConflicts = conflicts
            if (conflicts === 0) break // can't do better
          }
        }
        if (candIdx < 0) continue
        const row = divQueue[candIdx]!
        const lateCount =
          lateLetters.size === 0 ? 0 : row.reduce((n, l) => n + (lateLetters.has(l) ? 1 : 0), 0)

        const divNumber = divNames.indexOf(div)
        const bestDivNumber = best ? divNames.indexOf(best.div) : Infinity
        if (
          !best ||
          candConflicts < best.conflicts ||
          (candConflicts === best.conflicts && lateCount < best.lateCount) ||
          (candConflicts === best.conflicts &&
            lateCount === best.lateCount &&
            candIdx < best.rowIdx) ||
          (candConflicts === best.conflicts &&
            lateCount === best.lateCount &&
            candIdx === best.rowIdx &&
            divNumber < bestDivNumber)
        ) {
          best = { div, rowIdx: candIdx, conflicts: candConflicts, lateCount }
        }
      }

      if (!best) continue

      // Place.
      const divQueue = queue.get(best.div)!
      const row = divQueue[best.rowIdx]!
      divQueue.splice(best.rowIdx, 1)

      const placedKey = `${best.div}|${slot.id}`
      let placed = placedLetters.get(placedKey)
      if (!placed) {
        placed = new Set<string>()
        placedLetters.set(placedKey, placed)
      }
      for (const l of row) placed.add(l)

      budget.set(`${best.div}|${r}`, (budget.get(`${best.div}|${r}`) ?? 0) - 1)

      const list = perDivision.get(best.div)!
      const quizNum = list.length + 1
      list.push({
        slotId: slot.id,
        roomId: room.id,
        division: best.div,
        phase: 'prelim',
        label: `D${best.div}-Q${quizNum}`,
        seats: [
          { seatNumber: 1, letter: row[0] },
          { seatNumber: 2, letter: row[1] },
          { seatNumber: 3, letter: row[2] },
        ],
      })
      lateCountByQuiz.get(best.div)!.push(best.lateCount)
      totalCellsFilled++
    }
  }

  const totalGrid = S * R
  const emptyCellCount = totalGrid - totalCellsFilled - shortfall

  return { perDivision, lateCountByQuiz, emptyCellCount, shortfall }
}

/** Get the cells a division ended up occupying (in placement order = row-major). */
export function cellsFromPlan(plan: QuizDef[]): Cell[] {
  return plan.map((q) => ({ slotId: q.slotId, roomId: q.roomId }))
}
