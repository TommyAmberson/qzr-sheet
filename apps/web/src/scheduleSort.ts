/**
 * Rule-book row ordering for the schedule sort.
 *
 * Inputs: a list of letter-triples (the rule book pattern for a team
 * count) and a set of "late" letters (letters whose team was marked
 * late after Roll Teams).
 *
 * Output: the same rows, sorted ascending by the number of late letters
 * each row contains. Rows containing zero late letters land at the
 * front (so they get placed in the early cells); rows with the most
 * late letters land at the back (latest cells). Ties are broken by
 * original rule-book order for stability.
 *
 * Trade-off: this prioritises pushing late teams to later slots over
 * preserving the rule book's K-tuple letter-disjointness invariant.
 * For team counts and K values where the rule book supports
 * disjointness (e.g. 20-team K=3), the back of the sorted list may
 * have a slot where the same letter appears in two rows — that team
 * plays in two rooms at the same time. The admin can fix those
 * manually, or live with them since the conflicts are in the latest
 * (lowest-priority) slots. For team counts where the rule book never
 * supported K>1 disjointness anyway (most counts under 20), this
 * algorithm at least guarantees the early slots are conflict-light.
 */

export type Row = readonly [string, string, string]

/** Reorder rule-book rows by lateness. Rows with fewer late letters
 *  come first. Stable sort by original rule-book index breaks ties. */
export function orderRowsByLateness(
  rows: ReadonlyArray<Row>,
  lateLetters: ReadonlySet<string>,
): Row[] {
  if (lateLetters.size === 0) return [...rows]

  const scored = rows.map((row, idx) => {
    let lateCount = 0
    for (const letter of row) if (lateLetters.has(letter)) lateCount++
    return { row, idx, lateCount }
  })
  scored.sort((a, b) => a.lateCount - b.lateCount || a.idx - b.idx)
  return scored.map((s) => s.row)
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
