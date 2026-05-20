/**
 * Rule-book row primitives shared by the placement algorithm in
 * `scheduleArrange.ts`.
 *
 * The placement itself lives in `arrangeAllDivisions` (combined
 * allocator + greedy row placer with per-(slot, room) division
 * ownership). This module just defines the row tuple type and a
 * couple of small helpers that operate on rows.
 */

export type Row = readonly [string, string, string]

/** Count how many of this row's letters are in the late-letter set. */
export function countLate(row: Row, lateLetters: ReadonlySet<string>): number {
  if (lateLetters.size === 0) return 0
  let n = 0
  for (const letter of row) if (lateLetters.has(letter)) n++
  return n
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
 *  is impossible — it just means the rule book doesn't have a valid K>1
 *  partition pre-baked in row order. The placement algorithm in
 *  `arrangeAllDivisions` can still find a valid K>1 arrangement by
 *  pairing non-consecutive rows. Example: 15-team K=2 is unreachable by
 *  row-order grouping, but the placement finds (BEF+GJK), (DCO+FIJ),
 *  (NBC+ALO), (IML+HGD), (MJN+LKH), (IHE+ONK) + singletons. */
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
