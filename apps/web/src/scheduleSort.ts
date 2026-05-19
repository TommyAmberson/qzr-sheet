/**
 * Row-to-cell placement for the schedule grid.
 *
 * One function — `placeRowsInGrid` — handles both Populate (no
 * lateness) and Sort by Lateness (with lateness). Algorithm:
 *
 * 1. Score each rule-book row by how many of its letters are in the
 *    `lateLetters` set. For Populate the set is empty, so every row
 *    scores 0 and the order falls back to rule-book order.
 * 2. Sort rows ascending by (score, original index). Non-late rows
 *    first, late rows last. Stable on rule-book order within a
 *    score bucket.
 * 3. Walk the division's cells in row-major order. At each cell,
 *    pick the *earliest* row from the sorted-remaining list that is
 *    letter-disjoint with rows already placed at the same slot for
 *    this division. If no non-conflicting row exists, take the
 *    earliest remaining row anyway — that conflict was unavoidable
 *    given the rule book.
 *
 * Net effect: pure-non-late rows fill the early cells of each
 *  division; late rows pile up at the back. Letter-disjointness
 * within a slot is honoured when achievable, so the early cells
 * (which matter most) avoid putting a team in two rooms at once.
 * Any leftover unavoidable conflicts land in the latest cells.
 */

import type { Cell } from './scheduleAlloc'

export type Row = readonly [string, string, string]

/** Place sorted rule-book rows into the division's cells. Returns
 *  per-cell row assignment (or `null` for unfilled cells when there
 *  are more cells than rows). */
export function placeRowsInGrid(
  cells: ReadonlyArray<Cell>,
  rows: ReadonlyArray<Row>,
  lateLetters: ReadonlySet<string>,
): (Row | null)[] {
  const sortedRemaining: Row[] = rows
    .map((row, idx) => ({
      row,
      idx,
      lateCount:
        lateLetters.size === 0
          ? 0
          : row.reduce((n, letter) => n + (lateLetters.has(letter) ? 1 : 0), 0),
    }))
    .sort((a, b) => a.lateCount - b.lateCount || a.idx - b.idx)
    .map((entry) => entry.row)

  const result: (Row | null)[] = new Array(cells.length).fill(null)
  const placedLettersBySlot = new Map<number, Set<string>>()

  for (let i = 0; i < cells.length; i++) {
    if (sortedRemaining.length === 0) break
    const cell = cells[i]!
    const placed = placedLettersBySlot.get(cell.slotId)

    let chosenIdx = -1
    for (let r = 0; r < sortedRemaining.length; r++) {
      const row = sortedRemaining[r]!
      const conflicts = placed ? row.some((letter) => placed.has(letter)) : false
      if (!conflicts) {
        chosenIdx = r
        break
      }
    }
    if (chosenIdx === -1) chosenIdx = 0

    const row = sortedRemaining[chosenIdx]!
    result[i] = row
    sortedRemaining.splice(chosenIdx, 1)

    let updated = placedLettersBySlot.get(cell.slotId)
    if (!updated) {
      updated = new Set<string>()
      placedLettersBySlot.set(cell.slotId, updated)
    }
    for (const letter of row) updated.add(letter)
  }

  return result
}

/** For a rule-book pattern, return the set of K values for which every
 *  consecutive K-row group is pairwise letter-disjoint. Diagnostic —
 *  the placement algorithm above no longer requires K-disjointness,
 *  but the matrix is still useful for documenting pattern shape. */
export function supportedKValues(rows: ReadonlyArray<Row>): Set<number> {
  const supported = new Set<number>()
  if (rows.length === 0) return supported

  for (let K = 1; K <= rows.length; K++) {
    let ok = true
    for (let i = 0; i < rows.length; i += K) {
      const tuple = rows.slice(i, i + K)
      const seen = new Set<string>()
      let conflict = false
      for (const row of tuple) {
        for (const letter of row) {
          if (seen.has(letter)) {
            conflict = true
            break
          }
          seen.add(letter)
        }
        if (conflict) break
      }
      if (conflict) {
        ok = false
        break
      }
    }
    if (ok) supported.add(K)
  }
  return supported
}
