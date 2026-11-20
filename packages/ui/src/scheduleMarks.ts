import {
  drawnTeam,
  ordinal,
  foldName,
  benchKey,
  type DayQuiz,
  type DayTeam,
  type ScheduleDocument,
  type ScheduleQuiz,
  type SettledBench,
} from '@qzr/shared'

/**
 * What the meet day adds to a published schedule (specs/010-meet-day, FR-009 to FR-011): each
 * scheduled quiz's status and result, and each bench's settled team. The builder passes none.
 */
export interface ScheduleMarks {
  /** By schedule quiz id */
  quizzes: Map<string, DayQuiz>
  /** Settled benches by `benchKey` */
  benches: Record<string, SettledBench>
}

/** A quiz's benches as marked: each bench's team and its result, and results no bench holds */
export interface MarkedQuiz {
  benches: { settled?: SettledBench; result?: DayTeam }[]
  /** Teams of the result the quiz's benches don't name, listed under it */
  unplaced: DayTeam[]
}

/**
 * Each bench's settled team and the result line of the team on it, matched by folded name: the
 * settled team, or for a drawn letter the draw's team as the sheet shows it
 */
export function markQuiz(
  doc: ScheduleDocument,
  quiz: ScheduleQuiz,
  marks: ScheduleMarks,
): MarkedQuiz {
  const result = marks.quizzes.get(quiz.id)?.teams ?? []
  const left = [...result]
  const benches = quiz.seats.map((bench, index) => {
    const settled = marks.benches[benchKey(quiz.id, index)]
    const name = benchTeam(doc, quiz, bench, settled)
    const at = name === undefined ? -1 : left.findIndex((t) => foldName(t.name) === foldName(name))
    const team = at < 0 ? undefined : left.splice(at, 1)[0]
    return { settled, result: team }
  })
  // A bench whose team the schedule can't name, as a tied one, holds the one result left over
  const unnamed = benches.filter(
    (b, i) => !b.result && benchTeam(doc, quiz, quiz.seats[i]!, b.settled) === undefined,
  )
  if (unnamed.length === 1 && left.length === 1) unnamed[0]!.result = left.pop()
  return { benches, unplaced: left }
}

/** The team on a bench to match a result to: its settled team, or a drawn letter's */
function benchTeam(
  doc: ScheduleDocument,
  quiz: ScheduleQuiz,
  bench: ScheduleQuiz['seats'][number],
  settled: SettledBench | undefined,
): string | undefined {
  if (settled) return 'team' in settled ? settled.team : undefined
  // An absent team sits on no bench, so no result is matched to it
  if (bench.kind === 'letter') {
    const team = drawnTeam(doc, quiz, bench)
    return team?.absent ? undefined : team?.name
  }
  return undefined
}

/** A settled bench's team as a reader sees it; one the admin has yet to settle reads as tied */
export function settledText(settled: SettledBench): string {
  return 'team' in settled ? settled.team : 'Tied'
}

/** A team's result as the sheet writes it: its place, `=` before one it shares, then its score */
export function resultText(team: DayTeam): string {
  if (team.place === undefined) return ''
  const place = `${team.tiedWith && team.tiedWith > 1 ? '=' : ''}${ordinal(team.place)}`
  return team.score === undefined ? place : `${place} · ${team.score}`
}
