import {
  drawnTeam,
  ordinal,
  foldName,
  benchKey,
  type DayQuiz,
  type DayStatus,
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
  // A tied bench, whose team the schedule can't name, holds the one result left over
  const unnamed = benches.filter((b) => !b.result && b.settled && !('team' in b.settled))
  if (unnamed.length === 1 && left.length === 1) unnamed[0]!.result = left.pop()
  return { benches, unplaced: left }
}

/** Every quiz of the schedule marked, by id; none without marks, as the builder has */
export function markQuizzes(
  doc: ScheduleDocument,
  marks: ScheduleMarks | null,
): Map<string, MarkedQuiz> {
  if (!marks) return new Map()
  return new Map(doc.quizzes.map((q) => [q.id, markQuiz(doc, q, marks)]))
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

/** The few words a quiz's status reads as on the schedule; a quiz played or not in says nothing */
export const STATUS_TEXT: Partial<Record<DayStatus, string>> = {
  attention: 'Needs attention',
  underReview: 'Under review',
  notCounted: 'Not counted',
  hidden: 'Result not shown yet',
}
