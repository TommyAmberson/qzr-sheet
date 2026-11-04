import { indexOfLetter, letterOf } from './letters'

/**
 * Per-team-count round-robin patterns for prelim quizzes, transcribed
 * verbatim from `docs/rules.md` §"Preliminary Round Brackets". Each
 * value is a list of N quizzes (where N = team count); each quiz is
 * exactly 3 letters drawn from A through the Nth letter, and every
 * letter appears in exactly 3 quizzes (each team plays 3 prelims).
 *
 * The rule-book table is the canonical source for 4 to 21 teams; the
 * schedule builder uses it for the "Rule book" draw source.
 */
export const PRELIM_DRAW_PATTERNS: Record<
  number,
  ReadonlyArray<readonly [string, string, string]>
> = {
  4: [
    ['A', 'B', 'C'],
    ['D', 'A', 'B'],
    ['C', 'D', 'A'],
    ['B', 'C', 'D'],
  ],
  5: [
    ['A', 'B', 'C'],
    ['D', 'E', 'A'],
    ['B', 'C', 'D'],
    ['E', 'A', 'B'],
    ['C', 'D', 'E'],
  ],
  6: [
    ['A', 'C', 'F'],
    ['B', 'D', 'A'],
    ['C', 'E', 'B'],
    ['D', 'F', 'C'],
    ['E', 'A', 'D'],
    ['F', 'B', 'E'],
  ],
  7: [
    ['A', 'C', 'G'],
    ['B', 'D', 'A'],
    ['C', 'E', 'B'],
    ['D', 'F', 'C'],
    ['E', 'G', 'D'],
    ['F', 'A', 'E'],
    ['G', 'B', 'F'],
  ],
  8: [
    ['A', 'B', 'C'],
    ['D', 'E', 'F'],
    ['G', 'H', 'A'],
    ['G', 'C', 'E'],
    ['A', 'D', 'F'],
    ['B', 'E', 'H'],
    ['F', 'H', 'C'],
    ['G', 'B', 'D'],
  ],
  9: [
    ['A', 'B', 'C'],
    ['D', 'E', 'F'],
    ['G', 'H', 'I'],
    ['A', 'D', 'G'],
    ['B', 'E', 'H'],
    ['C', 'D', 'H'],
    ['A', 'E', 'I'],
    ['B', 'F', 'G'],
    ['C', 'F', 'I'],
  ],
  10: [
    ['A', 'B', 'C'],
    ['D', 'E', 'F'],
    ['G', 'H', 'I'],
    ['J', 'B', 'F'],
    ['A', 'D', 'G'],
    ['B', 'E', 'H'],
    ['C', 'F', 'I'],
    ['J', 'E', 'G'],
    ['C', 'D', 'H'],
    ['I', 'J', 'A'],
  ],
  11: [
    ['A', 'B', 'J'],
    ['B', 'C', 'K'],
    ['C', 'D', 'A'],
    ['D', 'E', 'B'],
    ['E', 'F', 'C'],
    ['F', 'G', 'D'],
    ['G', 'H', 'E'],
    ['H', 'I', 'F'],
    ['I', 'J', 'G'],
    ['J', 'K', 'H'],
    ['K', 'A', 'I'],
  ],
  12: [
    ['A', 'B', 'K'],
    ['C', 'F', 'E'],
    ['G', 'I', 'J'],
    ['E', 'D', 'B'],
    ['F', 'H', 'I'],
    ['A', 'J', 'L'],
    ['E', 'G', 'H'],
    ['A', 'C', 'D'],
    ['K', 'J', 'H'],
    ['L', 'C', 'B'],
    ['D', 'F', 'G'],
    ['I', 'L', 'K'],
  ],
  13: [
    ['C', 'F', 'G'],
    ['I', 'H', 'E'],
    ['G', 'J', 'K'],
    ['L', 'I', 'M'],
    ['B', 'K', 'A'],
    ['D', 'M', 'C'],
    ['B', 'E', 'F'],
    ['H', 'G', 'D'],
    ['F', 'J', 'I'],
    ['K', 'L', 'H'],
    ['A', 'J', 'M'],
    ['C', 'B', 'L'],
    ['D', 'A', 'E'],
  ],
  14: [
    ['A', 'D', 'E'],
    ['C', 'F', 'G'],
    ['E', 'H', 'I'],
    ['I', 'L', 'M'],
    ['G', 'J', 'K'],
    ['K', 'N', 'A'],
    ['B', 'M', 'C'],
    ['L', 'K', 'H'],
    ['F', 'I', 'J'],
    ['D', 'H', 'G'],
    ['B', 'E', 'F'],
    ['J', 'M', 'N'],
    ['A', 'B', 'L'],
    ['N', 'C', 'D'],
  ],
  15: [
    ['B', 'E', 'F'],
    ['G', 'J', 'K'],
    ['E', 'D', 'A'],
    ['D', 'C', 'O'],
    ['N', 'B', 'C'],
    ['A', 'L', 'O'],
    ['C', 'F', 'G'],
    ['F', 'I', 'J'],
    ['I', 'M', 'L'],
    ['H', 'G', 'D'],
    ['M', 'J', 'N'],
    ['L', 'K', 'H'],
    ['A', 'B', 'M'],
    ['I', 'H', 'E'],
    ['O', 'N', 'K'],
  ],
  16: [
    ['C', 'F', 'G'],
    ['A', 'D', 'E'],
    ['D', 'G', 'H'],
    ['L', 'O', 'P'],
    ['E', 'B', 'F'],
    ['K', 'O', 'N'],
    ['P', 'D', 'C'],
    ['H', 'E', 'I'],
    ['H', 'K', 'L'],
    ['B', 'C', 'O'],
    ['F', 'I', 'J'],
    ['N', 'A', 'B'],
    ['I', 'L', 'M'],
    ['G', 'J', 'K'],
    ['J', 'M', 'N'],
    ['M', 'P', 'A'],
  ],
  17: [
    ['C', 'D', 'L'],
    ['E', 'G', 'O'],
    ['H', 'F', 'M'],
    ['K', 'I', 'P'],
    ['N', 'J', 'Q'],
    ['F', 'A', 'L'],
    ['B', 'M', 'G'],
    ['D', 'O', 'I'],
    ['H', 'C', 'N'],
    ['E', 'K', 'Q'],
    ['J', 'P', 'B'],
    ['M', 'N', 'O'],
    ['D', 'E', 'F'],
    ['A', 'B', 'C'],
    ['G', 'H', 'I'],
    ['J', 'L', 'K'],
    ['P', 'Q', 'A'],
  ],
  18: [
    ['A', 'J', 'R'],
    ['B', 'P', 'K'],
    ['F', 'I', 'M'],
    ['D', 'G', 'N'],
    ['C', 'L', 'Q'],
    ['E', 'O', 'H'],
    ['G', 'M', 'A'],
    ['J', 'D', 'P'],
    ['H', 'B', 'N'],
    ['I', 'C', 'O'],
    ['K', 'E', 'Q'],
    ['L', 'R', 'F'],
    ['B', 'A', 'C'],
    ['D', 'F', 'E'],
    ['G', 'H', 'I'],
    ['J', 'K', 'L'],
    ['M', 'N', 'O'],
    ['P', 'Q', 'R'],
  ],
  19: [
    ['I', 'O', 'S'],
    ['H', 'F', 'N'],
    ['L', 'C', 'P'],
    ['E', 'G', 'M'],
    ['A', 'J', 'Q'],
    ['K', 'R', 'D'],
    ['C', 'I', 'N'],
    ['B', 'M', 'H'],
    ['F', 'L', 'Q'],
    ['J', 'D', 'O'],
    ['E', 'P', 'K'],
    ['R', 'S', 'B'],
    ['G', 'H', 'I'],
    ['D', 'E', 'F'],
    ['A', 'B', 'C'],
    ['J', 'K', 'L'],
    ['M', 'N', 'O'],
    ['P', 'Q', 'R'],
    ['S', 'A', 'G'],
  ],
  20: [
    ['H', 'S', 'O'],
    ['T', 'G', 'P'],
    ['C', 'J', 'M'],
    ['N', 'F', 'Q'],
    ['B', 'I', 'R'],
    ['E', 'L', 'S'],
    ['K', 'D', 'T'],
    ['H', 'C', 'N'],
    ['J', 'P', 'B'],
    ['F', 'A', 'L'],
    ['D', 'O', 'I'],
    ['E', 'Q', 'K'],
    ['R', 'M', 'G'],
    ['A', 'B', 'C'],
    ['D', 'E', 'F'],
    ['G', 'H', 'I'],
    ['J', 'K', 'L'],
    ['M', 'N', 'O'],
    ['P', 'R', 'Q'],
    ['S', 'T', 'A'],
  ],
  21: [
    ['D', 'A', 'G'],
    ['J', 'M', 'P'],
    ['B', 'H', 'E'],
    ['K', 'N', 'Q'],
    ['L', 'R', 'O'],
    ['C', 'F', 'I'],
    ['S', 'P', 'A'],
    ['H', 'U', 'R'],
    ['T', 'L', 'Q'],
    ['M', 'D', 'I'],
    ['S', 'C', 'J'],
    ['F', 'K', 'U'],
    ['E', 'T', 'N'],
    ['O', 'G', 'B'],
    ['P', 'Q', 'R'],
    ['T', 'S', 'U'],
    ['D', 'E', 'F'],
    ['A', 'B', 'C'],
    ['G', 'I', 'H'],
    ['K', 'J', 'L'],
    ['M', 'O', 'N'],
  ],
}

/** Returns the rule-book draw for `teamCount`, or `null` if no pattern
 *  is published for that count (i.e. teamCount < 4 or > 21). */
export function getPrelimDraw(
  teamCount: number,
): ReadonlyArray<readonly [string, string, string]> | null {
  return PRELIM_DRAW_PATTERNS[teamCount] ?? null
}

/** Where prelim pairings come from (FR-023) */
export type PrelimDrawSource = 'ruleBook' | 'noRematches'

/** How many pairs of teams meet more than once among these quizzes */
function repeats(quizzes: readonly (readonly number[])[]): number {
  const met = new Set<string>()
  let count = 0
  for (const q of quizzes) {
    for (let i = 0; i < q.length; i++) {
      for (let j = i + 1; j < q.length; j++) {
        const a = Math.min(q[i]!, q[j]!)
        const b = Math.max(q[i]!, q[j]!)
        const key = `${a}-${b}`
        if (met.has(key)) count++
        met.add(key)
      }
    }
  }
  return count
}

/**
 * The rotating draw for `n` teams: quiz `i` gets teams `(i, i + k + 1, i + 2k)` counted round
 * (FR-024), with the step `k` that has no two teams meeting twice, nearest `n / 3` when several
 * do (the sister org's spreadsheet). Where no step manages that (8 and 13 teams), the cyclic
 * pattern `(i, i + a, i + b)` that does. Teams are 0-based.
 */
function rotatingDraw(n: number): number[][] {
  const cyclic = (a: number, b: number) =>
    Array.from({ length: n }, (_, i) => [i, (i + a) % n, (i + b) % n])
  let best: { quizzes: number[][]; score: number } | null = null
  for (let k = 1; k < n; k++) {
    const quizzes = cyclic(k + 1, 2 * k)
    if (quizzes.some((q) => new Set(q).size < 3)) continue
    const score = repeats(quizzes) * n + Math.abs(k - Math.floor(n / 3))
    if (!best || score < best.score) best = { quizzes, score }
  }
  if (best && repeats(best.quizzes) === 0) return best.quizzes
  for (let a = 1; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const quizzes = cyclic(a, b)
      if (repeats(quizzes) === 0) return quizzes
    }
  }
  return best?.quizzes ?? []
}

/** One round of 3 quizzes per team, as team indexes */
function oneRound(n: number, source: PrelimDrawSource): number[][] {
  const table = getPrelimDraw(n)
  const useTable = table && (source === 'ruleBook' || n < 7)
  if (useTable) return table.map((q) => q.map(indexOfLetter))
  return n < 4 ? [] : rotatingDraw(n)
}

/**
 * The prelim quizzes for a division of `n` teams, in draw order, as letters (FR-023 to FR-025).
 * With 6 quizzes per team the second round is the first relabelled, choosing the relabelling that
 * repeats the fewest of the first round's pairings.
 */
export function drawPrelims(
  n: number,
  source: PrelimDrawSource,
  quizzesPerTeam: 3 | 6,
): string[][] {
  const first = oneRound(n, source)
  let quizzes = first
  if (quizzesPerTeam === 6 && first.length > 0) {
    let best: number[][] = first
    let bestRepeats = Infinity
    for (let shift = 0; shift < n; shift++) {
      for (let step = 1; step < n; step++) {
        const relabel = (t: number) => (t * step + shift) % n
        if (new Set(Array.from({ length: n }, (_, t) => relabel(t))).size < n) continue
        const second = first.map((q) => q.map(relabel))
        const r = repeats([...first, ...second])
        if (r < bestRepeats) {
          best = second
          bestRepeats = r
        }
      }
    }
    quizzes = [...first, ...best]
  }
  return quizzes.map((q) => q.map(letterOf))
}
