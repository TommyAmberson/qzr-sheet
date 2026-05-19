/**
 * Row-to-cell placement for the schedule grid.
 *
 * The placement decides which rule-book row (a triple of team letters)
 * goes into each (slot, room) cell of a division's allocation. It has
 * to satisfy one hard constraint and one soft objective:
 *
 *   * Hard constraint — **letter disjointness within a slot**: across
 *     all rows placed at the same slot for the same division, no
 *     letter may appear twice. A letter is a team, and a team
 *     physically can't play in two rooms at once. The placement
 *     algorithm tries to honour this; when the rule book makes it
 *     impossible (some patterns just don't have enough disjoint
 *     pairings), unavoidable conflicts land in the latest cells.
 *   * Soft objective — **late rows go to late cells**: rows containing
 *     a "late team" letter should land in higher cell indices so they
 *     fall in later slots. For Populate (no lateness), the soft
 *     objective is trivially satisfied by an empty late-letter set.
 *
 * Algorithm (`placeRowsInGrid`):
 *
 * 1. Score each row by `lateCount` = how many of its letters are in
 *    the `lateLetters` set. Sort rows ascending by `(lateCount,
 *    original-index)`. Stable on rule-book order within a score bucket.
 * 2. Walk the division's cells in row-major order. At each cell, scan
 *    the sorted-remaining list and pick the **earliest** row that is
 *    letter-disjoint with rows already placed at the same slot for
 *    this division.
 * 3. If every remaining row conflicts, fall back to the earliest
 *    remaining row anyway — the conflict was unavoidable.
 *
 * Why "earliest non-conflicting" instead of just zipping in order:
 *   sorted-order zip places row[i] at cell[i] blindly. If row[i+1]
 *   shares a letter with row[i] and both land in the same slot, you
 *   get a conflict you could have avoided by skipping ahead to a
 *   disjoint row. The greedy skip-and-skip-back pattern fixes that.
 *
 * Trade-off vs. a fully optimal placement:
 *   This is a single-pass greedy. It doesn't backtrack, doesn't try
 *   to swap rows between slots after the fact, and doesn't search for
 *   the globally optimal arrangement. For typical meets (where the
 *   rule book supports the K being used), greedy gives the same
 *   result as optimal. For pathological cases (K unsupported by the
 *   rule book), it may leave conflicts in late slots that a more
 *   sophisticated search could resolve — at the cost of orders of
 *   magnitude more compute.
 *
 * What this algorithm does NOT do (yet):
 *   - Decide cell ownership in shared rooms. The allocator
 *     (`allocateCells`) pre-decides which slots in a shared room
 *     belong to which division; this placement then fills those
 *     pre-assigned cells. A future improvement could fold the
 *     cell-ownership decision INTO the placement, choosing per-slot
 *     ownership to maximise disjointness or lateness goals.
 *   - Rearrange empty cells. If a division has fewer rows than cells,
 *     the trailing cells are left empty; the empty doesn't move.
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

/** Diagnostic: report which K values let you fold the rule book into
 *  K-row slot groups **in row order** — i.e. rows 0..K-1 form the first
 *  slot, K..2K-1 the second, and so on — with every group being
 *  letter-disjoint.
 *
 *  This is the STRICTEST possible reading: it asks "can I trivially
 *  partition the rule book into K-tuples by reading top to bottom?"
 *  The 20-team pattern is designed for this (consecutive groups of 2
 *  or 3 are disjoint by construction), which is why
 *  `supportedKValues(rows20)` includes 2 and 3.
 *
 *  Most other patterns return only K=1 here, but that does NOT mean K>1
 *  is impossible for them — it just means the rule book doesn't have a
 *  valid K>1 partition pre-baked in row order. The placement algorithm
 *  (`placeRowsInGrid`) can often still find a valid K>1 arrangement by
 *  pairing non-consecutive rows. For example, 15-team K=2 is unreachable
 *  by row-order grouping but the greedy placement does find a fully
 *  disjoint pairing: (BEF+GJK) (DCO+FIJ) (NBC+ALO) (IML+HGD) (MJN+LKH)
 *  (IHE+ONK) + three singletons.
 *
 *  Use this function for documentation / pattern-shape diagnostics, not
 *  as a "can this team count run in K rooms" oracle. */
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
