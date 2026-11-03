import { BRACKET_LIBRARY } from './bracketLibrary'
import { indexOfLetter, letterOf } from './letters'
import { drawPrelims } from './prelimDraw'
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
  const interId = (line: number, name: string) => `${division.id}-I${line}-${name}`

  // Intermediates first: they play before the lanes they feed
  const placesOf = new Map<number, string[]>()
  let nth = 0
  ranges.forEach((range, line) => {
    const inter = division.elims.lines[line]!.intermediate
    if (!range || !inter) return
    const names = intermediateNames(inter.quizzes, nth++)
    placesOf.set(line, names)
    intermediateSeating(inter.quizzes, inter.seating === 'alternate').forEach((ranks, j) => {
      quizzes.push({
        id: interId(line, names[j]!),
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

  /**
   * Where a rank enters a lane from: itself, `New n` from a reranking intermediate (H-16), or a
   * place in a play-in, the 1sts first, then the 2nds, then the 3rds, down the range (FR-028)
   */
  const sourceOf = (rank: number): Seat => {
    const line = ranges.findIndex((r) => r !== null && rank >= r.from && rank <= r.to)
    const range = ranges[line]
    if (!range) return { kind: 'rank', rank }
    if (range.kind === 'rerank') return { kind: 'new', rank }
    const names = placesOf.get(line)!
    const k = rank - range.from
    return {
      kind: 'place',
      place: Math.floor(k / names.length) + 1,
      quiz: interId(line, names[k % names.length]!),
    }
  }

  let from = 1
  let lettered = 0
  division.elims.lanes.forEach((settings, index) => {
    const name = laneName(division, index)
    const offset = settings.lettering === 'continue' ? lettered : 0
    const idOf = (quizName: string) => `${division.id}-L${index}-${quizName}`
    const lane = (q: { name: string; seats: Seat[]; deciding?: boolean; label: string }) =>
      quizzes.push({
        id: idOf(q.name),
        label: q.label,
        division: division.id,
        phase: 'elim',
        lane: index,
        cell: null,
        seats: q.seats,
        pinned: false,
        ...(q.deciding ? { deciding: true } : {}),
      })
    const lettersUsed = (count: number) => (lettered = offset + count)

    if (settings.format === 'roundRobin') {
      const groups = roundRobin(settings.size, settings.perTeam ?? 2)
      groups.forEach((group, i) => {
        lane({
          name: letterOf(i),
          label: `${name} Quiz ${letterOf(offset + i)}`,
          seats: group.map((k) => sourceOf(from + k)),
        })
      })
      // A round robin's Finals is an extra quiz: the top three in points across it (FR-034)
      if (settings.finals) {
        lane({
          name: 'deciding',
          label: `${name} Finals`,
          deciding: true,
          seats: [1, 2, 3].map((place) => ({ kind: 'points', place })),
        })
      }
      lettersUsed(groups.length)
    } else {
      const entry = BRACKET_LIBRARY[settings.bracket ?? String(settings.size)]
      if (entry) {
        const letterFor = (quizName: string) =>
          /^[A-Z]$/.test(quizName) ? letterOf(offset + indexOfLetter(quizName)) : quizName
        const seat = (token: string): Seat => {
          if (/^\d+$/.test(token)) return sourceOf(from + Number(token) - 1)
          if (token.startsWith('N')) return { kind: 'new', rank: from + Number(token.slice(1)) - 1 }
          return { kind: 'place', place: Number(token[0]), quiz: idOf(token.slice(1)) }
        }
        for (const q of entry.quizzes) {
          lane({
            name: q.name,
            label: `${name} Quiz ${letterFor(q.name)}`,
            seats: q.seats.map(seat),
          })
        }
        const used = entry.quizzes.filter((q) => /^[A-Z]$/.test(q.name)).length
        // A bracket always has its deciding quiz; "Finals" only names it (FR-034)
        lane({
          name: 'deciding',
          label: settings.finals ? `${name} Finals` : `${name} Quiz ${letterOf(offset + used)}`,
          deciding: true,
          seats: entry.deciding.map(seat),
        })
        lettersUsed(used + (settings.finals ? 0 : 1))
      } else {
        // No bracket of this size: placeholder quizzes for the director to fill (FR-036)
        const count = Math.max(1, settings.size - 1)
        for (let i = 0; i < count; i++) {
          lane({
            name: letterOf(i),
            label: `${name} Quiz ${letterOf(offset + i)}`,
            seats: [0, 1, 2].map(() => ({ kind: 'empty' })),
          })
        }
        lettersUsed(count)
      }
    }
    from += settings.size
  })
  return quizzes
}

/**
 * A round robin of `n` teams, `perTeam` quizzes each, as groups of the lane's team indexes (FR-029):
 * 3 each is the rotating draw; otherwise passes walk the teams in order, every other pass mixing
 * the two halves (22, 25, 23 / 26, 24, 27, Feb 2023) so the same three don't meet again, and a
 * short last quiz is topped up from the top of the lane.
 */
function roundRobin(n: number, perTeam: number): number[][] {
  if (n < 3) return []
  if (perTeam === 3 && n >= 4)
    return drawPrelims(n, 'noRematches', 3).map((q) => q.map(indexOfLetter))
  const half = Math.ceil(n / 2)
  const order: number[] = []
  for (let pass = 0; pass < perTeam; pass++) {
    for (let j = 0; j < n; j++)
      order.push(pass % 2 === 0 ? j : j % 2 === 0 ? j / 2 : half + (j - 1) / 2)
  }
  const groups: number[][] = []
  for (let j = 0; j < order.length; j += 3) groups.push(order.slice(j, j + 3))
  const last = groups[groups.length - 1]!
  for (let k = 0; last.length < 3; k++) if (!last.includes(k)) last.push(k)
  return groups
}

/** How many of an intermediate's ranks sit above its line by default (FR-028) */
export function defaultAbove(quizzes: number): number {
  return [2, 3, 3, 4][quizzes - 1] ?? 3
}

/**
 * A division's elims for a new team count (FR-030): the defaults follow the count, and elims the
 * director has changed stay as they are
 */
export function elimsForCount(
  division: DivisionSettings,
  teams: number,
): DivisionSettings['elims'] {
  const isDefault = JSON.stringify(division.elims) === JSON.stringify(defaultElims(division.teams))
  return isDefault ? defaultElims(teams) : division.elims
}
