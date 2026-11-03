import { BRACKET_LIBRARY } from './bracketLibrary'
import { letterOf } from './letters'
import type {
  DivisionSettings,
  LaneSettings,
  LineSettings,
  ScheduleQuiz,
  Seat,
} from './scheduleFile'

/** A lane with its defaults: a bracket when the library has its size, unless asked for a round robin */
function lane(size: number, roundRobin = !hasBracket(size)): LaneSettings {
  return {
    size,
    format: roundRobin ? 'roundRobin' : 'bracket',
    ...(roundRobin ? { perTeam: 2 } : {}),
    finals: !roundRobin,
    label: { kind: 'suffix' },
    lettering: 'continue',
  }
}

const XY: LineSettings = { intermediate: { quizzes: 2, kind: 'rerank', above: 3 } }
const NONE: LineSettings = {}

function hasBracket(size: number): boolean {
  return String(size) in BRACKET_LIBRARY
}

/**
 * The lanes for the ranks left below the main lane: up to 12 in one lane; 13 to 15 as a 9-team
 * bracket and the rest; 16 or more as a 12-team bracket and the rest, which is a bracket for 7 or
 * more teams and otherwise a round robin (FR-030)
 */
function lanesBelow(left: number): LaneSettings[] {
  if (left <= 0) return []
  if (left <= 12) return [lane(left)]
  const first = left <= 15 ? 9 : 12
  const rest = left - first
  return [lane(first), ...(rest > 0 ? [lane(rest, rest < 7 || !hasBracket(rest))] : [])]
}

/** A division's default elims by its size, as the org's meets ran them (FR-030) */
export function defaultElims(teams: number): DivisionSettings['elims'] {
  if (teams <= 12) return { lanes: teams > 0 ? [lane(teams)] : [], lines: [] }
  if (teams <= 18) return { lanes: [lane(9), lane(teams - 9)], lines: [XY] }
  const below = lanesBelow(teams - 12)
  return { lanes: [lane(12), ...below], lines: [XY, ...below.slice(1).map(() => NONE)] }
}

/** The names of an intermediate's quizzes, doubled on the second line that has one (XX, YY) */
function intermediateNames(quizzes: number, nth: number): string[] {
  const base = ['X', 'XY', 'XYZ', 'WXYZ'][quizzes - 1]!.split('')
  return base.map((c) => c.repeat(nth + 1))
}

/**
 * Which ranks of the range each intermediate quiz seats: XY as the org seats it (X = 1st, 4th, 6th;
 * Y = 2nd, 3rd, 5th), or the alternate seen in Nov 2024 (1st, 4th, 5th / 2nd, 3rd, 6th); anything
 * else snakes (W = 1st, 8th, 9th of WXYZ)
 */
function intermediateSeating(quizzes: number, alternate: boolean): number[][] {
  if (quizzes === 1) return [[0, 1, 2]]
  if (quizzes === 2)
    return alternate
      ? [
          [0, 3, 4],
          [1, 2, 5],
        ]
      : [
          [0, 3, 5],
          [1, 2, 4],
        ]
  return Array.from({ length: quizzes }, (_, j) => [j, 2 * quizzes - 1 - j, 2 * quizzes + j])
}

interface LineRange {
  from: number
  to: number
  kind: 'rerank' | 'playIn'
}

/** The ranks each line's intermediate holds */
function lineRanges(division: DivisionSettings): (LineRange | null)[] {
  let after = 0
  return division.elims.lines.map((line, i) => {
    after += division.elims.lanes[i]?.size ?? 0
    const inter = line.intermediate
    if (!inter) return null
    const from = after - inter.above + 1
    return { from, to: from + 3 * inter.quizzes - 1, kind: inter.kind }
  })
}

function laneName(division: DivisionSettings, index: number): string {
  const label = division.elims.lanes[index]!.label
  if (label.kind === 'own') return label.name
  if (label.kind === 'division' || index === 0) return division.name
  return `${division.name}${'C'.repeat(index)}`
}

/**
 * A division's elim quizzes, from its lanes, the intermediates on its lines, and the bracket
 * library, without cells (FR-027 to FR-034). Ids are stable for the same settings, so a pinned quiz
 * keeps its place when the rest are rebuilt.
 */
export function buildElimQuizzes(division: DivisionSettings): ScheduleQuiz[] {
  const quizzes: ScheduleQuiz[] = []
  const ranges = lineRanges(division)
  const sourceOf = (rank: number): Seat =>
    ranges.some((r) => r && r.kind === 'rerank' && rank >= r.from && rank <= r.to)
      ? { kind: 'new', rank }
      : { kind: 'rank', rank }

  // Intermediates first: they play before the lanes they feed
  let nth = 0
  ranges.forEach((range, line) => {
    const inter = division.elims.lines[line]!.intermediate
    if (!range || !inter) return
    const names = intermediateNames(inter.quizzes, nth++)
    intermediateSeating(inter.quizzes, inter.seating === 'alternate').forEach((ranks, j) => {
      quizzes.push({
        id: `${division.id}-I${line}-${names[j]}`,
        label: `${division.name} Quiz ${names[j]}`,
        division: division.id,
        phase: 'elim',
        line,
        cell: null,
        seats: ranks.map((k) => ({ kind: 'rank', rank: range.from + k })),
        pinned: false,
      })
    })
  })

  let from = 1
  let lettered = 0
  division.elims.lanes.forEach((settings, index) => {
    const name = laneName(division, index)
    const offset = settings.lettering === 'continue' ? lettered : 0
    const entry = settings.format === 'bracket' ? BRACKET_LIBRARY[String(settings.size)] : undefined
    if (entry) {
      const idOf = (quizName: string) => `${division.id}-L${index}-${quizName}`
      const letterFor = (quizName: string) =>
        /^[A-Z]$/.test(quizName) ? letterOf(offset + quizName.charCodeAt(0) - 65) : quizName
      const seat = (token: string): Seat => {
        if (/^\d+$/.test(token)) return sourceOf(from + Number(token) - 1)
        if (token.startsWith('N')) return { kind: 'new', rank: from + Number(token.slice(1)) - 1 }
        return { kind: 'place', place: Number(token[0]), quiz: idOf(token.slice(1)) }
      }
      for (const q of entry.quizzes) {
        quizzes.push({
          id: idOf(q.name),
          label: `${name} Quiz ${letterFor(q.name)}`,
          division: division.id,
          phase: 'elim',
          lane: index,
          cell: null,
          seats: q.seats.map(seat),
          pinned: false,
        })
      }
      const lettersUsed = entry.quizzes.filter((q) => /^[A-Z]$/.test(q.name)).length
      const decidingLabel = settings.finals
        ? `${name} Finals`
        : `${name} Quiz ${letterOf(offset + lettersUsed)}`
      quizzes.push({
        id: idOf('deciding'),
        label: decidingLabel,
        division: division.id,
        phase: 'elim',
        lane: index,
        cell: null,
        seats: entry.deciding.map(seat),
        pinned: false,
        deciding: true,
      })
      lettered = offset + lettersUsed + (settings.finals ? 0 : 1)
    }
    from += settings.size
  })
  return quizzes
}
