/**
 * Rule-book row ordering for the schedule sort.
 *
 * Inputs: a list of letter-triples (the rule book pattern for a team
 * count), the K rooms-per-slot the division uses, and a set of "late"
 * letters (letters whose team was marked late after Roll Teams).
 *
 * Output: the same rows, possibly reordered so that tuples (consecutive
 * K rows) containing late letters sort to the back. For Populate, the
 * late-letters set is empty so the output equals the input.
 *
 * The K-tuple is the rule book's letter-disjointness unit: consecutive
 * K rows are designed to be pairwise letter-disjoint (no team in two
 * rooms at once within a slot). Push-late preserves the tuples and only
 * permutes their order — that way the disjointness invariant survives
 * the sort.
 */

export type Row = readonly [string, string, string]

/** Reorder rule-book rows by lateness while preserving K-tuples.
 *
 * Algorithm:
 *  1. Slice `rows` into consecutive K-tuples (the last tuple may be
 *     shorter if `rows.length` isn't a multiple of K).
 *  2. Score each tuple by the count of its rows that contain at least
 *     one late letter.
 *  3. Sort tuples ascending by (score, original index) — non-late
 *     tuples first, late tuples last. Ties broken stably by rule-book
 *     order.
 *  4. Flatten the sorted tuples back into a row list. */
export function orderRowsByLateness(
  rows: ReadonlyArray<Row>,
  K: number,
  lateLetters: ReadonlySet<string>,
): Row[] {
  if (K < 1) return [...rows]

  const tuples: { rows: Row[]; originalIdx: number; lateCount: number }[] = []
  for (let i = 0; i < rows.length; i += K) {
    const tupleRows = rows.slice(i, i + K) as Row[]
    let lateCount = 0
    if (lateLetters.size > 0) {
      for (const row of tupleRows) {
        if (row.some((letter) => lateLetters.has(letter))) lateCount++
      }
    }
    tuples.push({ rows: tupleRows, originalIdx: tuples.length, lateCount })
  }

  tuples.sort((a, b) => a.lateCount - b.lateCount || a.originalIdx - b.originalIdx)

  return tuples.flatMap((t) => t.rows)
}

/** For a rule-book pattern, return the set of K values for which every
 *  consecutive K-row group is pairwise letter-disjoint. Useful for
 *  warning when an allocation needs a K the pattern doesn't support. */
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
